import { describe, expect, it } from "vitest";
import { recordGameCompletion } from "../analytics.js";
import { freshDb } from "./testdb.js";

describe("anonymous product analytics", () => {
  it("records a completed game without retaining its replay id", async () => {
    const db = await freshDb();
    await recordGameCompletion(db, {
      occurredAt: 1_700_000_000_000,
      format: "cc" as const,
      gameMode: "bot" as const,
    });

    const rows = (await db.query(
      `SELECT event_id, event_type, occurred_at, format, game_mode
       FROM analytics_events`,
    )).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: "game_completed",
      occurred_at: 1_700_000_000_000,
      format: "cc",
      game_mode: "bot",
    });
    expect(rows[0]!.event_id).toMatch(/^game:[a-f0-9]{24}$/);
    expect(rows[0]!.event_id).not.toContain("replay-1");
  });
});
