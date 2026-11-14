import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { precon } from "@fyendal/cards";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { LiveServerMessageDecoder, liveWebSocketUrl } from "@fyendal/protocol";
import type { ClientMessage, GameIntent, PresentedDeck, ServerMessage, StateMessage } from "@fyendal/shared";
import type { Queryable } from "../db.js";
import { login, register } from "../auth.js";
import { closeGameServer, createGameServer } from "../index.js";
import { PgRoomStore, prepViewFor, stateMessage, type RoomRow, type SeatCredentials } from "../store.js";
import { StateLogTransport } from "../stateLogTransport.js";
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

const DECKS = ["precon-asb", "precon-asr"] as const;

function presentation(deckId: string): PresentedDeck {
  const pool = precon(deckId)!.pool;
  return { weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck };
}

async function user(name: string): Promise<number> {
  const { rows } = await db.query(
    "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ($1,$2,'hash',1) RETURNING id",
    [name, name.toLowerCase()],
  );
  return Number(rows[0]!.id);
}

async function soloRoom(): Promise<{ code: string; seats: [SeatCredentials, SeatCredentials]; userId: number }> {
  const userId = await user("Soloist");
  const created = await store.createSoloRoom(
    "cc",
    { deckId: DECKS[0], deckName: "Mine", username: "Soloist", userId },
    { deckId: DECKS[1] },
  );
  const real = { token: created.token, userId };
  return { code: created.code, seats: [real, { ...real, actAs: 1 }], userId };
}

/** Prep both solo seats through delegation until the game starts. */
async function startSolo(code: string, seats: [SeatCredentials, SeatCredentials]): Promise<void> {
  expect(await store.chooseFirst(code, seats[1], true)).toMatchObject({ ok: true });
  expect((await store.getRoom(code))!.prep!.startPlayer).toBe(1);
  for (const seat of [0, 1] as const) {
    const deck = presentation(DECKS[seat]);
    expect(await store.presentArena(code, seats[seat], { weaponIds: deck.weaponIds, equipment: {} }))
      .toMatchObject({ ok: true });
  }
  expect(await store.presentDeck(code, seats[0], presentation(DECKS[0])))
    .toMatchObject({ ok: true, started: false });
  expect(await store.presentDeck(code, seats[1], presentation(DECKS[1])))
    .toMatchObject({ ok: true, started: true });
}

function soloActor(room: RoomRow): number {
  return room.state!.pendingDecision?.player ?? room.state!.priorityPlayer;
}

function playable(legal: GameIntent[]): GameIntent[] {
  return legal.filter((intent) => intent.kind !== "concede" && !intent.kind.endsWith("-draw"));
}

let commandCounter = 0;

/** Submit as the solo owner, fenced to the version the client last saw. */
async function act(code: string, credentials: SeatCredentials, intent: GameIntent) {
  const room = (await store.getRoom(code))!;
  return store.applyIntent(code, credentials, intent, {}, { id: `cmd-${++commandCounter}`, expectedVersion: room.version });
}

async function count(table: string): Promise<number> {
  return Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]!.n);
}

