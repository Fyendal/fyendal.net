import { beforeEach, describe, expect, it } from "vitest";
import { precon } from "@fyendal/cards";
import { PgRoomStore } from "../store.js";
import type { Queryable } from "../db.js";
import { freshDb } from "./testdb.js";

let db: Queryable;
let store: PgRoomStore;
beforeEach(async () => {
  db = await freshDb();
  store = new PgRoomStore(db, "rules-a");
});

describe("changing decks while the seat is open", () => {
  it("swaps the seat's deck and hero before an opponent joins", async () => {
    const host = await store.createRoom("cc", { deckId: "precon-asb" }, "private");
    const r = await store.changeDeck(host.code, { token: host.token }, { deckId: "precon-asr", deckName: "ASR" });
    expect(r).toMatchObject({ ok: true });
    const seat = (await store.getRoom(host.code))!.seats[0]!;
    expect(seat).toMatchObject({ deckId: "precon-asr", deckName: "ASR", heroId: precon("precon-asr")!.pool.heroId });
  });

  it("moves a matchmaking search to the new deck", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('Searcher','searcher','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const opened = await store.queueForMatch("cc", {
      userId, username: "Searcher", deckId: "precon-asb", cardPoolMode: "legal",
    });
    if (!opened.ok || opened.kind !== "opened") throw new Error("queue did not open a room");
    const seat = await store.joinRoom(opened.code, undefined, { allowPlayer: true, userId });
    if (!seat.ok || seat.kind !== "player") throw new Error("reclaim failed");
    const credentials = { token: seat.token, userId };

    expect(await store.changeDeck(opened.code, credentials, { deckId: "precon-asr", deckName: "ASR" }))
      .toMatchObject({ ok: true });
    const entry = await db.query("SELECT deck_id, deck_name FROM matchmaking_entries WHERE user_id = $1", [userId]);
    expect(entry.rows[0]).toEqual({ deck_id: "precon-asr", deck_name: "ASR" });
    expect((await store.getRoom(opened.code))!.seats[0]).toMatchObject({
      deckId: "precon-asr", heroId: precon("precon-asr")!.pool.heroId, fromQueue: true,
    });

    await db.query("DELETE FROM matchmaking_entries WHERE user_id = $1", [userId]);
    expect(await store.changeDeck(opened.code, credentials, { deckId: "precon-asb", deckName: "ASB" }))
      .toEqual({ ok: false, error: "this search has already ended" });
    expect((await store.getRoom(opened.code))!.seats[0]).toMatchObject({ deckId: "precon-asr" });
  });

  it("locks the deck once an opponent joins", async () => {
    const host = await store.createRoom("cc", { deckId: "precon-asb" }, "private");
    await store.markPresent(host.code, host.token, "deck-host");
    const joined = await store.joinRoom(host.code, undefined, { allowPlayer: true, deckId: "precon-asr" });
    expect(joined).toMatchObject({ ok: true, kind: "player" });
    expect(await store.changeDeck(host.code, { token: host.token }, { deckId: "precon-asr", deckName: "ASR" }))
      .toEqual({ ok: false, error: "decks lock once an opponent joins" });
    expect(await store.friendInviteRoom(host.code, { token: host.token }))
      .toEqual({ ok: false, error: "room is full" });
  });

  it("describes an open invite or matchmaking room for a friend invite", async () => {
    const host = await store.createRoom("cc", { deckId: "precon-asb" }, "private", "future");
    expect(await store.friendInviteRoom(host.code, { token: host.token }))
      .toEqual({ ok: true, room: { code: host.code, format: "cc", cardPoolMode: "future" } });
    const search = await store.createRoom("cc", { deckId: "precon-asb", fromQueue: true });
    expect(await store.friendInviteRoom(search.code, { token: search.token }))
      .toMatchObject({ ok: true, room: { code: search.code } });
    expect(await store.friendInviteRoom(host.code, { token: "nope" }))
      .toEqual({ ok: false, error: "not a player in this room" });
  });
});
