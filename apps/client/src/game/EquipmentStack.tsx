import type { CSSProperties } from "react";
import type { CardView } from "@fyendal/shared";
import { CardFace } from "./Card.js";
import { equipmentStackCards } from "./boardGroups.js";
import { motionPresentationKey, type MotionLocation } from "./motion/motionTypes.js";
import { cardStackStep } from "./stackLayout.js";

/** Public arena sub-cards, oldest at the back and current permanent in front. */
export function EquipmentStack({
  card,
  underCards = [],
  highlighted,
  selected,
  dimmed,
  onClick,
  motionLocation,
  underCardMotionLocation,
}: {
  card: CardView;
  /** Additional public cards rendered behind the permanent, oldest first. */
  underCards?: readonly CardView[];
  highlighted?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  motionLocation?: MotionLocation;
  underCardMotionLocation?: MotionLocation;
}) {
  const cards = [...underCards, ...equipmentStackCards(card)];
  const step = cardStackStep(cards.length);
  const underCardCount = cards.length - 1;
  const explicitUnderCardIds = new Set(underCards.map((underCard) => underCard.instanceId));

  return (
    <div className="equipment-stack" data-card-stack-id={card.instanceId}>
      {cards.map((stackCard, index) => {
        const isTop = index === cards.length - 1;
        const depth = cards.length - index - 1;
        return (
          <div
            className="equipment-stack-card"
            key={stackCard.instanceId}
            style={{
              "--equipment-stack-offset": `-${depth * step}px`,
              zIndex: index,
            } as CSSProperties}
          >
            <CardFace
              card={stackCard}
              size="zone"
              motionKey={
                isTop && motionLocation
                  ? motionPresentationKey(motionLocation, stackCard.instanceId)
                  : explicitUnderCardIds.has(stackCard.instanceId) && underCardMotionLocation
                    ? motionPresentationKey(underCardMotionLocation, stackCard.instanceId)
                    : undefined
              }
              highlighted={isTop ? highlighted : undefined}
              selected={isTop ? selected : undefined}
              dimmed={isTop ? dimmed : undefined}
              onClick={isTop ? onClick : undefined}
            />
          </div>
        );
      })}
      {underCardCount > 0 ? (
        <span className="pip pile-pip equipment-stack-pip">{underCardCount}</span>
      ) : null}
    </div>
  );
}
