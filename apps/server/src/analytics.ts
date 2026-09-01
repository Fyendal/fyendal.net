import { randomBytes } from "node:crypto";
import type { Format } from "@fyendal/shared";
import type { Queryable } from "./db.js";

export type AnalyticsGameMode = "pvp" | "bot";

/** Record a successful registration without retaining an account identifier. */
export async function recordUserRegistration(
  db: Queryable,
  occurredAt = Date.now(),
): Promise<void> {
  await db.query(
    `INSERT INTO analytics_events
      (event_id, event_type, occurred_at, format, game_mode)
     VALUES ($1, 'user_registered', $2, NULL, NULL)`,
    [`registration:${randomBytes(12).toString("hex")}`, occurredAt],
  );
}

/** The caller records this only after the guarded replay finalization update
 * succeeds in the same transaction. Keep the event id random so the durable
 * fact cannot be joined back to a replay or its participants. */
export async function recordGameCompletion(
  db: Queryable,
  input: {
    occurredAt?: number;
    format: Format;
    gameMode: AnalyticsGameMode;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO analytics_events
      (event_id, event_type, occurred_at, format, game_mode)
     VALUES ($1, 'game_completed', $2, $3, $4)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      `game:${randomBytes(12).toString("hex")}`,
      input.occurredAt ?? Date.now(),
      input.format,
      input.gameMode,
    ],
  );
}
