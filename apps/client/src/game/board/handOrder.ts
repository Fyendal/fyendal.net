import type { Sel } from "../useActionAnnouncement.js";

/** Keep surviving instances in the player's order and append newly drawn cards.
 * Printing ids cannot identify cards: a hand may contain several copies. */
export function reconcileHandOrder(
  instanceIds: readonly number[],
  preferredOrder: readonly number[],
): number[] {
  const current = new Set(instanceIds);
  const surviving = preferredOrder.filter((id) => current.has(id));
  const ordered = new Set(surviving);
  return [...surviving, ...instanceIds.filter((id) => !ordered.has(id))];
}

export function moveHandCard(
  order: readonly number[],
  instanceId: number,
  targetIndex: number,
): number[] {
  if (!order.includes(instanceId)) return [...order];
  const remaining = order.filter((id) => id !== instanceId);
  remaining.splice(Math.max(0, Math.min(targetIndex, remaining.length)), 0, instanceId);
  return remaining;
}

/** Reorder visible cards without shifting temporarily staged/hidden slots. */
export function moveVisibleHandCard(
  order: readonly number[],
  visibleIds: readonly number[],
  instanceId: number,
  targetIndex: number,
): number[] {
  const visible = new Set(visibleIds);
  const reordered = moveHandCard(order.filter((id) => visible.has(id)), instanceId, targetIndex);
  let index = 0;
  return order.map((id) => visible.has(id) ? reordered[index++]! : id);
}

export function handDragStarted(startX: number, startY: number, x: number, y: number): boolean {
  return Math.max(Math.abs(x - startX), Math.abs(y - startY)) > 10;
}

export interface HandDragBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const HAND_PLAY_DROP_CLEARANCE = 20;

export function handDragLocation(
  x: number,
  y: number,
  hand: HandDragBounds,
  arena: HandDragBounds,
): "hand" | "arena" | "buffer" | "outside" {
  const contains = (bounds: HandDragBounds) => x >= bounds.left && x <= bounds.right
    && y >= bounds.top && y <= bounds.bottom;
  if (contains(hand)) return "hand";
  if (!contains(arena)) return "outside";
  // Leave room to lift and fiddle with cards without committing a play.
  return y < hand.top - HAND_PLAY_DROP_CLEARANCE ? "arena" : "buffer";
}

/** A playable-card drop cannot double as pitching, blocking or a decision. */
export function canPlayHandDrop(
  instanceId: number,
  playableIds: ReadonlySet<number>,
  selection: Sel,
  decisionActive: boolean,
): boolean {
  if (decisionActive || !playableIds.has(instanceId)) return false;
  return selection.kind === "none" ||
    ((selection.kind === "play-hand" || selection.kind === "choose-hand-action")
      && selection.instanceId === instanceId);
}

/** Scroll proportionally near an edge, including while the pointer is still. */
export function handDragScrollSpeed(x: number, left: number, right: number): number {
  const edge = Math.min(48, (right - left) / 4);
  if (edge <= 0) return 0;
  if (x < left + edge) return -600 * Math.min(1, (left + edge - x) / edge);
  if (x > right - edge) return 600 * Math.min(1, (x - right + edge) / edge);
  return 0;
}
