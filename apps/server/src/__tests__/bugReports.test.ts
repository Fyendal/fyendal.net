import { beforeEach, describe, expect, it } from "vitest";
import { cardData, decklists, scripts } from "@fyendal/cards";
import { createGame } from "@fyendal/engine";
import { createBugReport } from "../bugReports.js";
import type { Queryable } from "../db.js";
import { encodePersistedState } from "../persistedState.js";
import { freshDb } from "./testdb.js";

let db: Queryable;
let userId: number;

beforeEach(async () => {
  db = await freshDb();
  const user = await db.query(
    `INSERT INTO users (username, username_lc, pass_hash, created_at)
     VALUES ('Reporter', 'reporter', 'hash', 1) RETURNING id`,
  );
  userId = Number(user.rows[0]!.id);
  const state = encodePersistedState(createGame({
    decklists: [decklists.rhinar, decklists.dorinthea],
    seed: 41,
    cards: cardData,
    scripts,
  }), "rules-a");
  await db.query(
    `INSERT INTO rooms
      (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at, status, winner)
     VALUES ('ABC123', 'classic-battles', '[]', $1, NULL, 'rules-a', 2, 1, NULL, 'playing', NULL)`,
    [JSON.stringify(state)],
  );
  await db.query(
    `INSERT INTO room_seats (room_code, seat, user_id, token_hash, username)
     VALUES ('ABC123', 0, $1, $2, 'Reporter')`,
    [userId, "a".repeat(64)],
  );
  await db.query(
    "INSERT INTO room_history (room_code, version, state) VALUES ('ABC123', 1, $1)",
    [JSON.stringify(state)],
  );
});

describe("bug reports", () => {
  it("captures a durable, traceable room snapshot for a seated player", async () => {
    const result = await createBugReport(
      db,
      userId,
      "abc123",
      "The combat chain resolved with the wrong damage.",
    );
    expect(result).toMatchObject({ ok: true });

    const { rows } = await db.query(
      `SELECT reporter_user_id, room_code, room_version, ruleset_version,
              description, trace
       FROM bug_reports`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reporter_user_id: userId,
      room_code: "ABC123",
      room_version: 2,
      ruleset_version: "rules-a",
      description: "The combat chain resolved with the wrong damage.",
      trace: {
        version: 1,
        room: { code: "ABC123", version: 2, reporterSeat: 0 },
        history: [{ version: 1 }],
      },
    });

    await db.query("DELETE FROM rooms WHERE code = 'ABC123'");
    expect((await db.query("SELECT id FROM bug_reports")).rows).toHaveLength(1);
  });

  it("rejects non-members and out-of-bounds descriptions", async () => {
    await expect(createBugReport(db, userId + 1, "ABC123", "A valid description."))
      .resolves.toEqual({ ok: false, error: "room not found" });
    await expect(createBugReport(db, userId, "ABC123", "too short"))
      .resolves.toEqual({ ok: false, error: "invalid description" });
  });
});
