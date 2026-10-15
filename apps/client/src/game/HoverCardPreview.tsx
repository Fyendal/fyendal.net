import { useLayoutEffect, useRef, useState, type Ref } from "react";
import { useIntl } from "react-intl";
import {
  CARD_PREVIEW_HEIGHT,
  CARD_PREVIEW_WIDTH,
  CardFace,
  cardImageUrl,
} from "./Card.js";
import {
  cardPreviewFaceIds,
  cardPreviewSurfaceSize,
} from "./cardPreviewFaces.js";
import { MARKED_TOKEN_ID, type CardBadge } from "./cardBadges.js";
import type { HoverSurfaceLayout } from "./hoverSurfaceLayout.js";

export interface BoardPreview {
  id: string | null;
  x: number;
  y: number;
  size?: { width: number; height: number };
  effectTooltip?: { label: string; position: HoverSurfaceLayout["tooltip"] };
  /** Statuses and counters shown on the hovered card, spelled out above it. */
  badges?: readonly CardBadge[];
}

const VIEWPORT_PADDING = 8;
const PANEL_GAP = 8;

function CardBadgePanel({
  badges,
  panelRef,
}: {
  badges: readonly CardBadge[];
  panelRef: Ref<HTMLUListElement>;
}) {
  const intl = useIntl();
  return (
    <ul
      ref={panelRef}
      className="card-badge-panel"
      aria-label={intl.formatMessage({ id: "game.card.badge.panel" })}
    >
      {badges.map((badge) => (
        <li key={badge.kind} className="card-badge-row">
          <span className={`card-badge-tile c-${badge.kind}`} aria-hidden="true">
            {badge.icon ? (
              <img className="c-ovl-icon" src={badge.icon} alt="" />
            ) : badge.placement === "token" ? (
              <img
                className="card-badge-token"
                src={cardImageUrl(MARKED_TOKEN_ID)}
                alt=""
              />
            ) : (
              <span className="card-badge-value">{badge.value}</span>
            )}
          </span>
          <span className="card-badge-text">
            <span className="card-badge-title">
              {intl.formatMessage({ id: badge.title.id }, badge.title.values)}
            </span>
            {badge.detail ? (
              <span className="card-badge-detail">
                {"text" in badge.detail
                  ? badge.detail.text
                  : intl.formatMessage({ id: badge.detail.id }, badge.detail.values)}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function HoverCardPreview({
  preview,
  owner,
}: {
  preview: BoardPreview;
  owner: number;
}) {
  const panelRef = useRef<HTMLUListElement>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const badges = preview.badges ?? [];
  useLayoutEffect(() => {
    setPanelHeight(panelRef.current?.offsetHeight ?? 0);
  }, [preview.badges, preview.size?.width]);
  if (!preview.id) return null;
  const faceIds = cardPreviewFaceIds(preview.id);
  if (faceIds.length === 0) return null;
  const faceSize = preview.size ?? {
    width: CARD_PREVIEW_WIDTH,
    height: CARD_PREVIEW_HEIGHT,
  };
  const surfaceSize = cardPreviewSurfaceSize(preview.id, faceSize);
  // The panel hangs above the card; push the card down only as far as the
  // panel needs to stay on screen.
  const top = panelHeight > 0
    ? Math.min(
        Math.max(preview.y, VIEWPORT_PADDING + panelHeight + PANEL_GAP),
        Math.max(preview.y, window.innerHeight - VIEWPORT_PADDING - surfaceSize.height),
      )
    : preview.y;
  return (
    <div
      className={`card-preview${faceIds.length > 1 ? " card-preview-double-sided" : ""}`}
      style={{
        left: preview.x,
        top,
        width: surfaceSize.width,
        height: surfaceSize.height,
      }}
    >
      {badges.length > 0 ? <CardBadgePanel badges={badges} panelRef={panelRef} /> : null}
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
