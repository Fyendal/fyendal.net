import { beforeEach, describe, expect, it } from "vitest";
import { precon } from "@fyendal/cards";
import { decodeLeaguesResponse } from "@fyendal/protocol";
import type { Queryable } from "../db.js";
import { MINUTE_MS, WEEK_MS } from "../league/availability.js";
import {
  acceptLeagueTime,
  bindLeagueRoom,
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
  async function openRoom(userId: number, username: string) {
    return store.createRoom("cc", { deckId: DECK, userId, username }, "private", "legal",
      (tx, code) => bindLeagueRoom(tx, userId, matchId, code));
  }

  async function markHostPresent(code: string) {
    await db.query(
      `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
       SELECT room_code, 'league-host', token_hash, seat, $2::bigint FROM room_seats WHERE room_code = $1 AND seat = 0`,
      [code, Date.now()],
    );
  }

  it("binds one room to the match and reserves its other seat", async () => {
    expect(await leagueRoomFormat(db, alice, matchId)).toBe("cc");
    const host = await openRoom(alice, "alice");
    expect(await match()).toMatchObject({ status: "in-room", room_code: host.code });
    expect((await listMemberLeagues(db, bob))[0]!.matches[0]!.roomCode).toBe(host.code);
    await expect(openRoom(bob, "bob")).rejects.toBeInstanceOf(LeagueRoomUnavailable);
    await expect(leagueRoomFormat(db, bob, matchId)).rejects.toMatchObject({ reason: "closed" });
    await expect(leagueRoomFormat(db, carol, matchId)).rejects.toMatchObject({ reason: "not-found" });
    await markHostPresent(host.code);
    const intruder = await store.joinRoom(host.code, undefined, { allowPlayer: true, deckId: DECK, userId: carol, username: "carol" });
    expect(intruder).toMatchObject({ ok: false, error: "this seat is reserved for a league opponent" });
    const joined = await store.joinRoom(host.code, undefined, { allowPlayer: true, deckId: DECK, userId: bob, username: "bob" });
    expect(joined).toMatchObject({ ok: true, kind: "player", seat: 1 });
  });

  it("completes the league match from the game result", async () => {
    const host = await openRoom(alice, "alice");
    await markHostPresent(host.code);
    const joined = await store.joinRoom(host.code, undefined, { allowPlayer: true, deckId: DECK, userId: bob, username: "bob" });
    if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
    const tokens = [host.token, joined.token] as const;
    const users = [alice, bob] as const;
    const dieWinner = (await store.getRoom(host.code))!.prep!.dieWinner;
    await store.chooseFirst(host.code, { token: tokens[dieWinner], userId: users[dieWinner] }, true);
    const pool = precon(DECK)!.pool;
    for (const seat of [0, 1] as const) {
      await store.presentArena(host.code, { token: tokens[seat], userId: users[seat] }, { weaponIds: pool.weaponIds, equipment: {} });
    }
    for (const seat of [0, 1] as const) {
      await store.presentDeck(host.code, { token: tokens[seat], userId: users[seat] }, {
        weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck,
      });
    }
    const conceded = await store.applyIntent(host.code, { token: tokens[1], userId: bob }, { kind: "concede" });
    expect(conceded.ok).toBe(true);
    const { rows: recorded } = await db.query("SELECT id FROM matches WHERE room_code = $1", [host.code]);
    expect(await match()).toMatchObject({ status: "complete", result: "played", winner: 1, match_id: recorded[0].id });
  });

  it("returns a match to scheduling when its room disappears", async () => {
    const host = await openRoom(alice, "alice");
    await advanceLeague(db, LEAGUE, start + MINUTE_MS);
    expect((await match()).status).toBe("in-room");
    await db.query("DELETE FROM rooms WHERE code = $1", [host.code]);
    await advanceLeague(db, LEAGUE, start + 2 * MINUTE_MS);
    expect(await match()).toMatchObject({ status: "proposed", room_code: null });
    expect(await leagueRoomFormat(db, bob, matchId)).toBe("cc");
  });

  it("returns a match to scheduling once everyone has left its room", async () => {
    const host = await openRoom(alice, "alice");
    const left = await store.leaveRoom(host.code, { token: host.token, userId: alice });
    expect(left.ok).toBe(true);
    await advanceLeague(db, LEAGUE, start + MINUTE_MS);
    expect(await match()).toMatchObject({ status: "proposed", room_code: null });
    const { rows } = await db.query("SELECT league_match_id FROM rooms WHERE code = $1", [host.code]);
    expect(rows.every((row) => row.league_match_id === null)).toBe(true);
  });

  it("does not close an in-room match at its deadline", async () => {
    await openRoom(alice, "alice");
    await advanceLeague(db, LEAGUE, start + WEEK_MS);
    expect((await match()).status).toBe("in-room");
  });
});
