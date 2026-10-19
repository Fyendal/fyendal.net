import { useLayoutEffect, type RefObject } from "react";

export const HUD_RESERVE_GAP = 8;

/** Width from the mat's right edge that the HUD covers on the divider's line,
 *  plus clearance; zero when the HUD is pinned above the arena. */
export function hudReserve(
  board: DOMRectReadOnly,
  hud: DOMRectReadOnly,
  dividerCenterY: number,
): number {
  if (dividerCenterY < hud.top || dividerCenterY > hud.bottom) return 0;
  return Math.max(0, Math.ceil(board.right - hud.left + HUD_RESERVE_GAP));
}

/** Publishes `--hud-reserve` on the table. `layoutKey` names the layout
 *  modes that move the HUD without resizing it or the board. */
export function useHudReserve({
  table,
  board,
  divider,
  hud,
  layoutKey,
}: {
  table: RefObject<HTMLElement | null>;
  board: RefObject<HTMLElement | null>;
  divider: RefObject<HTMLElement | null>;
  hud: HTMLElement | null;
  layoutKey: string;
}): void {
  useLayoutEffect(() => {
    const tableElement = table.current;
    const boardElement = board.current;
    const dividerElement = divider.current;
    if (!tableElement || !boardElement || !dividerElement || !hud) return;
    let applied: number | null = null;
    const sync = () => {
      const dividerRect = dividerElement.getBoundingClientRect();
      const reserve = hudReserve(
        boardElement.getBoundingClientRect(),
        hud.getBoundingClientRect(),
        dividerRect.top + dividerRect.height / 2,
      );
      if (reserve === applied) return;
      applied = reserve;
      tableElement.style.setProperty("--hud-reserve", `${reserve}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(boardElement);
    observer.observe(hud);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [table, board, divider, hud, layoutKey]);
}
