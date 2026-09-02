import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import type { EmoteMessage, GameLogViewEntry, UndoTarget } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import type {
  MotionPreference,
  PlayabilityCuePreference,
  PriorityWindowMode,
} from "../storage.js";
import {
  logTextSegments,
  parseTurnBoundaryLogLine,
  type LogTextSegment,
  type TurnBoundaryLogLine,
} from "./logCardRefs.js";
import { HeroEmote } from "./HeroEmote.js";
import { BugReportDialog, GameSettingsDialog } from "./SideRailDialogs.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { PrimaryActionButton, type PrimaryAction } from "./StatusFloat.js";
import { GameMessageText } from "../i18n/GameMessage.js";

type StructuredLogEntry = Extract<GameLogViewEntry, { message: unknown }>;

interface RenderedLogLine {
  segments: readonly LogTextSegment[];
  turnBoundary: TurnBoundaryLogLine | null;
  structured?: StructuredLogEntry;
}

function LogLines({
  lines,
  friendlyHeroName,
  opponentHeroName,
  viewerSeat,
  onInspectCard,
}: {
  lines: readonly RenderedLogLine[];
  friendlyHeroName: string;
  opponentHeroName: string;
  viewerSeat: 0 | 1;
  onInspectCard: (cardId: string) => void;
}) {
  const intl = useIntl();
  return lines.map(({ segments, turnBoundary, structured }, lineIndex) => (
    <div
      key={structured ? `structured-${structured.sequence}` : `legacy-${lineIndex}`}
      className={`log-line${turnBoundary || structured?.event?.kind === "turn-start" ? " log-turn-divider" : ""}`}
    >
      {turnBoundary ? (
        intl.formatMessage(
          { id: "game.log.turnBoundary" },
          {
            turn: turnBoundary.turn,
            status: intl.formatMessage({
              id: friendlyHeroName !== opponentHeroName && turnBoundary.heroName === friendlyHeroName
                ? "game.turn.yours"
                : friendlyHeroName !== opponentHeroName && turnBoundary.heroName === opponentHeroName
                  ? "game.turn.opponent"
                  : "game.turn.begins",
            }),
          },
        )
      ) : structured ? (
        <GameMessageText
          message={structured.message}
          fallback={structured.fallback}
          resolvers={{
            card: (cardId) => {
              const card = cardData[cardId];
              const name = card?.name ?? cardId;
              return (
                <button
                  type="button"
                  className={`card-ref log-card-ref${
                    friendlyHeroName !== opponentHeroName && name === friendlyHeroName
                      ? " log-card-ref-friendly"
                      : friendlyHeroName !== opponentHeroName && name === opponentHeroName
                        ? " log-card-ref-opponent"
                        : card?.cardType === "token"
                          ? " log-card-ref-token"
                          : ""
                  }`}
                  data-cardid={cardId}
                  onClick={() => onInspectCard(cardId)}
                >
                  {name}
                </button>
              );
            },
            player: (seat) => (
              <span className={seat === viewerSeat
                ? "log-player-ref log-player-ref-friendly"
                : "log-player-ref log-player-ref-opponent"}
              >
                {seat === viewerSeat ? friendlyHeroName : opponentHeroName}
              </span>
            ),
          }}
        />
      ) : segments.map((segment, segmentIndex) =>
        segment.cardId ? (
          <button
            key={segmentIndex}
            type="button"
            className={`card-ref log-card-ref${
              friendlyHeroName !== opponentHeroName && segment.text === friendlyHeroName
                ? " log-card-ref-friendly"
                : friendlyHeroName !== opponentHeroName && segment.text === opponentHeroName
                  ? " log-card-ref-opponent"
                  : segment.isToken
                    ? " log-card-ref-token"
                    : ""
            }`}
            data-cardid={segment.cardId}
            onClick={() => onInspectCard(segment.cardId!)}
          >
            {segment.text}
          </button>
        ) : (
          <span key={segmentIndex}>{segment.text}</span>
        ),
      )}
    </div>
  ));
}

function ControlIcon({ kind }: { kind: "undo" | "bug" | "settings" }) {
  const content = kind === "undo" ? (
    <>
      <path d="M9 7H5V3" />
      <path d="M5 7a9 9 0 1 1-1 8" />
    </>
  ) : kind === "bug" ? (
    <>
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
      <path d="M8 4 6.5 2.5M16 4l1.5-1.5" />
      <rect x="6" y="7" width="12" height="14" rx="6" />
      <path d="M12 11v10M6 11H3M18 11h3M6 16H3M18 16h3" />
    </>
  ) : (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
    </>
  );
  return (
    <svg
      className="game-control-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-control-icon={kind}
    >
      {content}
    </svg>
  );
}

/** Undo should not retain button focus: Space belongs to the board's pass
 * shortcut after the action has been restored. */
