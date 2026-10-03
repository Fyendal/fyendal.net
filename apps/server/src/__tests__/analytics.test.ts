import { describe, expect, it } from "vitest";
import { recordGameCompletion, recordGamePlayers } from "../analytics.js";
import { freshDb } from "./testdb.js";

describe("anonymous product analytics", () => {
  it("counts each human player once per UTC game-start day and deletes account activity", async () => {
    const db = await freshDb();
    const users = await db.query(`INSERT INTO users (username, username_lc, pass_hash, created_at)
      VALUES ('Alice', 'alice', 'hash', 1), ('Bob', 'bob', 'hash', 1) RETURNING id`);
    const alice = Number(users.rows[0]!.id);
    const bob = Number(users.rows[1]!.id);
    const firstDay = Date.UTC(2026, 9, 2);

    await recordGamePlayers(db, [alice, bob], firstDay + 1);
    await recordGamePlayers(db, [alice, undefined], firstDay + 2);
    await recordGamePlayers(db, [alice, alice], firstDay + 3);
    await recordGamePlayers(db, [alice], firstDay + 86_400_001);

    expect((await db.query("SELECT day_utc, user_id FROM daily_game_players ORDER BY day_utc, user_id")).rows)
      .toEqual([
        { day_utc: firstDay, user_id: alice },
        { day_utc: firstDay, user_id: bob },
        { day_utc: firstDay + 86_400_000, user_id: alice },
      ]);
    await db.query("DELETE FROM users WHERE id = $1", [alice]);
    expect((await db.query("SELECT day_utc, user_id FROM daily_game_players")).rows)
      .toEqual([{ day_utc: firstDay, user_id: bob }]);
  });
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
