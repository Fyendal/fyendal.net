import { describe, expect, it } from "vitest";
import type { PrepSeatView, PrepView } from "@fyendal/shared";
import { PREP_NUDGE_DELAY_MS, nextPrepStep } from "./nextStepNudge.js";

const seat = (overrides: Partial<PrepSeatView> = {}): PrepSeatView => ({
  username: "Player", heroId: "hero", heroName: "Hero",
  ready: false, connected: true, arenaLocked: false,
  ...overrides,
});

function prep(overrides: Partial<PrepView> = {}): PrepView {
  return {
    format: "cc", phase: "choose-first", yourSeat: 0,
    die: { rolls: [5, 3], winner: 0 },
    startPlayer: null,
    seats: [seat(), seat()],
    ...overrides,
  };
}

describe("next preparation step nudge", () => {
  it("waits 10 seconds before highlighting a step", () => {
    expect(PREP_NUDGE_DELAY_MS).toBe(10_000);
  });

  it("highlights the first-player choice only for the deciding player", () => {
    expect(nextPrepStep(prep())).toBe("first-player");
    expect(nextPrepStep(prep({ die: { rolls: [2, 6], winner: 1 } }))).toBeNull();
    expect(nextPrepStep(prep({ botGame: true, die: { rolls: [2, 6], winner: 1 } })))
      .toBe("first-player");
  });

  it("moves to arena lock, then ready, as each step completes", () => {
    expect(nextPrepStep(prep({ phase: "select-arena", startPlayer: 0 }))).toBe("arena");
    expect(nextPrepStep(prep({
      phase: "select-arena", startPlayer: 0, seats: [seat({ arenaLocked: true }), seat()],
    }))).toBeNull();
    expect(nextPrepStep(prep({
      phase: "select-deck", startPlayer: 0, seats: [seat({ arenaLocked: true }), seat()],
    }))).toBe("ready");
    expect(nextPrepStep(prep({
      phase: "select-deck", startPlayer: 0,
      seats: [seat({ arenaLocked: true, ready: true }), seat()],
    }))).toBeNull();
  });

  it("does not nudge without an opponent or during match acceptance", () => {
    expect(nextPrepStep(null)).toBeNull();
    expect(nextPrepStep(prep({ die: null, seats: [seat(), null] }))).toBeNull();
    expect(nextPrepStep(prep({ phase: "accept" }))).toBeNull();
  });
});
