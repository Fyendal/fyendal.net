import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { gzip as gzipCallback, gunzip as gunzipCallback } from "node:zlib";
import {
  projectStateForReplay,
  projectTransitionEvents,
  type EngineTransitionMove,
  type GameState,
} from "@fyendal/engine";
import {
  decodeReplayFile,
  decodeReplayResponse,
  decodeGameView,
  type ReplaySummary,
} from "@fyendal/protocol";
import type { Format, GameView, ReplayFile } from "@fyendal/shared";
import { type Queryable, withTransaction } from "./db.js";
import { tryAcquireLease } from "./leases.js";
import { consoleError, type ErrorLogger } from "./logging.js";

export const REPLAY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REPLAY_VIEWS = 10_000;
const REPLAY_YIELD_BUDGET_MS = 8;
const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);

export interface ReplayStartParticipant {
  seat: 0 | 1;
  userId?: number;
  heroId: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function safeInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`invalid ${label}`);
  return number;
}

function format(value: unknown): Format {
  if (value === "classic-battles" || value === "cc" || value === "silver-age") return value;
  throw new Error("invalid replay format");
}

function replayId(): string {
  return randomBytes(12).toString("hex");
}

export async function startReplay(
  db: Queryable,
  input: {
    roomCode: string;
    rulesetVersion: string;
    format: Format;
    state: GameState;
    roomVersion: number;
    participants: [ReplayStartParticipant, ReplayStartParticipant];
    createdAt?: number;
  },
): Promise<void> {
  const id = replayId();
  const createdAt = input.createdAt ?? Date.now();
  await db.query(
    `INSERT INTO replay_games
      (id, room_code, ruleset_version, format, hero_0_id, hero_1_id,
       winner, status, created_at, finished_at, expires_at, frame_count)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,'recording',$7,NULL,NULL,NULL)`,
    [
      id,
      input.roomCode,
      input.rulesetVersion,
      input.format,
      input.participants[0].heroId,
      input.participants[1].heroId,
      createdAt,
    ],
  );
  for (const participant of input.participants) {
    if (participant.userId == null) continue;
    await db.query(
      `INSERT INTO replay_participants (replay_id, user_id, seat, payload, payload_bytes)
       VALUES ($1,$2,$3,NULL,NULL)`,
      [id, participant.userId, participant.seat],
    );
  }
  await db.query(
    `INSERT INTO replay_frames (replay_id, room_version, view)
     VALUES ($1,$2,$3)`,
    [id, input.roomVersion, JSON.stringify(projectStateForReplay(input.state, input.roomCode))],
  );
}

export async function appendReplayView(
  db: Queryable,
  roomCode: string,
  roomVersion: number,
  state: GameState,
  winner: number | null,
  transition: {
    kind: "forward" | "replace";
    events: readonly EngineTransitionMove[];
  } | null,
  now = Date.now(),
): Promise<string | null> {
  let view: string;
  let projectedTransition: string | null;
  try {
    view = JSON.stringify(projectStateForReplay(state, roomCode));
    projectedTransition = transition
      ? JSON.stringify({
          kind: transition.kind,
          events: projectTransitionEvents(transition.events, null, true),
        })
      : null;
  } catch (error) {
    // A traffic-less Cloud Run revision can remain alive briefly during a
    // rollout and consume durable room work. If that older process cannot
    // project a card introduced by the new revision, replay retention must not
    // roll back the authoritative room mutation and strand the active player.
    // Discard only the unfinished recording; database failures below remain
    // transactional and continue to fail the mutation.
    consoleError(`discarding replay recording for room ${roomCode}: frame projection failed`, error);
    await db.query(
      "DELETE FROM replay_games WHERE room_code = $1 AND status = 'recording'",
      [roomCode],
    );
    return null;
  }
  const inserted = await db.query(
    `INSERT INTO replay_frames (replay_id, room_version, view, transition)
     SELECT active.id, $2::bigint, $3::jsonb, $4::jsonb
     FROM (
       SELECT id FROM replay_games
       WHERE room_code = $1 AND status = 'recording'
       ORDER BY created_at DESC LIMIT 1
     ) active
     RETURNING replay_id`,
    [
      roomCode,
      roomVersion,
      view,
      projectedTransition,
    ],
  );
  if (!inserted.rows.length) return null;
  const id = String(inserted.rows[0].replay_id);
  if (winner === 0 || winner === 1) {
    const finalized = await db.query(
      `UPDATE replay_games SET winner=$2, status='finalizing', finished_at=$3, expires_at=$4
       WHERE id=$1 AND status='recording' RETURNING id`,
      [id, winner, now, now + REPLAY_TTL_MS],
    );
    return finalized.rows.length ? id : null;
  }
  return null;
}

