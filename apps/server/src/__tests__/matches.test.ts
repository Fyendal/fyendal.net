import { beforeEach, describe, expect, it } from "vitest";
import { DataType, newDb } from "pg-mem";
import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { createGame } from "@fyendal/engine";
import { decodeAccountExportResponse, decodeMatchesResponse, decodeMatchRecordsResponse } from "@fyendal/protocol";
import { applyMigrations, MIGRATIONS, type Queryable } from "../db.js";
import { listMatches, loadMatchRecords, matchEndReason, parseMatchCursor, recordMatch } from "../matches.js";
import { encodePersistedState } from "../persistedState.js";
import { deleteAccount, exportAccount } from "../accounts.js";
import { register } from "../auth.js";
import { PgRoomStore } from "../store.js";
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

/** Both seats play the same Classic Constructed precon; mirrors are legal. */
const PVP_DECK = "precon-asb";
const PVP_HERO = precon(PVP_DECK)!.pool.heroId;

async function startedGame(users: [number, number], names: [string, string] = ["Alice", "Bob"]) {
  const host = await store.createRoom("cc", { deckId: PVP_DECK, userId: users[0], username: names[0] });
  await db.query(
    `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
     SELECT room_code, 'match-host', token_hash, seat, $2::bigint
     FROM room_seats WHERE room_code = $1 AND seat = 0`,
    [host.code, Date.now()],
  );
  const joined = await store.joinRoom(host.code, undefined, {
    allowPlayer: true, deckId: PVP_DECK, userId: users[1], username: names[1],
  });
  if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
  const tokens: [string, string] = [host.token, joined.token];
  const room = await store.getRoom(host.code);
  const dieWinner = room!.prep!.dieWinner;
  const chosen = await store.chooseFirst(host.code, { token: tokens[dieWinner], userId: users[dieWinner] }, true);
  if (!chosen.ok || chosen.started) throw new Error("turn order was not recorded");
  const pool = precon(PVP_DECK)!.pool;
  for (const seat of [0, 1] as const) {
    const locked = await store.presentArena(
      host.code, { token: tokens[seat], userId: users[seat] }, { weaponIds: pool.weaponIds, equipment: {} },
    );
    if (!locked.ok) throw new Error(locked.error);
  }
  for (const seat of [0, 1] as const) {
    const presented = await store.presentDeck(host.code, { token: tokens[seat], userId: users[seat] }, {
      weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck,
    });
    if (!presented.ok) throw new Error(presented.error);
  }
  if (!(await store.getRoom(host.code))?.state) throw new Error("game did not start");
  return { code: host.code, tokens };
}

async function concededGame(users: [number, number], loser: 0 | 1 = 0) {
  const game = await startedGame(users);
  const conceded = await store.applyIntent(game.code, { token: game.tokens[loser], userId: users[loser] }, { kind: "concede" });
  if (!conceded.ok) throw new Error("concede failed");
  return { ...game, replayId: conceded.replayFinalizationId };
}

async function botRoom(userId: number) {
  const created = await store.createBotRoom("silver-age", { userId, username: "Alice", deckId: "precon-svi", deckName: "My Precon" }, "legal", "bravo");
  const room = (await store.getRoom(created.code))!;
  room.state = createGame({ decklists: [decklists.dorinthea, decklists.rhinar], cards: cardData, scripts, seed: 731, startPlayer: 1 });
  room.state.turn = 2;
  await db.query("UPDATE rooms SET state = $1, status = 'active' WHERE code = $2", [JSON.stringify(encodePersistedState(room.state, room.rulesetVersion)), room.code]);
  return { code: created.code, credentials: { token: created.token, userId } };
}

describe("match end reasons", () => {
  it("derives lethal from the loser's life and distinguishes idle from concede", () => {
    expect(matchEndReason({ winner: 0, players: [{ life: 12 }, { life: 0 }] })).toBe("lethal");
    expect(matchEndReason({ winner: 1, players: [{ life: -3 }, { life: 5 }] })).toBe("lethal");
    expect(matchEndReason({ winner: 0, players: [{ life: 12 }, { life: 7 }] })).toBe("concede");
    expect(matchEndReason({ winner: 0, players: [{ life: 12 }, { life: 7 }] }, true)).toBe("idle");
    expect(matchEndReason({ winner: null, players: [{ life: 1 }, { life: 1 }] })).toBe("draw");
  });

  it("parses list cursors strictly", () => {
    expect(parseMatchCursor(null)).toBeNull();
    expect(parseMatchCursor("")).toBeNull();
    expect(parseMatchCursor("12.abcdefabcdefabcdefabcdef")).toEqual({ finishedAt: 12, id: "abcdefabcdefabcdefabcdef" });
    expect(parseMatchCursor("12.short")).toBeUndefined();
    expect(parseMatchCursor("x.abcdefabcdefabcdefabcdef")).toBeUndefined();
  });
});

