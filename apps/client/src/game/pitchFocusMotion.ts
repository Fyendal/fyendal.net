import type { MotionAnchorSnapshot, MotionRect } from "./motion/motionGeometry.js";
import { motionPresentationKey } from "./motion/motionTypes.js";

/** Keep the resolving source through all renders of its payment prompt. */
export function rememberStackFocusOrigins(
  previous: ReadonlyMap<number, MotionRect>,
  current: MotionAnchorSnapshot,
  stackIds: readonly number[],
  paymentSourceId?: number,
): ReadonlyMap<number, MotionRect> {
  const next = new Map<number, MotionRect>();
  for (const instanceId of stackIds) {
    const rect = current.cards.get(motionPresentationKey({ kind: "stack-layer", index: 0 }, instanceId));
    if (rect) next.set(instanceId, rect);
  }
  if (paymentSourceId !== undefined && !next.has(paymentSourceId)) {
    const rect = previous.get(paymentSourceId);
    if (rect) next.set(paymentSourceId, rect);
  }
  return next;
}

/** A hand source is removed from layout while focus is open. Preserve its last
 * visible position across any motion batches that delay the focus mounting. */
export function rememberHandFocusOrigins(
  previous: ReadonlyMap<string, MotionRect>,
  current: MotionAnchorSnapshot,
  handPresentationKeys: readonly string[],
): ReadonlyMap<string, MotionRect> {
  const next = new Map(previous);
  for (const key of handPresentationKeys) {
    const rect = current.cards.get(key);
    if (rect) next.set(key, rect);
  }
  return next;
}

/** A resolving trigger may leave the stack in the update that opens payment. */
export function pitchFocusOrigin(
  fromHand: boolean,
  sourceRect: MotionRect | undefined,
  stackRect: MotionRect | undefined,
  previousStackRect: MotionRect | undefined,
  previousHandRect?: MotionRect,
): MotionRect | undefined {
  return fromHand ? sourceRect ?? previousHandRect : stackRect ?? previousStackRect ?? sourceRect;
}