/** Finish the latest in-progress room replay without declaring a winner.
 * Used when a player explicitly ends a bot practice game. The most recently
 * committed frame is already authoritative, so finalization only needs to
 * close the recording and assign its retention window. */
export async function endReplayForRoom(
  db: Queryable,
  roomCode: string,
  now = Date.now(),
): Promise<string | null> {
  const active = await db.query(
    `SELECT id FROM replay_games
     WHERE room_code = $1 AND status = 'recording'
     ORDER BY created_at DESC LIMIT 1`,
    [roomCode.toUpperCase()],
  );
  if (!active.rows.length) return null;
  const id = String(active.rows[0]!.id);
  const finalized = await db.query(
    `UPDATE replay_games SET status='finalizing', finished_at=$2, expires_at=$3
     WHERE id=$1 AND status='recording' RETURNING id`,
    [id, now, now + REPLAY_TTL_MS],
  );
  return finalized.rows.length ? id : null;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function replayFiles(
  db: Queryable,
  replay: Record<string, unknown>,
  seats: readonly (0 | 1)[],
  yieldControl: () => Promise<void> = yieldToEventLoop,
): Promise<GameViewBuild> {
  const id = String(replay.id);
  const uniqueSeats = [...new Set(seats)];
  const { rows } = await db.query(
    "SELECT view, transition FROM replay_frames WHERE replay_id = $1 ORDER BY room_version",
    [id],
  );
  if (rows.length > MAX_REPLAY_VIEWS) throw new Error(`replay ${id} has too many frames`);
  const frames: Array<{ view: GameView; transition: unknown }> = [];
  let yieldedAt = performance.now();
  for (let index = 0; index < rows.length; index++) {
    const view = decodeGameView(rows[index]!.view);
    if (!view) throw new Error(`replay ${id} frame ${index + 1} failed validation`);
    frames.push({ view, transition: rows[index]!.transition ?? null });
    if (index + 1 < rows.length && performance.now() - yieldedAt >= REPLAY_YIELD_BUDGET_MS) {
      await yieldControl();
      yieldedAt = performance.now();
    }
  }
  return {
    files: new Map(
      uniqueSeats.map((seat) => {
        const file = decodeReplayFile({ version: 2, seat, frames });
        if (!file) throw new Error(`replay ${id} transition validation failed`);
        return [seat, file];
      }),
    ),
  };
}

interface GameViewBuild {
  files: Map<0 | 1, ReplayFile>;
}

function replayViews(file: ReplayFile): GameView[] {
  return file.version === 1 ? file.views : file.frames.map((frame) => frame.view);
}

export async function finalizeReplay(db: Queryable, replayIdValue: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT id, winner
     FROM replay_games WHERE id = $1 AND status = 'finalizing'`,
    [replayIdValue],
  );
  if (!rows.length) return false;
  const replay = record(rows[0], "replay row");
  if (!(replay.winner === null || replay.winner === 0 || replay.winner === 1)) {
    throw new Error(`invalid replay winner ${String(replay.id)}`);
  }
  const participants = await db.query(
    "SELECT user_id, seat FROM replay_participants WHERE replay_id = $1 ORDER BY seat",
    [replay.id],
  );
  const decodedParticipants = participants.rows.map((value) => {
    const participant = record(value, "replay participant");
    const seatValue = safeInteger(participant.seat, "replay seat");
    if (!(seatValue === 0 || seatValue === 1)) throw new Error("invalid replay seat");
    const seat: 0 | 1 = seatValue;
    return {
      userId: safeInteger(participant.user_id, "replay user"),
      seat,
    };
  });
  if (!decodedParticipants.length) throw new Error(`replay ${String(replay.id)} has no participants`);
  const built = await replayFiles(db, replay, decodedParticipants.map(({ seat }) => seat));
  const firstFile = built.files.values().next().value;
  const finalView = firstFile ? replayViews(firstFile).at(-1) : undefined;
  if (!finalView || finalView.winner !== replay.winner) {
    throw new Error(`replay ${String(replay.id)} winner mismatch`);
  }
  const payloads = await Promise.all(decodedParticipants.map(async (participant) => {
    const file = built.files.get(participant.seat);
    if (!file) throw new Error(`replay ${String(replay.id)} is missing seat ${participant.seat}`);
    const decoded = decodeReplayFile(file);
    if (!decoded) throw new Error(`replay ${String(replay.id)} projection failed validation`);
    const response = JSON.stringify({ ok: true, replay: decoded });
    const payload = await gzip(Buffer.from(response));
    return {
      userId: participant.userId,
      seat: participant.seat,
      payload,
      frames: replayViews(decoded).length,
    };
  }));
  await withTransaction(db, async (tx) => {
    for (const payload of payloads) {
      await tx.query(
        `UPDATE replay_participants SET payload=$3, payload_bytes=$4
         WHERE replay_id=$1 AND user_id=$2`,
        [replay.id, payload.userId, payload.payload, payload.payload.length],
      );
    }
    await tx.query(
      `UPDATE replay_games SET status='ready', frame_count=$2
       WHERE id=$1 AND status='finalizing'`,
      [replay.id, payloads[0]?.frames ?? 0],
    );
    await tx.query("DELETE FROM replay_frames WHERE replay_id = $1", [replay.id]);
  });
  return true;
}

export async function finalizeReplayForRoom(db: Queryable, roomCode: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT id FROM replay_games
     WHERE room_code = $1 AND status = 'finalizing'
     ORDER BY created_at DESC LIMIT 1`,
    [roomCode.toUpperCase()],
  );
  return rows.length ? finalizeReplay(db, String(rows[0].id)) : false;
}

