import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "../db.js";
import { freshDb } from "./testdb.js";

let db: Queryable;

beforeEach(async () => {
  db = await freshDb();
  await db.query(
    `INSERT INTO leagues (id, name, format, status, time_zone, max_players, matches_per_week, pairing_seed, created_at)
     VALUES ('lg', 'Friends', 'cc', 'season', 'America/New_York', 8, 2, 'seed', 1)`,
  );
});

async function user(username: string): Promise<number> {
  const { rows } = await db.query(
    "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ($1, $2, 'hash', 1) RETURNING id",
    [username, username.toLowerCase()],
  );
  return Number(rows[0].id);
}

async function member(memberId: number, userId: number): Promise<void> {
  await db.query(
    `INSERT INTO league_members (league_id, member_id, user_id, username, time_zone, availability, status, joined_at)
     VALUES ('lg', $1, $2, 'name', 'UTC', '[]', 'active', 1)`,
    [memberId, userId],
  );
}

describe("league schema", () => {
  it("keeps other members' history when an account is deleted", async () => {
    const alice = await user("alice");
    const bob = await user("bob");
    await member(1, alice);
    await member(2, bob);
    await db.query(
      `INSERT INTO league_matches (id, league_id, stage, week, member_a, member_b, status, winner, result, deadline_at, created_at)
       VALUES ('m1', 'lg', 'season', 1, 1, 2, 'complete', 1, 'played', 10, 1)`,
    );
    await db.query("DELETE FROM users WHERE id = $1", [alice]);
    const { rows } = await db.query("SELECT member_id, user_id FROM league_members ORDER BY member_id");
    expect(rows.map((row) => [row.member_id, row.user_id])).toEqual([[1, null], [2, bob]]);
    expect((await db.query("SELECT winner FROM league_matches")).rows).toEqual([{ winner: 1 }]);
  });

  it("enforces stage, bye, and result shape", async () => {
    await member(1, await user("alice"));
    await member(2, await user("bob"));
    const insert = (values: string) => db.query(
      `INSERT INTO league_matches (id, league_id, stage, week, bracket_slot, member_a, member_b, status, winner, result, deadline_at, created_at)
       VALUES ${values}`,
    );
    await insert("('bye', 'lg', 'season', 1, NULL, 1, NULL, 'complete', 1, 'bye', 10, 1)");
    await insert("('qf', 'lg', 'quarterfinal', NULL, 0, 1, 2, 'unscheduled', NULL, NULL, 10, 1)");
    await expect(insert("('x1', 'lg', 'season', NULL, NULL, 1, 2, 'unscheduled', NULL, NULL, 10, 1)")).rejects.toThrow();
    await expect(insert("('x2', 'lg', 'season', 1, NULL, 1, NULL, 'unscheduled', NULL, NULL, 10, 1)")).rejects.toThrow();
    await expect(insert("('x3', 'lg', 'season', 1, NULL, 1, 2, 'complete', NULL, NULL, 10, 1)")).rejects.toThrow();
    await expect(insert("('x4', 'lg', 'final', NULL, 0, 1, 2, 'complete', 3, 'played', 10, 1)")).rejects.toThrow();
  });

  it("cascades league deletion through members, matches, and actions", async () => {
    await member(1, await user("alice"));
    await db.query("INSERT INTO league_actions (league_id, action, created_at) VALUES ('lg', '{\"kind\":\"start\"}', 1)");
    await db.query("DELETE FROM leagues WHERE id = 'lg'");
    for (const table of ["league_members", "league_matches", "league_actions"]) {
      expect((await db.query(`SELECT 1 FROM ${table}`)).rows).toEqual([]);
    }
  });
});
