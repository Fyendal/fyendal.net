import { describe, expect, it } from "vitest";
import type { PrepSeatView, PrepView } from "@fyendal/shared";
import { soloAutoAdvanceSeat, soloSeatStatus } from "./soloSeats.js";

function seat(overrides: Partial<PrepSeatView> = {}): PrepSeatView {
  return { username: "alice", heroId: "HERO", heroName: "Hero", ready: false, arenaLocked: false, connected: true, ...overrides };
}

function prep(overrides: Partial<PrepView> = {}): PrepView {
  return {
    format: "cc",
    phase: "select-arena",
    soloGame: true,
    seats: [seat(), seat()],
    yourSeat: 0,
    die: { rolls: [2, 5], winner: 1 },
    startPlayer: 0,
    ...overrides,
  };
}

describe("soloSeatStatus", () => {
  it("names what each seat still has to do", () => {
    expect(soloSeatStatus(prep({ phase: "choose-first", startPlayer: null }), 0)).toBe("turn-order");
    expect(soloSeatStatus(prep(), 1)).toBe("arena");
    expect(soloSeatStatus(prep({ seats: [seat({ arenaLocked: true }), seat()] }), 0)).toBe("arena-locked");
    expect(soloSeatStatus(prep({ phase: "select-deck", seats: [seat({ arenaLocked: true }), seat()] }), 0))
      .toBe("sideboarding");
    expect(soloSeatStatus(prep({ phase: "select-deck", seats: [seat(), seat({ ready: true })] }), 1)).toBe("ready");
  });
});

describe("soloAutoAdvanceSeat", () => {
  it("moves on after locking arena cards while the other seat has not", () => {
    const before = prep();
    const after = prep({ seats: [seat({ arenaLocked: true }), seat()] });
    expect(soloAutoAdvanceSeat(before, after)).toBe(1);
    const bothLocked = prep({ phase: "select-deck", yourSeat: 1, seats: [seat({ arenaLocked: true }), seat({ arenaLocked: true })] });
    expect(soloAutoAdvanceSeat(prep({ yourSeat: 1, seats: [seat({ arenaLocked: true }), seat()] }), bothLocked)).toBeNull();
  });

  it("moves on after readying only while the other seat is not ready", () => {
    const deck = (ready: [boolean, boolean]) => prep({
      phase: "select-deck",
      yourSeat: 1,
      seats: [seat({ arenaLocked: true, ready: ready[0] }), seat({ arenaLocked: true, ready: ready[1] })],
    });
    expect(soloAutoAdvanceSeat(deck([false, false]), deck([false, true]))).toBe(0);
    expect(soloAutoAdvanceSeat(deck([true, false]), deck([true, true]))).toBeNull();
  });

  it("ignores seat switches, unchanged seats and other rooms", () => {
    const locked = prep({ seats: [seat({ arenaLocked: true }), seat()] });
    expect(soloAutoAdvanceSeat(prep(), { ...locked, yourSeat: 1 })).toBeNull();
    expect(soloAutoAdvanceSeat(locked, locked)).toBeNull();
    expect(soloAutoAdvanceSeat(null, locked)).toBeNull();
    expect(soloAutoAdvanceSeat(prep({ soloGame: undefined }), { ...locked, soloGame: undefined })).toBeNull();
  });
});
