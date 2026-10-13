import { useEffect, useMemo } from "react";
import type { MatchRecords } from "@fyendal/protocol";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { HeroPortrait, heroShortName } from "./HeroPortrait.js";
import { HoverHint } from "./HoverHint.js";
import { MatchList } from "./MatchList.js";
import { RetentionNote } from "./MatchesView.js";
import { formatWinRate, StatStrip, useRecordStats } from "./StatStrip.js";
import { recentForm, summarizeRecords } from "./summarizeRecords.js";

const RECENT_COUNT = 5;
const HERO_GRID_COUNT = 8;

/** Lifetime numbers, the heroes you play, and the last few games. */
export function OverviewView({
  records,
  onShowMatches,
  onShowHero,
}: {
  records: MatchRecords;
  onShowMatches: () => void;
  onShowHero: (heroId: string) => void;
}) {
  const intl = useIntl();
  const { list, loadMatches } = useStore(useShallow((state) => ({
    list: state.matchList,
    loadMatches: state.loadMatches,
  })));
  const listMatches = !list.filters.format && !list.filters.heroId;
  useEffect(() => {
    void loadMatches({});
  }, [loadMatches]);

  const summary = useMemo(() => summarizeRecords(records), [records]);
  const recent = useMemo(
    () => (listMatches && list.loaded ? recentForm(list.matches, list.nextCursor !== null) : null),
    [listMatches, list.loaded, list.matches, list.nextCursor],
  );
  const stats = useRecordStats(summary, recent);
  const heroes = summary.heroes.slice(0, HERO_GRID_COUNT);
  const matches = listMatches ? list.matches.slice(0, RECENT_COUNT) : [];

  return (
    <div className="history-overview">
      <StatStrip stats={stats} />
      <section className="history-section" aria-labelledby="history-overview-heroes">
        <h3 id="history-overview-heroes">{intl.formatMessage({ id: "history.tab.heroes" })}</h3>
        <ul className="hero-grid">
          {heroes.map((hero) => {
            const formatted = formatWinRate(intl, hero.players);
            return (
              <li key={hero.heroId}>
                <button type="button" className="hero-tile" onClick={() => onShowHero(hero.heroId)}>
                  <HeroPortrait heroId={hero.heroId} size="lg" />
                  <span className="hero-tile-name">{heroShortName(hero.heroId)}</span>
                  <HoverHint
                    hint={intl.formatMessage({ id: "history.stat.winRatePlayers" }, { rate: formatted })}
                    className="hero-tile-rate"
                  >
                    {formatted}
                  </HoverHint>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="history-section" aria-labelledby="history-overview-recent">
        <div className="history-section-heading">
          <h3 id="history-overview-recent">{intl.formatMessage({ id: "history.overview.recent" })}</h3>
          <button type="button" className="history-link" onClick={onShowMatches}>
            {intl.formatMessage({ id: "history.overview.seeAll" })}
          </button>
        </div>
        <RetentionNote />
        <MatchList
          matches={matches}
          loading={list.loading && matches.length === 0}
          loaded={listMatches && list.loaded}
          error={list.error}
          hasMore={false}
          emptyMessageId="history.matches.empty"
          onRetry={() => void loadMatches({})}
        />
      </section>
    </div>
  );
}
