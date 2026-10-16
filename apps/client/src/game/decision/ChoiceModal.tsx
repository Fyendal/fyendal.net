import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import type { HeroTargetSide } from "../decisionPresentation.js";
import {
  choiceHotkeyLabel,
  useChoiceHotkeyAssignment,
  useChoiceHotkeys,
  useChoiceHotkeysEnabled,
} from "./choiceHotkeys.js";
import { chooseWithoutFocus } from "./DecisionShared.js";

export interface ChoiceModalOption {
  key: string;
  label: ReactNode;
  /** Plain-text label for assistive technology and the Space shortcut title.
   * Defaults to `label` when that is a string. */
  text?: string;
  /** Marks the option Space chooses. */
  spaceDefault?: boolean;
  /** Marks the option currently staged by a local announcement. */
  selected?: boolean;
  /** Viewer-relative hero this option targets, styled with the same
   * friendly/opponent affiliation as decision cards. */
  side?: HeroTargetSide;
  /** Shows the side as a tag when the label alone (a hero name) does not. */
  sideTag?: boolean;
  onChoose: () => void;
}

export interface ChoiceModalChosen {
  key: string;
  /** The picked option value, matching the `key` it had while selectable. */
  option: string;
  label: ReactNode;
}

/** One choice button, shared by the modal list and the compact payment row. */
export function ChoiceButton({
  option,
  className,
  hotkey,
  children = option.label,
}: {
  option: ChoiceModalOption;
  className?: string;
  /** Letter that chooses this option, shown as a leading keycap. */
  hotkey?: string;
  children?: ReactNode;
}) {
  const intl = useIntl();
  const text = option.text ?? (typeof option.label === "string" ? option.label : undefined);
  const keyShortcuts = [option.spaceDefault ? "Space" : "", hotkey ?? ""].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={`${className ?? ""}${option.spaceDefault ? " shortcut-button" : ""}`.trim() || undefined}
      aria-label={option.text}
      onClick={(event) => chooseWithoutFocus(event.currentTarget, option.onChoose)}
      aria-keyshortcuts={keyShortcuts || undefined}
      {...(option.spaceDefault
        ? { title: intl.formatMessage({ id: "common.shortcut.space" }, { label: text ?? "" }) }
        : {})}
    >
      {hotkey ? <kbd className="choice-hotkey" aria-hidden="true">{hotkey}</kbd> : null}
      {children}
      {option.spaceDefault ? (
        <kbd className="shortcut-key" aria-label={intl.formatMessage({ id: "common.spaceKey" })} />
      ) : null}
    </button>
  );
}

/** Shared vertical option list used by every text choice in the decision float.
 * Modes already selected in a multi-mode choice become inert, checked rows.
 * With Option hotkeys enabled, the first eight options answer Q W E R A S D F
 * in display order. While a multi-mode choice continues, each mode keeps its
 * letter and its row; without that history, picked modes lead the list. */
export function ChoiceList({
  options,
  chosen = [],
}: {
  options: readonly ChoiceModalOption[];
  chosen?: readonly ChoiceModalChosen[];
}) {
  const intl = useIntl();
  const hotkeys = useChoiceHotkeyAssignment(
    options.map((option) => option.key),
    chosen.map((entry) => entry.option),
  );
  const hotkeysEnabled = useChoiceHotkeysEnabled();
  const slots: ((() => void) | undefined)[] = [];
  for (const option of hotkeysEnabled ? options : []) {
    const slot = hotkeys.get(option.key);
    if (slot !== undefined) slots[slot] = option.onChoose;
  }
  useChoiceHotkeys(slots);
  if (options.length === 0) return null;
  type Row =
    | { kind: "chosen"; entry: ChoiceModalChosen }
    | { kind: "option"; option: ChoiceModalOption };
  const rows: Row[] = [
    ...chosen.map((entry): Row => ({ kind: "chosen", entry })),
    ...options.map((option): Row => ({ kind: "option", option })),
  ];
  const slotOf = (row: Row) =>
    hotkeys.get(row.kind === "chosen" ? row.entry.option : row.option.key) ?? Infinity;
  // Stable sort; options past the eighth keep their order at the end.
  if (chosen.length > 0 && chosen.every((entry) => hotkeys.has(entry.option))) {
    rows.sort((a, b) => slotOf(a) - slotOf(b));
  }
  return (
    <div className="decision-choice-list">
      {rows.map((row) => row.kind === "chosen" ? (
        <div key={row.entry.key} className="decision-choice-option decision-choice-chosen">
          <span className="decision-choice-check" aria-hidden="true">✓</span>
          <span className="decision-choice-label">{row.entry.label}</span>
          <span className="decision-choice-tag">
            {intl.formatMessage({ id: "game.decision.chosen" })}
          </span>
        </div>
      ) : (
        <ChoiceButton
          key={row.option.key}
          option={row.option}
          hotkey={hotkeysEnabled ? choiceHotkeyLabel(hotkeys.get(row.option.key) ?? -1) : undefined}
          className={`decision-choice-option${row.option.selected ? " decision-choice-selected" : ""}${
            row.option.side ? ` decision-choice-${row.option.side}` : ""
          }`}
        >
          <span className="decision-choice-label">{row.option.label}</span>
          {row.option.side && row.option.sideTag ? (
            <span className="decision-choice-side" aria-hidden="true">
              {intl.formatMessage({ id: `game.decision.target.${row.option.side}` })}
            </span>
          ) : null}
        </ChoiceButton>
      ))}
    </div>
  );
}

export function ChoiceCancel({ onCancel }: { onCancel: () => void }) {
  const intl = useIntl();
  return (
    <button type="button" className="decision-choice-cancel" onClick={onCancel}>
      {intl.formatMessage({ id: "common.cancel" })}
    </button>
  );
}
