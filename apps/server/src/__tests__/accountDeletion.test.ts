import { describe, expect, it } from "vitest";
import { register } from "../auth.js";
import { deleteAccount } from "../accounts.js";
import type { Queryable } from "../db.js";
import { PgRoomStore } from "../store.js";
import { freshDb } from "./testdb.js";

describe("account deletion races", () => {
  it("prevents a deleted cached identity from creating a new seat", async () => {
    const db = await freshDb();
    await register(db, "Raced", "password1");
    const { rows } = await db.query("SELECT id FROM users WHERE username_lc = 'raced'");
    const userId = Number(rows[0].id);
    await db.query("DELETE FROM users WHERE id = $1", [userId]);
    const store = new PgRoomStore(db, "test-ruleset");
    await expect(store.createRoom("classic-battles", {
      userId,
      username: "Raced",
      hero: "rhinar",
    })).rejects.toThrow();
    expect((await db.query("SELECT 1 FROM room_seats WHERE user_id = $1", [userId])).rows).toHaveLength(0);
  });

  it("rolls back a create-room race that reaches the seat FK after account deletion", async () => {
    const db = await freshDb();
    await register(db, "Racing", "password1");
    const { rows } = await db.query("SELECT id FROM users WHERE username_lc = 'racing'");
    const userId = Number(rows[0].id);
    let releaseSeatInsert!: () => void;
    let seatInsertReached!: () => void;
    const seatInsertGate = new Promise<void>((resolve) => { releaseSeatInsert = resolve; });
    const reached = new Promise<void>((resolve) => { seatInsertReached = resolve; });
    const wrap = (target: Queryable): Queryable => ({
      query: async (text, params) => {
        if (text.includes("INSERT INTO room_seats")) {
          seatInsertReached();
          await seatInsertGate;
        }
        return target.query(text, params);
      },
      connect: target.connect
        ? async () => {
            const connection = await target.connect!();
            return { ...wrap(connection), release: connection.release?.bind(connection) };
          }
        : undefined,
    });
    const store = new PgRoomStore(wrap(db), "test-ruleset");
    const creating = store.createRoom("classic-battles", {
      userId,
      username: "Racing",
      hero: "rhinar",
    });
    await reached;

    const result = await deleteAccount(db, userId, "password1");
    expect(result.status).toBe("deleted");
    releaseSeatInsert();
    await expect(creating).rejects.toThrow();
    expect((await db.query("SELECT 1 FROM users WHERE id = $1", [userId])).rows).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM room_seats WHERE user_id = $1", [userId])).rows).toHaveLength(0);
  });
});
