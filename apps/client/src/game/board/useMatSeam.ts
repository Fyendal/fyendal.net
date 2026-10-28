import { useLayoutEffect, type RefObject } from "react";

/** Publishes the divider's edges on the board as `--mat-seam-top` and
 * `--mat-seam-bottom`, so each player's mat can stop at the seam. */
export function useMatSeam(
  board: RefObject<HTMLElement | null>,
  divider: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useLayoutEffect(() => {
    const boardElement = board.current;
    const dividerElement = divider.current;
    if (!active || !boardElement || !dividerElement) return;
    let top = -1;
    let bottom = -1;
    const sync = () => {
      const nextTop = dividerElement.offsetTop;
      const nextBottom = nextTop + dividerElement.offsetHeight;
      if (nextTop === top && nextBottom === bottom) return;
      top = nextTop;
      bottom = nextBottom;
      boardElement.style.setProperty("--mat-seam-top", `${top}px`);
      boardElement.style.setProperty("--mat-seam-bottom", `${bottom}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(boardElement);
    for (const half of boardElement.querySelectorAll(":scope > .mat-half")) observer.observe(half);
    return () => {
      observer.disconnect();
      boardElement.style.removeProperty("--mat-seam-top");
      boardElement.style.removeProperty("--mat-seam-bottom");
    };
  }, [active, board, divider]);
}
