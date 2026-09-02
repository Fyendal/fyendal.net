import { cardData } from "@fyendal/cards/client";
import { CardFace } from "./Card.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { useIntl } from "react-intl";

export function MobileCardInspect({
  cardId,
  owner,
  onClose,
}: {
  cardId: string | null;
  owner: number;
  onClose: () => void;
}) {
  const intl = useIntl();
  if (!cardId || !cardData[cardId]) return null;

  return (
    <ModalSurface
      title={cardData[cardId]?.name ?? intl.formatMessage({ id: "game.cardDetails" })}
      className="mobile-card-inspect-sheet"
      onClose={onClose}
    >
      <CardFace card={{ instanceId: -1000, cardId, owner }} size="preview" />
    </ModalSurface>
  );
}
