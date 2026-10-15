import { describe, expect, it } from "vitest";
import { cardData } from "../../catalog.js";
import { functionalKeyOf } from "../../functional.js";
import { printingId, scenario, type Scenario } from "../harness.js";

const SEISMIC_SURGE_TOKEN = "CRU044";
const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function boardKeys(g: Scenario, seat: number): string[] {
  return g.state.players[seat]!.board.map((card) => functionalKeyOf(cardData[card.cardId]!));
}

describe("PEN / WTR / EVR enter and leave arena triggers use the stack", () => {
  it("Rites of Earthlore creates its Seismic Surge only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["rites of earthlore|1"], equipment: NO_EQUIPMENT }, { hero: "dorinthea" }],
    });

    g.play("rites of earthlore|1", { settle: false });
    g.passUntilLayer("Create a Seismic Surge token");
    expect(g.state.stack).toEqual([expect.objectContaining({ label: "Create a Seismic Surge token" })]);
    expect(boardKeys(g, 0)).toEqual(["rites of earthlore|1"]);

    g.passPriority().passPriority();
    expect(g.state.stack).toEqual([]);
    expect(boardKeys(g, 0)).toContain("seismic surge|0");
  });

  it("Distant Rumbling draws and asks for the fifth-from-top card only on resolution", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["distant rumbling|3"],
          deck: ["head jab|2", "head jab|3", "smash instinct|1", "smash instinct|2", "smash instinct|3"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("distant rumbling|3", { settle: false });
    const label = "Draw a card, then put a card from your hand fifth from the top";
    g.passUntilLayer(label);
    expect(g.state.stack).toEqual([expect.objectContaining({ label })]);
    g.expectHandSize(0, 0);

    g.passPriority().passPriority();
    expect(g.state.pendingDecision?.chooseHook).toBe("pen-rumbling-hand");
    g.chooseCard("head jab|2").expectHandSize(0, 0);
    expect(g.state.players[0]!.deck[4]?.cardId).toBe(printingId("head jab|2"));
  });

  it("Channel the Skybreaker creates Might from its enter trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["channel the skybreaker|2"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea" },
      ],
    });

    g.play("channel the skybreaker|2", { settle: false });
    g.passUntilLayer("Create 2 Might tokens");
    expect(g.state.stack).toEqual([expect.objectContaining({ label: "Create 2 Might tokens" })]);
    expect(boardKeys(g, 0)).toEqual(["channel the skybreaker|2"]);

    g.passPriority().passPriority();
    expect(boardKeys(g, 0).filter((key) => key.startsWith("might|"))).toHaveLength(2);
  });

  it("Sigil of Voltaris deals arcane damage only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["sigil of voltaris|3"], equipment: NO_EQUIPMENT }, { hero: "dorinthea" }],
    });
    const life = g.state.players[1]!.life;

    g.play("sigil of voltaris|3", { settle: false });
    g.passUntilLayer("Deal 1 arcane damage to target hero");
    expect(g.state.stack).toEqual([expect.objectContaining({ label: "Deal 1 arcane damage to target hero" })]);
    g.expectLife(1, life);

    g.passPriority().passPriority();
    g.expectLife(1, life - 1);
  });

  it("Channel Galcia's Cradle declares its freeze target as the enter trigger goes on the stack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["channel galcia's cradle|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", board: [SEISMIC_SURGE_TOKEN], equipment: NO_EQUIPMENT },
      ],
    });
    const surge = g.state.players[1]!.board[0]!;

    g.play("channel galcia's cradle|3", { settle: false });
    g.passUntilLayer("Freeze target ally, aura, item, or equipment");
    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    expect(g.state.pendingDecision?.cardOptions).toContain(surge.instanceId);
    g.doRaw({ kind: "choose", optionId: String(surge.instanceId) });

    expect(g.state.stack).toEqual([
      expect.objectContaining({ label: "Freeze target ally, aura, item, or equipment" }),
    ]);
    expect(g.state.players[1]!.board[0]!.counters?.frozenUntilTurn).toBeUndefined();

    g.passPriority().passPriority();
    expect(g.state.stack).toEqual([]);
    expect(Number(g.state.players[1]!.board[0]!.counters?.frozenUntilTurn)).toBeGreaterThan(g.state.turn);
  });

  it("Gloves of Erasure destroys its declared aura token target when its leave trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["raging onslaught|3"], board: [SEISMIC_SURGE_TOKEN] },
        { hero: "dorinthea", equipment: { arms: "gloves of erasure|0" } },
      ],
    });
    const surge = g.state.players[0]!.board[0]!;
    const label = "Destroy target aura token";

    g.play("raging onslaught|3").blockWith("gloves of erasure|0");
    for (let i = 0; i < 12 && g.state.pendingDecision?.chooseHook !== "trigger-target"; i++) g.passPriority();

    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    g.expectInZone(1, "gloves of erasure|0", "graveyard");
    g.doRaw({ kind: "choose", optionId: String(surge.instanceId) });

    expect(g.state.stack).toEqual([expect.objectContaining({ label })]);
    g.expectZoneSize(0, "board", 1);

    g.passPriority().passPriority();
    g.expectZoneSize(0, "board", 0);
  });

  it("Graven equipment equipped from the graveyard does not trigger its -1 defense counter", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", graveyard: ["graven cowl|0"], board: ["silver|0", "silver|0"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.endTurn().endTurn().chooseOption("yes");
    g.expectEquipped(0, "head", "graven cowl|0");
    expect(g.state.stack.some((layer) => layer.label === "Put a -1 defense counter on this")).toBe(false);
    expect(g.state.players[0]!.equipment.head?.defCounters ?? 0).toBe(0);
  });
});
