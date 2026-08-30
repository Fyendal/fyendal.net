import { describe, expect, it } from "vitest";
import { derivePrepReadiness } from "./readiness.js";

const READY_INPUT = {
  accepting: false,
  mainCountValid: true,
  opponentPresent: true,
  opponentReady: false,
  opponentConnected: true,
  ready: false,
  startPlayer: 0 as const,
};

describe("prep readiness", () => {
  it("allows ready only after the opponent, first player, and deck count are resolved", () => {
    expect(derivePrepReadiness(READY_INPUT)).toEqual({
      canReady: true,
      blockingReason: null,
      opponentStatus: "preparing",
    });
  });

  it.each([
    [{ opponentPresent: false }, "Waiting for an opponent to join."],
    [{ startPlayer: null }, "Choose who goes first before readying your deck."],
    [{ mainCountValid: false }, "Adjust the main deck to meet the format requirement."],
    [{ accepting: true }, "Accept the match before readying your deck."],
  ] as const)("reports one actionable blocking reason", (change, reason) => {
    const result = derivePrepReadiness({ ...READY_INPUT, ...change });
    expect(result.canReady).toBe(false);
    expect(result.blockingReason).toBe(reason);
  });

  it("distinguishes ready and disconnected opponents without changing readiness", () => {
    expect(derivePrepReadiness({ ...READY_INPUT, opponentReady: true }).opponentStatus).toBe("ready");
    expect(derivePrepReadiness({ ...READY_INPUT, opponentConnected: false }).opponentStatus).toBe("disconnected");
  });
});
