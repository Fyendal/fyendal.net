import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../store.js";
import {
  NO_SEAT_INPUT_LOCK,
  nextSeatInputLock,
  seatInputAllowed,
  seatInputLocked,
} from "./soloControl.js";

/** Briefly blocks input after control changes seats. The lock starts when the
 * store receives the new acting seat, before React commits it, so a click on
 * the previous seat's controls cannot act for the new one. */
export function useSoloSeatInputLock(enabled: boolean, renderedSeat: number | null): {
  locked: boolean;
  allows: () => boolean;
} {
  const lockRef = useRef(NO_SEAT_INPUT_LOCK);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    lockRef.current = NO_SEAT_INPUT_LOCK;
    setLocked(false);
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observe = (seat: number | null) => {
      const next = nextSeatInputLock(lockRef.current, seat, Date.now());
      if (next === lockRef.current) return;
      lockRef.current = next;
      clearTimeout(timer);
      const remaining = next.until - Date.now();
      setLocked(remaining > 0);
      if (remaining > 0) timer = setTimeout(() => setLocked(false), remaining);
    };
    observe(useStore.getState().yourSeat);
    const unsubscribe = useStore.subscribe((state) => observe(state.yourSeat));
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [enabled]);
  const allows = useCallback(() => !enabled || seatInputAllowed({
    lock: lockRef.current,
    renderedSeat,
    liveSeat: useStore.getState().yourSeat,
    now: Date.now(),
  }), [enabled, renderedSeat]);
  return { locked: enabled && (locked || seatInputLocked(lockRef.current, Date.now())), allows };
}