describe("match recording", () => {
  it("records a conceded PvP game for both accounts with counters", async () => {
    const users: [number, number] = [await user("Alice"), await user("Bob")];
    const game = await concededGame(users, 0);
    expect(game.replayId).toBeTruthy();

    const alice = await listMatches(db, users[0]);
    const bob = await listMatches(db, users[1]);
    expect(alice.nextCursor).toBeNull();
    expect(alice.matches).toHaveLength(1);
    const match = alice.matches[0]!;
    expect(match).toMatchObject({
      format: "cc",
      yourSeat: 0,
      winner: 1,
      endReason: "concede",
      players: [
        { heroId: PVP_HERO, controller: "human", username: "Alice", bot: null },
        { heroId: PVP_HERO, controller: "human", username: "Bob", bot: null },
      ],
    });
    expect(match.replay).toBeNull(); // still finalizing; not watchable yet
    expect(bob.matches[0]).toMatchObject({ id: match.id, yourSeat: 1, winner: 1 });

    await db.query("UPDATE replay_games SET status = 'ready', frame_count = 1 WHERE id = $1", [game.replayId]);
    const ready = await listMatches(db, users[0]);
    expect(ready.matches[0]!.replay).toEqual({ id: game.replayId, expiresAt: expect.any(Number), favorite: false });

    const aliceRecords = await loadMatchRecords(db, users[0]);
    expect(aliceRecords.heroes).toEqual([{
      heroId: PVP_HERO, opponentKind: "player", format: "cc",
      games: 1, wins: 0, losses: 1, draws: 0, ended: 0, lastPlayedAt: match.finishedAt,
    }]);
    expect(aliceRecords.matchups).toEqual([{
      heroId: PVP_HERO, opponentHeroId: PVP_HERO,
      opponentKind: "player", format: "cc", games: 1, wins: 0, losses: 1, draws: 0,
    }]);
    const bobRecords = await loadMatchRecords(db, users[1]);
    expect(bobRecords.heroes[0]).toMatchObject({ heroId: PVP_HERO, wins: 1, losses: 0, games: 1 });
    expect(decodeMatchRecordsResponse({ ok: true, ...aliceRecords })).not.toBeNull();
    expect(decodeMatchesResponse({ ok: true, ...ready })).not.toBeNull();
  });

  it("records idle victories with their own end reason", async () => {
    const users: [number, number] = [await user("Alice"), await user("Bob")];
    const game = await startedGame(users);
    const room = (await store.getRoom(game.code))!;
    const waitingOn = (room.state!.pendingDecision?.player ?? room.state!.activePlayer) as 0 | 1;
    const winner = (1 - waitingOn) as 0 | 1;
    const claimed = await store.claimVictory(game.code, { token: game.tokens[winner], userId: users[winner] }, Date.now() + 10_000_000_000);
    expect(claimed.ok).toBe(true);
    const { matches } = await listMatches(db, users[winner]);
    expect(matches[0]).toMatchObject({ winner, endReason: "idle", yourSeat: winner });
  });

  it("records bot games with the bot identity, and ended games without a result", async () => {
    const alice = await user("Alice");
    const conceded = await botRoom(alice);
    const result = await store.applyIntent(conceded.code, conceded.credentials, { kind: "concede" });
    expect(result.ok).toBe(true);
    const ended = await botRoom(alice);
    const deleted = await store.deleteBotRoom(ended.code, ended.credentials);
    expect(deleted.ok).toBe(true);

    const { matches } = await listMatches(db, alice);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ winner: null, endReason: "ended", yourSeat: 0, replay: null });
    expect(matches[1]).toMatchObject({
      winner: 1, endReason: "concede",
      players: [
        { controller: "human", username: "Alice", deckName: "My Precon" },
        { controller: "bot", bot: "bravo", username: "Bravo Bot" },
      ],
    });
    expect((await listMatches(db, alice, { opponent: "players" })).matches).toEqual([]);
    expect((await listMatches(db, alice, { opponent: "bots" })).matches).toHaveLength(2);

    const records = await loadMatchRecords(db, alice);
    expect(records.heroes).toEqual([{
      heroId: "SVI001", opponentKind: "bot", format: "silver-age",
      games: 2, wins: 0, losses: 1, draws: 0, ended: 1, lastPlayedAt: expect.any(Number),
    }]);
    expect(records.matchups).toHaveLength(1);
    expect(records.matchups[0]).toMatchObject({ games: 1, losses: 1 });
  });

  it("never double counts the same game", async () => {
    const alice = await user("Alice");
    const input = {
      roomCode: "ABCDEF", format: "cc" as const, rulesetVersion: "rules-a",
      seats: [
        { heroId: "H1", controller: "human" as const, userId: alice, username: "Alice" },
        { heroId: "H2", controller: "bot" as const, deckId: "bot-bravo-flarvo", username: "Bravo Bot" },
      ] as const,
      winner: 0 as const, endReason: "lethal" as const, startedAt: 100, finishedAt: 200, replayId: null,
    };
    expect(await recordMatch(db, { ...input, seats: [input.seats[0], input.seats[1]] })).toBe(true);
    expect(await recordMatch(db, { ...input, seats: [input.seats[0], input.seats[1]], winner: 1 })).toBe(false);
    expect(await recordMatch(db, { ...input, seats: [input.seats[0], input.seats[1]], startedAt: 101, winner: null, endReason: "draw" })).toBe(true);
    const records = await loadMatchRecords(db, alice);
    expect(records.heroes).toEqual([{
      heroId: "H1", opponentKind: "bot", format: "cc",
      games: 2, wins: 1, losses: 0, draws: 1, ended: 0, lastPlayedAt: 200,
    }]);
    expect(records.matchups[0]).toMatchObject({ opponentHeroId: "H2", games: 2, wins: 1, draws: 1 });
  });

  it("filters by format and hero and pages newest first", async () => {
    const alice = await user("Alice");
    const seats = (hero: string) => [
      { heroId: hero, controller: "human" as const, userId: alice, username: "Alice" },
      { heroId: "H2", controller: "bot" as const, deckId: "bot-bravo-flarvo", username: "Bravo Bot" },
    ] as [never, never];
    for (let index = 0; index < 5; index++) {
      await recordMatch(db, {
        roomCode: "ABCDEF", format: index % 2 ? "cc" : "silver-age", rulesetVersion: "rules-a",
        seats: seats(index === 4 ? "HX" : "H1"), winner: 0, endReason: "lethal",
        startedAt: index, finishedAt: 1000 + index, replayId: null,
      });
    }
    const first = await listMatches(db, alice, {}, { limit: 2 });
    expect(first.matches.map((match) => match.finishedAt)).toEqual([1004, 1003]);
    expect(first.nextCursor).toBe(`1003.${first.matches[1]!.id}`);
    const second = await listMatches(db, alice, {}, { limit: 2, cursor: parseMatchCursor(first.nextCursor)! });
    expect(second.matches.map((match) => match.finishedAt)).toEqual([1002, 1001]);
    const third = await listMatches(db, alice, {}, { limit: 2, cursor: parseMatchCursor(second.nextCursor)! });
    expect(third.matches.map((match) => match.finishedAt)).toEqual([1000]);
    expect(third.nextCursor).toBeNull();
    expect((await listMatches(db, alice, { format: "cc" })).matches.map((match) => match.finishedAt)).toEqual([1003, 1001]);
    expect((await listMatches(db, alice, { heroId: "HX" })).matches.map((match) => match.finishedAt)).toEqual([1004]);
    expect((await loadMatchRecords(db, alice)).heroes).toHaveLength(3);
  });

  it("exports history and keeps the opponent's record after account deletion", async () => {
    await register(db, "Alice", "password1");
    await register(db, "Bob", "password1");
    const ids = await db.query("SELECT id FROM users ORDER BY id");
    const users: [number, number] = [Number(ids.rows[0]!.id), Number(ids.rows[1]!.id)];
    await concededGame(users, 1);

    const exported = await exportAccount(db, users[0]);
    expect(decodeAccountExportResponse({ ok: true, export: exported })).not.toBeNull();
    expect(exported?.matches).toHaveLength(1);
    expect(exported?.heroRecords[0]).toMatchObject({ wins: 1 });
    expect(exported?.matchupRecords).toHaveLength(1);

    expect((await deleteAccount(db, users[1], "password1")).status).toBe("deleted");
    const { matches } = await listMatches(db, users[0]);
    expect(matches[0]!.players[1]).toEqual({
      heroId: PVP_HERO, controller: "human", username: null, bot: null, deckName: null,
    });
    expect((await loadMatchRecords(db, users[0])).heroes[0]).toMatchObject({ wins: 1 });
    expect((await db.query("SELECT COUNT(*) AS n FROM hero_records")).rows[0]!.n).toBe(1);

    expect((await deleteAccount(db, users[0], "password1")).status).toBe("deleted");
    expect((await db.query("SELECT COUNT(*) AS n FROM matches")).rows[0]!.n).toBe(0);
    expect((await db.query("SELECT COUNT(*) AS n FROM match_participants")).rows[0]!.n).toBe(0);
  });
});

