import { cardData } from "@fyendal/cards/client";
import type { CardView } from "@fyendal/shared";
import { useRef, useState } from "react";
import { type IntlShape, useIntl } from "react-intl";
import { ViewportTooltip } from "../../components/ViewportTooltip.js";
import { CardFace } from "../Card.js";
import { cardAffiliation, chooseWithoutFocus } from "./DecisionShared.js";

export interface ActionTargetChoice {
  id: number | null;
  label: string;
  card: CardView;
  /** Set when an effect already lets this player play the card from its
   *  zone; the full sentence naming that effect. */
  playPermission?: string;
}

/** Flags a target this player may already play from a public zone (such as
 *  a banished card an earlier Gate activation chose), so it is not chosen twice. */
export function targetPlayPermissionNote(intl: IntlShape, card: CardView): string | undefined {
  const sourceCardId = card.playableFromSourceCardId;
  if (sourceCardId === undefined) return undefined;
  const sourceName = sourceCardId !== card.cardId ? cardData[sourceCardId]?.name : undefined;
  return sourceName !== undefined
    ? intl.formatMessage({ id: "game.decision.targetAlreadyPlayableVia" }, { source: sourceName })
    : intl.formatMessage({ id: "game.decision.targetAlreadyPlayable" });
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
  return (
    <div className="decision-target-cards">
      {choices.map((choice) => (
        <ActionTargetCard
          key={choice.id ?? "hero"}
          choice={choice}
          viewerSeat={viewerSeat}
          selected={selectionMade && choice.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function ActionTargetCard({
  choice,
  viewerSeat,
  selected,
  onSelect,
}: {
  choice: ActionTargetChoice;
  viewerSeat: number;
  selected: boolean;
  onSelect: (id: number | null) => void;
}) {
  const intl = useIntl();
  const ref = useRef<HTMLButtonElement>(null);
  const [hinted, setHinted] = useState(false);
  return (
    <>
      <button
        ref={ref}
        className={[
          "decision-target-card",
          selected ? "decision-target-selected" : "",
          choice.playPermission !== undefined ? "decision-target-granted" : "",
        ].filter(Boolean).join(" ")}
        aria-label={intl.formatMessage(
          { id: "game.decision.targetNamed" },
          { target: choice.label },
        )}
        aria-description={choice.playPermission}
        aria-pressed={selected}
        // The face ignores the pointer so the whole button is the hit
        // target; this routes the board's hover preview to that face.
        data-bound-preview-card="true"
        onPointerEnter={() => setHinted(true)}
        onPointerLeave={() => setHinted(false)}
        onFocus={() => setHinted(true)}
        onBlur={() => setHinted(false)}
        onClick={(event) =>
          chooseWithoutFocus(event.currentTarget, () => onSelect(choice.id))}
      >
        <span className="decision-target-face">
          <CardFace
            card={choice.card}
            size="hand"
            affiliation={cardAffiliation(choice.card, viewerSeat)}
          />
          {choice.playPermission !== undefined && (
            <span className="decision-target-band" aria-hidden="true">
              {intl.formatMessage({ id: "game.decision.targetAlreadyPlayable" })}
            </span>
          )}
        </span>
        <span className="decision-target-name">{choice.label}</span>
      </button>
      {hinted && choice.playPermission !== undefined ? (
        <ViewportTooltip anchor={ref.current} content={choice.playPermission} gap={8} />
      ) : null}
    </>
  );
}
