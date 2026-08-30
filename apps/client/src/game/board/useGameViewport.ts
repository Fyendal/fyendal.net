import { useEffect, useMemo, useState } from "react";
import type { FloatVisibilityController } from "../floatVisibility.js";

const MOBILE_LANDSCAPE_RAIL_QUERY =
  "(min-width: 701px) and (orientation: landscape) and (pointer: coarse)";
const MOBILE_FLOAT_QUERY = "(max-width: 700px)";

export function useGameViewport() {
  const [railCollapsed, setRailCollapsed] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_LANDSCAPE_RAIL_QUERY).matches,
  );
  const [mobileFloatViewport, setMobileFloatViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_FLOAT_QUERY).matches,
  );
  const [mobileHandHidden, setMobileHandHidden] = useState(false);
  const [mobileCombatFloatsHidden, setMobileCombatFloatsHidden] = useState(false);

  useEffect(() => {
    const mobileLandscape = window.matchMedia(MOBILE_LANDSCAPE_RAIL_QUERY);
    const syncRailToViewport = (event: MediaQueryListEvent) => setRailCollapsed(event.matches);
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

  const mobileCombatFloatVisibility = useMemo<FloatVisibilityController | undefined>(
    () => mobileFloatViewport
      ? { hidden: mobileCombatFloatsHidden, setHidden: setMobileCombatFloatsHidden }
      : undefined,
    [mobileCombatFloatsHidden, mobileFloatViewport],
  );

  return {
    railCollapsed,
    setRailCollapsed,
    mobileFloatViewport,
    mobileHandIsHidden: mobileFloatViewport && mobileHandHidden,
    toggleMobileHand: () => setMobileHandHidden((hidden) => !hidden),
    mobileCombatFloatVisibility,
  };
}
