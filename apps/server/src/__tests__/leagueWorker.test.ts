import { beforeEach, describe, expect, it } from "vitest";
import type { LeagueAction } from "@fyendal/shared";
import type { Queryable } from "../db.js";
import { WEEK_MS } from "../league/availability.js";
import { advanceLeague, applyLeagueActions, tickLeagues } from "../league/leagueWorker.js";
import { freshDb } from "./testdb.js";

const LEAGUE = "0123456789abcdef01234567";
const T0 = Date.UTC(2026, 10, 2, 12);
const HOUR = 3_600_000;
const ALL_WEEK = JSON.stringify(Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: 0, end: 1440 })));

let db: Queryable;

async function createLeague(options: { members: number; seasonWeeks?: number; playoffSize?: number; startsAt?: number | null }) {
  await db.query(
    `INSERT INTO leagues (id, name, format, status, time_zone, max_players, season_weeks, matches_per_week,
                          playoff_size, signup_token_hash, starts_at, pairing_seed, created_at)
     VALUES ($1, 'Test league', 'cc', 'signup', 'UTC', 20, $2, 1, $3, 'hash', $4, 'seed', 1)`,
    [LEAGUE, options.seasonWeeks ?? 2, options.playoffSize ?? 4, options.startsAt ?? null],
  );
  for (let memberId = 1; memberId <= options.members; memberId++) {
    await db.query(
      `INSERT INTO league_members (league_id, member_id, user_id, username, time_zone, availability, status, joined_at)
       VALUES ($1, $2, NULL, $3, 'UTC', $4, 'active', 1)`,
      [LEAGUE, memberId, `p${memberId}`, ALL_WEEK],
    );
  }
}

async function queue(...actions: Array<LeagueAction | Record<string, unknown>>) {
  for (const action of actions) {
    await db.query("INSERT INTO league_actions (league_id, action, created_at) VALUES ($1, $2, 1)", [LEAGUE, JSON.stringify(action)]);
  }
}

async function league() {
  const { rows } = await db.query(
    "SELECT status, starts_at, current_week, playoff_round, signup_token_hash, finished_at FROM leagues WHERE id = $1",
    [LEAGUE],
  );
  return rows[0];
}

async function matches(where = "TRUE") {
  const { rows } = await db.query(
    `SELECT id, stage, week, bracket_slot, member_a, member_b, status, result, winner, scheduled_at, deadline_at, pairing_note
     FROM league_matches WHERE league_id = $1 AND ${where} ORDER BY stage, week, bracket_slot, member_a`,
    [LEAGUE],
  );
  return rows;
}

async function actionErrors() {
  const { rows } = await db.query("SELECT action, applied_at, error FROM league_actions ORDER BY id");
  return rows.map((row) => [row.action.kind, row.error]);
}

beforeEach(async () => {
  db = await freshDb();
});

describe("league worker: starting and pairing", () => {
  it("refuses to start with fewer than two players", async () => {
    await createLeague({ members: 1 });
    await queue({ kind: "start" });
    await tickLeagues(db, T0);
    expect(await actionErrors()).toEqual([["start", "a league needs at least two players to start"]]);
    expect((await league()).status).toBe("signup");
  });

  it("starts, closes sign-up, and pairs week 1 in the same tick with suggested times", async () => {
    await createLeague({ members: 4 });
    await queue({ kind: "start" });
    await tickLeagues(db, T0);
    expect(await league()).toMatchObject({ status: "season", starts_at: T0, current_week: 1, signup_token_hash: null });
    const week1 = await matches();
    expect(week1).toHaveLength(2);
    for (const match of week1) {
      expect(match).toMatchObject({ stage: "season", week: 1, status: "proposed", deadline_at: T0 + WEEK_MS });
      expect(Number(match.scheduled_at)).toBeGreaterThanOrEqual(T0);
      expect(match.pairing_note).toMatchObject({ rematches: 0 });
    }
    expect(new Set(week1.flatMap((match) => [match.member_a, match.member_b]))).toEqual(new Set([1, 2, 3, 4]));
  });

  it("holds week 1 until a planned start", async () => {
    await createLeague({ members: 2, startsAt: T0 + 2 * 24 * HOUR });
    await queue({ kind: "start" });
    await tickLeagues(db, T0);
    expect(await league()).toMatchObject({ status: "season", starts_at: T0 + 2 * 24 * HOUR, current_week: 0 });
    expect(await matches()).toEqual([]);
    await tickLeagues(db, T0 + 2 * 24 * HOUR);
    expect(await matches()).toHaveLength(1);
  });

  it("gives an odd field a completed bye", async () => {
    await createLeague({ members: 3 });
    await queue({ kind: "start" });
    await tickLeagues(db, T0);
    const byes = await matches("member_b IS NULL");
    expect(byes).toHaveLength(1);
    expect(byes[0]).toMatchObject({ status: "complete", result: "bye" });
    expect(byes[0].winner).toBe(byes[0].member_a);
  });

  it("is idempotent when ticked repeatedly", async () => {
    await createLeague({ members: 4 });
    await queue({ kind: "start" });
    await tickLeagues(db, T0);
    await tickLeagues(db, T0);
    await advanceLeague(db, LEAGUE, T0 + HOUR);
    expect(await matches()).toHaveLength(2);
  });
});

