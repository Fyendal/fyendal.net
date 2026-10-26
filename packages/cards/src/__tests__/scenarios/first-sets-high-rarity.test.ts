import { describe, expect, it } from "vitest";
import { functionalKeyOf } from "../../functional.js";
import { cardData } from "../../index.js";
import { printingId, scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

describe("WTR, ARC, and CRU high-rarity cards", () => {
  it("Heart of Fyendal gains life when pitched while behind", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["heart of fyendal|3", "blessing of deliverance|3"], life: 10, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });
    g.play("blessing of deliverance|3", { pitch: ["heart of fyendal|3"] }).expectLife(0, 11);
  });

  it("Remembrance shuffles up to 3 chosen graveyard actions into the deck", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["remembrance|2"],
        deck: ["raging onslaught|3"],
        graveyard: ["snatch|1", "snatch|2", "snatch|3", "head jab|1", "ironrot gauntlet|0"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("remembrance|2");
    const pd = g.state.pendingDecision!;
    expect(pd.chooseHook).toBe("remembrance-card");
    expect([pd.minimumSelections, pd.maximumSelections]).toEqual([0, 3]);
    expect(pd.options).toHaveLength(4);
    const graveyardId = (key: string) =>
      String(g.state.players[0]!.graveyard.find((c) => c.cardId === printingId(key))!.instanceId);
    const all = ["snatch|1", "snatch|2", "snatch|3", "head jab|1"].map(graveyardId);
    expect(() => g.doRaw({ kind: "choose-many", optionIds: all })).toThrow();
    g.chooseMany(all.slice(1))
      .settle()
      .expectZoneSize(0, "deck", 4)
      .expectInZone(0, "snatch|1", "graveyard")
      .expectInZone(0, "ironrot gauntlet|0", "graveyard")
      .expectInZone(0, "head jab|1", "deck")
      .expectInZone(0, "remembrance|2", "banish");
  });

  it("Argh... Smash! destroys up to half the roll of chosen opposing items", () => {
    const smash = (seed: number) => {
      const g = scenario({ seed, seats: [
        { hero: "rhinar", hand: ["argh... smash!|2"], resources: 3, equipment: NO_EQUIPMENT },
        {
          hero: "dorinthea",
          board: ["cognition nodes|3", "aether sink|2", "convection amplifier|1"],
          equipment: NO_EQUIPMENT,
        },
      ] });
      g.play("argh... smash!|2");
      return g;
    };
    let g = smash(1);
    for (let seed = 2; seed <= 40 && g.state.pendingDecision?.maximumSelections !== 2; seed++) g = smash(seed);
    const pd = g.state.pendingDecision!;
    expect(pd.chooseHook).toBe("smash-item");
    expect([pd.minimumSelections, pd.maximumSelections]).toEqual([0, 2]);
    expect(pd.options).toHaveLength(3);
    const boardId = (key: string) =>
      String(g.state.players[1]!.board.find((c) => c.cardId === printingId(key))!.instanceId);
    g.chooseMany([boardId("cognition nodes|3"), boardId("convection amplifier|1")])
      .settle()
      .expectInZone(1, "cognition nodes|3", "graveyard")
      .expectInZone(1, "convection amplifier|1", "graveyard")
      .expectInZone(1, "aether sink|2", "board");
  });

  it("Command and Conquer blocks defense reactions and destroys arsenal on hit", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["command and conquer|1"], resources: 2, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", arsenalFaceDown: ["sink below|1"], equipment: NO_EQUIPMENT },
    ] });
    g.play("command and conquer|1", { settle: false });
    expect(g.state.chain.at(-1)!.flags.noDefenseReactions).toBe(true);
    g.blockWith().settle().expectZoneSize(1, "arsenal", 0).expectInZone(1, "sink below|1", "graveyard");
  });

  it("Arknight Shard creates a Runechant when pitched", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["arknight shard|3", "stamp authority|3"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("stamp authority|3", { pitch: ["arknight shard|3"] });
    expect(g.state.players[0]!.board.some((card) => functionalKeyOf(cardData[card.cardId]!) === "runechant|0")).toBe(true);
  });

  it("Chain Lightning deals damage only after another Wizard non-attack action", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["chain lightning|2", "chain lightning|2"], resources: 2, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("chain lightning|2").expectLife(1, 20);
    g.play("chain lightning|2").expectLife(1, 17);
  });

  it.each(["WTR161", "1HP362", "JDG017"])(
    "%s Last Ditch Effort gains neither +4 nor go again while its controller has cards in deck",
    (printingId) => {
      const g = scenario({ seats: [
        {
          hero: "rhinar",
          hand: [printingId],
          deck: ["raging onslaught|1"],
          resources: 3,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ] });

      g.play(printingId)
        .expectAttackValue(4)
        .blockWith()
        .settle()
        .expectAP(0, 0);
    },
  );

  it("Last Ditch Effort gains +4 and go again when its controller has no cards in deck", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["WTR161"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("WTR161")
      .expectAttackValue(8)
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Coax a Commotion can give every hero all three benefits", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["coax a commotion|1"], deck: ["raging onslaught|1"], life: 10, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", deck: ["raging onslaught|1"], life: 10, equipment: NO_EQUIPMENT },
    ] });
    g.play("coax a commotion|1").blockWith().settle().chooseOption("all");
    for (const [seat, player] of g.state.players.entries()) {
      expect(player.life).toBe(seat === 0 ? 11 : 7);
      expect(player.hand).toHaveLength(1);
      expect(player.board.some((card) => functionalKeyOf(cardData[card.cardId]!) === "quicken|0")).toBe(true);
    }
  });

  it("Scabskin Leathers publicly logs the die roll and grants half as many action points", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", equipment: { ...NO_EQUIPMENT, legs: "scabskin leathers|0" } },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.activate("scabskin leathers|0");
    const flags = g.state.players[0]!.flags;
    const rolledKey = Object.keys(flags).find((key) => key.startsWith("rolledDie:"));
    expect(rolledKey, "no die roll was recorded").toBeTruthy();
    const roll = Number(rolledKey!.slice("rolledDie:".length));
    expect(
      g.state.log.some((entry) => / rolls \d+$/.test(entry.publicText ?? "")),
      `no public die-roll log line\nlast log: ${g.state.log.slice(-5).map((entry) => entry.publicText).join(" | ")}`,
    ).toBe(true);
    g.expectAP(0, Math.floor(roll / 2)); // the activation spent the turn's action point first
  });
});
