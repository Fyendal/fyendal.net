import type { CardView } from "@fyendal/shared";
import { useIntl } from "react-intl";
import { CardFace } from "../Card.js";
import { cardAffiliation, chooseWithoutFocus } from "./DecisionShared.js";

export interface ActionTargetChoice {
  id: number | null;
  label: string;
  card: CardView;
  life?: number;
}

export function RevealedChoiceCards({
  cards,
  selectableIds,
  viewerSeat,
  onChoose,
}: {
  cards: CardView[];
  selectableIds: ReadonlySet<number>;
  viewerSeat: number;
  onChoose?: (instanceId: number) => void;
}) {
  return (
    <div className="decision-cards decision-revealed-cards">
      {cards.map((card) => {
        const selectable = selectableIds.has(card.instanceId);
        return (
          <CardFace
            key={card.instanceId}
            card={card}
            size="hand"
            highlighted={selectable}
            affiliation={cardAffiliation(card, viewerSeat)}
            onClick={selectable && onChoose ? () => onChoose(card.instanceId) : undefined}
          />
        );
      })}
    </div>
  );
}

export function ActionTargetCards({
  choices,
  viewerSeat,
  selectedId,
  selectionMade,
  onSelect,
}: {
  choices: ActionTargetChoice[];
  viewerSeat: number;
  selectedId: number | null;
  selectionMade: boolean;
  onSelect: (id: number | null) => void;
}) {
  const intl = useIntl();
  return (
    <div className="decision-target-cards">
      {choices.map((choice) => {
        const selected = selectionMade && choice.id === selectedId;
        return (
          <button
            key={choice.id ?? "hero"}
            className={`decision-target-card ${selected ? "decision-target-selected" : ""}`}
            aria-label={intl.formatMessage(
              { id: "game.decision.targetNamed" },
              { target: choice.label },
            )}
            aria-pressed={selected}
            onClick={(event) =>
              chooseWithoutFocus(event.currentTarget, () => onSelect(choice.id))}
          >
            <CardFace
              card={choice.card}
              size="hand"
              affiliation={cardAffiliation(choice.card, viewerSeat)}
            />
            <span>{choice.label}</span>
            {choice.life !== undefined && (
              <small>{intl.formatMessage({ id: "game.life.amount" }, { life: choice.life })}</small>
            )}
          </button>
        );
      })}
    </div>
  );
}
