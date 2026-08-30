import { describe, expect, it } from "vitest";
import type { GameMotionBatch } from "./motionGeometry.js";
import {
  completeMotionBatch,
  EMPTY_MOTION_BATCH_QUEUE,
  enqueueMotionBatch,
} from "./motionBatchQueue.js";

function batch(id: number): GameMotionBatch {
  return {
    id,
    flights: [],
    connectors: [],
    pulses: [],
    durationMs: 320,
  };
}

describe("motion batch queue", () => {
  it("starts a later stack-to-chain transition immediately after a normal priority pause", () => {
    const stackEntry = batch(10);
    const chainEntry = batch(11);
    const afterStackEntry = completeMotionBatch(
      enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, stackEntry),
      stackEntry.id,
    );
    const resolving = enqueueMotionBatch(afterStackEntry, chainEntry);

    expect(resolving).toEqual({ active: chainEntry, pending: [] });
  });

  it("keeps an auto-passed stack-to-chain transition behind stack entry", () => {
    const stackEntry = batch(10);
    const chainEntry = batch(11);
    const queued = enqueueMotionBatch(
      enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, stackEntry),
      chainEntry,
    );

    expect(queued.active).toBe(stackEntry);
    expect(queued.pending).toEqual([chainEntry]);
    expect(completeMotionBatch(queued, stackEntry.id)).toEqual({
      active: chainEntry,
      pending: [],
    });
  });

  it("ignores stale completion events", () => {
    const stackEntry = batch(10);
    const queued = enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, stackEntry);

    expect(completeMotionBatch(queued, 9)).toBe(queued);
  });
});
