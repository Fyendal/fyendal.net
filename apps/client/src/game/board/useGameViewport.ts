import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import type { FloatVisibilityController } from "../floatVisibility.js";
import { shouldUseCompactBoard, shouldUseCompactHud } from "./compactBoard.js";
import {
  MOBILE_FLOAT_QUERY,
  PHONE_LANDSCAPE_QUERY,
  TOUCH_LANDSCAPE_QUERY,
} from "./viewportQueries.js";

const matches = (query: string) =>
  typeof window !== "undefined" && window.matchMedia(query).matches;

export function useGameViewport(boardRef: RefObject<HTMLDivElement | null>) {
  const [railCollapsed, setRailCollapsed] = useState(
    () => matches(TOUCH_LANDSCAPE_QUERY) || matches(PHONE_LANDSCAPE_QUERY),
  );
  const [mobileLandscapeViewport, setMobileLandscapeViewport] = useState(
    () => matches(PHONE_LANDSCAPE_QUERY),
  );
  const [mobileFloatViewport, setMobileFloatViewport] = useState(
    () => matches(MOBILE_FLOAT_QUERY),
  );
  const [compactDesktopViewport, setCompactDesktopViewport] = useState(false);
  const [compactHudViewport, setCompactHudViewport] = useState(false);
  const [mobileHandHidden, setMobileHandHidden] = useState(false);
  const [mobileCombatFloatsHidden, setMobileCombatFloatsHidden] = useState(false);

  useEffect(() => {
    const touchLandscape = window.matchMedia(TOUCH_LANDSCAPE_QUERY);
    const phoneLandscape = window.matchMedia(PHONE_LANDSCAPE_QUERY);
    const syncRailToViewport = () => {
      setRailCollapsed(touchLandscape.matches || phoneLandscape.matches);
      setMobileLandscapeViewport(phoneLandscape.matches);
    };
    touchLandscape.addEventListener("change", syncRailToViewport);
    phoneLandscape.addEventListener("change", syncRailToViewport);
    return () => {
      touchLandscape.removeEventListener("change", syncRailToViewport);
      phoneLandscape.removeEventListener("change", syncRailToViewport);
    };
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
      const compact = shouldUseCompactBoard(usableWidth, window.innerWidth, window.innerHeight);
      setCompactDesktopViewport(compact);
      setCompactHudViewport(shouldUseCompactHud(usableWidth, window.innerWidth, compact));
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
    compactHudViewport,
    mobileHandIsHidden: mobileFloatViewport && mobileHandHidden,
    toggleMobileHand: () => setMobileHandHidden((hidden) => !hidden),
    mobileCombatFloatVisibility,
  };
}
