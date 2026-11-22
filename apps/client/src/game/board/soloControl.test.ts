import { describe, expect, it } from "vitest";
import {
  boardFeedback,
  NO_SEAT_INPUT_LOCK,
  nextSeatInputLock,
  SOLO_SEAT_SWITCH_LOCK_MS,
  seatInputAllowed,
  seatInputLocked,
  soloHandPresentation,
  soloSides,
} from "./soloControl.js";

describe("solo acting side", () => {
  const live = { soloGame: true, watching: false, gameOver: false, boardSeat: 0 };

  it("lights the half whose seat acts and rests the other", () => {
    expect(soloSides({ ...live, actingSeat: 0 })).toEqual({ top: "waiting", bottom: "acting" });
    expect(soloSides({ ...live, actingSeat: 1 })).toEqual({ top: "acting", bottom: "waiting" });
    expect(soloSides({ ...live, boardSeat: 1, actingSeat: 1 })).toEqual({ top: "waiting", bottom: "acting" });
  });

  it("is neutral outside a live solo game", () => {
    expect(soloSides({ ...live, soloGame: false, actingSeat: 1 })).toBeNull();
    expect(soloSides({ ...live, watching: true, actingSeat: 1 })).toBeNull();
    expect(soloSides({ ...live, gameOver: true, actingSeat: 1 })).toBeNull();
    expect(soloSides({ ...live, actingSeat: null })).toBeNull();
  });
});

describe("solo hand presentation", () => {
  it("brings the acting hand forward only when it has something usable", () => {
    expect(soloHandPresentation("acting", true)).toBe("acting");
    expect(soloHandPresentation("acting", false)).toBe("idle");
    expect(soloHandPresentation("waiting", true)).toBe("waiting");
    expect(soloHandPresentation(null, false)).toBeNull();
  });
});

describe("board feedback", () => {
  it("keeps priority alerts and opponent-play buffering outside solo", () => {
    expect(boardFeedback({ soloGame: false, spectating: false, yourSeat: 1 }))
      .toEqual({ priorityAlertSeat: 1, opponentPlayBuffered: true });
    expect(boardFeedback({ soloGame: false, spectating: true, yourSeat: 1 }))
      .toEqual({ priorityAlertSeat: null, opponentPlayBuffered: true });
  });

  it("turns both off in solo, where control passing is not an opponent acting", () => {
    expect(boardFeedback({ soloGame: true, spectating: false, yourSeat: 1 }))
      .toEqual({ priorityAlertSeat: null, opponentPlayBuffered: false });
  });
});

describe("seat input lock", () => {
  it("starts on the first seat seen and on every change of seat", () => {
    const first = nextSeatInputLock(NO_SEAT_INPUT_LOCK, 0, 1000);
    expect(first).toEqual({ seat: 0, until: 1000 + SOLO_SEAT_SWITCH_LOCK_MS });
    expect(nextSeatInputLock(first, 0, 5000)).toBe(first);
    expect(nextSeatInputLock(first, 1, 5000)).toEqual({ seat: 1, until: 5000 + SOLO_SEAT_SWITCH_LOCK_MS });
    expect(nextSeatInputLock(first, null, 5000)).toEqual({ seat: null, until: 0 });
  });

  it("holds for the lock window only", () => {
    const lock = nextSeatInputLock(NO_SEAT_INPUT_LOCK, 1, 1000);
    expect(seatInputLocked(lock, 1000)).toBe(true);
    expect(seatInputLocked(lock, 1000 + SOLO_SEAT_SWITCH_LOCK_MS - 1)).toBe(true);
    expect(seatInputLocked(lock, 1000 + SOLO_SEAT_SWITCH_LOCK_MS)).toBe(false);
  });

  it("refuses input built for a seat that no longer acts, even after the window", () => {
    const lock = nextSeatInputLock(NO_SEAT_INPUT_LOCK, 1, 0);
    const later = SOLO_SEAT_SWITCH_LOCK_MS + 1;
    expect(seatInputAllowed({ lock, renderedSeat: 1, liveSeat: 1, now: later })).toBe(true);
    expect(seatInputAllowed({ lock, renderedSeat: 0, liveSeat: 1, now: later })).toBe(false);
    expect(seatInputAllowed({ lock, renderedSeat: 1, liveSeat: 1, now: 10 })).toBe(false);
  });
});
