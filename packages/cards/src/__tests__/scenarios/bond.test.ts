import { describe, expect, it } from "vitest";
import type { CardInstance } from "@fyendal/engine";
import { cardData, scripts } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { scenario, type Scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;
const EARTH = "autumn's touch|3";
const LIGHTNING = "heaven's claws|3";

function countOnBoard(g: Scenario, seat: number, key: string): number {
  return g.state.players[seat]!.board.filter(
    (card: CardInstance) => functionalKeyOf(cardData[card.cardId]!) === key,
  ).length;
}

describe("Earth Bond and Lightning Bond", () => {
  it("keeps an explicit inventory with paid-card hooks for every Bond card", () => {
    const bondPrintings = Object.values(cardData)
      .filter((card) => card.keywords?.some(
        (keyword) => keyword === "Earth Bond" || keyword === "Lightning Bond",
      ));
    const actual = [...new Set(bondPrintings.map(functionalKeyOf))].sort();
    const expected = [
      "ancient earth oak|1",
      "arc bending|1",
      "bracken rap|1",
      "bracken rap|2",
      "laden with earth|1",
      "laden with lightning|1",
      "leaven sheath|1",
      "log fall|1",
      "log fall|2",
      "seeds of strength|1",
      "seeds of strength|2",
      "seeds of strength|3",
      "stormwind sheath|1",
      "strong wood|1",
      "strong wood|2",
      "verdant tide|1",
      "voltic veil|1",
    ].sort();

    expect(actual).toEqual(expected);
    expect(bondPrintings
      .filter((card) => typeof scripts[card.id]?.onPlayCostPaid !== "function")
      .map((card) => card.id))
      .toEqual([]);
  });

  for (const key of ["bracken rap|1", "bracken rap|2"]) {
    it(`${key} creates a Might when paid for with Earth`, () => {
      const g = scenario({ seats: [
        { hero: "rhinar", hand: [key, EARTH], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ] });

      g.play(key, { pitch: [EARTH] });
      expect(countOnBoard(g, 0, "might|0")).toBe(1);
    });
  }

  for (const key of ["log fall|1", "log fall|2"]) {
    it(`${key} gets overpower when paid for with Earth`, () => {
      const g = scenario({ seats: [
        { hero: "rhinar", hand: [key, EARTH], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ] });

      g.play(key, { pitch: [EARTH] });
      expect(g.state.modifiers).toContainEqual(expect.objectContaining({
        sourceInstanceId: g.state.chain.at(-1)?.attackingCard.instanceId,
        scope: "chain-link",
        overpower: true,
      }));
    });
  }

  for (const key of ["strong wood|1", "strong wood|2"]) {
    it(`${key} gets +1 power when paid for with Earth`, () => {
      const base = cardData[Object.keys(cardData).find(
        (id) => functionalKeyOf(cardData[id]!) === key,
      )!]!.attack!;
      const g = scenario({ seats: [
        { hero: "rhinar", hand: [key, EARTH], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ] });

      g.play(key, { pitch: [EARTH] }).expectAttackValue(base + 1);
    });
  }

  for (const [key, expectedMight] of [
    ["seeds of strength|1", 4],
    ["seeds of strength|2", 3],
    ["seeds of strength|3", 2],
  ] as const) {
    it(`${key} creates one additional Might when paid for with Earth`, () => {
      const g = scenario({ seats: [
        { hero: "rhinar", hand: [key, EARTH], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ] });

      g.play(key, { pitch: [EARTH] });
      expect(countOnBoard(g, 0, "might|0")).toBe(expectedMight);
    });
  }

  it("Verdant Tide applies its replacement effect to its Earth Bond token", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["verdant tide|1", EARTH, "read the runes|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("verdant tide|1", { pitch: [EARTH] });
    expect(countOnBoard(g, 0, "embodiment of earth|0")).toBe(2);
    g.play("read the runes|1");
    expect(countOnBoard(g, 0, "runechant|0")).toBe(4);
  });

  for (const [card, pitch, token] of [
    ["laden with earth|1", EARTH, "embodiment of earth|0"],
    ["laden with lightning|1", LIGHTNING, "embodiment of lightning|0"],
  ] as const) {
    it(`${card} creates its Bond token and buffs the next attack`, () => {
      const g = scenario({ seats: [
        { hero: "rhinar", hand: [card, pitch, "head jab|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ] });

      g.play(card, { pitch: [pitch] });
      expect(countOnBoard(g, 0, token)).toBe(1);
      g.play("head jab|1").expectAttackValue(6);
    });
  }

  for (const [card, pitch, token] of [
    ["leaven sheath|1", EARTH, "embodiment of earth|0"],
    ["stormwind sheath|1", LIGHTNING, "embodiment of lightning|0"],
  ] as const) {
    it(`${card} creates its Bond token when played as a defense reaction`, () => {
      const g = scenario({ seats: [
        { hero: "rhinar", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: [card, pitch], equipment: NO_EQUIPMENT },
      ] });

      g.play("head jab|1")
        .blockWith()
        .passPriority()
        .react(card, { pitch: [pitch] })
        .settle();
      expect(countOnBoard(g, 1, token)).toBe(1);
    });
  }

  it("does not apply TER Earth Bond without an Earth payment", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["strong wood|1", "raging onslaught|3"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("strong wood|1", { pitch: ["raging onslaught|3"] })
      .expectAttackValue(6);
  });

  it("does not apply PEN Earth Bond without an Earth payment", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["seeds of strength|1", "raging onslaught|3"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("seeds of strength|1", { pitch: ["raging onslaught|3"] });
    expect(countOnBoard(g, 0, "might|0")).toBe(3);
  });

  it("does not apply PEN Lightning Bond without a Lightning payment", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["voltic veil|1", "raging onslaught|3"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("voltic veil|1", { pitch: ["raging onslaught|3"] })
      .expectLife(1, 20);
  });

  it("does not apply Ancient Earth Oak's Earth Bond without an Earth payment", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["ancient earth oak|1", "raging onslaught|3"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("ancient earth oak|1", { pitch: ["raging onslaught|3"] })
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .doRaw({ kind: "close-chain" })
      .expectInZone(0, "ancient earth oak|1", "graveyard");
  });
});
