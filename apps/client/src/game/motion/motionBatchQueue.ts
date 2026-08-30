import type { GameMotionBatch } from "./motionGeometry.js";

export interface MotionBatchQueue {
  active: GameMotionBatch | null;
  pending: readonly GameMotionBatch[];
}

export const EMPTY_MOTION_BATCH_QUEUE: MotionBatchQueue = {
  active: null,
  pending: [],
};

/** Preserve authoritative transition order when several updates arrive before
 * the current animation finishes, as happens when both players auto-pass an
 * attack from the stack onto the combat chain. */
export function enqueueMotionBatch(
  queue: MotionBatchQueue,
  batch: GameMotionBatch,
): MotionBatchQueue {
  if (!queue.active) return { active: batch, pending: [] };
  return { active: queue.active, pending: [...queue.pending, batch] };
}

export function completeMotionBatch(
  queue: MotionBatchQueue,
  batchId: number,
): MotionBatchQueue {
  if (queue.active?.id !== batchId) return queue;
  const [active = null, ...pending] = queue.pending;
  return { active, pending };
}
