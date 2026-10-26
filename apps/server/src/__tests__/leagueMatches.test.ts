import { beforeEach, describe, expect, it } from "vitest";
import { precon } from "@fyendal/cards";
import { decodeLeaguesResponse } from "@fyendal/protocol";
import type { Queryable } from "../db.js";
import { MINUTE_MS, WEEK_MS } from "../league/availability.js";
import {
  acceptLeagueTime,
  claimLeagueForfeit,
  LeagueRoomUnavailable,
  leagueRoomFormat,
  markLeagueReady,
  proposeLeagueTime,
  READY_CLOSES_MS,
} from "../league/leagueMatches.js";
import { listMemberLeagues } from "../league/leagueStore.js";
import { advanceLeague, tickLeagues } from "../league/leagueWorker.js";
import { PgRoomStore } from "../store.js";
import { freshDb } from "./testdb.js";

const LEAGUE = "0123456789abcdef01234567";
const DECK = "precon-asb";
const ALL_WEEK = JSON.stringify(Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: 0, end: 1440 })));

let db: Queryable;
let store: PgRoomStore;
let alice: number;
let bob: number;
let carol: number;
let matchId: string;
let start: number;

async function user(username: string): Promise<number> {
  const { rows } = await db.query(
    "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ($1, $2, 'hash', 1) RETURNING id",
    [username, username.toLowerCase()],
  );
  return Number(rows[0].id);
}

async function match() {
  const { rows } = await db.query(
    "SELECT status, result, winner, scheduled_at, proposed_by, ready_a, ready_b, room_code, match_id FROM league_matches WHERE id = $1",
    [matchId],
  );
  return rows[0];
}

beforeEach(async () => {
  db = await freshDb();
  store = new PgRoomStore(db, "rules-a");
  [alice, bob, carol] = [await user("alice"), await user("bob"), await user("carol")];
  await db.query(
    `INSERT INTO leagues (id, name, format, status, time_zone, max_players, matches_per_week, pairing_seed, created_at)
     VALUES ($1, 'League', 'cc', 'signup', 'UTC', 8, 1, 'seed', 1)`,
    [LEAGUE],
  );
  for (const [memberId, userId, name] of [[1, alice, "alice"], [2, bob, "bob"]] as const) {
    await db.query(
      `INSERT INTO league_members (league_id, member_id, user_id, username, time_zone, availability, status, joined_at)
       VALUES ($1, $2, $3, $4, 'UTC', $5, 'active', 1)`,
      [LEAGUE, memberId, userId, name, ALL_WEEK],
    );
  }
  await db.query("INSERT INTO league_actions (league_id, action, created_at) VALUES ($1, '{\"kind\":\"start\"}', 1)", [LEAGUE]);
  start = Date.now();
  await tickLeagues(db, start);
  const { rows } = await db.query("SELECT id FROM league_matches WHERE league_id = $1", [LEAGUE]);
  matchId = String(rows[0].id);
});

/** Completes the week-1 match as a forfeit win for `winner`. */
async function claimForfeitFor(winner: number) {
  const at = start + 24 * 60 * MINUTE_MS;
  const loser = winner === alice ? bob : alice;
  await proposeLeagueTime(db, loser, { matchId, at }, start);
  await acceptLeagueTime(db, winner, matchId, start);
  await markLeagueReady(db, winner, matchId, at);
  expect(await claimLeagueForfeit(db, winner, matchId, at + READY_CLOSES_MS + 1)).toBe("updated");
}

