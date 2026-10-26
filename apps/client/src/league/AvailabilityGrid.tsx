import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useIntl } from "react-intl";
import { LEAGUE_SLOT_MINUTES } from "@fyendal/protocol";
import type { LeagueAvailabilityWindow } from "@fyendal/shared";
import { availableMinutes, cellIndex, cellsToWindows, GRID_WEEKDAYS, SLOTS_PER_DAY, windowsToCells } from "./availability.js";

// 2024-01-07 was a Sunday, so day `d` of that week has `Date#getDay` d.
const weekdayDate = (weekday: number) => Date.UTC(2024, 0, 7 + weekday);
const slotDate = (slot: number) => Date.UTC(2024, 0, 7, 0, slot * LEAGUE_SLOT_MINUTES);

/** A touch held this long on a cell starts painting, matching the card
 * inspect gesture; a shorter one toggles the cell and a moving one scrolls. */
export const HOLD_MS = 425;
const HOLD_MOVE_PX = 10;
const COARSE_POINTER_QUERY = "(pointer: coarse)";

type Gesture =
  | { kind: "hold"; pointerId: number; cell: number; x: number; y: number; timer: number }
  | { kind: "paint"; selected: boolean; last: number };

function useCoarsePointer(): boolean {
  const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [coarse, setCoarse] = useState(() => supported && window.matchMedia(COARSE_POINTER_QUERY).matches);
  useEffect(() => {
    if (!supported) return;
    const query = window.matchMedia(COARSE_POINTER_QUERY);
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [supported]);
  return coarse;
}

/** Weekly availability in the member's own time zone. A mouse paints cells
 * on drag; a touch taps one cell or holds before dragging, so the page still
 * scrolls from the grid; the arrow keys move and Space toggles. */
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
  const coarse = useCoarsePointer();
  const cells = useMemo(() => windowsToCells(value), [value]);
  // Several pointer moves can land before the parent re-renders with the
  // last change, so paint onto the newest cells rather than this render's.
  const latest = useRef(cells);
  latest.current = cells;
  const gridRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [holding, setHolding] = useState(false);
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

  const endGesture = useCallback(() => {
    const current = gesture.current;
    if (current?.kind === "hold") window.clearTimeout(current.timer);
    gesture.current = null;
    setHolding(false);
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", endGesture);
    window.addEventListener("pointercancel", endGesture);
    return () => {
      window.removeEventListener("pointerup", endGesture);
      window.removeEventListener("pointercancel", endGesture);
      endGesture();
    };
  }, [endGesture]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // `touch-action` is fixed at touchstart, so a held touch keeps the page
    // still by cancelling each touchmove before the browser starts a scroll.
    const block = (event: TouchEvent) => {
      if (gesture.current?.kind === "paint") event.preventDefault();
    };
    grid.addEventListener("touchmove", block, { passive: false });
    return () => grid.removeEventListener("touchmove", block);
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

  // Hit-test by point so a drag paints every cell it crosses.
  const cellAt = (x: number, y: number): number | null => {
    const element = document.elementFromPoint(x, y);
    const cell = element instanceof HTMLElement ? element.dataset.cell : undefined;
    return cell === undefined || !gridRef.current?.contains(element) ? null : Number(cell);
  };

  const startPaint = (cell: number, held: boolean) => {
    const selected = !latest.current.has(cell);
    gesture.current = { kind: "paint", selected, last: cell };
    setHolding(held);
    setFocus(cell);
    setCells([cell], selected);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell === null) return;
    endGesture();
    if (event.pointerType === "mouse") {
      event.preventDefault();
      startPaint(cell, false);
      return;
    }
    const pointerId = event.pointerId;
    const timer = window.setTimeout(() => {
      const current = gesture.current;
      if (current?.kind !== "hold" || current.pointerId !== pointerId) return;
      navigator.vibrate?.(12);
      startPaint(cell, true);
    }, HOLD_MS);
    gesture.current = { kind: "hold", pointerId, cell, x: event.clientX, y: event.clientY, timer };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (current === null) return;
    if (current.kind === "hold") {
      const moved = Math.abs(event.clientX - current.x) > HOLD_MOVE_PX || Math.abs(event.clientY - current.y) > HOLD_MOVE_PX;
      if (current.pointerId === event.pointerId && moved) endGesture();
      return;
    }
    const cell = cellAt(event.clientX, event.clientY);
    if (cell === null || cell === current.last) return;
    setCells(path(current.last, cell), current.selected);
    gesture.current = { ...current, last: cell };
  };

  // A touch released before the hold elapses is a tap on one cell.
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (current?.kind === "hold" && current.pointerId === event.pointerId) {
      setFocus(current.cell);
      setCells([current.cell], !latest.current.has(current.cell));
    }
    endGesture();
  };

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (gesture.current !== null) event.preventDefault();
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
      <p className="availability-hint">
        {intl.formatMessage({ id: coarse ? "league.availability.hint.touch" : "league.availability.hint.pointer" })}
      </p>
      <div
        ref={gridRef}
        className="availability-grid"
        role="group"
        aria-labelledby={labelledBy}
        aria-disabled={disabled || undefined}
        data-holding={holding || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
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
                  // Pointer input is handled above; this handles keyboard activation only.
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