describe("solo rooms", () => {
  it("creates a private room whose second seat is delegated to its owner", async () => {
    const { code, userId } = await soloRoom();
    const room = (await store.getRoom(code))!;
    expect(room.isPrivate).toBe(true);
    expect(room.seats[0]).toMatchObject({ userId, deckId: DECKS[0], deckName: "Mine" });
    expect(room.seats[0]!.controller).toBeUndefined();
    expect(room.seats[1]).toMatchObject({ controller: "self", username: "Soloist", deckId: DECKS[1] });
    expect(room.seats[1]!.userId).toBeUndefined();
    for (const seat of [0, 1] as const) {
      const prep = prepViewFor(room, seat);
      expect(prep).toMatchObject({ soloGame: true, yourSeat: seat, yourDeckId: DECKS[seat] });
      expect(prep.botGame).toBeUndefined();
      expect(prep.seats[1]!.connected).toBe(true);
    }
    expect(await store.listRooms()).toEqual([]);
  });

  it("rejects decks outside the room's format", async () => {
    const userId = await user("Soloist");
    await expect(store.createSoloRoom(
      "silver-age",
      { deckId: DECKS[0], username: "Soloist", userId },
      { deckId: DECKS[1] },
    )).rejects.toThrow("choose a silver-age deck");
  });

  it("plays both seats, undoes from either, and records nothing durable", async () => {
    const { code, seats } = await soloRoom();
    await startSolo(code, seats);
    let room = (await store.getRoom(code))!;
    expect(room.state!.activePlayer).toBe(1);

    const acted = new Set<number>();
    for (let step = 0; step < 60 && acted.size < 2; step++) {
      const state = room.state!;
      const actor = state.pendingDecision?.player ?? state.priorityPlayer;
      const legal = playable(legalIntents(state, actor));
      const intent = legal.find((candidate) => candidate.kind === "pass") ?? legal[0]!;
      expect(await act(code, seats[0], intent), JSON.stringify(intent)).toMatchObject({ ok: true });
      acted.add(actor);
      room = (await store.getRoom(code))!;
    }
    expect([...acted].sort()).toEqual([0, 1]);

    const beforeUndo = room.version;
    expect(await store.undo(code, seats[0], "last-action", { id: "undo-0", expectedVersion: beforeUndo }))
      .toMatchObject({ ok: true, version: beforeUndo + 1 });
    room = (await store.getRoom(code))!;
    expect(await store.undo(code, seats[1], "last-action", { id: "undo-1", expectedVersion: room.version }))
      .toMatchObject({ ok: true });
    expect(await store.undo(code, seats[1], "last-action", { id: "undo-1", expectedVersion: room.version }))
      .toMatchObject({ ok: true, version: room.version + 1 });
    room = (await store.getRoom(code))!;

    expect(await act(code, seats[0], { kind: "offer-draw" }))
      .toEqual({ ok: false, error: "draw offers are only available in player games" });
    expect(await store.claimVictory(code, seats[0], Date.now() + 10_000_000_000))
      .toEqual({ ok: false, error: "both seats are yours" });

    const loser = soloActor(room);
    expect(await act(code, seats[0], { kind: "concede" })).toEqual({ ok: true, version: expect.any(Number) });
    room = (await store.getRoom(code))!;
    expect(room.state).toMatchObject({ phase: "game-over", winner: 1 - loser });
    expect(stateMessage(room, 0)).toMatchObject({ yourSeat: 0, boardSeat: 0 });

    for (const table of [
      "replay_games", "replay_frames", "matches", "match_participants", "hero_records",
      "matchup_records", "user_achievements", "daily_game_players",
    ]) expect(await count(table), table).toBe(0);

    const ended = await store.deletePracticeRoom(code, seats[1]);
    expect(ended).toEqual({
      ok: true,
      version: room.version + 1,
      playAgainSolo: { format: "cc", deckId: DECKS[0], opponentDeckId: DECKS[1] },
    });
    expect(await store.getRoom(code)).toBeNull();
    expect(await count("matches")).toBe(0);
  });

  it("ends an unfinished solo game without a match row", async () => {
    const { code, seats } = await soloRoom();
    await startSolo(code, seats);
    expect(await store.deletePracticeRoom(code, seats[0])).toMatchObject({ ok: true });
    expect(await count("matches")).toBe(0);
    expect(await count("replay_games")).toBe(0);
  });

  it("shows both hands on a fixed board while control follows the acting seat", async () => {
    const { code, seats } = await soloRoom();
    await startSolo(code, seats);
    let room = (await store.getRoom(code))!;
    const transport = new StateLogTransport();
    let previousActor: number | null = null;
    let actorChanges = 0;
    const decisions = new Set<string>();
    for (let step = 0; step < 80 && !(decisions.has("defend") && actorChanges >= 3); step++) {
      const state = room.state!;
      const actor = soloActor(room);
      const now = Date.now();
      const message = stateMessage(room, 0, now) as StateMessage;
      expect(JSON.stringify(stateMessage(room, 1, now))).toBe(JSON.stringify(message));
      expect(message).toMatchObject({ yourSeat: actor, boardSeat: 0, soloGame: true });
      expect(message.legal).toEqual(legalIntents(state, actor));
      for (const seat of [0, 1] as const) {
        expect(message.view.players[seat].hand.map((card) => card.instanceId))
          .toEqual(state.players[seat].hand.map((card) => card.instanceId));
        expect(message.view.players[seat].arsenal).toHaveLength(state.players[seat].arsenal.length);
        expect(message.view.players[seat].deck).toBeUndefined();
      }
      const frame = transport.encode(message);
      if (previousActor !== null && previousActor !== actor) {
        actorChanges++;
        expect(message.transition).toMatchObject({ kind: "forward", fromVersion: room.version - 1 });
        expect(frame.drop).not.toBeNull();
      }
      if (state.pendingDecision) decisions.add(state.pendingDecision.kind);
      previousActor = actor;
      const legal = playable(legalIntents(state, actor));
      const intent = legal.find((candidate) => candidate.kind === "play-card")
        ?? legal.find((candidate) => candidate.kind === "pass") ?? legal[0]!;
      expect(await act(code, seats[0], intent), JSON.stringify(intent)).toMatchObject({ ok: true });
      room = (await store.getRoom(code))!;
    }
    expect(decisions.has("defend")).toBe(true);
    expect(actorChanges).toBeGreaterThanOrEqual(3);

    const spectator = stateMessage(room, null) as StateMessage;
    expect(spectator.yourSeat).toBeNull();
    expect(spectator.boardSeat).toBeUndefined();
    expect(spectator.view.players.every((player) => player.hand.length === 0)).toBe(true);
  });

  it("binds seat commands to the acting seat behind the version fence", async () => {
    const { code, seats } = await soloRoom();
    await startSolo(code, seats);
    const room = (await store.getRoom(code))!;
    const pass: GameIntent = { kind: "pass" };
    expect(await store.applyIntent(code, seats[0], pass))
      .toEqual({ ok: false, error: "solo actions require an expected room version" });
    expect(await store.undo(code, seats[0])).toEqual({ ok: false, error: "solo actions require an expected room version" });
    expect(await act(code, seats[0], pass)).toMatchObject({ ok: true });
    // The same pass built for the previous actor no longer applies after control moved.
    expect(await store.applyIntent(code, seats[0], pass, {}, { id: "stale", expectedVersion: room.version }))
      .toEqual({ ok: false, error: "stale room version" });
  });

  it("applies priority and standing orders to both seats", async () => {
    const { code, seats } = await soloRoom();
    await startSolo(code, seats);
    let room = (await store.getRoom(code))!;
    expect(stateMessage(room, 0)).not.toHaveProperty("botGame");
    expect(await store.setPriorityMode(code, seats[1], "auto-pass")).toMatchObject({ ok: true });
    room = (await store.getRoom(code))!;
    expect(room.seats.map((seat) => seat!.priorityMode)).toEqual(["auto-pass", "auto-pass"]);
    const orders = { "test-hook": { prompt: "yes" } };
    expect(await store.setStandingOrders(code, seats[0], orders)).toMatchObject({ ok: true });
    room = (await store.getRoom(code))!;
    expect(room.seats.map((seat) => seat!.standingOrders)).toEqual([orders, orders]);
  });

  it("leaves player-room projections and log privacy unchanged", async () => {
    const [hostId, guestId] = [await user("Host"), await user("Guest")];
    const host = await store.createRoom("cc", { deckId: DECKS[0], userId: hostId });
    await db.query(
      `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
       SELECT room_code, 'host', token_hash, seat, $2::bigint FROM room_seats WHERE room_code = $1`,
      [host.code, Date.now()],
    );
    const guest = await store.joinRoom(host.code, undefined, { allowPlayer: true, deckId: DECKS[1], userId: guestId });
    if (!guest.ok || guest.kind !== "player") throw new Error("join failed");
    const credentials: [SeatCredentials, SeatCredentials] = [
      { token: host.token, userId: hostId }, { token: guest.token, userId: guestId },
    ];
    const winner = (await store.getRoom(host.code))!.prep!.dieWinner as 0 | 1;
    await store.chooseFirst(host.code, credentials[winner], true);
    for (const seat of [0, 1] as const) {
      const deck = presentation(DECKS[seat]);
      await store.presentArena(host.code, credentials[seat], { weaponIds: deck.weaponIds, equipment: {} });
    }
    await store.presentDeck(host.code, credentials[0], presentation(DECKS[0]));
    await store.presentDeck(host.code, credentials[1], presentation(DECKS[1]));
    const room = (await store.getRoom(host.code))!;
    for (const seat of [0, 1] as const) {
      const message = stateMessage(room, seat) as StateMessage;
      expect(message.view).toEqual(projectStateFor(room.state!, seat, room.code));
      expect(message.yourSeat).toBe(seat);
      expect(message).not.toHaveProperty("boardSeat");
      expect(message).not.toHaveProperty("soloGame");
      expect(message.view.players[1 - seat]!.hand).toEqual([]);
    }
  });

  it("leaving solo prep removes the delegated seat", async () => {
    const { code, seats } = await soloRoom();
    expect(await store.leaveRoom(code, seats[1])).toMatchObject({ ok: true, freedSeat: 0, remaining: null });
    const room = (await store.getRoom(code))!;
    expect(room.seats).toEqual([null, null]);
  });

  it("keeps other accounts out of both seats", async () => {
    const { code, seats } = await soloRoom();
    const otherId = await user("Other");
    const joined = await store.joinRoom(code, undefined, {
      allowPlayer: true, deckId: DECKS[0], username: "Other", userId: otherId,
    });
    expect(joined).toMatchObject({ ok: true, kind: "spectator", seat: null });
    expect(await store.joinRoom(code, seats[0].token, { allowPlayer: true, userId: otherId }))
      .toEqual({ ok: false, error: "seat belongs to another account" });
    expect(await store.chooseFirst(code, { token: seats[0].token, userId: otherId, actAs: 1 }, true))
      .toEqual({ ok: false, error: "not a player in this room" });
  });

  it("reuses the owner's credential when it rejoins", async () => {
    const { code, seats } = await soloRoom();
    expect(await store.joinRoom(code, seats[0].token, { allowPlayer: true, userId: seats[0].userId }))
      .toMatchObject({ ok: true, kind: "player", seat: 0, token: seats[0].token, reconnected: true });
  });

  it("ignores actAs in player and bot rooms", async () => {
    const [hostId, guestId] = [await user("Host"), await user("Guest")];
    const host = await store.createRoom("cc", { deckId: DECKS[0], userId: hostId });
    await db.query(
      `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
       SELECT room_code, 'host', token_hash, seat, $2::bigint FROM room_seats WHERE room_code = $1`,
      [host.code, Date.now()],
    );
    const guest = await store.joinRoom(host.code, undefined, { allowPlayer: true, deckId: DECKS[1], userId: guestId });
    if (!guest.ok || guest.kind !== "player") throw new Error("join failed");
    const winner = (await store.getRoom(host.code))!.prep!.dieWinner as 0 | 1;
    const credentials = [{ token: host.token, userId: hostId }, { token: guest.token, userId: guestId }];
    const asOpponent = { ...credentials[winner]!, actAs: (1 - winner) as 0 | 1 };
    expect(await store.chooseFirst(host.code, asOpponent, true)).toMatchObject({ ok: true });
    expect((await store.getRoom(host.code))!.prep!.startPlayer).toBe(winner);
    const deck = presentation(DECKS[winner]);
    expect(await store.presentArena(host.code, asOpponent, { weaponIds: deck.weaponIds, equipment: {} }))
      .toMatchObject({ ok: true });
    const pvp = (await store.getRoom(host.code))!;
    expect(pvp.prep!.arenas[winner]).not.toBeNull();
    expect(pvp.prep!.arenas[1 - winner]).toBeNull();

    const botOwner = await user("BotOwner");
    const bot = await store.createBotRoom("cc", { deckId: DECKS[0], username: "BotOwner", userId: botOwner });
    expect(await store.chooseFirst(bot.code, { token: bot.token, userId: botOwner, actAs: 1 }, true))
      .toMatchObject({ ok: true });
    const botRoom = (await store.getRoom(bot.code))!;
    // The acting seat stayed the human's, so "first" picked seat 0.
    expect(botRoom.prep!.startPlayer).toBe(0);
    expect(stateMessage(botRoom, 0)).toBeNull();
    expect(prepViewFor(botRoom, 0).soloGame).toBeUndefined();
  });
});

