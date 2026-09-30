import { describe, expect, it } from "vitest";
import { lobbyTooltipPosition } from "./LobbyTooltip.js";

describe("lobby tooltip positioning", () => {
  it("keeps translated tooltips within either viewport edge", () => {
    expect(lobbyTooltipPosition(
      { left: 0, top: 100, bottom: 130, width: 60 },
      { width: 320, height: 72 },
      { width: 360, height: 640 },
    )).toEqual({ left: 168, top: 138 });
    expect(lobbyTooltipPosition(
      { left: 320, top: 100, bottom: 130, width: 40 },
      { width: 320, height: 72 },
      { width: 360, height: 640 },
    )).toEqual({ left: 192, top: 138 });
  });

  it("places long card lists above controls near the bottom of the viewport", () => {
    expect(lobbyTooltipPosition(
      { left: 120, top: 570, bottom: 600, width: 120 },
      { width: 280, height: 180 },
      { width: 360, height: 640 },
    )).toEqual({ left: 180, top: 382 });
  });
});
