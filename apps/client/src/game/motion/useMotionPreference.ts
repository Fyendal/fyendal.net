import { useEffect, useState } from "react";
import type { MotionPreference } from "../../storage.js";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function motionPreferenceReducesMotion(
  preference: MotionPreference,
  systemPrefersReducedMotion: boolean,
): boolean {
  return preference === "reduced"
    || (preference === "system" && systemPrefersReducedMotion);
}

function readSystemPreference(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Follow operating-system changes only while the user has selected Default. */
export function useMotionPreference(preference: MotionPreference): boolean {
  const [systemPrefersReducedMotion, setSystemPrefersReducedMotion] = useState(
    readSystemPreference,
  );

  useEffect(() => {
    if (
      preference !== "system"
      || typeof window === "undefined"
      || typeof window.matchMedia !== "function"
    ) return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const syncPreference = () => setSystemPrefersReducedMotion(query.matches);
    syncPreference();
    query.addEventListener("change", syncPreference);
    return () => query.removeEventListener("change", syncPreference);
  }, [preference]);

  return motionPreferenceReducesMotion(preference, systemPrefersReducedMotion);
}
