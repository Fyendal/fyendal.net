import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { precon } from "@fyendal/cards";
import { legalIntents } from "@fyendal/engine";
import type { GameIntent, ManualEdit, PresentedDeck } from "@fyendal/shared";
import { clientBotTask } from "../clientBotTask.js";
import type { Queryable } from "../db.js";
import { encodeWireMessage } from "../errors.js";
import { finalizeReplayForRoom, listReplays } from "../replays.js";
import { PgRoomStore, isSandboxRoom, prepViewFor, stateMessage, type RoomRow, type SeatCredentials } from "../store.js";
import { freshDb } from "./testdb.js";

let db: Queryable;
let store: PgRoomStore;
let commandCounter = 0;

beforeEach(async () => {
  db = await freshDb();
  store = new PgRoomStore(db, "rules-a");
});

afterEach(async () => {
  await (db as Queryable & { end(): Promise<void> }).end();
});

const DECK = "precon-asb";
const HISTORY_TABLES = ["matches", "match_participants", "hero_records", "matchup_records", "user_achievements"] as const;

function presentation(deckId: string): PresentedDeck {
  const pool = precon(deckId)!.pool;
  return { weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck };
}

async function count(table: string): Promise<number> {
  return Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]!.n);
}

async function user(name: string): Promise<number> {
  const { rows } = await db.query(
    "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ($1,$2,'hash',1) RETURNING id",
    [name, name.toLowerCase()],
  );
  return Number(rows[0]!.id);
}

async function startGame(code: string, human: SeatCredentials): Promise<void> {
  await store.chooseFirst(code, human, true);
  const deck = presentation(DECK);
  await store.presentArena(code, human, { weaponIds: deck.weaponIds, equipment: {} });
  await store.presentDeck(code, human, deck);
  if (!(await store.getRoom(code))!.state) await store.chooseFirst(code, human, true);
  expect((await store.getRoom(code))!.state).not.toBeNull();
}

/** A bot room in prep; `search` starts it as background-search practice. */
async function botRoom(search = false): Promise<{ code: string; human: SeatCredentials }> {
  const userId = await user("Alice");
  if (!search) {
    const created = await store.createBotRoom("cc", { deckId: DECK, username: "Alice", userId }, "legal", "ira");
    return { code: created.code, human: { token: created.token, userId } };
  }
  const queued = await store.queueForMatch("cc", {
    userId, username: "Alice", deckId: DECK, cardPoolMode: "legal",
    pendingBotStart: { format: "cc", deckId: DECK, bot: "ira", requestedAt: Date.now() },
  });
  if (!queued.ok || queued.kind !== "opened") throw new Error("missing search opener");
  const source = await store.startPendingBotPractice(userId);
  if (!source) throw new Error("missing bot practice");
  return { code: source.code, human: { token: source.token, userId } };
}

async function botGame(search = false): Promise<{ code: string; human: SeatCredentials }> {
  const room = await botRoom(search);
  const prep = (await store.getRoom(room.code))!;
  expect(prep.sandbox).toBe(false);
  expect(prepViewFor(prep, 0).sandbox).toBeUndefined();
  await startGame(room.code, room.human);
  return room;
}

async function edit(code: string, credentials: SeatCredentials, seat: 0 | 1, change: ManualEdit) {
  const room = (await store.getRoom(code))!;
  return store.sandboxEdit(code, credentials, seat, change, { id: `edit-${++commandCounter}`, expectedVersion: room.version });
}

function codeOf(error: string) {
  const wire = encodeWireMessage({ type: "error", message: error });
  return wire.type === "error" ? wire.code : null;
}

function expectRefused(result: { ok: boolean; error?: string }, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(codeOf(result.error!)).toBe(code);
}

async function persistedSandbox(code: string): Promise<{ room: boolean; replays: boolean[] }> {
  const room = await db.query("SELECT sandbox FROM rooms WHERE code = $1", [code]);
  const replays = await db.query("SELECT sandbox FROM replay_games WHERE room_code = $1", [code]);
  return { room: room.rows[0]!.sandbox === true, replays: replays.rows.map((row) => row.sandbox === true) };
}

function actor(room: RoomRow): number {
  return room.state!.pendingDecision?.player ?? room.state!.priorityPlayer;
}

