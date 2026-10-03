import { describe, expect, it } from "vitest";
import type { GameMotionBatch } from "./motionGeometry.js";
import {
  completeMotionBatch,
  EMPTY_MOTION_BATCH_QUEUE,
  enqueueMotionBatch,
  motionQueueBlocksTurnStartUi,
  queuedSourceFlights,
} from "./motionBatchQueue.js";

function batch(id: number): GameMotionBatch {
  return {
    id: String(id),
    flights: [],
    connectors: [],
    durationMs: 320,
  };
}

function resultBatch(id: number, left = 0): GameMotionBatch {
  return {
    ...batch(id),
    flights: [{
      id: `${id}:flight:0`,
      phase: "result",
      mode: "disappear",
      start: { left, top: 0, width: 100, height: 138 },
      end: { left, top: 0, width: 100, height: 138 },
      visual: { kind: "back" },
      count: 1,
      showCount: false,
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

  it("holds a hidden departing card and surviving hand slots until their queued flights start", () => {
    const stackEntry = batch(12);
    const intimidate = {
      ...batch(13),
      flights: [{
        id: "13:flight:0",
        phase: "resolution" as const,
        mode: "move" as const,
        start: { left: 100, top: 0, width: 100, height: 138 },
        end: { left: 500, top: 0, width: 100, height: 138 },
        visual: { kind: "back" as const },
        count: 1,
        showCount: false,
        delayMs: 0,
        holdAtSource: true as const,
        queueHoldSource: true as const,
      }, {
        id: "13:flight:1",
        phase: "movement" as const,
        mode: "reflow" as const,
        start: { left: 0, top: 0, width: 100, height: 138 },
        end: { left: 20, top: 0, width: 100, height: 138 },
        visual: { kind: "back" as const },
        count: 1,
        showCount: false,
        delayMs: 320,
        holdAtSource: true as const,
        queueHoldSource: true as const,
        destinationPresentationKey: "1:hand:opaque",
      }],
    };
    const queued = enqueueMotionBatch(
      enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, stackEntry).queue,
      intimidate,
    ).queue;

    expect(queuedSourceFlights(queued)).toEqual(intimidate.flights);
    const started = completeMotionBatch(queued, stackEntry.id);
    expect(started.active).toBe(intimidate);
    expect(queuedSourceFlights(started)).toEqual([]);
  });

  it("keeps a face-up pile top visible while its departure waits in the queue", () => {
    const earlier = batch(14);
    const transfer: GameMotionBatch = {
      ...batch(15),
      flights: [{
        id: "15:flight:0",
        phase: "resolution",
        mode: "move",
        start: { left: 100, top: 0, width: 100, height: 138 },
        end: { left: 500, top: 0, width: 100, height: 138 },
        visual: { kind: "face", card: { instanceId: 7, cardId: "TST007", owner: 0 } },
        count: 1,
        showCount: false,
        delayMs: 0,
        queueHoldSource: true,
        sourceRevealPresentationKey: "0:graveyard:8",
      }],
    };
    const queued = enqueueMotionBatch(
      enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, earlier).queue,
      transfer,
    ).queue;

    expect(queuedSourceFlights(queued)).toEqual(transfer.flights);
    expect(queuedSourceFlights(completeMotionBatch(queued, earlier.id))).toEqual([]);
  });

  it("ignores stale completion events", () => {
    const stackEntry = batch(10);
    const queued = enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, stackEntry).queue;

    expect(completeMotionBatch(queued, "9")).toBe(queued);
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
    expect(laterResult.queue.pending.map((pending) => pending.id)).toEqual(["22", "23"]);
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

  it("blocks new-turn UI until the queued turn-start batch becomes active", () => {
    const endTurn = { ...batch(40), stage: "end-turn" as const };
    const turnStart = { ...batch(41), stage: "turn-start" as const };
    const queued = enqueueMotionBatch(
      enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, endTurn).queue,
      turnStart,
    ).queue;

    expect(motionQueueBlocksTurnStartUi(queued)).toBe(true);
    const started = completeMotionBatch(queued, endTurn.id);
    expect(started.active).toBe(turnStart);
    expect(motionQueueBlocksTurnStartUi(started)).toBe(false);
  });
});
