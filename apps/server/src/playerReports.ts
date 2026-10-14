import { randomUUID } from "node:crypto";
import {
  isPlayerReportReason,
  PLAYER_REPORT_CHAT_MESSAGES,
  PLAYER_REPORT_DETAILS_MAX,
} from "@fyendal/protocol";
import { withTransaction, type Queryable } from "./db.js";
import { CHAT_RETENTION_MS, friendByUsername } from "./social.js";
import { asRecord } from "./validation.js";

export type CreatePlayerReportResult =
  | { ok: true; reportId: string }
  | { ok: false; error: "invalid report" | "room not found" | "player not reportable" };

export type PlayerReportInput =
  | { source: "game"; roomCode: string; reason: unknown; details: string; includeChat: boolean }
  | { source: "chat"; username: string; reason: unknown; details: string; includeChat: boolean };

/** One attached message. Authors are recorded by role so the copy stays
 * meaningful if either account is later renamed or deleted. */
interface ReportedChatMessage {
  from: "reporter" | "reported";
  text: string;
  sentAt: number;
}

async function friendshipExists(db: Queryable, a: number, b: number): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT 1 FROM friendships WHERE user_low_id = $1 AND user_high_id = $2",
    [Math.min(a, b), Math.max(a, b)],
  );
  return rows.length > 0;
}

/** Copy the newest retained messages between the two accounts, oldest first. */
async function chatSnapshot(
  db: Queryable,
  reporterUserId: number,
  reportedUserId: number,
  now: number,
): Promise<ReportedChatMessage[]> {
  const { rows } = await db.query(
    `SELECT sender_user_id, body, created_at FROM friend_messages
     WHERE user_low_id = $1 AND user_high_id = $2 AND created_at > $3
     ORDER BY id DESC LIMIT $4`,
    [
      Math.min(reporterUserId, reportedUserId),
      Math.max(reporterUserId, reportedUserId),
      now - CHAT_RETENTION_MS,
      PLAYER_REPORT_CHAT_MESSAGES,
    ],
  );
  return rows.map((value: unknown): ReportedChatMessage => {
    const row = asRecord(value);
    if (!row || typeof row.body !== "string") throw new Error("invalid player-report chat row");
    return {
      from: Number(row.sender_user_id) === reporterUserId ? "reporter" : "reported",
      text: row.body,
      sentAt: Number(row.created_at),
    };
  }).reverse();
}

/** Resolve the game report's subject: the other seated human in the room, so
 * a client can neither name an arbitrary account nor report a practice bot. */
async function gameSubject(
  tx: Queryable,
  reporterUserId: number,
  code: string,
): Promise<{ reportedUserId: number; roomCode: string; roomVersion: number } | "room not found" | "player not reportable"> {
  const roomCode = code.toUpperCase();
  if (!/^[0-9A-Z]{6}$/.test(roomCode)) return "room not found";
  const { rows } = await tx.query(
    `SELECT r.version, s.user_id, s.controller
     FROM rooms r
     JOIN room_seats s ON s.room_code = r.code
     WHERE r.code = $1
     ORDER BY s.seat
     FOR UPDATE`,
    [roomCode],
  );
  const seats = rows.map((value: unknown) => {
    const row = asRecord(value);
    if (!row) throw new Error("invalid player-report seat row");
    return {
      roomVersion: Number(row.version),
      userId: row.user_id == null ? null : Number(row.user_id),
      human: row.controller === "human",
    };
  });
  const reporter = seats.find((seat) => seat.human && seat.userId === reporterUserId);
  if (!reporter) return "room not found";
  const opponent = seats.find((seat) => seat !== reporter);
  if (!opponent?.human || opponent.userId === null || opponent.userId === reporterUserId) {
    return "player not reportable";
  }
  return { reportedUserId: opponent.userId, roomCode, roomVersion: reporter.roomVersion };
}

/** Record an operator-only conduct report. A game report targets the
 * reporter's human opponent and is idempotent per opponent and room; a chat
 * report targets a current friend. Either may attach a copy of the friends'
 * conversation when the reporter opts in and the friendship exists. */
export async function createPlayerReport(
  db: Queryable,
  reporterUserId: number,
  input: PlayerReportInput,
): Promise<CreatePlayerReportResult> {
  const details = input.details.trim();
  if (!isPlayerReportReason(input.reason, input.source) || details.length > PLAYER_REPORT_DETAILS_MAX) {
    return { ok: false, error: "invalid report" };
  }
  const reason = input.reason;

  return withTransaction(db, async (tx) => {
    let subject: { reportedUserId: number; roomCode: string | null; roomVersion: number | null };
    let attachChat = input.includeChat;
    if (input.source === "game") {
      const resolved = await gameSubject(tx, reporterUserId, input.roomCode);
      if (typeof resolved === "string") return { ok: false as const, error: resolved };
      subject = resolved;
      // A game opponent may not be a friend; only friends share a conversation.
      attachChat = attachChat && await friendshipExists(tx, reporterUserId, subject.reportedUserId);
    } else {
      const friend = await friendByUsername(tx, reporterUserId, input.username);
      if (!friend) return { ok: false as const, error: "player not reportable" as const };
      subject = { reportedUserId: friend.id, roomCode: null, roomVersion: null };
    }

    const now = Date.now();
    const chat = attachChat ? await chatSnapshot(tx, reporterUserId, subject.reportedUserId, now) : null;
    const reportId = randomUUID();
    await tx.query(
      `INSERT INTO player_reports
        (id, reporter_user_id, reported_user_id, source, room_code, room_version,
         reason, details, chat_history, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (reporter_user_id, reported_user_id, room_code) DO NOTHING`,
      [
        reportId,
        reporterUserId,
        subject.reportedUserId,
        input.source,
        subject.roomCode,
        subject.roomVersion,
        reason,
        details,
        chat === null ? null : JSON.stringify(chat),
        now,
      ],
    );
    if (subject.roomCode === null) return { ok: true as const, reportId };
    // A repeated game report keeps the original; read back whichever row won.
    const { rows } = await tx.query(
      `SELECT id FROM player_reports
       WHERE reporter_user_id = $1 AND reported_user_id = $2 AND room_code = $3`,
      [reporterUserId, subject.reportedUserId, subject.roomCode],
    );
    const row = asRecord(rows[0]);
    if (!row || typeof row.id !== "string") throw new Error("invalid player-report row");
    return { ok: true as const, reportId: row.id };
  });
}
