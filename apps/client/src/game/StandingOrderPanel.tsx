import { useIntl, type IntlShape } from "react-intl";
import { cardData } from "@fyendal/cards/client";
import { formatGameMessage } from "../i18n/GameMessage.js";
import type { StandingOrderCardModel, StandingOrderRow } from "./standingOrders.js";
import type { StandingOrderBoard } from "./useStandingOrders.js";

export interface StandingOrderPanelModel {
  model: StandingOrderCardModel;
  onSetOrder: StandingOrderBoard["onSetOrder"];
}

function cardName(cardId: string): string {
  return cardData[cardId]?.name ?? cardId;
}

function rowLabel(intl: IntlShape, row: StandingOrderRow): string {
  if (row.label) return formatGameMessage(intl, row.label, { card: cardName });
  if (row.fallback) return row.fallback;
  return intl.formatMessage({
    id: row.kind === "priority-window"
      ? "game.standingOrder.priority.generic"
      : "game.standingOrder.optional.generic",
  });
}

const PRIORITY_OPTIONS = [
  ["ask", "game.standingOrder.priority.ask"],
  ["pass", "game.standingOrder.priority.pass"],
] as const;
const OPTIONAL_OPTIONS = [
  ["ask", "game.standingOrder.optional.ask"],
  ["no", "game.standingOrder.optional.deny"],
  ["yes", "game.standingOrder.optional.use"],
] as const;

/** One row per repeating question: the trigger's own wording, then a
 * segmented choice of what the client answers from now on. Shared by the
 * card badge's dialog and the phone card sheet. */
export function StandingOrderRows({ model, onSetOrder }: StandingOrderPanelModel) {
  const intl = useIntl();
  return (
    <ul className="standing-order-list">
      {model.rows.map((row) => {
        const options = row.kind === "priority-window" ? PRIORITY_OPTIONS : OPTIONAL_OPTIONS;
        const label = rowLabel(intl, row);
        return (
          <li key={row.kind} className="standing-order-row">
            <span className="standing-order-label">{label}</span>
            <div
              className={`settings-segmented standing-order-segmented${options.length === 3 ? " standing-order-segmented-3" : ""}`}
              role="group"
              aria-label={label}
            >
              {options.map(([value, id]) => (
                <button
                  key={value}
                  type="button"
                  className={row.order === value ? "settings-selected" : ""}
                  aria-pressed={row.order === value}
                  onClick={() => onSetOrder(
                    model.key,
                    row.kind === "priority-window"
                      ? { kind: "priority-window", value: value as "ask" | "pass" }
                      : { kind: "optional-trigger", value: value as "ask" | "yes" | "no" },
                  )}
                >
                  {intl.formatMessage({ id })}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
