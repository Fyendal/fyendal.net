import type { Format } from "./types.js";

export type LeagueStatus = "signup" | "season" | "playoffs" | "complete" | "cancelled";
export type LeaguePlayoffStage = "quarterfinal" | "semifinal" | "final";
export type LeagueStage = "season" | LeaguePlayoffStage;
export type LeagueMatchStatus = "unscheduled" | "proposed" | "scheduled" | "in-room" | "complete" | "cancelled";
export type LeagueMatchResult = "played" | "draw" | "forfeit" | "double-forfeit" | "bye" | "operator";

/** A recurring weekly window in the member's own time zone. `weekday` follows
 * `Date#getDay` (0 = Sunday); minutes count from local midnight, `end` exclusive. */
export interface LeagueAvailabilityWindow {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start: number;
  end: number;
}

/** Why the worker paired two members, shown on the dashboard. */
export interface LeaguePairingNote {
  overlapMinutes: number;
  /** Absolute difference in points per game, 0..3. */
  scoreGap: number;
  /** Earlier season meetings between the pair. */
  rematches: number;
  cost: number;
}

/** Operator command queued by the dashboard and applied by the gateway worker. */
export type LeagueAction =
  | { kind: "close-signup" }
  | { kind: "start" }
  | { kind: "cancel" }
  | { kind: "drop"; memberId: number }
  | { kind: "set-result"; matchId: string; outcome: "a" | "b" | "draw" | "double-forfeit" | "void" }
  | { kind: "extend-deadline"; matchId: string; deadlineAt: number };

export interface LeagueJoinRequest {
  token: string;
  timeZone: string;
  availability: LeagueAvailabilityWindow[];
}

/** Replaces the template, or one upcoming week when `week` is present. */
export interface LeagueAvailabilityRequest {
  leagueId: string;
  timeZone: string;
  availability: LeagueAvailabilityWindow[];
  week?: number;
}

/** What a sign-up link shows before joining. */
export interface LeagueJoinPreview {
  name: string;
  format: Format;
  status: LeagueStatus;
  startsAt: number | null;
  members: number;
  maxPlayers: number;
  matchesPerWeek: number;
  seasonWeeks: number;
  joined: boolean;
}

/** Half-open UTC interval in epoch milliseconds. */
export interface LeagueTimeRange {
  start: number;
  end: number;
}

/** One of the signed-in member's league matches. */
export interface LeagueMatchView {
  id: string;
  stage: LeagueStage;
  week: number | null;
  /** Null for a bye. */
  opponent: { username: string | null; timeZone: string } | null;
  status: LeagueMatchStatus;
  /** The proposed or agreed start. */
  scheduledAt: number | null;
  /** Who proposed `scheduledAt`: you, your opponent, or the league's suggestion. */
  proposedBy: "you" | "opponent" | "league" | null;
  deadlineAt: number;
  youReady: boolean;
  opponentReady: boolean;
  roomCode: string | null;
  result: LeagueMatchResult | null;
  /** Null while unresolved or after a draw. */
  won: boolean | null;
  /** Shared free time long enough for a match, before the deadline. */
  overlap: LeagueTimeRange[];
}

export interface LeagueMatchRequest {
  matchId: string;
}

export interface LeagueProposeRequest extends LeagueMatchRequest {
  at: number;
}

/** A league the signed-in account belongs to, with its own settings. */
export interface LeagueMembership {
  id: string;
  name: string;
  format: Format;
  status: LeagueStatus;
  startsAt: number | null;
  seasonWeeks: number;
  matchesPerWeek: number;
  matchMinutes: number;
  maxPlayers: number;
  signupOpen: boolean;
  /** Active members in join order; null for a deleted account. */
  roster: Array<{ username: string | null; you: boolean }>;
  timeZone: string;
  availability: LeagueAvailabilityWindow[];
  /** The current week's or round's matches, plus any still open. */
  matches: LeagueMatchView[];
}
