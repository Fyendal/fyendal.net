import { beforeEach, describe, expect, it } from "vitest";
import { precon } from "@fyendal/cards";
import { legalIntents } from "@fyendal/engine";
import { decodeRoomClock, decodeServerMessage } from "@fyendal/protocol";
import type { GameIntent, PresentedDeck } from "@fyendal/shared";
import type { Queryable } from "../db.js";
import { finalizeReplay, getReplay } from "../replays.js";
import { dehydrateState, PgRoomStore, stateMessage } from "../store.js";
import { freshDb } from "./testdb.js";

let db: Queryable;
let store: PgRoomStore;
let now: number;

beforeEach(async () => {
  db = await freshDb();
  now = 1_000_000;
  store = new PgRoomStore(db, "rules-a", () => now);
});

function presentation(deckId: string): PresentedDeck {
  const pool = precon(deckId)!.pool;
  return { weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck };
}

async function readyBoth(code: string, tokens: readonly [string, string]): Promise<void> {
  const room = (await store.getRoom(code))!;
  const seats = ([0, 1] as const).map((seat) => ({
    deck: presentation(room.seats[seat]!.deckId!),
    credentials: { token: tokens[seat], userId: room.seats[seat]?.userId },
  }));
  for (const { deck, credentials } of seats) {
    const arena = { weaponIds: deck.weaponIds, equipment: deck.equipment };
    const locked = await store.presentArena(code, credentials, arena);
    if (!locked.ok) throw new Error(locked.error);
  }
  for (const { deck, credentials } of seats) {
    const ready = await store.presentDeck(code, credentials, deck);
    if (!ready.ok) throw new Error(ready.error);
  }
}

async function markHostPresent(code: string): Promise<void> {
  await db.query(
    `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
     SELECT room_code, 'clock-host', token_hash, seat, $2::bigint
     FROM room_seats WHERE room_code = $1 AND seat = 0`,
    [code, Date.now()],
  );
}

async function startedRoom(): Promise<{ code: string; tokens: [string, string] }> {
  const host = await store.createRoom("cc", { deckId: "precon-asb" });
  await markHostPresent(host.code);
  const joined = await store.joinRoom(host.code, undefined, { allowPlayer: true, deckId: "precon-asr" });
  if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
  const tokens: [string, string] = [host.token, joined.token];
  const room = (await store.getRoom(host.code))!;
  const chosen = await store.chooseFirst(host.code, { token: tokens[room.prep!.dieWinner] }, true);
  if (!chosen.ok) throw new Error(chosen.error);
  await readyBoth(host.code, tokens);
  return { code: host.code, tokens };
}

async function clockOf(code: string) {
  return (await store.getRoom(code))!.clock!;
}

async function awaited(code: string): Promise<0 | 1> {
  const seat = (await clockOf(code)).awaiting;
  if (seat === null) throw new Error("nothing awaited");
  return seat;
}

function act(code: string, token: string, intent: GameIntent) {
  return store.applyIntent(code, { token }, intent);
}

function nonTerminalIntent(state: Parameters<typeof legalIntents>[0], seat: 0 | 1) {
  const intent = legalIntents(state, seat)
    .find((candidate) => candidate.kind !== "concede" && !candidate.kind.endsWith("-draw"));
  if (!intent) throw new Error("no legal intent");
  return intent;
}

