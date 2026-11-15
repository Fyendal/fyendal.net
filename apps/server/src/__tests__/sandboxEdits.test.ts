import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { precon } from "@fyendal/cards";
import { legalIntents } from "@fyendal/engine";
import type { GameIntent, ManualEdit, PresentedDeck, ServerMessage } from "@fyendal/shared";
import type { Queryable } from "../db.js";
import { encodeWireMessage } from "../errors.js";
import { PgRoomStore, stateMessage, type SeatCredentials } from "../store.js";
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
let commandCounter = 0;

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

type Seats = readonly [SeatCredentials, SeatCredentials];

async function privateGame(sandbox: boolean): Promise<{ code: string; seats: Seats }> {
  const users = [await user("Alice"), await user("Bob")] as const;
  const host = await store.createRoom(
    "cc", { deckId: DECKS[0], userId: users[0], username: "Alice" }, "private", "legal", sandbox,
  );
  await db.query(
    `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
     SELECT room_code, 'host', token_hash, seat, $2::bigint FROM room_seats WHERE room_code = $1 AND seat = 0`,
    [host.code, Date.now()],
  );
  const joined = await store.joinRoom(host.code, undefined, {
    allowPlayer: true, deckId: DECKS[1], userId: users[1], username: "Bob",
  });
  if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
  const seats = [{ token: host.token, userId: users[0] }, { token: joined.token, userId: users[1] }] as const;
  const room = (await store.getRoom(host.code))!;
  expect(await store.chooseFirst(host.code, seats[room.prep!.dieWinner], true)).toMatchObject({ ok: true });
  for (const seat of [0, 1] as const) {
    const deck = presentation(DECKS[seat]);
    expect(await store.presentArena(host.code, seats[seat], { weaponIds: deck.weaponIds, equipment: {} }))
      .toMatchObject({ ok: true });
  }
  for (const seat of [0, 1] as const) {
    expect(await store.presentDeck(host.code, seats[seat], presentation(DECKS[seat]))).toMatchObject({ ok: true });
  }
  expect((await store.getRoom(host.code))!.state).not.toBeNull();
  return { code: host.code, seats };
}

async function soloGame(): Promise<{ code: string; seats: [SeatCredentials, SeatCredentials] }> {
  const userId = await user("Soloist");
  const created = await store.createSoloRoom(
    "cc", { deckId: DECKS[0], username: "Soloist", userId }, { deckId: DECKS[1] },
  );
  const real = { token: created.token, userId };
  const seats: [SeatCredentials, SeatCredentials] = [real, { ...real, actAs: 1 }];
  expect(await store.chooseFirst(created.code, seats[1], true)).toMatchObject({ ok: true });
  for (const seat of [0, 1] as const) {
    const deck = presentation(DECKS[seat]);
    expect(await store.presentArena(created.code, seats[seat], { weaponIds: deck.weaponIds, equipment: {} }))
      .toMatchObject({ ok: true });
  }
  for (const seat of [0, 1] as const) {
    expect(await store.presentDeck(created.code, seats[seat], presentation(DECKS[seat]))).toMatchObject({ ok: true });
  }
  expect((await store.getRoom(created.code))!.state).not.toBeNull();
  return { code: created.code, seats };
}

async function edit(code: string, credentials: SeatCredentials, seat: 0 | 1, change: ManualEdit) {
  const room = (await store.getRoom(code))!;
  const command = { id: `edit-${++commandCounter}`, expectedVersion: room.version };
  return store.sandboxEdit(code, credentials, seat, change, command);
}

function codeOf(error: string) {
  const wire = encodeWireMessage({ type: "error", message: error });
  return wire.type === "error" ? wire.code : null;
}

