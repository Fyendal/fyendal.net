import { describe, expect, it } from "vitest";
import type { LeagueAvailabilityWindow } from "@fyendal/shared";
import {
  intersectIntervals,
  materializeWeek,
  mergeIntervals,
  seasonWeekBounds,
  usableMinutes,
  wallToUtc,
  WEEK_MS,
  zoneOffsetMs,
} from "../league/availability.js";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const span = (start: number, end: number) => ({ start, end });
const w = (weekday: LeagueAvailabilityWindow["weekday"], startHour: number, endHour: number): LeagueAvailabilityWindow =>
  ({ weekday, start: startHour * 60, end: endHour * 60 });

describe("league availability", () => {
  it("reads zone offsets, including quarter-hour zones", () => {
    expect(zoneOffsetMs("UTC", Date.UTC(2026, 0, 1))).toBe(0);
    expect(zoneOffsetMs("America/New_York", Date.UTC(2026, 0, 15))).toBe(-5 * HOUR);
    expect(zoneOffsetMs("America/New_York", Date.UTC(2026, 6, 15))).toBe(-4 * HOUR);
    expect(zoneOffsetMs("Asia/Kathmandu", Date.UTC(2026, 6, 15, 12, 0, 0, 500))).toBe(5.75 * HOUR);
  });

  it("resolves DST gaps forward and repeated hours to the earlier instant", () => {
    // 2026-03-08 02:30 does not exist in New York.
    expect(iso(wallToUtc("America/New_York", Date.UTC(2026, 2, 8, 2, 30)))).toBe("2026-03-08T07:30:00.000Z");
    // 2026-11-01 01:30 happens twice; the EDT instant comes first.
    expect(iso(wallToUtc("America/New_York", Date.UTC(2026, 10, 1, 1, 30)))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("shrinks a window across spring-forward and stretches one across fall-back", () => {
    const spring = materializeWeek([w(0, 1, 3)], "America/New_York", Date.UTC(2026, 2, 2), Date.UTC(2026, 2, 9));
    expect(spring.map(({ start, end }) => [iso(start), (end - start) / 60_000]))
      .toEqual([["2026-03-08T06:00:00.000Z", 60]]);
    const fall = materializeWeek([w(0, 1, 2)], "America/New_York", Date.UTC(2026, 9, 26), Date.UTC(2026, 10, 2));
    expect(fall.map(({ start, end }) => [iso(start), (end - start) / 60_000]))
      .toEqual([["2026-11-01T05:00:00.000Z", 120]]);
  });

  it("joins windows across local midnight and clips to the week", () => {
    const weekStart = Date.UTC(2026, 4, 4); // Monday
    const week = materializeWeek([w(5, 22, 24), w(6, 0, 2), w(1, 0, 1)], "UTC", weekStart, weekStart + WEEK_MS);
    expect(week.map(({ start, end }) => [iso(start), iso(end)])).toEqual([
      ["2026-05-04T00:00:00.000Z", "2026-05-04T01:00:00.000Z"],
      ["2026-05-08T22:00:00.000Z", "2026-05-09T02:00:00.000Z"],
    ]);
    const clipped = materializeWeek([w(1, 0, 4)], "UTC", weekStart + 2 * HOUR, weekStart + WEEK_MS);
    expect(clipped).toEqual([span(weekStart + 2 * HOUR, weekStart + 4 * HOUR)]);
  });

  it("finds the overlap between players far apart", () => {
    const weekStart = Date.UTC(2026, 4, 4);
    const weekEnd = weekStart + WEEK_MS;
    // Saturday evening in Tokyo is Saturday morning in Los Angeles.
    const tokyo = materializeWeek([w(6, 20, 23)], "Asia/Tokyo", weekStart, weekEnd);
    const losAngeles = materializeWeek([w(6, 4, 7), w(6, 18, 22)], "America/Los_Angeles", weekStart, weekEnd);
    const overlap = intersectIntervals(tokyo, losAngeles);
    expect(overlap.map(({ start, end }) => [iso(start), iso(end)]))
      .toEqual([["2026-05-09T11:00:00.000Z", "2026-05-09T14:00:00.000Z"]]);
    expect(usableMinutes(overlap, 60)).toBe(180);
    expect(usableMinutes(overlap, 240)).toBe(0);
  });

  it("merges overlapping and adjacent intervals", () => {
    expect(mergeIntervals([span(5, 6), span(1, 3), span(3, 4), span(2, 2), span(10, 12), span(11, 15)]))
      .toEqual([span(1, 4), span(5, 6), span(10, 15)]);
  });

  it("numbers season weeks from the start instant", () => {
    expect(seasonWeekBounds(1_000, 3)).toEqual(span(1_000 + 2 * WEEK_MS, 1_000 + 3 * WEEK_MS));
  });
});