/** The human passes when it can, else takes its first legal non-terminal intent. */
async function humanStep(code: string, human: SeatCredentials, room: RoomRow): Promise<void> {
  const legal = legalIntents(room.state!, 0).filter((intent) => !["concede", "offer-draw"].includes(intent.kind));
  const intent: GameIntent = legal.find((candidate) => candidate.kind === "pass") ?? legal[0]!;
  expect(await store.applyIntent(code, human, intent), JSON.stringify(intent)).toMatchObject({ ok: true });
}

/** Advance the game, the bot through its server fallback; returns the bot's move count. */
async function advance(code: string, human: SeatCredentials, steps: number): Promise<number> {
  let botMoves = 0;
  for (let step = 0; step < steps; step++) {
    const room = (await store.getRoom(code))!;
    if (room.state!.phase === "game-over") break;
    if (actor(room) === 1) {
      const applied = await store.applyBotIntent(code, room.version, null, {
        credentials: human, command: { id: `bot-${++commandCounter}`, expectedVersion: room.version },
      });
      expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true });
      botMoves++;
    } else {
      await humanStep(code, human, room);
    }
  }
  return botMoves;
}

async function finish(code: string, human: SeatCredentials): Promise<void> {
  if ((await store.getRoom(code))!.state!.phase !== "game-over") {
    expect(await store.applyIntent(code, human, { kind: "concede" })).toMatchObject({ ok: true });
  }
  expect((await store.getRoom(code))!.state!.phase).toBe("game-over");
  expect(await finalizeReplayForRoom(db, code)).toBe(true);
}

