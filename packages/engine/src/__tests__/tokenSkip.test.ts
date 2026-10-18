import { describe, expect, it } from "vitest";
import { legalIntents, tokenSkipSequenceActive } from "../index.js";
import { makeGame } from "./fixtures.js";

function tokenLayer(state: ReturnType<typeof makeGame>, cardId: string) {
  const token = { instanceId: state.nextInstanceId++, cardId, owner: 0 };
  state.players[0]!.board.push(token);
  return {
    sourceInstanceId: token.instanceId,
    seat: 0,
    triggerIndex: 0,
    label: "Destroy token",
    optional: false,
  };
}

describe("token shortcut boundaries", () => {
  it("ends before a non-Runechant layer or unrelated priority window", () => {
    const state = makeGame();
    state.stack = [tokenLayer(state, "RUNECHANT")];

    expect(tokenSkipSequenceActive(state, "runechant")).toBe(true);
    expect(tokenSkipSequenceActive(state, "seismic-surge")).toBe(false);

    state.stack = [{
      sourceInstanceId: state.players[0]!.hero.instanceId,
      seat: 0,
      triggerIndex: 0,
      label: "A different trigger",
      optional: false,
    }];
    expect(tokenSkipSequenceActive(state, "runechant")).toBe(false);

    state.stack = [];
    state.pendingDecision = {
      player: 0,
      kind: "priority-window",
      prompt: "Priority — play an instant or pass",
    };
    expect(tokenSkipSequenceActive(state, "runechant")).toBe(false);
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

    expect(tokenSkipSequenceActive(state, "runechant")).toBe(true);
  });

  it("offers only the Seismic Surge skip over a Seismic Surge layer", () => {
    const state = makeGame();
    state.stack = [tokenLayer(state, "SURGE")];
    state.pendingDecision = {
      player: 0,
      kind: "priority-window",
      prompt: "Priority — play an instant or pass",
    };

    expect(tokenSkipSequenceActive(state, "seismic-surge")).toBe(true);
    const legal = legalIntents(state, 0);
    expect(legal).toContainEqual({ kind: "skip-seismic-surge" });
    expect(legal).not.toContainEqual({ kind: "skip-runechant" });
    expect(legalIntents(state, 1)).not.toContainEqual({ kind: "skip-seismic-surge" });
  });
});
