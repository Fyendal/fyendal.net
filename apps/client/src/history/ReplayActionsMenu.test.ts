import { describe, expect, it } from "vitest";
import { replayMenuPosition } from "./ReplayActionsMenu.js";

describe("replay actions menu placement", () => {
  const viewport = { width: 1000, height: 800 };
  const menu = { width: 200, height: 120 };

  it("aligns its right edge with the trigger below it", () => {
    expect(replayMenuPosition({ top: 100, bottom: 134, right: 900 }, menu, viewport))
      .toEqual({ left: 700, top: 140 });
  });

  it("opens above a trigger near the viewport bottom", () => {
    expect(replayMenuPosition({ top: 740, bottom: 774, right: 900 }, menu, viewport))
      .toEqual({ left: 700, top: 614 });
  });

  it("stays inside a narrow viewport", () => {
    expect(replayMenuPosition({ top: 100, bottom: 134, right: 120 }, menu, viewport).left).toBe(8);
  });
});
