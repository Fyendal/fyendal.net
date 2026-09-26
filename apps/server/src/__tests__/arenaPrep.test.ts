import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardData, decklists, precon } from "@fyendal/cards";
import { botDefinition } from "@fyendal/bot";
import { decodeServerMessage } from "@fyendal/protocol";
import type { PresentedArena } from "@fyendal/shared";
import { PgRoomStore, prepViewFor } from "../store.js";
import type { Queryable } from "../db.js";
import { freshDb } from "./testdb.js";

let db: Queryable;
let store: PgRoomStore;
beforeEach(async () => {
  db = await freshDb();
  store = new PgRoomStore(db, "rules-a");
});
afterEach(() => vi.restoreAllMocks());

async function pairedRoom() {
  const host = await store.createRoom("classic-battles", { hero: "rhinar" });
  await store.markPresent(host.code, host.token, "arena-host");
  const joined = await store.joinRoom(host.code, undefined, { allowPlayer: true, hero: "dorinthea" });
  if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
  const tokens = [host.token, joined.token] as const;
  const prep = (await store.getRoom(host.code))!.prep!;
  expect(await store.chooseFirst(host.code, { token: tokens[prep.dieWinner] }, true)).toMatchObject({ ok: true });
  return { code: host.code, tokens };
}
const arenas: [PresentedArena, PresentedArena] = [
  { weaponIds: decklists.rhinar.weaponIds, equipment: decklists.rhinar.equipment },
  { weaponIds: decklists.dorinthea.weaponIds, equipment: decklists.dorinthea.equipment },
];

async function lockBoth(code: string, tokens: readonly [string, string]) {
  for (const seat of [0, 1] as const) {
    expect(await store.presentArena(code, { token: tokens[seat] }, arenas[seat])).toMatchObject({ ok: true });
  }
}