describe("bot rooms turning sandbox", () => {
  it("records an untouched bot game normally", async () => {
    const { code, human } = await botGame();
    const view = stateMessage((await store.getRoom(code))!, 0);
    if (view?.type !== "state") throw new Error("expected state");
    expect(view.sandbox).toBeUndefined();
    expect(view.botGame).toBe(true);
    expect(view.view.players[0].deck).toBeUndefined();
    await finish(code, human);
    expect(await count("matches")).toBe(1);
    expect(await count("match_participants")).toBeGreaterThan(0);
    expect(await count("hero_records")).toBe(1);
    expect(await persistedSandbox(code)).toEqual({ room: false, replays: [false] });
    const [replay] = await listReplays(db, human.userId!);
    expect(replay).toBeDefined();
    expect(replay!.sandbox).toBeUndefined();
  });

  it("converts on the first accepted edit, keeps the bot legal, and records only a sandbox replay", async () => {
    const { code, human } = await botGame();
    expect(await edit(code, human, 0, { kind: "set-life", life: 12 })).toMatchObject({ ok: true });
    const room = (await store.getRoom(code))!;
    expect(room.sandbox).toBe(true);
    expect(isSandboxRoom(room)).toBe(true);
    expect(room.state!.players[0]!.life).toBe(12);
    expect(await persistedSandbox(code)).toEqual({ room: true, replays: [true] });
    const view = stateMessage(room, 0);
    if (view?.type !== "state") throw new Error("expected state");
    expect(view.sandbox).toBe(true);
    expect(view.view.players[0].deck?.map((card) => card.instanceId))
      .toEqual(room.state!.players[0]!.deck.map((card) => card.instanceId));

    // A bot result computed before an edit goes stale on the version bump.
    const observed = (await store.getRoom(code))!;
    expect(await edit(code, human, 0, { kind: "set-resources", resources: 2 })).toMatchObject({ ok: true });
    expect(await store.applyBotIntent(code, observed.version, null, {
      credentials: human, command: { id: `stale-${++commandCounter}`, expectedVersion: observed.version },
    })).toMatchObject({ ok: false, error: "stale room version" });

    expect(await advance(code, human, 120)).toBeGreaterThan(0);
    await finish(code, human);
    for (const table of HISTORY_TABLES) expect(await count(table), table).toBe(0);
    expect(await count("analytics_events")).toBe(0);
    expect(await persistedSandbox(code)).toEqual({ room: true, replays: [true] });
    expect(await listReplays(db, human.userId!)).toEqual([expect.objectContaining({ sandbox: true, yourSeat: 0 })]);
  });

  it("does not convert on a refused edit", async () => {
    const { code, human } = await botGame();
    const before = (await store.getRoom(code))!;
    const botCard = before.state!.players[1]!.hand[0]!.instanceId;
    expectRefused(await edit(code, human, 0, { kind: "set-life", life: 0 }), "SANDBOX_EDIT_UNAVAILABLE");
    expectRefused(await edit(code, human, 0, { kind: "move-card", instanceId: botCard, to: "graveyard" }), "SANDBOX_EDIT_UNAVAILABLE");
    for (const change of [{ kind: "set-life", life: 5 }, { kind: "reveal-deck" }] as const) {
      expectRefused(await edit(code, human, 1, change), "SANDBOX_SEAT_FORBIDDEN");
    }
    const after = (await store.getRoom(code))!;
    expect(after.sandbox).toBe(false);
    expect(after.version).toBe(before.version);
    expect(await persistedSandbox(code)).toEqual({ room: false, replays: [false] });
  });

  it("converts on reveal-deck without changing the game or the bot's task", async () => {
    const { code, human } = await botGame();
    let room = (await store.getRoom(code))!;
    for (let step = 0; step < 40 && actor(room) !== 1; step++) {
      await humanStep(code, human, room);
      room = (await store.getRoom(code))!;
    }
    const task = clientBotTask(room, "a".repeat(64), 0);
    if (task?.type !== "bot-task") throw new Error("expected a bot task");
    const history = await count("room_history");

    expect(await edit(code, human, 0, { kind: "reveal-deck" })).toMatchObject({ ok: true, version: room.version + 1 });
    const revealed = (await store.getRoom(code))!;
    expect(revealed.sandbox).toBe(true);
    expect(revealed.state).toEqual(room.state);
    expect(await count("room_history")).toBe(history);
    const view = stateMessage(revealed, 0);
    if (view?.type !== "state") throw new Error("expected state");
    expect(view.sandbox).toBe(true);
    expect(view.view.players[0].deck?.map((card) => card.instanceId))
      .toEqual(room.state!.players[0]!.deck.map((card) => card.instanceId));
    const botView = stateMessage(revealed, 1);
    if (botView?.type !== "state") throw new Error("expected state");
    expect(botView.view.players[0].deck).toBeUndefined();
    expect(botView.view.players[1].deck).toBeUndefined();
    expect(clientBotTask(revealed, "a".repeat(64), 0)).toEqual({ ...task, version: revealed.version });
    // The task is the same whatever order the human's deck is in.
    revealed.state!.players[0]!.deck.reverse();
    expect(clientBotTask(revealed, "a".repeat(64), 0)).toEqual({ ...task, version: revealed.version });

    // In a room that is already sandbox it changes nothing at all.
    expect(await edit(code, human, 0, { kind: "reveal-deck" })).toEqual({ ok: true, version: revealed.version });
    expect((await store.getRoom(code))!.version).toBe(revealed.version);
  });

  it("keeps the room sandbox when the converting edit is undone", async () => {
    const { code, human } = await botGame();
    const life = (await store.getRoom(code))!.state!.players[0]!.life;
    expect(await edit(code, human, 0, { kind: "set-life", life: 30 })).toMatchObject({ ok: true });
    const converted = (await store.getRoom(code))!;
    expect(await store.undo(code, human, "last-action", {
      id: `undo-${++commandCounter}`, expectedVersion: converted.version,
    })).toMatchObject({ ok: true });
    const undone = (await store.getRoom(code))!;
    expect(undone.state!.players[0]!.life).toBe(life);
    expect(undone.sandbox).toBe(true);
    expect(await persistedSandbox(code)).toEqual({ room: true, replays: [true] });
    await finish(code, human);
    for (const table of HISTORY_TABLES) expect(await count(table), table).toBe(0);
  });

  it("refuses conversion before the game starts, after game over, and for spectators", async () => {
    const { code, human } = await botRoom();
    expectRefused(await edit(code, human, 0, { kind: "reveal-deck" }), "SANDBOX_EDIT_UNAVAILABLE");
    expect((await store.getRoom(code))!.sandbox).toBe(false);

    await startGame(code, human);
    const watcherId = await user("Watcher");
    const watcher = await store.joinRoom(code, undefined, { allowPlayer: false, userId: watcherId, username: "Watcher" });
    if (!watcher.ok || watcher.kind !== "spectator") throw new Error("spectate failed");
    expect(await edit(code, { token: watcher.token, userId: watcherId }, 0, { kind: "reveal-deck" }))
      .toEqual({ ok: false, error: "not a player in this room" });
    expect(await edit(code, { token: "not-a-token" }, 0, { kind: "reveal-deck" }))
      .toEqual({ ok: false, error: "not a player in this room" });
    expect((await store.getRoom(code))!.sandbox).toBe(false);

    expect(await store.applyIntent(code, human, { kind: "concede" })).toMatchObject({ ok: true });
    for (const change of [{ kind: "reveal-deck" }, { kind: "set-life", life: 5 }] as const) {
      expectRefused(await edit(code, human, 0, change), "SANDBOX_EDIT_UNAVAILABLE");
    }
    expect((await store.getRoom(code))!.sandbox).toBe(false);
    expect(await count("matches")).toBe(1);
  });

  it("refuses edits in public and matchmade rooms", async () => {
    const hostId = await user("Host");
    const host = await store.createRoom("cc", { deckId: DECK, userId: hostId, username: "Host" }, "public");
    expectRefused(await edit(host.code, { token: host.token, userId: hostId }, 0, { kind: "reveal-deck" }), "SANDBOX_REQUIRED");

    const [a, b] = [await user("MatchA"), await user("MatchB")];
    const opened = await store.queueForMatch("cc", { userId: a, username: "MatchA", deckId: DECK, cardPoolMode: "legal" });
    if (!opened.ok || opened.kind !== "opened") throw new Error("queue did not open a room");
    const opener = await store.joinRoom(opened.code, undefined, { allowPlayer: true, userId: a });
    if (!opener.ok || opener.kind !== "player") throw new Error("reclaim failed");
    await store.markPresent(opened.code, opener.token, "a", 0, a);
    const matched = await store.queueForMatch("cc", { userId: b, username: "MatchB", deckId: DECK, cardPoolMode: "legal" });
    if (!matched.ok || matched.kind !== "matched") throw new Error("match failed");
    const seat = await store.joinRoom(matched.code, undefined, { allowPlayer: true, userId: b });
    if (!seat.ok || seat.kind !== "player") throw new Error("reclaim failed");
    expectRefused(await edit(matched.code, { token: seat.token, userId: b }, seat.seat as 0 | 1, { kind: "reveal-deck" }), "SANDBOX_REQUIRED");
    for (const code of [host.code, matched.code]) expect((await store.getRoom(code))!.sandbox).toBe(false);
  });

  it("converts a bot game that is searching for a player in the background", async () => {
    const { code, human } = await botGame(true);
    expect((await db.query("SELECT source_room_code FROM matchmaking_entries WHERE user_id = $1", [human.userId])).rows)
      .toEqual([{ source_room_code: code }]);
    expect(await edit(code, human, 0, { kind: "reveal-deck" })).toMatchObject({ ok: true });
    expect(await persistedSandbox(code)).toEqual({ room: true, replays: [true] });
    expect((await db.query("SELECT code FROM rooms WHERE sandbox ORDER BY code")).rows).toEqual([{ code }]);
  });

  it("records nothing when a converted game is ended mid-match, and rematches normally", async () => {
    const plain = await botGame();
    expect(await store.deletePracticeRoom(plain.code, plain.human))
      .toMatchObject({ ok: true, playAgain: { format: "cc", deckId: DECK, bot: "ira" } });
    expect((await db.query("SELECT winner, end_reason FROM matches")).rows).toEqual([{ winner: null, end_reason: "ended" }]);

    const userId = plain.human.userId!;
    const created = await store.createBotRoom("cc", { deckId: DECK, username: "Alice", userId }, "legal", "ira");
    const human = { token: created.token, userId };
    await startGame(created.code, human);
    expect(await edit(created.code, human, 0, { kind: "set-life", life: 9 })).toMatchObject({ ok: true });
    const left = await store.deletePracticeRoom(created.code, human);
    expect(left).toMatchObject({ ok: true });
    if (left.ok) expect(left.playAgain).toEqual({ format: "cc", deckId: DECK, bot: "ira" });
    expect(await count("matches")).toBe(1);
  });
});
