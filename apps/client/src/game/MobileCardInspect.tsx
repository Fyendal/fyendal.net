import { cardData } from "@fyendal/cards/client";
import { CardFace } from "./Card.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { useIntl } from "react-intl";
import { useState } from "react";
import { cardPreviewFaceIds } from "./cardPreviewFaces.js";
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
  const otherFaceId = cardPreviewFaceIds(cardId).find((id) => id !== visibleCardId);

  return (
    <ModalSurface
      title={cardData[visibleCardId]?.name ?? intl.formatMessage({ id: "game.cardDetails" })}
      nameTitle
      className="mobile-card-inspect-sheet"
      onClose={onClose}
    >
      {otherFaceId ? (
        <button type="button" onClick={() => setVisibleCardId(otherFaceId)}>
          {intl.formatMessage({ id: "game.flipCard" })}
        </button>
      ) : null}
      <CardFace card={{ instanceId: -1000, cardId: visibleCardId, owner }} size="preview" />
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
