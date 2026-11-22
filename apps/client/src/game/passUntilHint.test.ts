import { describe, expect, it } from "vitest";
import { PASS_HINT_WINDOW_MS, passesWindow, recentPasses } from "./passUntilHint.js";

describe("pass-until hint", () => {
  it("counts a pass and an empty block, not other intents", () => {
    expect(passesWindow({ kind: "pass" })).toBe(true);
    expect(passesWindow({ kind: "defend", instanceIds: [] })).toBe(true);
    expect(passesWindow({ kind: "defend", instanceIds: [4] })).toBe(false);
    expect(passesWindow({ kind: "choose", optionId: "no" })).toBe(false);
  });

  it("keeps only passes inside the window", () => {
    const times = recentPasses(recentPasses([], 1_000), 2_000);
    expect(recentPasses(times, 3_000)).toHaveLength(3);
    expect(recentPasses(times, 1_000 + PASS_HINT_WINDOW_MS)).toEqual([2_000, 1_000 + PASS_HINT_WINDOW_MS]);
  });
});
