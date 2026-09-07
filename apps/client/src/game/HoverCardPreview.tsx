import {
  CARD_PREVIEW_HEIGHT,
  CARD_PREVIEW_WIDTH,
  CardFace,
} from "./Card.js";
import {
  cardPreviewFaceIds,
  cardPreviewSurfaceSize,
} from "./cardPreviewFaces.js";
import type { HoverSurfaceLayout } from "./hoverSurfaceLayout.js";

export interface BoardPreview {
  id: string | null;
  x: number;
  y: number;
  size?: { width: number; height: number };
  effectTooltip?: { label: string; position: HoverSurfaceLayout["tooltip"] };
}

export function HoverCardPreview({
  preview,
  owner,
}: {
  preview: BoardPreview;
  owner: number;
}) {
  if (!preview.id) return null;
  const faceIds = cardPreviewFaceIds(preview.id);
  if (faceIds.length === 0) return null;
  const faceSize = preview.size ?? {
    width: CARD_PREVIEW_WIDTH,
    height: CARD_PREVIEW_HEIGHT,
  };
  const surfaceSize = cardPreviewSurfaceSize(preview.id, faceSize);
  return (
    <div
      className={`card-preview${faceIds.length > 1 ? " card-preview-double-sided" : ""}`}
      style={{
        left: preview.x,
        top: preview.y,
        width: surfaceSize.width,
        height: surfaceSize.height,
      }}
    >
      {faceIds.map((cardId, index) => (
        <div
          className="card-preview-face"
          key={cardId}
          style={{ width: faceSize.width, height: faceSize.height }}
        >
          <CardFace
            card={{ instanceId: -999 - index, cardId, owner }}
            size="preview"
          />
        </div>
      ))}
    </div>
  );
}
