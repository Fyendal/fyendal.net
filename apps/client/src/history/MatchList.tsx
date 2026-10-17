import { useState } from "react";
import { MAX_FAVORITE_REPLAYS, type MatchSummary } from "@fyendal/protocol";
import { useIntl, type IntlShape } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon } from "../components/UiIcon.js";
import { cardImageUrl } from "../game/Card.js";
import { formatLabel } from "../lobby/FormatBadge.js";
import { useStore } from "../store.js";
import { heroName } from "./HeroPortrait.js";
import { ShareReplayDialog } from "./ShareReplayDialog.js";
import { matchOutcome } from "./summarizeRecords.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows warn only inside this window; the retention rule itself is stated once above the list. */
const EXPIRY_WARNING_DAYS = 2;

/** One-word result for the row; the end reason is a hover detail. */
export function resultMessageId(match: Pick<MatchSummary, "winner" | "yourSeat" | "endReason">): string {
  return `history.result.${matchOutcome(match)}`;
}

export function reasonMessageId(match: Pick<MatchSummary, "winner" | "yourSeat" | "endReason">): string | null {
  const outcome = matchOutcome(match);
  if (outcome === "draw" || outcome === "ended") return null;
  if (match.endReason !== "lethal" && match.endReason !== "concede" && match.endReason !== "idle") return null;
  return `history.reason.${outcome}.${match.endReason}`;
}

function opponentLabel(intl: IntlShape, participant: MatchSummary["players"][number]): string {
  if (participant.username) return participant.username;
  return intl.formatMessage({
    id: participant.controller === "bot" ? "history.match.practiceBot" : "history.match.deletedPlayer",
  });
}

function Side({ heroId, caption }: { heroId: string; caption: string | null }) {
  return (
    <span className="match-side">
      <img className="match-side-art" src={cardImageUrl(heroId)} alt="" loading="lazy" />
      <span className="match-side-copy">
        <span className="match-side-hero">{heroName(heroId)}</span>
        {caption ? <span className="match-side-caption">{caption}</span> : null}
      </span>
    </span>
  );
}

/** Newest-first rows of finished games with replay actions on each row.
 * Used by the Matches tab (full, paged) and the Overview (recent few). */
