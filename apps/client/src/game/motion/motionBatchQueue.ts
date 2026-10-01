import type { GameMotionBatch, MotionFlight } from "./motionGeometry.js";

export interface MotionBatchQueue {
  active: GameMotionBatch | null;
  pending: readonly GameMotionBatch[];
}

export const EMPTY_MOTION_BATCH_QUEUE: MotionBatchQueue = {
  active: null,
  pending: [],
};

const EMPTY_QUEUED_HAND_SOURCES: readonly MotionFlight[] = [];

/** The view has already moved these hidden hand slots, but their flights wait
 * behind an earlier batch. Keep a back at each old slot until they start. */
export function queuedHandSourceFlights(queue: MotionBatchQueue): readonly MotionFlight[] {
  if (queue.pending.length === 0) return EMPTY_QUEUED_HAND_SOURCES;
  return queue.pending.flatMap((batch) => batch.flights.filter((flight) => (
    flight.queueHoldSource === true
  )));
}

interface MotionBatchEnqueueResult {
  queue: MotionBatchQueue;
  discardedBatchIds: readonly string[];
}

/** The authoritative view may already contain a new-turn stack. Keep that UI
 * gated only while an earlier batch is ahead of its queued turn-start batch. */
export function motionQueueBlocksTurnStartUi(queue: MotionBatchQueue): boolean {
  const turnStart = [queue.active, ...queue.pending].find((batch) => (
    batch?.stage === "turn-start"
  ));
  return turnStart !== undefined && queue.active !== turnStart;
}

/** Result-only fades do not encode a physical card path. Replaying
 * consecutive snapshots at the same footprint only creates backlog and
 * flicker, so the first one is enough. */
function motionBatchIsCompressible(batch: GameMotionBatch): boolean {
  const cueCount = batch.flights.length + batch.connectors.length;
  return batch.stage === undefined
    && cueCount > 0
    && batch.connectors.length === 0
    && batch.flights.every((flight) => flight.phase === "result");
}

function rectKey(rect: { left: number; top: number; width: number; height: number }): string {
  return `${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
}

function compressionKey(batch: GameMotionBatch): string | null {
  if (!motionBatchIsCompressible(batch)) return null;
  const footprints = new Set([
    ...batch.flights.map((flight) => rectKey(flight.end)),
  ]);
  return [...footprints].sort().join("|");
}

/** Preserve authoritative transition order when several updates arrive before
 * the current animation finishes, as happens when both players auto-pass an
 * attack from the stack onto the combat chain. */
export function enqueueMotionBatch(
  queue: MotionBatchQueue,
  batch: GameMotionBatch,
): MotionBatchEnqueueResult {
  if (!queue.active) {
    return {
      queue: { active: batch, pending: [] },
      discardedBatchIds: [],
    };
  }
  const queueTail = queue.pending.at(-1) ?? queue.active;
  const tailCompressionKey = compressionKey(queueTail);
  if (tailCompressionKey !== null && tailCompressionKey === compressionKey(batch)) {
    return { queue, discardedBatchIds: [batch.id] };
  }
  return {
    queue: { active: queue.active, pending: [...queue.pending, batch] },
    discardedBatchIds: [],
  };
}

export function completeMotionBatch(
  queue: MotionBatchQueue,
  batchId: string,
): MotionBatchQueue {
  if (queue.active?.id !== batchId) return queue;
  const [active = null, ...pending] = queue.pending;
  return { active, pending };
}
