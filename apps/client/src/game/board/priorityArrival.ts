import { useEffect, useRef, useState } from "react";

/** Priority held by the opponent at least this long makes its return a cold
 * arrival; quicker pass exchanges leave the seam light to carry it. */
export const COLD_PRIORITY_ARRIVAL_MS = 3000;

export interface PriorityArrivalState {
  /** When priority last left us; null while we hold it. */
  lostAt: number | null;
  cold: boolean;
}

/** Before the first observation every arrival is cold, so a board that opens
 * on our priority still announces it. */
export const INITIAL_PRIORITY_ARRIVAL: PriorityArrivalState = { lostAt: 0, cold: false };

export function trackPriorityArrival(
  state: PriorityArrivalState,
  hasOwnPriority: boolean,
  now: number,
): PriorityArrivalState {
  if (!hasOwnPriority) {
    return { lostAt: state.lostAt ?? now, cold: false };
  }
  if (state.lostAt === null) return state;
  return { lostAt: null, cold: now - state.lostAt >= COLD_PRIORITY_ARRIVAL_MS };
}

/** True while a cold arrival's flash should be mounted. */
export function useColdPriorityArrival(hasOwnPriority: boolean): boolean {
  const stateRef = useRef(INITIAL_PRIORITY_ARRIVAL);
  const [cold, setCold] = useState(false);
  useEffect(() => {
    stateRef.current = trackPriorityArrival(stateRef.current, hasOwnPriority, Date.now());
    setCold(stateRef.current.cold);
  }, [hasOwnPriority]);
  return cold;
}
