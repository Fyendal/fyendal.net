import type { MatchListFilters, MatchRecords, MatchSummary } from "@fyendal/protocol";

export interface RecordTotals {
  /** Completed games: wins, losses and draws. Games ended early without a
   * result are listed in history but never counted. */
  games: number;
  wins: number;
  losses: number;
  draws: number;
  ended: number;
}

export interface MatchupSummary {
  opponentHeroId: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface HeroSummary extends RecordTotals {
  heroId: string;
  lastPlayedAt: number;
  players: RecordTotals;
  bots: RecordTotals;
  matchups: MatchupSummary[];
}

/** Format and hero narrow the numbers; opponent kind never does, because the
 * win-rate tile shows players, everyone and bots side by side instead. */
export type RecordFilters = Pick<MatchListFilters, "format" | "heroId">;

export interface RecordSummary extends RecordTotals {
  players: RecordTotals;
  bots: RecordTotals;
  heroes: HeroSummary[];
}

export type MatchOutcome = "win" | "loss" | "draw" | "ended";

export const FORM_LENGTH = 10;

function emptyTotals(): RecordTotals {
  return { games: 0, wins: 0, losses: 0, draws: 0, ended: 0 };
}

function add(target: RecordTotals, row: RecordTotals): void {
  target.games += row.wins + row.losses + row.draws;
  target.wins += row.wins;
  target.losses += row.losses;
  target.draws += row.draws;
  target.ended += row.ended;
}

/** Share of decided games won, or null before any game is decided. Draws
 * and games ended early are counted but never change the rate. */
export function winRate(totals: { wins: number; losses: number }): number | null {
  const decided = totals.wins + totals.losses;
  return decided === 0 ? null : totals.wins / decided;
}

/** Sum the server's counter rows for one filter combination. Pure, so a
 * filter change never needs another request. */
export function summarizeRecords(records: MatchRecords, filters: RecordFilters = {}): RecordSummary {
  const summary: RecordSummary = { ...emptyTotals(), players: emptyTotals(), bots: emptyTotals(), heroes: [] };
  const heroes = new Map<string, HeroSummary>();
  for (const row of records.heroes) {
    if (filters.format && row.format !== filters.format) continue;
    if (filters.heroId && row.heroId !== filters.heroId) continue;
    add(row.opponentKind === "player" ? summary.players : summary.bots, row);
    add(summary, row);
    let hero = heroes.get(row.heroId);
    if (!hero) {
      hero = {
        ...emptyTotals(), heroId: row.heroId, lastPlayedAt: 0,
        players: emptyTotals(), bots: emptyTotals(), matchups: [],
      };
      heroes.set(row.heroId, hero);
    }
    add(hero, row);
    add(row.opponentKind === "player" ? hero.players : hero.bots, row);
    hero.lastPlayedAt = Math.max(hero.lastPlayedAt, row.lastPlayedAt);
  }
  for (const row of records.matchups) {
    if (filters.format && row.format !== filters.format) continue;
    const hero = heroes.get(row.heroId);
    if (!hero) continue;
    let matchup = hero.matchups.find((item) => item.opponentHeroId === row.opponentHeroId);
    if (!matchup) {
      matchup = { opponentHeroId: row.opponentHeroId, games: 0, wins: 0, losses: 0, draws: 0 };
      hero.matchups.push(matchup);
    }
    matchup.games += row.games;
    matchup.wins += row.wins;
    matchup.losses += row.losses;
    matchup.draws += row.draws;
  }
  summary.heroes = [...heroes.values()]
    .filter((hero) => hero.games > 0)
    .sort((a, b) => b.games - a.games || b.lastPlayedAt - a.lastPlayedAt || a.heroId.localeCompare(b.heroId));
  for (const hero of summary.heroes) {
    hero.matchups.sort((a, b) => b.games - a.games || a.opponentHeroId.localeCompare(b.opponentHeroId));
  }
  return summary;
}

/** Every hero with a completed game, most played first, for the hero filter. */
export function playedHeroes(records: MatchRecords): string[] {
  const games = new Map<string, number>();
  for (const row of records.heroes) {
    games.set(row.heroId, (games.get(row.heroId) ?? 0) + row.wins + row.losses + row.draws);
  }
  return [...games.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([heroId]) => heroId);
}

export function matchOutcome(match: Pick<MatchSummary, "winner" | "yourSeat" | "endReason">): MatchOutcome {
  if (match.winner === match.yourSeat) return "win";
  if (match.winner !== null) return "loss";
  return match.endReason === "draw" ? "draw" : "ended";
}

export interface RecentForm {
  /** Newest first, at most FORM_LENGTH entries. */
  form: MatchOutcome[];
  /** Consecutive wins or losses from the newest decided game. Draws and
   * ended games are skipped. `capped` means the streak ran past the loaded
   * page, so it is at least this long. */
  streak: { kind: "win" | "loss"; length: number; capped: boolean } | null;
}

/** Form and streak come from the loaded list rather than stored counters:
 * the first page is already fetched and answers both for any filter. */
export function recentForm(matches: readonly MatchSummary[], hasMore: boolean): RecentForm {
  const outcomes = matches.map(matchOutcome);
  const form = outcomes.slice(0, FORM_LENGTH);
  let streak: RecentForm["streak"] = null;
  let broken = false;
  for (const outcome of outcomes) {
    if (outcome === "draw" || outcome === "ended") continue;
    if (!streak) {
      streak = { kind: outcome, length: 1, capped: false };
    } else if (streak.kind === outcome) {
      streak.length += 1;
    } else {
      broken = true;
      break;
    }
  }
  if (streak && !broken && hasMore) streak.capped = true;
  return { form, streak };
}
