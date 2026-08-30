import { cardData } from "@fyendal/cards/client";
import { CardFace } from "./Card.js";
import { ModalSurface } from "../components/ModalSurface.js";

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

  return (
    <ModalSurface
      title={cardData[cardId]?.name ?? "Card Details"}
      className="mobile-card-inspect-sheet"
      onClose={onClose}
    >
      <CardFace card={{ instanceId: -1000, cardId, owner }} size="preview" />
    </ModalSurface>
  );
}
