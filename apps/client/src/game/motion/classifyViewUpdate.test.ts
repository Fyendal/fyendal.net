import { describe, expect, it } from "vitest";
import type { GameView, PlayerView } from "@fyendal/shared";
import { classifyViewUpdate } from "./classifyViewUpdate.js";

function player(seat: 0 | 1): PlayerView {
  return {
    seat,
    heroCardId: `HERO-${seat}`,
    heroInstanceId: seat,
    heroName: `Hero ${seat}`,
    life: 20,
    actionPoints: 1,
    resources: 0,
    hand: [],
    handCount: 0,
    deckCount: 0,
    arsenal: [],
    arsenalCount: 0,
    pitch: [],
    pitchCount: 0,
    graveyard: [],
    banish: [],
    soul: [],
    equipment: {},
    weapons: [],
    board: [],
  };
}

function game(log: string[], gameId = "game"): GameView {
  return {
    gameId,
    turn: 1,
    phase: "action",
    activePlayer: 0,
    priorityPlayer: 0,
    players: [player(0), player(1)],
    chain: [],
    stack: [],
    ongoing: [],
    pendingDecision: null,
    winner: null,
    log,
  };
}

describe("view update motion classification", () => {
  it("animates a continuous forward live update", () => {
    expect(classifyViewUpdate(
      game(["action one"]),
      game(["action one", "action two"]),
      { sequence: 2, source: "live", transition: "forward", roomVersion: 2 },
    )).toEqual({ kind: "animate", direction: "forward" });
  });

  it("settles initial loads, replacements, jumps, and different games", () => {
    expect(classifyViewUpdate(null, game([]), {
      sequence: 1,
      source: "live",
      transition: "replace",
      roomVersion: 1,
    })).toEqual({ kind: "settle", reason: "initial" });
    expect(classifyViewUpdate(game([]), game([]), {
      sequence: 2,
      source: "restore",
      transition: "replace",
    })).toEqual({ kind: "settle", reason: "replacement" });
    expect(classifyViewUpdate(game([]), game([]), {
      sequence: 3,
      source: "replay",
      transition: "jump",
      replayStep: 5,
    })).toEqual({ kind: "settle", reason: "jump" });
    expect(classifyViewUpdate(game([], "first"), game([], "second"), {
      sequence: 4,
      source: "live",
      transition: "forward",
      roomVersion: 4,
    })).toEqual({ kind: "settle", reason: "different-game" });
  });

  it("recognizes an undo instead of replaying restored cards forward", () => {
    expect(classifyViewUpdate(
      game(["action one", "action two"]),
      game(["action one"]),
      { sequence: 3, source: "live", transition: "forward", roomVersion: 3 },
    )).toEqual({ kind: "settle", reason: "undo" });
  });

  it("animates an adjacent replay step backward", () => {
    expect(classifyViewUpdate(
      game(["action one", "action two"]),
      game(["action one"]),
      { sequence: 4, source: "replay", transition: "backward", replayStep: 0 },
    )).toEqual({ kind: "animate", direction: "backward" });
  });

  it("suppresses unrelated log histories as a likely resync", () => {
    expect(classifyViewUpdate(
      game(["old action"]),
      game(["unrelated action"]),
      { sequence: 5, source: "live", transition: "forward", roomVersion: 5 },
    )).toEqual({ kind: "settle", reason: "discontinuous-log" });
  });
});
