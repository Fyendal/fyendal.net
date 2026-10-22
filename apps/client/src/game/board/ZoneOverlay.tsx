import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { UiIcon } from "../../components/UiIcon.js";
import { CardFace, InactiveZoneCard } from "../Card.js";
import { CardSortToggle, sortCards, type CardSortOrder } from "../CardSort.js";
import type { BoardOverlay } from "./BoardPrimitives.js";

const ZONE_SORT_OPTIONS: readonly CardSortOrder[] = ["zone", "pitch", "name"];

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
  const [sortOrder, setSortOrder] = useState<CardSortOrder>("zone");
  const cards = useMemo(
    () => sortCards(overlay.cards, sortOrder, (card) => card),
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
            <CardSortToggle options={ZONE_SORT_OPTIONS} value={sortOrder} onChange={setSortOrder} />
          ) : null}
          <button
            type="button"
            className="zone-viewer-close"
            aria-label={intl.formatMessage({ id: "common.closeNamed" }, { title: overlay.title })}
            onClick={onClose}
          >
            <UiIcon name="close" />
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