describe("arena reveal preparation", () => {
  it.each([
    { rolls: [0, 2] },
    { rolls: [1.5, 2] },
    { rolls: [1, 7] },
    { arenas: [null] },
    { arenas: [{ weaponIds: ["a", "b", "c"], equipment: {} }, null] },
  ])("rejects malformed persisted preparation %#", async (invalid) => {
    const { code } = await pairedRoom();
    const room = (await store.getRoom(code))!;
    await db.query("UPDATE rooms SET prep = $2 WHERE code = $1", [code, JSON.stringify({ ...room.prep, ...invalid })]);
    await expect(store.getRoom(code)).rejects.toMatchObject({ name: "CorruptRoomError" });
  });

  it.each(["arena", "deck"] as const)("rejects a refreshed hero during %s selection", async (stage) => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('ArenaOwner','arenaowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const pool = precon("precon-asb")!.pool;
    const opponentPool = precon("precon-asr")!.pool;
    await db.query(
      `INSERT INTO decks (id, user_id, name, format, decklist, hero_name, created_at, updated_at)
       VALUES ('arena-saved', $1, 'Arena saved deck', 'cc', $2, $3, 1, 1)`,
      [userId, JSON.stringify(pool), cardData[pool.heroId]!.name],
    );
    const host = await store.createRoom("cc", { deckId: "arena-saved", userId });
    await store.markPresent(host.code, host.token, "arena-owner", 0, userId);
    const joined = await store.joinRoom(host.code, undefined, { allowPlayer: true, deckId: "precon-asr" });
    if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
    const credentials = [{ token: host.token, userId }, { token: joined.token }] as const;
    const room = (await store.getRoom(host.code))!;
    await store.chooseFirst(host.code, credentials[room.prep!.dieWinner], true);
    const arena = { weaponIds: pool.weaponIds, equipment: {} };
    if (stage === "deck") {
      expect(await store.presentArena(host.code, credentials[0], arena)).toMatchObject({ ok: true });
      expect(await store.presentArena(host.code, credentials[1], { weaponIds: opponentPool.weaponIds, equipment: {} }))
        .toMatchObject({ ok: true });
    }
    await db.query("UPDATE decks SET decklist = $2 WHERE id = $1", ["arena-saved", JSON.stringify(opponentPool)]);
    const result = stage === "arena"
      ? await store.presentArena(host.code, credentials[0], arena)
      : await store.presentDeck(host.code, credentials[0], { ...arena, deck: pool.deck });
    expect(result).toEqual({ ok: false, error: "your registered hero changed; leave and rejoin the room" });
    const after = (await store.getRoom(host.code))!;
    expect(after.state).toBeNull();
    expect(after.seats[0]?.ready).not.toBe(true);
  });

  it("keeps the first commitment private, survives gateway reload, then reveals both atomically", async () => {
    const { code, tokens } = await pairedRoom();
    expect(await store.presentDeck(code, { token: tokens[0] }, decklists.rhinar)).toMatchObject({ ok: false });
    expect(await store.presentArena(code, { token: tokens[0] }, arenas[0])).toMatchObject({ ok: true });
    const reloaded = new PgRoomStore(db, "rules-a");
    let room = (await reloaded.getRoom(code))!;
    const own = prepViewFor(room, 0);
    const other = prepViewFor(room, 1);
    expect(own.yourArena).toEqual(arenas[0]);
    expect(other.yourArena).toBeUndefined();
    expect(other.seats[0]).toMatchObject({ arenaLocked: true, ready: false });
    expect(other.seats[0]).not.toHaveProperty("arena");
    expect(other.phase).toBe("select-arena");
    expect(decodeServerMessage({ type: "prep-state", prep: other, version: room.version })).not.toBeNull();
    expect(await reloaded.presentArena(code, { token: tokens[0] }, { weaponIds: [], equipment: {} }))
      .toMatchObject({ ok: false });
    expect(await reloaded.presentArena(code, { token: tokens[1] }, arenas[1])).toMatchObject({ ok: true });
    room = (await reloaded.getRoom(code))!;
    expect(room.state).toBeNull();
    for (const seat of [0, 1] as const) {
      const view = prepViewFor(room, seat);
      expect(view.phase).toBe("select-deck");
      expect(view.seats.map((s) => s?.arena)).toEqual(arenas);
      expect(decodeServerMessage({ type: "prep-state", prep: view, version: room.version })).not.toBeNull();
    }
  });

  it("rejects invalid equipment and unregistered weapons without committing", async () => {
    const { code, tokens } = await pairedRoom();
    expect(await store.presentArena(code, { token: tokens[0] }, { weaponIds: ["ASR002"], equipment: {} }))
      .toMatchObject({ ok: false });
    expect(await store.presentArena(code, { token: tokens[0] }, { weaponIds: [], equipment: { head: "WTR001" } }))
      .toMatchObject({ ok: false });
    expect((await store.getRoom(code))!.prep!.arenas).toEqual([null, null]);
  });

  it("retains both simultaneous commitments from separate gateways", async () => {
    const { code, tokens } = await pairedRoom();
    const otherGateway = new PgRoomStore(db, "rules-a");
    const results = await Promise.all([
      store.presentArena(code, { token: tokens[0] }, arenas[0]),
      otherGateway.presentArena(code, { token: tokens[1] }, arenas[1]),
    ]);
    expect(results).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
    const room = (await otherGateway.getRoom(code))!;
    expect(room.prep!.arenas).toEqual(arenas);
    expect(prepViewFor(room, 0).phase).toBe("select-deck");
    expect(room.state).toBeNull();
  });

  it("locks arena cards through unready and starts only after both decks are ready", async () => {
    const { code, tokens } = await pairedRoom();
    await lockBoth(code, tokens);
    expect(await store.presentDeck(code, { token: tokens[0] }, { ...decklists.rhinar, equipment: {} }))
      .toEqual({ ok: false, error: "arena cards cannot change after locking" });
    expect(await store.presentDeck(code, { token: tokens[0] }, decklists.rhinar))
      .toMatchObject({ ok: true, started: false });
    let room = (await store.getRoom(code))!;
    expect(prepViewFor(room, 0).yourPresentedDeck).toEqual(decklists.rhinar.deck);
    expect(prepViewFor(room, 1)).not.toHaveProperty("yourPresentedDeck");
    expect(await store.unready(code, { token: tokens[0] })).toMatchObject({ ok: true });
    expect(await store.presentArena(code, { token: tokens[0] }, { weaponIds: [], equipment: {} }))
      .toMatchObject({ ok: false });
    room = (await store.getRoom(code))!;
    expect(room.prep!.arenas[0]).toEqual(arenas[0]);
    expect(await store.presentDeck(code, { token: tokens[0] }, decklists.rhinar))
      .toMatchObject({ ok: true, started: false });
    expect(await store.presentDeck(code, { token: tokens[1] }, decklists.dorinthea))
      .toMatchObject({ ok: true, started: true });
    expect((await store.getRoom(code))!.state).not.toBeNull();
  });

  it("clears commitments and prior readiness when an opponent leaves", async () => {
    const { code, tokens } = await pairedRoom();
    await lockBoth(code, tokens);
    await store.presentDeck(code, { token: tokens[0] }, decklists.rhinar);
    expect(await store.leaveRoom(code, { token: tokens[1] })).toMatchObject({ ok: true });
    let room = (await store.getRoom(code))!;
    expect(room.prep).toBeNull();
    expect(room.seats[0]?.ready).toBe(false);
    expect(room.seats[0]?.presented).toBeUndefined();
    const joined = await store.joinRoom(code, undefined, { allowPlayer: true, hero: "dorinthea" });
    expect(joined).toMatchObject({ ok: true, kind: "player" });
    room = (await store.getRoom(code))!;
    expect(room.prep!.arenas).toEqual([null, null]);
    expect(prepViewFor(room, 0).phase).toBe("choose-first");
  });

  it("keeps Cloaked identities private even after arena reveal", async () => {
    const { code } = await pairedRoom();
    const room = (await store.getRoom(code))!;
    const cloaked = Object.values(cardData).find((card) =>
      card.keywords?.some((keyword) => keyword.toLowerCase() === "cloaked"));
    expect(cloaked).toBeDefined();
    if (!cloaked) throw new Error("missing Cloaked fixture");
    room.prep!.arenas = [{ weaponIds: [], equipment: { head: cloaked.id } }, arenas[1]];
    expect(prepViewFor(room, 0).yourArena?.equipment.head).toBe(cloaked.id);
    const opponent = prepViewFor(room, 1);
    expect(opponent.seats[0]?.arena?.equipment.head).toBeNull();
    expect(JSON.stringify(opponent)).not.toContain(cloaked.id);
    expect(decodeServerMessage({ type: "prep-state", prep: opponent, version: room.version })).not.toBeNull();
  });

  it("selects bot arena and deck cards using only public information", async () => {
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('ArenaBot','arenabot','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const definition = botDefinition("hala")!;
    const arenaSpy = vi.spyOn(definition, "arenaFor");
    const deckSpy = vi.spyOn(definition, "deckFor");
    const created = await store.createBotRoom("cc", { deckId: "precon-asb", username: "ArenaBot", userId });
    const credentials = { token: created.token, userId };
    const pool = precon("precon-asb")!.pool;
    expect(await store.chooseFirst(created.code, credentials, true)).toMatchObject({ ok: true });
    expect(arenaSpy).toHaveBeenCalledWith({ heroId: pool.heroId }, "second");
    let room = (await store.getRoom(created.code))!;
    const committed = structuredClone(room.prep!.arenas[1]);
    expect(prepViewFor(room, 0).seats[1]?.arenaLocked).toBe(true);
    expect(prepViewFor(room, 0).seats[1]?.arena).toBeUndefined();
    expect(deckSpy).not.toHaveBeenCalled();
    const humanArena = { weaponIds: pool.weaponIds, equipment: {} };
    expect(await store.presentArena(created.code, credentials, humanArena)).toMatchObject({ ok: true });
    expect(await store.presentDeck(created.code, credentials, { ...humanArena, deck: pool.deck }))
      .toMatchObject({ ok: true, started: true });
    expect(deckSpy).toHaveBeenCalledWith({ heroId: pool.heroId, ...humanArena }, committed, "second");
    expect(deckSpy.mock.calls[0]![0]).not.toHaveProperty("deck");
    room = (await store.getRoom(created.code))!;
    expect(room.seats[1]!.presented?.equipment).toEqual(committed!.equipment);
  });
});
