import { Fragment, useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import type { UndoTarget } from "@fyendal/shared";
import { ModalSurface } from "../components/ModalSurface.js";
import { LanguagePicker } from "../i18n/LanguagePicker.js";
import type {
  CardDisplayPreference,
  MotionPreference,
  PlayabilityCuePreference,
  PriorityAlertMode,
  PriorityWindowMode,
} from "../storage.js";
import type { PlaymatId } from "../playmats.js";
import { ControlIcon } from "./gameControls.js";
import { PlaymatPicker } from "./PlaymatPicker.js";
import { SegmentedControl, SettingRow } from "./settingsControls.js";

export type SettingsTab = "gameplay" | "interface" | "playmat" | "sound" | "match";

const PREFERENCE_TABS: readonly { id: Exclude<SettingsTab, "match">; labelId: string }[] = [
  { id: "gameplay", labelId: "settings.gameplay" },
  { id: "interface", labelId: "settings.interface" },
  { id: "playmat", labelId: "settings.playmat" },
  { id: "sound", labelId: "settings.sound" },
];

interface Choice<T extends string> {
  value: T;
  labelId: string;
  descriptionId: string;
}

const PRIORITY_WINDOW_CHOICES: readonly Choice<PriorityWindowMode>[] = [
  { value: "auto-pass", labelId: "settings.priority.autoPass", descriptionId: "settings.priority.autoPassDescription" },
  { value: "always-pause", labelId: "settings.priority.alwaysPause", descriptionId: "settings.priority.alwaysPauseDescription" },
];
const CARD_DISPLAY_CHOICES: readonly Choice<CardDisplayPreference>[] = [
  { value: "square", labelId: "settings.cardDisplay.square", descriptionId: "settings.cardDisplay.squareDescription" },
  { value: "full", labelId: "settings.cardDisplay.full", descriptionId: "settings.cardDisplay.fullDescription" },
];
const PLAYABILITY_CUE_CHOICES: readonly Choice<PlayabilityCuePreference>[] = [
  { value: "glow", labelId: "settings.playableCards.glow", descriptionId: "settings.playableCards.glowDescription" },
  { value: "high-contrast", labelId: "settings.playableCards.highContrast", descriptionId: "settings.playableCards.highContrastDescription" },
];
const MOTION_CHOICES: readonly Choice<MotionPreference>[] = [
  { value: "system", labelId: "settings.motion.default", descriptionId: "settings.motion.defaultDescription" },
  { value: "full", labelId: "settings.motion.full", descriptionId: "settings.motion.fullDescription" },
  { value: "reduced", labelId: "settings.motion.reduced", descriptionId: "settings.motion.reducedDescription" },
];
const PRIORITY_ALERT_CHOICES: readonly Choice<PriorityAlertMode>[] = [
  { value: "unfocused", labelId: "settings.priorityAlert.unfocused", descriptionId: "settings.priorityAlert.unfocusedDescription" },
  { value: "always-vs-players", labelId: "settings.priorityAlert.alwaysVsPlayers", descriptionId: "settings.priorityAlert.alwaysVsPlayersDescription" },
  { value: "always", labelId: "settings.priorityAlert.always", descriptionId: "settings.priorityAlert.alwaysDescription" },
];

/** A segmented setting whose description explains the selected choice. */
function ChoiceRow<T extends string>({
  nameId: nameMessageId,
  groupLabelId,
  choices,
  value,
  onChange,
  disabled = false,
}: {
  nameId: string;
  groupLabelId: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const intl = useIntl();
  const descriptionId = useId();
  const selected = choices.find((choice) => choice.value === value) ?? choices[0]!;
  return (
    <SettingRow
      className="settings-choice-row"
      name={intl.formatMessage({ id: nameMessageId })}
      description={intl.formatMessage({ id: selected.descriptionId })}
      descriptionId={descriptionId}
      control={
        <SegmentedControl
          choices={choices}
          value={value}
          onChange={onChange}
          label={intl.formatMessage({ id: groupLabelId })}
          describedBy={descriptionId}
          disabled={disabled}
        />
      }
    />
  );
}

function ToggleRow({
  nameId: nameMessageId,
  descriptionId: descriptionMessageId,
  checked,
  onChange,
}: {
  nameId: string;
  descriptionId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const intl = useIntl();
  const nameId = useId();
  const descriptionId = useId();
  return (
    <label className="settings-row settings-toggle-row">
      <span className="settings-row-text">
        <span className="settings-row-name" id={nameId}>{intl.formatMessage({ id: nameMessageId })}</span>
        <span className="settings-row-description" id={descriptionId}>
          {intl.formatMessage({ id: descriptionMessageId })}
        </span>
      </span>
      <span className="settings-row-control toggle-switch">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          aria-labelledby={nameId}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="switch-track" aria-hidden="true" />
      </span>
    </label>
  );
}

export function GameSettingsDialog({
  turn,
  onUndo,
  undoDisabled = false,
  onConcede,
  drawOfferSeat,
  drawSeat = 0,
  onDrawIntent = null,
  priorityWindowMode,
  onPriorityWindowModeChange,
  lessGuidance,
  onLessGuidanceChange,
  skipPlayConfirmation,
  onSkipPlayConfirmationChange,
  warnLethalPass,
  onWarnLethalPassChange,
  optionHotkeys,
  onOptionHotkeysChange,
  skipBotDelay = false,
  onSkipBotDelayChange = null,
  showGameClock,
  onShowGameClockChange,
  cardDisplayPreference,
  onCardDisplayPreferenceChange,
  playmat,
  onPlaymatChange,
  botPlaymat,
  onBotPlaymatChange,
  motionPreference,
  onMotionPreferenceChange,
  playabilityCuePreference,
  onPlayabilityCuePreferenceChange,
  soundEffectsEnabled,
  onSoundEffectsEnabledChange,
  soundEffectsVolume,
  onSoundEffectsVolumeChange,
  priorityAlertMode,
  onPriorityAlertModeChange,
  initialTab = "gameplay",
  onClose,
}: {
  turn: number;
  onUndo: ((target?: UndoTarget) => void) | null;
  undoDisabled?: boolean;
  onConcede: (() => void) | null;
  drawOfferSeat?: number;
  drawSeat?: number;
  onDrawIntent?: ((kind: "offer-draw" | "accept-draw" | "decline-draw" | "withdraw-draw") => void) | null;
  priorityWindowMode: PriorityWindowMode;
  onPriorityWindowModeChange: ((mode: PriorityWindowMode) => void) | null;
  lessGuidance: boolean;
  onLessGuidanceChange: (enabled: boolean) => void;
  skipPlayConfirmation: boolean;
  onSkipPlayConfirmationChange: (enabled: boolean) => void;
  warnLethalPass: boolean;
  onWarnLethalPassChange: (enabled: boolean) => void;
  optionHotkeys: boolean;
  onOptionHotkeysChange: (enabled: boolean) => void;
  skipBotDelay?: boolean;
  onSkipBotDelayChange?: ((enabled: boolean) => void) | null;
  showGameClock: boolean;
  onShowGameClockChange: (enabled: boolean) => void;
  cardDisplayPreference: CardDisplayPreference;
  onCardDisplayPreferenceChange: (preference: CardDisplayPreference) => void;
  playmat: PlaymatId;
  onPlaymatChange: (playmat: PlaymatId) => void;
  botPlaymat: PlaymatId;
  onBotPlaymatChange: (playmat: PlaymatId) => void;
  motionPreference: MotionPreference;
  onMotionPreferenceChange: (preference: MotionPreference) => void;
  playabilityCuePreference: PlayabilityCuePreference;
  onPlayabilityCuePreferenceChange: (preference: PlayabilityCuePreference) => void;
  soundEffectsEnabled: boolean;
  onSoundEffectsEnabledChange: (enabled: boolean) => void;
  soundEffectsVolume: number;
  onSoundEffectsVolumeChange: (volume: number) => void;
  priorityAlertMode: PriorityAlertMode;
  onPriorityAlertModeChange: (mode: PriorityAlertMode) => void;
  initialTab?: SettingsTab;
  onClose: () => void;
}) {
  const intl = useIntl();
  const hasMatchActions = Boolean(onUndo || onDrawIntent || onConcede);
  const tabs: readonly { id: SettingsTab; labelId: string }[] = hasMatchActions
    ? [...PREFERENCE_TABS, { id: "match", labelId: "settings.match" }]
    : PREFERENCE_TABS;
  const [tab, setTab] = useState<SettingsTab>(() =>
    tabs.some((candidate) => candidate.id === initialTab) ? initialTab : "gameplay",
  );
  const [confirmConcede, setConfirmConcede] = useState(false);
  const [confirmUndoTarget, setConfirmUndoTarget] = useState<UndoTarget | null>(null);
  const idBase = useId();
  const tabId = (id: SettingsTab) => `${idBase}-tab-${id}`;
  const paneId = `${idBase}-pane`;
  const title = intl.formatMessage({ id: "settings.title" });

  const onTabKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = tabs.findIndex((candidate) => candidate.id === tab);
    const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length]
      : event.key === "ArrowUp" || event.key === "ArrowLeft" ? tabs[(index - 1 + tabs.length) % tabs.length]
        : event.key === "Home" ? tabs[0]
          : event.key === "End" ? tabs.at(-1)
            : undefined;
    if (!next) return;
    event.preventDefault();
    setTab(next.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(next.id))}`)?.focus();
  };

  const finish = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <ModalSurface
      title={title}
      className="settings-surface"
      backdropClassName="settings-backdrop"
      onClose={onClose}
    >
      <div className="settings-body">
        <nav className="settings-nav" role="tablist" aria-label={title} onKeyDown={onTabKeyDown}>
          {tabs.map((candidate) => (
            <Fragment key={candidate.id}>
              {candidate.id === "match" ? <span className="settings-nav-divider" role="separator" /> : null}
              <button
                type="button"
                role="tab"
                id={tabId(candidate.id)}
                className={`settings-nav-item${tab === candidate.id ? " settings-nav-selected" : ""}`}
                aria-selected={tab === candidate.id}
                aria-controls={paneId}
                tabIndex={tab === candidate.id ? 0 : -1}
                data-modal-initial-focus={tab === candidate.id ? "" : undefined}
                onClick={() => setTab(candidate.id)}
              >
                {intl.formatMessage({ id: candidate.labelId })}
              </button>
            </Fragment>
          ))}
        </nav>
        <section
          className="settings-pane"
          role="tabpanel"
          id={paneId}
          aria-labelledby={tabId(tab)}
        >
          <h3 className="settings-pane-title">
            {intl.formatMessage({ id: tabs.find((candidate) => candidate.id === tab)!.labelId })}
          </h3>

          {tab === "gameplay" ? (
            <div className="settings-rows">
              {onPriorityWindowModeChange ? (
                <ChoiceRow
                  nameId="settings.priority"
                  groupLabelId="settings.priority.behavior"
                  choices={PRIORITY_WINDOW_CHOICES}
                  value={priorityWindowMode}
                  onChange={onPriorityWindowModeChange}
                />
              ) : null}
              <ToggleRow
                nameId="settings.confirmActions"
                descriptionId="settings.confirmActions.description"
                checked={!skipPlayConfirmation}
                onChange={(checked) => onSkipPlayConfirmationChange(!checked)}
              />
              <ToggleRow
                nameId="settings.warnLethalPass"
                descriptionId="settings.warnLethalPass.description"
                checked={warnLethalPass}
                onChange={onWarnLethalPassChange}
              />
              <ToggleRow
                nameId="settings.showGuidance"
                descriptionId="settings.showGuidance.description"
                checked={!lessGuidance}
                onChange={(checked) => onLessGuidanceChange(!checked)}
              />
              <ToggleRow
                nameId="settings.optionHotkeys"
                descriptionId="settings.optionHotkeys.description"
                checked={optionHotkeys}
                onChange={onOptionHotkeysChange}
              />
              {onSkipBotDelayChange ? (
                <ToggleRow
                  nameId="settings.skipBotDelay"
                  descriptionId="settings.skipBotDelay.description"
                  checked={skipBotDelay}
                  onChange={onSkipBotDelayChange}
                />
              ) : null}
            </div>
          ) : tab === "interface" ? (
            <div className="settings-rows">
              <LanguagePicker placement="settings" />
              <ChoiceRow
                nameId="settings.cardDisplay"
                groupLabelId="settings.cardDisplay"
                choices={CARD_DISPLAY_CHOICES}
                value={cardDisplayPreference}
                onChange={onCardDisplayPreferenceChange}
              />
              <ChoiceRow
                nameId="settings.playableCards"
                groupLabelId="settings.playableCards.cue"
                choices={PLAYABILITY_CUE_CHOICES}
                value={playabilityCuePreference}
                onChange={onPlayabilityCuePreferenceChange}
              />
              <ChoiceRow
                nameId="settings.animations"
                groupLabelId="settings.animations.preference"
                choices={MOTION_CHOICES}
                value={motionPreference}
                onChange={onMotionPreferenceChange}
              />
              <ToggleRow
                nameId="settings.showGameClock"
                descriptionId="settings.showGameClock.description"
                checked={showGameClock}
                onChange={onShowGameClockChange}
              />
            </div>
          ) : tab === "playmat" ? (
            <PlaymatPicker
              playmat={playmat}
              onPlaymatChange={onPlaymatChange}
              botPlaymat={botPlaymat}
              onBotPlaymatChange={onBotPlaymatChange}
              labelledBy={tabId("playmat")}
            />
          ) : tab === "sound" ? (
            <div className="settings-rows">
              <ToggleRow
                nameId="settings.soundEffects"
                descriptionId="settings.soundEffects.description"
                checked={soundEffectsEnabled}
                onChange={onSoundEffectsEnabledChange}
              />
              <SettingRow
                className={`settings-volume-row${soundEffectsEnabled ? "" : " settings-row-disabled"}`}
                name={intl.formatMessage({ id: "settings.volume" })}
                control={
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
                }
              />
              <ChoiceRow
                nameId="settings.priorityAlert"
                groupLabelId="settings.priorityAlert"
                choices={PRIORITY_ALERT_CHOICES}
                value={priorityAlertMode}
                onChange={onPriorityAlertModeChange}
                disabled={!soundEffectsEnabled}
              />
            </div>
          ) : (
            <div className="settings-groups">
              {onUndo ? (
                <section className="settings-group">
                  <h4 className="settings-group-title">{intl.formatMessage({ id: "settings.undo" })}</h4>
                  <div className="settings-action-list">
                    <button type="button" disabled={undoDisabled} onClick={() => finish(() => onUndo("last-action"))}>
                      <ControlIcon kind="undo" />
                      {intl.formatMessage({ id: "settings.history.undoLast" })}
                    </button>
                    <button type="button" disabled={undoDisabled} onClick={() => setConfirmUndoTarget("current-turn")}>
                      <ControlIcon kind="undo" />
                      {intl.formatMessage({ id: "settings.history.turnStart" }, { turn })}
                    </button>
                    <button
                      type="button"
                      disabled={undoDisabled || turn <= 1}
                      onClick={() => setConfirmUndoTarget("previous-turn")}
                    >
                      <ControlIcon kind="undo" />
                      {turn > 1
                        ? intl.formatMessage({ id: "settings.history.turnStart" }, { turn: turn - 1 })
                        : intl.formatMessage({ id: "settings.history.previousTurnStart" })}
                    </button>
                  </div>
                  {confirmUndoTarget ? (
                    <div className="settings-confirm" role="alert">
                      <span>
                        {intl.formatMessage(
                          { id: "settings.history.restoreConfirm" },
                          { turn: confirmUndoTarget === "current-turn" ? turn : turn - 1 },
                        )}
                      </span>
                      <div className="settings-confirm-actions">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={undoDisabled}
                          onClick={() => finish(() => onUndo(confirmUndoTarget))}
                        >
                          {intl.formatMessage({ id: "settings.history.restore" })}
                        </button>
                        <button type="button" onClick={() => setConfirmUndoTarget(null)}>
                          {intl.formatMessage({ id: "common.cancel" })}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
              {onDrawIntent ? (
                <section className="settings-group">
                  <h4 className="settings-group-title">{intl.formatMessage({ id: "settings.draw.title" })}</h4>
                  {drawOfferSeat === undefined ? (
                    <div className="settings-group-actions">
                      <button type="button" onClick={() => finish(() => onDrawIntent("offer-draw"))}>
                        {intl.formatMessage({ id: "settings.draw.offer" })}
                      </button>
                    </div>
                  ) : drawOfferSeat === drawSeat ? (
                    <div className="settings-confirm" role="status">
                      <span>{intl.formatMessage({ id: "settings.draw.waiting" })}</span>
                      <div className="settings-confirm-actions">
                        <button type="button" onClick={() => finish(() => onDrawIntent("withdraw-draw"))}>
                          {intl.formatMessage({ id: "settings.draw.withdraw" })}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="settings-confirm" role="status">
                      <span>{intl.formatMessage({ id: "settings.draw.received" })}</span>
                      <div className="settings-confirm-actions">
                        <button type="button" className="btn-primary" onClick={() => finish(() => onDrawIntent("accept-draw"))}>
                          {intl.formatMessage({ id: "settings.draw.accept" })}
                        </button>
                        <button type="button" onClick={() => finish(() => onDrawIntent("decline-draw"))}>
                          {intl.formatMessage({ id: "settings.draw.decline" })}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              ) : null}
              {onConcede ? (
                <section className="settings-group settings-group-danger">
                  <h4 className="settings-group-title">{intl.formatMessage({ id: "settings.concede.title" })}</h4>
                  <p className="settings-group-note">{intl.formatMessage({ id: "settings.concede.description" })}</p>
                  {confirmConcede ? (
                    <div className="settings-confirm" role="alert">
                      <span>{intl.formatMessage({ id: "settings.concede.confirm" })}</span>
                      <div className="settings-confirm-actions">
                        <button type="button" className="btn-primary" onClick={() => finish(onConcede)}>
                          {intl.formatMessage({ id: "settings.concede.yes" })}
                        </button>
                        <button type="button" onClick={() => setConfirmConcede(false)}>
                          {intl.formatMessage({ id: "common.cancel" })}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="settings-group-actions">
                      <button type="button" className="settings-danger-button" onClick={() => setConfirmConcede(true)}>
                        {intl.formatMessage({ id: "settings.concede.action" })}
                      </button>
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </ModalSurface>
  );
}
