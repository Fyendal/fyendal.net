import { randomBytes } from "node:crypto";
import type { LeagueAction, LeagueMatchResult, LeagueMatchStatus, LeagueStage } from "@fyendal/shared";
import { decodeLeagueAction } from "@fyendal/protocol";
import { withTransaction, type Queryable } from "../db.js";
import { consoleError } from "../logging.js";
import { materializeWeek, seasonWeekBounds, WEEK_MS, type Interval } from "./availability.js";
import {
  openingRound,
  pendingPlayoffPairings,
  playoffChampion,
  playoffFieldSize,
  playoffStages,
  type PlayoffMatch,
  type PlayoffPairing,
  type PlayoffSize,
} from "./bracket.js";
import { resolveOverdue } from "./forfeits.js";
import {
  dropLeagueMember,
  leagueStatus,
  matchResult,
  matchStage,
  matchStatus,
  nullableNumber,
  storedWindows,
} from "./leagueStore.js";
import { pairWeek, suggestSlots } from "./pairing.js";
import { computeStandings, type StandingRow } from "./standings.js";

/** The worker runs under this lease; ticks are frequent so dashboard actions apply promptly. */
export const LEAGUE_LEASE = "league";
export const LEAGUE_TICK_INTERVAL_MS = 15_000;
const HOUR_MS = 3_600_000;
const OPEN_STATUSES: readonly LeagueMatchStatus[] = ["unscheduled", "proposed", "scheduled", "in-room"];

interface League {
  id: string;
  status: ReturnType<typeof leagueStatus>;
  startsAt: number | null;
  seasonWeeks: number;
  matchesPerWeek: number;
  matchMinutes: number;
  playoffSize: PlayoffSize;
  playoffRoundHours: number;
  currentWeek: number;
  seed: string;
}

interface Member {
  memberId: number;
  active: boolean;
  timeZone: string;
  availability: ReturnType<typeof storedWindows>;
  playoffSeed: number | null;
}

interface Match {
  id: string;
  stage: LeagueStage;
  week: number | null;
  slot: number | null;
  a: number;
  b: number | null;
  status: LeagueMatchStatus;
  result: LeagueMatchResult | null;
  winner: number | null;
  readyA: boolean;
  readyB: boolean;
  proposedBy: number | null;
  deadlineAt: number;
}

function playoffSize(value: unknown): PlayoffSize {
  const size = Number(value);
  if (size === 2 || size === 4 || size === 8) return size;
  throw new Error("league playoff size is corrupt");
}

/** Locks the league row for the rest of the transaction. */
async function lockLeague(tx: Queryable, leagueId: string): Promise<League | null> {
  const { rows } = await tx.query(
    `SELECT id, status, starts_at, season_weeks, matches_per_week, match_minutes, playoff_size,
            playoff_round_hours, current_week, pairing_seed
     FROM leagues WHERE id = $1 FOR UPDATE`,
    [leagueId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    status: leagueStatus(row.status),
    startsAt: nullableNumber(row.starts_at),
    seasonWeeks: Number(row.season_weeks),
    matchesPerWeek: Number(row.matches_per_week),
    matchMinutes: Number(row.match_minutes),
    playoffSize: playoffSize(row.playoff_size),
    playoffRoundHours: Number(row.playoff_round_hours),
    currentWeek: Number(row.current_week),
    seed: String(row.pairing_seed),
  };
}

async function loadMembers(tx: Queryable, leagueId: string): Promise<Member[]> {
  const { rows } = await tx.query(
    `SELECT member_id, status, time_zone, availability, playoff_seed FROM league_members
     WHERE league_id = $1 ORDER BY member_id`,
    [leagueId],
  );
  return rows.map((row) => ({
    memberId: Number(row.member_id),
    active: row.status === "active",
    timeZone: String(row.time_zone),
    availability: storedWindows(row.availability, "league availability"),
    playoffSeed: nullableNumber(row.playoff_seed),
  }));
}

async function loadMatches(tx: Queryable, leagueId: string): Promise<Match[]> {
  const { rows } = await tx.query(
    `SELECT id, stage, week, bracket_slot, member_a, member_b, status, result, winner, ready_a, ready_b,
            proposed_by, deadline_at
     FROM league_matches WHERE league_id = $1 ORDER BY created_at, id`,
    [leagueId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    stage: matchStage(row.stage),
    week: nullableNumber(row.week),
    slot: nullableNumber(row.bracket_slot),
    a: Number(row.member_a),
    b: nullableNumber(row.member_b),
    status: matchStatus(row.status),
    result: row.result === null ? null : matchResult(row.result),
    winner: nullableNumber(row.winner),
    readyA: row.ready_a !== null,
    readyB: row.ready_b !== null,
    proposedBy: nullableNumber(row.proposed_by),
    deadlineAt: Number(row.deadline_at),
  }));
}

