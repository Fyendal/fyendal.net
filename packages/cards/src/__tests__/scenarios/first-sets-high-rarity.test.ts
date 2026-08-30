import { describe, expect, it } from "vitest";
import { functionalKeyOf } from "../../functional.js";
import { cardData } from "../../index.js";
import { scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

describe("WTR, ARC, and CRU high-rarity cards", () => {
  it("Heart of Fyendal gains life when pitched while behind", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["heart of fyendal|3", "blessing of deliverance|3"], life: 10, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });
    g.play("blessing of deliverance|3", { pitch: ["heart of fyendal|3"] }).expectLife(0, 11);
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
