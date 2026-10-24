import type { LeagueMatchView, LeagueMembership } from "@fyendal/shared";

// Mirrors the server's check-in window around an agreed start.
export const READY_OPENS_MS = 5 * 60_000;
export const READY_CLOSES_MS = 15 * 60_000;

export function inReadyWindow(match: LeagueMatchView, now: number): boolean {
  return match.status === "scheduled" && match.scheduledAt !== null
    && now >= match.scheduledAt - READY_OPENS_MS && now <= match.scheduledAt + READY_CLOSES_MS;
}

/** An agreed or proposed time whose check-in window closed without a game;
 * the server no longer accepts it, so a new time must be proposed. */
export function missedTime(match: LeagueMatchView, now: number): boolean {
  return (match.status === "scheduled" || match.status === "proposed") && match.scheduledAt !== null
    && now > match.scheduledAt + READY_CLOSES_MS;
}

export function canClaimForfeit(match: LeagueMatchView, now: number): boolean {
  return match.status === "scheduled" && match.scheduledAt !== null
    && now > match.scheduledAt + READY_CLOSES_MS && match.youReady && !match.opponentReady;
}

/** A match waits on you when a time needs your answer, check-in is open and
 * you have not checked in, or a forfeit win is yours to claim. */
export function waitsOnYou(match: LeagueMatchView, now: number): boolean {
  return (match.status === "proposed" && match.proposedBy !== "you")
    || (inReadyWindow(match, now) && !match.youReady)
    || canClaimForfeit(match, now);
}

export function leagueActionCount(leagues: readonly LeagueMembership[] | null, now: number): number {
  return (leagues ?? []).reduce((total, league) =>
    total + league.matches.filter((match) => waitsOnYou(match, now)).length, 0);
}
