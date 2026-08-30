import { describe, expect, it } from "vitest";
import { runechantSequenceActive } from "../index.js";
import { makeGame } from "./fixtures.js";

describe("Runechant shortcut boundaries", () => {
  it("ends before a non-Runechant layer or unrelated priority window", () => {
    const state = makeGame();
    const runechant = {
      instanceId: state.nextInstanceId++,
      cardId: "RUNECHANT",
      owner: 0,
    };
    state.players[0]!.board.push(runechant);
    state.stack = [{
      sourceInstanceId: runechant.instanceId,
      seat: 0,
      triggerIndex: 0,
      label: "Destroy Runechant",
      optional: false,
    }];

    expect(runechantSequenceActive(state)).toBe(true);

    state.stack = [{
      sourceInstanceId: state.players[0]!.hero.instanceId,
      seat: 0,
      triggerIndex: 0,
      label: "A different trigger",
      optional: false,
    }];
    expect(runechantSequenceActive(state)).toBe(false);

    state.stack = [];
    state.pendingDecision = {
      player: 0,
      kind: "priority-window",
      prompt: "Priority — play an instant or pass",
    };
    expect(runechantSequenceActive(state)).toBe(false);
  });

  it("stays active through Runechant damage-prevention decisions", () => {
    const state = makeGame();
    state.stack = [];
    state.pendingDecision = {
      player: 1,
      kind: "optional-effect",
      prompt: "Prevent Runechant damage?",
      chooseHook: "spellvoid",
      options: ["decline"],
      arcane: {
        sourceInstanceId: 99,
        sourceSeat: 0,
        targetSeat: 1,
        amount: 1,
        arcane: true,
        sourceIsRunechant: true,
      },
    };

    expect(runechantSequenceActive(state)).toBe(true);
  });
});
