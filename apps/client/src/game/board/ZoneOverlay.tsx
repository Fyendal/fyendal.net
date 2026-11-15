import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { ManualMoveDestination } from "@fyendal/shared";
import type { SandboxEditRefusal } from "../../store/types.js";
import { UiIcon } from "../../components/UiIcon.js";
import { CardFace, InactiveZoneCard } from "../Card.js";
import { CardSortToggle, sortCards, type CardSortOrder } from "../CardSort.js";
import type { BoardOverlay } from "./BoardPrimitives.js";
import { SandboxCardMoves, sandboxMoveRefusalMessage, type SandboxMoveZone } from "./SandboxCardMoves.js";
import { tapInspectsCards } from "./viewportQueries.js";

const ZONE_SORT_OPTIONS: readonly CardSortOrder[] = ["zone", "pitch", "name"];

/** Sandbox move actions for a pile the viewer may edit. */
export interface ZoneOverlayMoves {
  zone: Exclude<SandboxMoveZone, "deck">;
  pending: boolean;
  refusal: SandboxEditRefusal | null;
  onMove: (instanceId: number, to: ManualMoveDestination) => void;
}

export function ZoneOverlay({
  overlay,
  yourSeat,
  revealAllOwners = false,
  moves,
  onClose,
  onInspectCard,
}: {
  overlay: BoardOverlay;
  moves?: ZoneOverlayMoves;
  yourSeat: number | null;
  /** Solo: both seats are the viewer's, so every owner's face-down cards are known. */
  revealAllOwners?: boolean;
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
            if (!tapInspectsCards()) return;
            const cardId = (event.target as HTMLElement)
              .closest<HTMLElement>("[data-cardid]")
              ?.dataset.cardid;
            if (cardId) onInspectCard(cardId);
          }}
        >
          {cards.map((card) => {
            const face = overlay.inactiveZone ? (
            <InactiveZoneCard
              key={card.instanceId}
              card={card}
              squareArt={false}
              showFaceDownIdentity={
                overlay.showOwnedFaceDownIdentities === true &&
                (revealAllOwners || (yourSeat !== null && card.owner === yourSeat))
              }
              revealOwnerIntimidated={revealAllOwners || (yourSeat !== null && card.owner === yourSeat)}
              highlighted={overlay.usableIds?.has(card.instanceId) === true}
            />
          ) : <CardFace key={card.instanceId} card={card} size="zone" squareArt={false} />;
            return moves ? (
              <div key={card.instanceId} className="zone-viewer-slot">
                {face}
                <SandboxCardMoves
                  zone={moves.zone}
                  card={card}
                  pending={moves.pending}
                  onMove={(to) => moves.onMove(card.instanceId, to)}
                />
              </div>
            ) : face;
          })}
          {moves && cards.length === 0 ? (
            <p className="deck-order-empty">{intl.formatMessage({ id: "game.sandbox.move.empty" })}</p>
          ) : null}
        </div>
        {moves ? (
          <div className="deck-order-footer">
            {moves.refusal
              ? <p className="deck-order-status deck-order-refusal" role="alert">
                  {intl.formatMessage({ id: sandboxMoveRefusalMessage(moves.refusal) })}
                </p>
              : <p className="deck-order-status">{intl.formatMessage({ id: "game.sandbox.move.instructions" })}</p>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
