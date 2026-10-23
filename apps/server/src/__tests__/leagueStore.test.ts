import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeAccountExportResponse, decodeLeagueJoinPreviewResponse, decodeLeaguesResponse } from "@fyendal/protocol";
import type { LeagueAvailabilityWindow } from "@fyendal/shared";
import { deleteAccount, exportAccount } from "../accounts.js";
import { login, register, sessionForToken } from "../auth.js";
import type { Queryable } from "../db.js";
import { createApiServer } from "../http.js";
import {
  joinLeague,
  leaguePreview,
  leaveLeague,
  listMemberLeagues,
  setLeagueAvailability,
} from "../league/leagueStore.js";
import { hashToken, newToken } from "../tokenHash.js";
import { freshDb } from "./testdb.js";

const LEAGUE = "a1b2c3d4e5f6a1b2c3d4e5f6";
const evenings: LeagueAvailabilityWindow[] = [{ weekday: 5, start: 18 * 60, end: 22 * 60 }];

let db: Queryable;
let token: string;

async function createLeague(options: { maxPlayers?: number; autoStart?: boolean; status?: string } = {}): Promise<string> {
  const raw = newToken();
  await db.query(
    `INSERT INTO leagues (id, name, format, status, time_zone, max_players, auto_start, matches_per_week,
                          signup_token_hash, pairing_seed, created_at)
     VALUES ($1, 'Friday league', 'cc', $2, 'UTC', $3, $4, 2, $5, 'seed', 1)`,
    [LEAGUE, options.status ?? "signup", options.maxPlayers ?? 8, options.autoStart ?? false, hashToken(raw)],
  );
  return raw;
}

async function user(name: string): Promise<number> {
  const { rows } = await db.query(
    "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ($1, $2, 'hash', 1) RETURNING id",
    [name, name.toLowerCase()],
  );
  return Number(rows[0].id);
}

const join = (userId: number, timeZone = "America/New_York") =>
  joinLeague(db, userId, { token, timeZone, availability: evenings }, 100);

beforeEach(async () => {
  db = await freshDb();
  token = await createLeague({ maxPlayers: 3, autoStart: true });
});

