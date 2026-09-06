import { beforeEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { decklists } from "@fyendal/cards";
import { legalIntents } from "@fyendal/engine";
import { decodeGameView, decodeReplayResponse, replayFileViews } from "@fyendal/protocol";
import type { Queryable } from "../db.js";
import {
  deleteReplay,
  discardUnfinishedReplaysOtherRulesets,
  MAX_FAVORITE_REPLAYS,
  REPLAY_FRAME_BATCH_SIZE,
  finalizeReplayForRoom,
  getReplay,
  getReplayNotes,
  listReplays,
  ReplayFinalizer,
  REPLAY_TTL_MS,
  saveReplayNote,
  setReplayFavorite,
  sweepReplays,
  waitForReplayPayloadForRoom,
} from "../replays.js";
import { dehydrateState, PgRoomStore, stateMessage } from "../store.js";
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
  await db.query(
    `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
     SELECT room_code, 'replay-host', token_hash, seat, $2::bigint
     FROM room_seats WHERE room_code = $1 AND seat = 0`,
    [host.code, Date.now()],
  );
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
  it("stores notes per participant and carries live bookmarks into the final replay", async () => {
    const game = await startedGame();
    const frameRow = (await db.query(
      `SELECT f.room_version FROM replay_frames f
       JOIN replay_games g ON g.id=f.replay_id
       WHERE g.room_code=$1 ORDER BY f.room_version LIMIT 1`,
      [game.code],
    )).rows[0]!;
    const roomVersion = Number(frameRow.room_version);

    expect(await saveReplayNote(db, game.users[0], {
      roomCode: game.code,
      roomVersion,
      frame: 0,
      text: "Alice's private thought",
    }, 100)).toBe(true);
    expect(await getReplayNotes(db, game.users[0], {
      roomCode: game.code,
    })).toEqual([{ frame: 0, roomVersion, text: "Alice's private thought" }]);
    expect(await getReplayNotes(db, game.users[1], {
      roomCode: game.code,
    })).toEqual([]);
    expect(await getReplayNotes(db, game.users[1] + 99, {
      roomCode: game.code,
    })).toBeNull();

    const conceded = await store.applyIntent(
      game.code,
      { token: game.tokens[0], userId: game.users[0] },
      { kind: "concede" },
    );
    if (!conceded.ok || !conceded.replayFinalizationId) throw new Error("concede failed");
    expect(await finalizeReplayForRoom(db, game.code)).toBe(true);

    expect(await getReplayNotes(db, game.users[0], {
      replayId: conceded.replayFinalizationId,
    })).toEqual([{ frame: 0, text: "Alice's private thought" }]);
    expect(await getReplayNotes(db, game.users[1], {
      replayId: conceded.replayFinalizationId,
    })).toEqual([]);
    const aliceExport = await exportAccount(db, game.users[0]);
    const bobExport = await exportAccount(db, game.users[1]);
    expect(aliceExport?.replays[0]?.replay).toMatchObject({
      version: 3,
      notes: [{ frame: 0, text: "Alice's private thought" }],
    });
    expect(bobExport?.replays[0]?.replay.version).toBe(2);

    expect(await saveReplayNote(db, game.users[0], {
      replayId: conceded.replayFinalizationId,
      frame: 0,
      text: "",
    }, 101)).toBe(true);
    expect(await getReplayNotes(db, game.users[0], {
      replayId: conceded.replayFinalizationId,
    })).toEqual([]);
    const expiresAt = (await listReplays(db, game.users[0]))[0]!.expiresAt;
    expect(await getReplayNotes(db, game.users[0], {
      replayId: conceded.replayFinalizationId,
    }, expiresAt)).toBeNull();
    expect(await saveReplayNote(db, game.users[0], {
      replayId: conceded.replayFinalizationId,
      frame: 0,
      text: "Too late",
    }, expiresAt)).toBe(false);
  });

  it("prunes invalidated action frames instead of recording Undo", async () => {
    const game = await startedGame();
    const before = await store.getRoom(game.code);
    if (!before?.state) throw new Error("game did not start");
    const actor = (before.state.pendingDecision?.player ?? before.state.priorityPlayer) as 0 | 1;
    const intent = legalIntents(before.state, actor).find((candidate) => candidate.kind !== "concede");
    if (!intent) throw new Error("no legal action");

    expect((await store.applyIntent(
      game.code,
      { token: game.tokens[actor], userId: game.users[actor] },
      intent,
    )).ok).toBe(true);
    expect(Number((await db.query(
      `SELECT COUNT(*) AS count FROM replay_frames f
       JOIN replay_games g ON g.id = f.replay_id WHERE g.room_code = $1`,
      [game.code],
    )).rows[0]!.count)).toBe(2);
    const invalidatedVersion = Number((await db.query(
      `SELECT MAX(f.room_version) AS room_version FROM replay_frames f
       JOIN replay_games g ON g.id=f.replay_id WHERE g.room_code=$1`,
      [game.code],
    )).rows[0]!.room_version);
    expect(await saveReplayNote(db, game.users[actor], {
      roomCode: game.code,
      roomVersion: invalidatedVersion,
      frame: 1,
      text: "This line will be undone",
    })).toBe(true);

    const other = (1 - actor) as 0 | 1;
    const undone = await store.undo(
      game.code,
      { token: game.tokens[other], userId: game.users[other] },
    );
    expect(undone.ok).toBe(true);
    const after = await store.getRoom(game.code);
    expect(after?.lastTransition).toMatchObject({
      kind: "replace",
      restoreVersion: before.version,
    });
    expect(after && stateMessage(after, actor)).toMatchObject({
      type: "state",
      transition: {
        kind: "replace",
        restoreVersion: before.version,
        events: [],
      },
    });
    const frames = (await db.query(
      `SELECT f.room_version FROM replay_frames f
       JOIN replay_games g ON g.id = f.replay_id
       WHERE g.room_code = $1 ORDER BY f.room_version`,
      [game.code],
    )).rows;
    expect(frames.map((row) => Number(row.room_version))).toEqual([before.version]);
    expect(await getReplayNotes(db, game.users[actor], {
      roomCode: game.code,
    })).toEqual([]);
  });

  it("does not roll back a game action when an older revision cannot project a replay card", async () => {
    const game = await startedGame();
    const room = await store.getRoom(game.code);
    if (!room?.state) throw new Error("game did not start");
    const actor = room.state.pendingDecision?.player ?? room.state.priorityPlayer;
    if (!(actor === 0 || actor === 1)) throw new Error("invalid actor");
    const hiddenDeck = room.state.players[1 - actor]!.deck;
    if (!hiddenDeck[0]) throw new Error("missing hidden deck card");
    hiddenDeck[0].cardId = "NEWER_REVISION_CARD";
    await db.query(
      "UPDATE rooms SET state = $2 WHERE code = $1",
      [game.code, JSON.stringify(dehydrateState(room.state, "rules-a"))],
    );
    const beforeVersion = room.version;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const applied = await store.applyIntent(
        game.code,
        { token: game.tokens[actor], userId: game.users[actor] },
        { kind: "pass" },
      );

      expect(applied).toMatchObject({ ok: true, version: beforeVersion + 1 });
      expect((await store.getRoom(game.code))?.version).toBe(beforeVersion + 1);
      expect((await db.query("SELECT 1 FROM replay_games WHERE room_code = $1", [game.code])).rows)
        .toEqual([]);
      expect((await db.query("SELECT 1 FROM replay_frames")).rows).toEqual([]);
      expect(logged).toHaveBeenCalledWith(
        `discarding replay recording for room ${game.code}: frame projection failed`,
        expect.objectContaining({ message: "unknown card id: NEWER_REVISION_CARD" }),
      );
    } finally {
      logged.mockRestore();
    }
  });

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
    const analyticsEvents = (await db.query(
      `SELECT event_id, event_type, format, game_mode
       FROM analytics_events WHERE event_type = 'game_completed'`,
    )).rows;
    expect(analyticsEvents).toHaveLength(1);
    expect(analyticsEvents[0]).toMatchObject({
      event_type: "game_completed",
      format: "classic-battles",
      game_mode: "pvp",
    });
    expect(analyticsEvents[0]!.event_id).toMatch(/^game:[a-f0-9]{24}$/);
    expect(analyticsEvents[0]!.event_id).not.toContain(conceded.replayFinalizationId);
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
        if (text.includes("SELECT room_version, view, transition FROM replay_frames")) frameLoads += 1;
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
    expect(aliceFile?.version).toBe(2);
    if (aliceFile?.version === 2) {
      expect(aliceFile.frames.map((frame) => frame.transition)).toEqual([
        null,
        { kind: "forward", events: [] },
      ]);
    }
    expect(aliceFile && replayFileViews(aliceFile)[0]!.players[0].hand.length).toBeGreaterThan(0);
    expect(aliceFile && replayFileViews(aliceFile)[0]!.players[1].hand.length).toBeGreaterThan(0);
    expect(bobFile && replayFileViews(bobFile)[0]!.players[1].hand.length).toBeGreaterThan(0);
    expect(bobFile && replayFileViews(bobFile)[0]!.players[0].hand.length).toBeGreaterThan(0);
    expect(aliceFile && replayFileViews(aliceFile)).toEqual(bobFile && replayFileViews(bobFile));
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
    const deferred = (await db.query(
      `SELECT finalization_attempts, finalization_retry_at
       FROM replay_games WHERE id=$1`,
      [conceded.replayFinalizationId],
    )).rows[0]!;
    expect(deferred.finalization_attempts).toBe(1);
    expect(Number(deferred.finalization_retry_at)).toBeGreaterThan(Date.now());

    expect(await finalizer.recoverPending()).toBe(0);
    await db.query(
      "UPDATE replay_games SET finalization_retry_at=0 WHERE id=$1",
      [conceded.replayFinalizationId],
    );
    expect(await finalizer.recoverPending()).toBe(1);
    await finalizer.waitForIdle();
    expect(await listReplays(db, game.users[0])).toHaveLength(1);
  });

  it("loads large replay recordings in bounded frame batches", async () => {
    const game = await startedGame();
    const conceded = await store.applyIntent(
      game.code,
      { token: game.tokens[0], userId: game.users[0] },
      { kind: "concede" },
    );
    if (!conceded.ok || !conceded.replayFinalizationId) throw new Error("concede failed");
    const finalFrame = (await db.query(
      `SELECT view FROM replay_frames WHERE replay_id=$1
       ORDER BY room_version DESC LIMIT 1`,
      [conceded.replayFinalizationId],
    )).rows[0]!;
    let frameLoads = 0;
    const pagedDb: Queryable = {
      query: async (text, params) => {
        if (!text.includes("SELECT room_version, view, transition FROM replay_frames")) {
          return db.query(text, params);
        }
        frameLoads += 1;
        expect(params?.[2]).toBe(REPLAY_FRAME_BATCH_SIZE);
        const afterRoomVersion = Number(params?.[1]);
        if (afterRoomVersion < 0) {
          return {
            rows: Array.from({ length: REPLAY_FRAME_BATCH_SIZE }, (_, index) => ({
              room_version: index + 1,
              view: finalFrame.view,
              transition: null,
            })),
            rowCount: REPLAY_FRAME_BATCH_SIZE,
          };
        }
        return {
          rows: [{
            room_version: REPLAY_FRAME_BATCH_SIZE + 1,
            view: finalFrame.view,
            transition: null,
          }],
          rowCount: 1,
        };
      },
    };
    const finalizer = new ReplayFinalizer(pagedDb);

    finalizer.enqueue(conceded.replayFinalizationId);
    await finalizer.waitForIdle();

    expect(frameLoads).toBe(2);
    expect((await listReplays(db, game.users[0]))[0]?.frameCount)
      .toBe(REPLAY_FRAME_BATCH_SIZE + 1);
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
    expect(await saveReplayNote(db, game.users[0], {
      replayId: id,
      frame: 0,
      text: "Alice note",
    })).toBe(true);
    expect(await saveReplayNote(db, game.users[1], {
      replayId: id,
      frame: 0,
      text: "Bob note",
    })).toBe(true);

    expect(await deleteReplay(db, game.users[0], id)).toBe(true);
    expect(await listReplays(db, game.users[0])).toEqual([]);
    expect(await getReplay(db, game.users[0], id)).toBeNull();
    expect(await listReplays(db, game.users[1])).toHaveLength(1);
    expect(await getReplay(db, game.users[1], id)).not.toBeNull();
    expect((await db.query(
      "SELECT user_id, note FROM replay_notes WHERE replay_id=$1",
      [id],
    )).rows).toEqual([{ user_id: game.users[1], note: "Bob note" }]);
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

  it("retains a favorite past seven days only for the participant who favorited it", async () => {
    const game = await startedGame();
    await store.applyIntent(
      game.code,
      { token: game.tokens[0], userId: game.users[0] },
      { kind: "concede" },
    );
    await finalizeReplayForRoom(db, game.code);
    const replay = (await listReplays(db, game.users[0]))[0]!;

    expect(await setReplayFavorite(db, game.users[0], replay.id, true)).toBe("updated");
    expect((await listReplays(db, game.users[0], replay.expiresAt))[0]).toMatchObject({
      id: replay.id,
      favorite: true,
    });
    expect((await exportAccount(db, game.users[0]))?.replays[0]?.favorite).toBe(true);
    expect(await getReplay(db, game.users[0], replay.id, replay.expiresAt)).not.toBeNull();
    expect(await listReplays(db, game.users[1], replay.expiresAt)).toEqual([]);
    expect(await getReplay(db, game.users[1], replay.id, replay.expiresAt)).toBeNull();

    expect(await sweepReplays(db, replay.expiresAt)).toBe(0);
    expect((await db.query(
      "SELECT user_id, favorite FROM replay_participants WHERE replay_id=$1",
      [replay.id],
    )).rows).toEqual([{ user_id: game.users[0], favorite: true }]);

    expect(await setReplayFavorite(
      db,
      game.users[0],
      replay.id,
      false,
      replay.expiresAt,
    )).toBe("updated");
    expect((await db.query("SELECT 1 FROM replay_games WHERE id=$1", [replay.id])).rows).toEqual([]);
  });

  it("limits each account to twenty favorite replays", async () => {
    const userId = await user("Collector");
    const now = 1_000;
    for (let index = 0; index <= MAX_FAVORITE_REPLAYS; index += 1) {
      const id = index.toString(16).padStart(24, "0");
      await db.query(
        `INSERT INTO replay_games
          (id, room_code, ruleset_version, format, hero_0_id, hero_1_id,
           winner, status, created_at, finished_at, expires_at, frame_count)
         VALUES ($1,$2,'rules-a','cc','HERO0','HERO1',0,'ready',$3,$3,$4,1)`,
        [id, `CAP${index.toString().padStart(3, "0")}`, now + index, now + REPLAY_TTL_MS],
      );
      await db.query(
        `INSERT INTO replay_participants (replay_id, user_id, seat, payload, payload_bytes)
         VALUES ($1,$2,0,NULL,NULL)`,
        [id, userId],
      );
    }
    for (let index = 0; index < MAX_FAVORITE_REPLAYS; index += 1) {
      const id = index.toString(16).padStart(24, "0");
      expect(await setReplayFavorite(db, userId, id, true, now)).toBe("updated");
    }
    const overflowId = MAX_FAVORITE_REPLAYS.toString(16).padStart(24, "0");
    expect(await setReplayFavorite(db, userId, overflowId, true, now)).toBe("limit");
    expect((await listReplays(db, userId, now)).filter((replay) => replay.favorite))
      .toHaveLength(MAX_FAVORITE_REPLAYS);
  });

  it("discards unfinished recordings after an incompatible ruleset bump", async () => {
    await startedGame();
    expect(await discardUnfinishedReplaysOtherRulesets(db, "rules-b")).toBe(1);
    expect((await db.query("SELECT 1 FROM replay_games")).rows).toEqual([]);
  });
});
