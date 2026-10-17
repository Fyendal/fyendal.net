import { describe, expect, it } from "vitest";
import { hoverSurfaceLayout } from "./hoverSurfaceLayout.js";

const preview = { width: 300, height: 413 };
const viewport = { width: 1020, height: 930 };

describe("hover surface layout", () => {
  it("opens the preview to the right when it fits", () => {
    const layout = hoverSurfaceLayout({
      left: 255,
      right: 323,
      top: 660,
      bottom: 753,
      width: 68,
      height: 93,
    }, viewport, preview, 0);

    expect(layout.side).toBe("right");
    expect(layout.x).toBe(335);
  });

  it("opens the preview to the left when the right side is full", () => {
    const layout = hoverSurfaceLayout({
      left: 850,
      right: 918,
      top: 100,
      bottom: 193,
      width: 68,
      height: 93,
    }, viewport, preview, 0);

    expect(layout.side).toBe("left");
    expect(layout.x).toBe(538);
  });

  it("clamps an oversized-side preview inside the usable viewport", () => {
    const layout = hoverSurfaceLayout({
      left: 4,
      right: 72,
      top: 300,
      bottom: 393,
      width: 68,
      height: 93,
    }, viewport, preview, 240);

    expect(layout.x).toBeGreaterThanOrEqual(8);
    expect(layout.x + preview.width).toBeLessThanOrEqual(780);
    expect(layout.y).toBeGreaterThanOrEqual(8);
  });
});
