import { useMemo, useState } from "react";
import type { EmoteMessage, UndoTarget } from "@fyendal/shared";
import type { MotionPreference, PriorityWindowMode } from "../storage.js";
import {
  logTextSegments,
  parseTurnBoundaryLogLine,
  type LogTextSegment,
  type TurnBoundaryLogLine,
} from "./logCardRefs.js";
import { HeroEmote } from "./HeroEmote.js";
import { BugReportDialog, GameSettingsDialog } from "./SideRailDialogs.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { PrimaryActionButton } from "./StatusFloat.js";

interface RenderedLogLine {
  segments: readonly LogTextSegment[];
  turnBoundary: TurnBoundaryLogLine | null;
}

function LogLines({
  lines,
  friendlyHeroName,
  opponentHeroName,
  onInspectCard,
}: {
  lines: readonly RenderedLogLine[];
  friendlyHeroName: string;
  opponentHeroName: string;
  onInspectCard: (cardId: string) => void;
}) {
  return lines.map(({ segments, turnBoundary }, lineIndex) => (
    <div
      key={lineIndex}
      className={`log-line${turnBoundary ? " log-turn-divider" : ""}`}
    >
      {turnBoundary ? (
        `Turn ${turnBoundary.turn}: ${
          friendlyHeroName !== opponentHeroName && turnBoundary.heroName === friendlyHeroName
            ? "Your turn"
            : friendlyHeroName !== opponentHeroName && turnBoundary.heroName === opponentHeroName
              ? "Opponent's turn"
              : "Turn begins"
        }`
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
  onLeave,
  leaveLabel,
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
  soundEffectsEnabled,
  onSoundEffectsEnabledChange,
  soundEffectsVolume,
  onSoundEffectsVolumeChange,
  log,
  friendlyHeroName,
  opponentHeroName,
  roomCode,
  onInspectCard,
  mobilePrimaryActionLabel,
  mobilePrimaryActionDisabled = false,
  onMobilePrimaryAction,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  turn: number;
  onUndo: ((target?: UndoTarget) => void) | null;
  onLeave: () => void;
  leaveLabel: "Leave" | "End Game";
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
  soundEffectsEnabled: boolean;
  onSoundEffectsEnabledChange: (enabled: boolean) => void;
  soundEffectsVolume: number;
  onSoundEffectsVolumeChange: (volume: number) => void;
  log: string[];
  friendlyHeroName: string;
  opponentHeroName: string;
  roomCode: string | null;
  onInspectCard: (cardId: string) => void;
  mobilePrimaryActionLabel: string | null;
  mobilePrimaryActionDisabled?: boolean;
  onMobilePrimaryAction: () => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [showBugReport, setShowBugReport] = useState(false);
  const [showMobileLog, setShowMobileLog] = useState(false);
  const [showUtilities, setShowUtilities] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<"leave" | "concede" | null>(null);
  const showOpponentDisconnected = !replaying && !opponentConnected && winnerText === null;
  const renderedLog = useMemo(
    () => log.slice().reverse().map((line) => {
      const turnBoundary = parseTurnBoundaryLogLine(line);
      return {
        segments: turnBoundary ? [] : logTextSegments(line),
        turnBoundary,
      };
    }),
    [log],
  );
  return (
    <div className={`rail-right${collapsed ? " rail-collapsed" : ""}`}>
      <nav className="mobile-gamebar" aria-label="Game controls">
        <div className="mobile-gamebar-actions">
          {onUndo ? (
            <button
              aria-label="Undo last action"
              title="Undo last action"
              onClick={(event) => undoWithoutFocus(
                event.currentTarget,
                () => onUndo("last-action"),
              )}
            >
              <ControlIcon kind="undo" />
            </button>
          ) : null}
          <button aria-label="Game log" onClick={() => setShowMobileLog(true)}>Log</button>
          {mobilePrimaryActionLabel ? (
            <div className="mobile-primary-action">
              <PrimaryActionButton
                label={mobilePrimaryActionLabel}
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
          <button aria-label="More game controls" onClick={() => setShowUtilities(true)}>More</button>
        </div>
      </nav>

      <div className="mobile-game-alerts" aria-live="polite">
        {!replaying && !connected ? <div className="toast">connection lost — reconnecting…</div> : null}
        {showOpponentDisconnected ? <div className="toast">opponent disconnected — waiting…</div> : null}
        {error ? <div className="toast">{error}</div> : null}
        {winnerText ? <div className="winner">{winnerText}</div> : null}
      </div>

      <div className="rail-header">
        <button
          type="button"
          className="rail-collapse-toggle"
          aria-label={collapsed ? "Expand side rail" : "Collapse side rail"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand side rail" : "Collapse side rail"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? "‹" : "›"}
        </button>
        <div className="rail-turn">
          <strong>Game Log</strong>
        </div>
      </div>
      <div className="rail-actions">
        {onUndo && (
          <button
            title="Undo the last action (yours or your opponent's)"
            onClick={(event) => undoWithoutFocus(
              event.currentTarget,
              () => onUndo("last-action"),
            )}
          >
            <ControlIcon kind="undo" />
            Undo
          </button>
        )}
        {onReportBug ? (
          <button
            className="rail-icon"
            aria-label="Report a bug"
            title="Report a bug"
            onClick={() => setShowBugReport(true)}
          >
            <ControlIcon kind="bug" />
          </button>
        ) : null}
        {(onConcede || onUndo || onPriorityWindowModeChange) && (
          <button className="rail-icon" aria-label="Settings" title="Settings" onClick={() => setShowSettings(true)}>
            <ControlIcon kind="settings" />
          </button>
        )}
        <button
          className={leaveLabel === "End Game" ? "rail-exit rail-exit-danger" : "rail-exit"}
          onClick={() => {
            if (leaveLabel === "End Game") setConfirmingAction("leave");
            else onLeave();
          }}
        >
          {leaveLabel}
        </button>
      </div>

      {spectating && (
        <div className="spec-pill">{replaying ? "Watching replay" : "You are spectating"}</div>
      )}
      {spectatorCount > 0 && (
        <div className="spec-count">👁 {spectatorCount} spectating</div>
      )}

      {!replaying && !connected && <div className="toast">connection lost — reconnecting…</div>}
      {showOpponentDisconnected && <div className="toast">opponent disconnected — waiting…</div>}
      {error && <div className="toast">{error}</div>}
      {winnerText && <div className="winner">{winnerText}</div>}
      {onShowGameOver && (
        <div className="rail-actions">
          <button onClick={onShowGameOver}>Game summary</button>
        </div>
      )}

      <div className="log">
        <LogLines
          lines={renderedLog}
          friendlyHeroName={friendlyHeroName}
          opponentHeroName={opponentHeroName}
          onInspectCard={onInspectCard}
        />
      </div>
      <div className="room-tag">Room {roomCode}</div>

      {showMobileLog ? (
        <div className="overlay mobile-log-overlay" onClick={() => setShowMobileLog(false)}>
          <section className="mobile-log-sheet" onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <strong>Game log</strong>
                <span>Room {roomCode}</span>
              </div>
              <button onClick={() => setShowMobileLog(false)}>Close</button>
            </header>
            <div className="log">
              <LogLines
                lines={renderedLog}
                friendlyHeroName={friendlyHeroName}
                opponentHeroName={opponentHeroName}
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
          onConcede={onConcede}
          priorityWindowMode={priorityWindowMode}
          onPriorityWindowModeChange={onPriorityWindowModeChange}
          lessGuidance={lessGuidance}
          onLessGuidanceChange={onLessGuidanceChange}
          skipPlayConfirmation={skipPlayConfirmation}
          onSkipPlayConfirmationChange={onSkipPlayConfirmationChange}
          motionPreference={motionPreference}
          onMotionPreferenceChange={onMotionPreferenceChange}
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
        <ModalSurface title="Game Controls" className="game-utilities-sheet" onClose={() => setShowUtilities(false)}>
          <div className="game-utilities-actions">
            {(onConcede || onUndo || onPriorityWindowModeChange) ? (
              <button
                onClick={() => {
                  setShowUtilities(false);
                  setShowSettings(true);
                }}
              >
                Settings
              </button>
            ) : null}
            {onReportBug ? (
              <button
                onClick={() => {
                  setShowUtilities(false);
                  setShowBugReport(true);
                }}
              >
                Report a Bug
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
                Concede Game
              </button>
            ) : null}
            <button
              className={leaveLabel === "End Game" ? "btn-danger" : ""}
              onClick={() => {
                if (leaveLabel === "End Game") {
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
          title={confirmingAction === "concede" ? "Concede Game?" : "End Game?"}
          description={confirmingAction === "concede"
            ? "Conceding awards the game to your opponent."
            : "This ends the current practice game and returns to the lobby."}
          className="game-confirm-sheet"
          onClose={() => setConfirmingAction(null)}
        >
          <div className="game-confirm-actions">
            <button onClick={() => setConfirmingAction(null)}>Keep Playing</button>
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
              {confirmingAction === "concede" ? "Concede" : "End Game"}
            </button>
          </div>
        </ModalSurface>
      ) : null}
    </div>
  );
}