describe("league sign-up", () => {
  it("previews the link with seat counts and membership", async () => {
    const alice = await user("alice");
    expect(await leaguePreview(db, token, alice)).toEqual({
      name: "Friday league", format: "cc", status: "signup", startsAt: null,
      members: 0, maxPlayers: 3, matchesPerWeek: 2, seasonWeeks: 4, joined: false,
    });
    await join(alice);
    expect(await leaguePreview(db, token, alice)).toMatchObject({ members: 1, joined: true });
    expect(await leaguePreview(db, token, null)).toMatchObject({ members: 1, joined: false });
    expect(await leaguePreview(db, newToken(), alice)).toBeNull();
  });

  it("numbers members, ignores repeat joins, and closes sign-up when full", async () => {
    const [alice, bob, carol, dave] = [await user("alice"), await user("bob"), await user("carol"), await user("dave")];
    expect(await join(alice)).toBe("joined");
    expect(await join(alice)).toBe("already-joined");
    expect(await join(bob)).toBe("joined");
    expect(await join(carol)).toBe("joined");
    expect(await join(dave)).toBe("not-found");
    const { rows: members } = await db.query("SELECT member_id, username FROM league_members ORDER BY member_id");
    expect(members).toEqual([
      { member_id: 1, username: "alice" }, { member_id: 2, username: "bob" }, { member_id: 3, username: "carol" },
    ]);
    expect((await db.query("SELECT signup_token_hash FROM leagues")).rows).toEqual([{ signup_token_hash: null }]);
    const { rows: actions } = await db.query("SELECT action FROM league_actions");
    expect(actions.map((row) => row.action)).toEqual([{ kind: "start" }]);
  });

  it("reports a full league whose link is still open", async () => {
    await db.query("UPDATE leagues SET max_players = 2");
    await db.query(
      `INSERT INTO league_members (league_id, member_id, user_id, username, time_zone, availability, status, joined_at)
       VALUES ($1, 1, NULL, NULL, 'UTC', '[]', 'active', 1), ($1, 2, NULL, NULL, 'UTC', '[]', 'active', 1)`,
      [LEAGUE],
    );
    expect(await join(await user("alice"))).toBe("full");
  });

  it("lets members leave only before the season", async () => {
    const alice = await user("alice");
    await join(alice);
    expect(await leaveLeague(db, alice, LEAGUE)).toBe("updated");
    expect(await leaveLeague(db, alice, LEAGUE)).toBe("not-found");
    await join(alice);
    await db.query("UPDATE leagues SET status = 'season'");
    expect(await leaveLeague(db, alice, LEAGUE)).toBe("closed");
  });

  it("updates the template or a current-or-later week", async () => {
    const alice = await user("alice");
    await join(alice);
    const weekend: LeagueAvailabilityWindow[] = [{ weekday: 6, start: 600, end: 720 }];
    const request = { leagueId: LEAGUE, timeZone: "Europe/London", availability: weekend };
    expect(await setLeagueAvailability(db, alice, request)).toBe("updated");
    expect((await listMemberLeagues(db, alice))[0]).toMatchObject({ timeZone: "Europe/London", availability: weekend });
    await db.query("UPDATE leagues SET status = 'season', current_week = 2");
    expect(await setLeagueAvailability(db, alice, { ...request, week: 1 })).toBe("closed");
    expect(await setLeagueAvailability(db, alice, { ...request, week: 5 })).toBe("closed");
    expect(await setLeagueAvailability(db, alice, { ...request, availability: [], week: 2 })).toBe("updated");
    expect(await setLeagueAvailability(db, alice, { ...request, availability: evenings, week: 2 })).toBe("updated");
    expect((await db.query("SELECT week, availability FROM league_availability_weeks")).rows)
      .toEqual([{ week: 2, availability: evenings }]);
    expect(await setLeagueAvailability(db, await user("bob"), request)).toBe("not-found");
  });

  it("lists memberships with the active roster", async () => {
    const [alice, bob] = [await user("alice"), await user("bob")];
    await join(alice);
    await join(bob, "Asia/Tokyo");
    const [league] = await listMemberLeagues(db, bob);
    expect(league).toEqual({
      id: LEAGUE, name: "Friday league", format: "cc", status: "signup", startsAt: null,
      seasonWeeks: 4, matchesPerWeek: 2, matchMinutes: 60, maxPlayers: 3, signupOpen: true,
      roster: [{ username: "alice", you: false }, { username: "bob", you: true }],
      timeZone: "Asia/Tokyo", availability: evenings, matches: [],
    });
    expect(decodeLeaguesResponse({ ok: true, leagues: [league] })).not.toBeNull();
    expect(await listMemberLeagues(db, await user("carol"))).toEqual([]);
  });
});

