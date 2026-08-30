import { describe, expect, it } from "vitest";
import { evaluateBotMatch } from "./evaluation.js";

describe("bot strength evaluation harness", () => {
  it("replays the same bounded matchup with an identical action digest", () => {
    const deterministicClock = () => {
      let tick = 0;
      return () => tick++;
    };
    const first = evaluateBotMatch({
      left: "bravo",
      right: "briar",
      seed: 44_001,
      maxSteps: 40,
      now: deterministicClock(),
    });
    const second = evaluateBotMatch({
      left: "bravo",
      right: "briar",
      seed: 44_001,
      maxSteps: 40,
      now: deterministicClock(),
    });
    expect(second).toEqual(first);
    expect(first.steps).toBeGreaterThan(0);
    expect(first.decisions[0] + first.decisions[1]).toBe(first.steps);
    expect(first.maxDecisionMs).toEqual([1, 1]);
  }, 15_000);
});

