import { useMemo } from "react";
import type { MatchListFilters, MatchRecords } from "@fyendal/protocol";
import { useIntl } from "react-intl";
import { HeroPortrait, heroName } from "./HeroPortrait.js";
import { HoverHint } from "./HoverHint.js";
import { FormatFilters } from "./MatchesView.js";
import { formatWinRate, StatStrip, useRecordStats } from "./StatStrip.js";
import { summarizeRecords, winRate } from "./summarizeRecords.js";

/** Hero list on the left, the selected hero's record and matchups on the right. */
export function HeroesView({
  records,
  filters,
  onFiltersChange,
  selectedHeroId,
  onSelectHero,
}: {
  records: MatchRecords;
  filters: MatchListFilters;
  onFiltersChange: (filters: MatchListFilters) => void;
  selectedHeroId: string | null;
  onSelectHero: (heroId: string) => void;
}) {
  const intl = useIntl();
  const summary = useMemo(() => summarizeRecords(records, { format: filters.format }), [records, filters.format]);
  const selected = summary.heroes.find((hero) => hero.heroId === selectedHeroId) ?? summary.heroes[0] ?? null;
  const stats = useRecordStats(selected ?? summary, null);

  return (
    <div className="history-heroes-view">
      <FormatFilters filters={filters} onChange={onFiltersChange} />
      {summary.heroes.length === 0 ? (
        <p className="history-empty">{intl.formatMessage({ id: "history.matches.emptyFiltered" })}</p>
      ) : (
        <div className="heroes-split">
          <ul className="hero-list" role="list">
            {summary.heroes.map((hero) => (
              <li key={hero.heroId}>
                <button
                  type="button"
                  className={`hero-list-item${selected?.heroId === hero.heroId ? " selected" : ""}`}
                  aria-pressed={selected?.heroId === hero.heroId}
                  onClick={() => onSelectHero(hero.heroId)}
                >
                  <HeroPortrait heroId={hero.heroId} size="md" />
                  <span className="hero-list-copy">
                    <span className="hero-list-name">{heroName(hero.heroId)}</span>
                    <span className="hero-list-games">
                      {intl.formatMessage({ id: "history.heroes.games" }, { count: hero.games })}
                    </span>
                  </span>
                  <HoverHint
                    hint={intl.formatMessage({ id: "history.stat.winRatePlayers" }, { rate: formatWinRate(intl, hero.players) })}
                    className="hero-list-rate"
                  >
                    {formatWinRate(intl, hero.players)}
                  </HoverHint>
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <section className="hero-detail" aria-live="polite">
              <header className="hero-detail-header">
                <HeroPortrait heroId={selected.heroId} size="lg" />
                <div>
                  <h3>{heroName(selected.heroId)}</h3>
                  <p className="muted">
                    {intl.formatMessage(
                      { id: "history.heroes.lastPlayed" },
                      { date: intl.formatDate(selected.lastPlayedAt, { dateStyle: "medium" }) },
                    )}
                  </p>
                </div>
              </header>
              <StatStrip stats={stats} />
              <h4>{intl.formatMessage({ id: "history.heroes.matchups" })}</h4>
              {selected.matchups.length === 0 ? (
                <p className="muted">{intl.formatMessage({ id: "history.heroes.noMatchups" })}</p>
              ) : (
                <ul className="matchup-list">
                  {selected.matchups.map((matchup) => {
                    const rate = winRate(matchup);
                    return (
                      <li className="matchup-row" key={matchup.opponentHeroId}>
                        <HeroPortrait heroId={matchup.opponentHeroId} size="sm" />
                        <span className="matchup-name">{heroName(matchup.opponentHeroId)}</span>
                        <span className="matchup-score">
                          {intl.formatMessage({ id: "history.record.score" }, { wins: matchup.wins, losses: matchup.losses })}
                        </span>
                        <span className="matchup-rate">{formatWinRate(intl, matchup)}</span>
                        <span className="rate-track" aria-hidden="true">
                          {rate === null ? null : <span style={{ width: `${rate * 100}%` }} />}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
