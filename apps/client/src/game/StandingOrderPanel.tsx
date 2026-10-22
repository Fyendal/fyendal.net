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

const TIMING_MESSAGES = {
  "start-of-turn": "game.standingOrder.timing.startOfTurn",
  "begin-action-phase": "game.standingOrder.timing.actionPhase",
  "end-of-turn": "game.standingOrder.timing.endPhase",
} as const;

function rowLabel(intl: IntlShape, row: StandingOrderRow): string {
  const effect = row.label
    ? formatGameMessage(intl, row.label, { card: cardName })
    : row.fallback;
  return intl.formatMessage({ id: TIMING_MESSAGES[row.timing] }, { effect });
}

/** Shared by the card badge's dialog and the phone card sheet. */
export function StandingOrderRows({ model, onSetOrder }: StandingOrderPanelModel) {
  const intl = useIntl();
  return (
    <ul className="standing-order-list">
      {model.rows.map((row) => {
        const label = rowLabel(intl, row);
        const buttons = [
          { value: null, text: intl.formatMessage({ id: "game.standingOrder.ask" }) },
          ...row.options.map((option) => ({
            value: option.value,
            text: formatGameMessage(intl, option.message, { card: cardName }),
          })),
        ];
        return (
          <li key={row.hook} className="standing-order-row">
            <span className="standing-order-label">{label}</span>
            <div
              className={`settings-segmented standing-order-segmented${buttons.length === 3 ? " standing-order-segmented-3" : ""}`}
              role="group"
              aria-label={label}
            >
              {buttons.map(({ value, text }) => (
                <button
                  key={value ?? ""}
                  type="button"
                  className={row.order === value ? "settings-selected" : ""}
                  aria-pressed={row.order === value}
                  onClick={() => onSetOrder(model.key, { hook: row.hook, value })}
                >
                  {text}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
