import type { LeagueMatchResult } from "@fyendal/shared";
import { seededFraction } from "./pairing.js";

export const WIN_POINTS = 3;
export const DRAW_POINTS = 1;
/** Opponents' match-win rates are floored here before averaging. */
export const MATCH_WIN_FLOOR = 1 / 3;

export interface StandingMember {
  memberId: number;
  dropped: boolean;
}

/** A completed season match. */
export interface StandingMatch {
  a: number;
  b: number | null;
  result: LeagueMatchResult;
  winner: number | null;
}

export interface StandingRow {
  memberId: number;
  rank: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  forfeitLosses: number;
  /** Byes included. */
  matches: number;
  matchWinRate: number;
  opponentMatchWinRate: number;
  dropped: boolean;
}

type Tally = Omit<StandingRow, "rank" | "matchWinRate" | "opponentMatchWinRate"> & { opponents: number[] };

function decisive(match: StandingMatch): { winner: number; loser: number } | null {
  if (match.winner === null || match.b === null) return null;
  if (match.winner !== match.a && match.winner !== match.b) throw new Error("league match winner is not a participant");
  return { winner: match.winner, loser: match.winner === match.a ? match.b : match.a };
}

/** Ordered by points, opponents' match-win rate, head-to-head between exactly
 * two tied members, fewer forfeit losses, then a seeded draw. */
export function computeStandings(
  members: readonly StandingMember[],
  matches: readonly StandingMatch[],
  seed: string,
): StandingRow[] {
  const tallies = new Map<number, Tally>(members.map((member) => [member.memberId, {
    memberId: member.memberId, points: 0, wins: 0, losses: 0, draws: 0, byes: 0,
    forfeitLosses: 0, matches: 0, dropped: member.dropped, opponents: [],
  }]));
  const tally = (memberId: number) => {
    const row = tallies.get(memberId);
    if (!row) throw new Error(`league match references unknown member ${memberId}`);
    return row;
  };
  for (const match of matches) {
    const a = tally(match.a);
    if (match.result === "bye") {
      if (match.b !== null) throw new Error("league bye has an opponent");
      a.byes++;
      continue;
    }
    if (match.b === null) throw new Error("league match is missing an opponent");
    const b = tally(match.b);
    a.opponents.push(b.memberId);
    b.opponents.push(a.memberId);
    if (match.result === "draw") {
      a.draws++;
      b.draws++;
    } else if (match.result === "double-forfeit") {
      for (const row of [a, b]) {
        row.losses++;
        row.forfeitLosses++;
      }
    } else {
      const outcome = decisive(match);
      if (!outcome) throw new Error(`league ${match.result} match has no winner`);
      tally(outcome.winner).wins++;
      const loser = tally(outcome.loser);
      loser.losses++;
      if (match.result === "forfeit") loser.forfeitLosses++;
    }
  }
  const rates = new Map<number, number>();
  for (const row of tallies.values()) {
    row.matches = row.wins + row.losses + row.draws + row.byes;
    row.points = WIN_POINTS * (row.wins + row.byes) + DRAW_POINTS * row.draws;
    rates.set(row.memberId, row.matches ? row.points / (WIN_POINTS * row.matches) : 0);
  }
  const rows = [...tallies.values()].map(({ opponents, ...row }) => ({
    ...row,
    rank: 0,
    matchWinRate: rates.get(row.memberId)!,
    opponentMatchWinRate: opponents.length
      ? opponents.reduce((sum, id) => sum + Math.max(MATCH_WIN_FLOOR, rates.get(id)!), 0) / opponents.length
      : 0,
  }));
  const omw = (row: StandingRow) => Math.round(row.opponentMatchWinRate * 1e9);
  const tied = (x: StandingRow, y: StandingRow) => x.points === y.points && omw(x) === omw(y);
  rows.sort((x, y) => y.points - x.points || omw(y) - omw(x)
    || x.forfeitLosses - y.forfeitLosses
    || seededFraction(seed, `standing:${x.memberId}`) - seededFraction(seed, `standing:${y.memberId}`)
    || x.memberId - y.memberId);
  for (let start = 0; start < rows.length; ) {
    let end = start + 1;
    while (end < rows.length && tied(rows[start]!, rows[end]!)) end++;
    if (end - start === 2) {
      const [first, second] = [rows[start]!, rows[start + 1]!];
      const edge = headToHead(matches, second.memberId, first.memberId);
      if (edge > 0) [rows[start], rows[start + 1]] = [second, first];
    }
    start = end;
  }
  rows.forEach((row, index) => { row.rank = index + 1; });
  return rows;
}

/** Positive when `x` won more of their decisive meetings with `y`. */
function headToHead(matches: readonly StandingMatch[], x: number, y: number): number {
  let edge = 0;
  for (const match of matches) {
    if (!((match.a === x && match.b === y) || (match.a === y && match.b === x))) continue;
    const outcome = decisive(match);
    if (outcome) edge += outcome.winner === x ? 1 : -1;
  }
  return edge;
}
