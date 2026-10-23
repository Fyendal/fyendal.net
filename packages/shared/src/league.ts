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
  timeZone: string;
  availability: LeagueAvailabilityWindow[];
}

/** Replaces the template, or one upcoming week when `week` is present. */
export interface LeagueAvailabilityRequest extends LeagueJoinRequest {
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
