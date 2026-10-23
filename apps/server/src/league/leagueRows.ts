import type {
  Format,
  LeagueAvailabilityWindow,
  LeagueMatchResult,
  LeagueMatchStatus,
  LeagueStage,
  LeagueStatus,
} from "@fyendal/shared";
import { decodeLeagueAvailability } from "@fyendal/protocol";

/** Decoders for league rows; the schema's CHECK constraints are the source of these values. */
export function storedWindows(value: unknown, label: string): LeagueAvailabilityWindow[] {
  const decoded = decodeLeagueAvailability(typeof value === "string" ? JSON.parse(value) as unknown : value);
  if (!decoded) throw new Error(`${label} is corrupt`);
  return decoded;
}

export function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function oneOf<T extends string>(values: readonly T[], label: string): (value: unknown) => T {
  return (value) => {
    if (values.includes(value as T)) return value as T;
    throw new Error(`${label} is corrupt`);
  };
}

export const format = oneOf<Format>(["cc", "silver-age"], "league format");
export const leagueStatus = oneOf<LeagueStatus>(["signup", "season", "playoffs", "complete", "cancelled"], "league status");
export const matchStage = oneOf<LeagueStage>(["season", "quarterfinal", "semifinal", "final"], "league match stage");
export const matchStatus = oneOf<LeagueMatchStatus>(
  ["unscheduled", "proposed", "scheduled", "in-room", "complete", "cancelled"],
  "league match status",
);
export const matchResult = oneOf<LeagueMatchResult>(
  ["played", "draw", "forfeit", "double-forfeit", "bye", "operator"],
  "league match result",
);
