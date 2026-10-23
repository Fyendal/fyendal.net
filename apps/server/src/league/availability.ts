import type { LeagueAvailabilityWindow } from "@fyendal/shared";

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
export const WEEK_MS = 7 * DAY_MS;

/** Half-open UTC interval `[start, end)` in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** Milliseconds to add to a UTC instant to read the wall clock in `timeZone`. */
export function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(utcMs)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return wall - (utcMs - (((utcMs % 1000) + 1000) % 1000));
}

/** Converts a wall-clock time (encoded as if it were UTC) to an instant with
 * Temporal's "compatible" disambiguation: a repeated hour resolves to its
 * earlier instant and a skipped hour shifts forward by the gap. */
export function wallToUtc(timeZone: string, wallMs: number): number {
  const before = zoneOffsetMs(timeZone, wallMs - DAY_MS);
  const after = zoneOffsetMs(timeZone, wallMs + DAY_MS);
  const candidates = [wallMs - before, wallMs - after]
    .filter((utc) => utc + zoneOffsetMs(timeZone, utc) === wallMs);
  return candidates.length ? Math.min(...candidates) : wallMs - before;
}

/** Sorts and merges overlapping or adjacent intervals, dropping empty ones. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

/** The member's recurring windows as UTC intervals within `[weekStart, weekEnd)`. */
export function materializeWeek(
  windows: readonly LeagueAvailabilityWindow[],
  timeZone: string,
  weekStart: number,
  weekEnd: number,
): Interval[] {
  const firstDay = Math.floor((weekStart + zoneOffsetMs(timeZone, weekStart)) / DAY_MS) * DAY_MS - DAY_MS;
  const lastDay = Math.floor((weekEnd + zoneOffsetMs(timeZone, weekEnd)) / DAY_MS) * DAY_MS + DAY_MS;
  const intervals: Interval[] = [];
  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    for (const window of windows) {
      if (window.weekday !== weekday) continue;
      intervals.push({
        start: Math.max(weekStart, wallToUtc(timeZone, day + window.start * MINUTE_MS)),
        end: Math.min(weekEnd, wallToUtc(timeZone, day + window.end * MINUTE_MS)),
      });
    }
  }
  return mergeIntervals(intervals);
}

/** Both lists must be sorted and disjoint, as `mergeIntervals` returns them. */
export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i]!.start, b[j]!.start);
    const end = Math.min(a[i]!.end, b[j]!.end);
    if (end > start) result.push({ start, end });
    if (a[i]!.end < b[j]!.end) i++;
    else j++;
  }
  return result;
}

/** Minutes in intervals long enough to hold a match. */
export function usableMinutes(intervals: readonly Interval[], matchMinutes: number): number {
  let total = 0;
  for (const { start, end } of intervals) {
    if (end - start >= matchMinutes * MINUTE_MS) total += (end - start) / MINUTE_MS;
  }
  return Math.floor(total);
}

export function seasonWeekBounds(startsAt: number, week: number): Interval {
  const start = startsAt + (week - 1) * WEEK_MS;
  return { start, end: start + WEEK_MS };
}