describe("league worker: deadlines and the season", () => {
  async function startedSeason(members = 4, seasonWeeks = 2) {
    await createLeague({ members, seasonWeeks });
    await queue({ kind: "start" });
    await tickLeagues(db, T0);
    return matches();
  }

  it("resolves overdue matches by claim, unanswered proposal, then double forfeit", async () => {
    const [first, second] = await startedSeason();
    await db.query("UPDATE league_matches SET ready_b = $2 WHERE id = $1", [first.id, T0 + HOUR]);
    await db.query("UPDATE league_matches SET proposed_by = member_a WHERE id = $1", [second.id]);
    await tickLeagues(db, T0 + WEEK_MS);
    const resolved = await matches("week = 1");
    expect(resolved.find((match) => match.id === first.id)).toMatchObject({ status: "complete", result: "forfeit", winner: first.member_b });
    expect(resolved.find((match) => match.id === second.id)).toMatchObject({ status: "complete", result: "forfeit", winner: second.member_a });
    expect((await league()).current_week).toBe(2);
    const week2 = await matches("week = 2");
    expect(week2).toHaveLength(2);
    // Two winners and two losers meet each other in week 2.
    const winners = new Set([first.member_b, second.member_a]);
    for (const match of week2) expect(winners.has(match.member_a)).toBe(winners.has(match.member_b));
  });

  it("leaves an in-room match and an extended deadline open", async () => {
    const [first, second] = await startedSeason();
    await db.query("UPDATE league_matches SET status = 'in-room' WHERE id = $1", [first.id]);
    await queue({ kind: "extend-deadline", matchId: second.id, deadlineAt: T0 + WEEK_MS + 24 * HOUR });
    await tickLeagues(db, T0 + WEEK_MS);
    expect((await matches("week = 1")).map((match) => match.status).sort()).toEqual(["in-room", "proposed"]);
    await tickLeagues(db, T0 + WEEK_MS + 24 * HOUR);
    expect((await matches(`id = '${second.id}'`))[0]).toMatchObject({ status: "complete", result: "double-forfeit" });
  });

  it("waits for open season matches before seeding the playoffs", async () => {
    const [first] = await startedSeason(4, 1);
    await db.query("UPDATE league_matches SET status = 'in-room' WHERE id = $1", [first.id]);
    await tickLeagues(db, T0 + WEEK_MS);
    expect((await league()).status).toBe("season");
    await queue({ kind: "set-result", matchId: first.id, outcome: "a" });
    await tickLeagues(db, T0 + WEEK_MS + HOUR);
    expect((await league()).status).toBe("playoffs");
  });
});

describe("league worker: playoffs", () => {
  async function playoffsWithFour() {
    await createLeague({ members: 4, seasonWeeks: 1, playoffSize: 4 });
    await queue({ kind: "start" });
    await tickLeagues(db, T0);
    for (const match of await matches()) await queue({ kind: "set-result", matchId: match.id, outcome: "a" });
    await tickLeagues(db, T0 + HOUR);
    await tickLeagues(db, T0 + WEEK_MS);
  }

  it("seeds by standings and plays the bracket to a champion", async () => {
    await playoffsWithFour();
    expect(await league()).toMatchObject({ status: "playoffs", playoff_round: 1 });
    const { rows: seeds } = await db.query("SELECT member_id, playoff_seed FROM league_members ORDER BY playoff_seed");
    expect(seeds.every((row) => row.playoff_seed !== null)).toBe(true);
    const semis = await matches("stage = 'semifinal'");
    expect(semis).toHaveLength(2);
    expect(Number(semis[0].deadline_at)).toBe(T0 + WEEK_MS + 96 * HOUR);
    const seedOf = new Map(seeds.map((row) => [row.member_id, row.playoff_seed]));
    expect(semis.map((match) => [seedOf.get(match.member_a), seedOf.get(match.member_b)]).sort())
      .toEqual([[1, 4], [2, 3]]);

    const [one, two] = semis;
    await queue({ kind: "set-result", matchId: one.id, outcome: "b" }, { kind: "set-result", matchId: two.id, outcome: "draw" });
    await tickLeagues(db, T0 + WEEK_MS + HOUR);
    // The draw is replayed; the final waits for it.
    expect(await matches("stage = 'final'")).toEqual([]);
    const replay = (await matches("stage = 'semifinal' AND status <> 'complete'"))[0];
    expect([replay.member_a, replay.member_b]).toEqual([two.member_a, two.member_b]);

    await queue({ kind: "set-result", matchId: one.id, outcome: "a" });
    await queue({ kind: "set-result", matchId: replay.id, outcome: "a" });
    await tickLeagues(db, T0 + WEEK_MS + 2 * HOUR);
    const [final] = await matches("stage = 'final'");
    expect(new Set([final.member_a, final.member_b])).toEqual(new Set([one.member_a, replay.member_a]));
    await queue({ kind: "set-result", matchId: one.id, outcome: "b" });
    await queue({ kind: "set-result", matchId: final.id, outcome: "b" });
    await tickLeagues(db, T0 + WEEK_MS + 3 * HOUR);
    expect(await league()).toMatchObject({ status: "complete", finished_at: T0 + WEEK_MS + 3 * HOUR });
    expect((await actionErrors()).filter(([, error]) => error !== null))
      .toEqual([["set-result", "a later playoff round is already paired"]]);
  });

  it("forfeits a dropped player's playoff matches, including later rounds", async () => {
    await playoffsWithFour();
    const [one, two] = await matches("stage = 'semifinal'");
    await queue({ kind: "drop", memberId: one.member_a }, { kind: "set-result", matchId: two.id, outcome: "a" });
    await tickLeagues(db, T0 + WEEK_MS + HOUR);
    expect((await matches(`id = '${one.id}'`))[0]).toMatchObject({ status: "complete", result: "forfeit", winner: one.member_b });
    const [final] = await matches("stage = 'final'");
    expect(final.status).toBe("proposed");
    await queue({ kind: "drop", memberId: final.member_b });
    await tickLeagues(db, T0 + WEEK_MS + 2 * HOUR);
    expect((await matches("stage = 'final'"))[0]).toMatchObject({ status: "complete", result: "forfeit", winner: final.member_a });
    await tickLeagues(db, T0 + WEEK_MS + 3 * HOUR);
    expect((await league()).status).toBe("complete");
  });

  it("advances the better seed on a double forfeit at the round deadline", async () => {
    await playoffsWithFour();
    await tickLeagues(db, T0 + WEEK_MS + 96 * HOUR);
    const semis = await matches("stage = 'semifinal'");
    expect(semis.every((match) => match.result === "double-forfeit")).toBe(true);
    const [final] = await matches("stage = 'final'");
    expect(new Set([final.member_a, final.member_b])).toEqual(new Set(semis.map((match) => match.member_a)));
  });
});

