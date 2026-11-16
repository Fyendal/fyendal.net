import type { MotionBatchQueue } from "./motionBatchQueue.js";
import type { MaskedElementsByBatch } from "./motionDestinationMask.js";
import type { GameMotionEvent } from "./motionTypes.js";

export interface StagedDefenderHandoff {
  batchId: string;
  stagingKey: string;
  destinationKey: string;
}

/** A face-up staged card confirmed as a defender is already drawn in place, so
 * it never settles: masking it under an overlay copy blinks. One still queued
 * or flying in lands through its staging flight instead. */
export function stagedDefenderHandoffs(
  events: readonly GameMotionEvent[],
  queue: MotionBatchQueue,
  maskedElements: MaskedElementsByBatch,
): { events: GameMotionEvent[]; handoffs: StagedDefenderHandoff[] } {
  const batches = [queue.active, ...queue.pending].flatMap((batch) => batch ? [batch] : []);
  const handoffs: StagedDefenderHandoff[] = [];
  const remaining = events.filter((event) => {
    if (
      event.kind !== "settle"
      || event.destination.kind !== "chain-defender"
      || event.visual.kind !== "face"
    ) return true;
    for (const batch of batches) {
      const stagingKey = batch.flights.find((flight) => (
        flight.phase === "staging" && flight.instanceId === event.instanceId
      ))?.destinationPresentationKey;
      if (stagingKey === undefined) continue;
      // An active flight that already landed has no mask left to take over.
      const landed = batch === queue.active && !maskedElements.get(batch.id)?.has(stagingKey);
      if (!landed) {
        handoffs.push({ batchId: batch.id, stagingKey, destinationKey: event.destinationPresentationKey });
      }
      break;
    }
    return false;
  });
  return { events: remaining, handoffs };
}
