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
const HISTORY_TABLES = [
  "matches", "match_participants", "hero_records",
  "matchup_records", "user_achievements", "daily_game_players",
] as const;

function presentation(deckId: string): PresentedDeck {
  const pool = precon(deckId)!.pool;
  return { weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck };
}

async function count(table: string): Promise<number> {
  return Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]!.n);
}

async function sandboxBotGame(): Promise<{ code: string; human: SeatCredentials }> {
  const { rows } = await db.query(
    "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ('Alice','alice','hash',1) RETURNING id",
  );
  const userId = Number(rows[0]!.id);
  const created = await store.createBotRoom("cc", { deckId: DECK, username: "Alice", userId }, "legal", "ira", true);
  const human = { token: created.token, userId };
  const prepRoom = (await store.getRoom(created.code))!;
  expect(prepRoom.sandbox).toBe(true);
  expect(isSandboxRoom(prepRoom)).toBe(true);
  expect(prepViewFor(prepRoom, 0).sandbox).toBe(true);
  await store.chooseFirst(created.code, human, true);
  const deck = presentation(DECK);
  await store.presentArena(created.code, human, { weaponIds: deck.weaponIds, equipment: {} });
  await store.presentDeck(created.code, human, deck);
  if (!(await store.getRoom(created.code))!.state) await store.chooseFirst(created.code, human, true);
  expect((await store.getRoom(created.code))!.state).not.toBeNull();
  return { code: created.code, human };
}

async function edit(code: string, credentials: SeatCredentials, seat: 0 | 1, change: ManualEdit) {
  const room = (await store.getRoom(code))!;
  return store.sandboxEdit(code, credentials, seat, change, { id: `edit-${++commandCounter}`, expectedVersion: room.version });
}

function codeOf(error: string) {
  const wire = encodeWireMessage({ type: "error", message: error });
  return wire.type === "error" ? wire.code : null;
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

describe("sandbox bot rooms", () => {
  it("lets the human edit only their own seat", async () => {
    const { code, human } = await sandboxBotGame();
    const room = (await store.getRoom(code))!;
    const botCard = room.state!.players[1]!.hand[0]!.instanceId;
    for (const change of [
      { kind: "set-life", life: 5 },
      { kind: "set-resources", resources: 3 },
      { kind: "shuffle-deck" },
      { kind: "move-card", instanceId: botCard, to: "graveyard" },
    ] as const) {
      const refused = await edit(code, human, 1, change);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(codeOf(refused.error)).toBe("SANDBOX_SEAT_FORBIDDEN");
    }
    const byInstance = await edit(code, human, 0, { kind: "move-card", instanceId: botCard, to: "graveyard" });
    expect(byInstance.ok).toBe(false);
    expect(await edit(code, human, 0, { kind: "set-life", life: 30 })).toMatchObject({ ok: true });
    const after = (await store.getRoom(code))!;
    expect(after.state!.players[0]!.life).toBe(30);
    expect(after.state!.players[1]).toEqual(room.state!.players[1]);
  });

  it("reveals the human's deck to the human, never to the bot task", async () => {
    const { code, human } = await sandboxBotGame();
    const before = (await store.getRoom(code))!;
    const order = before.state!.players[0]!.deck.map((card) => card.instanceId);
    expect(await edit(code, human, 0, { kind: "reorder-deck", instanceIds: [...order].reverse() })).toMatchObject({ ok: true });
    const room = (await store.getRoom(code))!;
    const humanView = stateMessage(room, 0);
    if (humanView?.type !== "state") throw new Error("expected state");
    expect(humanView.sandbox).toBe(true);
    expect(humanView.view.players[0].deck?.map((card) => card.instanceId)).toEqual([...order].reverse());
    const botView = stateMessage(room, 1);
    if (botView?.type !== "state") throw new Error("expected state");
    expect(botView.view.players[0].deck).toBeUndefined();
    expect(botView.view.players[1].deck).toBeUndefined();

    let botTurn = (await store.getRoom(code))!;
    for (let step = 0; step < 40 && actor(botTurn) !== 1; step++) {
      await humanStep(code, human, botTurn);
      botTurn = (await store.getRoom(code))!;
    }
    const task = clientBotTask(botTurn, "a".repeat(64), 0);
    if (task?.type !== "bot-task") throw new Error("expected a bot task");
    expect(task.view.players[0].deck).toBeUndefined();
    expect(task.view.players[1].deck).toBeUndefined();
    // The task is the same whatever order the human's deck is in.
    botTurn.state!.players[0]!.deck.reverse();
    expect(clientBotTask(botTurn, "a".repeat(64), 0)).toEqual(task);
  });

  it("keeps the bot playing legally after life, resource, and deck edits, then records only a replay", async () => {
    const { code, human } = await sandboxBotGame();
    const room = (await store.getRoom(code))!;
    const deck = room.state!.players[0]!.deck.map((card) => card.instanceId);
    expect(await edit(code, human, 0, { kind: "reorder-deck", instanceIds: [...deck].reverse() })).toMatchObject({ ok: true });
    expect(await edit(code, human, 0, { kind: "set-life", life: 12 })).toMatchObject({ ok: true });
    expect(await edit(code, human, 0, { kind: "set-resources", resources: 2 })).toMatchObject({ ok: true });

    // A bot result computed before an edit goes stale on the version bump.
    const observed = (await store.getRoom(code))!;
    expect(await edit(code, human, 0, { kind: "move-card", instanceId: deck[0]!, to: "graveyard" })).toMatchObject({ ok: true });
    expect(await store.applyBotIntent(code, observed.version, null, {
      credentials: human, command: { id: `stale-${++commandCounter}`, expectedVersion: observed.version },
    })).toMatchObject({ ok: false, error: "stale room version" });

    expect(await advance(code, human, 120)).toBeGreaterThan(0);
    const end = (await store.getRoom(code))!;
    if (end.state!.phase !== "game-over") {
      expect(await store.applyIntent(code, human, { kind: "concede" })).toMatchObject({ ok: true });
    }
    expect((await store.getRoom(code))!.state!.phase).toBe("game-over");
    for (const table of HISTORY_TABLES) expect(await count(table), table).toBe(0);
    expect(await count("analytics_events")).toBe(0);
    expect(await finalizeReplayForRoom(db, code)).toBe(true);
    expect(await listReplays(db, human.userId!)).toEqual([expect.objectContaining({ sandbox: true, yourSeat: 0 })]);
  });

  it("offers a sandbox rematch", async () => {
    const { code, human } = await sandboxBotGame();
    expect(await store.applyIntent(code, human, { kind: "concede" })).toMatchObject({ ok: true });
    const left = await store.deletePracticeRoom(code, human);
    expect(left).toMatchObject({ ok: true, playAgain: { format: "cc", deckId: DECK, bot: "ira", sandbox: true } });
  });
});
