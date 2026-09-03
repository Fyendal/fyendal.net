import { describe, expect, it } from "vitest";
import { decodeAccountExportResponse } from "@fyendal/protocol";
import { register } from "../auth.js";
import { deleteAccount, exportAccount } from "../accounts.js";
import type { Queryable } from "../db.js";
import { PgRoomStore } from "../store.js";
import { freshDb } from "./testdb.js";

describe("account deletion races", () => {
  it("exports and cascades pending bot matchmaking state", async () => {
    const db = await freshDb();
    await register(db, "Exported", "password1");
    await register(db, "Candidate", "password1");
    const users = await db.query("SELECT id, username FROM users ORDER BY id");
    const exportedId = Number(users.rows[0]!.id);
    const candidateId = Number(users.rows[1]!.id);
    const store = new PgRoomStore(db, "test-ruleset");
    const candidate = await store.queueForMatch("cc", {
      userId: candidateId,
      username: "Candidate",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      joinedAt: 1,
    });
    if (!candidate.ok || candidate.kind !== "opened") throw new Error("candidate did not open queue room");
    await db.query(
      `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
       SELECT room_code, 'candidate-presence', token_hash, seat, $2::bigint
       FROM room_seats WHERE room_code = $1 AND user_id = $3`,
      [candidate.code, Date.now(), candidateId],
    );
    const offered = await store.queueForMatch("cc", {
      userId: exportedId,
      username: "Exported",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      joinedAt: 2,
      avoidRoomCodes: ["OLD123"],
      pendingBotStart: {
        format: "cc",
        deckId: "precon-asb",
        bot: "ira",
        requestedAt: 3,
      },
    });
    expect(offered).toMatchObject({ ok: true, kind: "matched", code: candidate.code });

    const exported = await exportAccount(db, exportedId);
    expect(exported?.matchmaking).toMatchObject({
      mode: "foreground",
      pendingOfferRoomCode: candidate.code,
      avoidedRoomCodes: ["OLD123"],
      pendingBotStart: {
        bot: "ira",
        candidates: [{ candidateUserId: candidateId, ordinal: 0, attempted: false, skipped: false }],
      },
      offer: { roomCode: candidate.code, opponentUserId: candidateId },
    });
    expect(decodeAccountExportResponse({ ok: true, export: exported })).not.toBeNull();

    await db.query(
      "UPDATE matchmaking_entries SET avoided_room_codes = $2 WHERE user_id = $1",
      [exportedId, JSON.stringify({ corrupt: true })],
    );
    await expect(exportAccount(db, exportedId)).rejects.toThrow("avoided_room_codes is corrupt");

    expect(await deleteAccount(db, exportedId, "password1")).toMatchObject({ status: "deleted" });
    expect((await db.query("SELECT 1 FROM pending_bot_starts WHERE user_id = $1", [exportedId])).rows).toEqual([]);
    expect((await db.query(
      "SELECT 1 FROM pending_bot_start_candidates WHERE starter_user_id = $1 OR candidate_user_id = $1",
      [exportedId],
    )).rows).toEqual([]);
    expect((await db.query(
      "SELECT 1 FROM matchmaking_offers WHERE first_user_id = $1 OR second_user_id = $1",
      [exportedId],
    )).rows).toEqual([]);
  });

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
