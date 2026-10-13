import { useEffect, useState } from "react";
import type { MatchListFilters } from "@fyendal/protocol";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { HeroesView } from "./HeroesView.js";
import { MatchesView, OpenReplayFile } from "./MatchesView.js";
import { OverviewView } from "./OverviewView.js";
import "../styles/match-history.css";

type HistoryTab = "overview" | "matches" | "heroes";
const TABS: readonly HistoryTab[] = ["overview", "matches", "heroes"];

export function MatchHistory() {
  const intl = useIntl();
  const { records, recordsLoading, recordsError, refreshMatchRecords } = useStore(
    useShallow((state) => ({
      records: state.matchRecords,
      recordsLoading: state.matchRecordsLoading,
      recordsError: state.matchRecordsError,
      refreshMatchRecords: state.refreshMatchRecords,
    })),
  );
  const [tab, setTab] = useState<HistoryTab>("overview");
  const [filters, setFilters] = useState<MatchListFilters>({});
  const [selectedHeroId, setSelectedHeroId] = useState<string | null>(null);

  useEffect(() => {
    if (!records && !recordsLoading) void refreshMatchRecords();
  }, [records, recordsLoading, refreshMatchRecords]);

  const hasHistory = records !== null && records.heroes.length > 0;

  return (
    <div className="panel match-history">
      <header className="history-header">
        <h2 className="panel-title">{intl.formatMessage({ id: "history.title" })}</h2>
      </header>

      {hasHistory ? (
        <div className="lobby-panel-tabs history-tabs" role="tablist" aria-label={intl.formatMessage({ id: "history.title" })}>
          {TABS.map((option) => (
            <button
              key={option}
              id={`history-tab-${option}`}
              type="button"
              role="tab"
              aria-selected={tab === option}
              aria-controls="history-tab-panel"
              className={tab === option ? "selected" : ""}
              onClick={() => setTab(option)}
            >
              {intl.formatMessage({ id: `history.tab.${option}` })}
            </button>
          ))}
        </div>
      ) : null}

      <div id="history-tab-panel" role={hasHistory ? "tabpanel" : undefined} aria-labelledby={hasHistory ? `history-tab-${tab}` : undefined}>
        {recordsError ? (
          <div role="alert" className="history-error">
            {intl.formatMessage({ id: "history.matches.recordsError" })}{" "}
            <button type="button" onClick={() => void refreshMatchRecords()}>
              {intl.formatMessage({ id: "history.matches.retry" })}
            </button>
          </div>
        ) : null}
        {!records && !recordsError ? (
          <p role="status" className="muted">{intl.formatMessage({ id: "common.loading" })}</p>
        ) : null}
        {records && !hasHistory ? (
          <div className="history-empty">
            <p>{intl.formatMessage({ id: "history.matches.empty" })}</p>
            <OpenReplayFile />
          </div>
        ) : null}
        {records && hasHistory && tab === "overview" ? (
          <OverviewView
            records={records}
            onShowMatches={() => setTab("matches")}
            onShowHero={(heroId) => { setSelectedHeroId(heroId); setTab("heroes"); }}
          />
        ) : null}
        {records && hasHistory && tab === "matches" ? (
          <MatchesView records={records} filters={filters} onFiltersChange={setFilters} />
        ) : null}
        {records && hasHistory && tab === "heroes" ? (
          <HeroesView
            records={records}
            filters={filters}
            onFiltersChange={setFilters}
            selectedHeroId={selectedHeroId}
            onSelectHero={setSelectedHeroId}
          />
        ) : null}
      </div>
    </div>
  );
}
