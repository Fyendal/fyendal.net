import { randomUUID } from "node:crypto";
import { cardData, scripts } from "@fyendal/cards";
import { withTransaction, type Queryable } from "./db.js";
import { decodePersistedState, encodePersistedState } from "./persistedState.js";
import { asRecord } from "./validation.js";

export const BUG_REPORT_DESCRIPTION_MAX = 2_000;

export type CreateBugReportResult =
  | { ok: true; reportId: string }
  | { ok: false; error: "invalid description" | "room not found" };

export interface FixedBugReportNotification {
  reportId: string;
  fixedAt: number;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`invalid bug-report ${field}`);
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`invalid bug-report ${field}`);
  return number;
}

/** Persist an operator-only trace of the room at report time. The trace is
 * intentionally never returned through a player-facing API: it contains the
 * authoritative state, including both players' hidden zones. */
export async function createBugReport(
  db: Queryable,
  reporterUserId: number,
  code: string,
  input: string,
): Promise<CreateBugReportResult> {
  const description = input.trim();
  if (description.length < 10 || description.length > BUG_REPORT_DESCRIPTION_MAX) {
    return { ok: false, error: "invalid description" };
  }
  const roomCode = code.toUpperCase();
  if (!/^[0-9A-Z]{6}$/.test(roomCode)) return { ok: false, error: "room not found" };

  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT r.code, r.format, r.ruleset_version, r.version, r.status,
              r.winner, r.state, s.seat
       FROM rooms r
       JOIN room_seats s ON s.room_code = r.code
       WHERE r.code = $1 AND s.user_id = $2
       FOR UPDATE`,
      [roomCode, reporterUserId],
    );
    const room = asRecord(rows[0]);
    if (!room) return { ok: false as const, error: "room not found" as const };

    const persistedCode = requiredString(room.code, "room code");
    const format = requiredString(room.format, "format");
    const rulesetVersion = requiredString(room.ruleset_version, "ruleset version");
    const roomVersion = requiredInteger(room.version, "room version");
    const status = requiredString(room.status, "room status");
    const reporterSeat = requiredInteger(room.seat, "reporter seat");
    const winner = room.winner == null ? null : requiredInteger(room.winner, "winner");
    const state = room.state == null
      ? null
      : encodePersistedState(
          decodePersistedState(room.state, persistedCode, cardData, scripts, rulesetVersion),
          rulesetVersion,
        );

    const { rows: historyRows } = await tx.query(
      `SELECT version, state FROM room_history
       WHERE room_code = $1 ORDER BY version`,
      [roomCode],
    );
    const history = historyRows.map((value: unknown) => {
      const row = asRecord(value);
      if (!row) throw new Error("invalid bug-report history row");
      return {
        version: requiredInteger(row.version, "history version"),
        state: encodePersistedState(
          decodePersistedState(row.state, persistedCode, cardData, scripts, rulesetVersion),
          rulesetVersion,
        ),
      };
    });
    const capturedAt = Date.now();
    const reportId = randomUUID();
    const trace = {
      version: 1,
      capturedAt,
      room: {
        code: persistedCode,
        format,
        rulesetVersion,
        version: roomVersion,
        status,
        winner,
        reporterSeat,
        state,
      },
      history,
    };
    await tx.query(
      `INSERT INTO bug_reports
        (id, reporter_user_id, room_code, room_version, ruleset_version, description, trace, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        reportId,
        reporterUserId,
        roomCode,
        roomVersion,
        rulesetVersion,
        description,
        JSON.stringify(trace),
        capturedAt,
      ],
    );
    return { ok: true as const, reportId };
  });
}

/** Return only the status needed by the lobby notification. Report text and
 * captured traces stay out of this player-facing response. */
export async function listFixedBugReportNotifications(
  db: Queryable,
  reporterUserId: number,
): Promise<FixedBugReportNotification[]> {
  const { rows } = await db.query(
    `SELECT id, fixed_at
     FROM bug_reports
     WHERE reporter_user_id = $1 AND fixed_at IS NOT NULL AND dismissed_at IS NULL
     ORDER BY fixed_at, id
     LIMIT 100`,
    [reporterUserId],
  );
  return rows.map((value: unknown) => {
    const row = asRecord(value);
    if (!row) throw new Error("invalid fixed bug-report row");
    return {
      reportId: requiredString(row.id, "id"),
      fixedAt: requiredInteger(row.fixed_at, "fixed at"),
    };
  });
}

/** Idempotently acknowledge a fixed report owned by this account. */
export async function dismissFixedBugReportNotification(
  db: Queryable,
  reporterUserId: number,
  reportId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE bug_reports
     SET dismissed_at = COALESCE(dismissed_at, $3)
     WHERE id = $1 AND reporter_user_id = $2 AND fixed_at IS NOT NULL
     RETURNING id`,
    [reportId, reporterUserId, Date.now()],
  );
  return rows.length === 1;
}
