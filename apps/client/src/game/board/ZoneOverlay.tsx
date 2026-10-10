import { cardData } from "@fyendal/cards/client";
import type { CardView } from "@fyendal/shared";
import { useEffect, useMemo, useRef, useState } from "react";
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

const SORT_OPTIONS: readonly { value: ZoneSortOrder; messageId: string }[] = [
  { value: "zone", messageId: "game.zone.sort.zoneOrder" },
  { value: "pitch", messageId: "game.zone.sort.pitch" },
  { value: "name", messageId: "game.zone.sort.cardName" },
];

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
  const panelRef = useRef<HTMLDivElement>(null);
  const [sortOrder, setSortOrder] = useState<ZoneSortOrder>("zone");
  const cards = useMemo(
    () => sortZoneCards(overlay.cards, sortOrder),
    [overlay.cards, sortOrder],
  );

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => previousFocus?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="overlay zone-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="overlay-panel zone-overlay-panel zone-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zone-overlay-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="zone-viewer-header">
          <div className="zone-viewer-heading">
            <h2 className="zone-viewer-title" id="zone-overlay-title">{overlay.title}</h2>
            <span className="zone-viewer-count">
              {intl.formatMessage({ id: "game.zone.cardCount" }, { count: overlay.cards.length })}
            </span>
          </div>
          {overlay.cards.length > 1 ? (
            <div
              className="zone-viewer-sort"
              role="group"
              aria-label={intl.formatMessage({ id: "game.zone.sort.label" })}
            >
              {SORT_OPTIONS.map(({ value, messageId }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={sortOrder === value}
                  onClick={() => setSortOrder(value)}
                >
                  {value === "pitch" ? (
                    <span className="zone-viewer-pips" aria-hidden="true">
                      <i /><i /><i />
                    </span>
                  ) : null}
                  {intl.formatMessage({ id: messageId })}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="zone-viewer-close"
            aria-label={intl.formatMessage({ id: "common.closeNamed" }, { title: overlay.title })}
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 6 18 18M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div
          className="overlay-cards zone-viewer-cards"
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
