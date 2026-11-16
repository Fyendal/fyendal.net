import { describe, expect, it } from "vitest";
import type { GameMotionBatch, MotionFlight } from "./motionGeometry.js";
import type { GameMotionEvent } from "./motionTypes.js";
import { stagedDefenderHandoffs } from "./stagedDefenderHandoff.js";

const rect = { left: 0, top: 0, width: 10, height: 14 };
const card = { instanceId: 11, cardId: "TST011", owner: 0 };

function batch(id: string, flights: MotionFlight[] = []): GameMotionBatch {
  return { id, flights, connectors: [], durationMs: 400 };
}

function stagingBatch(id: string): GameMotionBatch {
  return batch(id, [{
    id: `${id}:flight:0`,
    phase: "staging",
    mode: "move",
    start: rect,
    end: rect,
    visual: { kind: "face", card },
    count: 1,
    showCount: false,
    delayMs: 0,
    destinationPresentationKey: "chain:0:staged:11",
    instanceId: 11,
  }]);
}

const settle: GameMotionEvent = {
  kind: "settle",
  destination: { kind: "chain-defender", link: 0, index: 0 },
  visual: { kind: "face", card },
  instanceId: 11,
  destinationPresentationKey: "chain:0:defender:0:11",
};

describe("stagedDefenderHandoffs", () => {
  it("hands a confirmed defender to its still-flying staging flight", () => {
    const masks = new Map([["b1", new Map([["chain:0:staged:11", {} as HTMLElement]])]]);
    expect(stagedDefenderHandoffs([settle], { active: stagingBatch("b1"), pending: [] }, masks)).toEqual({
      events: [],
      handoffs: [{ batchId: "b1", stagingKey: "chain:0:staged:11", destinationKey: "chain:0:defender:0:11" }],
    });
  });

  it("hands off to a queued staging flight", () => {
    const result = stagedDefenderHandoffs([settle], { active: batch("b0"), pending: [stagingBatch("b1")] }, new Map());
    expect(result.events).toEqual([]);
    expect(result.handoffs.map((handoff) => handoff.batchId)).toEqual(["b1"]);
  });

  it("drops the settle without a handoff once the staging flight landed", () => {
    const result = stagedDefenderHandoffs([settle], { active: stagingBatch("b1"), pending: [] }, new Map());
    expect(result).toEqual({ events: [], handoffs: [] });
  });

  it("drops a face-up settle when nothing is staging that card", () => {
    expect(stagedDefenderHandoffs([settle], { active: null, pending: [] }, new Map())).toEqual({
      events: [],
      handoffs: [],
    });
  });

  it("keeps the reveal of a hidden staged defender", () => {
    const reveal: GameMotionEvent = { ...settle, visual: { kind: "back-reveal", card } };
    expect(stagedDefenderHandoffs([reveal], { active: null, pending: [] }, new Map()).events).toEqual([reveal]);
  });
});
