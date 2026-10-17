export type HoverAnchorRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

export type HoverSurfaceLayout = { x: number; y: number; side: "left" | "right" };

const VIEWPORT_PADDING = 8;
const PREVIEW_GAP = 12;

/** Place a card preview beside its anchor, inside the viewport. */
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

  return { x, y, side };
}