export function MatchList({
  matches,
  loading,
  loaded,
  error,
  hasMore,
  emptyMessageId,
  onLoadMore,
  onRetry,
}: {
  matches: readonly MatchSummary[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  hasMore: boolean;
  emptyMessageId: string;
  onLoadMore?: () => void;
  onRetry: () => void;
}) {
  const intl = useIntl();
  const {
    savedReplays,
    favoriteCount,
    watchSavedReplay,
    exportSavedReplay,
    setMatchReplayFavorite,
    deleteMatchReplay,
  } = useStore(useShallow((state) => ({
    savedReplays: state.savedReplays,
    favoriteCount: state.savedReplays.reduce((count, replay) => count + (replay.favorite ? 1 : 0), 0),
    watchSavedReplay: state.watchSavedReplay,
    exportSavedReplay: state.exportSavedReplay,
    setMatchReplayFavorite: state.setMatchReplayFavorite,
    deleteMatchReplay: state.deleteMatchReplay,
  })));
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<{ replayId: string; expiresInDays: number | null } | null>(null);

  const run = async (replayId: string, action: "watch" | "export") => {
    setBusy(`${action}:${replayId}`);
    setActionError(null);
    const message = action === "watch" ? await watchSavedReplay(replayId) : await exportSavedReplay(replayId);
    setBusy(null);
    setActionError(message);
  };
  const toggleFavorite = async (matchId: string, replayId: string, favorite: boolean) => {
    setBusy(`favorite:${replayId}`);
    setActionError(null);
    const result = await setMatchReplayFavorite(matchId, replayId, favorite);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error === "favorite replay limit reached"
        ? intl.formatMessage({ id: "replay.favoriteLimit" })
        : result.error);
    }
  };
  const remove = async (matchId: string, replayId: string) => {
    if (!window.confirm(intl.formatMessage({ id: "replay.confirmDelete" }))) return;
    setBusy(`delete:${replayId}`);
    setActionError(null);
    const result = await deleteMatchReplay(matchId, replayId);
    setBusy(null);
    if (!result.ok) setActionError(result.error);
  };

  return (
    <div className="match-list-wrap">
      {error ? (
        <div role="alert" className="history-error">
          {intl.formatMessage({ id: "history.matches.loadError" })}{" "}
          <button type="button" onClick={onRetry}>{intl.formatMessage({ id: "history.matches.retry" })}</button>
        </div>
      ) : null}
      {loaded && matches.length === 0 && !error ? (
        <p className="history-empty">{intl.formatMessage({ id: emptyMessageId })}</p>
      ) : null}
      <ol className="match-list">
        {matches.map((match) => {
          const outcome = matchOutcome(match);
          const you = match.players[match.yourSeat];
          const opponent = match.players[match.yourSeat === 0 ? 1 : 0];
          const replay = match.replay;
          const reasonId = reasonMessageId(match);
          const daysLeft = replay && !replay.favorite
            ? Math.max(1, Math.ceil((replay.expiresAt - Date.now()) / DAY_MS))
            : null;
          const atLimit = replay !== null && !replay.favorite && favoriteCount >= MAX_FAVORITE_REPLAYS;
          const shared = replay !== null
            && savedReplays.some((saved) => saved.id === replay.id && saved.share !== null);
          const watchTitle = replay
            ? replay.favorite
              ? intl.formatMessage({ id: "history.match.replayKept" })
              : intl.formatMessage({ id: "history.match.replayDaysLeft" }, { count: daysLeft })
            : undefined;
          return (
            <li className={`match-row is-${outcome}`} key={match.id}>
              <span className="match-result" title={reasonId ? intl.formatMessage({ id: reasonId }) : undefined}>
                <strong>{intl.formatMessage({ id: resultMessageId(match) })}</strong>
                <time dateTime={new Date(match.finishedAt).toISOString()}>
                  {intl.formatDate(match.finishedAt, { month: "short", day: "numeric" })}
                </time>
              </span>
              <span
                className="match-matchup"
                aria-label={intl.formatMessage(
                  { id: "history.match.matchup" },
                  { you: heroName(you.heroId), opponent: heroName(opponent.heroId) },
                )}
              >
                <Side heroId={you.heroId} caption={null} />
                <span className="match-vs" aria-hidden="true">vs</span>
                <Side heroId={opponent.heroId} caption={opponentLabel(intl, opponent)} />
              </span>
              <span className="match-format">{formatLabel(intl, match.format)}</span>
              <span className="match-actions">
                {replay ? (
                  <>
                    <TooltipButton
                      className="match-watch"
                      disabled={busy !== null}
                      tooltip={watchTitle ?? ""}
                      aria-label={intl.formatMessage({ id: "replay.watch" })}
                      onClick={() => void run(replay.id, "watch")}
                    >
                      {intl.formatMessage({ id: busy === `watch:${replay.id}` ? "replay.watchLoading" : "replay.watch" })}
                    </TooltipButton>
                    <TooltipButton
                      className={`match-icon-button${replay.favorite ? " selected" : ""}`}
                      disabled={busy !== null || atLimit}
                      onClick={() => void toggleFavorite(match.id, replay.id, !replay.favorite)}
                      aria-pressed={replay.favorite}
                      tooltip={intl.formatMessage({
                        id: busy === `favorite:${replay.id}`
                          ? "replay.favoriteSaving"
                          : atLimit ? "replay.favoriteLimit" : replay.favorite ? "replay.unfavorite" : "replay.favorite",
                      })}
                    >
                      <UiIcon name="star" />
                    </TooltipButton>
                    <TooltipButton
                      className={`match-icon-button${shared ? " selected" : ""}`}
                      disabled={busy !== null}
                      onClick={() => setSharing({ replayId: replay.id, expiresInDays: daysLeft })}
                      tooltip={intl.formatMessage({ id: shared ? "replay.share.manage" : "replay.share.open" })}
                    >
                      <UiIcon name="share" />
                    </TooltipButton>
                    <TooltipButton
                      className="match-icon-button"
                      disabled={busy !== null}
                      onClick={() => void run(replay.id, "export")}
                      tooltip={intl.formatMessage({
                        id: busy === `export:${replay.id}` ? "replay.prepareExport" : "replay.exportJson",
                      })}
                    >
                      <UiIcon name="download" />
                    </TooltipButton>
                    <TooltipButton
                      className="match-icon-button is-danger"
                      disabled={busy !== null}
                      onClick={() => void remove(match.id, replay.id)}
                      tooltip={intl.formatMessage({
                        id: busy === `delete:${replay.id}` ? "replay.deleting" : "replay.delete",
                      })}
                    >
                      <UiIcon name="trash" />
                    </TooltipButton>
                    {daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS ? (
                      <span className="match-replay-soon">
                        {intl.formatMessage({ id: "history.match.replayExpiresSoon" }, { count: daysLeft })}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="match-replay-gone">{intl.formatMessage({ id: "history.match.replayExpired" })}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {loading ? <p role="status" className="muted">{intl.formatMessage({ id: "common.loading" })}</p> : null}
      {!loading && hasMore && onLoadMore ? (
        <button type="button" className="history-more" onClick={onLoadMore}>
          {intl.formatMessage({ id: "history.matches.more" })}
        </button>
      ) : null}
      {actionError ? <p className="error" role="alert">{actionError}</p> : null}
      {sharing ? (
        <ShareReplayDialog
          replayId={sharing.replayId}
          expiresInDays={sharing.expiresInDays}
          onClose={() => setSharing(null)}
        />
      ) : null}
    </div>
  );
}
