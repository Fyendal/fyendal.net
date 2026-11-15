import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { precon } from "@fyendal/cards";
import type { Queryable } from "../db.js";
import { PgRoomStore, isSandboxRoom, prepViewFor, stateMessage } from "../store.js";
import { freshDb } from "./testdb.js";

let db: Queryable;
let store: PgRoomStore;

beforeEach(async () => {
  db = await freshDb();
  store = new PgRoomStore(db, "rules-a");
});

afterEach(async () => {
  await (db as Queryable & { end(): Promise<void> }).end();
});

const DECK = "precon-asb";
const UNRECORDED_TABLES = [
  "replay_games", "replay_frames", "matches", "match_participants", "hero_records",
  "matchup_records", "user_achievements", "daily_game_players",
] as const;

async function user(name: string): Promise<number> {
  const { rows } = await db.query(
    "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ($1,$2,'hash',1) RETURNING id",
    [name, name.toLowerCase()],
  );
  return Number(rows[0]!.id);
}

async function count(table: string): Promise<number> {
  return Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]!.n);
}

/** A private two-player game played from creation to a concession. */
async function concededPrivateGame(sandbox: boolean): Promise<string> {
  const users = [await user("Alice"), await user("Bob")] as const;
  const host = await store.createRoom("cc", { deckId: DECK, userId: users[0], username: "Alice" }, "private", "legal", sandbox);
  await db.query(
    `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
     SELECT room_code, 'host', token_hash, seat, $2::bigint FROM room_seats WHERE room_code = $1 AND seat = 0`,
    [host.code, Date.now()],
  );
  const joined = await store.joinRoom(host.code, undefined, {
    allowPlayer: true, deckId: DECK, userId: users[1], username: "Bob",
  });
  if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
  const seats = [{ token: host.token, userId: users[0] }, { token: joined.token, userId: users[1] }] as const;
  const room = (await store.getRoom(host.code))!;
  expect(prepViewFor(room, 1).sandbox).toBe(sandbox ? true : undefined);
  expect(await store.chooseFirst(host.code, seats[room.prep!.dieWinner], true)).toMatchObject({ ok: true });
  const pool = precon(DECK)!.pool;
  for (const seat of [0, 1] as const) {
    expect(await store.presentArena(host.code, seats[seat], { weaponIds: pool.weaponIds, equipment: {} }))
      .toMatchObject({ ok: true });
  }
  for (const seat of [0, 1] as const) {
    expect(await store.presentDeck(host.code, seats[seat], { weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck }))
      .toMatchObject({ ok: true });
  }
  const started = (await store.getRoom(host.code))!;
  expect(started.state).not.toBeNull();
  expect(stateMessage(started, 1)).toMatchObject(sandbox ? { sandbox: true } : {});
  if (!sandbox) expect(stateMessage(started, 1)).not.toHaveProperty("sandbox");
  expect(await store.applyIntent(host.code, seats[0], { kind: "concede" })).toMatchObject({ ok: true });
  expect((await store.getRoom(host.code))!.state!.phase).toBe("game-over");
  return host.code;
}

describe("sandbox rooms", () => {
  it("plays a private sandbox game to game over without recording anything", async () => {
    const code = await concededPrivateGame(true);
    const room = (await store.getRoom(code))!;
    expect(room).toMatchObject({ isPrivate: true, sandbox: true });
    expect(isSandboxRoom(room)).toBe(true);
    for (const table of UNRECORDED_TABLES) expect(await count(table), table).toBe(0);
  });

  it("still records a private game without the sandbox switch", async () => {
    const code = await concededPrivateGame(false);
    expect(isSandboxRoom((await store.getRoom(code))!)).toBe(false);
    expect(await count("matches")).toBe(1);
    expect(await count("replay_games")).toBe(1);
    expect(await count("hero_records")).toBeGreaterThan(0);
  });

  it("refuses sandbox on public rooms", async () => {
    const userId = await user("Alice");
    await expect(store.createRoom("cc", { deckId: DECK, userId, username: "Alice" }, "public", "legal", true))
      .rejects.toThrow("sandbox rooms must be private");
    expect(await count("rooms")).toBe(0);
  });

  it("treats solo rooms as sandbox and bot rooms as recorded", async () => {
    const userId = await user("Soloist");
    const solo = await store.createSoloRoom("cc", { deckId: DECK, username: "Soloist", userId }, { deckId: "precon-asr" });
    const soloRoom = (await store.getRoom(solo.code))!;
    expect(soloRoom.sandbox).toBe(false);
    expect(isSandboxRoom(soloRoom)).toBe(true);
    expect(prepViewFor(soloRoom, 0).sandbox).toBeUndefined();

    const botUser = await user("Botter");
    const bot = await store.createBotRoom("cc", { deckId: DECK, username: "Botter", userId: botUser });
    const botRoom = (await store.getRoom(bot.code))!;
    expect(isSandboxRoom(botRoom)).toBe(false);
    expect(prepViewFor(botRoom, 0).sandbox).toBeUndefined();
  });

  it("defaults rooms inserted without the column to not sandbox", async () => {
    await db.query(
      `INSERT INTO rooms (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at, status, winner,
                          is_private, card_pool_mode)
       VALUES ('OLDROM', 'cc', '[]', NULL, NULL, 'rules-a', 0, 1, NULL, 'open', NULL, TRUE, 'legal')`,
    );
    expect((await db.query("SELECT sandbox FROM rooms WHERE code = 'OLDROM'")).rows).toEqual([{ sandbox: false }]);
    expect((await store.getRoom("OLDROM"))!.sandbox).toBe(false);
  });
});
