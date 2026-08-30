import type { CardView } from "@fyendal/shared";
import { CardFace } from "./Card.js";
import { motionPresentationKey } from "./motion/motionTypes.js";
import { cardStackStep } from "./stackLayout.js";

/** Face-up pitch cards, oldest at the back and newest in front. */
export function PitchStack({
  cards,
  resources,
  motionSeat,
}: {
  cards: readonly CardView[];
  resources: number;
  motionSeat?: number;
}) {
  if (cards.length === 0) {
    return resources > 0
      ? <span className="pip pitch-pip pitch-pip-bare">{resources}</span>
      : null;
  }

  const step = cardStackStep(cards.length);

  return (
    <div className="pitch-stack">
      {cards.map((card, index) => {
        const depth = cards.length - index - 1;
        return (
          <div
            className="pitch-stack-card"
            key={card.instanceId}
            style={{
              transform: `translateY(-${depth * step}px)`,
              zIndex: index,
            }}
          >
            <CardFace
              card={card}
              size="zone"
              motionKey={motionSeat === undefined
                ? undefined
                : motionPresentationKey({ kind: "pitch", seat: motionSeat }, card.instanceId)}
            />
          </div>
        );
      })}
      {resources > 0 ? (
        <span className="pip pitch-pip" style={{ zIndex: cards.length }}>
          {resources}
        </span>
      ) : null}
    </div>
  );
}
