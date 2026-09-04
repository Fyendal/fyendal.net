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
  showActivationDots = false,
  soulCount,
  soulCountLabel,
  boundCount,
  boundCountLabel,
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
  /** Show turn activation capacity for weapon abilities. */
  showActivationDots?: boolean;
  /** Hero-only soul count. Defined even at zero so the icon stays visible. */
  soulCount?: number;
  soulCountLabel?: string;
  /** Ally-only count for cards bound underneath this permanent. */
  boundCount?: number;
  boundCountLabel?: string;
}) {
  const cards = [...underCards, ...equipmentStackCards(card)];
  const step = cardStackStep(cards.length);
  const underCardCount = cards.length - 1;
  const visibleSoulCount = soulCount !== undefined && soulCount > 0 ? soulCount : null;
  const visibleBoundCount = boundCount !== undefined && boundCount > 0 ? boundCount : null;
  const explicitUnderCardIds = new Set(underCards.map((underCard) => underCard.instanceId));
  const activationGroups = showActivationDots
    ? (card.remainingAbilityActivations ?? []).flatMap((remaining, abilityIndex) =>
        remaining >= 2 ? [{ abilityIndex, remaining }] : [])
    : [];

  return (
    <div
      className={`equipment-stack${visibleBoundCount !== null ? " equipment-stack-bound" : ""}${visibleBoundCount !== null && card.tapped ? " equipment-stack-bound-tapped" : ""}`}
      data-card-stack-id={card.instanceId}
    >
      {cards.map((stackCard, index) => {
        const isTop = index === cards.length - 1;
        const depth = cards.length - index - 1;
        const isExplicitUnderCard = explicitUnderCardIds.has(stackCard.instanceId);
        return (
          <div
            className={`equipment-stack-card${visibleBoundCount !== null && isExplicitUnderCard ? " equipment-stack-card-bound" : ""}`}
            data-bound-preview-card={visibleBoundCount !== null && isExplicitUnderCard ? "true" : undefined}
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
                  : isExplicitUnderCard && underCardMotionLocation
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
      {visibleBoundCount !== null ? (
        <span
          className="pip pile-pip equipment-stack-pip bound-pip"
          role="img"
          aria-label={boundCountLabel}
          title={boundCountLabel}
        >
          <img
            className="bound-pip-icon"
            src="/icons/bound.png"
            width="24"
            height="24"
            alt=""
            aria-hidden="true"
          />
          <span className="bound-pip-count">{visibleBoundCount}</span>
        </span>
      ) : visibleSoulCount !== null ? (
        <span
          className="pip pile-pip equipment-stack-pip soul-pip"
          role="img"
          aria-label={soulCountLabel}
          title={soulCountLabel}
        >
          <img
            className="soul-pip-icon"
            src="/icons/soul.svg"
            width="24"
            height="24"
            alt=""
            aria-hidden="true"
          />
          <span className="soul-pip-count">{visibleSoulCount}</span>
        </span>
      ) : soulCount === undefined && underCardCount > 0 ? (
        <span className="pip pile-pip equipment-stack-pip">{underCardCount}</span>
      ) : null}
      {activationGroups.length > 0 ? (
        <span className="weapon-activation-indicators">
          {activationGroups.map(({ abilityIndex, remaining }) => {
            const label = `${remaining} activation${remaining === 1 ? "" : "s"} remaining`;
            return (
              <span
                className="weapon-activation-dots"
                key={abilityIndex}
                role="img"
                aria-label={label}
                title={label}
              >
                {Array.from({ length: remaining }, (_, index) => (
                  <span className="weapon-activation-dot" key={index} />
                ))}
              </span>
            );
          })}
        </span>
      ) : null}
    </div>
  );
}
