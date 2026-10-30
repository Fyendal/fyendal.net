export const HAND_REORDER_DURATION_MS = 220;
export const HAND_MOTION_EASING = "cubic-bezier(0.22, 0.8, 0.25, 1)";
/** A touch hold this long picks the card up without waiting for movement;
 * shorter presses stay taps. */
export const HAND_TOUCH_HOLD_MS = 300;
/** A rejected block or arsenal drop gives its card back after this long. */
export const HAND_DROP_SETTLE_MS = 1500;

const HAND_DRAG_PREVIEW_GAP = 12;
const HAND_DRAG_PREVIEW_EDGE = 8;

interface Size { width: number; height: number }
/** Where a drag preview goes first: beside the card, or above it. */
export type HandDragPreviewSide = "left" | "right" | "above";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Hover-preview size for a drag: beside the card or stacked above/below it,
 * whichever keeps it larger. A beside preview fits the roomier side wherever
 * the card is dragged, so it never falls back onto the card. */
export function handDragPreviewSize(
  preview: Size,
  card: Size,
  viewport: Size,
  preferredSide: HandDragPreviewSide = "right",
): Size & { stacked: boolean } {
  const fit = (width: number, height: number) =>
    Math.max(0, Math.min(1, width / preview.width, height / preview.height));
  const scaled = (scale: number, stacked: boolean) => ({
    width: Math.round(preview.width * scale),
    height: Math.round(preview.height * scale),
    stacked,
  });
  const stackedScale = fit(
    viewport.width - 2 * HAND_DRAG_PREVIEW_EDGE,
    (viewport.height - card.height) / 2 - HAND_DRAG_PREVIEW_GAP - HAND_DRAG_PREVIEW_EDGE,
  );
  if (preferredSide === "above") return scaled(stackedScale, true);
  const besideScale = fit(
    (viewport.width - card.width) / 2 - HAND_DRAG_PREVIEW_GAP - HAND_DRAG_PREVIEW_EDGE,
    viewport.height - 2 * HAND_DRAG_PREVIEW_EDGE,
  );
  return besideScale >= stackedScale ? scaled(besideScale, false) : scaled(stackedScale, true);
}

/** Preview offset from the dragged card's top-left: beside it when it fits,
 * on the preferred side first, else above or below it, always on screen. */
export function handDragPreviewOffset(
  card: { left: number; top: number } & Size,
  preview: Size,
  viewport: Size,
  preferredSide: HandDragPreviewSide = "right",
): { x: number; y: number } {
  const maxX = viewport.width - HAND_DRAG_PREVIEW_EDGE - preview.width;
  const maxY = viewport.height - HAND_DRAG_PREVIEW_EDGE - preview.height;
  const right = card.left + card.width + HAND_DRAG_PREVIEW_GAP;
  const left = card.left - HAND_DRAG_PREVIEW_GAP - preview.width;
  const centredY = clamp(card.top + (card.height - preview.height) / 2, HAND_DRAG_PREVIEW_EDGE, maxY);
  const fitsRight = preferredSide !== "above" && right <= maxX;
  const fitsLeft = preferredSide !== "above" && left >= HAND_DRAG_PREVIEW_EDGE;
  if (fitsLeft && (preferredSide === "left" || !fitsRight)) return { x: left - card.left, y: centredY - card.top };
  if (fitsRight) return { x: right - card.left, y: centredY - card.top };
  const centredX = clamp(card.left + (card.width - preview.width) / 2, HAND_DRAG_PREVIEW_EDGE, maxX);
  const above = card.top - HAND_DRAG_PREVIEW_GAP - preview.height;
  const y = above >= HAND_DRAG_PREVIEW_EDGE
    ? above
    : Math.min(card.top + card.height + HAND_DRAG_PREVIEW_GAP, maxY);
  return { x: centredX - card.left, y: y - card.top };
}

/** Layout slots stay authoritative while their presentations animate. */
export function handCardSlotLeft(
  hand: HTMLElement,
  card: HTMLElement,
  handLeft = hand.getBoundingClientRect().left,
): number {
  return handLeft + card.offsetLeft - hand.scrollLeft;
}

/** The full raised hand area stays fixed through hover and selection. */
export function handCardSlotTop(hand: HTMLElement, card: HTMLElement): number {
  return hand.getBoundingClientRect().top + card.offsetTop - hand.scrollTop;
}

/** Top-left of the card's untilted box; a fanned card's bounding rect is
 * wider than the card, but its centre stays put. */
export function handCardOrigin(card: HTMLElement): { left: number; top: number } {
  const rect = card.getBoundingClientRect();
  return {
    left: rect.left + (rect.width - card.offsetWidth) / 2,
    top: rect.top + (rect.height - card.offsetHeight) / 2,
  };
}

export function captureHandPositions(hand: HTMLElement): ReadonlyMap<number, number> {
  return new Map([...hand.querySelectorAll<HTMLElement>("[data-hand-instance-id]")]
    .map((card) => [Number(card.dataset.handInstanceId), handCardOrigin(card).left]));
}

export function cancelHandReorderAnimations(animations: Map<HTMLElement, Animation>): void {
  for (const animation of animations.values()) animation.cancel();
  animations.clear();
}

/** Animate from the previous visual position to the new layout slot. Retarget
 * from the current presentation when another reorder interrupts a slide. */
export function animateHandReorder(
  hand: HTMLElement,
  previous: ReadonlyMap<number, number>,
  animations: Map<HTMLElement, Animation>,
  draggedInstanceId: number | null,
  reducedMotion: boolean,
): void {
  cancelHandReorderAnimations(animations);
  if (reducedMotion) return;
  const handLeft = hand.getBoundingClientRect().left - hand.scrollLeft;
  const moves = [...hand.querySelectorAll<HTMLElement>("[data-hand-instance-id]")].map((card) => {
    const id = Number(card.dataset.handInstanceId);
    const previousLeft = previous.get(id);
    return {
      card,
      id,
      delta: previousLeft === undefined ? 0 : previousLeft - (handLeft + card.offsetLeft),
    };
  });
  for (const { card, id, delta } of moves) {
    if (id === draggedInstanceId || Math.abs(delta) < 1 || typeof card.animate !== "function") continue;
    // Individual translate composes with the existing hover/selection transform.
    animations.set(card, card.animate([
      { translate: `${delta}px 0px` },
      { translate: "0px 0px" },
    ], { duration: HAND_REORDER_DURATION_MS, easing: HAND_MOTION_EASING }));
  }
}

export function handReturnDuration(distance: number): number {
  return Math.min(260, Math.max(160, 130 + distance * 0.3));
}

/** A small velocity tilt settles naturally when the pointer stops. */
export function handDragTilt(current: number, deltaX: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return current;
  const target = Math.max(-4, Math.min(4, deltaX / elapsedMs * 3));
  return current + (target - current) * (1 - Math.exp(-elapsedMs / 55));
}
