import type { LeagueMatchStatus } from "@fyendal/shared";

export interface OverdueMatch {
  status: LeagueMatchStatus;
  a: number;
  b: number;
  readyA: boolean;
  readyB: boolean;
  /** Null for a system-suggested time. */
  proposedBy: number | null;
}

export type OverdueOutcome =
  | { result: "forfeit"; winner: number }
  | { result: "double-forfeit"; winner: null };

/** How an unplayed match resolves at its deadline: a lone ready claim wins,
 * then a player whose proposal went unanswered, otherwise both lose. */
export function resolveOverdue(match: OverdueMatch): OverdueOutcome {
  if (match.readyA !== match.readyB) return { result: "forfeit", winner: match.readyA ? match.a : match.b };
  if (match.status === "proposed" && (match.proposedBy === match.a || match.proposedBy === match.b)) {
    return { result: "forfeit", winner: match.proposedBy };
  }
  return { result: "double-forfeit", winner: null };
}
