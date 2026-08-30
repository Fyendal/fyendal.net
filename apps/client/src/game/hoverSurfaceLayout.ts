export type HoverAnchorRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

export type HoverSurfaceLayout = {
  preview: { x: number; y: number; side: "left" | "right" };
  tooltip: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
    maxWidth: number;
    maxHeight: number;
  };
};

const VIEWPORT_PADDING = 8;
const PREVIEW_GAP = 12;
const TOOLTIP_GAP = 8;
const TOOLTIP_MAX_WIDTH = 360;

/** Place a card preview beside its anchor and reserve the entire opposite
 * horizontal corridor for a wrapping effect tooltip. Both surfaces stay
 * inside the viewport and can never overlap each other. */
export function hoverSurfaceLayout(
  anchor: HoverAnchorRect,
  viewport: { width: number; height: number },
  previewSize: { width: number; height: number },
  rightInset = 0,
): HoverSurfaceLayout {
  const viewportRight = viewport.width - VIEWPORT_PADDING;
  const reservedRight = Math.min(
    viewportRight,
    Math.max(VIEWPORT_PADDING + previewSize.width, viewport.width - rightInset),
  );
  const rightX = anchor.right + PREVIEW_GAP;
  const leftX = anchor.left - previewSize.width - PREVIEW_GAP;
  const rightFits = rightX + previewSize.width <= reservedRight;
  const leftFits = leftX >= VIEWPORT_PADDING;
  const spaceRight = reservedRight - anchor.right;
  const spaceLeft = anchor.left - VIEWPORT_PADDING;
  const side: "left" | "right" = rightFits || (!leftFits && spaceRight >= spaceLeft)
    ? "right"
    : "left";
  const maximumX = Math.max(VIEWPORT_PADDING, reservedRight - previewSize.width);
  const rawX = side === "right" ? rightX : leftX;
  const x = Math.min(Math.max(rawX, VIEWPORT_PADDING), maximumX);
  const maximumY = Math.max(VIEWPORT_PADDING, viewport.height - previewSize.height - VIEWPORT_PADDING);
  const y = Math.min(
    Math.max(anchor.top + anchor.height / 2 - previewSize.height / 2, VIEWPORT_PADDING),
    maximumY,
  );

  const above = anchor.top >= viewport.height - anchor.bottom;
  const vertical = above
    ? {
        bottom: viewport.height - anchor.top + TOOLTIP_GAP,
        maxHeight: Math.max(0, anchor.top - TOOLTIP_GAP - VIEWPORT_PADDING),
      }
    : {
        top: anchor.bottom + TOOLTIP_GAP,
        maxHeight: Math.max(0, viewport.height - anchor.bottom - TOOLTIP_GAP - VIEWPORT_PADDING),
      };
  const tooltip = side === "right"
    ? {
        right: viewport.width - (x - TOOLTIP_GAP),
        maxWidth: Math.min(
          TOOLTIP_MAX_WIDTH,
          Math.max(0, x - TOOLTIP_GAP - VIEWPORT_PADDING),
        ),
        ...vertical,
      }
    : {
        left: x + previewSize.width + TOOLTIP_GAP,
        maxWidth: Math.min(
          TOOLTIP_MAX_WIDTH,
          Math.max(
            0,
            viewport.width - VIEWPORT_PADDING - (x + previewSize.width + TOOLTIP_GAP),
          ),
        ),
        ...vertical,
      };

  return { preview: { x, y, side }, tooltip };
}
