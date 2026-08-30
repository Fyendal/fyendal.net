import { beforeEach, describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { decklists } from "@fyendal/cards";
import { decodeGameView, decodeReplayResponse } from "@fyendal/protocol";
import type { Queryable } from "../db.js";
import {
  deleteReplay,
  discardUnfinishedReplaysOtherRulesets,
  finalizeReplayForRoom,
  getReplay,
  listReplays,
  ReplayFinalizer,
  REPLAY_TTL_MS,
  sweepReplays,
  waitForReplayPayloadForRoom,
} from "../replays.js";
import { PgRoomStore } from "../store.js";
import { exportAccount } from "../accounts.js";
import { freshDb } from "./testdb.js";

let db: Queryable;
let store: PgRoomStore;

beforeEach(async () => {
  db = await freshDb();
  store = new PgRoomStore(db, "rules-a");
});

async function user(username: string): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO users (username, username_lc, pass_hash, created_at)
     VALUES ($1,$2,'hash',1) RETURNING id`,
    [username, username.toLowerCase()],
  );
  return Number(rows[0].id);
}

async function startedGame() {
  const users: [number, number] = [await user("Alice"), await user("Bob")];
  const host = await store.createRoom("classic-battles", {
    hero: "rhinar",
    userId: users[0],
    username: "Alice",
  });
  const joined = await store.joinRoom(host.code, undefined, {
    allowPlayer: true,
    hero: "dorinthea",
    userId: users[1],
    username: "Bob",
  });
  if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
  const tokens: [string, string] = [host.token, joined.token];
  const room = await store.getRoom(host.code);
  const winner = room!.prep!.dieWinner;
  const chosen = await store.chooseFirst(
    host.code,
    { token: tokens[winner], userId: users[winner] },
    true,
  );
  if (!chosen.ok || chosen.started) throw new Error("turn order was not recorded");
  for (const seat of [0, 1] as const) {
    const hero = seat === 0 ? "rhinar" : "dorinthea";
    const deck = decklists[hero];
    const presented = await store.presentDeck(host.code, { token: tokens[seat], userId: users[seat] }, {
      weaponIds: deck.weaponIds,
      equipment: deck.equipment,
      deck: deck.deck,
    });
    if (!presented.ok) throw new Error(presented.error);
  }
  if (!(await store.getRoom(host.code))?.state) throw new Error("game did not start");
  return { code: host.code, tokens, users };
}

describe("server replay retention", () => {
  it("stores omniscient frames and finalizes replay files without engine reconstruction", async () => {
    const game = await startedGame();
    const initialRow = (await db.query(
      `SELECT f.view FROM replay_frames f JOIN replay_games g ON g.id=f.replay_id
       WHERE g.room_code=$1`,
      [game.code],
    )).rows[0]!;
    const initial = decodeGameView(initialRow.view);
    expect(initial?.players[0].hand.length).toBeGreaterThan(0);
    expect(initial?.players[1].hand.length).toBeGreaterThan(0);
    expect(initial?.players[0].deck?.length).toBeGreaterThan(0);
    expect(initial?.players[1].deck?.length).toBeGreaterThan(0);

    const conceded = await store.applyIntent(
      game.code,
      { token: game.tokens[0], userId: game.users[0] },
      { kind: "concede" },
    );
    expect(conceded.ok).toBe(true);
    if (!conceded.ok) throw new Error(conceded.error);
    expect(conceded.replayFinalizationId).toMatch(/^[a-f0-9]{24}$/);
    if (!conceded.replayFinalizationId) throw new Error("missing replay finalization id");
    expect(await store.undo(
      game.code,
      { token: game.tokens[0], userId: game.users[0] },
    )).toEqual({ ok: false, error: "game is already over" });
    expect((await db.query(
      "SELECT view FROM replay_frames WHERE replay_id=$1 ORDER BY room_version",
      [conceded.replayFinalizationId],
    )).rows).toHaveLength(2);
    let frameLoads = 0;
    const measuredDb: Queryable = {
      query: async (text, params) => {
        if (text.includes("SELECT view FROM replay_frames")) frameLoads += 1;
        return db.query(text, params);
      },
    };
    const finalizer = new ReplayFinalizer(measuredDb);
    expect(await finalizer.recoverPending()).toBe(1);
    finalizer.enqueue(conceded.replayFinalizationId);
    await finalizer.waitForIdle();
    expect(frameLoads).toBe(1);

    const stored = (await db.query(
      `SELECT payload, payload_bytes FROM replay_participants
       WHERE replay_id=$1 AND seat=0`,
      [conceded.replayFinalizationId],
    )).rows[0]!;
    expect(Buffer.isBuffer(stored.payload)).toBe(true);
    expect(stored.payload_bytes).toBe(stored.payload.length);
    expect(stored.payload.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(decodeReplayResponse(JSON.parse(gunzipSync(stored.payload).toString("utf8")))?.replay.seat)
      .toBe(0);

    const alice = await listReplays(db, game.users[0]);
    const bob = await listReplays(db, game.users[1]);
    expect(alice).toHaveLength(1);
    expect(bob).toHaveLength(1);
    expect(alice[0]).toMatchObject({ yourSeat: 0, winner: 1, frameCount: 2 });
    expect(bob[0]).toMatchObject({ yourSeat: 1, winner: 1, frameCount: 2 });

    const aliceFile = await getReplay(db, game.users[0], alice[0]!.id);
    const bobFile = await getReplay(db, game.users[1], bob[0]!.id);
    expect(aliceFile?.views[0]!.players[0].hand.length).toBeGreaterThan(0);
    expect(aliceFile?.views[0]!.players[1].hand.length).toBeGreaterThan(0);
    expect(bobFile?.views[0]!.players[1].hand.length).toBeGreaterThan(0);
    expect(bobFile?.views[0]!.players[0].hand.length).toBeGreaterThan(0);
    expect(aliceFile?.views).toEqual(bobFile?.views);
    expect(await getReplay(db, game.users[0] + 99, alice[0]!.id)).toBeNull();
    const accountExport = await exportAccount(db, game.users[0]);
    expect(accountExport?.replays).toHaveLength(1);
    expect(accountExport?.replays[0]!.replay.seat).toBe(0);
  });

  it("recovers a queued replay after a transient finalization failure", async () => {
    const game = await startedGame();
    const conceded = await store.applyIntent(
      game.code,
      { token: game.tokens[0], userId: game.users[0] },
      { kind: "concede" },
    );
    if (!conceded.ok || !conceded.replayFinalizationId) throw new Error("concede failed");

    let failOnce = true;
    const errors: string[] = [];
    const flakyDb: Queryable = {
      query: async (text, params) => {
        if (failOnce && text.includes("FROM replay_games WHERE id = $1 AND status = 'finalizing'")) {
          failOnce = false;
          throw new Error("transient read failure");
        }
        return db.query(text, params);
      },
    };
    const finalizer = new ReplayFinalizer(flakyDb, (message) => errors.push(message));
    finalizer.enqueue(conceded.replayFinalizationId);
    await finalizer.waitForIdle();
    expect(errors).toEqual([
      `replay finalization failed (${conceded.replayFinalizationId})`,
    ]);
    expect((await db.query("SELECT status FROM replay_games WHERE id=$1", [
      conceded.replayFinalizationId,
    ])).rows[0]!.status).toBe("finalizing");

    expect(await finalizer.recoverPending()).toBe(1);
    await finalizer.waitForIdle();
    expect(await listReplays(db, game.users[0])).toHaveLength(1);
  });

  it("waits for a room replay that is still finalizing", async () => {
    const game = await startedGame();
    const conceded = await store.applyIntent(
      game.code,
      { token: game.tokens[0], userId: game.users[0] },
      { kind: "concede" },
    );
    if (!conceded.ok || !conceded.replayFinalizationId) throw new Error("concede failed");
    let waits = 0;

    const payload = await waitForReplayPayloadForRoom(db, game.users[0], game.code, {
      timeoutMs: 100,
      initialPollMs: 10,
      wait: async () => {
        waits += 1;
        await finalizeReplayForRoom(db, game.code);
      },
    });

    expect(waits).toBe(1);
    expect(Buffer.isBuffer(payload)).toBe(true);
  });

  it("deletes only the requesting participant's retained replay", async () => {
    const game = await startedGame();
    const conceded = await store.applyIntent(
      game.code,
      { token: game.tokens[0], userId: game.users[0] },
      { kind: "concede" },
    );
    if (!conceded.ok || !conceded.replayFinalizationId) throw new Error("concede failed");
    await finalizeReplayForRoom(db, game.code);
    const id = conceded.replayFinalizationId;

    expect(await deleteReplay(db, game.users[0], id)).toBe(true);
    expect(await listReplays(db, game.users[0])).toEqual([]);
    expect(await getReplay(db, game.users[0], id)).toBeNull();
    expect(await listReplays(db, game.users[1])).toHaveLength(1);
    expect(await getReplay(db, game.users[1], id)).not.toBeNull();
    expect(await deleteReplay(db, game.users[0], id)).toBe(false);

    expect(await deleteReplay(db, game.users[1], id)).toBe(true);
    expect((await db.query("SELECT 1 FROM replay_games WHERE id=$1", [id])).rows).toEqual([]);
  });

  it("expires ready replay payloads seven days after completion", async () => {
    const game = await startedGame();
    await store.applyIntent(
      game.code,
      { token: game.tokens[0], userId: game.users[0] },
      { kind: "concede" },
    );
    await finalizeReplayForRoom(db, game.code);
    const replay = (await listReplays(db, game.users[0]))[0]!;
    expect(replay.expiresAt - replay.finishedAt).toBe(REPLAY_TTL_MS);
    expect(await listReplays(db, game.users[0], replay.expiresAt)).toEqual([]);
    expect(await sweepReplays(db, replay.expiresAt)).toBe(1);
    expect(await db.query("SELECT 1 FROM replay_games")).toMatchObject({ rows: [] });
  });

  it("discards unfinished recordings after an incompatible ruleset bump", async () => {
    await startedGame();
    expect(await discardUnfinishedReplaysOtherRulesets(db, "rules-b")).toBe(1);
    expect((await db.query("SELECT 1 FROM replay_games")).rows).toEqual([]);
  });
});
