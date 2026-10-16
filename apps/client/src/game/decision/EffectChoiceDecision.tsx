import { useIntl } from "react-intl";
import { cardData } from "@fyendal/cards/client";
import type { CardView, GameMessage } from "@fyendal/shared";
import { CardFace } from "../Card.js";
import { CardRef, cardAffiliation, cardDisplayName } from "./DecisionShared.js";
import { formatGameMessage } from "../../i18n/GameMessage.js";

/** Single-pick replacement-effect choice laid out like trigger ordering: one
 * row per source card with the effect it applies, and any card-less option
 * (declining every optional effect) in the button row beneath. */
export function EffectChoiceDecision({
  options,
  labels,
  messages = [],
  cards,
  viewerSeat,
  onChoose,
}: {
  options: string[];
  labels: string[];
  messages?: Array<GameMessage | null>;
  cards: Array<CardView | null>;
  viewerSeat: number;
  onChoose: (optionId: string) => void;
}) {
  const intl = useIntl();
  const labelFor = (index: number, card: CardView | null) => {
    const message = messages[index] ?? null;
    return message
      ? formatGameMessage(intl, message, {
          card: (cardId) => card?.cardId === cardId
            ? (card.name ?? cardId)
            : (cardData[cardId]?.name ?? cardId),
        })
      : (labels[index] ?? options[index] ?? "");
  };
  const rows = options.flatMap((optionId, index) => {
    const card = cards[index];
    return card ? [{ optionId, card, label: labelFor(index, card) }] : [];
  });
  const literals = options.flatMap((optionId, index) =>
    cards[index] ? [] : [{ optionId, label: labelFor(index, null) }]);

  return (
    <>
      <span className="decision-context" id="effect-choice-help">
        {intl.formatMessage({ id: "game.decision.effectChoice.instructions" })}
      </span>
      <div
        className="trigger-order-list"
        role="list"
        aria-describedby="effect-choice-help"
      >
        {rows.map(({ optionId, card, label }) => (
          <div className="trigger-order-item effect-choice-item" role="listitem" key={optionId}>
            <CardFace
              card={card}
              size="zone"
              squareArt={false}
              affiliation={cardAffiliation(card, viewerSeat)}
            />
            <span className="trigger-order-label">
              <strong><CardRef id={card.cardId} name={card.name} /></strong>
              <span>{label}</span>
            </span>
            <span className="trigger-order-controls">
              <button
                aria-label={intl.formatMessage(
                  { id: "game.decision.effectChoice.applyNamed" },
                  { source: cardDisplayName(card), label },
                )}
                onClick={() => onChoose(optionId)}
                type="button"
              >
                {intl.formatMessage({ id: "game.decision.effectChoice.apply" })}
              </button>
            </span>
          </div>
        ))}
      </div>
      {literals.length > 0 ? (
        <div className="decision-buttons">
          {literals.map(({ optionId, label }) => (
            <button key={optionId} onClick={() => onChoose(optionId)} type="button">
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
