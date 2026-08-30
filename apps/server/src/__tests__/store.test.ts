import { beforeEach, describe, expect, it } from "vitest";
import { decklists, precon, preconsForFormat, silverAgePrecon } from "@fyendal/cards";
import { legalIntents } from "@fyendal/engine";
import { decodeServerMessage } from "@fyendal/protocol";
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

let db: Queryable;
let store: PgRoomStore;

beforeEach(async () => {
  db = await freshDb();
  store = new PgRoomStore(db, "rules-a");
});

async function fullRoom(): Promise<{ code: string; tokens: [string, string] }> {
  const host = await store.createRoom("classic-battles", { hero: "rhinar" });
  const joined = await store.joinRoom(host.code, undefined, { allowPlayer: true, hero: "dorinthea" });
  if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
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
  await store.queueForMatch("classic-battles", {
    userId: userIds[0], username: "MatchA", hero: "rhinar", allowFutureCards: false,
  });
  const matched = await store.queueForMatch("classic-battles", {
    userId: userIds[1], username: "MatchB", hero: "dorinthea", allowFutureCards: false,
  });
  if (!matched.ok || matched.kind !== "matched") throw new Error("match failed");
  const joinedA = await store.joinRoom(matched.code, undefined, { allowPlayer: true, userId: userIds[0] });
  const joinedB = await store.joinRoom(matched.code, undefined, { allowPlayer: true, userId: userIds[1] });
  if (!joinedA.ok || joinedA.kind !== "player" || !joinedB.ok || joinedB.kind !== "player") {
    throw new Error("match reclaim failed");
  }
  return { code: matched.code, userIds, tokens: [joinedA.token, joinedB.token] };
}

async function startGame(code: string, tokens: [string, string]): Promise<void> {
  const room = await store.getRoom(code);
  const winner = room!.prep!.dieWinner;
  const chosen = await store.chooseFirst(code, { token: tokens[winner] }, true);
  if (!chosen.ok || chosen.started) throw new Error("turn order was not recorded before ready-up");
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
    query.startsWith("UPDATE replay_games")
  );
}