describe("match history backfill", () => {
  it("creates matches and counters from retained replays at migration time", async () => {
    const memory = newDb();
    memory.public.registerFunction({
      name: "decode", args: [DataType.text, DataType.text], returns: DataType.bytea,
      implementation: (value: string) => Buffer.from(value, "base64"),
    });
    const { Pool } = memory.adapters.createPg();
    const raw: Queryable = new Pool();
    const before = MIGRATIONS.findIndex((migration) => migration.version === 46);
    await applyMigrations(raw, MIGRATIONS.slice(0, before));
    const { rows } = await raw.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('Alice','alice','hash',1), ('Bob','bob','hash',1) RETURNING id`,
    );
    const [alice, bob] = rows.map((row) => Number(row.id)) as [number, number];
    await raw.query(
      `INSERT INTO replay_games (id, room_code, ruleset_version, format, hero_0_id, hero_1_id, winner, status, created_at, finished_at, expires_at, frame_count)
       VALUES ('r1', 'ROOM01', 'rules-a', 'cc', 'H1', 'H2', 0, 'ready', 10, 20, 9999999999999, 3),
              ('r2', 'ROOM02', 'rules-a', 'silver-age', 'H1', 'H3', NULL, 'ready', 30, 40, 9999999999999, 3),
              ('r3', 'ROOM03', 'rules-a', 'cc', 'H1', 'H2', 1, 'recording', 50, NULL, NULL, NULL),
              ('r4', 'ROOM04', 'rules-a', 'classic-battles', 'H1', 'H2', 0, 'ready', 60, 70, 9999999999999, 3)`,
    );
    await raw.query(
      `INSERT INTO replay_participants (replay_id, user_id, seat)
       VALUES ('r1', $1, 0), ('r1', $2, 1), ('r2', $1, 0), ('r3', $1, 0), ('r4', $1, 0), ('r4', $2, 1)`,
      [alice, bob],
    );
    await applyMigrations(raw, MIGRATIONS);

    const aliceMatches = await listMatches(raw, alice);
    expect(aliceMatches.matches).toHaveLength(2);
    expect(aliceMatches.matches[0]).toMatchObject({
      id: "r2", winner: null, endReason: null, yourSeat: 0,
      players: [
        { controller: "human", username: "Alice" },
        { controller: "bot", bot: null, username: null, heroId: "H3" },
      ],
      replay: { id: "r2", favorite: false },
    });
    expect(aliceMatches.matches[1]).toMatchObject({
      id: "r1", winner: 0, endReason: null,
      players: [{ username: "Alice" }, { username: "Bob", controller: "human" }],
    });
    const records = await loadMatchRecords(raw, alice);
    expect(records.heroes).toEqual(expect.arrayContaining([
      expect.objectContaining({ heroId: "H1", opponentKind: "player", format: "cc", games: 1, wins: 1 }),
      expect.objectContaining({ heroId: "H1", opponentKind: "bot", format: "silver-age", games: 1, ended: 1 }),
    ]));
    expect(records.matchups).toEqual([
      expect.objectContaining({ heroId: "H1", opponentHeroId: "H2", opponentKind: "player", games: 1, wins: 1 }),
    ]);
    expect((await loadMatchRecords(raw, bob)).heroes[0]).toMatchObject({ heroId: "H2", losses: 1 });
  });
});
