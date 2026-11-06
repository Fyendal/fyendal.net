import { describe, expect, it } from "vitest";
import { cardData, isImplemented } from "../../index.js";
import { scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function zuul(extra: Record<string, unknown> = {}) {
  return {
    hero: "rhinar" as const,
    heroKey: "zuul, clubcaste|0",
    weapons: ["deathbeat bludgeon|0"],
    equipment: NO_EQUIPMENT,
    ...extra,
  };
}

function babaza(extra: Record<string, unknown> = {}) {
  return {
    hero: "rhinar" as const,
    heroKey: "babaza, bloodbeat heartfather|0",
    equipment: NO_EQUIPMENT,
    ...extra,
  };
}

const OPPONENT = { hero: "dorinthea" as const, equipment: NO_EQUIPMENT };

describe("MPB — Brute mastery", () => {
  it("registers every MPB printing as implemented", () => {
    const cards = Object.values(cardData).filter((card) => card.set === "MPB");
    expect(cards).toHaveLength(8);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
  });

  it("Beat of Savagery gains 4 after beating chest and Deathbeat Bludgeon gets +1", () => {
    const g = scenario({
      seats: [zuul({ hand: ["beat of savagery|3", "raging onslaught|1"] }), OPPONENT],
    });
    g.play("beat of savagery|3")
      .chooseCard("raging onslaught|1")
      .expectResources(0, 4)
      .expectAP(0, 1)
      .attackWithWeapon("deathbeat bludgeon|0")
      .expectAttackValue(5);
  });

  it("Beat of Savagery gains nothing when chest is not beaten", () => {
    const g = scenario({ seats: [zuul({ hand: ["beat of savagery|3", "raging onslaught|1"] }), OPPONENT] });
    g.play("beat of savagery|3").chooseOption("no").expectResources(0, 0).expectAP(0, 1);
  });

  it("Zuul gives a 6-power club attack go again and creates Might after a club hit", () => {
    const g = scenario({ seats: [zuul({ resources: 3, hand: ["bonebreaker bellow|1"] }), OPPONENT] });
    expect(() => g.activate("zuul, clubcaste|0")).toThrow();
    g.play("bonebreaker bellow|1")
      .attackWithWeapon("deathbeat bludgeon|0")
      .expectAttackValue(7)
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .activate("zuul, clubcaste|0")
      .expectInZone(0, "might|0", "board");
  });

  it("Zuul does not give a club attack under 6 power go again", () => {
    const g = scenario({ seats: [zuul({ resources: 2 }), OPPONENT] });
    g.attackWithWeapon("deathbeat bludgeon|0").blockWith().settle().expectAP(0, 0);
  });

  it("Tenderized makes the hero lose life equal to club damage dealt to them this turn", () => {
    const g = scenario({
      seats: [zuul({ resources: 6, hand: ["bonebreaker bellow|1", "tenderized|2"] }), OPPONENT],
    });
    const life = g.state.players[1]!.life;
    g.play("bonebreaker bellow|1")
      .chooseOption("no")
      .attackWithWeapon("deathbeat bludgeon|0")
      .blockWith()
      .settle()
      .expectLife(1, life - 7)
      .play("tenderized|2")
      .blockWith()
      .settle()
      .expectLife(1, life - 7 - 6 - 7);
  });

  it("Babaza activates only after beating chest", () => {
    const g = scenario({ seats: [babaza({ hand: ["beat of savagery|3", "raging onslaught|1"] }), OPPONENT] });
    expect(() => g.activate("babaza, bloodbeat heartfather|0")).toThrow();
    g.play("beat of savagery|3")
      .chooseCard("raging onslaught|1")
      .activate("babaza, bloodbeat heartfather|0")
      .chooseOption("might")
      .expectInZone(0, "might|0", "board");
  });

  it("Fury lets Babaza activate at the start of its controller's turn", () => {
    const g = scenario({ seats: [OPPONENT, babaza({ board: ["fury|0"] })] });
    g.endTurn()
      .expectNotInZone(1, "fury|0", "board")
      .activate("babaza, bloodbeat heartfather|0")
      .chooseOption("agility")
      .expectInZone(1, "agility|0", "board");
  });
});