describe("league match scheduling", () => {
  it("shows each player the match, the league's suggestion, and the shared time", async () => {
    const [league] = await listMemberLeagues(db, alice, start);
    expect(league!.matches).toHaveLength(1);
    expect(league!.matches[0]).toMatchObject({
      id: matchId, stage: "season", week: 1, opponent: { username: "bob", timeZone: "UTC" },
      status: "proposed", proposedBy: "league", deadlineAt: start + WEEK_MS, youReady: false, roomCode: null, won: null,
    });
    expect(league!.matches[0]!.overlap).toEqual([{ start, end: start + WEEK_MS }]);
    expect(decodeLeaguesResponse({ ok: true, leagues: [league] })).not.toBeNull();
    expect(await listMemberLeagues(db, carol, start)).toEqual([]);
  });

  it("lets either player accept a league time, and only the other accept a player's", async () => {
    expect(await acceptLeagueTime(db, alice, matchId, start)).toBe("updated");
    expect((await match()).status).toBe("scheduled");
    const at = start + 2 * 24 * 60 * MINUTE_MS;
    expect(await proposeLeagueTime(db, alice, { matchId, at }, start)).toBe("updated");
    expect(await match()).toMatchObject({ status: "proposed", scheduled_at: at, proposed_by: 1 });
    expect((await listMemberLeagues(db, bob, start))[0]!.matches[0]!.proposedBy).toBe("opponent");
    expect(await acceptLeagueTime(db, alice, matchId, start)).toBe("closed");
    expect(await acceptLeagueTime(db, bob, matchId, start)).toBe("updated");
    expect(await acceptLeagueTime(db, carol, matchId, start)).toBe("not-found");
  });

  it("only takes proposals that finish before the deadline", async () => {
    expect(await proposeLeagueTime(db, alice, { matchId, at: start - 1 }, start)).toBe("closed");
    expect(await proposeLeagueTime(db, alice, { matchId, at: start + WEEK_MS - 30 * MINUTE_MS }, start)).toBe("closed");
    expect(await proposeLeagueTime(db, alice, { matchId, at: start + WEEK_MS - 60 * MINUTE_MS }, start)).toBe("updated");
    expect(await proposeLeagueTime(db, carol, { matchId, at: start + MINUTE_MS }, start)).toBe("not-found");
  });

  it("opens readiness around the agreed time and awards a lone ready player", async () => {
    const at = start + 24 * 60 * MINUTE_MS;
    await proposeLeagueTime(db, bob, { matchId, at }, start);
    await acceptLeagueTime(db, alice, matchId, start);
    expect(await markLeagueReady(db, alice, matchId, at - 6 * MINUTE_MS)).toBe("closed");
    expect(await markLeagueReady(db, alice, matchId, at - 4 * MINUTE_MS)).toBe("updated");
    expect(await claimLeagueForfeit(db, alice, matchId, at + READY_CLOSES_MS)).toBe("closed");
    expect(await claimLeagueForfeit(db, bob, matchId, at + READY_CLOSES_MS + 1)).toBe("closed");
    expect(await claimLeagueForfeit(db, alice, matchId, at + READY_CLOSES_MS + 1)).toBe("updated");
    expect(await match()).toMatchObject({ status: "complete", result: "forfeit", winner: 1 });
  });

  it("tells both players about a change", async () => {
    await proposeLeagueTime(db, alice, { matchId, at: start + 24 * 60 * MINUTE_MS }, start);
    const { rows } = await db.query("SELECT subject_user_id FROM cluster_events WHERE event_type = 'league-updated'");
    expect(new Set(rows.map((row) => Number(row.subject_user_id)))).toEqual(new Set([alice, bob]));
  });

  it("shows standings and, after the season, the bracket", async () => {
    await claimForfeitFor(alice);
    const [league] = await listMemberLeagues(db, bob, start);
    expect(league!.standings.map((row) => [row.rank, row.username, row.points, row.you])).toEqual([
      [1, "alice", 3, false],
      [2, "bob", 0, true],
    ]);
    expect(league!.bracket).toEqual([]);
    await tickLeagues(db, start + 4 * WEEK_MS);
    const [playoffs] = await listMemberLeagues(db, bob, start + 4 * WEEK_MS);
    expect(playoffs!.status).toBe("playoffs");
    expect(playoffs!.bracket).toEqual([{
      stage: "final", slot: 0,
      a: { username: "alice", seed: 1, you: false }, b: { username: "bob", seed: 2, you: true },
      status: "proposed", result: null, advancer: null,
    }]);
    expect(decodeLeaguesResponse({ ok: true, leagues: [playoffs] })).not.toBeNull();
  });

  it("refuses a claim when both players were ready", async () => {
    const at = start + 24 * 60 * MINUTE_MS;
    await proposeLeagueTime(db, bob, { matchId, at }, start);
    await acceptLeagueTime(db, alice, matchId, start);
    await markLeagueReady(db, alice, matchId, at);
    await markLeagueReady(db, bob, matchId, at);
    expect(await claimLeagueForfeit(db, alice, matchId, at + READY_CLOSES_MS + 1)).toBe("closed");
  });
});

