import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import type { FloatVisibilityController } from "../floatVisibility.js";
import { shouldUseCompactBoard } from "./compactBoard.js";

const MOBILE_LANDSCAPE_RAIL_QUERY =
  "(min-width: 701px) and (orientation: landscape) and (pointer: coarse)";
const MOBILE_FLOAT_QUERY = "(max-width: 700px)";

export function useGameViewport(boardRef: RefObject<HTMLDivElement | null>) {
  const [railCollapsed, setRailCollapsed] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_LANDSCAPE_RAIL_QUERY).matches,
  );
  const [mobileLandscapeViewport, setMobileLandscapeViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_LANDSCAPE_RAIL_QUERY).matches,
  );
  const [mobileFloatViewport, setMobileFloatViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_FLOAT_QUERY).matches,
  );
  const [compactDesktopViewport, setCompactDesktopViewport] = useState(false);
  const [mobileHandHidden, setMobileHandHidden] = useState(false);
  const [mobileCombatFloatsHidden, setMobileCombatFloatsHidden] = useState(false);

  useEffect(() => {
    const mobileLandscape = window.matchMedia(MOBILE_LANDSCAPE_RAIL_QUERY);
    const syncRailToViewport = (event: MediaQueryListEvent) => {
      setRailCollapsed(event.matches);
      setMobileLandscapeViewport(event.matches);
    };
    mobileLandscape.addEventListener("change", syncRailToViewport);
    return () => mobileLandscape.removeEventListener("change", syncRailToViewport);
  }, []);

  useEffect(() => {
    const mobileFloat = window.matchMedia(MOBILE_FLOAT_QUERY);
    const syncFloatVisibility = (event: MediaQueryListEvent) => {
      setMobileFloatViewport(event.matches);
      if (!event.matches) {
        setMobileHandHidden(false);
        setMobileCombatFloatsHidden(false);
      }
    };
    mobileFloat.addEventListener("change", syncFloatVisibility);
    return () => mobileFloat.removeEventListener("change", syncFloatVisibility);
  }, []);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    // The board changes width when the rail toggles without a window resize.
    const syncCompactBoard = () => {
      const style = window.getComputedStyle(board);
      const usableWidth = board.clientWidth -
        Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      setCompactDesktopViewport(shouldUseCompactBoard(
        usableWidth,
        window.innerWidth,
        window.innerHeight,
      ));
    };
    syncCompactBoard();
    const observer = new ResizeObserver(syncCompactBoard);
    observer.observe(board);
    window.addEventListener("resize", syncCompactBoard);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncCompactBoard);
    };
  }, [boardRef]);

  const mobileCombatFloatVisibility = useMemo<FloatVisibilityController | undefined>(
    () => mobileFloatViewport
      ? { hidden: mobileCombatFloatsHidden, setHidden: setMobileCombatFloatsHidden }
      : undefined,
    [mobileCombatFloatsHidden, mobileFloatViewport],
  );

  return {
    railCollapsed,
    setRailCollapsed,
    mobileLandscapeViewport,
    mobileFloatViewport,
    compactDesktopViewport,
    mobileHandIsHidden: mobileFloatViewport && mobileHandHidden,
    toggleMobileHand: () => setMobileHandHidden((hidden) => !hidden),
    mobileCombatFloatVisibility,
  };
}
