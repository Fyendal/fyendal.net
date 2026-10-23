import { LEAGUE_SLOT_MINUTES } from "@fyendal/protocol";
import type { LeagueAvailabilityWindow } from "@fyendal/shared";

export const SLOTS_PER_DAY = (24 * 60) / LEAGUE_SLOT_MINUTES;
/** Grid columns run Monday to Sunday; values are `Date#getDay` weekdays. */
export const GRID_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export function cellIndex(weekday: number, slot: number): number {
  return weekday * SLOTS_PER_DAY + slot;
}

export function windowsToCells(windows: readonly LeagueAvailabilityWindow[]): Set<number> {
  const cells = new Set<number>();
  for (const { weekday, start, end } of windows) {
    for (let slot = start / LEAGUE_SLOT_MINUTES; slot < end / LEAGUE_SLOT_MINUTES; slot++) {
      cells.add(cellIndex(weekday, slot));
    }
  }
  return cells;
}

/** Merges each day's selected slots into the fewest windows, in weekday order. */
export function cellsToWindows(cells: ReadonlySet<number>): LeagueAvailabilityWindow[] {
  const windows: LeagueAvailabilityWindow[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    let start: number | null = null;
    for (let slot = 0; slot <= SLOTS_PER_DAY; slot++) {
      const selected = slot < SLOTS_PER_DAY && cells.has(cellIndex(weekday, slot));
      if (selected && start === null) start = slot;
      if (!selected && start !== null) {
        windows.push({
          weekday: weekday as LeagueAvailabilityWindow["weekday"],
          start: start * LEAGUE_SLOT_MINUTES,
          end: slot * LEAGUE_SLOT_MINUTES,
        });
        start = null;
      }
    }
  }
  return windows;
}

export function sameWindows(a: readonly LeagueAvailabilityWindow[], b: readonly LeagueAvailabilityWindow[]): boolean {
  const left = cellsToWindows(windowsToCells(a));
  const right = cellsToWindows(windowsToCells(b));
  return left.length === right.length
    && left.every((window, index) => window.weekday === right[index]!.weekday
      && window.start === right[index]!.start && window.end === right[index]!.end);
}

export function availableMinutes(windows: readonly LeagueAvailabilityWindow[]): number {
  return windowsToCells(windows).size * LEAGUE_SLOT_MINUTES;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function supportedTimeZones(current: string): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return zones.includes(current) ? zones : [current, ...zones];
}

/** Start times every half hour at which a whole match fits in the shared
 * time, from `now` on; capped so a wide-open week stays a usable list. */
export function startOptions(
  overlap: ReadonlyArray<{ start: number; end: number }>,
  matchMinutes: number,
  now: number,
  limit = 96,
): number[] {
  const step = LEAGUE_SLOT_MINUTES * 60_000;
  const length = matchMinutes * 60_000;
  const options: number[] = [];
  for (const range of overlap) {
    for (let at = Math.ceil(Math.max(range.start, now + 1) / step) * step; at + length <= range.end; at += step) {
      options.push(at);
      if (options.length >= limit) return options;
    }
  }
  return options;
}