describe("server game clock", () => {
  it("starts when the game starts, not during prep", async () => {
    const host = await store.createRoom("cc", { deckId: "precon-asb" });
    await markHostPresent(host.code);
    const joined = await store.joinRoom(host.code, undefined, { allowPlayer: true, deckId: "precon-asr" });
    if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
    expect((await store.getRoom(host.code))!.clock).toBeNull();
    const room = (await store.getRoom(host.code))!;
    now += 60_000;
    await store.chooseFirst(host.code, { token: [host.token, joined.token][room.prep!.dieWinner]! }, true);
    await readyBoth(host.code, [host.token, joined.token]);
    const started = await store.getRoom(host.code);
    expect(started!.clock).toMatchObject({ since: now, seatMs: [0, 0] });
    expect(started!.clock!.awaiting).toBe(started!.state!.priorityPlayer);
    const stored = await db.query("SELECT clock FROM rooms WHERE code = $1", [host.code]);
    expect(decodeRoomClock(stored.rows[0]!.clock)).toEqual(started!.clock);
  });

  it("charges an applied intent's thinking time to the awaited seat", async () => {
    const { code, tokens } = await startedRoom();
    const room = (await store.getRoom(code))!;
    const actor = await awaited(code);
    now += 7_000;
    expect((await act(code, tokens[actor], nonTerminalIntent(room.state!, actor))).ok).toBe(true);
    const clock = await clockOf(code);
    expect(clock.seatMs[actor]).toBe(7_000);
    expect(clock.seatMs[1 - actor]).toBe(0);
    expect(clock.since).toBe(now);
  });

  it("costs nothing for a window the server auto-passes in the same commit", async () => {
    const { code, tokens } = await startedRoom();
    const room = (await store.getRoom(code))!;
    const first = room.state!.activePlayer as 0 | 1;
    const second = (1 - first) as 0 | 1;
    const state = room.state!;
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
    state.pendingDecision = { player: first, kind: "priority-window", prompt: "Priority" };
    await db.query("UPDATE rooms SET state = $2 WHERE code = $1", [
      code,
      JSON.stringify(dehydrateState(state, "rules-a")),
    ]);
    expect((await store.setPriorityMode(code, { token: tokens[second] }, "auto-pass")).ok).toBe(true);
    const before = await clockOf(code);
    now += 3_000;
    expect((await store.applyIntent(code, { token: tokens[first] }, { kind: "pass" })).ok).toBe(true);
    const after = await clockOf(code);
    expect(after.seatMs[second]).toBe(before.seatMs[second]);
    expect(after.seatMs[first]).toBe(before.seatMs[first] + 3_000);
  });

  it("never refunds time on undo", async () => {
    const { code, tokens } = await startedRoom();
    const room = (await store.getRoom(code))!;
    const actor = await awaited(code);
    now += 4_000;
    expect((await act(code, tokens[actor], nonTerminalIntent(room.state!, actor))).ok).toBe(true);
    const next = await awaited(code);
    now += 1_000;
    expect((await store.undo(code, { token: tokens[actor] })).ok).toBe(true);
    const undone = await clockOf(code);
    expect(undone.seatMs[0] + undone.seatMs[1]).toBe(5_000);
    expect(undone.seatMs[next]).toBeGreaterThanOrEqual(1_000);
    expect(undone.awaiting).toBe(actor);
    now += 2_000;
    expect((await act(code, tokens[actor], nonTerminalIntent(room.state!, actor))).ok).toBe(true);
    const clock = await clockOf(code);
    expect(clock.seatMs[0] + clock.seatMs[1]).toBe(7_000);
  });

  it("charges the final interval on concession and then stops", async () => {
    const { code, tokens } = await startedRoom();
    const actor = await awaited(code);
    now += 9_000;
    expect((await store.applyIntent(code, { token: tokens[actor] }, { kind: "concede" })).ok).toBe(true);
    const clock = await clockOf(code);
    expect(clock.awaiting).toBeNull();
    expect(clock.seatMs[actor]).toBe(9_000);
    now += 60_000;
    const over = (await store.getRoom(code))!;
    const message = stateMessage(over, null, now);
    if (message?.type !== "state") throw new Error("missing state");
    expect(message.clock).toEqual({ awaiting: null, seatMs: clock.seatMs });
  });

  it("charges the claimed seat's idle time on an idle-victory claim", async () => {
    const { code, tokens } = await startedRoom();
    const room = (await store.getRoom(code))!;
    const waitingOn = (room.state!.pendingDecision?.player ?? room.state!.activePlayer) as 0 | 1;
    const idle = await awaited(code);
    now += 150_000;
    const claimed = await store.claimVictory(code, { token: tokens[1 - waitingOn]! }, Date.now() + 10_000_000_000);
    expect(claimed.ok).toBe(true);
    const clock = await clockOf(code);
    expect(clock).toMatchObject({ awaiting: null });
    expect(clock.seatMs[idle]).toBe(150_000);
  });

  it("runs through draw offers and stops at an accepted draw", async () => {
    const { code, tokens } = await startedRoom();
    const actor = await awaited(code);
    now += 1_000;
    expect((await store.applyIntent(code, { token: tokens[0] }, { kind: "offer-draw" })).ok).toBe(true);
    now += 2_000;
    expect((await store.applyIntent(code, { token: tokens[1] }, { kind: "accept-draw" })).ok).toBe(true);
    const clock = await clockOf(code);
    expect(clock.awaiting).toBeNull();
    expect(clock.seatMs[0] + clock.seatMs[1]).toBe(3_000);
    expect(clock.seatMs[actor]).toBeGreaterThanOrEqual(1_000);
  });

  it("charges a bot submission to the bot seat", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('ClockOwner','clockowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("cc", { deckId: "precon-asb", username: "ClockOwner", userId });
    const credentials = { token: created.token, userId };
    await store.chooseFirst(created.code, credentials, false);
    const deck = presentation("precon-asb");
    await store.presentArena(created.code, credentials, { weaponIds: deck.weaponIds, equipment: {} });
    await store.presentDeck(created.code, credentials, deck);
    let room = (await store.getRoom(created.code))!;
    if (!room.state) {
      await store.chooseFirst(created.code, credentials, false);
      room = (await store.getRoom(created.code))!;
    }
    expect(room.clock?.awaiting).toBe(1);
    now += 2_500;
    const applied = await store.applyBotIntent(created.code, room.version, nonTerminalIntent(room.state!, 1), {
      credentials,
      command: { id: "clock-bot-command", expectedVersion: room.version },
    });
    expect(applied.ok).toBe(true);
    expect((await clockOf(created.code)).seatMs).toEqual([0, 2_500]);
  });

  it("sends the running clock to players and spectators", async () => {
    const { code } = await startedRoom();
    const actor = await awaited(code);
    const room = (await store.getRoom(code))!;
    for (const seat of [0, 1, null] as const) {
      const message = decodeServerMessage(JSON.parse(JSON.stringify(stateMessage(room, seat, now + 4_000))));
      if (message?.type !== "state") throw new Error("state message failed to decode");
      expect(message.clock).toEqual({ awaiting: actor, seatMs: actor === 0 ? [4_000, 0] : [0, 4_000] });
    }
  });

  it("stores the final clock once in the finished replay", async () => {
    const { code, tokens } = await startedRoom();
    const userIds = (await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('ClockA','clocka','hash',1) RETURNING id`,
    )).rows.map((row) => Number(row.id));
    const actor = await awaited(code);
    now += 5_000;
    expect((await store.applyIntent(code, { token: tokens[actor] }, { kind: "concede" })).ok).toBe(true);
    const replay = (await db.query("SELECT id FROM replay_games WHERE room_code = $1", [code])).rows[0]!;
    // Anonymous rooms record no participants; attach one to build a payload.
    await db.query(
      "INSERT INTO replay_participants (replay_id, user_id, seat, payload, payload_bytes) VALUES ($1,$2,0,NULL,NULL)",
      [replay.id, userIds[0]],
    );
    expect(await finalizeReplay(db, String(replay.id))).toBe(true);
    const file = await getReplay(db, userIds[0]!, String(replay.id));
    const clock = await clockOf(code);
    expect(file && file.version !== 1 ? file.clock : null).toEqual({ seatMs: clock.seatMs });
    expect((await db.query("SELECT clock FROM replay_games WHERE id = $1", [replay.id])).rows[0]!.clock).toBeNull();
  });
});
