import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData, isImplemented, scripts } from "../../index.js";
import { scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

describe("IAR Silver Age precon cards", () => {
  it.each([["SAT", 34], ["SBW", 36]] as const)("registers every %s face with functional support", (set, count) => {
    const cards = Object.values(cardData).filter((card) => card.set === set);
    expect(cards).toHaveLength(count);
    expect(cards.filter((card) => !isImplemented(card))).toEqual([]);
    for (const card of cards) {
      if (card.backId) expect(cardData[card.backId]).toBeDefined();
    }
    expect(scripts.SBW001).toBe(scripts.IAR107);
    expect(scripts.SBW001B).toBe(scripts.IAR107B);
  });

  it.each(["SAT011", "SAT017", "SAT024"])("%s hits, gains life, and finds another Figment of Hope", (herald) => {
    const g = scenario({ seats: [
      {
        hero: "rhinar", heroKey: "SAT001", life: 10,
        hand: [herald], deck: ["SAT023"], board: ["SAT023"],
        resources: 2, weapons: [], equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, weapons: [], equipment: NO_EQUIPMENT },
    ] });
    g.play(herald).blockWith().settle().expectInZone(0, herald, "soul").expectLife(0, 11);
    expect(g.state.pendingDecision?.chooseHook).toBe("prism-figment-search");
    g.chooseCard("SAT023");
    expect(g.state.players[0]!.board.map((card) => card.cardId)).toEqual(["SAT023", "SAT023"]);
    g.expectLife(0, 11); // Entering with the front face does not awaken it.
  });

  it("Herald of Hope gains no life and stays out of soul when fully defended", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", heroKey: "SAT001", life: 10, hand: ["SAT024"], resources: 2, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["raging onslaught|1", "raging onslaught|2"], equipment: NO_EQUIPMENT },
    ] });
    g.play("SAT024").blockWith("raging onslaught|1", "raging onslaught|2").settle().expectLife(0, 10);
    expect(g.state.players[0]!.soul).toHaveLength(0);
  });

  it("awakens Figment of Hope once, gains life, and attacks with Suraya", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar", heroKey: "SAT001", life: 10,
        board: ["SAT023"], soul: ["SAT011"], resources: 4,
        weapons: [], equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, weapons: [], equipment: NO_EQUIPMENT },
    ] });
    const id = g.state.players[0]!.board[0]!.instanceId;
    g.activate("SAT001", { settle: false }).chooseCard("SAT011").chooseCard("SAT023").expectLife(0, 11);
    expect(g.state.players[0]!.board[0]).toMatchObject({ cardId: "SAT023B", instanceId: id, life: 4 });
    expect(g.state.players[0]!.board[0]!.subcards ?? []).toEqual([]);
    g.activate("SAT023B").blockWith().settle().expectLife(1, 16).expectLife(0, 11);
    expect(legalIntents(g.state, 0).filter((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === id
    )).toEqual([]);
  });

  it("Suraya's Ward 4 prevents four damage and destroys her", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["raging onslaught|1"], resources: 3, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", heroKey: "SAT001", life: 16, board: ["SAT023B"], equipment: NO_EQUIPMENT },
    ] });
    g.play("raging onslaught|1").blockWith().settle().chooseOption("destroy").expectLife(1, 13);
    expect(g.state.players[1]!.board).toHaveLength(0);
  });

  it("SBW Viserai traverses into his matching printed back face", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar", heroKey: "SBW001",
        hand: ["SBW021", "SBW021", "SBW021"],
        deck: ["SBW010", "SBW012", "SBW015"], resources: 3, equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("SBW021").play("SBW021").play("SBW021");
    expect(g.state.players[0]!.heroCardId).toBe("SBW001B");
    expect(g.state.players[0]!.banish).toHaveLength(3);
    g.expectLife(0, 20);
  });
});
