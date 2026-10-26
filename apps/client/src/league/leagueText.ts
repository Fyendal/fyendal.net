import type { IntlShape } from "react-intl";
import type { LeagueErrorCode } from "@fyendal/protocol";
import type { Format } from "@fyendal/shared";

export function leagueSummary(
  intl: IntlShape,
  league: { format: Format; seasonWeeks: number; matchesPerWeek: number },
): string {
  return intl.formatMessage({ id: "league.summary" }, {
    format: intl.formatMessage({ id: league.format === "cc" ? "format.classicConstructed" : "format.silverAge" }),
    weeks: league.seasonWeeks,
    matches: league.matchesPerWeek,
  });
}

export function leagueStart(intl: IntlShape, startsAt: number): string {
  return intl.formatMessage({ id: "league.starts" }, {
    date: intl.formatDate(startsAt, { dateStyle: "medium", timeStyle: "short" }),
  });
}

const ERROR_MESSAGES: Record<LeagueErrorCode, string> = {
  LEAGUE_NOT_FOUND: "league.error.notFound",
  LEAGUE_FULL: "league.error.full",
  LEAGUE_CLOSED: "league.error.closed",
};

/** Copy for a failed league request; a rejection without a league code is a generic failure. */
export function leagueErrorMessage(intl: IntlShape, result: { ok: false } | { ok: false; code: LeagueErrorCode }, fallback: string): string {
  return intl.formatMessage({ id: "code" in result ? ERROR_MESSAGES[result.code] : fallback });
}
