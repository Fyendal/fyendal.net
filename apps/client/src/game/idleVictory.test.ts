import { IDLE_VICTORY_MS } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { shouldShowIdleVictoryClaim } from "./idleVictory.js";

const eligibleClaim = {
  botGame: false,
  replaying: false,
  gameOver: false,
  waitingOnOpponent: true,
  opponentLastAction: 1_000,
  opponentIdleMs: IDLE_VICTORY_MS,
  dismissedFor: null,
};

describe("idle victory claim visibility", () => {
  it("shows for an eligible idle opponent in a live game", () => {
    expect(shouldShowIdleVictoryClaim(eligibleClaim)).toBe(true);
  });

  it("never shows while watching a replay", () => {
    expect(shouldShowIdleVictoryClaim({ ...eligibleClaim, replaying: true })).toBe(false);
  });

  it("never shows against a bot", () => {
    expect(shouldShowIdleVictoryClaim({ ...eligibleClaim, botGame: true })).toBe(false);
  });
});
