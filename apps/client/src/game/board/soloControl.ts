export type SoloSideState = "acting" | "waiting";

/** Which board side reads as live in solo; null outside a live solo game. */
export function soloSides({
  soloGame,
  watching,
  gameOver,
  boardSeat,
  actingSeat,
}: {
  soloGame: boolean;
  watching: boolean;
  gameOver: boolean;
  boardSeat: number;
  actingSeat: number | null;
}): { top: SoloSideState; bottom: SoloSideState } | null {
  if (!soloGame || watching || gameOver || actingSeat === null) return null;
  const bottomActs = actingSeat === boardSeat;
  return { top: bottomActs ? "waiting" : "acting", bottom: bottomActs ? "acting" : "waiting" };
}

/** "idle": the seat acts but nothing in its hand can be used, so the hand
 * stays receded without the waiting dim. */
export type SoloHandPresentation = SoloSideState | "idle";

export function soloHandPresentation(side: SoloSideState | null, usable: boolean): SoloHandPresentation | null {
  return side === "acting" && !usable ? "idle" : side;
}

/** Cues built for a second person. Solo has nobody to wait for, so priority
 * alerts and opponent-play buffering stay off. */
export function boardFeedback({
  soloGame,
  spectating,
  yourSeat,
}: {
  soloGame: boolean;
  spectating: boolean;
  yourSeat: number | null;
}): { priorityAlertSeat: number | null; opponentPlayBuffered: boolean } {
  return {
    priorityAlertSeat: soloGame || spectating ? null : yourSeat,
    opponentPlayBuffered: !soloGame,
  };
}

/** Input for the previous seat must not land on the next one. */
export const SOLO_SEAT_SWITCH_LOCK_MS = 350;

export interface SeatInputLock {
  seat: number | null;
  until: number;
}

export const NO_SEAT_INPUT_LOCK: SeatInputLock = { seat: null, until: 0 };

/** A new acting seat, including the first one seen after a load, starts a lock. */
export function nextSeatInputLock(lock: SeatInputLock, seat: number | null, now: number): SeatInputLock {
  if (seat === lock.seat) return lock;
  return { seat, until: seat === null ? 0 : now + SOLO_SEAT_SWITCH_LOCK_MS };
}

export function seatInputLocked(lock: SeatInputLock, now: number): boolean {
  return now < lock.until;
}

/** Whether an input built while `renderedSeat` acted may still be sent. */
export function seatInputAllowed({
  lock,
  renderedSeat,
  liveSeat,
  now,
}: {
  lock: SeatInputLock;
  renderedSeat: number | null;
  liveSeat: number | null;
  now: number;
}): boolean {
  return renderedSeat === liveSeat && !seatInputLocked(lock, now);
}
