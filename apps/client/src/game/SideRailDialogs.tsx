import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useIntl } from "react-intl";
import type { UndoTarget } from "@fyendal/shared";
import type {
  MotionPreference,
  PlayabilityCuePreference,
  PriorityWindowMode,
} from "../storage.js";

const MOTION_PREFERENCES: readonly MotionPreference[] = ["system", "full", "reduced"];
const MOTION_PREFERENCE_LABEL_ID: Readonly<Record<MotionPreference, string>> = {
  system: "settings.motion.default",
  full: "settings.motion.full",
  reduced: "settings.motion.reduced",
};
const MOTION_PREFERENCE_DESCRIPTION_ID: Readonly<Record<MotionPreference, string>> = {
  system: "settings.motion.defaultDescription",
  full: "settings.motion.fullDescription",
  reduced: "settings.motion.reducedDescription",
};

export function GameSettingsDialog({
  turn,
  onUndo,
  undoDisabled = false,
  onConcede,
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
  onClose,
}: {
  turn: number;
  onUndo: ((target?: UndoTarget) => void) | null;
  undoDisabled?: boolean;
  onConcede: (() => void) | null;
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
  onClose: () => void;
}) {
  const intl = useIntl();
  const [confirmConcede, setConfirmConcede] = useState(false);
  const [confirmUndoTarget, setConfirmUndoTarget] = useState<UndoTarget | null>(null);
  const close = useCallback(onClose, [onClose]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [close]);

  return (
    <div className="overlay settings-overlay" onClick={close}>
      <div
        className="overlay-panel settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2 className="overlay-title" id="settings-title">
            {intl.formatMessage({ id: "settings.title" })}
          </h2>
          <button
            type="button"
            className="settings-close"
            aria-label={intl.formatMessage({ id: "settings.close" })}
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="settings-grid">
          <section className="settings-section settings-gameplay">
            <h3 className="settings-heading">{intl.formatMessage({ id: "settings.gameplay" })}</h3>
            <div className="settings-control-list">
              {onPriorityWindowModeChange ? (
                <div className="settings-control-row settings-priority-row">
                  <span className="settings-control-name">{intl.formatMessage({ id: "settings.priority" })}</span>
                  <div
                    className="settings-segmented"
                    role="group"
                    aria-label={intl.formatMessage({ id: "settings.priority.behavior" })}
                  >
                    <button
                      type="button"
                      className={priorityWindowMode === "auto-pass" ? "settings-selected" : ""}
                      aria-pressed={priorityWindowMode === "auto-pass"}
                      aria-label={intl.formatMessage({ id: "settings.priority.autoPassDescription" })}
                      onClick={() => onPriorityWindowModeChange("auto-pass")}
                    >
                      {intl.formatMessage({ id: "settings.priority.autoPass" })}
                    </button>
                    <button
                      type="button"
                      className={priorityWindowMode === "always-pause" ? "settings-selected" : ""}
                      aria-pressed={priorityWindowMode === "always-pause"}
                      onClick={() => onPriorityWindowModeChange("always-pause")}
                    >
                      {intl.formatMessage({ id: "settings.priority.alwaysPause" })}
                    </button>
                  </div>
                </div>
              ) : null}
              <label className="toggle-switch settings-control-row">
                <span className="settings-control-name">
                  {intl.formatMessage({ id: "settings.confirmActions" })}
                  <span
                    className="settings-info-tooltip"
                    data-tooltip={intl.formatMessage({ id: "settings.confirmActions.tooltip" })}
                    aria-hidden="true"
                  >
                    i
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={intl.formatMessage({ id: "settings.confirmActions.aria" })}
                  checked={!skipPlayConfirmation}
                  onChange={(event) => onSkipPlayConfirmationChange(!event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true" />
              </label>
              <label className="toggle-switch settings-control-row">
                <span className="settings-control-name">
                  {intl.formatMessage({ id: "settings.showGuidance" })}
                  <span
                    className="settings-info-tooltip"
                    data-tooltip={intl.formatMessage({ id: "settings.showGuidance.tooltip" })}
                    aria-hidden="true"
                  >
                    i
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={!lessGuidance}
                  onChange={(event) => onLessGuidanceChange(!event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true" />
              </label>
            </div>
          </section>
          <section className="settings-section settings-presentation">
            <h3 className="settings-heading">{intl.formatMessage({ id: "settings.audioVisuals" })}</h3>
            <div className="settings-control-list">
              <div className="settings-control-row settings-motion-row">
                <span className="settings-control-name">
                  {intl.formatMessage({ id: "settings.animations" })}
                  <span
                    className="settings-info-tooltip"
                    data-tooltip={intl.formatMessage({ id: "settings.animations.tooltip" })}
                    aria-hidden="true"
                  >
                    i
                  </span>
                </span>
                <div
                  className="settings-segmented settings-motion-segmented"
                  role="group"
                  aria-label={intl.formatMessage({ id: "settings.animations.preference" })}
                >
                  {MOTION_PREFERENCES.map((preference) => (
                    <button
                      key={preference}
                      type="button"
                      className={motionPreference === preference ? "settings-selected" : ""}
                      aria-pressed={motionPreference === preference}
                      aria-label={intl.formatMessage({ id: MOTION_PREFERENCE_DESCRIPTION_ID[preference] })}
                      onClick={() => onMotionPreferenceChange(preference)}
                    >
                      {intl.formatMessage({ id: MOTION_PREFERENCE_LABEL_ID[preference] })}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-control-row settings-choice-row">
                <span className="settings-control-name">
                  {intl.formatMessage({ id: "settings.playableCards" })}
                  <span
                    className="settings-info-tooltip"
                    data-tooltip={intl.formatMessage({ id: "settings.playableCards.tooltip" })}
                    aria-hidden="true"
                  >
                    i
                  </span>
                </span>
                <div
                  className="settings-segmented"
                  role="group"
                  aria-label={intl.formatMessage({ id: "settings.playableCards.cue" })}
                >
                  <button
                    type="button"
                    className={playabilityCuePreference === "glow" ? "settings-selected" : ""}
                    aria-pressed={playabilityCuePreference === "glow"}
                    onClick={() => onPlayabilityCuePreferenceChange("glow")}
                  >
                    {intl.formatMessage({ id: "settings.playableCards.glow" })}
                  </button>
                  <button
                    type="button"
                    className={playabilityCuePreference === "high-contrast" ? "settings-selected" : ""}
                    aria-pressed={playabilityCuePreference === "high-contrast"}
                    onClick={() => onPlayabilityCuePreferenceChange("high-contrast")}
                  >
                    {intl.formatMessage({ id: "settings.playableCards.highContrast" })}
                  </button>
                </div>
              </div>
              <label className="toggle-switch settings-control-row">
                <span className="settings-control-name">
                  {intl.formatMessage({ id: "settings.soundEffects" })}
                  <span
                    className="settings-info-tooltip"
                    data-tooltip={intl.formatMessage({ id: "settings.soundEffects.tooltip" })}
                    aria-hidden="true"
                  >
                    i
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={intl.formatMessage({ id: "settings.soundEffects" })}
                  checked={soundEffectsEnabled}
                  onChange={(event) => onSoundEffectsEnabledChange(event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true" />
              </label>
              <label className="settings-control-row settings-volume-row">
                <span className="settings-control-name">{intl.formatMessage({ id: "settings.volume" })}</span>
                <span className="settings-volume-control">
                  <span
                    className="settings-volume-slider"
                    style={{ "--volume-progress": `${soundEffectsVolume}%` } as CSSProperties}
                  >
                    <input
                      id="sound-effects-volume"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={soundEffectsVolume}
                      disabled={!soundEffectsEnabled}
                      aria-label={intl.formatMessage({ id: "settings.volume.aria" })}
                      onChange={(event) => onSoundEffectsVolumeChange(Number(event.target.value))}
                    />
                  </span>
                  <output htmlFor="sound-effects-volume">{soundEffectsVolume}%</output>
                </span>
              </label>
            </div>
          </section>
          {onUndo ? (
            <section className="settings-section">
              <h3 className="settings-heading">{intl.formatMessage({ id: "settings.history" })}</h3>
              <div className="settings-action-list">
                <button disabled={undoDisabled} onClick={() => { onUndo("last-action"); close(); }}>
                  <span className="settings-action-title">
                    ⤺ {intl.formatMessage({ id: "settings.history.undoLast" })}
                  </span>
                </button>
                <button disabled={undoDisabled} onClick={() => setConfirmUndoTarget("current-turn")}>
                  <span className="settings-action-title">
                    ⤺ {intl.formatMessage({ id: "settings.history.turnStart" }, { turn })}
                  </span>
                </button>
                <button
                  disabled={undoDisabled || turn <= 1}
                  onClick={() => setConfirmUndoTarget("previous-turn")}
                >
                  <span className="settings-action-title">
                    ⤺ {turn > 1
                      ? intl.formatMessage({ id: "settings.history.turnStart" }, { turn: turn - 1 })
                      : intl.formatMessage({ id: "settings.history.previousTurnStart" })}
                  </span>
                </button>
              </div>
              {confirmUndoTarget ? (
                <div className="settings-confirm settings-confirm-block" role="alert">
                  <span>
                    {intl.formatMessage(
                      { id: "settings.history.restoreConfirm" },
                      { turn: confirmUndoTarget === "current-turn" ? turn : turn - 1 },
                    )}
                  </span>
                  <div className="settings-options">
                    <button
                      className="btn-primary"
                      disabled={undoDisabled}
                      onClick={() => { onUndo(confirmUndoTarget); close(); }}
                    >
                      {intl.formatMessage({ id: "settings.history.restore" })}
                    </button>
                    <button onClick={() => setConfirmUndoTarget(null)}>
                      {intl.formatMessage({ id: "common.cancel" })}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
          {onConcede ? (
            <section className="settings-section settings-danger">
              <h3 className="settings-heading">{intl.formatMessage({ id: "settings.danger" })}</h3>
              {confirmConcede ? (
                <div className="settings-confirm">
                  <span>{intl.formatMessage({ id: "settings.concede.confirm" })}</span>
                  <button className="btn-primary" onClick={() => { onConcede(); close(); }}>
                    {intl.formatMessage({ id: "settings.concede.yes" })}
                  </button>
                  <button onClick={() => setConfirmConcede(false)}>
                    {intl.formatMessage({ id: "common.cancel" })}
                  </button>
                </div>
              ) : (
                <button className="settings-danger-button" onClick={() => setConfirmConcede(true)}>
                  {intl.formatMessage({ id: "settings.concede.action" })}
                </button>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type BugReportResult =
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "sent"; reportId: string }
  | null;

export function BugReportDialog({
  roomCode,
  onReport,
  onClose,
}: {
  roomCode: string | null;
  onReport: (description: string) => Promise<
    { ok: true; reportId: string } | { ok: false; error: string }
  >;
  onClose: () => void;
}) {
  const intl = useIntl();
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<BugReportResult>(null);
  const close = () => {
    if (result?.kind !== "submitting") onClose();
  };
  const submit = async () => {
    const trimmed = description.trim();
    if (trimmed.length < 10 || trimmed.length > 2_000) {
      setResult({
        kind: "error",
        message: intl.formatMessage({ id: "game.bug.validation" }),
      });
      return;
    }
    setResult({ kind: "submitting" });
    const report = await onReport(trimmed);
    setResult(report.ok
      ? { kind: "sent", reportId: report.reportId }
      : { kind: "error", message: report.error });
  };

  return (
    <div className="overlay" onClick={close}>
      <form
        className="overlay-panel bug-report-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (result?.kind !== "submitting" && result?.kind !== "sent") void submit();
        }}
      >
        <div className="overlay-title" id="bug-report-title">
          {intl.formatMessage({ id: "game.bug.dialogTitle" })}
        </div>
        {result?.kind === "sent" ? (
          <div className="bug-report-success" role="status">
            <strong>{intl.formatMessage({ id: "game.bug.sent" })}</strong>
            <p>
              {intl.formatMessage(
                { id: "game.bug.reference" },
                { reference: <code>{result.reportId}</code> },
              )}
            </p>
            <button type="button" className="btn-primary" onClick={close}>
              {intl.formatMessage({ id: "common.done" })}
            </button>
          </div>
        ) : (
          <>
            <p className="muted">
              {intl.formatMessage(
                { id: "game.bug.description" },
                { room: roomCode ?? intl.formatMessage({ id: "game.bug.currentRoom" }) },
              )}
            </p>
            <label className="bug-report-description">
              <span>{intl.formatMessage({ id: "game.bug.descriptionLabel" })}</span>
              <textarea
                autoFocus
                rows={7}
                maxLength={2_000}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (result?.kind === "error") setResult(null);
                }}
                placeholder={intl.formatMessage({ id: "game.bug.placeholder" })}
              />
            </label>
            <div className="bug-report-meta">
              <span>{description.length} / 2000</span>
              {result?.kind === "error" ? (
                <span className="error" role="alert">{result.message}</span>
              ) : null}
            </div>
            <div className="bug-report-actions">
              <button type="button" onClick={close}>{intl.formatMessage({ id: "common.cancel" })}</button>
              <button
                type="submit"
                className="btn-primary"
                disabled={result?.kind === "submitting" || description.trim().length < 10}
              >
                {intl.formatMessage({
                  id: result?.kind === "submitting" ? "game.bug.sending" : "game.bug.send",
                })}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
