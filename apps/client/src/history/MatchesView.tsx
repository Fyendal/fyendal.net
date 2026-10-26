import { useEffect, useMemo, useRef, useState } from "react";
import { MATCH_OPPONENT_FILTERS, type MatchListFilters, type MatchRecords } from "@fyendal/protocol";
import type { Format } from "@fyendal/shared";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { formatSelectLabel } from "../lobby/FormatBadge.js";
import { useStore } from "../store.js";
import { heroName } from "./HeroPortrait.js";
import { MatchList } from "./MatchList.js";
import { playedHeroes } from "./summarizeRecords.js";

const FORMAT_OPTIONS: readonly Format[] = ["cc", "silver-age"];
type OpponentFilter = (typeof MATCH_OPPONENT_FILTERS)[number];

function isOpponentFilter(value: string): value is OpponentFilter {
  return (MATCH_OPPONENT_FILTERS as readonly string[]).includes(value);
}

/** Watch a replay JSON file from disk. A replay action, so it lives with
 * the match list rather than in the page header. */
export function OpenReplayFile() {
  const intl = useIntl();
  const openReplayText = useStore((state) => state.openReplayText);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="history-open-file">
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void file.text().then((text) => setError(openReplayText(text)));
        }}
      />
      <button type="button" className="history-link" onClick={() => fileInput.current?.click()}>
        {intl.formatMessage({ id: "history.matches.openFile" })}
      </button>
      {error ? <span className="error" role="alert">{error}</span> : null}
    </span>
  );
}

/** The one place the retention rule is stated; rows only warn when a replay is about to go. */
export function RetentionNote() {
  const intl = useIntl();
  return <p className="history-note">{intl.formatMessage({ id: "history.matches.retention" })}</p>;
}

/** Format dropdown shared by the Matches and Heroes tabs. */
export function FormatFilters({
  filters,
  onChange,
  children,
}: {
  filters: MatchListFilters;
  onChange: (filters: MatchListFilters) => void;
  children?: React.ReactNode;
}) {
  const intl = useIntl();
  return (
    <div className="history-filters">
      <select
        aria-label={intl.formatMessage({ id: "history.filter.format" })}
        value={filters.format ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          const { format: _format, ...rest } = filters;
          onChange(value === "cc" || value === "silver-age" ? { ...rest, format: value } : rest);
        }}
      >
        <option value="">{intl.formatMessage({ id: "history.filter.anyFormat" })}</option>
        {FORMAT_OPTIONS.map((format) => (
          <option key={format} value={format}>{formatSelectLabel(intl, format)}</option>
        ))}
      </select>
      {children}
    </div>
  );
}

/** Filtered, paged list of every finished game. */
export function MatchesView({
  records,
  filters,
  onFiltersChange,
}: {
  records: MatchRecords;
  filters: MatchListFilters;
  onFiltersChange: (filters: MatchListFilters) => void;
}) {
  const intl = useIntl();
  const { list, loadMatches, token } = useStore(useShallow((state) => ({
    list: state.matchList,
    loadMatches: state.loadMatches,
    token: state.authToken,
  })));
  useEffect(() => {
    void loadMatches(filters);
  }, [filters, loadMatches, token]);
  const heroes = useMemo(() => playedHeroes(records), [records]);
  const filtered = filters.format !== undefined || filters.heroId !== undefined
    || (filters.opponent !== undefined && filters.opponent !== "all");

  return (
    <div className="history-matches-view">
      <FormatFilters filters={filters} onChange={onFiltersChange}>
        <select
          aria-label={intl.formatMessage({ id: "history.filter.hero" })}
          value={filters.heroId ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            const { heroId: _heroId, ...rest } = filters;
            onFiltersChange(value ? { ...rest, heroId: value } : rest);
          }}
        >
          <option value="">{intl.formatMessage({ id: "history.filter.anyHero" })}</option>
          {heroes.map((heroId) => (
            <option key={heroId} value={heroId}>{heroName(heroId)}</option>
          ))}
        </select>
        <select
          aria-label={intl.formatMessage({ id: "history.filter.opponent" })}
          value={filters.opponent ?? "all"}
          onChange={(event) => {
            const value = event.target.value;
            const { opponent: _opponent, ...rest } = filters;
            onFiltersChange(isOpponentFilter(value) && value !== "all" ? { ...rest, opponent: value } : rest);
          }}
        >
          {MATCH_OPPONENT_FILTERS.map((option) => (
            <option key={option} value={option}>
              {intl.formatMessage({ id: `history.filter.opponent.${option}` })}
            </option>
          ))}
        </select>
        <OpenReplayFile />
      </FormatFilters>
      <RetentionNote />
      <MatchList
        matches={list.matches}
        loading={list.loading}
        loaded={list.loaded}
        error={list.error}
        hasMore={list.nextCursor !== null}
        emptyMessageId={filtered ? "history.matches.emptyFiltered" : "history.matches.empty"}
        onLoadMore={() => void loadMatches(filters, list.nextCursor)}
        onRetry={() => void loadMatches(filters)}
      />
    </div>
  );
}