function seasonStandings(league: League, members: readonly Member[], matches: readonly Match[]): StandingRow[] {
  return computeStandings(
    members.map((member) => ({ memberId: member.memberId, dropped: !member.active })),
    matches
      .filter((match) => match.stage === "season" && match.status === "complete" && match.result !== null)
      .map((match) => ({ a: match.a, b: match.b, result: match.result!, winner: match.winner })),
    league.seed,
  );
}

const newMatchId = () => randomBytes(12).toString("hex");

async function insertBye(tx: Queryable, leagueId: string, week: number, memberId: number, deadlineAt: number, now: number) {
  await tx.query(
    `INSERT INTO league_matches (id, league_id, stage, week, member_a, status, winner, result, deadline_at, created_at)
     VALUES ($1, $2, 'season', $3, $4, 'complete', $4, 'bye', $5, $6)`,
    [newMatchId(), leagueId, week, memberId, deadlineAt, now],
  );
}

/** Inserts matches with a suggested time inside the pair's overlap, or unscheduled when none fits. */
async function insertMatches(
  tx: Queryable,
  league: League,
  matches: ReadonlyArray<{ stage: LeagueStage; week: number | null; slot: number | null; a: number; b: number; note: unknown }>,
  availability: ReadonlyMap<number, Interval[]>,
  window: Interval,
  now: number,
): Promise<void> {
  const slots = suggestSlots(matches, availability, league.matchMinutes, Math.max(now, window.start));
  for (const [index, match] of matches.entries()) {
    const slot = slots[index] ?? null;
    await tx.query(
      `INSERT INTO league_matches (id, league_id, stage, week, bracket_slot, member_a, member_b, status,
                                   proposed_at, scheduled_at, deadline_at, pairing_note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [newMatchId(), league.id, match.stage, match.week, match.slot, match.a, match.b,
        slot === null ? "unscheduled" : "proposed", slot === null ? null : now, slot,
        window.end, match.note === null ? null : JSON.stringify(match.note), now],
    );
  }
}

async function pairSeasonWeek(tx: Queryable, league: League, week: number, now: number): Promise<void> {
  const bounds = seasonWeekBounds(league.startsAt!, week);
  const [members, matches, { rows: overrides }] = await Promise.all([
    loadMembers(tx, league.id),
    loadMatches(tx, league.id),
    tx.query("SELECT member_id, availability FROM league_availability_weeks WHERE league_id = $1 AND week = $2", [league.id, week]),
  ]);
  const weekWindows = new Map(overrides.map((row) => [
    Number(row.member_id), storedWindows(row.availability, "league week availability"),
  ]));
  const active = members.filter((member) => member.active);
  const availability = new Map(active.map((member) => [
    member.memberId,
    materializeWeek(weekWindows.get(member.memberId) ?? member.availability, member.timeZone, bounds.start, bounds.end),
  ]));
  const standings = new Map(seasonStandings(league, members, matches).map((row) => [row.memberId, row]));
  const pairing = pairWeek({
    week,
    seasonWeeks: league.seasonWeeks,
    matchesPerWeek: league.matchesPerWeek,
    matchMinutes: league.matchMinutes,
    members: active.map((member) => {
      const row = standings.get(member.memberId);
      return {
        memberId: member.memberId,
        points: row?.points ?? 0,
        matches: row?.matches ?? 0,
        byes: row?.byes ?? 0,
        availability: availability.get(member.memberId)!,
      };
    }),
    priorPairs: matches
      .filter((match) => match.stage === "season" && match.b !== null && match.status !== "cancelled")
      .map((match) => [match.a, match.b!] as const),
    seed: league.seed,
  });
  await insertMatches(
    tx,
    league,
    pairing.matches.map((match) => ({ stage: "season", week, slot: null, a: match.a, b: match.b, note: match.note })),
    availability,
    bounds,
    now,
  );
  for (const memberId of pairing.byes) await insertBye(tx, league.id, week, memberId, bounds.end, now);
}

/** Playoff matches use templates only; week overrides belong to season weeks. */
async function createPlayoffMatches(
  tx: Queryable,
  league: League,
  members: readonly Member[],
  pairings: readonly PlayoffPairing[],
  now: number,
): Promise<void> {
  const window = { start: now, end: now + league.playoffRoundHours * HOUR_MS };
  const byId = new Map(members.map((member) => [member.memberId, member]));
  const playable: PlayoffPairing[] = [];
  for (const pairing of pairings) {
    const [a, b] = [byId.get(pairing.a), byId.get(pairing.b)];
    if (a?.active && b?.active) {
      playable.push(pairing);
      continue;
    }
    // A member dropped after advancing forfeits; both dropped advances the better seed.
    await tx.query(
      `INSERT INTO league_matches (id, league_id, stage, bracket_slot, member_a, member_b, status, winner, result,
                                   deadline_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'complete', $7, $8, $9, $10)`,
      [newMatchId(), league.id, pairing.stage, pairing.slot, pairing.a, pairing.b,
        a?.active ? pairing.a : b?.active ? pairing.b : null,
        a?.active || b?.active ? "forfeit" : "double-forfeit", window.end, now],
    );
  }
  const availability = new Map(playable.flatMap((pairing) => [pairing.a, pairing.b]).map((memberId) => {
    const member = byId.get(memberId)!;
    return [memberId, materializeWeek(member.availability, member.timeZone, window.start, window.end)] as const;
  }));
  await insertMatches(
    tx,
    league,
    playable.map((pairing) => ({ stage: pairing.stage, week: null, slot: pairing.slot, a: pairing.a, b: pairing.b, note: null })),
    availability,
    window,
    now,
  );
}

async function completeLeague(tx: Queryable, leagueId: string, now: number): Promise<void> {
  await tx.query("UPDATE leagues SET status = 'complete', finished_at = $2 WHERE id = $1", [leagueId, now]);
}

async function startPlayoffs(tx: Queryable, league: League, now: number): Promise<void> {
  const [members, matches] = await Promise.all([loadMembers(tx, league.id), loadMatches(tx, league.id)]);
  const ranked = seasonStandings(league, members, matches).filter((row) => !row.dropped).map((row) => row.memberId);
  const size = playoffFieldSize(league.playoffSize, ranked.length);
  if (size === 0) {
    await completeLeague(tx, league.id, now);
    return;
  }
  for (const [index, memberId] of ranked.slice(0, size).entries()) {
    await tx.query(
      "UPDATE league_members SET playoff_seed = $3 WHERE league_id = $1 AND member_id = $2",
      [league.id, memberId, index + 1],
    );
  }
  await tx.query("UPDATE leagues SET status = 'playoffs', playoff_round = 1 WHERE id = $1", [league.id]);
  await createPlayoffMatches(tx, league, members, openingRound(ranked, size), now);
}

async function advancePlayoffs(tx: Queryable, league: League, now: number): Promise<void> {
  const [members, matches] = await Promise.all([loadMembers(tx, league.id), loadMatches(tx, league.id)]);
  const seeds = new Map(members.flatMap((member) =>
    member.playoffSeed === null ? [] : [[member.memberId, member.playoffSeed] as const]));
  const size = playoffSize(seeds.size);
  const bracket: PlayoffMatch[] = matches.flatMap((match) => match.stage === "season" || match.b === null
    ? []
    : [{ stage: match.stage, slot: match.slot!, a: match.a, b: match.b, status: match.status, result: match.result, winner: match.winner }]);
  if (playoffChampion(bracket) !== null) {
    await completeLeague(tx, league.id, now);
    return;
  }
  const pending = pendingPlayoffPairings(size, bracket, seeds);
  if (!pending.length) return;
  await createPlayoffMatches(tx, league, members, pending, now);
  const stages = playoffStages(size);
  const round = Math.max(...pending.map((pairing) => stages.indexOf(pairing.stage) + 1));
  await tx.query("UPDATE leagues SET playoff_round = GREATEST(playoff_round, $2) WHERE id = $1", [league.id, round]);
}

/** Resolves unplayed matches past their deadline. A match whose game is
 * already in a room waits for that game. */
async function resolveOverdueMatches(tx: Queryable, leagueId: string, now: number): Promise<void> {
  const overdue = (await loadMatches(tx, leagueId)).filter((match) => match.b !== null
    && match.deadlineAt <= now && (match.status === "unscheduled" || match.status === "proposed" || match.status === "scheduled"));
  for (const match of overdue) {
    const outcome = resolveOverdue({ ...match, b: match.b! });
    await tx.query(
      "UPDATE league_matches SET status = 'complete', result = $2, winner = $3 WHERE id = $1",
      [match.id, outcome.result, outcome.winner],
    );
  }
}

/** One league's scheduled work: resolve overdue matches, pair each season
 * week once its start passes, seed the bracket after the last week, and
 * advance the playoffs. Safe to repeat; every step checks state first. */
export async function advanceLeague(db: Queryable, leagueId: string, now = Date.now()): Promise<void> {
  await withTransaction(db, async (tx) => {
    let league = await lockLeague(tx, leagueId);
    if (!league || (league.status !== "season" && league.status !== "playoffs")) return;
    await resolveOverdueMatches(tx, league.id, now);
    const startsAt = league.startsAt;
    if (league.status === "season" && startsAt !== null && now >= startsAt) {
      const dueWeek = Math.min(league.seasonWeeks, Math.floor((now - startsAt) / WEEK_MS) + 1);
      for (let week = league.currentWeek + 1; week <= dueWeek; week++) {
        await pairSeasonWeek(tx, league, week, now);
        await tx.query("UPDATE leagues SET current_week = $2 WHERE id = $1", [league.id, week]);
      }
      league = { ...league, currentWeek: Math.max(league.currentWeek, dueWeek) };
      const seasonOver = now >= startsAt + league.seasonWeeks * WEEK_MS;
      const { rows: open } = await tx.query(
        "SELECT 1 FROM league_matches WHERE league_id = $1 AND stage = 'season' AND status = ANY($2) LIMIT 1",
        [league.id, OPEN_STATUSES],
      );
      if (seasonOver && open.length === 0) {
        await startPlayoffs(tx, league, now);
        return;
      }
    }
    if (league.status === "playoffs") await advancePlayoffs(tx, league, now);
  });
}

/** Applies one operator action to a locked league. Returns why it was
 * rejected, or null once applied. */
async function applyAction(tx: Queryable, league: League, action: LeagueAction, now: number): Promise<string | null> {
  const finished = league.status === "complete" || league.status === "cancelled";
  switch (action.kind) {
    case "close-signup":
      if (league.status !== "signup") return "sign-up is not open";
      await tx.query("UPDATE leagues SET signup_token_hash = NULL WHERE id = $1", [league.id]);
      return null;
    case "start": {
      if (league.status !== "signup") return "the league has already started";
      const { rows } = await tx.query(
        "SELECT COUNT(*) AS members FROM league_members WHERE league_id = $1 AND status = 'active'",
        [league.id],
      );
      if (Number(rows[0]?.members ?? 0) < 2) return "a league needs at least two players to start";
      // A planned start in the future holds week 1 until then.
      const startsAt = league.startsAt !== null && league.startsAt > now ? league.startsAt : now;
      await tx.query(
        "UPDATE leagues SET status = 'season', signup_token_hash = NULL, starts_at = $2, current_week = 0 WHERE id = $1",
        [league.id, startsAt],
      );
      return null;
    }
    case "cancel":
      if (finished) return "the league has already finished";
      await tx.query(
        "UPDATE leagues SET status = 'cancelled', signup_token_hash = NULL, finished_at = $2 WHERE id = $1",
        [league.id, now],
      );
      await tx.query(
        "UPDATE league_matches SET status = 'cancelled' WHERE league_id = $1 AND status = ANY($2)",
        [league.id, OPEN_STATUSES],
      );
      return null;
    case "drop": {
      if (finished) return "the league has already finished";
      const { rows } = await tx.query(
        "SELECT 1 FROM league_members WHERE league_id = $1 AND member_id = $2 AND status = 'active'",
        [league.id, action.memberId],
      );
      if (!rows.length) return "no active member has that id";
      if (league.status === "signup") {
        await tx.query("DELETE FROM league_members WHERE league_id = $1 AND member_id = $2", [league.id, action.memberId]);
      } else {
        await dropLeagueMember(tx, league.id, action.memberId);
      }
      return null;
    }
    case "set-result": {
      if (league.status !== "season" && league.status !== "playoffs") return "results can change only during the season or playoffs";
      const match = (await loadMatches(tx, league.id)).find((candidate) => candidate.id === action.matchId);
      if (!match) return "no match in this league has that id";
      if (match.b === null) return "byes cannot be changed";
      if (match.stage !== "season") {
        const later = playoffStages(8).slice(playoffStages(8).indexOf(match.stage) + 1);
        const { rows } = await tx.query(
          "SELECT 1 FROM league_matches WHERE league_id = $1 AND stage = ANY($2) LIMIT 1",
          [league.id, later],
        );
        if (rows.length) return "a later playoff round is already paired";
      }
      const update = action.outcome === "void"
        ? { status: "cancelled", result: null, winner: null }
        : action.outcome === "draw"
          ? { status: "complete", result: "draw", winner: null }
          : action.outcome === "double-forfeit"
            ? { status: "complete", result: "double-forfeit", winner: null }
            : { status: "complete", result: "operator", winner: action.outcome === "a" ? match.a : match.b };
      await tx.query(
        "UPDATE league_matches SET status = $2, result = $3, winner = $4 WHERE id = $1",
        [match.id, update.status, update.result, update.winner],
      );
      return null;
    }
    case "extend-deadline": {
      const { rows } = await tx.query(
        "SELECT status FROM league_matches WHERE id = $1 AND league_id = $2",
        [action.matchId, league.id],
      );
      if (!rows[0]) return "no match in this league has that id";
      if (rows[0].status === "complete" || rows[0].status === "cancelled") return "the match is already finished";
      if (action.deadlineAt <= now) return "the new deadline must be in the future";
      await tx.query("UPDATE league_matches SET deadline_at = $2 WHERE id = $1", [action.matchId, action.deadlineAt]);
      return null;
    }
  }
}

/** Applies queued actions oldest first, each in its own transaction so one
 * failure cannot block the queue. Returns how many were processed. */
export async function applyLeagueActions(db: Queryable, leagueId: string, now = Date.now()): Promise<number> {
  let processed = 0;
  for (;;) {
    let actionId: string | null = null;
    try {
      const applied = await withTransaction(db, async (tx) => {
        const league = await lockLeague(tx, leagueId);
        if (!league) return false;
        const { rows } = await tx.query(
          "SELECT id, action FROM league_actions WHERE league_id = $1 AND applied_at IS NULL ORDER BY id LIMIT 1",
          [leagueId],
        );
        const row = rows[0];
        if (!row) return false;
        actionId = String(row.id);
        const action = decodeLeagueAction(typeof row.action === "string" ? JSON.parse(row.action) as unknown : row.action);
        const error = action ? await applyAction(tx, league, action, now) : "unrecognized action";
        await tx.query("UPDATE league_actions SET applied_at = $2, error = $3 WHERE id = $1", [actionId, now, error]);
        return true;
      });
      if (!applied) return processed;
    } catch (error) {
      if (actionId === null) throw error;
      consoleError(`league action ${actionId} failed`, error);
      await db.query("UPDATE league_actions SET applied_at = $2, error = 'internal error' WHERE id = $1", [actionId, now]);
    }
    processed++;
  }
}

/** The worker tick: queued actions first, so a start or result takes
 * effect in the same tick, then scheduled work. One league's failure is
 * logged and does not stop the others. */
export async function tickLeagues(db: Queryable, now = Date.now()): Promise<void> {
  const { rows } = await db.query(
    `SELECT id FROM leagues WHERE status IN ('signup', 'season', 'playoffs')
     UNION SELECT league_id AS id FROM league_actions WHERE applied_at IS NULL`,
  );
  for (const row of rows) {
    const leagueId = String(row.id);
    try {
      await applyLeagueActions(db, leagueId, now);
      await advanceLeague(db, leagueId, now);
    } catch (error) {
      consoleError(`league ${leagueId} tick failed`, error);
    }
  }
}
