import { beforeEach, describe, expect, it } from "vitest";
import { decklists, precon, preconsForFormat, silverAgePrecon } from "@fyendal/cards";
import { legalIntents } from "@fyendal/engine";
import { decodeServerMessage, replayFileViews } from "@fyendal/protocol";
import type { PresentedDeck } from "@fyendal/shared";
import type { SeatCredentials } from "../store.js";
import type { Queryable } from "../db.js";
import { finalizeReplay, getReplay, listReplays } from "../replays.js";
import {
  PgRoomStore,
  PRESENCE_TIMEOUT_MS,
  dehydrateState,
  hashReconnectToken,
  prepViewFor,
  stateMessage,
} from "../store.js";
import { freshDb } from "./testdb.js";
import { getAchievements } from "../achievements.js";

let db: Queryable;
let store: PgRoomStore;

beforeEach(async () => {
  db = await freshDb();
  store = new PgRoomStore(db, "rules-a");
});

async function markStoredSeatPresent(
  code: string,
  seat: 0 | 1,
  leaseId = `test-seat-${seat}`,
): Promise<void> {
  await db.query(
    `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
     SELECT room_code, $3, token_hash, seat, $4::bigint
     FROM room_seats WHERE room_code = $1 AND seat = $2`,
    [code, seat, leaseId, Date.now()],
  );
}

async function fullRoom(): Promise<{ code: string; tokens: [string, string] }> {
  const host = await store.createRoom("classic-battles", { hero: "rhinar" });
  await markStoredSeatPresent(host.code, 0);
  const joined = await store.joinRoom(host.code, undefined, { allowPlayer: true, hero: "dorinthea" });
  if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
  await db.query("DELETE FROM room_presence WHERE room_code = $1", [host.code]);
  return { code: host.code, tokens: [host.token, joined.token] };
}

async function matchedRoom(): Promise<{
  code: string;
  userIds: [number, number];
  tokens: [string, string];
}> {
  const users = await db.query(
    `INSERT INTO users (username, username_lc, pass_hash, created_at)
     VALUES ('MatchA','matcha','hash',1), ('MatchB','matchb','hash',2)
     RETURNING id`,
  );
  const userIds = [Number(users.rows[0]!.id), Number(users.rows[1]!.id)] as [number, number];
  const opened = await store.queueForMatch("classic-battles", {
    userId: userIds[0], username: "MatchA", hero: "rhinar", cardPoolMode: "legal",
  });
  if (!opened.ok || opened.kind !== "opened") throw new Error("queue did not open a room");
  await markStoredSeatPresent(opened.code, 0);
  const matched = await store.queueForMatch("classic-battles", {
    userId: userIds[1], username: "MatchB", hero: "dorinthea", cardPoolMode: "legal",
  });
  if (!matched.ok || matched.kind !== "matched") throw new Error("match failed");
  const joinedA = await store.joinRoom(matched.code, undefined, { allowPlayer: true, userId: userIds[0] });
  const joinedB = await store.joinRoom(matched.code, undefined, { allowPlayer: true, userId: userIds[1] });
  if (!joinedA.ok || joinedA.kind !== "player" || !joinedB.ok || joinedB.kind !== "player") {
    throw new Error("match reclaim failed");
  }
  return { code: matched.code, userIds, tokens: [joinedA.token, joinedB.token] };
}

async function searchingBot() {
  const user = await db.query(
    `INSERT INTO users (username, username_lc, pass_hash, created_at)
     VALUES ('SearchingBot','searchingbot','hash',1) RETURNING id`,
  );
  const userId = Number(user.rows[0]!.id);
  const queued = await store.queueForMatch("cc", {
    userId, username: "SearchingBot", deckId: "precon-asb", cardPoolMode: "legal",
    pendingBotStart: { format: "cc", deckId: "precon-asb", bot: "ira", requestedAt: Date.now() },
  });
  if (!queued.ok || queued.kind !== "opened") throw new Error("missing search opener");
  const source = await store.startPendingBotPractice(userId);
  if (!source) throw new Error("missing bot practice");
  await store.markPresent(source.code, source.token, "searching-bot", 0, userId);
  return { userId, source, retainedCode: queued.code };
}

async function pendingBotOffer(): Promise<{
  offerCode: string;
  firstBotCode: string;
  userIds: [number, number];
  pendingToken: string;
}> {
  const users = await db.query(
    `INSERT INTO users (username, username_lc, pass_hash, created_at)
     VALUES ('BotOfferA','botoffera','hash',1), ('BotOfferB','botofferb','hash',2)
     RETURNING id`,
  );
  const userIds = [Number(users.rows[0]!.id), Number(users.rows[1]!.id)] as [number, number];
  const firstQueue = await store.queueForMatch("cc", {
    userId: userIds[0],
    username: "BotOfferA",
    deckId: "precon-asb",
    cardPoolMode: "legal",
    joinedAt: 10,
    pendingBotStart: {
      format: "cc",
      deckId: "precon-asb",
      bot: "ira",
      requestedAt: 10,
    },
  });
  if (!firstQueue.ok || firstQueue.kind !== "opened") throw new Error("first bot queue did not open");
  const firstBot = await store.startPendingBotPractice(userIds[0]);
  if (!firstBot) throw new Error("first bot practice did not start");
  await markStoredSeatPresent(firstBot.code, 0, "first-bot-source");
  const matched = await store.queueForMatch("cc", {
    userId: userIds[1],
    username: "BotOfferB",
    deckId: "precon-asb",
    cardPoolMode: "legal",
    joinedAt: 20,
    pendingBotStart: {
      format: "cc",
      deckId: "precon-asb",
      bot: "ira",
      requestedAt: 20,
    },
  });
  if (!matched.ok || matched.kind !== "matched") throw new Error("second bot queue did not match");
  const joined = await store.joinRoom(matched.code, undefined, {
    allowPlayer: true,
    userId: userIds[1],
    username: "BotOfferB",
  });
  if (!joined.ok || joined.kind !== "player") throw new Error("pending bot starter did not join offer");
  return {
    offerCode: matched.code,
    firstBotCode: firstBot.code,
    userIds,
    pendingToken: joined.token,
  };
}

async function startGame(code: string, tokens: [string, string]): Promise<void> {
  const room = await store.getRoom(code);
  const winner = room!.prep!.dieWinner;
  const chosen = await store.chooseFirst(code, { token: tokens[winner] }, true);
  if (!chosen.ok || chosen.started) throw new Error("turn order was not recorded before ready-up");
  await lockClassicArenas(code, tokens);
  for (const seat of [0, 1] as const) {
    const deck = decklists[room!.seats[seat]!.hero!];
    const result = await store.presentDeck(code, { token: tokens[seat] }, {
      weaponIds: deck.weaponIds,
      equipment: deck.equipment,
      deck: deck.deck,
    });
    if (!result.ok) throw new Error(result.error);
  }
  if (!(await store.getRoom(code))?.state) throw new Error("game did not start");
}

async function chooseBotTurn(
  code: string,
  token: string,
  userId: number,
  humanFirst = false,
): Promise<void> {
  const chosen = await store.chooseFirst(code, { token, userId }, humanFirst);
  if (!chosen.ok || chosen.started) throw new Error("bot turn order was not recorded before ready-up");
}

async function lockClassicArenas(code: string, tokens: readonly [string, string]): Promise<void> {
  const room = (await store.getRoom(code))!;
  for (const seat of [0, 1] as const) {
    const deck = decklists[room.seats[seat]!.hero!];
    const result = await store.presentArena(code, { token: tokens[seat], userId: room.seats[seat]?.userId }, {
      weaponIds: deck.weaponIds, equipment: deck.equipment,
    });
    if (!result.ok) throw new Error(result.error);
  }
}

/** Convenience for unrelated bot-game tests; both commands still use the real store. */
async function presentBotDeck(target: PgRoomStore, code: string, credentials: SeatCredentials, deck: PresentedDeck) {
  const locked = await target.presentArena(code, credentials, { weaponIds: deck.weaponIds, equipment: deck.equipment });
  if (!locked.ok) throw new Error(locked.error);
  return target.presentDeck(code, credentials, deck);
}

