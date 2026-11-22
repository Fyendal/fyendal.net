import { describe, expect, it } from "vitest";
import type { GameClockView } from "@fyendal/shared";
import { formatDuration, liveClock } from "./gameClock.js";

describe("game clock formatting", () => {
  it("formats m:ss below an hour and h:mm:ss from an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(59_999)).toBe("0:59");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_599_000)).toBe("59:59");
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("live game clock", () => {
  const clock: GameClockView = {
    awaiting: 1,
    seatMs: [10_000, 20_000],
  };

  it("adds local time since arrival to the awaited seat and total", () => {
    expect(liveClock(clock, 500, 3_500)).toEqual({
      awaiting: 1,
      seatMs: [10_000, 23_000],
      totalMs: 33_000,
    });
  });

  it("stands still when nothing is awaited", () => {
    expect(liveClock({ ...clock, awaiting: null }, 0, 99_000).totalMs).toBe(30_000);
  });
});
