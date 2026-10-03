import { cardData } from "@fyendal/cards/client";
import type { CardView } from "@fyendal/shared";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { CardFace, InactiveZoneCard } from "../Card.js";
import type { BoardOverlay } from "./BoardPrimitives.js";

export type ZoneSortOrder = "zone" | "pitch" | "name";

const CARD_NAME_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function cardName(card: CardView): string {
  return cardData[card.cardId]?.name ?? card.name ?? card.cardId;
}

function cardPitchOrder(card: CardView): number {
  const pitch = cardData[card.cardId]?.pitch;
  return pitch === 1 || pitch === 2 || pitch === 3 ? pitch : 4;
}

/** Keep a pile's meaningful zone order by default, while allowing every
 * shared zone viewer to group printings of the same named card together. */
export function sortZoneCards(
  cards: readonly CardView[],
  sortOrder: ZoneSortOrder,
): readonly CardView[] {
  if (sortOrder === "zone") return cards;
  return [...cards].sort((left, right) => {
    const nameOrder = CARD_NAME_COLLATOR.compare(cardName(left), cardName(right));
    const pitchOrder = cardPitchOrder(left) - cardPitchOrder(right);
    return sortOrder === "pitch"
      ? pitchOrder || nameOrder
      : nameOrder || pitchOrder;
  });
}

export function ZoneOverlay({
  overlay,
  yourSeat,
  onClose,
  onInspectCard,
}: {
  overlay: BoardOverlay;
  yourSeat: number | null;
  onClose: () => void;
  onInspectCard: (cardId: string) => void;
}) {
  const intl = useIntl();
  const [sortOrder, setSortOrder] = useState<ZoneSortOrder>("zone");
  const cards = useMemo(
    () => sortZoneCards(overlay.cards, sortOrder),
    [overlay.cards, sortOrder],
  );

  return (
    <div className="overlay zone-overlay" onClick={onClose}>
      <div
        className="overlay-panel zone-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zone-overlay-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="zone-overlay-header">
          <div className="overlay-title" id="zone-overlay-title">{overlay.title}</div>
          <button
            type="button"
            className="zone-overlay-close"
            aria-label={intl.formatMessage({ id: "common.closeNamed" }, { title: overlay.title })}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="zone-overlay-toolbar">
          <label className="zone-overlay-sort">
            <span>{intl.formatMessage({ id: "game.zone.sort.label" })}</span>
            <select
              value={sortOrder}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "zone" || value === "pitch" || value === "name") {
                  setSortOrder(value);
                }
              }}
            >
              <option value="zone">
                {intl.formatMessage({ id: "game.zone.sort.zoneOrder" })}
              </option>
              <option value="pitch">
                {intl.formatMessage({ id: "game.zone.sort.pitch" })}
              </option>
              <option value="name">
                {intl.formatMessage({ id: "game.zone.sort.cardName" })}
              </option>
            </select>
          </label>
        </div>
        <div
          className="overlay-cards"
          onClick={(event) => {
            if (!window.matchMedia("(max-width: 700px)").matches) return;
            const cardId = (event.target as HTMLElement)
              .closest<HTMLElement>("[data-cardid]")
              ?.dataset.cardid;
            if (cardId) onInspectCard(cardId);
          }}
        >
          {cards.map((card) => overlay.inactiveZone ? (
            <InactiveZoneCard
              key={card.instanceId}
              card={card}
              squareArt={false}
              showFaceDownIdentity={
                overlay.showOwnedFaceDownIdentities === true &&
                yourSeat !== null &&
                card.owner === yourSeat
              }
              revealOwnerIntimidated={yourSeat !== null && card.owner === yourSeat}
            />
          ) : <CardFace key={card.instanceId} card={card} size="zone" squareArt={false} />)}
        </div>
      </div>
    </div>
  );
}
