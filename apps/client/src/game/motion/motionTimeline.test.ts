import { describe, expect, it } from "vitest";
import { motionTimelinePhase, scheduleMotionTimeline } from "./motionTimeline.js";

describe("motion timeline", () => {
  it("finishes pitch payment before card entry regardless of detector order", () => {
    const delays = scheduleMotionTimeline([
      { id: "pitch-a", phase: "payment", durationMs: 320, staggerMs: 45 },
      { id: "pitch-b", phase: "payment", durationMs: 320, staggerMs: 45 },
      { id: "stack", phase: "stack-entry", durationMs: 320, staggerMs: 45 },
    ], 70);

    expect([...delays.entries()]).toEqual([
      ["pitch-a", 0],
      ["pitch-b", 45],
      ["stack", 435],
    ]);
  });

  it("plays payment, card entry, then a stack trigger in order", () => {
    const delays = scheduleMotionTimeline([
      { id: "trigger", phase: "trigger", durationMs: 180, staggerMs: 45 },
      { id: "entry", phase: "stack-entry", durationMs: 320, staggerMs: 45 },
      { id: "cost", phase: "payment", durationMs: 320, staggerMs: 45 },
    ], 70);
    expect(delays.get("cost")).toBe(0);
    expect(delays.get("entry")).toBe(390);
    expect(delays.get("trigger")).toBeGreaterThanOrEqual(780);
  });

  it("keeps a chain-presented attack after payment and before its trigger", () => {
    expect(motionTimelinePhase({
      kind: "move",
      source: { kind: "hand", seat: 0 },
      destination: { kind: "chain-attack", link: 0 },
      visual: { kind: "back" },
      count: 1,
      confidence: "exact",
    })).toBe("stack-entry");
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
