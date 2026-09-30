import { describe, expect, it } from "vitest";
import { viewportTooltipPosition } from "./ViewportTooltip.js";

describe("viewport tooltip positioning", () => {
  it("keeps translated tooltips within either viewport edge", () => {
    expect(viewportTooltipPosition(
      { left: 0, top: 100, bottom: 130, width: 60 },
      { width: 320, height: 72 },
      { width: 360, height: 640 },
    )).toEqual({ left: 168, top: 138 });
    expect(viewportTooltipPosition(
      { left: 320, top: 100, bottom: 130, width: 40 },
      { width: 320, height: 72 },
      { width: 360, height: 640 },
    )).toEqual({ left: 192, top: 138 });
  });

  it("places long card lists above controls near the bottom of the viewport", () => {
    expect(viewportTooltipPosition(
      { left: 120, top: 570, bottom: 600, width: 120 },
      { width: 280, height: 180 },
      { width: 360, height: 640 },
    )).toEqual({ left: 180, top: 382 });
  });

  it("keeps counter tooltips on screen near the left edge and flips below near the top", () => {
    expect(viewportTooltipPosition(
      { left: 0, top: 180, bottom: 198, width: 18 },
      { width: 230, height: 52 },
      { width: 360, height: 640 },
      9,
      "above",
    )).toEqual({ left: 123, top: 119 });
    expect(viewportTooltipPosition(
      { left: 0, top: 12, bottom: 30, width: 18 },
      { width: 230, height: 52 },
      { width: 360, height: 640 },
      9,
      "above",
    )).toEqual({ left: 123, top: 39 });
    expect(viewportTooltipPosition(
      { left: 342, top: 180, bottom: 198, width: 18 },
      { width: 230, height: 52 },
      { width: 360, height: 640 },
      9,
      "above",
    )).toEqual({ left: 237, top: 119 });
  });
});
