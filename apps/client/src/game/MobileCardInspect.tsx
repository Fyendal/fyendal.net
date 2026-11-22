import { cardData } from "@fyendal/cards/client";
import { ModalSurface } from "../components/ModalSurface.js";
import { useIntl } from "react-intl";
import { useState } from "react";
import { cardPreviewFaceIds } from "./cardPreviewFaces.js";
import { createdCardIds } from "./createdCards.js";
import { PreviewCardFace } from "./PreviewCardFace.js";
import { StandingOrderRows, type StandingOrderPanelModel } from "./StandingOrderPanel.js";

export function MobileCardInspect({
  cardId,
  owner,
  onClose,
  standingOrders,
}: {
  cardId: string | null;
  owner: number;
  onClose: () => void;
  /** The inspected card's repeating questions, when it has any. */
  standingOrders?: StandingOrderPanelModel | null;
}) {
  if (!cardId || !cardData[cardId]) return null;

  return (
    <CardInspect
      key={cardId}
      cardId={cardId}
      owner={owner}
      onClose={onClose}
      standingOrders={standingOrders ?? null}
    />
  );
}

function CardInspect({ cardId, owner, onClose, standingOrders }: {
  cardId: string;
  owner: number;
  onClose: () => void;
  standingOrders: StandingOrderPanelModel | null;
}) {
  const intl = useIntl();
  const [visibleCardId, setVisibleCardId] = useState(cardId);
  const faceIds = cardPreviewFaceIds(cardId);
  const viewingCreated = !faceIds.includes(visibleCardId);
  const otherFaceId = viewingCreated ? undefined : faceIds.find((id) => id !== visibleCardId);
  const createdIds = viewingCreated ? [] : createdCardIds(cardId);

  return (
    <ModalSurface
      title={cardData[visibleCardId]?.name ?? intl.formatMessage({ id: "game.cardDetails" })}
      nameTitle
      className="mobile-card-inspect-sheet"
      backdropClassName="mobile-card-inspect-backdrop"
      onClose={onClose}
    >
      <PreviewCardFace card={{ instanceId: -1000, cardId: visibleCardId, owner }} />
      {otherFaceId || createdIds.length > 0 || viewingCreated ? (
        <div className="mobile-card-inspect-actions">
          {otherFaceId ? (
            <button className="mobile-card-inspect-flip" type="button" onClick={() => setVisibleCardId(otherFaceId)}>
              {intl.formatMessage({ id: "game.flipCard" })}
            </button>
          ) : null}
          {createdIds.map((id) => (
            <button key={id} className="mobile-card-inspect-flip" type="button" onClick={() => setVisibleCardId(id)}>
              {intl.formatMessage({ id: "game.createdCards.view" }, { card: cardData[id]?.name ?? id })}
            </button>
          ))}
          {viewingCreated ? (
            <button className="mobile-card-inspect-flip" type="button" onClick={() => setVisibleCardId(cardId)}>
              {intl.formatMessage({ id: "game.createdCards.back" }, { card: cardData[cardId]?.name ?? cardId })}
            </button>
          ) : null}
        </div>
      ) : null}
      {standingOrders ? (
        <section
          className="standing-order-sheet"
          aria-label={intl.formatMessage(
            { id: "game.standingOrder.title" },
            { card: cardData[standingOrders.model.cardId]?.name ?? standingOrders.model.cardId },
          )}
        >
          <StandingOrderRows
            model={standingOrders.model}
            onSetOrder={standingOrders.onSetOrder}
          />
        </section>
      ) : null}
    </ModalSurface>
  );
}
