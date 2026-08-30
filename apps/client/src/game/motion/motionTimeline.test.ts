import { describe, expect, it } from "vitest";
import { motionTimelinePhase, scheduleMotionTimeline } from "./motionTimeline.js";

describe("motion timeline", () => {
  it("starts play before overlapping pitch payment regardless of detector order", () => {
    const delays = scheduleMotionTimeline([
      { id: "pitch-a", phase: "payment", durationMs: 320, staggerMs: 45 },
      { id: "pitch-b", phase: "payment", durationMs: 320, staggerMs: 45 },
      { id: "stack", phase: "stack-entry", durationMs: 320, staggerMs: 45 },
    ], 70);

    expect([...delays.entries()]).toEqual([
      ["stack", 0],
      ["pitch-a", 45],
      ["pitch-b", 90],
    ]);
  });

  it("starts payment immediately when no played-card movement is present", () => {
    const delays = scheduleMotionTimeline([
      { id: "pitch", phase: "payment", durationMs: 320, staggerMs: 45 },
    ], 70);

    expect(delays.get("pitch")).toBe(0);
  });

  it("classifies stack resolution and resulting permanent creation separately", () => {
    expect(motionTimelinePhase({
      kind: "move",
      source: { kind: "stack-layer", index: 0 },
      destination: { kind: "graveyard", seat: 0 },
      visual: { kind: "back" },
      count: 1,
      confidence: "exact",
    })).toBe("resolution");
    expect(motionTimelinePhase({
      kind: "appear",
      destination: { kind: "board", seat: 0 },
      visual: { kind: "back" },
      instanceId: 1,
      destinationPresentationKey: "0:board:1",
    })).toBe("result");
  });
});
