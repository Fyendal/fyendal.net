import { describe, expect, it } from "vitest";
import { functionalKeyOf } from "../../functional.js";
import { cardData } from "../../index.js";
import { scenario, type Scenario, type SeatSpec } from "../harness.js";

// Suspense auras and the crowd auras: their printed "when this enters / leaves
// the arena" abilities are stack layers, while suspense counters and the
// suspense-left bookkeeping still happen as the aura moves.

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function seat(hero: SeatSpec["hero"], spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero, weapons: [], ...spec, equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) } };
}

function boardKeys(g: Scenario, seatIndex: number): string[] {
  return g.state.players[seatIndex]!.board.map((card) => functionalKeyOf(cardData[card.cardId]!));
}

describe("suspense and crowd auras trigger through the stack", () => {
  it("Superstar enters with suspense counters at once and cheers only when its trigger resolves", () => {
    const g = scenario({ seats: [seat("rhinar", { hand: ["superstar|3"], resources: 1 }), seat("dorinthea")] });

    g.play("superstar|3", { settle: false });
    g.passUntilLayer("The crowd cheers you");

    const aura = g.state.players[0]!.board[0]!;
    expect(aura.counters?.suspense).toBe(2);
    expect(g.state.players[0]!.flags.cheeredThisTurn).toBeFalsy();

    g.passPriority().passPriority();
    expect(g.stackLabels()).not.toContain("The crowd cheers you");
    expect(g.state.players[0]!.flags.cheeredThisTurn).toBe(true);
  });

  // Start-phase layers resolve without priority, so these use Pleiades's
  // counter-removal cost to destroy the aura while players hold priority.
  function pleiadesRemovesLastCounter(aura: string, hand: string[] = [], foeHand: string[] = []): Scenario {
    const g = scenario({
      seats: [
        seat("rhinar", {
          heroKey: "pleiades, superstar|0",
          board: [aura, "in the palm of your hand|1"],
          hand,
        }),
        seat("dorinthea", { hand: foeHand }),
      ],
    });
    for (const card of g.state.players[0]!.board) card.counters = { suspense: 1 };
    g.activate("pleiades, superstar|0", { settle: false });
    const paid = g.state.players[0]!.board.find((card) => functionalKeyOf(cardData[card.cardId]!) === aura)!;
    g.doRaw({ kind: "choose", optionId: String(paid.instanceId) });
    return g;
  }

  it("Tension in the Air buffs the next attack only when its leave trigger resolves", () => {
    const g = pleiadesRemovesLastCounter("tension in the air|3", ["head jab|1"]);

    // The leave trigger goes above the Pleiades ability before priority.
    expect(g.stackLabels()).toEqual(["Your next attack this turn gets +2 attack", "Pleiades, Superstar"]);
    g.expectInZone(0, "tension in the air|3", "graveyard");
    expect(g.state.players[0]!.flags.suspenseAurasLeftThisTurn).toBe(1);

    g.passPriority().passPriority();
    expect(g.stackLabels()).toEqual(["Pleiades, Superstar"]);
    g.passPriority().passPriority().chooseOption("pass");
    g.play("head jab|1").expectAttackValue(5);
  });

  it("Leave Them Hanging puts each of its leave abilities on the stack", () => {
    const g = pleiadesRemovesLastCounter("leave them hanging|1", [], ["head jab|1"]);

    // Two distinct leave abilities: their controller orders them.
    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-order");
    expect(g.state.pendingDecision?.optionLabels).toEqual([
      "Intimidate",
      "Your next attack this turn gets +4 attack",
    ]);
    while (g.state.pendingDecision?.chooseHook === "trigger-order") {
      g.doRaw({ kind: "choose", optionId: g.state.pendingDecision.options![0]! });
    }
    expect(g.stackLabels()).toEqual(["Intimidate", "Your next attack this turn gets +4 attack", "Pleiades, Superstar"]);
    g.expectInZone(1, "head jab|1", "hand");

    g.passPriority().passPriority();
    g.expectInZone(1, "head jab|1", "banish");
  });

  it("Dramatic Pause declares its defending target as the enter trigger goes on the stack", () => {
    const g = scenario({
      seats: [
        seat("dorinthea", { hand: ["head jab|1"] }),
        seat("rhinar", { hand: ["head jab|1", "dramatic pause|1"] }),
      ],
    });

    g.play("head jab|1").blockWith("head jab|1");
    g.passPriority().react("dramatic pause|1", { settle: false });
    for (let i = 0; i < 6 && g.state.pendingDecision?.chooseHook !== "trigger-target"; i++) g.passPriority();

    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    const defender = g.state.chain.at(-1)!.defendingCards[0]!;
    expect(g.state.pendingDecision?.options).toEqual([String(defender.instanceId)]);
    g.doRaw({ kind: "choose", optionId: String(defender.instanceId) });

    expect(g.stackLabels()).toContain("Target defending action card gets +3 defense");
    expect(boardKeys(g, 1)).toEqual(["dramatic pause|1"]);
    const life = g.state.players[1]!.life;

    // Head Jab's 3 power is fully blocked only with the +3 defense.
    g.passPriority().passPriority();
    expect(g.stackLabels()).not.toContain("Target defending action card gets +3 defense");
    g.settle().expectLife(1, life);
  });

  it("Channel the Tranquil Domain bottoms its declared target aura when the enter trigger resolves", () => {
    const g = scenario({
      seats: [
        seat("rhinar", { hand: ["channel the tranquil domain|2"], resources: 3 }),
        seat("dorinthea", { board: ["tension in the air|3", "in the palm of your hand|1"] }),
      ],
    });

    g.play("channel the tranquil domain|2", { settle: false });
    for (let i = 0; i < 6 && g.state.pendingDecision?.chooseHook !== "trigger-target"; i++) g.passPriority();

    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    const palm = g.state.players[1]!.board.find(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "in the palm of your hand|1",
    )!;
    const self = g.state.players[0]!.board[0]!;
    expect(g.state.pendingDecision?.options).not.toContain(String(self.instanceId));
    g.doRaw({ kind: "choose", optionId: String(palm.instanceId) });

    expect(g.stackLabels()).toContain("Put another target aura on the bottom of its owner's deck");
    expect(boardKeys(g, 1)).toContain("in the palm of your hand|1");

    g.passPriority().passPriority();
    // Palm leaves the arena, so its own leave trigger (draw) follows.
    g.expectDeckBottom(1, "in the palm of your hand|1");
    expect(boardKeys(g, 1)).toEqual(["tension in the air|3"]);
    expect(g.stackLabels()).toContain("Draw a card");
  });
});
