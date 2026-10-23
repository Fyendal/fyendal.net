import type { LeagueBracketPlayer, LeagueBracketView, LeagueStandingView } from "@fyendal/shared";
import type { Queryable } from "../db.js";
import { playoffAdvancer, type PlayoffMatch } from "./bracket.js";
import { matchResult, matchStage, matchStatus, nullableNumber } from "./leagueRows.js";
import { computeStandings } from "./standings.js";

/** The season table and, once seeded, the bracket, as one member sees them. */
export async function leagueTables(
  db: Queryable,
  league: { id: string; seed: string },
  memberId: number,
): Promise<{ standings: LeagueStandingView[]; bracket: LeagueBracketView[] }> {
  const [{ rows: members }, { rows: matches }] = await Promise.all([
    db.query("SELECT member_id, username, status, playoff_seed FROM league_members WHERE league_id = $1", [league.id]),
    db.query(
      `SELECT stage, bracket_slot, member_a, member_b, status, result, winner FROM league_matches
       WHERE league_id = $1 ORDER BY created_at, id`,
      [league.id],
    ),
  ]);
  const byId = new Map(members.map((row) => [Number(row.member_id), row]));
  const decoded = matches.map((row) => ({
    stage: matchStage(row.stage),
    slot: nullableNumber(row.bracket_slot),
    a: Number(row.member_a),
    b: nullableNumber(row.member_b),
    status: matchStatus(row.status),
    result: row.result === null ? null : matchResult(row.result),
    winner: nullableNumber(row.winner),
  }));
  const username = (id: number) => {
    const name = byId.get(id)?.username;
    return name === null || name === undefined ? null : String(name);
  };
  const standings = computeStandings(
    members.map((row) => ({ memberId: Number(row.member_id), dropped: row.status === "dropped" })),
    decoded.flatMap((match) => match.stage === "season" && match.status === "complete" && match.result !== null
      ? [{ a: match.a, b: match.b, result: match.result, winner: match.winner }]
      : []),
    league.seed,
  ).map((row) => ({
    rank: row.rank,
    username: username(row.memberId),
    you: row.memberId === memberId,
    points: row.points,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    byes: row.byes,
    opponentMatchWinRate: row.opponentMatchWinRate,
    dropped: row.dropped,
    playoffSeed: nullableNumber(byId.get(row.memberId)?.playoff_seed),
  }));

  // Replays share a position; the latest match there is the one to show.
  const positions = new Map<string, PlayoffMatch>();
  for (const match of decoded) {
    if (match.stage === "season" || match.b === null || match.slot === null) continue;
    positions.set(`${match.stage}:${match.slot}`, { ...match, stage: match.stage, slot: match.slot, b: match.b });
  }
  const player = (id: number): LeagueBracketPlayer => ({
    username: username(id),
    seed: nullableNumber(byId.get(id)?.playoff_seed) ?? 0,
    you: id === memberId,
  });
  const bracket = [...positions.values()].map((match) => {
    const advancer = playoffAdvancer(match);
    return {
      stage: match.stage,
      slot: match.slot,
      a: player(match.a),
      b: player(match.b),
      status: match.status,
      result: match.result,
      advancer: advancer === null ? null : advancer === match.a ? "a" as const : "b" as const,
    };
  });
  return { standings, bracket };
}
