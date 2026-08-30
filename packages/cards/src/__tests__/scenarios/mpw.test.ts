import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData, isImplemented } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function hala(extra: Record<string, unknown> = {}) {
  return {
    hero: "rhinar" as const,
    heroKey: "hala|0",
    weapons: ["durendal|0"],
    equipment: NO_EQUIPMENT,
    ...extra,
  };
}

describe("MPW — import and Warrior mastery", () => {
  it("registers every eligible MPW printing as implemented", () => {
    const cards = Object.values(cardData).filter((card) => card.set === "MPW");
    expect(cards).toHaveLength(156);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
    expect(new Set(cards.map(functionalKeyOf))).toHaveLength(156);
  });

  it("Hala sharpens Durendal before its attack", () => {
    const g = scenario({
      seats: [hala({ resources: 4 }), { hero: "dorinthea", equipment: NO_EQUIPMENT }],
    });
    g.activate("hala|0")
      .activate("durendal|0")
      .blockWith()
      .settle()
      .expectFinalAttack(4);
  });

  it("Drawn to the Blade draws when the sharpened sword hits an ally", () => {
    const g = scenario({
      seats: [
        hala({ resources: 4, hand: ["drawn to the blade|2"], deck: ["snatch|1"] }),
        { hero: "dorinthea", board: ["chum, friendly first mate|2"], equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("hala|0")
      .play("drawn to the blade|2")
      .activate("durendal|0", { targetAlly: "chum, friendly first mate|2" })
      .settle()
      .expectHandSize(0, 1);
  });

  it("Blade Dance grants the weapon attack go again", () => {
    const g = scenario({
      seats: [
        hala({ resources: 1, board: ["blade dance|0"] }),
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("durendal|0")
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectNotInZone(0, "blade dance|0", "board");
  });

  it("Thwart removes the attacking sword's sharpen counters", () => {
    const g = scenario({
      seats: [
        hala({ resources: 4 }),
        { hero: "dorinthea", hand: ["thwart|2"], equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("hala|0")
      .activate("durendal|0")
      .blockWith("thwart|2")
      .settle()
      .expectFinalAttack(3);
  });

  it("And Again immediately attacks with a sharpened sword", () => {
    const g = scenario({
      seats: [
        hala({ resources: 5, hand: ["and again...|3"], board: ["blade dance|0"] }),
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("hala|0")
      .activate("durendal|0")
      .blockWith()
      .settle()
      .play("and again...|3", { targetCard: "durendal|0" })
      .blockWith()
      .settle()
      .expectFinalAttack(4);
  });

  it("A Moment's Peace prevents another attack with that sword this turn", () => {
    const g = scenario({
      seats: [
        hala({ resources: 4, board: ["blade dance|0"] }),
        { hero: "dorinthea", hand: ["a moment's peace|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("hala|0")
      .activate("durendal|0")
      .blockWith("a moment's peace|3")
      .settle();
    const weaponId = g.state.players[0]!.weapons[0]!.instanceId;
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId
    )).toBe(false);
  });

  it("Peaceful Sanctuary stops aura-token creation", () => {
    const g = scenario({
      seats: [
        hala({ hand: ["jive|3"], board: ["peaceful sanctuary|1"] }),
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("jive|3").expectNotInZone(0, "blade dance|0", "board");
  });

  it("Terms of Combat draws when the defender plays a defense reaction", () => {
    const g = scenario({
      seats: [
        hala({ resources: 3, hand: ["terms of combat|1"], deck: ["snatch|1"] }),
        { hero: "dorinthea", hand: ["steel on steel|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("terms of combat|1")
      .activate("durendal|0")
      .blockWith()
      .passPriority()
      .react("steel on steel|3");
    g.expectHandSize(0, 1);
  });

  it("Shove Off returns the chosen defending card to its owner's hand", () => {
    const g = scenario({
      seats: [
        hala({ resources: 4, hand: ["shove off|3"] }),
        {
          hero: "dorinthea",
          hand: ["raging onslaught|1", "snatch|1"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });
    g.activate("durendal|0")
      .blockWith("raging onslaught|1", "snatch|1")
      .react("shove off|3")
      .chooseCard("raging onslaught|1")
      .expectInZone(1, "raging onslaught|1", "hand");
    expect(g.state.chain.at(-1)?.defendingCards.map((card) =>
      functionalKeyOf(cardData[card.cardId]!)
    )).toEqual(["snatch|1"]);
  });

  it("All In loses the game when its sword attack misses", () => {
    const g = scenario({
      seats: [
        hala({ resources: 4, hand: ["all in|1"] }),
        { hero: "dorinthea", hand: ["raging onslaught|1", "raging onslaught|1"], equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("hala|0")
      .play("all in|1")
      .activate("durendal|0")
      .blockWith("raging onslaught|1", "raging onslaught|1")
      .settle()
      .expectWinner(1);
  });
});
