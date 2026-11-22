import { describe, expect, it } from "vitest";
import type { GameState } from "@fyendal/engine";
import { advanceClock, awaitedSeat, clockView, startClock } from "../clock.js";

/** Only the fields the clock reads. */
function state(awaiting: 0 | 1, phase: GameState["phase"] = "action"): GameState {
  return { phase, priorityPlayer: awaiting, pendingDecision: null } as unknown as GameState;
}

describe("game clock", () => {
  it("awaits the pending decision's seat, else the action-phase priority seat", () => {
    expect(awaitedSeat(state(1))).toBe(1);
    expect(awaitedSeat({
      ...state(0, "reaction"),
      pendingDecision: { player: 1, kind: "priority-window", prompt: "" },
    } as GameState)).toBe(1);
    expect(awaitedSeat(state(0, "end"))).toBeNull();
    expect(awaitedSeat(state(0, "game-over"))).toBeNull();
    expect(awaitedSeat(null)).toBeNull();
  });

  it("charges each interval to the seat awaited before the commit", () => {
    let clock = startClock(state(0), 1_000);
    clock = advanceClock(clock, state(1), 4_000);
    clock = advanceClock(clock, state(0), 6_000);
    expect(clock).toEqual({ awaiting: 0, since: 6_000, seatMs: [3_000, 2_000] });
  });

  it("charges nothing for seats a single commit passes through", () => {
    // Seat 1's auto-passed window happens inside the commit, so it never becomes awaited.
    expect(advanceClock(startClock(state(0), 0), state(0), 500).seatMs).toEqual([500, 0]);
  });

  it("clamps a backwards clock to zero", () => {
    const clock = advanceClock(startClock(state(0), 5_000), state(0), 4_000);
    expect(clock).toEqual({ awaiting: 0, since: 5_000, seatMs: [0, 0] });
  });

  it("never refunds time when a commit returns to an earlier state", () => {
    let clock = startClock(state(1), 0);
    clock = advanceClock(clock, state(0), 1_000);
    clock = advanceClock(clock, state(1), 1_500); // undo
    clock = advanceClock(clock, state(0), 2_500);
    expect(clock.seatMs).toEqual([500, 2_000]);
  });

  it("stops at game over", () => {
    let clock = advanceClock(startClock(state(1), 0), state(1, "game-over"), 700);
    expect(clock).toMatchObject({ awaiting: null, seatMs: [0, 700] });
    clock = advanceClock(clock, state(1, "game-over"), 100_000);
    expect(clock.seatMs).toEqual([0, 700]);
  });

  it("views the running interval without changing the stored clock", () => {
    const clock = startClock(state(1), 1_000);
    expect(clockView(clock, 3_500)).toEqual({ awaiting: 1, seatMs: [0, 2_500] });
    expect(clock.seatMs).toEqual([0, 0]);
  });
});
