import type { EmoteMessage } from "@fyendal/shared";
import type { Queryable } from "./db.js";
import type { RoomBroadcastEvent } from "./roomBroadcaster.js";
import type { ErrorLogger } from "./logging.js";
import { asRecord } from "./validation.js";

const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_RETENTION_MS = 60 * 60 * 1000;

export type ClusterEvent =
  | { type: "room"; event: RoomBroadcastEvent }
  | { type: "queue-changed" }
  | { type: "queue-waiting"; userId: number; format: "classic-battles" | "cc" | "silver-age" }
  | { type: "session-revoked"; tokenHash: string }
  | { type: "user-sessions-revoked"; userId: number }
  | { type: "match-ready"; userId: number; code: string; created: boolean }
  | { type: "match-timeout"; userId: number; code: string }
  | { type: "emote"; code: string; seat: 0 | 1; message: EmoteMessage };

function safeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function roomCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9]{6}$/.test(value) ? value : null;
}

const ROOM_KINDS = new Set<RoomBroadcastEvent["kind"]>([
  "sync", "created", "joined", "left", "prep", "game-started", "state", "spectators", "presence", "deleted",
]);

const EMOTES = new Set<EmoteMessage>([
  "Hello!", "Good luck, have fun!", "Good game!", "Thanks!", "Sorry!", "Nice play!", "Thinking...", "Oops!",
]);

function decodeRow(value: unknown): { id: number; event: ClusterEvent } | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = safeInteger(row.id);
  if (id === null || id < 1 || typeof row.event_type !== "string") return null;
  const payload = asRecord(row.payload);
  switch (row.event_type) {
    case "room": {
      const code = roomCode(row.room_code);
      const version = safeInteger(row.room_version);
      const kind = payload?.kind;
      if (!code || version === null || version < 0 || typeof kind !== "string" || !ROOM_KINDS.has(kind as RoomBroadcastEvent["kind"])) {
        return null;
      }
      if (kind === "presence") {
        if (!payload) return null;
        const seat = safeInteger(payload.seat);
        if ((seat !== 0 && seat !== 1) || typeof payload.connected !== "boolean") return null;
        return { id, event: { type: "room", event: { code, version, kind, seat, connected: payload.connected } } };
      }
      return { id, event: { type: "room", event: { code, version, kind } as RoomBroadcastEvent } };
    }
    case "queue-changed":
      return { id, event: { type: "queue-changed" } };
    case "queue-waiting": {
      const userId = safeInteger(row.subject_user_id);
      const format = payload?.format;
      return userId !== null && userId > 0
        && (format === "classic-battles" || format === "cc" || format === "silver-age")
        ? { id, event: { type: "queue-waiting", userId, format } }
        : null;
    }
    case "session-revoked":
      return payload && typeof payload.tokenHash === "string" && /^[0-9a-f]{64}$/.test(payload.tokenHash)
        ? { id, event: { type: "session-revoked", tokenHash: payload.tokenHash } }
        : null;
    case "user-sessions-revoked": {
      const userId = safeInteger(row.subject_user_id);
      return userId !== null && userId > 0 ? { id, event: { type: "user-sessions-revoked", userId } } : null;
    }
    case "match-ready": {
      const userId = safeInteger(row.subject_user_id);
      const code = roomCode(row.room_code);
      return userId !== null && userId > 0 && code && typeof payload?.created === "boolean"
        ? { id, event: { type: "match-ready", userId, code, created: payload.created } }
        : null;
    }
    case "match-timeout": {
      const userId = safeInteger(row.subject_user_id);
      const code = roomCode(row.room_code);
      return userId !== null && userId > 0 && code
        ? { id, event: { type: "match-timeout", userId, code } }
        : null;
    }
    case "emote": {
      const code = roomCode(row.room_code);
      const seat = safeInteger(payload?.seat);
      const message = payload?.message;
      return code && (seat === 0 || seat === 1) && typeof message === "string" && EMOTES.has(message as EmoteMessage)
        ? { id, event: { type: "emote", code, seat, message: message as EmoteMessage } }
        : null;
    }
    default:
      return null;
  }
}

