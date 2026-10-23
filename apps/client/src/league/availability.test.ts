import { describe, expect, it } from "vitest";
import { availableMinutes, cellIndex, cellsToWindows, sameWindows, windowsToCells } from "./availability.js";

describe("league availability cells", () => {
  it("round-trips windows through grid cells and merges adjacent slots", () => {
    const windows = [
      { weekday: 5 as const, start: 18 * 60, end: 20 * 60 },
      { weekday: 5 as const, start: 20 * 60, end: 21 * 60 },
      { weekday: 0 as const, start: 23 * 60, end: 24 * 60 },
    ];
    expect(cellsToWindows(windowsToCells(windows))).toEqual([
      { weekday: 0, start: 23 * 60, end: 24 * 60 },
      { weekday: 5, start: 18 * 60, end: 21 * 60 },
    ]);
    expect(sameWindows(windows, cellsToWindows(windowsToCells(windows)))).toBe(true);
    expect(availableMinutes(windows)).toBe(4 * 60);
  });

  it("splits separated slots and keeps the last slot of a day", () => {
    const cells = new Set([cellIndex(1, 0), cellIndex(1, 2), cellIndex(1, 47)]);
    expect(cellsToWindows(cells)).toEqual([
      { weekday: 1, start: 0, end: 30 },
      { weekday: 1, start: 60, end: 90 },
      { weekday: 1, start: 1410, end: 1440 },
    ]);
  });
});
