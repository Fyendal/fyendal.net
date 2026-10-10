import { describe, expect, it } from "vitest";
import {
  lifeThresholdRisk,
  valueBreakdown,
} from "./value.js";

describe("damage-equivalent value", () => {
  it("adds threatened, prevented, and future value while subtracting costs", () => {
    expect(valueBreakdown({
      damageThreatened: 7,
      damagePrevented: 3,
      onHitValue: 2,
      arsenalValue: 1,
      equipmentCost: 1,
      overblockCost: 1.5,
      lifeThresholdRisk: 0.5,
    }).total).toBe(10);
  });

  it("charges nonlinear risk only after crossing low-life breakpoints", () => {
    expect(lifeThresholdRisk(5)).toBe(0);
    expect(lifeThresholdRisk(4)).toBe(1);
    expect(lifeThresholdRisk(2)).toBe(2.5);
    expect(lifeThresholdRisk(1)).toBe(4);
  });
});
