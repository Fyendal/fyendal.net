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

function resultBatch(id: number, left = 0): GameMotionBatch {
  return {
    ...batch(id),
    pulses: [{
      id: `${id}:pulse:0`,
      phase: "result",
      rect: { left, top: 0, width: 100, height: 138 },
      delayMs: 0,
    }],
  };
}

describe("motion batch queue", () => {
  it("starts a later stack-to-chain transition immediately after a normal priority pause", () => {
    const stackEntry = batch(10);
    const chainEntry = batch(11);
    const afterStackEntry = completeMotionBatch(
      enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, stackEntry).queue,
      stackEntry.id,
    );
    const resolving = enqueueMotionBatch(afterStackEntry, chainEntry).queue;

    expect(resolving).toEqual({ active: chainEntry, pending: [] });
  });

  it("keeps an auto-passed stack-to-chain transition behind stack entry", () => {
    const stackEntry = batch(10);
    const chainEntry = batch(11);
    const queued = enqueueMotionBatch(
      enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, stackEntry).queue,
      chainEntry,
    ).queue;

    expect(queued.active).toBe(stackEntry);
    expect(queued.pending).toEqual([chainEntry]);
    expect(completeMotionBatch(queued, stackEntry.id)).toEqual({
      active: chainEntry,
      pending: [],
    });
  });

  it("ignores stale completion events", () => {
    const stackEntry = batch(10);
    const queued = enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, stackEntry).queue;

    expect(completeMotionBatch(queued, 9)).toBe(queued);
  });

  it("compresses duplicate result footprints without crossing a causal boundary", () => {
    const firstResult = resultBatch(20);
    const duplicateResult = resultBatch(21);
    const resolution = {
      ...batch(22),
      flights: [{
        id: "22:flight:0",
        phase: "resolution" as const,
        mode: "move" as const,
        start: { left: 0, top: 0, width: 100, height: 138 },
        end: { left: 200, top: 0, width: 100, height: 138 },
        visual: { kind: "back" as const },
        count: 1,
        showCount: false,
        delayMs: 0,
      }],
    };
    const afterFirst = enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, firstResult).queue;
    const compressed = enqueueMotionBatch(afterFirst, duplicateResult);
    const afterResolution = enqueueMotionBatch(compressed.queue, resolution);
    const laterResult = enqueueMotionBatch(afterResolution.queue, resultBatch(23));

    expect(compressed.queue).toBe(afterFirst);
    expect(compressed.discardedBatchIds).toEqual([duplicateResult.id]);
    expect(laterResult.queue.pending.map((pending) => pending.id)).toEqual([22, 23]);
    expect(laterResult.discardedBatchIds).toEqual([]);
  });

  it("preserves consecutive results at different destinations", () => {
    const firstResult = resultBatch(30, 0);
    const secondResult = resultBatch(31, 200);
    const afterFirst = enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, firstResult).queue;
    const afterSecond = enqueueMotionBatch(afterFirst, secondResult);

    expect(afterSecond.queue.pending).toEqual([secondResult]);
    expect(afterSecond.discardedBatchIds).toEqual([]);
  });
});
