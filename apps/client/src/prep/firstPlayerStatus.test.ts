import { describe, expect, it } from "vitest";
import { canChooseFirst, canReadyForGame, firstPlayerStatus } from "./firstPlayerStatus.js";

describe("prep first-player status", () => {
  it("blocks Ready until first or second has been chosen", () => {
    expect(canReadyForGame({ accepting: false, startPlayer: null })).toBe(false);
    expect(canReadyForGame({ accepting: true, startPlayer: 0 })).toBe(false);
    expect(canReadyForGame({ accepting: false, startPlayer: 1 })).toBe(true);
  });

  it("leaves the user's pending decision to the choice buttons", () => {
    expect(firstPlayerStatus({
      opponentPresent: true,
      dieWinner: 0,
      startPlayer: null,
      yourSeat: 0,
    })).toBeNull();
  });

  it("describes an opponent's pending decision without exposing their username", () => {
    expect(firstPlayerStatus({
      opponentPresent: true,
      dieWinner: 1,
      startPlayer: null,
      yourSeat: 0,
    })).toBe("opponent-deciding");
  });

  it("lets the human choose in a bot game even when the bot wins the roll", () => {
    expect(canChooseFirst({ botGame: true, dieWinner: 1, yourSeat: 0 })).toBe(true);
    expect(firstPlayerStatus({
      opponentPresent: true,
      botGame: true,
      dieWinner: 1,
      startPlayer: null,
      yourSeat: 0,
    })).toBeNull();
  });

  it.each([
    [0, 0, "you-decided-first"],
    [0, 1, "you-decided-second"],
    [1, 0, "opponent-decided-first"],
    [1, 1, "opponent-decided-second"],
  ] as const)("describes the result for winner %s and first player %s", (dieWinner, startPlayer, expected) => {
    expect(firstPlayerStatus({
      opponentPresent: true,
      dieWinner,
      startPlayer,
      yourSeat: 0,
    })).toBe(expected);
  });

  it("describes pre-roll waiting states", () => {
    expect(firstPlayerStatus({
      opponentPresent: false,
      dieWinner: null,
      startPlayer: null,
      yourSeat: 0,
    })).toBe("waiting-opponent");
    expect(firstPlayerStatus({
      opponentPresent: true,
      dieWinner: null,
      startPlayer: null,
      yourSeat: 0,
    })).toBe("waiting-roll");
  });
});
