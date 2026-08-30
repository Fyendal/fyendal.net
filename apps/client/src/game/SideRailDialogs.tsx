import { useCallback, useEffect, useState } from "react";
import type { UndoTarget } from "@fyendal/shared";
import type { MotionPreference, PriorityWindowMode } from "../storage.js";

const MOTION_PREFERENCES: readonly MotionPreference[] = ["system", "full", "reduced"];
const MOTION_PREFERENCE_LABEL: Readonly<Record<MotionPreference, string>> = {
  system: "Default",
  full: "Full",
  reduced: "Reduced",
};
const MOTION_PREFERENCE_DESCRIPTION: Readonly<Record<MotionPreference, string>> = {
  system: "Default: follow your operating system's reduced-motion setting",
  full: "Full: show card travel and connection animations",
  reduced: "Reduced: replace card travel with brief destination highlights",
};

export function GameSettingsDialog({
  turn,
  onUndo,
  onConcede,
  priorityWindowMode,
  onPriorityWindowModeChange,
  lessGuidance,
  onLessGuidanceChange,
  skipPlayConfirmation,
  onSkipPlayConfirmationChange,
  motionPreference,
  onMotionPreferenceChange,
  onClose,
}: {
  turn: number;
  onUndo: ((target?: UndoTarget) => void) | null;
  onConcede: (() => void) | null;
  priorityWindowMode: PriorityWindowMode;
  onPriorityWindowModeChange: ((mode: PriorityWindowMode) => void) | null;
  lessGuidance: boolean;
  onLessGuidanceChange: (enabled: boolean) => void;
  skipPlayConfirmation: boolean;
  onSkipPlayConfirmationChange: (enabled: boolean) => void;
  motionPreference: MotionPreference;
  onMotionPreferenceChange: (preference: MotionPreference) => void;
  onClose: () => void;
}) {
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
    <div className="overlay" onClick={close}>
      <div
        className="overlay-panel settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2 className="overlay-title" id="settings-title">Settings</h2>
          <button type="button" className="settings-close" aria-label="Close settings" onClick={close}>
            ×
          </button>
        </header>
        <section className="settings-section">
          <h3 className="settings-heading">Game behavior</h3>
          <div className="settings-control-list">
            {onPriorityWindowModeChange ? (
              <div className="settings-control-row settings-priority-row">
                <span className="settings-control-name">Priority</span>
                <div className="settings-segmented" role="group" aria-label="Priority behavior">
                  <button
                    type="button"
                    className={priorityWindowMode === "auto-pass" ? "settings-selected" : ""}
                    aria-pressed={priorityWindowMode === "auto-pass"}
                    aria-label="Auto-pass: immediately pass priority when no instant, reaction, or board ability can be played"
                    onClick={() => onPriorityWindowModeChange("auto-pass")}
                  >
                    Auto-pass
                  </button>
                  <button
                    type="button"
                    className={priorityWindowMode === "always-pause" ? "settings-selected" : ""}
                    aria-pressed={priorityWindowMode === "always-pause"}
                    onClick={() => onPriorityWindowModeChange("always-pause")}
                  >
                    Always pause
                  </button>
                </div>
              </div>
            ) : null}
            <label className="toggle-switch settings-control-row">
              <span className="settings-control-name">
                Confirm actions
                <span
                  className="settings-info-tooltip"
                  data-tooltip="Requires confirmation when playing cards or activating abilities."
                  aria-hidden="true"
                >
                  i
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Confirm actions when playing cards or activating abilities"
                checked={!skipPlayConfirmation}
                onChange={(event) => onSkipPlayConfirmationChange(!event.target.checked)}
              />
              <span className="switch-track" aria-hidden="true" />
            </label>
            <div className="settings-control-row settings-motion-row">
              <span className="settings-control-name">
                Animations
                <span
                  className="settings-info-tooltip"
                  data-tooltip="Default follows your operating system's reduced-motion setting."
                  aria-hidden="true"
                >
                  i
                </span>
              </span>
              <div
                className="settings-segmented settings-motion-segmented"
                role="group"
                aria-label="Animation preference"
              >
                {MOTION_PREFERENCES.map((preference) => (
                  <button
                    key={preference}
                    type="button"
                    className={motionPreference === preference ? "settings-selected" : ""}
                    aria-pressed={motionPreference === preference}
                    aria-label={MOTION_PREFERENCE_DESCRIPTION[preference]}
                    onClick={() => onMotionPreferenceChange(preference)}
                  >
                    {MOTION_PREFERENCE_LABEL[preference]}
                  </button>
                ))}
              </div>
            </div>
            <label className="toggle-switch settings-control-row">
              <span className="settings-control-name">
                Show guidance
                <span
                  className="settings-info-tooltip"
                  data-tooltip="Shows priority-window prompts and trigger descriptions."
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
        {onUndo ? (
          <section className="settings-section">
            <h3 className="settings-heading">Game history</h3>
            <div className="settings-action-list">
              <button onClick={() => { onUndo("last-action"); close(); }}>
                <span className="settings-action-title">⤺ Undo last action</span>
              </button>
              <button onClick={() => setConfirmUndoTarget("current-turn")}>
                <span className="settings-action-title">⤺ Beginning of turn {turn}</span>
              </button>
              <button disabled={turn <= 1} onClick={() => setConfirmUndoTarget("previous-turn")}>
                <span className="settings-action-title">
                  ⤺ Beginning of {turn > 1 ? `turn ${turn - 1}` : "previous turn"}
                </span>
              </button>
            </div>
            {confirmUndoTarget ? (
              <div className="settings-confirm settings-confirm-block" role="alert">
                <span>
                  Restore the beginning of turn {confirmUndoTarget === "current-turn" ? turn : turn - 1}?
                  Later actions will be discarded.
                </span>
                <div className="settings-options">
                  <button className="btn-primary" onClick={() => { onUndo(confirmUndoTarget); close(); }}>
                    Restore turn
                  </button>
                  <button onClick={() => setConfirmUndoTarget(null)}>Cancel</button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
        {onConcede ? (
          <section className="settings-section settings-danger">
            <h3 className="settings-heading">Danger zone</h3>
            {confirmConcede ? (
              <div className="settings-confirm">
                <span>Concede the game?</span>
                <button className="btn-primary" onClick={() => { onConcede(); close(); }}>
                  Yes, concede
                </button>
                <button onClick={() => setConfirmConcede(false)}>Cancel</button>
              </div>
            ) : (
              <button className="settings-danger-button" onClick={() => setConfirmConcede(true)}>
                Concede game
              </button>
            )}
          </section>
        ) : null}
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
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<BugReportResult>(null);
  const close = () => {
    if (result?.kind !== "submitting") onClose();
  };
  const submit = async () => {
    const trimmed = description.trim();
    if (trimmed.length < 10 || trimmed.length > 2_000) {
      setResult({ kind: "error", message: "Describe the bug in 10 to 2000 characters." });
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
        <div className="overlay-title" id="bug-report-title">Report a game bug</div>
        {result?.kind === "sent" ? (
          <div className="bug-report-success" role="status">
            <strong>Report sent</strong>
            <p>
              Reference <code>{result.reportId}</code>. The room state and recent history were
              attached for diagnosis.
            </p>
            <button type="button" className="btn-primary" onClick={close}>Done</button>
          </div>
        ) : (
          <>
            <p className="muted">
              Tell us what happened and what you expected. Room {roomCode}'s current state and
              recent history will be attached securely.
            </p>
            <label className="bug-report-description">
              <span>Description</span>
              <textarea
                autoFocus
                rows={7}
                maxLength={2_000}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (result?.kind === "error") setResult(null);
                }}
                placeholder="What happened? What should have happened instead?"
              />
            </label>
            <div className="bug-report-meta">
              <span>{description.length} / 2000</span>
              {result?.kind === "error" ? (
                <span className="error" role="alert">{result.message}</span>
              ) : null}
            </div>
            <div className="bug-report-actions">
              <button type="button" onClick={close}>Cancel</button>
              <button
                type="submit"
                className="btn-primary"
                disabled={result?.kind === "submitting" || description.trim().length < 10}
              >
                {result?.kind === "submitting" ? "Sending…" : "Send report"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
