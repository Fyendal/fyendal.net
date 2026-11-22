import { useState } from "react";
import { MAX_FAVORITE_REPLAYS, type ReplaySummary } from "@fyendal/protocol";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon } from "../components/UiIcon.js";
import { formatLabel } from "../lobby/FormatBadge.js";
import { useStore } from "../store.js";
import { heroName } from "./HeroPortrait.js";
import { Side } from "./MatchList.js";
import { ReplayActionsMenu } from "./ReplayActionsMenu.js";
import { ShareReplayDialog, savedReplayDaysLeft } from "./ShareReplayDialog.js";

/** Sandbox replays have no match row, so they are listed from the saved replays. */
export function sandboxReplays(replays: readonly ReplaySummary[]): ReplaySummary[] {
  return replays.filter((replay) => replay.sandbox === true);
}

/** Replays of sandbox and solo games. No result is shown: these games count toward no record. */
export function SandboxReplayList() {
  const intl = useIntl();
  const { replays, favoriteCount, watchSavedReplay, exportSavedReplay, setSavedReplayFavorite, deleteSavedReplay } =
    useStore(useShallow((state) => ({
      replays: state.savedReplays,
      favoriteCount: state.savedReplays.reduce((count, replay) => count + (replay.favorite ? 1 : 0), 0),
      watchSavedReplay: state.watchSavedReplay,
      exportSavedReplay: state.exportSavedReplay,
      setSavedReplayFavorite: state.setSavedReplayFavorite,
      deleteSavedReplay: state.deleteSavedReplay,
    })));
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<{ replayId: string; expiresInDays: number | null } | null>(null);
  const listed = sandboxReplays(replays);
  if (listed.length === 0) return null;

  const perform = async (key: string, action: () => Promise<string | null>) => {
    setBusy(key);
    setActionError(null);
    const message = await action();
    setBusy(null);
    setActionError(message);
  };
  const resultError = (result: { ok: true } | { ok: false; error: string }) => result.ok
    ? null
    : result.error === "favorite replay limit reached"
      ? intl.formatMessage({ id: "replay.favoriteLimit" })
      : result.error;

  return (
    <section className="history-section sandbox-replays" aria-labelledby="history-sandbox-replays">
      <h3 id="history-sandbox-replays">{intl.formatMessage({ id: "history.sandboxReplays.title" })}</h3>
      <p className="history-note">{intl.formatMessage({ id: "history.sandboxReplays.note" })}</p>
      <ol className="match-list">
        {listed.map((replay) => {
          const you = replay.heroIds[replay.yourSeat];
          const opponent = replay.heroIds[replay.yourSeat === 0 ? 1 : 0];
          const daysLeft = savedReplayDaysLeft(replay);
          const atLimit = !replay.favorite && favoriteCount >= MAX_FAVORITE_REPLAYS;
          return (
            <li className="match-row is-sandbox" key={replay.id}>
              <span className="match-result">
                <span className="sandbox-badge">{intl.formatMessage({ id: "history.result.sandbox" })}</span>
                <time dateTime={new Date(replay.finishedAt).toISOString()}>
                  {intl.formatDate(replay.finishedAt, { month: "short", day: "numeric" })}
                </time>
              </span>
              <span
                className="match-matchup"
                aria-label={intl.formatMessage(
                  { id: "history.match.matchup" },
                  { you: heroName(you), opponent: heroName(opponent) },
                )}
              >
                <Side heroId={you} />
                <span className="match-vs" aria-hidden="true">vs</span>
                <Side heroId={opponent} />
              </span>
              <span className="match-format">{formatLabel(intl, replay.format)}</span>
              <span className="match-actions">
                <TooltipButton
                  className="match-watch"
                  disabled={busy !== null}
                  tooltip={replay.favorite
                    ? intl.formatMessage({ id: "history.match.replayKept" })
                    : intl.formatMessage({ id: "history.match.replayDaysLeft" }, { count: daysLeft })}
                  aria-label={intl.formatMessage({ id: "replay.watch" })}
                  onClick={() => void perform(`watch:${replay.id}`, () => watchSavedReplay(replay.id))}
                >
                  <UiIcon name="play" />
                  {intl.formatMessage({ id: busy === `watch:${replay.id}` ? "replay.watchLoading" : "replay.watch" })}
                </TooltipButton>
                <TooltipButton
                  className={`match-icon-button match-favorite${replay.favorite ? " is-kept" : ""}`}
                  disabled={busy !== null || atLimit}
                  onClick={() => void perform(
                    `favorite:${replay.id}`,
                    async () => resultError(await setSavedReplayFavorite(replay.id, !replay.favorite)),
                  )}
                  aria-pressed={replay.favorite}
                  tooltip={intl.formatMessage({
                    id: busy === `favorite:${replay.id}`
                      ? "replay.favoriteSaving"
                      : atLimit ? "replay.favoriteLimit" : replay.favorite ? "replay.unfavorite" : "replay.favorite",
                  })}
                >
                  <UiIcon name={replay.favorite ? "star" : "star-outline"} />
                </TooltipButton>
                <ReplayActionsMenu
                  disabled={busy !== null}
                  label={intl.formatMessage({
                    id: busy === `export:${replay.id}`
                      ? "replay.prepareExport"
                      : busy === `delete:${replay.id}` ? "replay.deleting" : "replay.moreActions",
                  })}
                  items={[
                    {
                      key: "share",
                      icon: "share",
                      label: intl.formatMessage({ id: replay.share ? "replay.share.manage" : "replay.share.open" }),
                      onSelect: () => setSharing({ replayId: replay.id, expiresInDays: daysLeft }),
                    },
                    {
                      key: "export",
                      icon: "download",
                      label: intl.formatMessage({ id: "replay.exportJson" }),
                      onSelect: () => void perform(`export:${replay.id}`, () => exportSavedReplay(replay.id)),
                    },
                    {
                      key: "delete",
                      icon: "trash",
                      label: intl.formatMessage({ id: "replay.delete" }),
                      onSelect: () => {
                        if (!window.confirm(intl.formatMessage({ id: "replay.confirmDelete" }))) return;
                        void perform(`delete:${replay.id}`, async () => resultError(await deleteSavedReplay(replay.id)));
                      },
                      danger: true,
                    },
                  ]}
                />
              </span>
            </li>
          );
        })}
      </ol>
      {actionError ? <p className="error" role="alert">{actionError}</p> : null}
      {sharing ? (
        <ShareReplayDialog
          replayId={sharing.replayId}
          expiresInDays={sharing.expiresInDays}
          onClose={() => setSharing(null)}
        />
      ) : null}
    </section>
  );
}
