/** Solo's second hand on desktop sits in the top half's free row: two wings
 * either side of the arsenal, clear of the nameplate, legs and banished zone. */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Board-relative bounds of the two wings; `gapLeft`..`gapRight` is the arsenal. */
export interface SoloHandFrame {
  left: number;
  right: number;
  top: number;
  bottom: number;
  gapLeft: number;
  gapRight: number;
}

export interface SoloHandWing {
  count: number;
  /** Distance between neighbouring card origins; below the card width they overlap. */
  step: number;
}

export interface SoloHandWings {
  cardWidth: number;
  cardHeight: number;
  left: SoloHandWing;
  right: SoloHandWing;
}

/** Room kept clear around the zones the wings border. */
export const SOLO_HAND_EDGE_GAP = 8;
/** Distance from the board's top edge, or from a HUD bar docked there. */
export const SOLO_HAND_TOP = 6;
/** One row of effect chips stays visible under the left wing. */
export const SOLO_HAND_CHIP_ROOM = 38;
export const SOLO_HAND_CARD_GAP = 6;
export const SOLO_HAND_MIN_HEIGHT = 72;
export const SOLO_HAND_MAX_HEIGHT = 220;
/** Printed card proportions, width over height. */
export const SOLO_HAND_CARD_ASPECT = 63 / 88;

/** Wing bounds from the top half's measured zones, or null when they are missing or too cramped. */
export function soloHandFrame({
  board,
  legs,
  arsenal,
  banished,
  nameplate,
  hud = null,
  chipRoom = true,
}: {
  board: Box;
  legs: Box | null;
  arsenal: Box | null;
  banished: Box | null;
  nameplate: Box | null;
  /** Short windows dock the HUD across the top edge. */
  hud?: Box | null;
  /** Keep a row of effect chips visible under the left wing. */
  chipRoom?: boolean;
}): SoloHandFrame | null {
  if (!legs || !arsenal || !banished) return null;
  const x = (value: number) => Math.round(value - board.left);
  const y = (value: number) => Math.round(value - board.top);
  const leftEdge = Math.max(legs.right, nameplate?.right ?? -Infinity) + SOLO_HAND_EDGE_GAP;
  const rightEdge = banished.left - SOLO_HAND_EDGE_GAP;
  const hudAbove = hud !== null && hud.top < arsenal.top && hud.bottom < arsenal.bottom
    && hud.left < rightEdge && hud.right > leftEdge;
  const frame = {
    left: x(leftEdge),
    right: x(rightEdge),
    top: Math.max(SOLO_HAND_TOP, hudAbove ? y(hud.bottom) + SOLO_HAND_TOP : 0),
    bottom: y(arsenal.bottom) - (chipRoom ? SOLO_HAND_CHIP_ROOM : 0),
    gapLeft: x(arsenal.left - SOLO_HAND_EDGE_GAP),
    gapRight: x(arsenal.right + SOLO_HAND_EDGE_GAP),
  };
  return frame.bottom - frame.top >= SOLO_HAND_MIN_HEIGHT && frame.gapLeft > frame.left && frame.right > frame.gapRight
    ? frame
    : null;
}

export function sameSoloHandFrame(a: SoloHandFrame | null, b: SoloHandFrame | null): boolean {
  if (a === null || b === null) return a === b;
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom
    && a.gapLeft === b.gapLeft && a.gapRight === b.gapRight;
}

function wingStep(count: number, width: number, cardWidth: number): number {
  if (count <= 1) return 0;
  const fit = (width - cardWidth) / (count - 1);
  return Math.max(12, Math.min(cardWidth + SOLO_HAND_CARD_GAP, Math.floor(fit)));
}

/** Card size and per-wing placement for `count` cards. Cards split by each
 * wing's capacity so neither overlaps while the other has room. */
export function soloHandWings(frame: SoloHandFrame, count: number): SoloHandWings {
  const cardHeight = Math.round(Math.min(SOLO_HAND_MAX_HEIGHT, frame.bottom - frame.top));
  const cardWidth = Math.round(cardHeight * SOLO_HAND_CARD_ASPECT);
  const leftWidth = frame.gapLeft - frame.left;
  const rightWidth = frame.right - frame.gapRight;
  const capacity = (width: number) =>
    Math.max(1, Math.floor((width + SOLO_HAND_CARD_GAP) / (cardWidth + SOLO_HAND_CARD_GAP)));
  const leftCapacity = capacity(leftWidth);
  const rightCapacity = capacity(rightWidth);
  const leftCount = count <= leftCapacity + rightCapacity
    ? Math.min(leftCapacity, Math.max(count - rightCapacity, Math.ceil(count / 2)))
    : Math.round(count * leftWidth / (leftWidth + rightWidth));
  const rightCount = count - leftCount;
  return {
    cardWidth,
    cardHeight,
    left: { count: leftCount, step: wingStep(leftCount, leftWidth, cardWidth) },
    right: { count: rightCount, step: wingStep(rightCount, rightWidth, cardWidth) },
  };
}