export async function appendClusterEvent(db: Queryable, event: ClusterEvent): Promise<number> {
  const eventType: string = event.type;
  let code: string | null = null;
  let version: number | null = null;
  let userId: number | null = null;
  let payload: Record<string, unknown> = {};
  if (event.type === "room") {
    code = event.event.code;
    version = event.event.version;
    payload = event.event.kind === "presence"
      ? { kind: event.event.kind, seat: event.event.seat, connected: event.event.connected }
      : { kind: event.event.kind };
  } else if (event.type === "session-revoked") {
    payload = { tokenHash: event.tokenHash };
  } else if (event.type === "user-sessions-revoked") {
    userId = event.userId;
  } else if (event.type === "queue-waiting") {
    userId = event.userId;
    payload = { format: event.format };
  } else if (event.type === "match-ready") {
    userId = event.userId;
    code = event.code;
    payload = { created: event.created };
  } else if (event.type === "match-timeout") {
    userId = event.userId;
    code = event.code;
  } else if (event.type === "emote") {
    code = event.code;
    payload = { seat: event.seat, message: event.message };
  }
  const { rows } = await db.query(
    `INSERT INTO cluster_events
      (event_type, room_code, room_version, subject_user_id, payload, created_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [eventType, code, version, userId, JSON.stringify(payload), Date.now()],
  );
  const id = safeInteger(rows[0]?.id);
  if (id === null || id < 1) throw new Error("cluster event insert did not return an id");
  return id;
}

export async function sweepClusterEvents(
  db: Queryable,
  now = Date.now(),
  retentionMs = DEFAULT_RETENTION_MS,
): Promise<number> {
  const result = await db.query("DELETE FROM cluster_events WHERE created_at < $1", [now - retentionMs]);
  return result.rowCount ?? 0;
}

export class ClusterEventConsumer {
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly db: Queryable,
    private readonly handle: (event: ClusterEvent) => Promise<void> | void,
    private readonly options: { pollIntervalMs?: number; batchSize?: number; logError?: ErrorLogger } = {},
  ) {}

  start(): void {
    if (this.stopped || this.timer || this.polling) return;
    this.schedule(0);
  }

  /** New gateways need only events committed after they begin joining the
   * cluster. Historical state is loaded authoritatively on connect/recovery. */
  async startAtTail(): Promise<void> {
    if (this.stopped || this.timer || this.polling) return;
    const { rows } = await this.db.query("SELECT COALESCE(MAX(id), 0) AS id FROM cluster_events");
    const id = safeInteger(rows[0]?.id);
    if (id === null || id < 0) throw new Error("invalid cluster event tail");
    this.cursor = id;
    this.start();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  nudge(): void {
    if (this.stopped || this.polling) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.schedule(0);
  }

  async pollNow(): Promise<void> {
    if (this.polling) return this.polling;
    this.polling = this.poll().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private schedule(delay: number): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pollNow()
        .catch((error) => this.options.logError?.("cluster event poll failed", error))
        .finally(() => this.schedule(this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS));
    }, delay);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT id, event_type, room_code, room_version, subject_user_id, payload
       FROM cluster_events WHERE id > $1 ORDER BY id LIMIT $2`,
      [this.cursor, this.options.batchSize ?? DEFAULT_BATCH_SIZE],
    );
    const pendingRoomRefreshes = new Map<string, ClusterEvent>();
    const flushRoomRefreshes = async (): Promise<void> => {
      await Promise.all([...pendingRoomRefreshes.values()].map((event) => this.handle(event)));
      pendingRoomRefreshes.clear();
    };
    for (const row of rows) {
      const decoded = decodeRow(row);
      const id = safeInteger(asRecord(row)?.id);
      if (id === null || id <= this.cursor) throw new Error("invalid cluster event id");
      this.cursor = id;
      if (!decoded) {
        this.options.logError?.(`ignored invalid cluster event ${id}`, row);
        continue;
      }
      const event = decoded.event;
      if (event.type === "room"
        && event.event.kind !== "presence"
        && event.event.kind !== "spectators"
        && event.event.kind !== "deleted") {
        // A reload observes the latest committed room version, so consecutive
        // refresh hints for one room are equivalent to the newest hint.
        const previous = pendingRoomRefreshes.get(event.event.code);
        if (previous?.type !== "room" || previous.event.version <= event.event.version) {
          // `sync` is the lossless coalesced hint: the broadcaster derives
          // prep/game state from the authoritative row. Keeping a later
          // semantic `joined` hint would otherwise discard an earlier prep
          // refresh in the same batch.
          pendingRoomRefreshes.set(event.event.code, {
            type: "room",
            event: { code: event.event.code, kind: "sync", version: event.event.version },
          });
        }
      } else {
        await flushRoomRefreshes();
        await this.handle(event);
      }
    }
    await flushRoomRefreshes();
    if (rows.length >= (this.options.batchSize ?? DEFAULT_BATCH_SIZE)) this.nudge();
  }
}
