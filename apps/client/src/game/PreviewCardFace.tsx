import type { CardView } from "@fyendal/shared";
import { CardFace } from "./Card.js";
import { isSidewaysCard } from "./cardPreviewFaces.js";

/** A full-size card preview, turned upright when the card prints sideways. */
export function PreviewCardFace({ card, showOverlays }: { card: CardView; showOverlays?: boolean }) {
  const face = <CardFace card={card} size="preview" showOverlays={showOverlays} />;
  if (!isSidewaysCard(card.cardId)) return face;
  return (
    <div className="card-preview-sideways">
      <div className="card-preview-sideways-face">{face}</div>
    </div>
  );
}
