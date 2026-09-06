import { Fragment, useEffect, useRef, useState } from "react";
import { cardData } from "@fyendal/cards/client";
import { MAX_FAVORITE_REPLAYS } from "@fyendal/protocol";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { FormatBadge } from "../lobby/FormatBadge.js";
import { cardImageUrl } from "../game/Card.js";
import { replayResult } from "./replayResult.js";

function expiryStatus(expiresAt: number): {
  kind: "today" | "days";
  days: number;
  urgent: boolean;
} {
  const remaining = expiresAt - Date.now();
  if (remaining <= 24 * 60 * 60 * 1000) return { kind: "today", days: 0, urgent: true };
  const days = Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  return { kind: "days", days, urgent: days <= 2 };
}

type ReplayLibraryFilter = "all" | "favorites";

export function replaysForFilter<T extends { favorite: boolean }>(
  replays: readonly T[],
  filter: ReplayLibraryFilter,
): readonly T[] {
  return filter === "favorites" ? replays.filter((replay) => replay.favorite) : replays;
}

export function ReplayLibrary() {
  const intl = useIntl();
  const {
    savedReplays,
    replaysLoading,
    refreshReplays,
    watchSavedReplay,
    exportSavedReplay,
    setSavedReplayFavorite,
    deleteSavedReplay,
    openReplayText,
  } = useStore(useShallow((state) => ({
    savedReplays: state.savedReplays,
    replaysLoading: state.replaysLoading,
    refreshReplays: state.refreshReplays,
    watchSavedReplay: state.watchSavedReplay,
    exportSavedReplay: state.exportSavedReplay,
    setSavedReplayFavorite: state.setSavedReplayFavorite,
    deleteSavedReplay: state.deleteSavedReplay,
    openReplayText: state.openReplayText,
  })));
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReplayLibraryFilter>("all");
  const favoriteCount = savedReplays.reduce(
    (count, replay) => count + (replay.favorite ? 1 : 0),
    0,
  );
  const visibleReplays = replaysForFilter(savedReplays, filter);

  useEffect(() => {
    void refreshReplays();
  }, [refreshReplays]);

  const run = async (id: string, action: "watch" | "export") => {
    setBusy(`${action}:${id}`);
    setError(null);
    const message = action === "watch"
      ? await watchSavedReplay(id)
      : await exportSavedReplay(id);
    setBusy(null);
    setError(message);
    if (message) void refreshReplays();
  };

  const remove = async (id: string) => {
    if (!window.confirm(intl.formatMessage({ id: "replay.confirmDelete" }))) return;
    setBusy(`delete:${id}`);
    setError(null);
    const result = await deleteSavedReplay(id);
    setBusy(null);
    if (!result.ok) setError(result.error);
  };

  const toggleFavorite = async (id: string, favorite: boolean) => {
    setBusy(`favorite:${id}`);
    setError(null);
    const result = await setSavedReplayFavorite(id, favorite);
    setBusy(null);
    if (!result.ok) {
      setError(result.error === "favorite replay limit reached"
        ? intl.formatMessage({ id: "replay.favoriteLimit" })
        : result.error);
    }
  };

  const onReplayFile = async (file: File | undefined) => {
    if (!file) return;
    setError(openReplayText(await file.text()));
  };

  return (
    <div className="panel replay-library">
      <header className="replay-library-header">
        <div>
          <h2 className="panel-title">{intl.formatMessage({ id: "replay.title" })}</h2>
          <p>{intl.formatMessage({ id: "replay.retention" })}</p>
        </div>
        <div className="replay-library-import">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              void onReplayFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            aria-label={intl.formatMessage({ id: "replay.openFile" })}
            onClick={() => fileInput.current?.click()}
          >
            <span className="replay-open-label-desktop">{intl.formatMessage({ id: "replay.openFile" })}</span>
            <span className="replay-open-label-mobile" aria-hidden="true">{intl.formatMessage({ id: "replay.openFileShort" })}</span>
          </button>
        </div>
      </header>

      <div
        className="replay-library-tabs"
        role="tablist"
        aria-label={intl.formatMessage({ id: "replay.filterLabel" })}
      >
        <button
          id="replay-tab-all"
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          aria-controls="replay-list-panel"
          className={filter === "all" ? "selected" : ""}
          onClick={() => setFilter("all")}
        >
          {intl.formatMessage({ id: "replay.filterAll" })} <span>{savedReplays.length}</span>
        </button>
        <button
          id="replay-tab-favorites"
          type="button"
          role="tab"
          aria-selected={filter === "favorites"}
          aria-controls="replay-list-panel"
          className={filter === "favorites" ? "selected" : ""}
          onClick={() => setFilter("favorites")}
        >
          {intl.formatMessage({ id: "replay.filterFavorites" })} <span>{favoriteCount}</span>
        </button>
      </div>

      <div
        id="replay-list-panel"
        role="tabpanel"
        aria-labelledby={filter === "all" ? "replay-tab-all" : "replay-tab-favorites"}
      >
        {replaysLoading && savedReplays.length === 0 ? (
          <p className="muted">{intl.formatMessage({ id: "replay.loading" })}</p>
        ) : null}
        {!replaysLoading && savedReplays.length === 0 ? (
          <div className="replay-empty">
            <h3>{intl.formatMessage({ id: "replay.emptyTitle" })}</h3>
            <p>{intl.formatMessage({ id: "replay.emptyBody" })}</p>
          </div>
        ) : null}
        {!replaysLoading && savedReplays.length > 0 && visibleReplays.length === 0 ? (
          <div className="replay-empty">
            <h3>{intl.formatMessage({ id: "replay.favoriteEmptyTitle" })}</h3>
            <p>{intl.formatMessage({ id: "replay.favoriteEmptyBody" })}</p>
          </div>
        ) : null}

        <div className="replay-grid">
          {visibleReplays.map((replay) => {
          const heroes = replay.heroIds.map((id) => cardData[id]?.name ?? id) as [string, string];
          const expiry = expiryStatus(replay.expiresAt);
          const result = replayResult(replay.winner, replay.yourSeat);
          const finishedAt = intl.formatDate(replay.finishedAt, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
          const expiresAt = intl.formatDate(replay.expiresAt, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
          return (
            <article className="replay-card" key={replay.id}>
              <div className="replay-matchup" aria-label={intl.formatMessage(
                { id: "replay.matchup" },
                { firstHero: heroes[0], secondHero: heroes[1] },
              )}>
                {replay.heroIds.map((id, seat) => (
                  <Fragment key={`${id}-${seat}`}>
                    {seat === 1 ? <span className="replay-vs" aria-hidden="true">VS</span> : null}
                    <div className="replay-hero">
                      <img src={cardImageUrl(id)} alt="" />
                      <span>{heroes[seat]}</span>
                    </div>
                  </Fragment>
                ))}
              </div>
              <div className="replay-card-meta">
                <div className="replay-card-tags">
                  <FormatBadge format={replay.format} />
                  <strong className={result.className}>{intl.formatMessage({
                    id: result.label === "Victory"
                      ? "replay.victory"
                      : result.label === "Defeat"
                        ? "replay.defeat"
                        : "replay.ended",
                  })}</strong>
                </div>
                <time dateTime={new Date(replay.finishedAt).toISOString()}>
                  {finishedAt}
                </time>
                <span className="replay-frame-count">{intl.formatMessage(
                  { id: "replay.frameCount" },
                  { count: replay.frameCount },
                )}</span>
                {replay.favorite ? (
                  <span className="replay-favorite-retained">
                    {intl.formatMessage({ id: "replay.favoriteRetained" })}
                  </span>
                ) : (
                  <time
                    className={expiry.urgent ? "replay-expiry urgent" : "replay-expiry"}
                    dateTime={new Date(replay.expiresAt).toISOString()}
                    title={intl.formatMessage({ id: "replay.expiresAt" }, { date: expiresAt })}
                  >
                    {expiry.kind === "today"
                      ? intl.formatMessage({ id: "replay.expiresToday" })
                      : intl.formatMessage({ id: "replay.daysLeft" }, { count: expiry.days })}
                  </time>
                )}
              </div>
              <div className="replay-card-actions">
                <button
                  disabled={busy !== null}
                  onClick={() => void run(replay.id, "watch")}
                >
                  {busy === `watch:${replay.id}`
                    ? intl.formatMessage({ id: "replay.watchLoading" })
                    : intl.formatMessage({ id: "replay.watch" })}
                </button>
                <div className="replay-card-secondary-actions">
                  <button
                    className={`replay-card-icon-button replay-favorite-button${replay.favorite ? " selected" : ""}`}
                    disabled={busy !== null || (
                      !replay.favorite && favoriteCount >= MAX_FAVORITE_REPLAYS
                    )}
                    onClick={() => void toggleFavorite(replay.id, !replay.favorite)}
                    aria-pressed={replay.favorite}
                    aria-label={intl.formatMessage({
                      id: busy === `favorite:${replay.id}`
                        ? "replay.favoriteSaving"
                        : replay.favorite
                          ? "replay.unfavorite"
                          : "replay.favorite",
                    })}
                    title={intl.formatMessage({
                      id: !replay.favorite && favoriteCount >= MAX_FAVORITE_REPLAYS
                        ? "replay.favoriteLimit"
                        : replay.favorite
                          ? "replay.unfavorite"
                          : "replay.favorite",
                    })}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m12 2.4 2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.47l-5.9 3.1L7.23 14 2.45 9.34l6.6-.96L12 2.4Z" />
                    </svg>
                  </button>
                  <button
                    className="replay-card-icon-button"
                    disabled={busy !== null}
                    onClick={() => void run(replay.id, "export")}
                    aria-label={intl.formatMessage({
                      id: busy === `export:${replay.id}` ? "replay.prepareExport" : "replay.exportJson",
                    })}
                    title={intl.formatMessage({ id: "replay.exportJson" })}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M11 3h2v10.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V3ZM5 19h14v2H5v-2Z" />
                    </svg>
                  </button>
                  <button
                    className="replay-card-icon-button btn-danger"
                    disabled={busy !== null}
                    onClick={() => void remove(replay.id)}
                    aria-label={intl.formatMessage({
                      id: busy === `delete:${replay.id}` ? "replay.deleting" : "replay.delete",
                    })}
                    title={intl.formatMessage({ id: "replay.delete" })}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-2 6h12l-1 12H7L6 9Zm3 2v8h2v-8H9Zm4 0v8h2v-8h-2Z" />
                    </svg>
                  </button>
                </div>
              </div>
            </article>
          );
          })}
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}
