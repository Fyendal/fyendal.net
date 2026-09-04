import { describe, expect, it } from "vitest";
import { cardPoolTooltipPosition } from "./CardPoolModeControl.js";

describe("card-pool tooltip positioning", () => {
  it("keeps translated tooltips within either viewport edge", () => {
    expect(cardPoolTooltipPosition(
      { left: 0, top: 100, bottom: 130, width: 60 },
      { width: 360, height: 640 },
    )).toEqual({ left: 168, top: 140 });
    expect(cardPoolTooltipPosition(
      { left: 320, top: 100, bottom: 130, width: 40 },
      { width: 360, height: 640 },
    )).toEqual({ left: 192, top: 140 });
  });

  it("places the tooltip above controls near the bottom of the viewport", () => {
    expect(cardPoolTooltipPosition(
      { left: 120, top: 570, bottom: 600, width: 120 },
      { width: 360, height: 640 },
    )).toEqual({ left: 180, bottom: 80 });
  });
});
