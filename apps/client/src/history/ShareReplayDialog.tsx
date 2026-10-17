import { useEffect, useState } from "react";
import { REPLAY_SHARE_VISIBILITIES, type ReplayShareVisibility } from "@fyendal/protocol";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { sharedReplayUrl } from "../replay/route.js";
import { useStore } from "../store.js";

/** Owner controls for one replay copy's share link. Changing who it opens for
 * keeps the link; only Reset link invalidates copies already sent. */
export function ShareReplayDialog({
  replayId,
  expiresInDays,
  onClose,
}: {
  replayId: string;
  /** Null when the replay is a favorite and kept indefinitely. */
  expiresInDays: number | null;
  onClose: () => void;
}) {
  const intl = useIntl();
  const { listed, share, refreshReplays, setReplayShare, resetReplayShare, removeReplayShare } = useStore(
    useShallow((state) => {
      const replay = state.savedReplays.find((saved) => saved.id === replayId);
      return {
        listed: replay !== undefined,
        share: replay?.share ?? null,
        refreshReplays: state.refreshReplays,
        setReplayShare: state.setReplayShare,
        resetReplayShare: state.resetReplayShare,
        removeReplayShare: state.removeReplayShare,
      };
    }),
  );
  // Settings are a draft only until the link exists; afterwards the account's
  // replay list is authoritative, so a rejected change never shows as applied.
  const [draft, setDraft] = useState<{ visibility: ReplayShareVisibility; includeNotes: boolean }>({
    visibility: "public",
    includeNotes: false,
  });
  const { visibility, includeNotes } = share ?? draft;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = share ? sharedReplayUrl(share.token) : null;

  // The list refreshes at game over, possibly before this replay finished
  // finalizing; load it so an existing link shows instead of "Create link".
  useEffect(() => {
    if (!listed) void refreshReplays();
  }, [listed, refreshReplays]);

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.error);
  };
  const change = (next: { visibility: ReplayShareVisibility; includeNotes: boolean }) => {
    if (share) void run(() => setReplayShare(replayId, next.visibility, next.includeNotes));
    else setDraft(next);
  };
  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };
  const reset = async () => {
    if (!window.confirm(intl.formatMessage({ id: "replay.share.confirmReset" }))) return;
    await run(() => resetReplayShare(replayId));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="deck-pick-modal share-replay-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-replay-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <h2 className="panel-title" id="share-replay-title">
          {intl.formatMessage({ id: "replay.share.title" })}
        </h2>
        <p className="muted">{intl.formatMessage({ id: "replay.share.perspective" })}</p>
        <fieldset className="share-replay-fieldset" disabled={busy}>
          <legend>{intl.formatMessage({ id: "replay.share.audience" })}</legend>
          {REPLAY_SHARE_VISIBILITIES.map((option) => (
            <label key={option} className="share-replay-option">
              <input
                type="radio"
                name="share-replay-visibility"
                value={option}
                checked={visibility === option}
                onChange={() => change({ visibility: option, includeNotes })}
              />
              <span>
                <strong>{intl.formatMessage({ id: `replay.share.visibility.${option}` })}</strong>
                <span className="muted">{intl.formatMessage({ id: `replay.share.visibility.${option}.hint` })}</span>
              </span>
            </label>
          ))}
          <label className="share-replay-option">
            <input
              type="checkbox"
              checked={includeNotes}
              onChange={(event) => change({ visibility, includeNotes: event.target.checked })}
            />
            <span>
              <strong>{intl.formatMessage({ id: "replay.share.includeNotes" })}</strong>
              <span className="muted">{intl.formatMessage({ id: "replay.share.includeNotes.hint" })}</span>
            </span>
          </label>
        </fieldset>
        {expiresInDays !== null ? (
          <p className="share-replay-expiry">
            {intl.formatMessage({ id: "replay.share.expires" }, { count: expiresInDays })}
          </p>
        ) : null}
        {url ? (
          <div className="share-replay-link">
            <input
              readOnly
              value={url}
              aria-label={intl.formatMessage({ id: "replay.share.link" })}
              onFocus={(event) => event.target.select()}
            />
            <button type="button" className="btn-primary" onClick={() => void copy()}>
              {intl.formatMessage({ id: copied ? "replay.share.copied" : "replay.share.copy" })}
            </button>
          </div>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="deck-actions">
          {share ? (
            <>
              <button type="button" className="secondary" disabled={busy} onClick={() => void reset()}>
                {intl.formatMessage({ id: "replay.share.reset" })}
              </button>
              <button
                type="button"
                className="secondary danger"
                disabled={busy}
                onClick={() => void run(() => removeReplayShare(replayId))}
              >
                {intl.formatMessage({ id: "replay.share.stop" })}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void run(() => setReplayShare(replayId, visibility, includeNotes))}
            >
              {intl.formatMessage({ id: "replay.share.create" })}
            </button>
          )}
          <button type="button" onClick={onClose}>{intl.formatMessage({ id: "common.close" })}</button>
        </div>
      </div>
    </div>
  );
}
