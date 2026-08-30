import { describe, expect, it } from "vitest";
import { hoverSurfaceLayout } from "./hoverSurfaceLayout.js";

const preview = { width: 300, height: 413 };
const viewport = { width: 1020, height: 930 };

describe("hover surface layout", () => {
  it("keeps a left-edge tooltip between the viewport and a right-side preview", () => {
    const layout = hoverSurfaceLayout({
      left: 255,
      right: 323,
      top: 660,
      bottom: 753,
      width: 68,
      height: 93,
    }, viewport, preview, 0);

    expect(layout.preview.side).toBe("right");
    expect(layout.preview.x).toBe(335);
    expect(layout.tooltip.right).toBe(693);
    expect(layout.tooltip.maxWidth).toBe(319);
    expect(layout.tooltip.bottom).toBe(278);
  });

  it("puts the tooltip to the right when the preview opens left", () => {
    const layout = hoverSurfaceLayout({
      left: 850,
      right: 918,
      top: 100,
      bottom: 193,
      width: 68,
      height: 93,
    }, viewport, preview, 0);

    expect(layout.preview.side).toBe("left");
    expect(layout.preview.x).toBe(538);
    expect(layout.tooltip.left).toBe(846);
    expect(layout.tooltip.maxWidth).toBe(166);
    expect(layout.tooltip.top).toBe(201);
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

    expect(layout.preview.x).toBeGreaterThanOrEqual(8);
    expect(layout.preview.x + preview.width).toBeLessThanOrEqual(780);
    expect(layout.preview.y).toBeGreaterThanOrEqual(8);
  });
});