describe("PgRoomStore storage", () => {
  it("persists and advertises a room's future-card rule", async () => {
    const created = await store.createRoom(
      "cc",
      { deckId: "precon-asb", username: "FutureHost" },
      "public",
      true,
    );
    expect((await store.getRoom(created.code))?.allowFutureCards).toBe(true);
    expect(await store.roomInvite(created.code)).toMatchObject({ allowFutureCards: true });
    expect(await store.listRooms()).toEqual([
      expect.objectContaining({ code: created.code, allowFutureCards: true }),
    ]);
  });

  it("does not seat a player whose deck is illegal for the room", async () => {
    const created = await store.createRoom("cc", { deckId: "precon-asb" });
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
    });
    await db.query("UPDATE rooms SET prep = $2 WHERE code = $1", [
      created.code,
      JSON.stringify({ rolls: [1, 6], dieWinner: 1, startPlayer: null }),
    ]);
    let room = await store.getRoom(created.code);
    expect(room?.seats[1]).toMatchObject({
      controller: "bot",
      username: "Briar Bot",
      deckId: "bot-briar-broccoli",
    });
    expect(prepViewFor(room!, 0).botGame).toBe(true);
    expect((await store.botRoomCodes())).toContain(created.code);

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
    const ready = await tracedStore(prepQueries).presentDeck(
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
    const legal = legalIntents(room!.state!, 1).filter((intent) => intent.kind !== "concede");
    const botQueries: string[] = [];
    const applied = await tracedStore(botQueries).applyBotIntent(created.code, room!.version, legal[0]!);
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
    expect((await getReplay(db, userId, ended.replayFinalizationId))?.views.at(-1)?.winner)
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
    }, false, "bravo");
    let room = await store.getRoom(created.code);
    expect(room?.seats[1]).toMatchObject({
      controller: "bot",
      username: "Bravo Bot",
      deckId: "bot-bravo-flarvo",
    });

    const briar = silverAgePrecon("precon-sba")!.pool;
    await chooseBotTurn(created.code, created.token, userId);
    const ready = await store.presentDeck(created.code, { token: created.token, userId }, {
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
    const ready = await store.presentDeck(
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
    }, false, "ira");

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
    }, false, "cindra");

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
    const ready = await store.presentDeck(
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
    }, false, "jarl");

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
    const ready = await store.presentDeck(
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
        head: "PEN310",
        chest: "ROS028",
        arms: "AJV006",
        legs: "OMN204",
      },
    });
    expect(room!.seats[1]!.presented!.deck).toHaveLength(60);
  });

  it("round-trips a bot-room state with Plasma Barrel Shot through the wire decoder", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('DashOwner','dashowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("silver-age", {
      deckId: "precon-sda",
      username: "DashOwner",
      userId,
    });
    const dash = silverAgePrecon("precon-sda")!.pool;
    await chooseBotTurn(created.code, created.token, userId);
    const ready = await store.presentDeck(
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
    });
    const viserai = silverAgePrecon("precon-svi")!.pool;
    await chooseBotTurn(created.code, created.token, userId);
    const ready = await store.presentDeck(created.code, { token: created.token, userId }, {
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

  it("inserts and deletes only the affected player seat", async () => {
    const host = await store.createRoom("classic-battles", { hero: "rhinar" });
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
    expect(replayDml(queries)[0]).toContain("SELECT active.id, $2::bigint");
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
    });
    const viserai = silverAgePrecon("precon-svi")!.pool;
    const presented = {
      weaponIds: viserai.weaponIds.slice(0, 1),
      equipment: {},
      deck: viserai.deck.slice(0, 40),
    };
    const credentials = { token: created.token, userId };
    await chooseBotTurn(created.code, created.token, userId);
    expect((await store.presentDeck(created.code, credentials, presented)).ok).toBe(true);
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
      allowFutureCards: false,
    });
    expect(opened).toMatchObject({ ok: true, kind: "opened", version: 0 });
    if (!opened.ok || opened.kind !== "opened") throw new Error("queue did not open a room");
    expect(await otherGateway.matchmakingCounts()).toEqual({
      "classic-battles": 1,
      cc: 0,
      "silver-age": 0,
    });

    const matched = await otherGateway.queueForMatch("classic-battles", {
      userId: secondId,
      username: "QueueB",
      hero: "dorinthea",
      allowFutureCards: false,
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
      allowFutureCards: false,
    });
    if (!opened.ok || opened.kind !== "opened") throw new Error("queue did not open a room");

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
      allowFutureCards: false,
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
      allowFutureCards: false,
    })).toEqual({ ok: true, kind: "queued" });

    const opened = await store.queueForMatch("classic-battles", {
      userId: match.userIds[1],
      username: "MatchB",
      hero: "dorinthea",
      avoidRoomCodes: [declinedCode],
      allowFutureCards: false,
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
      allowFutureCards: false,
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

  it("evicts an unready player after accepted-match preparation expires", async () => {
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
    await store.presentDeck(match.code, { token: match.tokens[0], userId: match.userIds[0] }, {
      weaponIds: deck.weaponIds,
      equipment: deck.equipment,
      deck: deck.deck,
    });
    const deadline = (await store.getRoom(match.code))!.prepDeadlineAt!;

    await store.sweepMatchmadePrep(deadline + 1);
    const room = await store.getRoom(match.code);
    expect(room?.seats.map((seat) => seat?.userId ?? null)).toEqual([match.userIds[0], null]);
    expect(room?.seats[0]?.ready).toBe(true);
    expect(await store.matchmakingCounts()).toMatchObject({ "classic-battles": 1 });
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
    expect(prepViewFor(decided!, 0).deadlinePhase).toBe("prepare");
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
          allowFutureCards: false,
        })).resolves.toMatchObject({ ok: true, kind: "opened", version: 0 });
        expect(await store.leaveMatchmaking(userId)).toBe(true);
      }
    }
  });
});