export async function discardUnfinishedReplaysOtherRulesets(
  db: Queryable,
  rulesetVersion: string,
): Promise<number> {
  const result = await db.query(
    `DELETE FROM replay_games
     WHERE status <> 'ready' AND ruleset_version <> $1`,
    [rulesetVersion],
  );
  return result.rowCount ?? 0;
}

export async function finalizePendingReplays(
  db: Queryable,
  rulesetVersion?: string,
): Promise<number> {
  const { rows } = await db.query(
    `SELECT id FROM replay_games
     WHERE status = 'finalizing'${rulesetVersion ? " AND ruleset_version = $1" : ""}
     ORDER BY finished_at`,
    rulesetVersion ? [rulesetVersion] : [],
  );
  let finalized = 0;
  for (const row of rows) {
    if (await finalizeReplay(db, String(row.id))) finalized += 1;
  }
  return finalized;
}

export class ReplayFinalizer {
  private readonly pending: string[] = [];
  private readonly queued = new Set<string>();
  private readonly idleWaiters = new Set<() => void>();
  private draining = false;
  private stopped = false;

  constructor(
    private readonly db: Queryable,
    private readonly logError: ErrorLogger = consoleError,
    private readonly ownerId?: string,
  ) {}

  enqueue(replayIdValue: string): void {
    if (this.stopped || this.queued.has(replayIdValue)) return;
    this.queued.add(replayIdValue);
    this.pending.push(replayIdValue);
    this.schedule();
  }