describe("league account data", () => {
  async function registered(name: string): Promise<number> {
    await register(db, name, "password1");
    const { rows } = await db.query("SELECT id FROM users WHERE username = $1", [name]);
    return Number(rows[0].id);
  }

  async function seasonWithMatches(): Promise<[number, number]> {
    const [alice, bob] = [await registered("alice"), await registered("bob")];
    await join(alice);
    await join(bob);
    await db.query("UPDATE leagues SET status = 'season', current_week = 1");
    await db.query(
      `INSERT INTO league_matches (id, league_id, stage, week, member_a, member_b, status, winner, result, deadline_at, created_at)
       VALUES ('m1', $1, 'season', 1, 1, 2, 'complete', 2, 'played', 10, 1),
              ('m2', $1, 'season', 1, 1, 2, 'scheduled', NULL, NULL, 10, 2)`,
      [LEAGUE],
    );
    await setLeagueAvailability(db, alice, { leagueId: LEAGUE, timeZone: "UTC", availability: [], week: 1 });
    return [alice, bob];
  }

  it("exports memberships, week overrides, and matches", async () => {
    const [alice] = await seasonWithMatches();
    const exported = await exportAccount(db, alice);
    expect(exported?.leagues).toEqual([{
      name: "Friday league", format: "cc", leagueStatus: "season", memberStatus: "active", joinedAt: 100,
      timeZone: "UTC", availability: evenings,
      availabilityWeeks: [{ week: 1, availability: [] }],
      matches: [
        { stage: "season", week: 1, bracketSlot: null, opponent: "bob", status: "complete", scheduledAt: null, result: "played", won: false },
        { stage: "season", week: 1, bracketSlot: null, opponent: "bob", status: "scheduled", scheduledAt: null, result: null, won: null },
      ],
    }]);
    expect(decodeAccountExportResponse({ ok: true, export: exported })).not.toBeNull();
  });

  it("drops a deleted member mid-season and keeps the opponent's history", async () => {
    const [alice, bob] = await seasonWithMatches();
    expect((await deleteAccount(db, alice, "password1")).status).toBe("deleted");
    expect((await db.query("SELECT member_id, user_id, username, status, availability FROM league_members ORDER BY member_id")).rows)
      .toEqual([
        { member_id: 1, user_id: null, username: null, status: "dropped", availability: [] },
        { member_id: 2, user_id: bob, username: "bob", status: "active", availability: evenings },
      ]);
    expect((await db.query("SELECT id, status FROM league_matches ORDER BY id")).rows)
      .toEqual([{ id: "m1", status: "complete" }, { id: "m2", status: "cancelled" }]);
    expect((await db.query("SELECT 1 FROM league_availability_weeks")).rows).toEqual([]);
    expect((await exportAccount(db, bob))?.leagues[0]?.matches[0]).toMatchObject({ opponent: null, won: true });
  });

  it("removes a sign-up membership outright", async () => {
    const erin = await registered("Erin");
    await join(erin);
    expect((await deleteAccount(db, erin, "password1")).status).toBe("deleted");
    expect((await db.query("SELECT 1 FROM league_members")).rows).toEqual([]);
  });
});

describe("league HTTP routes", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function start(): Promise<string> {
    const server = createApiServer({ db, trustedProxyHops: 1 });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    return `http://localhost:${(server.address() as AddressInfo).port}`;
  }

  it("previews, joins, edits availability, lists, and leaves", async () => {
    const url = await start();
    await register(db, "Frank", "password1");
    const session = await login(db, "frank", "password1");
    if (!session.ok || !(await sessionForToken(db, session.token))) throw new Error("login failed");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` };
    const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

    const preview = await fetch(`${url}/api/leagues/join/${token}`);
    expect(decodeLeagueJoinPreviewResponse(await preview.json())?.league).toMatchObject({ members: 0, joined: false });
    expect((await fetch(`${url}/api/leagues/join/${"x".repeat(43)}`)).status).toBe(404);
    expect((await fetch(`${url}/api/leagues/join/short`)).status).toBe(404);

    expect((await fetch(`${url}/api/leagues/join`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, timeZone: "UTC", availability: [] }),
    })).status).toBe(401);
    expect((await post("/api/leagues/join", { token, timeZone: "Nowhere/Land", availability: [] })).status).toBe(400);
    expect((await post("/api/leagues/join", { token, timeZone: "UTC", availability: evenings })).status).toBe(200);
    expect((await post("/api/leagues/join", { token, timeZone: "UTC", availability: evenings })).status).toBe(200);

    expect((await post("/api/leagues/availability", { leagueId: LEAGUE, timeZone: "Asia/Tokyo", availability: [] })).status).toBe(200);
    const listed = decodeLeaguesResponse(await (await fetch(`${url}/api/leagues`, { headers })).json());
    expect(listed?.leagues[0]).toMatchObject({ id: LEAGUE, timeZone: "Asia/Tokyo", availability: [] });

    expect((await post("/api/leagues/leave", { leagueId: LEAGUE })).status).toBe(200);
    expect((await post("/api/leagues/leave", { leagueId: LEAGUE })).status).toBe(404);
    expect((await post("/api/leagues/availability", { leagueId: LEAGUE, timeZone: "UTC", availability: [] })).status).toBe(404);
  });
});
