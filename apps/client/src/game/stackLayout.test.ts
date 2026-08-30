import { describe, expect, it } from "vitest";
import { cardStackStep } from "./stackLayout.js";

describe("card stack layout", () => {
  it("uses the maximum step for short piles", () => {
    expect(cardStackStep(1)).toBe(12);
    expect(cardStackStep(5)).toBe(12);
  });

  it("compresses taller piles into the visible offset", () => {
    expect(cardStackStep(6)).toBe(9.6);
    expect(cardStackStep(9)).toBe(6);
  });
});
