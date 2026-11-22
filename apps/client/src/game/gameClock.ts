import type { GameClockView } from "@fyendal/shared";

/** m:ss, or h:mm:ss from an hour; plain digits in every locale. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export interface LiveClock {
  awaiting: 0 | 1 | null;
  seatMs: [number, number];
  totalMs: number;
}

/** Advance the server's clock by local time since the message arrived; both
 * times come from `performance.now()`, never the wall clock. */
export function liveClock(clock: GameClockView, receivedAt: number, now: number): LiveClock {
  const running = clock.awaiting === null ? 0 : Math.max(0, now - receivedAt);
  const seatMs: [number, number] = [clock.seatMs[0], clock.seatMs[1]];
  if (clock.awaiting !== null) seatMs[clock.awaiting] += running;
  return {
    awaiting: clock.awaiting,
    seatMs,
    totalMs: seatMs[0] + seatMs[1],
  };
}