describe("league rooms", () => {
  const join = (code: string, userId: number, username: string) =>
    store.joinRoom(code, undefined, { allowPlayer: true, deckId: DECK, userId, username });

  async function seat(code: string, userId: number, username: string) {
    const joined = await join(code, userId, username);
    if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
    return joined;
  }

  async function startGame(code: string) {
    const tokens = [(await seat(code, alice, "alice")).token, (await seat(code, bob, "bob")).token] as const;
    const users = [alice, bob] as const;
    const dieWinner = (await store.getRoom(code))!.prep!.dieWinner;
    await store.chooseFirst(code, { token: tokens[dieWinner], userId: users[dieWinner] }, true);
    const pool = precon(DECK)!.pool;
    for (const seat of [0, 1] as const) {
      await store.presentArena(code, { token: tokens[seat], userId: users[seat] }, { weaponIds: pool.weaponIds, equipment: {} });
    }
    for (const seat of [0, 1] as const) {
      await store.presentDeck(code, { token: tokens[seat], userId: users[seat] }, {
        weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck,
      });
    }
    return tokens;
  }

  it("creates one empty room that either member can enter first", async () => {
    expect(await leagueRoomFormat(db, bob, matchId)).toBe("cc");
    const code = await store.ensureLeagueRoom(bob, matchId);
    expect(await match()).toMatchObject({ status: "proposed", room_code: code });
    expect((await store.getRoom(code))!.seats).toEqual([null, null]);
    expect((await listMemberLeagues(db, alice))[0]!.matches[0]!.roomCode).toBe(code);
    expect(await store.ensureLeagueRoom(alice, matchId)).toBe(code);
    await expect(store.ensureLeagueRoom(carol, matchId)).rejects.toBeInstanceOf(LeagueRoomUnavailable);
    await expect(leagueRoomFormat(db, carol, matchId)).rejects.toMatchObject({ reason: "not-found" });
  });

  it("gives each member their own seat and nobody else a seat", async () => {
    const code = await store.ensureLeagueRoom(alice, matchId);
    expect(await join(code, bob, "bob")).toMatchObject({ ok: true, kind: "player", seat: 1 });
    expect(await join(code, carol, "carol")).toMatchObject({ ok: false, error: "this seat is reserved for a league opponent" });
    expect(await join(code, alice, "alice")).toMatchObject({ ok: true, kind: "player", seat: 0 });
    expect(await join(code, carol, "carol")).toMatchObject({ ok: true, kind: "spectator" });
  });

  it("keeps the room while members leave and return", async () => {
    const code = await store.ensureLeagueRoom(alice, matchId);
    const first = await seat(code, alice, "alice");
    expect((await store.leaveRoom(code, { token: first.token, userId: alice })).ok).toBe(true);
    await advanceLeague(db, LEAGUE, start + MINUTE_MS);
    expect(await match()).toMatchObject({ status: "proposed", room_code: code });
    expect(await join(code, bob, "bob")).toMatchObject({ ok: true, seat: 1 });
    expect(await join(code, alice, "alice")).toMatchObject({ ok: true, seat: 0 });
    expect((await store.getRoom(code))!.prep).not.toBeNull();
  });

  it("collects an empty room only once its match closes", async () => {
    const code = await store.ensureLeagueRoom(alice, matchId);
    const later = Date.now() + 60 * MINUTE_MS;
    expect(await store.sweepRooms(later)).toEqual([]);
    await advanceLeague(db, LEAGUE, start + WEEK_MS);
    expect(await match()).toMatchObject({ status: "complete", result: "double-forfeit" });
    expect((await store.sweepRooms(later)).map((room) => room.code)).toEqual([code]);
  });

  it("waits for a started game instead of its deadline, then records the result", async () => {
    const code = await store.ensureLeagueRoom(alice, matchId);
    const tokens = await startGame(code);
    expect((await match()).status).toBe("in-room");
    await advanceLeague(db, LEAGUE, start + WEEK_MS);
    expect((await match()).status).toBe("in-room");
    const conceded = await store.applyIntent(code, { token: tokens[1], userId: bob }, { kind: "concede" });
    expect(conceded.ok).toBe(true);
    const { rows: recorded } = await db.query("SELECT id FROM matches WHERE room_code = $1", [code]);
    expect(await match()).toMatchObject({ status: "complete", result: "played", winner: 1, match_id: recorded[0].id });
  });

  it("forgets a lost room, and returns a lost game to scheduling", async () => {
    const empty = await store.ensureLeagueRoom(alice, matchId);
    await db.query("DELETE FROM rooms WHERE code = $1", [empty]);
    await advanceLeague(db, LEAGUE, start + MINUTE_MS);
    expect(await match()).toMatchObject({ status: "proposed", room_code: null });
    const code = await store.ensureLeagueRoom(bob, matchId);
    expect(code).not.toBe(empty);
    await startGame(code);
    await db.query("DELETE FROM rooms WHERE code = $1", [code]);
    await advanceLeague(db, LEAGUE, start + 2 * MINUTE_MS);
    expect(await match()).toMatchObject({ status: "proposed", room_code: null });
  });

  it("replaces a lost game's room on the next entry", async () => {
    const code = await store.ensureLeagueRoom(alice, matchId);
    await startGame(code);
    await db.query("DELETE FROM rooms WHERE code = $1", [code]);
    const replacement = await store.ensureLeagueRoom(bob, matchId);
    expect(replacement).not.toBe(code);
    expect(await match()).toMatchObject({ status: "proposed", room_code: replacement });
  });
});
