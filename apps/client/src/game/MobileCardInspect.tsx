import { cardData } from "@fyendal/cards/client";
import { CardFace } from "./Card.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { useIntl } from "react-intl";
import { useState } from "react";
import { cardPreviewFaceIds } from "./cardPreviewFaces.js";

export function MobileCardInspect({
  cardId,
  owner,
  onClose,
}: {
  cardId: string | null;
  owner: number;
  onClose: () => void;
}) {
  if (!cardId || !cardData[cardId]) return null;

  return <CardInspect key={cardId} cardId={cardId} owner={owner} onClose={onClose} />;
}

function CardInspect({ cardId, owner, onClose }: {
  cardId: string;
  owner: number;
  onClose: () => void;
}) {
  const intl = useIntl();
  const [visibleCardId, setVisibleCardId] = useState(cardId);
  const otherFaceId = cardPreviewFaceIds(cardId).find((id) => id !== visibleCardId);

  return (
    <ModalSurface
      title={cardData[visibleCardId]?.name ?? intl.formatMessage({ id: "game.cardDetails" })}
      className="mobile-card-inspect-sheet"
      onClose={onClose}
    >
      {otherFaceId ? (
        <button type="button" onClick={() => setVisibleCardId(otherFaceId)}>
          {intl.formatMessage({ id: "game.flipCard" })}
        </button>
      ) : null}
      <CardFace card={{ instanceId: -1000, cardId: visibleCardId, owner }} size="preview" />
    </ModalSurface>
  );
}
