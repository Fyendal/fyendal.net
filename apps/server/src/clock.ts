import type { GameState } from "@fyendal/engine";
import type { GameClockSummary, GameClockView, RoomClock } from "@fyendal/shared";

/** The seat the game waits on; same rule as the server's auto-pass shortcuts. */
export function awaitedSeat(state: GameState | null): 0 | 1 | null {
  if (!state || state.phase === "game-over") return null;
  const seat = state.pendingDecision?.player ?? (state.phase === "action" ? state.priorityPlayer : null);
  return seat === 0 || seat === 1 ? seat : null;
}

export function startClock(state: GameState, now: number): RoomClock {
  return { awaiting: awaitedSeat(state), since: now, seatMs: [0, 0] };
}

/** Seat totals with the interval since `since` charged to the awaited seat. */
function chargedSeatMs(clock: RoomClock, now: number): [number, number] {
  const seatMs: [number, number] = [clock.seatMs[0], clock.seatMs[1]];
  if (clock.awaiting !== null) seatMs[clock.awaiting] += Math.max(0, now - clock.since);
  return seatMs;
}

/**
 * Close the interval since the previous commit by charging it to the seat that
 * was awaited, then await the seat `after` waits on. Shortcuts folded into one
 * commit therefore cost 0, and undo never refunds time.
 */
export function advanceClock(clock: RoomClock, after: GameState | null, now: number): RoomClock {
  return {
    awaiting: awaitedSeat(after),
    since: Math.max(clock.since, now),
    seatMs: chargedSeatMs(clock, now),
  };
}

/** The clock as sent in a state message, with the running interval included. */
export function clockView(clock: RoomClock, now: number): GameClockView {
  return { awaiting: clock.awaiting, seatMs: chargedSeatMs(clock, now) };
}

export function clockSummary(clock: RoomClock): GameClockSummary {
  return { seatMs: clock.seatMs };
}
