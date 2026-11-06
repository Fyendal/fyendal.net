import { useIntl } from "react-intl";
import type { CreatedCardsPlacement } from "./createdCards.js";
import { PreviewCardFace } from "./PreviewCardFace.js";

/** The cards a previewed card creates, docked on the side away from the hovered card. */
export function CreatedCardsPanel({
  created,
  owner,
}: {
  created: CreatedCardsPlacement;
  owner: number;
}) {
  const intl = useIntl();
  const { ids, layout, side } = created;
  return (
    <section
      className={`created-cards-panel is-${side}`}
      style={{ width: layout.width, height: layout.height }}
    >
      <h3 className="created-cards-title">
        {intl.formatMessage({ id: "game.createdCards.title" })}
      </h3>
      <div
        className="created-cards-grid"
        style={{ gridTemplateColumns: `repeat(${layout.columns}, ${layout.cardWidth}px)` }}
      >
        {ids.map((cardId, index) => (
          <div key={cardId} style={{ width: layout.cardWidth, height: layout.cardHeight }}>
            <PreviewCardFace card={{ instanceId: -1100 - index, cardId, owner }} />
          </div>
        ))}
      </div>
    </section>
  );
}
