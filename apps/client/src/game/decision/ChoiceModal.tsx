import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import type { HeroTargetSide } from "../decisionPresentation.js";
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
  label: ReactNode;
}

/** One choice button, shared by the modal list and the compact payment row. */
export function ChoiceButton({
  option,
  className,
  children = option.label,
}: {
  option: ChoiceModalOption;
  className?: string;
  children?: ReactNode;
}) {
  const intl = useIntl();
  const text = option.text ?? (typeof option.label === "string" ? option.label : undefined);
  return (
    <button
      type="button"
      className={`${className ?? ""}${option.spaceDefault ? " shortcut-button" : ""}`.trim() || undefined}
      aria-label={option.text}
      onClick={(event) => chooseWithoutFocus(event.currentTarget, option.onChoose)}
      {...(option.spaceDefault
        ? {
            title: intl.formatMessage({ id: "common.shortcut.space" }, { label: text ?? "" }),
            "aria-keyshortcuts": "Space",
          }
        : {})}
    >
      {children}
      {option.spaceDefault ? (
        <kbd className="shortcut-key" aria-label={intl.formatMessage({ id: "common.spaceKey" })} />
      ) : null}
    </button>
  );
}

/** Shared vertical option list used by every text choice in the decision float.
 * Modes already selected in a multi-mode choice lead as inert, checked rows. */
export function ChoiceList({
  options,
  chosen = [],
}: {
  options: readonly ChoiceModalOption[];
  chosen?: readonly ChoiceModalChosen[];
}) {
  const intl = useIntl();
  if (options.length === 0) return null;
  return (
    <div className="decision-choice-list">
      {chosen.map((entry) => (
        <div key={entry.key} className="decision-choice-option decision-choice-chosen">
          <span className="decision-choice-check" aria-hidden="true">✓</span>
          <span className="decision-choice-label">{entry.label}</span>
          <span className="decision-choice-tag">
            {intl.formatMessage({ id: "game.decision.chosen" })}
          </span>
        </div>
      ))}
      {options.map((option) => (
        <ChoiceButton
          key={option.key}
          option={option}
          className={`decision-choice-option${option.selected ? " decision-choice-selected" : ""}${
            option.side ? ` decision-choice-${option.side}` : ""
          }`}
        >
          <span className="decision-choice-label">{option.label}</span>
          {option.side && option.sideTag ? (
            <span className="decision-choice-side" aria-hidden="true">
              {intl.formatMessage({ id: `game.decision.target.${option.side}` })}
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
