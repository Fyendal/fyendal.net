import { describe, expect, it } from "vitest";
import { cardData, isImplemented } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function goldCount(g: ReturnType<typeof scenario>, seat: number): number {
  return g.state.players[seat]!.board.filter(
    (card) => functionalKeyOf(cardData[card.cardId]!) === "gold|0",
  ).length;
}

describe("SPW — Smash Palace heroes and weapons", () => {
  it("registers every SPW printing as implemented", () => {
    const cards = Object.values(cardData).filter((card) => card.set === "SPW");
    expect(cards).toHaveLength(4);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
  });

  it("Cutpurse Rapier steals Gold on hit and Killjoy's boo drains a healthier hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "killjoy, the crooked blade|0",
          weapons: ["cutpurse rapier|0"],
          equipment: NO_EQUIPMENT,
          resources: 1,
          life: 20,
        },
        { hero: "rhinar", board: ["gold|0", "gold|0"], equipment: NO_EQUIPMENT, life: 30 },
      ],
    });
    g.activate("cutpurse rapier|0")
      .blockWith()
      .settle()
      .expectLog("The crowd boos")
      .expectLife(1, 26);
    expect(goldCount(g, 0)).toBe(1);
    expect(goldCount(g, 1)).toBe(1);
  });

  it("Killjoy loses no life to their own boo and spares heroes with less life", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "killjoy, the crooked blade|0",
          weapons: ["cutpurse rapier|0"],
          equipment: NO_EQUIPMENT,
          resources: 1,
          life: 20,
        },
        { hero: "rhinar", board: ["gold|0"], equipment: NO_EQUIPMENT, life: 15 },
      ],
    });
    g.activate("cutpurse rapier|0")
      .blockWith()
      .settle()
      .expectLog("The crowd boos")
      .expectLife(0, 20)
      .expectLife(1, 12);
  });

  it("Zane's first cheer each turn draws for each hero and Celebrant Broadsword gets go again", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "zane, broadly beloved|0",
          weapons: ["celebrant broadsword|0"],
          equipment: NO_EQUIPMENT,
          hand: ["jaws of victory|1"],
          deck: ["raging onslaught|3", "raging onslaught|3"],
          resources: 4,
          life: 10,
        },
        {
          hero: "rhinar",
          hand: [],
          deck: ["raging onslaught|3"],
          equipment: NO_EQUIPMENT,
          life: 30,
        },
      ],
    });
    g.play("jaws of victory|1")
      .blockWith()
      .settle()
      .expectLog("The crowd cheers")
      .expectAP(0, 1)
      .expectHandSize(0, 1)
      .expectHandSize(1, 1)
      .activate("celebrant broadsword|0")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Celebrant Broadsword has no go again without a cheer", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["celebrant broadsword|0"],
          equipment: NO_EQUIPMENT,
          resources: 2,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("celebrant broadsword|0")
      .blockWith()
      .settle()
      .expectAP(0, 0);
  });

  it("Zane's crowd cheers when Zane wins a wager", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "zane, broadly beloved|0",
          equipment: NO_EQUIPMENT,
          hand: ["wage gold|1"],
          deck: ["raging onslaught|3"],
          resources: 3,
        },
        { hero: "rhinar", hand: [], deck: ["raging onslaught|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("wage gold|1")
      .chooseOption("yes")
      .blockWith()
      .settle()
      .expectLog("wins the wager")
      .expectLog("The crowd cheers")
      .expectHandSize(0, 1)
      .expectHandSize(1, 1);
    expect(g.state.players[0]!.flags.cheeredThisTurn).toBe(true);
  });
});