function normalizedSql(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function tracedStore(queries: string[]): PgRoomStore {
  const tracedDb: Queryable = {
    query: async (text, params) => {
      queries.push(normalizedSql(text));
      return db.query(text, params);
    },
  };
  return new PgRoomStore(tracedDb, "rules-a");
}

async function rawSeats(code: string): Promise<Record<string, unknown>[]> {
  return (await db.query(
    `SELECT seat, user_id, token_hash, username, hero, hero_id, deck_id, deck_name,
            from_queue, ready, presented, last_action_at, controller
     FROM room_seats WHERE room_code = $1 ORDER BY seat`,
    [code],
  )).rows;
}

function seatDml(queries: string[]): string[] {
  return queries.filter((query) =>
    query.startsWith("INSERT INTO room_seats") ||
    query.startsWith("UPDATE room_seats") ||
    query.startsWith("DELETE FROM room_seats")
  );
}

function replayDml(queries: string[]): string[] {
  return queries.filter((query) =>
    query.startsWith("INSERT INTO replay_frames") ||
    query.startsWith("DELETE FROM replay_frames") ||
    query.startsWith("UPDATE replay_games")
  );
}

describe("PgRoomStore storage", () => {
  it("persists mutual draw offers and finishes a drawn game and replay", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    expect((await store.applyIntent(code, { token: tokens[0] }, { kind: "offer-draw" })).ok).toBe(true);
    const offered = await store.getRoom(code);
    expect(offered?.state?.drawOfferSeat).toBe(0);
    expect(offered?.state?.phase).not.toBe("game-over");
    expect(stateMessage(offered!, 1)?.type).toBe("state");
    expect((await store.applyIntent(code, { token: tokens[1] }, { kind: "accept-draw" })).ok).toBe(true);
    const finished = await store.getRoom(code);
    expect(finished?.state).toMatchObject({ phase: "game-over", winner: null });
    expect(finished?.state?.drawOfferSeat).toBeUndefined();
    expect((await db.query("SELECT status, winner FROM rooms WHERE code = $1", [code])).rows[0]).toMatchObject({
      status: "finished", winner: null,
    });
    const replay = (await db.query("SELECT id, status, winner FROM replay_games WHERE room_code = $1 ORDER BY created_at DESC LIMIT 1", [code])).rows[0];
    expect(replay).toMatchObject({ status: "finalizing", winner: null });
  });

  it("persists and advertises a room's card-pool mode", async () => {
    const created = await store.createRoom(
      "cc",
      { deckId: "precon-asb", username: "FutureHost" },
      "public",
      "future",
    );
    await markStoredSeatPresent(created.code, 0);
    expect((await store.getRoom(created.code))?.cardPoolMode).toBe("future");
    expect(await store.roomInvite(created.code)).toMatchObject({ cardPoolMode: "future" });
    expect(await store.listRooms()).toEqual([
      expect.objectContaining({ code: created.code, cardPoolMode: "future" }),
    ]);
  });

  it("does not seat a player whose deck is illegal for the room", async () => {
    const created = await store.createRoom("cc", { deckId: "precon-asb" });
    await markStoredSeatPresent(created.code, 0);
    const joined = await store.joinRoom(created.code, undefined, {
      allowPlayer: true,
      deckId: "precon-aaz",
    });

    expect(joined).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        "Azalea, Ace in the Hole has Living Legend status and is not legal in Classic Constructed",
      ),
    });
    expect((await store.getRoom(created.code))?.seats[1]).toBeNull();
  });

  it("keeps an absent opener reclaimable without advertising or refilling it", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('AbsentHost','absenthost','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createRoom("classic-battles", {
      hero: "rhinar",
      username: "AbsentHost",
      userId,
    });

    expect(await store.listRooms()).toEqual([]);
    expect(await store.stats()).toMatchObject({ openRooms: 0 });
    expect(await store.listRooms(userId)).toEqual([
      expect.objectContaining({ code: created.code, yours: true }),
    ]);
    await expect(store.joinRoom(created.code, undefined, {
      allowPlayer: true,
      hero: "dorinthea",
    })).resolves.toEqual({ ok: false, error: "room host is disconnected" });

    await markStoredSeatPresent(created.code, 0);
    expect(await store.listRooms()).toEqual([
      expect.objectContaining({ code: created.code }),
    ]);
    expect(await store.stats()).toMatchObject({ openRooms: 1 });
    await expect(store.joinRoom(created.code, undefined, {
      allowPlayer: true,
      hero: "dorinthea",
    })).resolves.toMatchObject({ ok: true, kind: "player", seat: 1 });
  });

  it("keeps private rooms out of discovery while allowing capability-code joins", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('PrivateHost','privatehost','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const privateRoom = await store.createRoom(
      "classic-battles",
      { hero: "rhinar", username: "PrivateHost", userId },
      "private",
    );
    const publicRoom = await store.createRoom("classic-battles", { hero: "rhinar" });
    await markStoredSeatPresent(privateRoom.code, 0, "private-host");
    await markStoredSeatPresent(publicRoom.code, 0, "public-host");

    expect((await store.listRooms()).map((room) => room.code)).toEqual([publicRoom.code]);
    const ownerRooms = await store.listRooms(userId);
    expect(ownerRooms).toHaveLength(2);
    expect(ownerRooms).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: privateRoom.code, yours: true }),
      expect.objectContaining({ code: publicRoom.code }),
    ]));
    expect((await store.listRooms(userId + 1)).map((room) => room.code)).toEqual([publicRoom.code]);
    expect(await store.stats()).toMatchObject({ openRooms: 1 });
    expect(await store.roomInvite(privateRoom.code, userId)).toEqual({
      code: privateRoom.code,
      format: "classic-battles",
      yours: true,
    });

    const joined = await store.joinRoom(privateRoom.code, undefined, {
      allowPlayer: true,
      hero: "dorinthea",
    });
    expect(joined).toMatchObject({ ok: true, kind: "player", seat: 1 });
    expect(await store.roomInvite(privateRoom.code)).toMatchObject({ spectateOnly: true });
  });

  it("durably seats, sideboards, equips, and advances a Briar bot", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('BotOwner','botowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("silver-age", {
      deckId: "precon-svi",
      username: "BotOwner",
      userId,
    }, "open");
    await db.query("UPDATE rooms SET prep = $2 WHERE code = $1", [
      created.code,
      JSON.stringify({ rolls: [1, 6], dieWinner: 1, startPlayer: null, arenas: [null, null] }),
    ]);
    let room = await store.getRoom(created.code);
    expect(room?.seats[1]).toMatchObject({
      controller: "bot",
      username: "Briar Bot",
      deckId: "bot-briar-broccoli",
    });
    expect(prepViewFor(room!, 0).botGame).toBe(true);

    const viserai = silverAgePrecon("precon-svi")!.pool;
    const presented = {
      weaponIds: viserai.weaponIds.slice(0, 1),
      equipment: {},
      deck: viserai.deck.slice(0, 40),
    };
    expect(await store.presentDeck(
      created.code,
      { token: created.token, userId },
      presented,
    )).toEqual({ ok: false, error: "choose who goes first before readying up" });
    await chooseBotTurn(created.code, created.token, userId);
    const prepQueries: string[] = [];
    const ready = await presentBotDeck(tracedStore(prepQueries),
      created.code,
      { token: created.token, userId },
      presented,
    );
    expect(ready.ok).toBe(true);
    expect(seatDml(prepQueries)).toHaveLength(2);
    expect(seatDml(prepQueries).every((query) =>
      query.includes("UPDATE room_seats SET user_id = $3")
    )).toBe(true);
    room = await store.getRoom(created.code);
    const botDeck = room!.seats[1]!.presented!;
    expect(botDeck).toMatchObject({
      weaponIds: ["SBA003"],
      equipment: {
        head: "PEN093",
        chest: "SBL005",
        arms: "SBA008",
        legs: "SBA009",
      },
    });
    expect(botDeck.deck).not.toContain("SBA030");
    expect(botDeck.deck).not.toContain("SBA031");
    expect(botDeck.deck.filter((id) => id === "OMN083")).toHaveLength(2);

    expect(room!.prep).toMatchObject({ dieWinner: 1, startPlayer: 1 });
    expect(room!.state).not.toBeNull();
    room = await store.getRoom(created.code);
    expect(room!.state).not.toBeNull();
    expect(room!.state!.activePlayer).toBe(1);
    const legal = legalIntents(room!.state!, 1).filter((intent) => intent.kind !== "concede" && !intent.kind.endsWith("-draw"));
    const botQueries: string[] = [];
    const applied = await tracedStore(botQueries).applyBotIntent(created.code, room!.version, legal[0]!, {
      credentials: { token: created.token, userId },
      command: { id: "store-bot-command", expectedVersion: room!.version },
    });
    expect(applied.ok).toBe(true);
    expect(seatDml(botQueries)).toEqual([
      "UPDATE room_seats SET last_action_at = $3 WHERE room_code = $1 AND seat = $2",
    ]);

    const ended = await store.deleteBotRoom(created.code, {
      token: created.token,
      userId,
    });
    expect(ended).toMatchObject({ ok: true });
    if (!ended.ok || !ended.replayFinalizationId) throw new Error("bot replay was not finalized");
    expect(ended.replayFinalizationId).toMatch(/^[0-9a-f]{24}$/);
    expect(await store.getRoom(created.code)).toBeNull();
    expect(await finalizeReplay(db, ended.replayFinalizationId)).toBe(true);
    expect(await listReplays(db, userId)).toEqual([
      expect.objectContaining({ yourSeat: 0, winner: null }),
    ]);
    const replay = await getReplay(db, userId, ended.replayFinalizationId);
    expect(replay ? replayFileViews(replay).at(-1)?.winner : undefined)
      .toBeNull();

    const humanRoom = await store.createRoom("classic-battles", {
      hero: "rhinar",
      username: "BotOwner",
      userId,
    });
    expect(await store.deleteBotRoom(humanRoom.code, {
      token: humanRoom.token,
      userId,
    })).toEqual({ ok: false, error: "not a bot game" });
    expect(await store.getRoom(humanRoom.code)).not.toBeNull();
  });

  it("seats Bravo with the Briar matchup plan after the human's first-player choice", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('BravoOwner','bravoowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("silver-age", {
      deckId: "precon-sba",
      username: "BravoOwner",
      userId,
    }, "open", "bravo");
    let room = await store.getRoom(created.code);
    expect(room?.seats[1]).toMatchObject({
      controller: "bot",
      username: "Bravo Bot",
      deckId: "bot-bravo-flarvo",
    });

    const briar = silverAgePrecon("precon-sba")!.pool;
    await chooseBotTurn(created.code, created.token, userId);
    const ready = await presentBotDeck(store, created.code, { token: created.token, userId }, {
      weaponIds: briar.weaponIds.slice(0, 1),
      equipment: {},
      deck: briar.deck.slice(0, 40),
    });
    expect(ready.ok).toBe(true);
    room = await store.getRoom(created.code);
    expect(room!.seats[1]!.presented).toMatchObject({
      weaponIds: ["SLY002", "SBR004"],
      equipment: {
        head: "SBR006",
        chest: "SBR007",
        arms: "SBA007",
        legs: "TCC033",
      },
    });
    expect(room!.seats[1]!.presented!.deck.filter((id) => id === "SBA030")).toHaveLength(2);
    expect(room!.seats[1]!.presented!.deck.filter((id) => id === "SBR016")).toHaveLength(2);
    expect(room!.prep?.startPlayer).toBe(1);
    expect(room!.state).not.toBeNull();
  });

  it("durably seats, sideboards, and presents the Classic Constructed Hala bot", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('HalaOwner','halaowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("cc", {
      deckId: "precon-asb",
      username: "HalaOwner",
      userId,
    });
    let room = await store.getRoom(created.code);
    expect(room).toMatchObject({ format: "cc" });
    expect(room?.seats[1]).toMatchObject({
      controller: "bot",
      username: "Hala Bot",
      deckId: "precon-hala-masterclass",
    });
    expect(prepViewFor(room!, 0).seats[1]).toMatchObject({
      heroName: "Hala, Bladesaint of the Vow",
      connected: true,
    });

    const boltyn = precon("precon-asb")!.pool;
    await chooseBotTurn(created.code, created.token, userId);
    const ready = await presentBotDeck(store,
      created.code,
      { token: created.token, userId },
      { weaponIds: boltyn.weaponIds, equipment: {}, deck: boltyn.deck },
    );
    expect(ready.ok).toBe(true);
    room = await store.getRoom(created.code);
    expect(room!.seats[1]!.presented).toMatchObject({
      heroId: "MPW003",
      weaponIds: ["MPW005"],
      equipment: {
        head: "HNT115",
        chest: "MPW010",
        arms: "AHA005",
        legs: "MPW012",
      },
    });
    expect(room!.seats[1]!.presented!.deck).toHaveLength(64);

    if (!room!.state) {
      const started = await store.chooseFirst(
        created.code,
        { token: created.token, userId },
        false,
      );
      expect(started).toMatchObject({ ok: true, started: true });
      room = await store.getRoom(created.code);
    }
    expect(room!.state).not.toBeNull();
    expect(room!.state!.activePlayer).toBe(1);
  });

  it("seats the selected Classic Constructed Ira bot", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('IraOwner','iraowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("cc", {
      deckId: "precon-asb",
      username: "IraOwner",
      userId,
    }, "legal", "ira");

    const room = await store.getRoom(created.code);
    expect(room?.seats[1]).toMatchObject({
      controller: "bot",
      username: "Ira Bot",
      deckId: "precon-asr",
    });
    expect(prepViewFor(room!, 0).seats[1]).toMatchObject({
      heroName: "Ira, Scarlet Revenger",
      connected: true,
    });
  });

  it("durably seats and sideboards the selected Classic Constructed Cindra bot", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('CindraOwner','cindraowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("cc", {
      deckId: "precon-asb",
      username: "CindraOwner",
      userId,
    }, "legal", "cindra");

    let room = await store.getRoom(created.code);
    expect(room?.seats[1]).toMatchObject({
      controller: "bot",
      username: "Cindra Bot",
      deckId: "bot-cindra-head-jabs",
    });
    expect(prepViewFor(room!, 0).seats[1]).toMatchObject({
      heroName: "Cindra, Dracai of Retribution",
      connected: true,
    });

    const boltyn = precon("precon-asb")!.pool;
    await chooseBotTurn(created.code, created.token, userId);
    const ready = await presentBotDeck(store,
      created.code,
      { token: created.token, userId },
      { weaponIds: boltyn.weaponIds, equipment: {}, deck: boltyn.deck },
    );
    expect(ready.ok).toBe(true);
    room = await store.getRoom(created.code);
    expect(room!.seats[1]!.presented).toMatchObject({
      heroId: "HNT054",
      weaponIds: ["GEM003", "GEM003"],
      equipment: {
        head: "WTR079",
        chest: "UPR084",
        arms: "SUP244",
        legs: "HNT143",
      },
    });
    expect(room!.seats[1]!.presented!.deck).toHaveLength(60);
    expect(room!.seats[1]!.presented!.deck.filter((id) => id === "PEN321")).toHaveLength(3);
    expect(room!.seats[1]!.presented!.deck.filter((id) => id === "ANQ034")).toHaveLength(3);
    expect(room!.prep?.startPlayer).toBe(1);
    expect(room!.state).not.toBeNull();
  });

  it("durably seats and presents the selected Classic Constructed Jarl bot", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('JarlOwner','jarlowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("cc", {
      deckId: "precon-asb",
      username: "JarlOwner",
      userId,
    }, "legal", "jarl");

    let room = await store.getRoom(created.code);
    expect(room?.seats[1]).toMatchObject({
      controller: "bot",
      username: "Jarl Bot",
      deckId: "bot-jarl",
    });
    expect(prepViewFor(room!, 0).seats[1]).toMatchObject({
      heroName: "Jarl Vetreiði",
      connected: true,
    });

    const boltyn = precon("precon-asb")!.pool;
    await chooseBotTurn(created.code, created.token, userId);
    const ready = await presentBotDeck(store,
      created.code,
      { token: created.token, userId },
      { weaponIds: boltyn.weaponIds, equipment: {}, deck: boltyn.deck },
    );
    expect(ready.ok).toBe(true);
    room = await store.getRoom(created.code);
    expect(room!.seats[1]!.presented).toMatchObject({
      heroId: "MPG000",
      weaponIds: ["SLY002", "EVR018"],
      equipment: {
        head: "PEN227",
        chest: "ROS028",
        arms: "AJV006",
        legs: "OMN204",
      },
    });
    expect(room!.seats[1]!.presented!.deck).toHaveLength(67);
  });

  it("round-trips a bot-room state with Plasma Barrel Shot through the wire decoder", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at, early_tester, selected_badge)
       VALUES ('DashOwner','dashowner','hash',1,TRUE,'early-tester') RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("silver-age", {
      deckId: "precon-sda",
      username: "DashOwner",
      userId,
    }, "open");
    const dash = silverAgePrecon("precon-sda")!.pool;
    await chooseBotTurn(created.code, created.token, userId);
    const ready = await presentBotDeck(store,
      created.code,
      { token: created.token, userId },
      {
        weaponIds: ["SDA002"],
        equipment: {},
        deck: dash.deck.slice(0, 40),
      },
    );
    expect(ready.ok).toBe(true);

    let room = await store.getRoom(created.code);
    if (!room!.state) {
      const started = await store.chooseFirst(
        created.code,
        { token: created.token, userId },
        false,
      );
      expect(started).toMatchObject({ ok: true, started: true });
      room = await store.getRoom(created.code);
    }

    const message = stateMessage(room!, 0);
    expect(message).toMatchObject({
      type: "state",
      botGame: true,
      playerProfiles: [
        { username: "DashOwner", badge: "early-tester" },
        { username: expect.stringContaining("Bot"), badge: null },
      ],
    });
    const wire = JSON.parse(JSON.stringify(message)) as unknown;
    expect(decodeServerMessage(wire)).not.toBeNull();
    expect(
      (wire as { view: { players: [{ weapons: Array<Record<string, unknown>> }] } })
        .view.players[0].weapons[0],
    ).not.toHaveProperty("attack");
  });

  it("undoes the human's last action together with the bot's immediate replies", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('UndoOwner','undoowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("silver-age", {
      deckId: "precon-svi",
      username: "UndoOwner",
      userId,
    }, "open");
    const viserai = silverAgePrecon("precon-svi")!.pool;
    await chooseBotTurn(created.code, created.token, userId);
    const ready = await presentBotDeck(store, created.code, { token: created.token, userId }, {
      weaponIds: viserai.weaponIds.slice(0, 1),
      equipment: {},
      deck: viserai.deck.slice(0, 40),
    });
    expect(ready.ok).toBe(true);
    let room = await store.getRoom(created.code);
    if (!room!.state) {
      const started = await store.chooseFirst(
        created.code,
        { token: created.token, userId },
        false,
      );
      expect(started).toMatchObject({ ok: true, started: true });
      room = await store.getRoom(created.code);
    }

    const state = room!.state!;
    await db.query("DELETE FROM room_history WHERE room_code = $1", [created.code]);
    const snapshots = [
      { version: 10, actor: 0, log: "before the human action" },
      { version: 11, actor: 1, log: "before the bot's first reply" },
      { version: 12, actor: 1, log: "before the bot's second reply" },
    ] as const;
    for (const snapshot of snapshots) {
      state.activePlayer = snapshot.actor;
      state.priorityPlayer = snapshot.actor;
      state.pendingDecision = null;
      state.phase = "action";
      state.log = [{ publicText: snapshot.log }];
      await db.query(
        "INSERT INTO room_history (room_code, version, state) VALUES ($1, $2, $3)",
        [created.code, snapshot.version, JSON.stringify(dehydrateState(state, "rules-a"))],
      );
    }
    state.log = [{ publicText: "after the bot replies" }];
    await db.query("UPDATE rooms SET state = $2 WHERE code = $1", [
      created.code,
      JSON.stringify(dehydrateState(state, "rules-a")),
    ]);

    expect((await store.undo(
      created.code,
      { token: created.token, userId },
    )).ok).toBe(true);
    const restored = await store.getRoom(created.code);
    expect(restored!.state!.priorityPlayer).toBe(0);
    expect(restored!.state!.log.map((entry) => entry.publicText)).toEqual([
      "before the human action",
      "⤺ the last action was undone",
    ]);
    expect(restored!.state!.log.at(-1)?.publicPayload?.message).toEqual({
      id: "server.log.undo.last.action",
    });
    expect(await store.getHistory(created.code)).toEqual([]);
  });

  it("stores relational seats and only reconnect-token hashes", async () => {
    const { code, tokens } = await fullRoom();
    const rows = await db.query(
      "SELECT seat, token_hash FROM room_seats WHERE room_code = $1 ORDER BY seat",
      [code],
    );
    expect(rows.rows).toEqual([
      { seat: 0, token_hash: hashReconnectToken(tokens[0]) },
      { seat: 1, token_hash: hashReconnectToken(tokens[1]) },
    ]);
    const serialized = JSON.stringify((await db.query("SELECT * FROM rooms WHERE code = $1", [code])).rows[0]);
    expect(serialized).not.toContain(tokens[0]);
    expect(serialized).not.toContain(tokens[1]);
    expect(serialized).not.toContain('"seats"');
  });

  it("loads seats and presence leases with one authoritative query", async () => {
    const { code, tokens } = await fullRoom();
    const watched = await store.joinRoom(code, undefined, {
      allowPlayer: false,
      spectate: true,
    });
    if (!watched.ok || watched.kind !== "spectator") throw new Error("spectator join failed");
    await store.markPresentBatch([
      { code, token: tokens[0], leaseId: "host-old", seat: 0 },
    ], 100);
    await store.markPresentBatch([
      { code, token: tokens[0], leaseId: "host-new", seat: 0 },
      { code, token: tokens[1], leaseId: "guest", seat: 1 },
      { code, token: watched.token, leaseId: "watcher", seat: null },
    ], 200);

    const queries: string[] = [];
    const room = await tracedStore(queries).getRoom(code);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("json_agg(s ORDER BY s.seat)");
    expect(queries[0]).toContain("json_agg(p ORDER BY p.lease_id)");
    expect(room?.seats.map((seat) => seat?.lastSeenAt)).toEqual([200, 200]);
    expect(room?.spectators).toEqual([
      { tokenHash: hashReconnectToken(watched.token), lastSeenAt: 200 },
    ]);
  });

  it("loads a room with no relational membership from the same aggregate query", async () => {
    const created = await store.createRoom("classic-battles", { hero: "rhinar" });
    await db.query("DELETE FROM room_seats WHERE room_code = $1", [created.code]);
    const queries: string[] = [];

    const room = await tracedStore(queries).getRoom(created.code);

    expect(queries).toHaveLength(1);
    expect(room?.seats).toEqual([null, null]);
    expect(room?.spectators).toEqual([]);
  });

  it("rotates a raw reconnect credential and fences the old token", async () => {
    const { code, tokens } = await fullRoom();
    const before = await rawSeats(code);
    const queries: string[] = [];
    const rejoined = await tracedStore(queries).joinRoom(code, tokens[1], { allowPlayer: true });
    if (!rejoined.ok || rejoined.kind !== "player") throw new Error("reconnect failed");
    expect(rejoined.token).not.toBe(tokens[1]);
    const after = await rawSeats(code);
    expect(after[0]).toEqual(before[0]);
    expect({ ...after[1], token_hash: before[1]!.token_hash }).toEqual(before[1]);
    expect(seatDml(queries)).toHaveLength(1);
    expect(seatDml(queries)[0]).toContain("UPDATE room_seats SET user_id = $3");
    expect(await store.joinRoom(code, tokens[1], { allowPlayer: true })).toMatchObject({
      ok: true,
      kind: "spectator",
    });
    const row = await db.query("SELECT token_hash FROM room_seats WHERE room_code = $1 AND seat = 1", [code]);
    expect(row.rows[0].token_hash).toBe(hashReconnectToken(rejoined.token));
  });

  it("does not let a seat owner spectate their own room", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('WatchingOwner','watchingowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createRoom("classic-battles", { hero: "rhinar", userId });
    const before = await rawSeats(created.code);

    expect(await store.joinRoom(created.code, created.token, {
      allowPlayer: true, userId, spectate: true,
    })).toEqual({ ok: false, error: "already a player in this room" });
    expect((await rawSeats(created.code))[0]!.token_hash).toBe(before[0]!.token_hash);
    expect(await store.joinRoom(created.code, undefined, {
      allowPlayer: true, userId, spectate: true,
    })).toEqual({ ok: false, error: "already a player in this room" });
    expect((await rawSeats(created.code))[0]!.token_hash).toBe(before[0]!.token_hash);
    expect(await store.joinRoom(created.code, created.token, {
      allowPlayer: true, userId,
    })).toMatchObject({ ok: true, kind: "player", seat: 0, reconnected: true });
  });

  it("inserts and deletes only the affected player seat", async () => {
    const host = await store.createRoom("classic-battles", { hero: "rhinar" });
    await markStoredSeatPresent(host.code, 0);
    const hostBefore = (await rawSeats(host.code))[0];
    const queries: string[] = [];
    const measured = tracedStore(queries);
    const joined = await measured.joinRoom(host.code, undefined, {
      allowPlayer: true,
      hero: "dorinthea",
    });
    if (!joined.ok || joined.kind !== "player") throw new Error("join failed");

    expect((await rawSeats(host.code))[0]).toEqual(hostBefore);
    expect(seatDml(queries)).toHaveLength(1);
    expect(seatDml(queries)[0]).toContain("INSERT INTO room_seats");

    queries.length = 0;
    expect(await measured.leaveRoom(host.code, { token: joined.token })).toMatchObject({
      ok: true,
      freedSeat: 1,
    });
    expect(await rawSeats(host.code)).toEqual([hostBefore]);
    expect(seatDml(queries)).toEqual([
      "DELETE FROM room_seats WHERE room_code = $1 AND seat = $2",
    ]);
  });

  it("deletes both memberships when the human leaves a bot room in prep", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('LeavingOwner','leavingowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("cc", {
      deckId: "precon-asb",
      username: "LeavingOwner",
      userId,
    });
    const queries: string[] = [];

    expect(await tracedStore(queries).leaveRoom(created.code, {
      token: created.token,
      userId,
    })).toMatchObject({ ok: true, freedSeat: 0, remaining: null });
    expect(await rawSeats(created.code)).toEqual([]);
    expect(seatDml(queries)).toEqual([
      "DELETE FROM room_seats WHERE room_code = $1 AND seat = $2",
      "DELETE FROM room_seats WHERE room_code = $1 AND seat = $2",
    ]);
  });

  it("persists prep changes only for their seats and stamps both seats at game start", async () => {
    const { code, tokens } = await fullRoom();
    let room = await store.getRoom(code);
    const winner = room!.prep!.dieWinner;
    expect(await store.chooseFirst(code, { token: tokens[winner] }, true)).toMatchObject({
      ok: true,
      started: false,
    });
    await lockClassicArenas(code, tokens);
    const deck0 = decklists[room!.seats[0]!.hero!];
    const queries: string[] = [];
    const measured = tracedStore(queries);

    expect(await measured.presentDeck(code, { token: tokens[0] }, {
      weaponIds: deck0.weaponIds,
      equipment: deck0.equipment,
      deck: deck0.deck,
    })).toMatchObject({ ok: true, started: false });
    let rows = await rawSeats(code);
    expect(rows[0]).toMatchObject({ ready: true, presented: expect.anything() });
    expect(rows[1]).toMatchObject({ ready: false, presented: null });
    expect(seatDml(queries)).toHaveLength(1);
    expect(seatDml(queries)[0]).toContain("UPDATE room_seats SET user_id = $3");

    queries.length = 0;
    expect(await measured.unready(code, { token: tokens[0] })).toMatchObject({ ok: true });
    expect((await rawSeats(code))[0]).toMatchObject({ ready: false, presented: expect.anything() });
    expect(seatDml(queries)).toHaveLength(1);

    await store.presentDeck(code, { token: tokens[0] }, {
      weaponIds: deck0.weaponIds,
      equipment: deck0.equipment,
      deck: deck0.deck,
    });
    room = await store.getRoom(code);
    const deck1 = decklists[room!.seats[1]!.hero!];
    const beforeStart = await rawSeats(code);
    queries.length = 0;
    expect(await measured.presentDeck(code, { token: tokens[1] }, {
      weaponIds: deck1.weaponIds,
      equipment: deck1.equipment,
      deck: deck1.deck,
    })).toMatchObject({
      ok: true,
      started: true,
    });
    rows = await rawSeats(code);
    expect(seatDml(queries)).toHaveLength(2);
    expect(seatDml(queries).some((query) =>
      query.startsWith("UPDATE room_seats SET user_id = $3")
    )).toBe(true);
    expect(seatDml(queries).some((query) =>
      query.startsWith("UPDATE room_seats SET last_action_at = $3")
    )).toBe(true);
    for (const seat of [0, 1] as const) {
      expect(Number(rows[seat]!.last_action_at)).toBeGreaterThan(0);
    }
    expect({ ...rows[0], last_action_at: beforeStart[0]!.last_action_at }).toEqual(beforeStart[0]);
  });

  it("updates only actor activity for an intent and performs no seat write for Undo", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const actor = (room!.state!.pendingDecision?.player ?? room!.state!.priorityPlayer) as 0 | 1;
    const intent = legalIntents(room!.state!, actor).find((candidate) => candidate.kind !== "concede");
    if (!intent) throw new Error("no legal intent");
    const before = await rawSeats(code);
    const queries: string[] = [];
    const measured = tracedStore(queries);

    expect((await measured.applyIntent(code, { token: tokens[actor] }, intent)).ok).toBe(true);
    const afterIntent = await rawSeats(code);
    const other = (1 - actor) as 0 | 1;
    expect(afterIntent[other]).toEqual(before[other]);
    expect({ ...afterIntent[actor], last_action_at: before[actor]!.last_action_at }).toEqual(before[actor]);
    expect(Number(afterIntent[actor]!.last_action_at)).toBeGreaterThanOrEqual(
      Number(before[actor]!.last_action_at),
    );
    expect(seatDml(queries)).toEqual([
      "UPDATE room_seats SET last_action_at = $3 WHERE room_code = $1 AND seat = $2",
    ]);
    expect(replayDml(queries)).toHaveLength(1);
    expect(replayDml(queries)[0]).toContain("SELECT active.id, $2::bigint");

    queries.length = 0;
    expect((await measured.undo(code, { token: tokens[actor] })).ok).toBe(true);
    expect(await rawSeats(code)).toEqual(afterIntent);
    expect(seatDml(queries)).toEqual([]);
    expect(replayDml(queries)).toHaveLength(1);
    expect(replayDml(queries)[0]).toContain("DELETE FROM replay_frames");
  });

  it("does not rewrite seats when claiming an idle victory", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const waitingOn = (room!.state!.pendingDecision?.player ?? room!.state!.activePlayer) as 0 | 1;
    const claimant = (1 - waitingOn) as 0 | 1;
    const before = await rawSeats(code);
    const queries: string[] = [];

    const claimed = await tracedStore(queries).claimVictory(
      code,
      { token: tokens[claimant] },
      Date.now() + 10_000_000_000,
    );
    expect(claimed).toMatchObject({ ok: true });
    if (!claimed.ok) throw new Error(claimed.error);
    expect(claimed.replayFinalizationId).toMatch(/^[0-9a-f]{24}$/);
    expect(await rawSeats(code)).toEqual(before);
    expect(seatDml(queries)).toEqual([]);
    expect(replayDml(queries)).toHaveLength(2);
    expect(replayDml(queries)[0]).toContain("INSERT INTO replay_frames");
    expect(replayDml(queries)[1]).toContain("UPDATE replay_games");
  });

  it("awards the winner when a game-over transition commits", async () => {
    const { code, tokens } = await fullRoom();
    const { rows } = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('WinnerA','winnera','hash',1), ('WinnerB','winnerb','hash',1) RETURNING id`,
    );
    const userIds = rows.map((row) => Number(row.id));
    await startGame(code, tokens);
    for (const seat of [0, 1] as const) {
      await db.query("UPDATE room_seats SET user_id = $3 WHERE room_code = $1 AND seat = $2", [
        code, seat, userIds[seat],
      ]);
    }
    await db.query("INSERT INTO daily_game_players (day_utc, user_id) VALUES (0, $1), (0, $2)", userIds);
    const room = (await store.getRoom(code))!;
    const waitingOn = (room.state!.pendingDecision?.player ?? room.state!.activePlayer) as 0 | 1;
    const winner = (1 - waitingOn) as 0 | 1;
    const claimed = await store.claimVictory(code, { token: tokens[winner], userId: userIds[winner] }, Date.now() + 10_000_000_000);
    expect(claimed.ok).toBe(true);
    const achievements = await getAchievements(db, userIds[winner]!);
    expect(achievements.unlocks.map((item) => item.id)).toEqual(["first-pvp-win", "first-victory"]);
    expect(achievements.percentages.find((item) => item.id === "first-victory")?.percent).toBe(50);
  });

  it("does not rewrite seats for spectator membership", async () => {
    const { code } = await fullRoom();
    const before = await rawSeats(code);
    const queries: string[] = [];
    const measured = tracedStore(queries);
    const joined = await measured.joinRoom(code, undefined, { allowPlayer: false, spectate: true });
    if (!joined.ok || joined.kind !== "spectator") throw new Error("spectator join failed");
    expect(await rawSeats(code)).toEqual(before);
    expect(seatDml(queries)).toEqual([]);

    queries.length = 0;
    expect(await measured.leaveRoom(code, { token: joined.token })).toMatchObject({
      ok: true,
      freedSeat: null,
    });
    expect(await rawSeats(code)).toEqual(before);
    expect(seatDml(queries)).toEqual([]);
  });

  it("rolls back the room update when an expected activity seat is missing", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const actor = (room!.state!.pendingDecision?.player ?? room!.state!.priorityPlayer) as 0 | 1;
    const intent = legalIntents(room!.state!, actor).find((candidate) => candidate.kind !== "concede");
    if (!intent) throw new Error("no legal intent");
    const beforeRoom = (await db.query("SELECT version, state FROM rooms WHERE code = $1", [code])).rows[0];
    const beforeSeats = await rawSeats(code);
    const transactionSql: string[] = [];
    const missingSeatDb: Queryable = {
      query: async (text, params) => {
        const sql = normalizedSql(text);
        transactionSql.push(sql);
        // Model PostgreSQL's transactional writes without relying on pg-mem's
        // incomplete rollback implementation for an injected mid-write error.
        if (sql.startsWith("UPDATE rooms SET spectators=$2")) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("UPDATE room_seats SET last_action_at = $3")) {
          return { rows: [], rowCount: 0 };
        }
        return db.query(text, params);
      },
    };

    expect(await new PgRoomStore(missingSeatDb, "rules-a").applyIntent(
      code,
      { token: tokens[actor] },
      intent,
    )).toEqual({ ok: false, error: "room is busy, try again" });
    expect(transactionSql.filter((sql) => sql === "ROLLBACK")).toHaveLength(5);
    expect(transactionSql).not.toContain("COMMIT");
    expect((await db.query("SELECT version, state FROM rooms WHERE code = $1", [code])).rows[0]).toEqual(beforeRoom);
    expect(await rawSeats(code)).toEqual(beforeSeats);
  });

  it("round-trips current persisted state, registries, undo, and projected logs", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const before = await store.getRoom(code);
    expect(before?.state?.cardsRef).toBeDefined();
    const actor = before!.state!.activePlayer;
    expect((await store.applyIntent(code, { token: tokens[actor]! }, { kind: "pass" })).ok).toBe(true);
    expect((await store.undo(code, { token: tokens[actor]! })).ok).toBe(true);
    const after = await store.getRoom(code);
    expect(after?.state?.log.some((entry) => entry.publicText?.includes("undone"))).toBe(true);
    const message = stateMessage(after!, actor);
    expect(message?.type).toBe("state");
    if (message?.type === "state") expect(message.view.log.some((line) => line.includes("undone"))).toBe(true);
    const raw = await db.query("SELECT state FROM rooms WHERE code = $1", [code]);
    expect(raw.rows[0].state).toMatchObject({ schemaVersion: 1, rulesetVersion: "rules-a" });
    expect(raw.rows[0].state.state).not.toHaveProperty("cardsRef");
    expect(raw.rows[0].state.state).not.toHaveProperty("scriptsRef");
  });

  it("persists ordered cleanup transitions without revealing an opponent's cards", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const state = room!.state!;
    const actor = state.activePlayer as 0 | 1;
    const opponent = (1 - actor) as 0 | 1;
    const chosen = state.players[actor]!.hand[0]!;
    state.phase = "end";
    state.priorityPlayer = actor;
    state.pendingDecision = {
      player: actor,
      kind: "arsenal",
      prompt: "Choose a card for arsenal",
      options: state.players[actor]!.hand.map((card) => String(card.instanceId)),
      cardOptions: state.players[actor]!.hand.map((card) => card.instanceId),
    };
    await db.query("UPDATE rooms SET state = $2 WHERE code = $1", [
      code,
      JSON.stringify(dehydrateState(state, "rules-a")),
    ]);

    expect((await store.applyIntent(
      code,
      { token: tokens[actor] },
      { kind: "choose", optionId: String(chosen.instanceId) },
    )).ok).toBe(true);
    const after = await store.getRoom(code);
    const ownerMessage = stateMessage(after!, actor);
    const opponentMessage = stateMessage(after!, opponent);
    if (!ownerMessage || !opponentMessage
      || ownerMessage.type !== "state" || opponentMessage.type !== "state") {
      throw new Error("expected game state messages");
    }
    expect(ownerMessage.transition?.fromVersion).toBe(room!.version);
    expect(ownerMessage.transition?.events.slice(0, 2)).toEqual([
      expect.objectContaining({
        from: { kind: "hand", seat: actor },
        to: { kind: "arsenal", seat: actor },
        instanceId: chosen.instanceId,
      }),
      expect.objectContaining({
        from: { kind: "deck", seat: actor, position: "top" },
        to: { kind: "hand", seat: actor },
      }),
    ]);
    expect(opponentMessage.transition?.events.slice(0, 2)).toEqual([
      { kind: "move", from: { kind: "hand", seat: actor }, to: { kind: "arsenal", seat: actor }, count: 1 },
      { kind: "move", from: { kind: "deck", seat: actor, position: "top" }, to: { kind: "hand", seat: actor }, count: 1 },
    ]);
    expect((await db.query(
      "SELECT last_transition FROM rooms WHERE code = $1",
      [code],
    )).rows[0]!.last_transition.events).toHaveLength(
      after!.lastTransition!.events.length,
    );
  });

  it("prunes metadata-complete history without loading every snapshot state", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    let room = await store.getRoom(code);
    let actor = (room!.state!.pendingDecision?.player ?? room!.state!.priorityPlayer) as 0 | 1;
    let intent = legalIntents(room!.state!, actor).find((candidate) => candidate.kind !== "concede");
    if (!intent) throw new Error("no legal setup intent");
    expect((await store.applyIntent(code, { token: tokens[actor] }, intent)).ok).toBe(true);

    const queries: string[] = [];
    const tracedDb: Queryable = {
      query: async (text, params) => {
        queries.push(text.replace(/\s+/g, " ").trim());
        return db.query(text, params);
      },
    };
    const tracedStore = new PgRoomStore(tracedDb, "rules-a");
    room = await tracedStore.getRoom(code);
    actor = (room!.state!.pendingDecision?.player ?? room!.state!.priorityPlayer) as 0 | 1;
    intent = legalIntents(room!.state!, actor).find((candidate) => candidate.kind !== "concede");
    if (!intent) throw new Error("no legal measured intent");
    expect((await tracedStore.applyIntent(code, { token: tokens[actor] }, intent)).ok).toBe(true);

    expect(queries.some((query) =>
      query.includes("SELECT version, snapshot_turn, undo_seat FROM room_history")
    )).toBe(true);
    expect(queries.some((query) =>
      query.includes("SELECT version, state FROM room_history")
    )).toBe(false);
  });

  it("groups verified automatic passes into the preceding undo step", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const state = room!.state!;
    const first = state.activePlayer as 0 | 1;
    const second = (1 - first) as 0 | 1;

    // Build a deterministic pass-only priority window. Removing every public
    // and private ability/card source makes the server-side legal-intent check
    // authoritative rather than relying on a client hint.
    for (const player of state.players) {
      player.hand = [];
      player.arsenal = [];
      player.banish = [];
      player.equipment = {};
      player.weapons = [];
      player.board = [];
    }
    state.phase = "layer";
    state.priorityPlayer = first;
    state.stackPasses = 0;
    state.pendingDecision = {
      player: first,
      kind: "priority-window",
      prompt: "Priority — play an instant or pass",
    };
    await db.query("UPDATE rooms SET state = $2 WHERE code = $1", [
      code,
      JSON.stringify(dehydrateState(state, "rules-a")),
    ]);

    // A manual pass is still undoable. The opponent's automatic pass advances
    // the game, but does not replace that meaningful history entry.
    expect((await store.applyIntent(code, { token: tokens[first] }, { kind: "pass" })).ok).toBe(true);
    expect(await store.getHistory(code)).toHaveLength(1);
    expect((await store.applyIntent(
      code,
      { token: tokens[second] },
      { kind: "pass" },
      { autoPass: true },
    )).ok).toBe(true);
    expect(await store.getHistory(code)).toHaveLength(1);

    expect((await store.undo(code, { token: tokens[second] })).ok).toBe(true);
    const undone = await store.getRoom(code);
    expect(undone!.state!.pendingDecision).toMatchObject({
      player: first,
      kind: "priority-window",
    });
  });

  /** Fabricate a deterministic pass-only priority window for `player`. */
  async function forceEmptyPriorityWindow(code: string, player: 0 | 1): Promise<void> {
    const room = await store.getRoom(code);
    const state = room!.state!;
    for (const p of state.players) {
      p.hand = [];
      p.arsenal = [];
      p.banish = [];
      p.equipment = {};
      p.weapons = [];
      p.board = [];
    }
    state.phase = "layer";
    state.priorityPlayer = player;
    state.stackPasses = 0;
    state.pendingDecision = {
      player,
      kind: "priority-window",
      prompt: "Priority — play an instant or pass",
    };
    await db.query("UPDATE rooms SET state = $2 WHERE code = $1", [
      code,
      JSON.stringify(dehydrateState(state, "rules-a")),
    ]);
  }

  /** Fabricate a Runechant trigger window with no playable responses or
   * prevention sources, so shortcut advancement is deterministic. */
  async function forceRunechantWindow(
    code: string,
    player: 0 | 1,
    count = 1,
  ): Promise<void> {
    const room = await store.getRoom(code);
    const state = room!.state!;
    for (const p of state.players) {
      p.hand = [];
      p.arsenal = [];
      p.banish = [];
      p.equipment = {};
      p.weapons = [];
      p.board = [];
    }
    const runechants = Array.from({ length: count }, () => ({
      instanceId: state.nextInstanceId++,
      cardId: "ARC112",
      owner: 0,
    }));
    state.players[0]!.board.push(...runechants);
    state.phase = "layer";
    state.priorityPlayer = player;
    state.stackPasses = 0;
    state.stackResume = "begin-action";
    state.stack = runechants.map((runechant) => ({
      sourceInstanceId: runechant.instanceId,
      seat: 0,
      triggerIndex: 0,
      label: "Destroy Runechant: 1 arcane damage to the opposing hero",
      optional: false,
    }));
    state.pendingDecision = {
      player,
      kind: "priority-window",
      prompt: "Runechant triggers — play an instant or pass",
    };
    await db.query("UPDATE rooms SET state = $2 WHERE code = $1", [
      code,
      JSON.stringify(dehydrateState(state, "rules-a")),
    ]);
  }

  it("auto-passes an empty window server-side when the seat opts in", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const first = room!.state!.activePlayer as 0 | 1;
    const second = (1 - first) as 0 | 1;
    const versionBefore = room!.version;
    await forceEmptyPriorityWindow(code, first);

    // Without a preference the window is left alone (always-pause default).
    const noPref = await store.setPriorityMode(code, { token: tokens[first] }, "always-pause");
    expect(noPref).toMatchObject({ ok: true, autoPassed: false, version: versionBefore });
    let current = await store.getRoom(code);
    expect(current!.state!.pendingDecision).toMatchObject({ player: first, kind: "priority-window" });

    // Toggling auto-pass on inside the window passes immediately, in one commit.
    const opted = await store.setPriorityMode(code, { token: tokens[first] }, "auto-pass");
    expect(opted).toMatchObject({ ok: true, autoPassed: true, version: versionBefore + 1 });
    current = await store.getRoom(code);
    expect(current!.state!.pendingDecision).toMatchObject({ player: second, kind: "priority-window" });
    // The auto-pass wrote no undo snapshot.
    expect(await store.getHistory(code)).toHaveLength(0);
  });

  it("honors priority preferences at the final action-phase window", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const turnPlayer = room!.state!.activePlayer as 0 | 1;
    const opponent = (1 - turnPlayer) as 0 | 1;
    const state = room!.state!;
    const opponentState = state.players[opponent]!;
    opponentState.hand = [];
    opponentState.arsenal = [];
    opponentState.banish = [];
    opponentState.graveyard = [];
    opponentState.board = [];
    opponentState.weapons = [];
    opponentState.equipment = {};
    await db.query("UPDATE rooms SET state = $2 WHERE code = $1", [
      code,
      JSON.stringify(dehydrateState(state, "rules-a")),
    ]);

    // The default always-pause preference preserves the opponent's final
    // priority even when the engine finds no playable response.
    expect((await store.applyIntent(
      code,
      { token: tokens[turnPlayer] },
      { kind: "pass" },
    )).ok).toBe(true);
    let current = await store.getRoom(code);
    expect(current!.state!.pendingDecision).toMatchObject({
      player: opponent,
      kind: "priority-window",
    });
    expect(current!.state!.stackResume).toBe("end-action-phase");
    expect(legalIntents(current!.state!, opponent).every(
      (intent) => intent.kind === "pass" || intent.kind === "concede" || intent.kind.endsWith("-draw"),
    )).toBe(true);

    // Opting into auto-pass immediately takes the same empty window and lets
    // the turn proceed to the turn-player's arsenal decision.
    const opted = await store.setPriorityMode(
      code,
      { token: tokens[opponent] },
      "auto-pass",
    );
    expect(opted).toMatchObject({ ok: true, autoPassed: true });
    current = await store.getRoom(code);
    expect(current!.state!.pendingDecision).toMatchObject({
      player: turnPlayer,
      kind: "arsenal",
    });
  });

  it("deduplicates a retried room command and rejects a different stale command", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const actor = (room!.state!.pendingDecision?.player ?? room!.state!.priorityPlayer) as 0 | 1;
    const command = { id: "command-retry-0001", expectedVersion: room!.version };

    const first = await store.applyIntent(code, { token: tokens[actor] }, { kind: "pass" }, {}, command);
    expect(first).toMatchObject({ ok: true, version: room!.version + 1 });
    const afterFirst = await store.getRoom(code);

    const duplicate = await store.applyIntent(code, { token: tokens[actor] }, { kind: "pass" }, {}, command);
    expect(duplicate).toEqual(first);
    expect((await store.getRoom(code))!.state).toEqual(afterFirst!.state);
    expect((await db.query(
      "SELECT command_id, expected_version, committed_version FROM room_commands WHERE room_code = $1",
      [code],
    )).rows).toEqual([{
      command_id: command.id,
      expected_version: command.expectedVersion,
      committed_version: room!.version + 1,
    }]);

    const stale = await store.applyIntent(
      code,
      { token: tokens[actor] },
      { kind: "pass" },
      {},
      { id: "command-stale-0002", expectedVersion: room!.version },
    );
    expect(stale).toEqual({ ok: false, error: "stale room version" });
    expect((await store.getRoom(code))!.version).toBe(room!.version + 1);
  });

  it("syncs inactive player preferences without advancing the room version", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const credentials = { token: tokens[0] };
    const expectedVersion = room!.version;

    const priority = await store.setPriorityMode(
      code,
      credentials,
      "always-pause",
      { id: "preference-sync-priority", expectedVersion },
    );
    const runechants = await store.setRunechantSkipping(
      code,
      credentials,
      false,
      { id: "preference-sync-runechants", expectedVersion },
    );

    expect(priority).toMatchObject({ ok: true, autoPassed: false, version: expectedVersion });
    expect(runechants).toMatchObject({ ok: true, advanced: false, version: expectedVersion });
    expect((await store.getRoom(code))!.version).toBe(expectedVersion);
  });

  it("chains server auto-passes for both seats inside one commit", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const first = room!.state!.activePlayer as 0 | 1;
    const second = (1 - first) as 0 | 1;
    await forceEmptyPriorityWindow(code, first);
    expect((await store.setPriorityMode(code, { token: tokens[second] }, "auto-pass")).ok).toBe(true);

    // First passes manually; the opponent's empty window is auto-passed by the
    // server within the same commit — one version bump, no intermediate state.
    const versionBefore = (await store.getRoom(code))!.version;
    expect((await store.applyIntent(code, { token: tokens[first] }, { kind: "pass" })).ok).toBe(true);
    const after = await store.getRoom(code);
    expect(after!.version).toBe(versionBefore + 1);
    expect(after!.state!.pendingDecision).not.toMatchObject({ player: second, kind: "priority-window" });
    // Only the manual pass is undoable; the auto-pass folded into its step.
    expect(await store.getHistory(code)).toHaveLength(1);
  });

  it("server-skips only the current Runechant sequence", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    await forceRunechantWindow(code, 0, 2);

    const first = await store.setRunechantSkipping(code, { token: tokens[0] }, true);
    expect(first).toMatchObject({ ok: true, advanced: true });
    expect((await store.getRoom(code))!.state!.pendingDecision).toMatchObject({
      player: 1,
      kind: "priority-window",
    });

    const second = await store.setRunechantSkipping(code, { token: tokens[1] }, true);
    expect(second).toMatchObject({ ok: true, advanced: true });
    const completed = await store.getRoom(code);
    expect(completed!.state!.stack).toHaveLength(0);
    expect(completed!.state!.players[1]!.life).toBe(18);
    expect(await store.getHistory(code)).toHaveLength(0);

    // A later Runechant is a new sequence. A manual first pass must expose
    // the opponent's priority window instead of inheriting their old latch.
    await forceRunechantWindow(code, 0);
    expect((await store.applyIntent(code, { token: tokens[0] }, { kind: "pass" })).ok).toBe(true);
    const later = await store.getRoom(code);
    expect(later!.state!.stack[0]?.label).toContain("Destroy Runechant");
    expect(later!.state!.pendingDecision).toMatchObject({
      player: 1,
      kind: "priority-window",
    });
  });

  it("does not arm Runechant skipping before the seat is presented the choice", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    await forceRunechantWindow(code, 1);
    const versionBefore = (await store.getRoom(code))!.version;

    // Seat 0 cannot pre-arm the shortcut while seat 1 owns the choice.
    expect(await store.setRunechantSkipping(code, { token: tokens[0] }, true)).toMatchObject({
      ok: true,
      advanced: false,
      version: versionBefore,
    });
    expect((await store.getRoom(code))!.seats[0]!.runechantSkip).toBe(false);

    // Passing priority presents the Runechant choice to seat 0; the rejected
    // pre-arm must not consume it automatically.
    expect((await store.applyIntent(code, { token: tokens[1] }, { kind: "pass" })).ok).toBe(true);
    expect((await store.getRoom(code))!.state!.pendingDecision).toMatchObject({
      player: 0,
      kind: "priority-window",
    });
  });

  it("expires Runechant skipping at a non-Runechant trigger boundary", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    await forceRunechantWindow(code, 0);

    // Arm only from seat 0's visible Runechant choice. This passes that
    // window and leaves seat 1 with priority on the same Runechant.
    expect(await store.setRunechantSkipping(code, { token: tokens[0] }, true)).toMatchObject({
      ok: true,
      advanced: true,
    });

    // Insert a different trigger above that Runechant. The first manual pass
    // lets the server observe and expire the latch at this boundary.
    const room = await store.getRoom(code);
    const state = room!.state!;
    state.stack.unshift({
      sourceInstanceId: state.players[0]!.hero.instanceId,
      seat: 0,
      triggerIndex: 99,
      label: "A non-Runechant trigger",
      optional: false,
    });
    state.priorityPlayer = 1;
    state.stackPasses = 0;
    state.pendingDecision = {
      player: 1,
      kind: "priority-window",
      prompt: "A non-Runechant trigger — play an instant or pass",
    };
    await db.query("UPDATE rooms SET state = $2 WHERE code = $1", [
      code,
      JSON.stringify(dehydrateState(state, "rules-a")),
    ]);

    expect((await store.applyIntent(code, { token: tokens[1] }, { kind: "pass" })).ok).toBe(true);
    expect((await store.applyIntent(code, { token: tokens[0] }, { kind: "pass" })).ok).toBe(true);
    const after = await store.getRoom(code);
    expect(after!.state!.stack[0]?.label).toContain("Destroy Runechant");
    expect(after!.state!.pendingDecision).toMatchObject({
      player: 0,
      kind: "priority-window",
    });
  });

  it("leaves empty windows broadcast when the seat chose always-pause", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const first = room!.state!.activePlayer as 0 | 1;
    const second = (1 - first) as 0 | 1;
    await forceEmptyPriorityWindow(code, first);
    expect((await store.setPriorityMode(code, { token: tokens[second] }, "always-pause")).ok).toBe(true);

    expect((await store.applyIntent(code, { token: tokens[first] }, { kind: "pass" })).ok).toBe(true);
    const after = await store.getRoom(code);
    expect(after!.state!.pendingDecision).toMatchObject({ player: second, kind: "priority-window" });
  });

  it("re-applies auto-pass when undo restores an empty window", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const first = room!.state!.activePlayer as 0 | 1;
    const second = (1 - first) as 0 | 1;
    await forceEmptyPriorityWindow(code, first);

    // First passes manually (always-pause); the snapshot of their empty
    // window enters undo history. Only then does first opt into auto-pass.
    expect((await store.applyIntent(code, { token: tokens[first] }, { kind: "pass" })).ok).toBe(true);
    expect((await store.setPriorityMode(code, { token: tokens[first] }, "auto-pass")).ok).toBe(true);

    // Undo restores first's empty window; the server must pass it out in the
    // same commit instead of stranding the seat until a preference resend.
    const versionBefore = (await store.getRoom(code))!.version;
    expect((await store.undo(code, { token: tokens[second] })).ok).toBe(true);
    const after = await store.getRoom(code);
    expect(after!.version).toBe(versionBefore + 1);
    expect(after!.state!.pendingDecision).toMatchObject({ player: second, kind: "priority-window" });
  });

  it("auto-passes the bot's empty windows in the same commit", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('AutoPassBot','autopassbot','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("silver-age", {
      deckId: "precon-svi",
      username: "AutoPassBot",
      userId,
    }, "open");
    const viserai = silverAgePrecon("precon-svi")!.pool;
    const presented = {
      weaponIds: viserai.weaponIds.slice(0, 1),
      equipment: {},
      deck: viserai.deck.slice(0, 40),
    };
    const credentials = { token: created.token, userId };
    await chooseBotTurn(created.code, created.token, userId);
    expect((await presentBotDeck(store, created.code, credentials, presented)).ok).toBe(true);
    if (!(await store.getRoom(created.code))!.state) {
      const started = await store.chooseFirst(created.code, credentials, false);
      expect(started).toMatchObject({ ok: true, started: true });
    }

    // The human (seat 0) holds an empty window and passes manually; the bot's
    // empty follow-up window must auto-pass in the same commit — no runner
    // delay, no intermediate broadcast.
    await forceEmptyPriorityWindow(created.code, 0);
    const versionBefore = (await store.getRoom(created.code))!.version;
    expect((await store.applyIntent(created.code, credentials, { kind: "pass" })).ok).toBe(true);
    const after = await store.getRoom(created.code);
    expect(after!.version).toBe(versionBefore + 1);
    expect(after!.state!.pendingDecision).not.toMatchObject({ player: 1, kind: "priority-window" });
  });

  it.each([
    ["current-turn", 3, "turn 3 start"],
    ["previous-turn", 2, "turn 2 start"],
  ] as const)("restores the beginning snapshot for %s", async (target, expectedTurn, expectedLog) => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const state = room!.state!;
    const snapshots = [
      { version: 10, turn: 1, log: "turn 1 start" },
      { version: 11, turn: 2, log: "turn 2 start" },
      { version: 12, turn: 2, log: "turn 2 later" },
      { version: 13, turn: 3, log: "turn 3 start" },
      { version: 14, turn: 3, log: "turn 3 later" },
    ];
    for (const snapshot of snapshots) {
      state.turn = snapshot.turn;
      state.log = [{ publicText: snapshot.log }];
      await db.query(
        "INSERT INTO room_history (room_code, version, state) VALUES ($1, $2, $3)",
        [code, snapshot.version, JSON.stringify(dehydrateState(state, "rules-a"))],
      );
    }
    state.turn = 3;
    state.log = [{ publicText: "current state" }];
    await db.query("UPDATE rooms SET state = $2 WHERE code = $1", [
      code,
      JSON.stringify(dehydrateState(state, "rules-a")),
    ]);

    expect((await store.undo(code, { token: tokens[0] }, target)).ok).toBe(true);
    const restored = await store.getRoom(code);
    expect(restored!.state!.turn).toBe(expectedTurn);
    expect(restored!.state!.log.map((entry) => entry.publicText)).toEqual([
      expectedLog,
      `⤺ returned to the beginning of turn ${expectedTurn}`,
    ]);
    expect(restored!.state!.log.at(-1)?.publicPayload?.message).toEqual({
      id: "server.log.undo.turn.start",
      values: { turn: expectedTurn },
    });
  });

  it("retains turn-start anchors beyond the rolling undo cap", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const state = room!.state!;
    const actor = state.activePlayer as 0 | 1;

    for (const player of state.players) {
      player.hand = [];
      player.arsenal = [];
      player.banish = [];
      player.equipment = {};
      player.weapons = [];
      player.board = [];
    }
    for (let version = 1; version <= 30; version++) {
      state.turn = version === 1 ? 2 : 3;
      state.log = [{ publicText: `snapshot ${version}` }];
      await db.query(
        "INSERT INTO room_history (room_code, version, state) VALUES ($1, $2, $3)",
        [code, version, JSON.stringify(dehydrateState(state, "rules-a"))],
      );
    }
    state.turn = 3;
    state.phase = "layer";
    state.priorityPlayer = actor;
    state.stackPasses = 0;
    state.pendingDecision = {
      player: actor,
      kind: "priority-window",
      prompt: "Priority — play an instant or pass",
    };
    await db.query("UPDATE rooms SET state = $2, version = 30 WHERE code = $1", [
      code,
      JSON.stringify(dehydrateState(state, "rules-a")),
    ]);

    expect((await store.applyIntent(code, { token: tokens[actor] }, { kind: "pass" })).ok).toBe(true);
    const versions = (await db.query(
      "SELECT version FROM room_history WHERE room_code = $1 ORDER BY version",
      [code],
    )).rows.map((row) => Number(row.version));
    expect(versions).toEqual([1, 2, ...Array.from({ length: 20 }, (_, index) => index + 12)]);
    const metadata = await db.query(
      `SELECT snapshot_turn, undo_seat FROM room_history
       WHERE room_code = $1 ORDER BY version`,
      [code],
    );
    expect(metadata.rows.every((row) =>
      Number.isSafeInteger(Number(row.snapshot_turn)) &&
      (Number(row.undo_seat) === 0 || Number(row.undo_seat) === 1)
    )).toBe(true);
  });

  it("backfills rollback-era history metadata without changing full snapshots", async () => {
    const { code, tokens } = await fullRoom();
    await startGame(code, tokens);
    const room = await store.getRoom(code);
    const state = room!.state!;
    state.turn = 7;
    state.pendingDecision = null;
    state.priorityPlayer = 1;
    const persisted = JSON.stringify(dehydrateState(state, "rules-a"));
    await db.query(
      "INSERT INTO room_history (room_code, version, state) VALUES ($1, $2, $3)",
      [code, 70, persisted],
    );

    expect(await store.backfillHistoryMetadata()).toBe(1);
    const { rows } = await db.query(
      `SELECT state, snapshot_turn, undo_seat FROM room_history
       WHERE room_code = $1 AND version = 70`,
      [code],
    );
    expect(JSON.stringify(rows[0].state)).toBe(persisted);
    expect(rows[0]).toMatchObject({ snapshot_turn: 7, undo_seat: 1 });
    expect(await store.backfillHistoryMetadata()).toBe(0);
  });

  it("rejects malformed persisted JSON instead of guessing another shape", async () => {
    const created = await store.createRoom("classic-battles", { hero: "rhinar" });
    await db.query("UPDATE rooms SET state = $2 WHERE code = $1", [created.code, JSON.stringify({ turn: 1 })]);
    await expect(store.getRoom(created.code)).rejects.toMatchObject({
      name: "CorruptRoomError",
      path: "schemaVersion",
    });
  });

  it("rejects malformed nested seat and presence aggregates", async () => {
    const created = await store.createRoom("classic-battles", { hero: "rhinar" });
    const corruptStore = (field: "seat_rows" | "presence_rows", value: unknown): PgRoomStore => {
      const corruptDb: Queryable = {
        query: async (text, params) => {
          const result = await db.query(text, params);
          if (!normalizedSql(text).startsWith("WITH seat_data") || !result.rows[0]) return result;
          return {
            ...result,
            rows: [{ ...result.rows[0], [field]: value }],
          };
        },
      };
      return new PgRoomStore(corruptDb, "rules-a");
    };

    await expect(corruptStore("seat_rows", {}).getRoom(created.code)).rejects.toMatchObject({
      name: "CorruptRoomError",
      path: "row.seat_rows",
    });
    await expect(corruptStore("seat_rows", [{ seat: 3 }]).getRoom(created.code)).rejects.toMatchObject({
      name: "CorruptRoomError",
      path: "seats[0].seat",
    });
    await expect(corruptStore("presence_rows", [{ token_hash: 42, last_seen_at: 1 }]).getRoom(created.code))
      .rejects.toMatchObject({
        name: "CorruptRoomError",
        path: "presence[0]",
      });
  });

  it("validates stored spectator JSON before presence membership checks", async () => {
    const created = await store.createRoom("classic-battles", { hero: "rhinar" });
    await db.query("UPDATE rooms SET spectators = $2 WHERE code = $1", [
      created.code,
      JSON.stringify([{ tokenHash: 42 }]),
    ]);
    await expect(store.markPresent(created.code, "unknown-token")).rejects.toMatchObject({
      name: "CorruptRoomError",
      path: "row.spectators[0].tokenHash",
    });
  });

  it("uses token-hashed presence leases and expires abandoned rooms", async () => {
    const created = await store.createRoom("classic-battles", { hero: "rhinar" });
    await store.markPresent(created.code, created.token, "socket", 0);
    const lease = await db.query("SELECT token_hash FROM room_presence WHERE room_code = $1", [created.code]);
    expect(lease.rows).toEqual([{ token_hash: hashReconnectToken(created.token) }]);
    await db.query("UPDATE rooms SET gc_at = NULL WHERE code = $1", [created.code]);
    await store.sweepRooms(Date.now() + PRESENCE_TIMEOUT_MS + 1);
    expect((await store.getRoom(created.code))?.gcAt).not.toBeNull();
  });

  it("personalizes lobby membership from room_seats.user_id", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('Owner','owner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0].id);
    const created = await store.createRoom("classic-battles", { hero: "rhinar", userId });
    expect(await store.listRooms(userId)).toEqual([
      expect.objectContaining({ code: created.code, yours: true }),
    ]);
    expect(await store.listRooms(7)).toEqual([]);
    await markStoredSeatPresent(created.code, 0);
    expect((await store.listRooms(7))[0]).not.toHaveProperty("yours");
  });

  it("pairs durable FIFO entries submitted through different store instances", async () => {
    const users = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('QueueA','queuea','hash',1), ('QueueB','queueb','hash',2)
       RETURNING id, username`,
    );
    const firstId = Number(users.rows[0]!.id);
    const secondId = Number(users.rows[1]!.id);
    const otherGateway = new PgRoomStore(db, "rules-a");

    const opened = await store.queueForMatch("classic-battles", {
      userId: firstId,
      username: "QueueA",
      hero: "rhinar",
      cardPoolMode: "legal",
    });
    expect(opened).toMatchObject({ ok: true, kind: "opened", version: 0 });
    if (!opened.ok || opened.kind !== "opened") throw new Error("queue did not open a room");
    await markStoredSeatPresent(opened.code, 0);
    expect(await otherGateway.matchmakingCounts()).toEqual({
      "classic-battles": 1,
      cc: 0,
      "silver-age": 0,
    });

    const matched = await otherGateway.queueForMatch("classic-battles", {
      userId: secondId,
      username: "QueueB",
      hero: "dorinthea",
      cardPoolMode: "legal",
    });
    expect(matched).toMatchObject({ ok: true, kind: "matched", code: opened.code, version: 1 });
    if (!matched.ok || matched.kind !== "matched") throw new Error("match was not created");
    const room = await store.getRoom(matched.code);
    expect(room?.seats.map((seat) => seat?.userId)).toEqual([firstId, secondId]);
    expect(room?.seats.every((seat) => seat?.fromQueue)).toBe(true);
    expect(await store.matchmakingCounts()).toEqual({
      "classic-battles": 0,
      cc: 0,
      "silver-age": 0,
    });
    expect((await db.query(
      "SELECT event_type, subject_user_id, room_code FROM cluster_events WHERE event_type = 'match-ready' ORDER BY subject_user_id",
    )).rows).toEqual([
      { event_type: "match-ready", subject_user_id: firstId, room_code: matched.code },
      { event_type: "match-ready", subject_user_id: secondId, room_code: matched.code },
    ]);
  });

  it("offers an opted-in bot player to the next opted-in bot starter", async () => {
    const users = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('BotQueueA','botqueuea','hash',1), ('BotQueueB','botqueueb','hash',2)
       RETURNING id`,
    );
    const firstId = Number(users.rows[0]!.id);
    const secondId = Number(users.rows[1]!.id);
    const firstQueue = await store.queueForMatch("cc", {
      userId: firstId,
      username: "BotQueueA",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      pendingBotStart: {
        format: "cc",
        deckId: "precon-asb",
        bot: "ira",
        requestedAt: 10,
      },
    });
    if (!firstQueue.ok || firstQueue.kind !== "opened") throw new Error("first bot queue did not open");
    const firstBot = await store.startPendingBotPractice(firstId);
    if (!firstBot) throw new Error("first bot practice did not start");
    await chooseBotTurn(firstBot.code, firstBot.token, firstId);
    const boltyn = precon("precon-asb")!.pool;
    expect(await presentBotDeck(store, firstBot.code, { token: firstBot.token, userId: firstId }, {
      weaponIds: boltyn.weaponIds,
      equipment: {},
      deck: boltyn.deck,
    })).toMatchObject({ ok: true, started: true });
    await markStoredSeatPresent(firstBot.code, 0, "first-bot-source");

    const second = await store.queueForMatch("cc", {
      userId: secondId,
      username: "BotQueueB",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      pendingBotStart: {
        format: "cc",
        deckId: "precon-asb",
        bot: "ira",
        requestedAt: 20,
      },
    });
    expect(second).toMatchObject({ ok: true, kind: "matched", code: firstQueue.code });
    if (!second.ok || second.kind !== "matched") throw new Error("second bot starter was not matched");
    expect(await store.backgroundMatchmakingStatus(firstId)).toMatchObject({
      state: "offer",
      roomCode: firstQueue.code,
      opponent: { username: "BotQueueB" },
    });

    expect(await store.acceptBackgroundMatch(firstId, firstQueue.code)).toMatchObject({ ok: true });
    expect(await store.getRoom(firstBot.code)).not.toBeNull();
    const joined = await store.joinRoom(firstQueue.code, undefined, {
      allowPlayer: true,
      userId: secondId,
      username: "BotQueueB",
    });
    if (!joined.ok || joined.kind !== "player") throw new Error("second player did not reclaim offer seat");
    const beforeCommit = await db.query("SELECT COALESCE(MAX(id), 0) AS id FROM cluster_events");
    expect(await store.acceptMatch(firstQueue.code, { token: joined.token, userId: secondId }))
      .toMatchObject({ ok: true });
    const preservedBot = await store.getRoom(firstBot.code);
    expect(preservedBot).not.toBeNull();
    expect(preservedBot?.state).not.toBeNull();
    expect(preservedBot?.seats[0]?.userId).toBe(firstId);
    expect(preservedBot?.seats[1]?.controller).toBe("bot");
    expect((await db.query(
      "SELECT status FROM replay_games WHERE room_code = $1",
      [firstBot.code],
    )).rows).toEqual([{ status: "recording" }]);
    expect(await store.backgroundMatchmakingStatus(firstId)).toEqual({ state: "inactive" });
    const committedEvents = (await db.query(
      "SELECT event_type, subject_user_id, room_code, payload FROM cluster_events WHERE id > $1 ORDER BY id",
      [Number(beforeCommit.rows[0]!.id)],
    )).rows;
    expect(committedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: "match-handoff",
        subject_user_id: firstId,
        room_code: firstQueue.code,
        payload: { sourceCode: firstBot.code },
      }),
      expect.objectContaining({
        event_type: "match-ready",
        subject_user_id: secondId,
        room_code: firstQueue.code,
      }),
    ]));
    expect(committedEvents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "room", room_code: firstBot.code }),
    ]));
  });

  it("hides search openers, preserves them during practice, and deletes them when search stops", async () => {
    const { userId, source, retainedCode } = await searchingBot();
    expect((await store.listRooms(userId)).filter((room) => room.yours).map((room) => room.code)).toEqual([source.code]);
    expect(await store.listRooms()).toEqual([]);
    await db.query("UPDATE rooms SET gc_at = $2 WHERE code = $1", [retainedCode, Date.now() - 1]);
    await store.sweepRooms();
    expect(await store.getRoom(retainedCode)).not.toBeNull();
    expect(await store.stopBackgroundMatchmaking(userId)).toBe(true);
    expect(await store.stopBackgroundMatchmaking(userId)).toBe(false);
    expect(await store.getRoom(retainedCode)).toBeNull();
    expect(await store.getRoom(source.code)).not.toBeNull();
    expect(await store.backgroundMatchmakingStatus(userId)).toEqual({ state: "inactive" });
    expect(await store.queueForMatch("cc", {
      userId, username: "SearchingBot", deckId: "precon-asb", cardPoolMode: "legal",
      mode: "background", sourceRoomCode: source.code, continueBackgroundSearch: true,
    })).toMatchObject({ ok: false });
    expect(await store.backgroundMatchmakingStatus(userId)).toEqual({ state: "inactive" });
  });

  it("repairs search cleanup after game completion without a gateway callback", async () => {
    const { userId, source, retainedCode } = await searchingBot();
    await db.query("UPDATE rooms SET status = 'finished' WHERE code = $1", [source.code]);
    await new PgRoomStore(db, "rules-a").sweepRooms();
    expect(await store.backgroundMatchmakingStatus(userId)).toEqual({ state: "inactive" });
    expect(await store.getRoom(retainedCode)).toBeNull();
    expect(await store.getRoom(source.code)).not.toBeNull();
  });

  it("deletes the hidden search in the same sweep as an inactive bot room", async () => {
    const { userId, source, retainedCode } = await searchingBot();
    await db.query("DELETE FROM room_presence WHERE room_code = $1", [source.code]);
    await db.query("UPDATE rooms SET gc_at = $2 WHERE code = $1", [source.code, Date.now() - 1]);
    const removed = await store.sweepRooms();
    expect(removed.map((room) => room.code).sort()).toEqual([source.code, retainedCode].sort());
    expect(await store.getRoom(source.code)).toBeNull();
    expect(await store.getRoom(retainedCode)).toBeNull();
    expect(await store.listRooms(userId)).toEqual([]);
    expect(await store.backgroundMatchmakingStatus(userId)).toEqual({ state: "inactive" });
    expect(await store.backgroundPracticeRoom(userId, retainedCode)).toBeNull();
    expect(await store.sweepRooms()).toEqual([]);
  });

  it("releases an expired bot's offer and lets the pending opponent enter practice", async () => {
    const offer = await pendingBotOffer();
    await db.query("DELETE FROM room_presence WHERE room_code = $1", [offer.firstBotCode]);
    await db.query("UPDATE rooms SET gc_at = $2 WHERE code = $1", [offer.firstBotCode, Date.now() - 1]);
    await store.sweepRooms();
    expect(await store.getRoom(offer.firstBotCode)).toBeNull();
    expect(await store.listRooms(offer.userIds[0])).toEqual([]);
    expect(await store.backgroundMatchmakingStatus(offer.userIds[0])).toEqual({ state: "inactive" });
    expect(await store.backgroundMatchmakingStatus(offer.userIds[1])).toEqual({ state: "searching", format: "cc" });
    expect((await store.getRoom(offer.offerCode))?.seats.filter(Boolean).map((seat) => seat?.userId))
      .toEqual([offer.userIds[1]]);
    expect(await store.backgroundPracticeRoom(offer.userIds[1])).not.toBeNull();
    expect((await db.query("SELECT room_code FROM matchmaking_offers")).rows).toEqual([]);
  });

  it("keeps bot practice and search if a heartbeat disarms GC before deletion", async () => {
    const { userId, source, retainedCode } = await searchingBot();
    await db.query("UPDATE rooms SET gc_at = $2 WHERE code = $1", [source.code, Date.now() - 1]);
    let reconnected = false;
    const racingStore = new PgRoomStore({
      query: async (sql, params) => {
        if (!reconnected && sql.startsWith("DELETE FROM rooms WHERE code = $1 AND gc_at = $2")) {
          reconnected = true;
          await store.markPresent(source.code, source.token, "reconnected-before-gc", 0, userId);
        }
        return db.query(sql, params);
      },
    }, "rules-a");
    expect(await racingStore.sweepRooms()).toEqual([]);
    expect(reconnected).toBe(true);
    expect(await store.getRoom(source.code)).not.toBeNull();
    expect(await store.getRoom(retainedCode)).not.toBeNull();
    expect(await store.backgroundMatchmakingStatus(userId)).toEqual({ state: "searching", format: "cc" });
  });

  it("preserves the foreground opponent's search when bot practice expires", async () => {
    const { userId, source, retainedCode } = await searchingBot();
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('WaitingHuman','waitinghuman','hash',1) RETURNING id`,
    );
    const opponentId = Number(user.rows[0]!.id);
    expect(await store.queueForMatch("cc", {
      userId: opponentId, username: "WaitingHuman", deckId: "precon-asb", cardPoolMode: "legal",
    })).toMatchObject({ ok: true, kind: "matched", code: retainedCode });
    await markStoredSeatPresent(retainedCode, 1, "waiting-human");
    await db.query("DELETE FROM room_presence WHERE room_code = $1", [source.code]);
    await db.query("UPDATE rooms SET gc_at = $2 WHERE code = $1", [source.code, Date.now() - 1]);
    await store.sweepRooms();
    expect((await store.listRooms(userId)).filter((room) => room.yours)).toEqual([]);
    expect((await store.listRooms(opponentId)).filter((room) => room.yours).map((room) => room.code))
      .toEqual([retainedCode]);
    expect((await db.query(
      "SELECT retained_room_code, pending_offer_room_code FROM matchmaking_entries WHERE user_id = $1", [opponentId],
    )).rows).toEqual([{ retained_room_code: retainedCode, pending_offer_room_code: null }]);
  });

  it("preserves an accepted PvP game when the old bot practice expires", async () => {
    const offer = await pendingBotOffer();
    await store.acceptBackgroundMatch(offer.userIds[0], offer.offerCode);
    await store.acceptMatch(offer.offerCode, { token: offer.pendingToken, userId: offer.userIds[1] });
    const before = await store.getRoom(offer.offerCode);
    await db.query("DELETE FROM room_presence WHERE room_code = $1", [offer.firstBotCode]);
    await db.query("UPDATE rooms SET gc_at = $2 WHERE code = $1", [offer.firstBotCode, Date.now() - 1]);
    await store.sweepRooms();
    expect(await store.getRoom(offer.firstBotCode)).toBeNull();
    const after = await store.getRoom(offer.offerCode);
    expect(after?.version).toBe(before?.version);
    expect(after?.seats.map((seat) => seat?.userId)).toEqual(offer.userIds);
    expect(after?.seats.every((seat) => seat?.accepted)).toBe(true);
  });

  it.each([false, true])("retries bot room code collisions (pending startup: %s)", async (pending) => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('CollisionBot','collisionbot','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    if (pending) {
      await store.queueForMatch("cc", {
        userId, username: "CollisionBot", deckId: "precon-asb", cardPoolMode: "legal",
        pendingBotStart: { format: "cc", deckId: "precon-asb", bot: "ira", requestedAt: Date.now() },
      });
    }
    let collidedCode: unknown;
    const collisionStore = new PgRoomStore({
      query: async (sql, params) => {
        if (collidedCode === undefined && sql.includes("ON CONFLICT (code) DO NOTHING RETURNING code")) {
          // Occupy the first generated code before the actual creation tries it.
          const occupied = await db.query(sql, params);
          collidedCode = params?.[0];
          // pg-mem incorrectly returns the existing row for DO NOTHING.
          // Supply PostgreSQL's empty result for this simulated collision.
          return { ...occupied, rows: [], rowCount: 0 };
        }
        return db.query(sql, params);
      },
    }, "rules-a");
    const created = pending
      ? await collisionStore.startPendingBotPractice(userId)
      : await collisionStore.createBotRoom("cc", {
        userId, username: "CollisionBot", deckId: "precon-asb",
      }, "legal", "ira");
    expect(created).not.toBeNull();
    expect(collidedCode).toEqual(expect.any(String));
    expect(created!.code).not.toBe(collidedCode);
    const room = await store.getRoom(created!.code);
    expect(room?.seats[0]?.userId).toBe(userId);
    expect(room?.seats[1]?.controller).toBe("bot");
    expect((await db.query("SELECT seat FROM room_seats WHERE room_code = $1", [collidedCode])).rows)
      .toEqual([]);
    if (pending) {
      expect(await store.backgroundPracticeRoom(userId)).toBe(created!.code);
      expect((await db.query("SELECT user_id FROM pending_bot_starts WHERE user_id = $1", [userId])).rows)
        .toEqual([]);
    }
  });

  it("recovers an interrupted pending bot startup once after reconnect or restart", async () => {
    const { userId, source } = await searchingBot();
    expect(await store.startPendingBotPractice(userId)).toBeNull();
    expect(await store.advancePendingBotStart(userId)).toBe("none");
    expect((await db.query("SELECT room_code FROM room_seats WHERE controller = 'bot'")).rows)
      .toEqual([{ room_code: source.code }]);
    // Simulate a request committed before the gateway could create practice.
    await store.stopBackgroundMatchmaking(userId);
    await store.queueForMatch("cc", {
      userId, username: "SearchingBot", deckId: "precon-asb", cardPoolMode: "legal",
      pendingBotStart: { format: "cc", deckId: "precon-asb", bot: "ira", requestedAt: Date.now() },
    });
    expect(await store.leaveForegroundMatchmakingOnDisconnect(userId)).toBe(false);
    const restarted = new PgRoomStore(db, "rules-a");
    await restarted.sweepMatchmadePrep();
    const destination = await restarted.backgroundPracticeRoom(userId);
    expect(destination).not.toBeNull();
    expect(destination).not.toBe(source.code);
    await restarted.sweepMatchmadePrep();
    expect(await restarted.backgroundPracticeRoom(userId)).toBe(destination);
  });

  it("rechecks pairing under the format lock before stopping a search", async () => {
    const { userId, source, retainedCode } = await searchingBot();
    const newcomer = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('ArrivingPlayer','arrivingplayer','hash',1) RETURNING id`,
    );
    const newcomerId = Number(newcomer.rows[0]!.id);
    let paired = false;
    const racingStore = new PgRoomStore({
      query: async (sql, params) => {
        if (!paired && sql.startsWith("UPDATE matchmaking_locks SET generation")) {
          paired = true;
          expect(await store.queueForMatch("cc", {
            userId: newcomerId, username: "ArrivingPlayer", deckId: "precon-asb", cardPoolMode: "legal",
          })).toMatchObject({ ok: true, kind: "matched", code: retainedCode });
        }
        return db.query(sql, params);
      },
    }, "rules-a");
    expect(await racingStore.stopBackgroundMatchmaking(userId)).toBe(true);
    const surviving = await store.getRoom(retainedCode);
    expect(surviving?.seats.filter((seat) => seat !== null).map((seat) => seat?.userId)).toEqual([newcomerId]);
    expect(await store.getRoom(source.code)).not.toBeNull();
    expect(await store.backgroundMatchmakingStatus(userId)).toEqual({ state: "inactive" });
    expect((await db.query("SELECT room_code FROM matchmaking_offers")).rows).toEqual([]);
  });

  it("preserves background matchmaking when its socket disconnects", async () => {
    const users = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('ReconnectBot','reconnectbot','hash',1), ('ReconnectQueue','reconnectqueue','hash',2)
       RETURNING id`,
    );
    const backgroundUserId = Number(users.rows[0]!.id);
    const foregroundUserId = Number(users.rows[1]!.id);
    const queued = await store.queueForMatch("cc", {
      userId: backgroundUserId,
      username: "ReconnectBot",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      pendingBotStart: {
        format: "cc",
        deckId: "precon-asb",
        bot: "ira",
        requestedAt: 10,
      },
    });
    if (!queued.ok || queued.kind !== "opened") throw new Error("bot queue did not open");
    expect(await store.startPendingBotPractice(backgroundUserId)).not.toBeNull();

    expect(await store.leaveForegroundMatchmakingOnDisconnect(backgroundUserId)).toBe(false);
    expect(await store.backgroundMatchmakingStatus(backgroundUserId)).toEqual({
      state: "searching",
      format: "cc",
    });

    const foreground = await store.queueForMatch("classic-battles", {
      userId: foregroundUserId,
      username: "ReconnectQueue",
      hero: "rhinar",
      cardPoolMode: "legal",
    });
    expect(foreground).toMatchObject({ ok: true, kind: "opened" });
    expect(await store.leaveForegroundMatchmakingOnDisconnect(foregroundUserId)).toBe(true);
    expect((await db.query(
      "SELECT 1 FROM matchmaking_entries WHERE user_id = $1",
      [foregroundUserId],
    )).rows).toEqual([]);
  });

  it("locks the format before removing foreground matchmaking on disconnect", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('LockOrderQueue','lockorderqueue','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    await expect(store.queueForMatch("classic-battles", {
      userId,
      username: "LockOrderQueue",
      hero: "rhinar",
      cardPoolMode: "legal",
    })).resolves.toMatchObject({ ok: true, kind: "opened" });

    const disconnectQueries: string[] = [];
    let returnStaleFormat = true;
    const disconnectStore = new PgRoomStore({
      query: async (text, params) => {
        const sql = normalizedSql(text);
        disconnectQueries.push(sql);
        if (
          returnStaleFormat
          && sql === "SELECT format FROM matchmaking_entries WHERE user_id = $1 AND mode = 'foreground'"
        ) {
          returnStaleFormat = false;
          return { rows: [{ format: "cc" }], rowCount: 1 };
        }
        return db.query(text, params);
      },
    }, "rules-a");
    expect(await disconnectStore.leaveForegroundMatchmakingOnDisconnect(userId)).toBe(true);
    expect((await db.query(
      "SELECT 1 FROM matchmaking_entries WHERE user_id = $1",
      [userId],
    )).rows).toEqual([]);
    expect(disconnectQueries.filter((query) =>
      query.includes("matchmaking_entries") || query.includes("matchmaking_locks")
    )).toEqual([
      "SELECT format FROM matchmaking_entries WHERE user_id = $1 AND mode = 'foreground'",
      "UPDATE matchmaking_locks SET generation = generation + 1 WHERE format = $1",
      "DELETE FROM matchmaking_entries WHERE user_id = $1 AND mode = 'foreground' AND format = $2 RETURNING user_id",
      "SELECT format FROM matchmaking_entries WHERE user_id = $1 AND mode = 'foreground'",
      "UPDATE matchmaking_locks SET generation = generation + 1 WHERE format = $1",
      "DELETE FROM matchmaking_entries WHERE user_id = $1 AND mode = 'foreground' AND format = $2 RETURNING user_id",
    ]);
  });

  it.each(["starvo", "levia"] as const)("persists %s as a pending background-practice opponent", async (bot) => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('StarvoPractice','starvopractice','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);

    await expect(store.queueForMatch("cc", {
      userId,
      username: "StarvoPractice",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      pendingBotStart: {
        format: "cc",
        deckId: "precon-asb",
        bot,
        requestedAt: 10,
      },
    })).resolves.toMatchObject({ ok: true, kind: "opened" });

    expect((await db.query(
      "SELECT format, bot, card_pool_mode FROM pending_bot_starts WHERE user_id = $1",
      [userId],
    )).rows).toEqual([{ format: "cc", bot, card_pool_mode: "legal" }]);
  });

  it("preserves an existing queue time and retained room when switching to bot practice", async () => {
    const users = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('RetainedBot','retainedbot','hash',1) RETURNING id`,
    );
    const userId = Number(users.rows[0]!.id);
    const opened = await store.queueForMatch("cc", {
      userId,
      username: "RetainedBot",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      joinedAt: 123,
    });
    if (!opened.ok || opened.kind !== "opened") throw new Error("queue did not open");
    await markStoredSeatPresent(opened.code, 0);

    const pending = await store.queueForMatch("cc", {
      userId,
      username: "RetainedBot",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      retainedRoomCode: opened.code,
      pendingBotStart: {
        format: "cc",
        deckId: "precon-asb",
        bot: "ira",
        requestedAt: 456,
      },
    });
    expect(pending).toEqual({ ok: true, kind: "queued" });
    expect((await db.query(
      "SELECT retained_room_code, joined_at FROM matchmaking_entries WHERE user_id = $1",
      [userId],
    )).rows).toEqual([{ retained_room_code: opened.code, joined_at: 123 }]);
    expect(await store.backgroundMatchmakingStatus(userId)).toEqual({ state: "pending", format: "cc" });
  });

  it("falls back to bot practice after the pending starter rejects its snapshotted candidate", async () => {
    const offer = await pendingBotOffer();
    const lateUser = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('LateCandidate','latecandidate','hash',3) RETURNING id`,
    );
    const lateUserId = Number(lateUser.rows[0]!.id);
    const lateQueue = await store.queueForMatch("cc", {
      userId: lateUserId,
      username: "LateCandidate",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      joinedAt: 30,
    });
    if (!lateQueue.ok || lateQueue.kind !== "opened") throw new Error("late candidate did not open");
    await markStoredSeatPresent(lateQueue.code, 0, "late-candidate");
    expect(await store.declinePendingBotMatch(offer.userIds[1], offer.offerCode, {
      token: offer.pendingToken,
      userId: offer.userIds[1],
    })).toMatchObject({ ok: true });

    expect(await store.backgroundMatchmakingStatus(offer.userIds[0])).toMatchObject({
      state: "searching",
      format: "cc",
    });
    expect(await store.backgroundMatchmakingStatus(offer.userIds[1])).toMatchObject({
      state: "searching",
      format: "cc",
    });
    expect(await store.getRoom(offer.firstBotCode)).not.toBeNull();
    const entries = await db.query(
      `SELECT user_id, mode, joined_at, avoided_room_codes, source_room_code
       FROM matchmaking_entries ORDER BY user_id`,
    );
    expect(entries.rows).toEqual([
      expect.objectContaining({ user_id: offer.userIds[0], mode: "background", joined_at: 10 }),
      expect.objectContaining({
        user_id: offer.userIds[1],
        mode: "background",
        joined_at: 20,
        avoided_room_codes: [offer.offerCode],
      }),
      expect.objectContaining({ user_id: lateUserId, mode: "foreground", joined_at: 30 }),
    ]);
    expect(entries.rows[1]!.source_room_code).not.toBeNull();
    expect((await db.query("SELECT room_code FROM matchmaking_offers")).rows).toEqual([]);
    expect((await store.getRoom(lateQueue.code))?.seats.filter(Boolean)).toHaveLength(1);
  });

  it("keeps the background player searching after they decline an offer", async () => {
    const offer = await pendingBotOffer();
    const reassignmentWrites: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const measured = new PgRoomStore({
      query: async (text, params) => {
        if (
          text.includes("SET pending_offer_room_code = NULL, retained_room_code") &&
          text.includes("WHERE pending_offer_room_code")
        ) {
          reassignmentWrites.push({ sql: normalizedSql(text), params });
        }
        return db.query(text, params);
      },
    }, "rules-a");

    await expect(measured.declineBackgroundMatch(
      offer.userIds[0],
      offer.offerCode,
    )).resolves.toMatchObject({ ok: true });

    expect(reassignmentWrites).toEqual([{
      sql: "UPDATE matchmaking_entries SET pending_offer_room_code = NULL, retained_room_code = $1 WHERE pending_offer_room_code = $1",
      params: [offer.offerCode],
    }]);
    expect(await store.backgroundMatchmakingStatus(offer.userIds[0])).toMatchObject({
      state: "searching",
      format: "cc",
    });
    expect(await store.getRoom(offer.firstBotCode)).not.toBeNull();
    expect((await db.query("SELECT room_code FROM matchmaking_offers")).rows).toEqual([]);
  });

  it("holds each participant in at most one durable offer", async () => {
    const offer = await pendingBotOffer();
    const third = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('ThirdBotStarter','thirdbotstarter','hash',3) RETURNING id`,
    );
    const thirdId = Number(third.rows[0]!.id);
    const queued = await new PgRoomStore(db, "rules-a").queueForMatch("cc", {
      userId: thirdId,
      username: "ThirdBotStarter",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      pendingBotStart: {
        format: "cc",
        deckId: "precon-asb",
        bot: "ira",
        requestedAt: 30,
      },
    });
    expect(queued).toMatchObject({ ok: true, kind: "opened" });
    expect((await db.query(
      "SELECT room_code, first_user_id, second_user_id FROM matchmaking_offers",
    )).rows).toEqual([{
      room_code: offer.offerCode,
      first_user_id: offer.userIds[0],
      second_user_id: offer.userIds[1],
    }]);
  });

  it("offers a pending bot starter its fixed candidates one at a time in FIFO order", async () => {
    const users = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('SnapshotA','snapshota','hash',1),
              ('SnapshotB','snapshotb','hash',2),
              ('SnapshotStarter','snapshotstarter','hash',3)
       RETURNING id`,
    );
    const firstId = Number(users.rows[0]!.id);
    const secondId = Number(users.rows[1]!.id);
    const starterId = Number(users.rows[2]!.id);
    const first = await store.queueForMatch("cc", {
      userId: firstId, username: "SnapshotA", deckId: "precon-asb", cardPoolMode: "legal", joinedAt: 1,
    });
    const second = await store.queueForMatch("cc", {
      userId: secondId, username: "SnapshotB", deckId: "precon-asb", cardPoolMode: "legal", joinedAt: 2,
    });
    if (!first.ok || first.kind !== "opened" || !second.ok || second.kind !== "opened") {
      throw new Error("snapshot candidates did not open retained rooms");
    }
    await markStoredSeatPresent(first.code, 0, "snapshot-a");
    await markStoredSeatPresent(second.code, 0, "snapshot-b");

    const firstOffer = await store.queueForMatch("cc", {
      userId: starterId,
      username: "SnapshotStarter",
      deckId: "precon-asb",
      cardPoolMode: "legal",
      joinedAt: 3,
      pendingBotStart: {
        format: "cc", deckId: "precon-asb", bot: "ira", requestedAt: 3,
      },
    });
    expect(firstOffer).toMatchObject({ ok: true, kind: "matched", code: first.code });
    if (!firstOffer.ok || firstOffer.kind !== "matched") throw new Error("first offer missing");
    const firstJoin = await store.joinRoom(first.code, undefined, {
      allowPlayer: true, userId: starterId, username: "SnapshotStarter",
    });
    if (!firstJoin.ok || firstJoin.kind !== "player") throw new Error("starter did not join first offer");
    await store.declinePendingBotMatch(starterId, first.code, {
      token: firstJoin.token, userId: starterId,
    });

    const secondOffer = await db.query(
      "SELECT room_code, first_user_id, second_user_id FROM matchmaking_offers",
    );
    expect(secondOffer.rows).toEqual([{
      room_code: second.code,
      first_user_id: secondId,
      second_user_id: starterId,
    }]);
    const candidates = await db.query(
      `SELECT candidate_user_id, ordinal, attempted, skipped
       FROM pending_bot_start_candidates WHERE starter_user_id = $1 ORDER BY ordinal`,
      [starterId],
    );
    expect(candidates.rows).toEqual([
      { candidate_user_id: firstId, ordinal: 0, attempted: true, skipped: false },
      { candidate_user_id: secondId, ordinal: 1, attempted: false, skipped: false },
    ]);
    // A delayed completion of the first decline must not cancel a newer
    // offer already selected by another gateway or the recovery sweeper.
    expect(await store.advancePendingBotStart(starterId, firstId)).toBe("matched");
    expect((await db.query("SELECT room_code FROM matchmaking_offers")).rows).toEqual([{ room_code: second.code }]);
    const secondJoin = await store.joinRoom(second.code, undefined, {
      allowPlayer: true, userId: starterId, username: "SnapshotStarter",
    });
    if (!secondJoin.ok || secondJoin.kind !== "player") throw new Error("starter did not join second offer");
    expect(await store.declinePendingBotMatch(starterId, second.code, { token: secondJoin.token, userId: starterId }))
      .toMatchObject({ ok: true });
    expect(await store.backgroundMatchmakingStatus(starterId)).toEqual({ state: "searching", format: "cc" });
    const practice = await store.backgroundPracticeRoom(starterId, second.code);
    expect(practice).not.toBeNull();
    expect(await store.backgroundPracticeRoom(starterId, first.code)).toBe(practice);
    expect(await store.backgroundPracticeRoom(starterId, "NOPE00")).toBeNull();
    expect((await store.listRooms(starterId)).filter((room) => room.yours).map((room) => room.code)).toEqual([practice]);
  });

  it("cancels a timed-out pending bot start and safely requeues the practicing survivor", async () => {
    const offer = await pendingBotOffer();
    await store.acceptBackgroundMatch(offer.userIds[0], offer.offerCode);
    const deadline = (await store.getRoom(offer.offerCode))!.prepDeadlineAt!;

    await store.sweepMatchmadePrep(deadline + 1);

    expect(await store.backgroundMatchmakingStatus(offer.userIds[0])).toMatchObject({
      state: "searching",
      format: "cc",
    });
    expect(await store.backgroundMatchmakingStatus(offer.userIds[1])).toEqual({ state: "inactive" });
    expect(await store.getRoom(offer.firstBotCode)).not.toBeNull();
    expect((await db.query(
      "SELECT user_id, mode, joined_at FROM matchmaking_entries ORDER BY user_id",
    )).rows).toEqual([{ user_id: offer.userIds[0], mode: "background", joined_at: 10 }]);
  });

  it("keeps bot practice but stops searching when the background player times out", async () => {
    const offer = await pendingBotOffer();
    await store.acceptMatch(offer.offerCode, {
      token: offer.pendingToken,
      userId: offer.userIds[1],
    });
    const deadline = (await store.getRoom(offer.offerCode))!.prepDeadlineAt!;

    await store.sweepMatchmadePrep(deadline + 1);

    expect(await store.backgroundMatchmakingStatus(offer.userIds[0])).toEqual({ state: "inactive" });
    expect(await store.getRoom(offer.firstBotCode)).not.toBeNull();
    expect(await store.backgroundMatchmakingStatus(offer.userIds[1])).toMatchObject({
      state: "searching",
      format: "cc",
    });
  });

  it("stops an active background offer without stranding the pending starter", async () => {
    const offer = await pendingBotOffer();

    expect(await store.stopBackgroundMatchmaking(offer.userIds[0])).toBe(true);

    expect(await store.backgroundMatchmakingStatus(offer.userIds[0])).toEqual({ state: "inactive" });
    expect(await store.getRoom(offer.firstBotCode)).not.toBeNull();
    expect(await store.backgroundMatchmakingStatus(offer.userIds[1])).toMatchObject({
      state: "searching",
      format: "cc",
    });
    expect((await db.query("SELECT room_code FROM matchmaking_offers")).rows).toEqual([]);
  });

  it("releases a durable offer when the foreground player leaves normally", async () => {
    const offer = await pendingBotOffer();
    const left = await store.leaveRoom(offer.offerCode, {
      token: offer.pendingToken,
      userId: offer.userIds[1],
    });
    if (!left.ok) throw new Error(left.error);

    expect(await store.resolveOfferedPlayerLeave(
      offer.userIds[1],
      offer.offerCode,
      left.format,
      left.cardPoolMode,
      left.remaining,
    )).toBe(true);

    expect(await store.backgroundMatchmakingStatus(offer.userIds[0])).toMatchObject({ state: "searching" });
    expect(await store.backgroundMatchmakingStatus(offer.userIds[1])).toEqual({ state: "inactive" });
    expect((await db.query("SELECT room_code FROM matchmaking_offers")).rows).toEqual([]);
  });

  it("does not match a new player into an opener whose owner is absent", async () => {
    const users = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('GoneQueue','gonequeue','hash',1), ('LiveQueue','livequeue','hash',2)
       RETURNING id`,
    );
    const absentId = Number(users.rows[0]!.id);
    const liveId = Number(users.rows[1]!.id);
    const absent = await store.queueForMatch("classic-battles", {
      userId: absentId,
      username: "GoneQueue",
      hero: "rhinar",
      cardPoolMode: "legal",
    });
    if (!absent.ok || absent.kind !== "opened") throw new Error("queue did not open a room");

    const live = await store.queueForMatch("classic-battles", {
      userId: liveId,
      username: "LiveQueue",
      hero: "dorinthea",
      cardPoolMode: "legal",
    });
    expect(live).toMatchObject({ ok: true, kind: "opened" });
    if (!live.ok || live.kind !== "opened") throw new Error("queue did not open a second room");
    expect(live.code).not.toBe(absent.code);
    expect((await store.getRoom(absent.code))?.seats.map((seat) => seat?.userId ?? null))
      .toEqual([absentId, null]);
    expect((await store.getRoom(live.code))?.seats.map((seat) => seat?.userId ?? null))
      .toEqual([liveId, null]);
  });

  it("retires a retained queue opener when its public room is filled manually", async () => {
    const users = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('ManualA','manuala','hash',1), ('ManualB','manualb','hash',2),
              ('ManualC','manualc','hash',3)
       RETURNING id`,
    );
    const openerId = Number(users.rows[0]!.id);
    const joinerId = Number(users.rows[1]!.id);
    const laterId = Number(users.rows[2]!.id);

    const opened = await store.queueForMatch("classic-battles", {
      userId: openerId,
      username: "ManualA",
      hero: "rhinar",
      cardPoolMode: "legal",
    });
    if (!opened.ok || opened.kind !== "opened") throw new Error("queue did not open a room");
    await markStoredSeatPresent(opened.code, 0);

    await expect(store.joinRoom(opened.code, undefined, {
      allowPlayer: true,
      userId: joinerId,
      username: "ManualB",
      hero: "dorinthea",
    })).resolves.toMatchObject({ ok: true, kind: "player", seat: 1 });
    expect(await store.matchmakingCounts()).toEqual({
      "classic-battles": 0,
      cc: 0,
      "silver-age": 0,
    });

    const later = await store.queueForMatch("classic-battles", {
      userId: laterId,
      username: "ManualC",
      hero: "dorinthea",
      cardPoolMode: "legal",
    });
    expect(later).toMatchObject({ ok: true, kind: "opened" });
    expect((await db.query(
      "SELECT room_code FROM room_seats WHERE user_id = $1 ORDER BY room_code",
      [openerId],
    )).rows).toEqual([{ room_code: opened.code }]);
  });

  it("opens and reuses a separate room when every compatible opener was declined", async () => {
    const match = await matchedRoom();
    const declinedCode = match.code;
    const declined = await store.leaveRoom(declinedCode, {
      token: match.tokens[1],
      userId: match.userIds[1],
    });
    expect(declined).toMatchObject({ ok: true, freedSeat: 1 });
    if (!declined.ok || !declined.remaining) throw new Error("match did not retain its opener");

    expect(await store.queueForMatch("classic-battles", {
      userId: match.userIds[0],
      username: "MatchA",
      hero: "rhinar",
      retainedRoomCode: declinedCode,
      cardPoolMode: "legal",
    })).toEqual({ ok: true, kind: "queued" });

    const opened = await store.queueForMatch("classic-battles", {
      userId: match.userIds[1],
      username: "MatchB",
      hero: "dorinthea",
      avoidRoomCodes: [declinedCode],
      cardPoolMode: "legal",
    });
    expect(opened).toMatchObject({ ok: true, kind: "opened", version: 0 });
    if (!opened.ok || opened.kind !== "opened") throw new Error("fallback room was not opened");
    expect(opened.code).not.toBe(declinedCode);
    expect((await store.getRoom(declinedCode))?.seats.map((seat) => seat?.userId ?? null))
      .toEqual([match.userIds[0], null]);
    expect((await store.getRoom(opened.code))?.seats.map((seat) => seat?.userId ?? null))
      .toEqual([match.userIds[1], null]);

    expect(await store.queueForMatch("classic-battles", {
      userId: match.userIds[1],
      username: "MatchB",
      hero: "dorinthea",
      avoidRoomCodes: [declinedCode],
      cardPoolMode: "legal",
    })).toEqual(opened);
    expect((await db.query(
      "SELECT retained_room_code FROM matchmaking_entries ORDER BY user_id",
    )).rows).toEqual([
      { retained_room_code: declinedCode },
      { retained_room_code: opened.code },
    ]);
  });

  it("advances a matchmade room from acceptance to timed first-player choice", async () => {
    const match = await matchedRoom();
    const initial = await store.getRoom(match.code);
    expect(prepViewFor(initial!, 0)).toMatchObject({
      deadlinePhase: "accept",
      seats: [{ accepted: false }, { accepted: false }],
    });
    const winner = initial!.prep!.dieWinner;
    expect(await store.chooseFirst(match.code, {
      token: match.tokens[winner],
      userId: match.userIds[winner],
    }, true)).toEqual({
      ok: false,
      error: "both players must accept before choosing who goes first",
    });

    expect(await store.acceptMatch(match.code, { token: match.tokens[0], userId: match.userIds[0] }))
      .toMatchObject({ ok: true });
    expect(prepViewFor((await store.getRoom(match.code))!, 0).deadlinePhase).toBe("accept");
    expect(await store.acceptMatch(match.code, { token: match.tokens[1], userId: match.userIds[1] }))
      .toMatchObject({ ok: true });
    expect(prepViewFor((await store.getRoom(match.code))!, 0)).toMatchObject({
      deadlinePhase: "choose-first",
      seats: [{ accepted: true }, { accepted: true }],
    });
  });

  it("requires arena reveal before opening main-deck selection", async () => {
    const match = await matchedRoom();
    for (const seat of [0, 1] as const) {
      await store.acceptMatch(match.code, { token: match.tokens[seat], userId: match.userIds[seat] });
    }
    expect(await store.unready(match.code, { token: match.tokens[0], userId: match.userIds[0] }))
      .toEqual({ ok: false, error: "the room is not in deck selection" });
    expect(await store.presentDeck(match.code, { token: match.tokens[0], userId: match.userIds[0] }, decklists.rhinar))
      .toEqual({ ok: false, error: "the match is not in deck preparation" });
  });

  it("evicts an acceptance no-show and requeues the survivor in the retained room", async () => {
    const match = await matchedRoom();
    await store.acceptMatch(match.code, { token: match.tokens[0], userId: match.userIds[0] });
    const deadline = (await store.getRoom(match.code))!.prepDeadlineAt!;

    expect(await store.sweepMatchmadePrep(deadline + 1)).toEqual([
      expect.objectContaining({ code: match.code, started: false }),
    ]);
    const room = await store.getRoom(match.code);
    expect(room?.seats.map((seat) => seat?.userId ?? null)).toEqual([match.userIds[0], null]);
    expect(room?.prep).toBeNull();
    expect(await store.matchmakingCounts()).toMatchObject({ "classic-battles": 1 });
    expect((await db.query(
      "SELECT subject_user_id FROM cluster_events WHERE event_type = 'match-timeout'",
    )).rows).toEqual([{ subject_user_id: match.userIds[1] }]);
    expect(await store.joinRoom(match.code, match.tokens[1], {
      allowPlayer: true,
      userId: match.userIds[1],
      hero: "dorinthea",
    })).toEqual({ ok: false, error: "room session expired" });
  });

  it("clears both seats when neither player accepts the match", async () => {
    const match = await matchedRoom();
    const deadline = (await store.getRoom(match.code))!.prepDeadlineAt!;

    await store.sweepMatchmadePrep(deadline + 1);
    expect((await store.getRoom(match.code))?.seats).toEqual([null, null]);
    expect(await store.matchmakingCounts()).toMatchObject({ "classic-battles": 0 });
    expect((await db.query(
      "SELECT subject_user_id FROM cluster_events WHERE event_type = 'match-timeout' ORDER BY subject_user_id",
    )).rows).toEqual(match.userIds.map((subject_user_id) => ({ subject_user_id })));
  });

  it("evicts a player who has not locked arena cards before preparation expires", async () => {
    const match = await matchedRoom();
    for (const seat of [0, 1] as const) {
      await store.acceptMatch(match.code, { token: match.tokens[seat], userId: match.userIds[seat] });
    }
    const prep = (await store.getRoom(match.code))!.prep!;
    await store.chooseFirst(match.code, {
      token: match.tokens[prep.dieWinner],
      userId: match.userIds[prep.dieWinner],
    }, true);
    const deck = decklists.rhinar;
    await store.presentArena(match.code, { token: match.tokens[0], userId: match.userIds[0] }, {
      weaponIds: deck.weaponIds,
      equipment: deck.equipment,
    });
    const deadline = (await store.getRoom(match.code))!.prepDeadlineAt!;

    await store.sweepMatchmadePrep(deadline + 1);
    const room = await store.getRoom(match.code);
    expect(room?.seats.map((seat) => seat?.userId ?? null)).toEqual([match.userIds[0], null]);
    expect(room?.seats[0]?.ready).toBe(false);
    expect(await store.matchmakingCounts()).toMatchObject({ "classic-battles": 1 });
  });

  it("shares one five-minute start budget across first-player choice, arena reveal, and deck selection", async () => {
    const match = await matchedRoom();
    for (const seat of [0, 1] as const) {
      await store.acceptMatch(match.code, { token: match.tokens[seat], userId: match.userIds[seat] });
    }
    const initial = (await store.getRoom(match.code))!;
    const winner = initial.prep!.dieWinner;
    expect(await store.chooseFirst(match.code, { token: match.tokens[winner], userId: match.userIds[winner] }, true))
      .toMatchObject({ ok: true });
    const deadline = (await store.getRoom(match.code))!.prepDeadlineAt!;
    expect(deadline).toBe(initial.prepDeadlineAt! + 270_000);
    await lockClassicArenas(match.code, match.tokens);
    expect((await store.getRoom(match.code))!.prepDeadlineAt).toBe(deadline);
    expect(prepViewFor((await store.getRoom(match.code))!, 0).deadlinePhase).toBe("select-deck");
    await store.presentDeck(match.code, { token: match.tokens[0], userId: match.userIds[0] }, decklists.rhinar);
    await store.sweepMatchmadePrep(deadline + 1);
    const survivor = (await store.getRoom(match.code))!;
    expect(survivor.seats[1]).toBeNull();
    expect(survivor.prep).toBeNull();
    expect(survivor.seats[0]?.ready).toBe(false);
  });

  it("auto-selects the die winner when the first-player deadline expires", async () => {
    const match = await matchedRoom();
    for (const seat of [0, 1] as const) {
      await store.acceptMatch(match.code, { token: match.tokens[seat], userId: match.userIds[seat] });
    }
    const prep = await store.getRoom(match.code);
    expect(prepViewFor(prep!, 0).deadlinePhase).toBe("choose-first");

    expect(await store.sweepMatchmadePrep(prep!.prepDeadlineAt! + 1)).toEqual([
      expect.objectContaining({ code: match.code, started: false }),
    ]);
    const decided = await store.getRoom(match.code);
    expect(decided?.prep?.startPlayer).toBe(prep?.prep?.dieWinner);
    expect(prepViewFor(decided!, 0).deadlinePhase).toBe("select-arena");
    await lockClassicArenas(match.code, match.tokens);
    for (const seat of [0, 1] as const) {
      const deck = decklists[seat === 0 ? "rhinar" : "dorinthea"];
      expect(await store.presentDeck(match.code, { token: match.tokens[seat], userId: match.userIds[seat] }, {
        weaponIds: deck.weaponIds,
        equipment: deck.equipment,
        deck: deck.deck,
      })).toMatchObject({ ok: true });
    }
    const started = await store.getRoom(match.code);
    expect(started?.state).not.toBeNull();
    expect(started?.state?.activePlayer).toBe(prep?.prep?.dieWinner);
    expect(started?.prepDeadlineAt).toBeNull();
  });

  it("queues every available built-in precon without requiring a decks row", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('PreconQueue','preconqueue','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);

    for (const format of ["cc", "silver-age"] as const) {
      for (const deck of preconsForFormat(format)) {
        await expect(store.queueForMatch(format, {
          userId,
          username: "PreconQueue",
          deckId: deck.id,
          deckName: deck.name,
          cardPoolMode: "legal",
        })).resolves.toMatchObject({ ok: true, kind: "opened", version: 0 });
        expect(await store.leaveMatchmaking(userId)).toBe(true);
      }
    }
  });
});