describe("league worker: operator actions", () => {
  it("drops by deleting during sign-up and by cancelling season matches later", async () => {
    await createLeague({ members: 4 });
    await queue({ kind: "drop", memberId: 4 }, { kind: "start" });
    await tickLeagues(db, T0);
    expect((await db.query("SELECT member_id FROM league_members ORDER BY member_id")).rows.map((row) => row.member_id))
      .toEqual([1, 2, 3]);
    const target = (await matches("member_b IS NOT NULL"))[0];
    await queue({ kind: "drop", memberId: target.member_a }, { kind: "drop", memberId: target.member_a });
    await tickLeagues(db, T0 + HOUR);
    expect((await matches(`id = '${target.id}'`))[0].status).toBe("cancelled");
    expect((await actionErrors()).at(-1)).toEqual(["drop", "no active member has that id"]);
  });

  it("validates results and deadlines", async () => {
    await createLeague({ members: 3 });
    await queue({ kind: "start" });
    await tickLeagues(db, T0);
    const bye = (await matches("member_b IS NULL"))[0];
    const played = (await matches("member_b IS NOT NULL"))[0];
    await queue(
      { kind: "set-result", matchId: bye.id, outcome: "a" },
      { kind: "set-result", matchId: "missing", outcome: "a" },
      { kind: "extend-deadline", matchId: played.id, deadlineAt: T0 },
      { kind: "set-result", matchId: played.id, outcome: "void" },
      { kind: "extend-deadline", matchId: played.id, deadlineAt: T0 + 2 * WEEK_MS },
      { kind: "pair-now" },
    );
    await tickLeagues(db, T0 + HOUR);
    expect(await actionErrors()).toEqual([
      ["start", null],
      ["set-result", "byes cannot be changed"],
      ["set-result", "no match in this league has that id"],
      ["extend-deadline", "the new deadline must be in the future"],
      ["set-result", null],
      ["extend-deadline", "the match is already finished"],
      ["pair-now", "unrecognized action"],
    ]);
    expect((await matches(`id = '${played.id}'`))[0]).toMatchObject({ status: "cancelled", result: null });
  });

  it("cancels the league and its open matches, then rejects further actions", async () => {
    await createLeague({ members: 4 });
    await queue({ kind: "start" });
    await tickLeagues(db, T0);
    await queue({ kind: "cancel" }, { kind: "close-signup" }, { kind: "cancel" });
    await tickLeagues(db, T0 + HOUR);
    expect(await league()).toMatchObject({ status: "cancelled", finished_at: T0 + HOUR });
    expect((await matches()).every((match) => match.status === "cancelled")).toBe(true);
    expect((await actionErrors()).slice(1)).toEqual([
      ["cancel", null],
      ["close-signup", "sign-up is not open"],
      ["cancel", "the league has already finished"],
    ]);
  });

  it("closes sign-up without starting", async () => {
    await createLeague({ members: 2 });
    await queue({ kind: "close-signup" });
    expect(await applyLeagueActions(db, LEAGUE, T0)).toBe(1);
    expect(await league()).toMatchObject({ status: "signup", signup_token_hash: null });
  });
});
