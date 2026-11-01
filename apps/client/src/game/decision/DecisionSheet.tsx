import { createContext, useContext } from "react";
import { useIntl } from "react-intl";
import { UiIcon } from "../../components/UiIcon.js";

/** Lets a phone choice sheet hide itself so the board shows; the float owns
 * the state so a new decision always opens expanded. */
export const DecisionSheetMinimize = createContext<(() => void) | null>(null);

/** Header control on choice sheets; CSS shows it only on phone layouts. */
export function DecisionSheetMinimizeButton() {
  const intl = useIntl();
  const onMinimize = useContext(DecisionSheetMinimize);
  if (!onMinimize) return null;
  const label = intl.formatMessage({ id: "game.decision.sheet.hide" });
  return (
    <button
      type="button"
      className="decision-sheet-minimize"
      aria-label={label}
      title={label}
      onClick={onMinimize}
    >
      <UiIcon name="chevron-down" />
    </button>
  );
}

export function DecisionSheetRestore({ onRestore }: { onRestore: () => void }) {
  const intl = useIntl();
  return (
    <button type="button" className="decision-sheet-restore" onClick={onRestore}>
      <UiIcon name="chevron-up" />
      {intl.formatMessage({ id: "game.decision.sheet.show" })}
    </button>
  );
}
