import { describe, expect, it } from "vitest";
import { shouldUseCompactBoard } from "./compactBoard.js";

describe("compact arena layout", () => {
  it("counts the space taken by the open or collapsed sidebar", () => {
    const viewportWidth = 1000;
    const viewportHeight = 800;
    const boardPadding = 36;

    expect(shouldUseCompactBoard(viewportWidth - 276 - boardPadding, viewportWidth, viewportHeight))
      .toBe(true);
    expect(shouldUseCompactBoard(viewportWidth - 40 - boardPadding, viewportWidth, viewportHeight))
      .toBe(false);
  });

  it("uses the compact layout above the old window breakpoint when the square arena would overflow", () => {
    expect(shouldUseCompactBoard(1300 - 276 - 36, 1300, 1100)).toBe(true);
    expect(shouldUseCompactBoard(1300 - 40 - 36, 1300, 1100)).toBe(false);
  });

  it("leaves mobile layout selection to the mobile viewport", () => {
    expect(shouldUseCompactBoard(350, 700, 800)).toBe(false);
  });
});