describe("solo rooms over websocket", () => {
  type Socket = {
    ws: WebSocket;
    send: (message: ClientMessage) => void;
    next: (pred: (message: ServerMessage) => boolean) => Promise<ServerMessage>;
  };

  async function connect(port: number, name: string): Promise<Socket> {
    await register(db, name, "password1");
    const session = await login(db, name, "password1");
    if (!session.ok) throw new Error("login failed");
    const ws = new WebSocket(liveWebSocketUrl(`ws://localhost:${port}`));
    const decoder = new LiveServerMessageDecoder();
    const inbox: ServerMessage[] = [];
    const waiters: Array<{ pred: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void }> = [];
    ws.on("message", (raw) => {
      const message = decoder.decode(JSON.parse(String(raw)));
      if (!message) throw new Error("invalid server frame");
      const waiter = waiters.findIndex((candidate) => candidate.pred(message));
      if (waiter === -1) inbox.push(message);
      else waiters.splice(waiter, 1)[0]!.resolve(message);
    });
    await new Promise((resolve) => ws.once("open", resolve));
    const socket: Socket = {
      ws,
      send: (message) => ws.send(JSON.stringify(message)),
      next: (pred) => new Promise((resolve, reject) => {
        const index = inbox.findIndex(pred);
        if (index !== -1) return resolve(inbox.splice(index, 1)[0]!);
        waiters.push({ pred, resolve });
        setTimeout(() => reject(new Error(`timeout; inbox=${JSON.stringify(inbox.filter((m) => m.type === "error"))}`)), 10_000);
      }),
    };
    socket.send({ type: "auth", token: session.token });
    await socket.next((message) => message.type === "authed");
    return socket;
  }

  type Prep = Extract<ServerMessage, { type: "prep-state" }>;
  type State = Extract<ServerMessage, { type: "state" }>;

  it("creates a solo room, switches seats, and plays both sides", async () => {
    const server = createGameServer(0, { db, rooms: store });
    const sockets: Socket[] = [];
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const port = (server.address() as AddressInfo).port;
      const owner = await connect(port, "SoloOwner");
      const other = await connect(port, "SoloOther");
      sockets.push(owner, other);

      owner.send({ type: "solo-seat", seat: 1 });
      expect(await owner.next((m) => m.type === "error")).toMatchObject({ message: "not in a solo room" });

      owner.send({ type: "create-solo-room", format: "cc", deckId: DECKS[0], opponentDeckId: "precon-missing" });
      expect(await owner.next((m) => m.type === "error")).toMatchObject({ type: "error" });

      owner.send({ type: "create-solo-room", format: "cc", deckId: DECKS[0], opponentDeckId: DECKS[1] });
      const created = await owner.next((m) => m.type === "room-created");
      if (created.type !== "room-created") throw new Error("expected room-created");
      expect(created.seat).toBe(0);
      const prep0 = await owner.next((m) => m.type === "prep-state") as Prep;
      expect(prep0.prep).toMatchObject({ soloGame: true, yourSeat: 0 });

      owner.send({ type: "solo-seat", seat: 1 });
      const prep1 = await owner.next((m) => m.type === "prep-state" && m.prep.yourSeat === 1) as Prep;
      expect(prep1.version).toBe(prep0.version);
      expect(prep1.prep.yourDeckId).toBe(DECKS[1]);

      owner.send({ type: "choose-first", first: true });
      await owner.next((m) => m.type === "prep-state" && m.prep.startPlayer === 1 && m.prep.yourSeat === 1);
      for (const seat of [1, 0] as const) {
        owner.send({ type: "solo-seat", seat });
        await owner.next((m) => m.type === "prep-state" && m.prep.yourSeat === seat);
        const deck = presentation(DECKS[seat]);
        owner.send({ type: "present-arena", arena: { weaponIds: deck.weaponIds, equipment: {} } });
        await owner.next((m) => m.type === "prep-state" && !!m.prep.yourArena);
      }
      for (const seat of [0, 1] as const) {
        owner.send({ type: "solo-seat", seat });
        await owner.next((m) => m.type === "prep-state" && m.prep.yourSeat === seat);
        owner.send({ type: "present-deck", deck: presentation(DECKS[seat]) });
      }
      await owner.next((m) => m.type === "game-started");
      const started = await owner.next((m) => m.type === "state") as State;
      expect(started).toMatchObject({ yourSeat: 1, boardSeat: 0, soloGame: true });
      expect(started.view.activePlayer).toBe(1);
      expect(started.view.players[0].hand.length).toBeGreaterThan(0);
      expect(started.view.players[1].hand.length).toBeGreaterThan(0);

      owner.send({ type: "solo-seat", seat: 0 });
      expect(await owner.next((m) => m.type === "error"))
        .toMatchObject({ message: "control follows the acting seat once the game starts" });

      // Pass until control moves to seat 0; each step is fenced to the version shown.
      let shown = started;
      for (let step = 0; step < 10 && shown.yourSeat === 1; step++) {
        const pass = shown.legal.find((intent) => intent.kind === "pass")!;
        owner.send({ type: "intent", intent: pass, commandId: randomUUID(), expectedVersion: shown.version });
        const version = shown.version;
        shown = await owner.next((m) => m.type === "state" && m.version > version) as State;
      }
      expect(shown).toMatchObject({ yourSeat: 0, boardSeat: 0 });
      expect(shown.transition).toMatchObject({ kind: "forward", fromVersion: shown.version - 1 });
      expect((await store.getRoom(created.code))!.version).toBe(shown.version);

      // A stale pass built for seat 1 is fenced off now that seat 0 acts.
      owner.send({ type: "intent", intent: { kind: "pass" }, commandId: randomUUID(), expectedVersion: shown.version - 1 });
      expect(await owner.next((m) => m.type === "error")).toMatchObject({ message: "stale room version" });

      other.send({ type: "join-room", code: created.code });
      expect(await other.next((m) => m.type === "joined")).toMatchObject({ seat: null, spectator: true });
      other.send({ type: "solo-seat", seat: 1 });
      expect(await other.next((m) => m.type === "error")).toMatchObject({ message: "not in a solo room" });

      owner.send({ type: "leave-room", endGame: true });
      expect(await owner.next((m) => m.type === "left")).toEqual({
        type: "left",
        playAgainSolo: { format: "cc", deckId: DECKS[0], opponentDeckId: DECKS[1] },
      });
      expect(await store.getRoom(created.code)).toBeNull();
    } finally {
      for (const socket of sockets) socket.ws.close();
      await closeGameServer(server);
    }
  }, 30_000);
});