  async recoverPending(rulesetVersion?: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT id FROM replay_games
       WHERE status = 'finalizing'${rulesetVersion ? " AND ruleset_version = $1" : ""}
       ORDER BY finished_at`,
      rulesetVersion ? [rulesetVersion] : [],
    );
    for (const row of rows) this.enqueue(String(row.id));
    return rows.length;
  }

  async waitForIdle(): Promise<void> {
    if (!this.draining && this.pending.length === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  stop(): void {
    this.stopped = true;
    this.pending.length = 0;
    this.queued.clear();
    if (!this.draining) this.resolveIdle();
  }

  private schedule(): void {
    if (this.draining || this.stopped) return;
    this.draining = true;
    setImmediate(() => void this.drain());
  }

  private async drain(): Promise<void> {
    try {
      while (!this.stopped && this.pending.length > 0) {
        const replayIdValue = this.pending.shift()!;
        try {
          if (this.ownerId && !(await tryAcquireLease(
            this.db,
            `replay:${replayIdValue}`,
            this.ownerId,
            5 * 60_000,
          ))) continue;
          await finalizeReplay(this.db, replayIdValue);
        } catch (error) {
          this.logError(`replay finalization failed (${replayIdValue})`, error);
        } finally {
          this.queued.delete(replayIdValue);
        }
        if (!this.stopped && this.pending.length > 0) await yieldToEventLoop();
      }
    } finally {
      this.draining = false;
      this.resolveIdle();
      if (this.pending.length > 0) this.schedule();
    }
  }

  private resolveIdle(): void {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

export async function listReplays(
  db: Queryable,
  userId: number,
  now = Date.now(),
): Promise<ReplaySummary[]> {
  const { rows } = await db.query(
    `SELECT g.id, g.format, g.hero_0_id, g.hero_1_id, p.seat, g.winner,
            g.finished_at, g.expires_at, g.frame_count
     FROM replay_games g
     JOIN replay_participants p ON p.replay_id = g.id
     WHERE p.user_id = $1 AND g.status = 'ready' AND g.expires_at > $2
     ORDER BY g.finished_at DESC, g.id DESC`,
    [userId, now],
  );
  return rows.map((value) => {
    const row = record(value, "replay summary");
    const seat = safeInteger(row.seat, "replay seat");
    const winner = row.winner === null ? null : safeInteger(row.winner, "replay winner");
    if (!(seat === 0 || seat === 1) || !(winner === null || winner === 0 || winner === 1)) {
      throw new Error("invalid replay summary seat");
    }
    return {
      id: String(row.id),
      format: format(row.format),
      heroIds: [String(row.hero_0_id), String(row.hero_1_id)],
      yourSeat: seat,
      winner,
      finishedAt: safeInteger(row.finished_at, "replay finished time"),
      expiresAt: safeInteger(row.expires_at, "replay expiry"),
      frameCount: safeInteger(row.frame_count, "replay frame count"),
    };
  });
}

export async function getReplay(
  db: Queryable,
  userId: number,
  id: string,
  now = Date.now(),
): Promise<ReplayFile | null> {
  const payload = await getReplayPayload(db, userId, id, now);
  if (!payload) return null;
  const parsed: unknown = JSON.parse((await gunzip(payload)).toString("utf8"));
  return decodeReplayResponse(parsed)?.replay ?? null;
}

export async function getReplayPayload(
  db: Queryable,
  userId: number,
  id: string,
  now = Date.now(),
): Promise<Buffer | null> {
  const { rows } = await db.query(
    `SELECT p.payload FROM replay_participants p
     JOIN replay_games g ON g.id = p.replay_id
     WHERE p.replay_id=$1 AND p.user_id=$2 AND g.status='ready' AND g.expires_at > $3`,
    [id, userId, now],
  );
  if (!rows.length || !Buffer.isBuffer(rows[0].payload)) return null;
  return rows[0].payload;
}

/** Resolve a completed replay by room for the game-over client. Recording and
 * finalizing frames are never returned because they contain omniscient state. */
export async function getReplayPayloadForRoom(
  db: Queryable,
  userId: number,
  roomCode: string,
  now = Date.now(),
): Promise<Buffer | null> {
  const state = await replayPayloadStateForRoom(db, userId, roomCode, now);
  return state.kind === "ready" ? state.payload : null;
}

type RoomReplayPayloadState =
  | { kind: "ready"; payload: Buffer }
  | { kind: "finalizing" }
  | { kind: "unavailable" };

async function replayPayloadStateForRoom(
  db: Queryable,
  userId: number,
  roomCode: string,
  now: number,
): Promise<RoomReplayPayloadState> {
  const { rows } = await db.query(
    `SELECT g.status, g.expires_at, p.payload FROM replay_participants p
     JOIN replay_games g ON g.id = p.replay_id
     WHERE g.room_code=$1 AND p.user_id=$2
     ORDER BY g.created_at DESC LIMIT 1`,
    [roomCode.toUpperCase(), userId],
  );
  const row = rows[0];
  if (!row) return { kind: "unavailable" };
  const expiresAt = Number(row.expires_at);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return { kind: "unavailable" };
  if (row.status === "finalizing") return { kind: "finalizing" };
  return row.status === "ready" && Buffer.isBuffer(row.payload)
    ? { kind: "ready", payload: row.payload }
    : { kind: "unavailable" };
}

/** Wait for the background finalizer when the game-over client asks for its
 * replay immediately. Active recordings and unauthorized rooms still return
 * null without delay; a bounded wait prevents a failed finalizer from holding
 * an HTTP request forever. */
export async function waitForReplayPayloadForRoom(
  db: Queryable,
  userId: number,
  roomCode: string,
  options: {
    now?: number;
    timeoutMs?: number;
    initialPollMs?: number;
    wait?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<Buffer | null> {
  const now = options.now ?? Date.now();
  const timeoutMs = Math.max(0, options.timeoutMs ?? 10_000);
  const wait = options.wait ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let delayMs = Math.max(1, options.initialPollMs ?? 25);
  let waitedMs = 0;
  while (true) {
    const state = await replayPayloadStateForRoom(db, userId, roomCode, now);
    if (state.kind === "ready") return state.payload;
    if (state.kind !== "finalizing" || waitedMs >= timeoutMs) return null;
    const nextDelayMs = Math.min(delayMs, timeoutMs - waitedMs);
    await wait(nextDelayMs);
    waitedMs += nextDelayMs;
    delayMs = Math.min(delayMs * 2, 500);
  }
}

/** Remove one participant's retained replay. The opponent's independently
 * owned copy remains available; an unreferenced replay game is deleted so its
 * metadata and any remaining frames cascade immediately. */
export async function deleteReplay(
  db: Queryable,
  userId: number,
  id: string,
): Promise<boolean> {
  return withTransaction(db, async (tx) => {
    const replay = await tx.query(
      "SELECT status FROM replay_games WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (replay.rows[0]?.status !== "ready") return false;
    const removed = await tx.query(
      `DELETE FROM replay_participants
       WHERE replay_id=$1 AND user_id=$2
       RETURNING replay_id`,
      [id, userId],
    );
    if (!removed.rows.length) return false;
    const remaining = await tx.query(
      "SELECT 1 FROM replay_participants WHERE replay_id=$1 LIMIT 1",
      [id],
    );
    if (!remaining.rows.length) {
      await tx.query("DELETE FROM replay_games WHERE id=$1", [id]);
    }
    return true;
  });
}

export async function sweepReplays(db: Queryable, now = Date.now(), limit = 500): Promise<number> {
  const ids = new Set<string>();
  // Filter BIGINT deadlines in JS because pg-mem's range comparison is
  // incorrect once an index exists; production still uses the IS NOT NULL index.
  const expired = await db.query(
    `SELECT id, expires_at FROM replay_games WHERE expires_at IS NOT NULL
     ORDER BY expires_at LIMIT $1`,
    [limit],
  );
  expired.rows
    .filter((row) => Number(row.expires_at) <= now)
    .forEach((row) => ids.add(String(row.id)));
  if (ids.size < limit) {
    const orphaned = await db.query(
      `SELECT id FROM replay_games
       WHERE id NOT IN (SELECT replay_id FROM replay_participants)
       ORDER BY created_at LIMIT $1`,
      [limit - ids.size],
    );
    orphaned.rows.forEach((row) => ids.add(String(row.id)));
  }
  if (ids.size < limit) {
    const recordings = await db.query(
      `SELECT g.id FROM replay_games g
       LEFT JOIN rooms r ON r.code = g.room_code AND r.created_at <= g.created_at
       WHERE g.status='recording' AND r.code IS NULL
       ORDER BY g.created_at LIMIT $1`,
      [limit - ids.size],
    );
    recordings.rows.forEach((row) => ids.add(String(row.id)));
  }
  for (const id of ids) {
    await db.query("DELETE FROM replay_games WHERE id = $1", [id]);
  }
  return ids.size;
}
