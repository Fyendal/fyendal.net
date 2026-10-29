import { useLayoutEffect, useRef, useState } from "react";
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
import { EffectHintPanel } from "./effects/EffectHintPanel.js";
import type { EffectHint } from "./effects/effectHint.js";

/** Where a card-less effect hint floats beside its chip. */
export interface FloatingHintPosition {
  left: number;
  top?: number;
  bottom?: number;
  maxWidth: number;
}

export interface BoardPreview {
  id: string | null;
  x: number;
  y: number;
  size?: { width: number; height: number };
  /** A hovered effect chip, spelled out above its source preview. */
  effect?: EffectHint;
  /** Set when the effect has no source card to dock against. */
  effectPosition?: FloatingHintPosition;
  /** Statuses and counters shown on the hovered card, spelled out above it. */
  badges?: readonly CardBadge[];
}

const VIEWPORT_PADDING = 8;
const PANEL_GAP = 8;

function CardBadgePanel({ badges }: { badges: readonly CardBadge[] }) {
  const intl = useIntl();
  return (
    <ul
      className="card-badge-panel"
      aria-label={intl.formatMessage({ id: "game.card.badge.panel" })}
    >
      {badges.map((badge, index) => (
        <li key={`${badge.kind}:${index}`} className="card-badge-row">
          <span className={`card-badge-tile c-${badge.kind}`} aria-hidden="true">
            {badge.icon ? (
              <img className="c-ovl-icon" src={badge.icon} alt="" />
            ) : (
              <img
                className="card-badge-token"
                src={cardImageUrl(MARKED_TOKEN_ID)}
                alt=""
              />
            )}
          </span>
          <span className="card-badge-text">
            <span className="card-badge-title">
              {"text" in badge.title
                ? badge.title.text
                : intl.formatMessage({ id: badge.title.id }, badge.title.values)}
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const badges = preview.badges ?? [];
  useLayoutEffect(() => {
    setPanelHeight(panelRef.current?.offsetHeight ?? 0);
  }, [preview.badges, preview.effect, preview.size?.width]);
  if (!preview.id) {
    return preview.effect && preview.effectPosition ? (
      <EffectHintPanel hint={preview.effect} style={preview.effectPosition} floating />
    ) : null;
  }
  const faceIds = cardPreviewFaceIds(preview.id);
  if (faceIds.length === 0) return null;
  const faceSize = preview.size ?? {
    width: CARD_PREVIEW_WIDTH,
    height: CARD_PREVIEW_HEIGHT,
  };
  const surfaceSize = cardPreviewSurfaceSize(preview.id, faceSize);
  // The panels hang above the card; push the card down only as far as they
  // need to stay on screen.
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
      {preview.effect || badges.length > 0 ? (
        <div className="card-preview-header" ref={panelRef}>
          {preview.effect ? <EffectHintPanel hint={preview.effect} /> : null}
          {badges.length > 0 ? <CardBadgePanel badges={badges} /> : null}
        </div>
      ) : null}
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
