import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useIntl } from "react-intl";
import { LEAGUE_SLOT_MINUTES } from "@fyendal/protocol";
import type { LeagueAvailabilityWindow } from "@fyendal/shared";
import { availableMinutes, cellIndex, cellsToWindows, GRID_WEEKDAYS, SLOTS_PER_DAY, windowsToCells } from "./availability.js";

// 2024-01-07 was a Sunday, so day `d` of that week has `Date#getDay` d.
const weekdayDate = (weekday: number) => Date.UTC(2024, 0, 7 + weekday);
const slotDate = (slot: number) => Date.UTC(2024, 0, 7, 0, slot * LEAGUE_SLOT_MINUTES);

/** Weekly availability in the member's own time zone: drag to paint cells,
 * or move with the arrow keys and toggle with Space. */
export function AvailabilityGrid({
  value,
  onChange,
  disabled = false,
  labelledBy,
}: {
  value: readonly LeagueAvailabilityWindow[];
  onChange: (windows: LeagueAvailabilityWindow[]) => void;
  disabled?: boolean;
  labelledBy: string;
}) {
  const intl = useIntl();
  const cells = useMemo(() => windowsToCells(value), [value]);
  // Several pointer moves can land before the parent re-renders with the
  // last change, so paint onto the newest cells rather than this render's.
  const latest = useRef(cells);
  latest.current = cells;
  const gridRef = useRef<HTMLDivElement>(null);
  const paint = useRef<{ selected: boolean; last: number } | null>(null);
  const [focus, setFocus] = useState(cellIndex(GRID_WEEKDAYS[0], 36));

  const labels = useMemo(() => {
    const time = (slot: number) => intl.formatTime(slotDate(slot), { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
    return {
      shortDays: GRID_WEEKDAYS.map((weekday) => intl.formatDate(weekdayDate(weekday), { timeZone: "UTC", weekday: "short" })),
      longDays: Array.from({ length: 7 }, (_, weekday) =>
        intl.formatDate(weekdayDate(weekday), { timeZone: "UTC", weekday: "long" })),
      times: Array.from({ length: SLOTS_PER_DAY + 1 }, (_, slot) => time(slot)),
    };
  }, [intl]);

  useEffect(() => {
    const stop = () => { paint.current = null; };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  const setCells = (targets: readonly number[], selected: boolean) => {
    const current = latest.current;
    if (targets.every((cell) => current.has(cell) === selected)) return;
    const next = new Set(current);
    for (const cell of targets) {
      if (selected) next.add(cell);
      else next.delete(cell);
    }
    latest.current = next;
    onChange(cellsToWindows(next));
  };

  // Pointer events arrive sparsely on a fast drag, so paint every cell on
  // the straight path from the previous one.
  const path = (from: number, to: number): number[] => {
    const position = (cell: number) => [
      GRID_WEEKDAYS.indexOf(Math.floor(cell / SLOTS_PER_DAY) as typeof GRID_WEEKDAYS[number]),
      cell % SLOTS_PER_DAY,
    ] as const;
    const [fromColumn, fromSlot] = position(from);
    const [toColumn, toSlot] = position(to);
    const steps = Math.max(Math.abs(toColumn - fromColumn), Math.abs(toSlot - fromSlot));
    return Array.from({ length: steps + 1 }, (_, step) => {
      const t = steps === 0 ? 0 : step / steps;
      return cellIndex(
        GRID_WEEKDAYS[Math.round(fromColumn + (toColumn - fromColumn) * t)]!,
        Math.round(fromSlot + (toSlot - fromSlot) * t),
      );
    });
  };

  // Hit-test by point so a touch drag paints every cell it crosses.
  const cellAt = (x: number, y: number): number | null => {
    const element = document.elementFromPoint(x, y);
    const cell = element instanceof HTMLElement ? element.dataset.cell : undefined;
    return cell === undefined || !gridRef.current?.contains(element) ? null : Number(cell);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell === null) return;
    event.preventDefault();
    paint.current = { selected: !cells.has(cell), last: cell };
    setFocus(cell);
    setCells([cell], paint.current.selected);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (paint.current === null) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell === null || cell === paint.current.last) return;
    setCells(path(paint.current.last, cell), paint.current.selected);
    paint.current = { ...paint.current, last: cell };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const weekday = Math.floor(focus / SLOTS_PER_DAY);
    const slot = focus % SLOTS_PER_DAY;
    const column = GRID_WEEKDAYS.indexOf(weekday as typeof GRID_WEEKDAYS[number]);
    const moves: Record<string, [number, number]> = {
      ArrowUp: [column, Math.max(0, slot - 1)],
      ArrowDown: [column, Math.min(SLOTS_PER_DAY - 1, slot + 1)],
      ArrowLeft: [Math.max(0, column - 1), slot],
      ArrowRight: [Math.min(6, column + 1), slot],
      Home: [column, 0],
      End: [column, SLOTS_PER_DAY - 1],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const next = cellIndex(GRID_WEEKDAYS[move[0]]!, move[1]);
    setFocus(next);
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus();
  };

  const hours = availableMinutes(value) / 60;

  return (
    <div className="availability-editor">
      <div
        ref={gridRef}
        className="availability-grid"
        role="group"
        aria-labelledby={labelledBy}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <span className="availability-corner" aria-hidden="true" />
        {labels.shortDays.map((day) => <span key={day} className="availability-day" aria-hidden="true">{day}</span>)}
        {Array.from({ length: SLOTS_PER_DAY }, (_, slot) => (
          <div key={slot} className={`availability-row${slot % 2 === 0 ? " hour" : ""}`}>
            <span className="availability-time" aria-hidden="true">{slot % 4 === 0 ? labels.times[slot] : ""}</span>
            {GRID_WEEKDAYS.map((weekday) => {
              const cell = cellIndex(weekday, slot);
              const selected = cells.has(cell);
              return (
                <button
                  key={weekday}
                  type="button"
                  data-cell={cell}
                  className="availability-cell"
                  aria-pressed={selected}
                  aria-label={intl.formatMessage(
                    { id: "league.availability.cell" },
                    { day: labels.longDays[weekday], start: labels.times[slot], end: labels.times[slot + 1] },
                  )}
                  tabIndex={cell === focus ? 0 : -1}
                  disabled={disabled}
                  // Pointer input paints on pointerdown; this handles keyboard activation only.
                  onClick={(event) => { if (event.detail === 0) setCells([cell], !selected); }}
                  onFocus={() => setFocus(cell)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="availability-summary">
        <span>{intl.formatMessage({ id: "league.availability.total" }, { hours })}</span>
        <button type="button" className="history-link" disabled={disabled || cells.size === 0} onClick={() => onChange([])}>
          {intl.formatMessage({ id: "league.availability.clear" })}
        </button>
      </div>
    </div>
  );
}