export function undoWithoutFocus(
  button: Pick<HTMLButtonElement, "blur">,
  undo: () => void,
): void {
  undo();
  button.blur();
}

/** Side panel: turn/phase status, actions, winner banner and game log. */
export function SideRail({
  collapsed,
  onToggleCollapsed,
  turn,
  onUndo,
  undoDisabled = false,
  onLeave,
  leaveAction,
  onConcede,
  spectating,
  spectatorCount,
  opponentConnected,
  connected,
  error,
  winnerText,
  replaying,
  emoteSeat,
  onSendEmote,
  onReportBug,
  onShowGameOver,
  priorityWindowMode,
  onPriorityWindowModeChange,
  lessGuidance,
  onLessGuidanceChange,
  skipPlayConfirmation,
  onSkipPlayConfirmationChange,
  motionPreference,
  onMotionPreferenceChange,
  playabilityCuePreference,
  onPlayabilityCuePreferenceChange,
  soundEffectsEnabled,
  onSoundEffectsEnabledChange,
  soundEffectsVolume,
  onSoundEffectsVolumeChange,
  log,
  logEntries,
  friendlyHeroName,
  opponentHeroName,
  viewerSeat,
  roomCode,
  onInspectCard,
  mobilePrimaryAction,
  mobilePrimaryActionDisabled = false,
  onMobilePrimaryAction,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  turn: number;
  onUndo: ((target?: UndoTarget) => void) | null;
  undoDisabled?: boolean;
  onLeave: () => void;
  leaveAction: "leave" | "end-game";
  /** seated player in a live game: concede ends it in the opponent's favor */
  onConcede: (() => void) | null;
  spectating: boolean;
  spectatorCount: number;
  opponentConnected: boolean;
  connected: boolean;
  error: string | null;
  winnerText: string | null;
  replaying: boolean;
  emoteSeat: number | null;
  onSendEmote: ((message: EmoteMessage) => void) | null;
  onReportBug: ((description: string) => Promise<
    { ok: true; reportId: string } | { ok: false; error: string }
  >) | null;
  onShowGameOver: (() => void) | null;
  priorityWindowMode: PriorityWindowMode;
  onPriorityWindowModeChange: ((mode: PriorityWindowMode) => void) | null;
  lessGuidance: boolean;
  onLessGuidanceChange: (enabled: boolean) => void;
  skipPlayConfirmation: boolean;
  onSkipPlayConfirmationChange: (enabled: boolean) => void;
  motionPreference: MotionPreference;
  onMotionPreferenceChange: (preference: MotionPreference) => void;
  playabilityCuePreference: PlayabilityCuePreference;
  onPlayabilityCuePreferenceChange: (preference: PlayabilityCuePreference) => void;
  soundEffectsEnabled: boolean;
  onSoundEffectsEnabledChange: (enabled: boolean) => void;
  soundEffectsVolume: number;
  onSoundEffectsVolumeChange: (volume: number) => void;
  log: string[];
  logEntries?: GameLogViewEntry[];
  friendlyHeroName: string;
  opponentHeroName: string;
  viewerSeat: 0 | 1;
  roomCode: string | null;
  onInspectCard: (cardId: string) => void;
  mobilePrimaryAction: PrimaryAction | null;
  mobilePrimaryActionDisabled?: boolean;
  onMobilePrimaryAction: () => void;
}) {
  const intl = useIntl();
  const [showSettings, setShowSettings] = useState(false);
  const [showBugReport, setShowBugReport] = useState(false);
  const [showMobileLog, setShowMobileLog] = useState(false);
  const [showUtilities, setShowUtilities] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<"leave" | "concede" | null>(null);
  const leaveLabel = intl.formatMessage({
    id: leaveAction === "end-game" ? "common.endGame" : "common.leave",
  });
  const showOpponentDisconnected = !replaying && !opponentConnected && winnerText === null;
  const renderedLog = useMemo(
    () => (logEntries ?? log.map((fallback): GameLogViewEntry => ({ fallback })))
      .slice()
      .reverse()
      .map((entry) => {
        const structured = "message" in entry ? entry : undefined;
        const turnBoundary = structured ? null : parseTurnBoundaryLogLine(entry.fallback);
        return {
          segments: turnBoundary || structured ? [] : logTextSegments(entry.fallback),
          turnBoundary,
          ...(structured ? { structured } : {}),
        };
      }),
    [log, logEntries],
  );
  return (
    <div className={`rail-right${collapsed ? " rail-collapsed" : ""}`}>
      <nav className="mobile-gamebar" aria-label={intl.formatMessage({ id: "game.controls" })}>
        <div className="mobile-gamebar-actions">
          {onUndo ? (
            <button
              aria-label={intl.formatMessage({ id: "game.undoLast" })}
              title={intl.formatMessage({ id: "game.undoLast" })}
              disabled={undoDisabled}
              onClick={(event) => undoWithoutFocus(
                event.currentTarget,
                () => onUndo("last-action"),
              )}
            >
              <ControlIcon kind="undo" />
            </button>
          ) : null}
          <button
            aria-label={intl.formatMessage({ id: "game.log.title" })}
            onClick={() => setShowMobileLog(true)}
          >
            {intl.formatMessage({ id: "game.log.short" })}
          </button>
          {mobilePrimaryAction ? (
            <div className="mobile-primary-action">
              <PrimaryActionButton
                action={mobilePrimaryAction}
                disabled={mobilePrimaryActionDisabled}
                onSelect={onMobilePrimaryAction}
              />
            </div>
          ) : null}
          {onSendEmote && emoteSeat !== null ? (
            <HeroEmote
              seat={emoteSeat}
              event={null}
              canSend
              onSend={onSendEmote}
              placement="toolbar"
            />
          ) : null}
          <button
            aria-label={intl.formatMessage({ id: "game.controls.more" })}
            onClick={() => setShowUtilities(true)}
          >
            {intl.formatMessage({ id: "lobby.nav.more" })}
          </button>
        </div>
      </nav>

      <div className="mobile-game-alerts" aria-live="polite">
        {!replaying && !connected ? (
          <div className="toast">{intl.formatMessage({ id: "game.connection.lost" })}</div>
        ) : null}
        {showOpponentDisconnected ? (
          <div className="toast">{intl.formatMessage({ id: "game.connection.opponentLost" })}</div>
        ) : null}
        {error ? <div className="toast">{error}</div> : null}
        {winnerText ? <div className="winner">{winnerText}</div> : null}
      </div>

      <div className="rail-header">
        <button
          type="button"
          className="rail-collapse-toggle"
          aria-label={intl.formatMessage({
            id: collapsed ? "game.rail.expand" : "game.rail.collapse",
          })}
          aria-expanded={!collapsed}
          title={intl.formatMessage({
            id: collapsed ? "game.rail.expand" : "game.rail.collapse",
          })}
          onClick={onToggleCollapsed}
        >
          {collapsed ? "‹" : "›"}
        </button>
        <div className="rail-turn">
          <strong>{intl.formatMessage({ id: "game.log.title" })}</strong>
        </div>
      </div>
      <div className="rail-actions">
        {onUndo && (
          <button
            title={intl.formatMessage({ id: "game.undoDescription" })}
            disabled={undoDisabled}
            onClick={(event) => undoWithoutFocus(
              event.currentTarget,
              () => onUndo("last-action"),
            )}
          >
            <ControlIcon kind="undo" />
            {intl.formatMessage({ id: "game.undo" })}
          </button>
        )}
        {onReportBug ? (
          <button
            className="rail-icon"
            aria-label={intl.formatMessage({ id: "game.bug.report" })}
            title={intl.formatMessage({ id: "game.bug.report" })}
            onClick={() => setShowBugReport(true)}
          >
            <ControlIcon kind="bug" />
          </button>
        ) : null}
        {(onConcede || onUndo || onPriorityWindowModeChange) && (
          <button
            className="rail-icon"
            aria-label={intl.formatMessage({ id: "settings.title" })}
            title={intl.formatMessage({ id: "settings.title" })}
            onClick={() => setShowSettings(true)}
          >
            <ControlIcon kind="settings" />
          </button>
        )}
        <button
          className={leaveAction === "end-game" ? "rail-exit rail-exit-danger" : "rail-exit"}
          onClick={() => {
            if (leaveAction === "end-game") setConfirmingAction("leave");
            else onLeave();
          }}
        >
          {leaveLabel}
        </button>
      </div>

      {spectating && (
        <div className="spec-pill">
          {intl.formatMessage({ id: replaying ? "game.spectating.replay" : "game.spectating.live" })}
        </div>
      )}
      {spectatorCount > 0 && (
        <div className="spec-count">
          👁 {intl.formatMessage({ id: "game.spectating.count" }, { count: spectatorCount })}
        </div>
      )}

      {!replaying && !connected && (
        <div className="toast">{intl.formatMessage({ id: "game.connection.lost" })}</div>
      )}
      {showOpponentDisconnected && (
        <div className="toast">{intl.formatMessage({ id: "game.connection.opponentLost" })}</div>
      )}
      {error && <div className="toast">{error}</div>}
      {winnerText && <div className="winner">{winnerText}</div>}
      {onShowGameOver && (
        <div className="rail-actions">
          <button onClick={onShowGameOver}>{intl.formatMessage({ id: "game.summary" })}</button>
        </div>
      )}

      <div className="log">
        <LogLines
          lines={renderedLog}
          friendlyHeroName={friendlyHeroName}
          opponentHeroName={opponentHeroName}
          viewerSeat={viewerSeat}
          onInspectCard={onInspectCard}
        />
      </div>
      <div className="room-tag">{intl.formatMessage({ id: "game.room" }, { code: roomCode })}</div>

      {showMobileLog ? (
        <div className="overlay mobile-log-overlay" onClick={() => setShowMobileLog(false)}>
          <section className="mobile-log-sheet" onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <strong>{intl.formatMessage({ id: "game.log.title" })}</strong>
                <span>{intl.formatMessage({ id: "game.room" }, { code: roomCode })}</span>
              </div>
              <button onClick={() => setShowMobileLog(false)}>
                {intl.formatMessage({ id: "common.close" })}
              </button>
            </header>
            <div className="log">
              <LogLines
                lines={renderedLog}
                friendlyHeroName={friendlyHeroName}
                opponentHeroName={opponentHeroName}
                viewerSeat={viewerSeat}
                onInspectCard={onInspectCard}
              />
            </div>
          </section>
        </div>
      ) : null}

      {showSettings ? (
        <GameSettingsDialog
          turn={turn}
          onUndo={onUndo}
          undoDisabled={undoDisabled}
          onConcede={onConcede}
          priorityWindowMode={priorityWindowMode}
          onPriorityWindowModeChange={onPriorityWindowModeChange}
          lessGuidance={lessGuidance}
          onLessGuidanceChange={onLessGuidanceChange}
          skipPlayConfirmation={skipPlayConfirmation}
          onSkipPlayConfirmationChange={onSkipPlayConfirmationChange}
          motionPreference={motionPreference}
          onMotionPreferenceChange={onMotionPreferenceChange}
          playabilityCuePreference={playabilityCuePreference}
          onPlayabilityCuePreferenceChange={onPlayabilityCuePreferenceChange}
          soundEffectsEnabled={soundEffectsEnabled}
          onSoundEffectsEnabledChange={onSoundEffectsEnabledChange}
          soundEffectsVolume={soundEffectsVolume}
          onSoundEffectsVolumeChange={onSoundEffectsVolumeChange}
          onClose={() => setShowSettings(false)}
        />
      ) : null}

      {showBugReport && onReportBug ? (
        <BugReportDialog
          roomCode={roomCode}
          onReport={onReportBug}
          onClose={() => setShowBugReport(false)}
        />
      ) : null}

      {showUtilities ? (
        <ModalSurface
          title={intl.formatMessage({ id: "game.controls" })}
          className="game-utilities-sheet"
          onClose={() => setShowUtilities(false)}
        >
          <div className="game-utilities-actions">
            {(onConcede || onUndo || onPriorityWindowModeChange) ? (
              <button
                onClick={() => {
                  setShowUtilities(false);
                  setShowSettings(true);
                }}
              >
                {intl.formatMessage({ id: "settings.title" })}
              </button>
            ) : null}
            {onReportBug ? (
              <button
                onClick={() => {
                  setShowUtilities(false);
                  setShowBugReport(true);
                }}
              >
                {intl.formatMessage({ id: "game.bug.report" })}
              </button>
            ) : null}
            {onConcede ? (
              <button
                className="btn-danger"
                onClick={() => {
                  setShowUtilities(false);
                  setConfirmingAction("concede");
                }}
              >
                {intl.formatMessage({ id: "game.concede" })}
              </button>
            ) : null}
            <button
              className={leaveAction === "end-game" ? "btn-danger" : ""}
              onClick={() => {
                if (leaveAction === "end-game") {
                  setShowUtilities(false);
                  setConfirmingAction("leave");
                } else {
                  setShowUtilities(false);
                  onLeave();
                }
              }}
            >
              {leaveLabel}
            </button>
          </div>
        </ModalSurface>
      ) : null}

      {confirmingAction ? (
        <ModalSurface
          title={intl.formatMessage({
            id: confirmingAction === "concede" ? "game.concede.confirmTitle" : "game.end.confirmTitle",
          })}
          description={confirmingAction === "concede"
            ? intl.formatMessage({ id: "game.concede.confirmDescription" })
            : intl.formatMessage({ id: "game.end.confirmDescription" })}
          className="game-confirm-sheet"
          onClose={() => setConfirmingAction(null)}
        >
          <div className="game-confirm-actions">
            <button onClick={() => setConfirmingAction(null)}>
              {intl.formatMessage({ id: "game.keepPlaying" })}
            </button>
            <button
              className="btn-danger"
              onClick={() => {
                const action = confirmingAction;
                setConfirmingAction(null);
                setShowUtilities(false);
                if (action === "concede") onConcede?.();
                else onLeave();
              }}
            >
              {intl.formatMessage({
                id: confirmingAction === "concede" ? "game.concede.short" : "common.endGame",
              })}
            </button>
          </div>
        </ModalSurface>
      ) : null}
    </div>
  );
}
