import { describe, expect, it } from "vitest";
import { cardStackStep, squareCardStackOffset } from "./stackLayout.js";

describe("card stack layout", () => {
  it("uses the maximum step for short piles", () => {
    expect(cardStackStep(1)).toBe(12);
    expect(cardStackStep(5)).toBe(12);
  });

  it("compresses taller piles into the visible offset", () => {
    expect(cardStackStep(6)).toBe(9.6);
    expect(cardStackStep(9)).toBe(6);
  });

  it("uses the full square title height for each exposed card", () => {
    expect(squareCardStackOffset(2, "--arena-square-size"))
      .toBe("calc(-2 * clamp(16px, calc(var(--arena-square-size) * .12 + 3px), 23px))");
  });
});
