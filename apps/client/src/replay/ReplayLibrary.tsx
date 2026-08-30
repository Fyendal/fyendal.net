import { Fragment, useEffect, useRef, useState } from "react";
import { cardData } from "@fyendal/cards/client";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { FormatBadge } from "../lobby/FormatBadge.js";
import { cardImageUrl } from "../game/Card.js";
import { replayResult } from "./replayResult.js";

function expiryLabel(expiresAt: number): { text: string; urgent: boolean } {
  const remaining = expiresAt - Date.now();
  if (remaining <= 24 * 60 * 60 * 1000) return { text: "Expires today", urgent: true };
  const days = Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  return { text: `${days} days left`, urgent: days <= 2 };
}

export function ReplayLibrary() {
  const {
    savedReplays,
    replaysLoading,
    refreshReplays,
    watchSavedReplay,
    exportSavedReplay,
    deleteSavedReplay,
    openReplayText,
  } = useStore(useShallow((state) => ({
    savedReplays: state.savedReplays,
    replaysLoading: state.replaysLoading,
    refreshReplays: state.refreshReplays,
    watchSavedReplay: state.watchSavedReplay,
    exportSavedReplay: state.exportSavedReplay,
    deleteSavedReplay: state.deleteSavedReplay,
    openReplayText: state.openReplayText,
  })));
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
    if (!window.confirm("Delete this saved replay? This cannot be undone.")) return;
    setBusy(`delete:${id}`);
    setError(null);
    const result = await deleteSavedReplay(id);
    setBusy(null);
    if (!result.ok) setError(result.error);
  };

  const onReplayFile = async (file: File | undefined) => {
    if (!file) return;
    setError(openReplayText(await file.text()));
  };

  return (
    <div className="panel replay-library">
      <header className="replay-library-header">
        <div>
          <h2 className="panel-title">My Replays</h2>
          <p>Replays are saved for 7 days. Export anything you want to keep.</p>
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
          <button aria-label="Open replay file" onClick={() => fileInput.current?.click()}>
            <span className="replay-open-label-desktop">Open Replay File…</span>
            <span className="replay-open-label-mobile" aria-hidden="true">Open File</span>
          </button>
        </div>
      </header>

      {replaysLoading && savedReplays.length === 0 ? <p className="muted">Loading replays…</p> : null}
      {!replaysLoading && savedReplays.length === 0 ? (
        <div className="replay-empty">
          <h3>No saved replays yet</h3>
          <p>Completed games and manually ended bot games will appear here automatically.</p>
        </div>
      ) : null}

      <div className="replay-grid">
        {savedReplays.map((replay) => {
          const heroes = replay.heroIds.map((id) => cardData[id]?.name ?? id) as [string, string];
          const expiry = expiryLabel(replay.expiresAt);
          const result = replayResult(replay.winner, replay.yourSeat);
          return (
            <article className="replay-card" key={replay.id}>
              <div className="replay-matchup" aria-label={`${heroes[0]} versus ${heroes[1]}`}>
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
                  <strong className={result.className}>{result.label}</strong>
                </div>
                <time dateTime={new Date(replay.finishedAt).toISOString()}>
                  {new Date(replay.finishedAt).toLocaleString()}
                </time>
                <span className="replay-frame-count">{replay.frameCount} frames</span>
                <time
                  className={expiry.urgent ? "replay-expiry urgent" : "replay-expiry"}
                  dateTime={new Date(replay.expiresAt).toISOString()}
                  title={`Expires ${new Date(replay.expiresAt).toLocaleString()}`}
                >
                  {expiry.text}
                </time>
              </div>
              <div className="replay-card-actions">
                <button
                  disabled={busy !== null}
                  onClick={() => void run(replay.id, "watch")}
                >
                  {busy === `watch:${replay.id}` ? "Loading…" : "▶ Watch"}
                </button>
                <div className="replay-card-secondary-actions">
                  <button
                    className="replay-card-icon-button"
                    disabled={busy !== null}
                    onClick={() => void run(replay.id, "export")}
                    aria-label={busy === `export:${replay.id}` ? "Preparing replay export" : "Export replay JSON"}
                    title="Export replay JSON"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M11 3h2v10.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V3ZM5 19h14v2H5v-2Z" />
                    </svg>
                  </button>
                  <button
                    className="replay-card-icon-button btn-danger"
                    disabled={busy !== null}
                    onClick={() => void remove(replay.id)}
                    aria-label={busy === `delete:${replay.id}` ? "Deleting replay" : "Delete replay"}
                    title="Delete replay"
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
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}
