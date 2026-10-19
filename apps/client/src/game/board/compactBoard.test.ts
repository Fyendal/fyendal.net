import { describe, expect, it } from "vitest";
import { shouldUseCompactBoard, shouldUseCompactHud } from "./compactBoard.js";

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

  it("counts both pile columns as full arena squares on narrow desktop windows", () => {
    // 1100 × 840 needs 813px beside the open sidebar's 788px.
    expect(shouldUseCompactBoard(1100 - 276 - 36, 1100, 840)).toBe(true);
    expect(shouldUseCompactBoard(1160 - 276 - 36, 1160, 840)).toBe(false);
  });

  it("leaves mobile layout selection to the mobile viewport", () => {
    expect(shouldUseCompactBoard(350, 700, 800)).toBe(false);
  });
});

describe("compact HUD", () => {
  it("follows the compact arena and narrow desktop boards", () => {
    expect(shouldUseCompactHud(1200, 1500, true)).toBe(true);
    expect(shouldUseCompactHud(1050, 1360, false)).toBe(true);
    expect(shouldUseCompactHud(1100, 1412, false)).toBe(false);
  });

  it("leaves mobile layouts to their own HUD placement", () => {
    expect(shouldUseCompactHud(350, 700, false)).toBe(false);
  });
});