describe("sandbox edits", () => {
  it("lets a private sandbox player edit only their own seat, visible to the opponent", async () => {
    const { code, seats } = await privateGame(true);
    expect(await edit(code, seats[0], 0, { kind: "set-life", life: 33 })).toMatchObject({ ok: true });
    expect(await edit(code, seats[0], 0, { kind: "set-resources", resources: 4 })).toMatchObject({ ok: true });
    const room = (await store.getRoom(code))!;
    expect(room.state!.players[0]!.life).toBe(33);
    expect(room.state!.players[0]!.resources).toBe(4);
    const opponentView = stateMessage(room, 1);
    if (opponentView?.type !== "state") throw new Error("expected state");
    expect(opponentView.view.players[0]!.life).toBe(33);
    expect(JSON.stringify(opponentView.view.logEntries)).toContain("engine.log.manual.life");
    expect(JSON.stringify(opponentView.view.logEntries)).toContain("engine.log.manual.resources");

    const refused = await edit(code, seats[0], 1, { kind: "set-life", life: 1 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(codeOf(refused.error)).toBe("SANDBOX_SEAT_FORBIDDEN");
    expect(await edit(code, seats[1], 1, { kind: "set-life", life: 5 })).toMatchObject({ ok: true });
    expect((await store.getRoom(code))!.state!.players[1]!.life).toBe(5);
  });

  it("refuses edits outside sandbox rooms", async () => {
    const { code, seats } = await privateGame(false);
    const refused = await edit(code, seats[0], 0, { kind: "set-life", life: 10 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(codeOf(refused.error)).toBe("SANDBOX_REQUIRED");
  });

  it("refuses spectators and unknown tokens", async () => {
    const { code } = await privateGame(true);
    const watcherId = await user("Watcher");
    const watcher = await store.joinRoom(code, undefined, {
      allowPlayer: false, userId: watcherId, username: "Watcher",
    });
    if (!watcher.ok) throw new Error(watcher.error);
    expect(watcher.kind).toBe("spectator");
    for (const credentials of [{ token: watcher.token, userId: watcherId }, { token: "not-a-token" }]) {
      for (const seat of [0, 1] as const) {
        const refused = await edit(code, credentials, seat, { kind: "set-life", life: 10 });
        expect(refused).toEqual({ ok: false, error: "not a player in this room" });
      }
    }
  });

  it("refuses out-of-range values and edits after game over", async () => {
    const { code, seats } = await privateGame(true);
    const range = await edit(code, seats[0], 0, { kind: "set-life", life: 0 });
    expect(range.ok).toBe(false);
    if (!range.ok) expect(codeOf(range.error)).toBe("SANDBOX_EDIT_UNAVAILABLE");
    expect(await store.applyIntent(code, seats[0], { kind: "concede" })).toMatchObject({ ok: true });
    const over = await edit(code, seats[1], 1, { kind: "set-life", life: 10 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(codeOf(over.error)).toBe("SANDBOX_EDIT_UNAVAILABLE");
  });

  it("lets the solo owner edit both seats whoever is acting", async () => {
    const { code, seats } = await soloGame();
    const acting = (await store.getRoom(code))!.state!.priorityPlayer;
    for (const credentials of seats) {
      for (const seat of [0, 1] as const) {
        expect(await edit(code, credentials, seat, { kind: "set-life", life: 10 + seat })).toMatchObject({ ok: true });
      }
    }
    const state = (await store.getRoom(code))!.state!;
    expect(state.players.map((p) => p.life)).toEqual([10, 11]);
    expect(state.priorityPlayer).toBe(acting);
    const room = (await store.getRoom(code))!;
    expect(await store.sandboxEdit(code, seats[0], 0, { kind: "set-life", life: 9 }))
      .toEqual({ ok: false, error: "solo actions require an expected room version" });
    expect(room.version).toBe((await store.getRoom(code))!.version);
  });

  it("fences stale versions and deduplicates command ids", async () => {
    const { code, seats } = await privateGame(true);
    const room = (await store.getRoom(code))!;
    const command = { id: "dup-edit", expectedVersion: room.version };
    const first = await store.sandboxEdit(code, seats[0], 0, { kind: "set-life", life: 12 }, command);
    expect(first).toMatchObject({ ok: true, version: room.version + 1 });
    expect(await store.sandboxEdit(code, seats[0], 0, { kind: "set-life", life: 12 }, command)).toEqual(first);
    expect((await store.getRoom(code))!.version).toBe(room.version + 1);
    const stale = await store.sandboxEdit(code, seats[0], 0, { kind: "set-life", life: 13 }, {
      id: "stale-edit", expectedVersion: room.version,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(codeOf(stale.error)).toBe("RESYNC_REQUIRED");
    expect((await store.getRoom(code))!.state!.players[0]!.life).toBe(12);
  });

  it("undo restores the pre-edit state", async () => {
    const { code, seats } = await soloGame();
    const before = (await store.getRoom(code))!.state!;
    expect(await edit(code, seats[0], 1, { kind: "set-resources", resources: 7 })).toMatchObject({ ok: true });
    expect((await store.getRoom(code))!.state!.players[1]!.resources).toBe(7);
    const room = (await store.getRoom(code))!;
    expect(await store.undo(code, seats[0], "last-action", { id: "undo-edit", expectedVersion: room.version }))
      .toMatchObject({ ok: true });
    const restored = (await store.getRoom(code))!.state!;
    expect(restored.players[1]!.resources).toBe(before.players[1]!.resources);
    expect(restored.players.map((p) => p.life)).toEqual(before.players.map((p) => p.life));
    expect(JSON.stringify(restored.log)).not.toContain("engine.log.manual.resources");
  });

  it("shows a private sandbox player their own deck in order, and nobody else", async () => {
    const { code, seats } = await privateGame(true);
    const room = (await store.getRoom(code))!;
    const order = (seat: number) => room.state!.players[seat]!.deck.map((card) => card.instanceId);
    const own = viewOf(stateMessage(room, 0));
    expect(own.players[0]!.deck?.map((card) => card.instanceId)).toEqual(order(0));
    expect(own.players[1]!.deck).toBeUndefined();
    const opponent = viewOf(stateMessage(room, 1));
    expect(opponent.players[1]!.deck?.map((card) => card.instanceId)).toEqual(order(1));
    expect(opponent.players[0]!.deck).toBeUndefined();
    expect(viewOf(stateMessage(room, null)).players.map((p) => p.deck)).toEqual([undefined, undefined]);

    expect(await edit(code, seats[0], 0, { kind: "reorder-deck", instanceIds: [...order(0)].reverse() }))
      .toMatchObject({ ok: true });
    const edited = (await store.getRoom(code))!;
    const watcher = viewOf(stateMessage(edited, null));
    const rival = viewOf(stateMessage(edited, 1));
    for (const view of [watcher, rival]) {
      expect(view.players[0]!.deck).toBeUndefined();
      expect(JSON.stringify(view.logEntries)).toContain("engine.log.manual.deck.reordered");
    }
    const editEntry = JSON.stringify(rival.logEntries?.at(-1));
    expect(editEntry).not.toContain("cardId");
  });

  it("keeps decks hidden in a non-sandbox private room", async () => {
    const { code } = await privateGame(false);
    const room = (await store.getRoom(code))!;
    for (const viewer of [0, 1, null]) {
      expect(viewOf(stateMessage(room, viewer)).players.map((p) => p.deck)).toEqual([undefined, undefined]);
    }
  });

  it("shows the solo owner both decks and draws the chosen top card", async () => {
    const { code, seats } = await soloGame();
    let room = (await store.getRoom(code))!;
    const view = viewOf(stateMessage(room, 0));
    for (const seat of [0, 1]) {
      expect(view.players[seat]!.deck?.map((card) => card.instanceId))
        .toEqual(room.state!.players[seat]!.deck.map((card) => card.instanceId));
    }
    const turn = room.state!.activePlayer as 0 | 1;
    const ids = room.state!.players[turn]!.deck.map((card) => card.instanceId);
    const chosen = ids.at(-1)!;
    expect(await edit(code, seats[0], turn, { kind: "reorder-deck", instanceIds: [chosen, ...ids.slice(0, -1)] }))
      .toMatchObject({ ok: true });
    for (let guard = 0; guard < 40; guard++) {
      room = (await store.getRoom(code))!;
      if (room.state!.activePlayer !== turn) break;
      const actor = room.state!.pendingDecision?.player ?? room.state!.priorityPlayer;
      const intent = endTurnStep(legalIntents(room.state!, actor));
      const applied = await store.applyIntent(code, seats[actor as 0 | 1], intent, {}, {
        id: `end-${++commandCounter}`, expectedVersion: room.version,
      });
      expect(applied, JSON.stringify(intent)).toMatchObject({ ok: true });
    }
    room = (await store.getRoom(code))!;
    expect(room.state!.activePlayer).not.toBe(turn);
    expect(room.state!.players[turn]!.hand.map((card) => card.instanceId)).toContain(chosen);
  });

  it("undo restores the previous deck order", async () => {
    const { code, seats } = await soloGame();
    const before = (await store.getRoom(code))!.state!.players[1]!.deck.map((card) => card.instanceId);
    expect(await edit(code, seats[0], 1, { kind: "reorder-deck", instanceIds: [...before].reverse() }))
      .toMatchObject({ ok: true });
    expect(await edit(code, seats[0], 1, { kind: "shuffle-deck" })).toMatchObject({ ok: true });
    for (let undo = 0; undo < 2; undo++) {
      const room = (await store.getRoom(code))!;
      expect(await store.undo(code, seats[0], "last-action", { id: `undo-deck-${undo}`, expectedVersion: room.version }))
        .toMatchObject({ ok: true });
    }
    expect((await store.getRoom(code))!.state!.players[1]!.deck.map((card) => card.instanceId)).toEqual(before);
  });
});

function viewOf(message: ServerMessage | null) {
  if (message?.type !== "state") throw new Error("expected state");
  return message.view;
}

/** Ends the turn without playing anything, arsenalling a card so the end phase draws one. */
function endTurnStep(legal: GameIntent[]): GameIntent {
  const passive = legal.find((intent) => intent.kind === "choose") ?? legal.find((intent) => intent.kind === "pass");
  if (!passive) throw new Error(`no passive intent in ${JSON.stringify(legal)}`);
  return passive;
}
