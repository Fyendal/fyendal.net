import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData, isImplemented } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { printingId, scenario } from "../harness.js";

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

  it("Blade Dance still grants go again after Twinning Blade grants another sword attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["dawnblade|0"],
          equipment: NO_EQUIPMENT,
          resources: 2,
          hand: ["twinning blade|2"],
          board: ["blade dance|0"],
        },
        hala(),
      ],
    });

    g.activate("dawnblade|0")
      .blockWith()
      .react("twinning blade|2", { settle: false })
      .expectAP(0, 0)
      .settle()
      .expectAP(0, 1)
      .activate("dawnblade|0")
      .blockWith()
      .settle();
  });

  it("Longsword Leggings consumes an action point when it creates a token", () => {
    const g = scenario({
      seats: [
        hala({ equipment: { ...NO_EQUIPMENT, legs: "longsword leggings|0" } }),
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.activate("longsword leggings|0")
      .chooseOption("Flurry")
      .expectAP(0, 0)
      .expectInZone(0, "flurry|0", "board");
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

  it("Sharpened Durendal weakens reactions defending it but not later attacks", () => {
    const g = scenario({
      seats: [
        hala({ resources: 4, hand: ["snatch|1"], board: ["blade dance|0"] }),
        { hero: "rhinar", hand: ["sink below|1", "sink below|1"], equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("hala|0")
      .activate("durendal|0")
      .blockWith()
      .passPriority()
      .react("sink below|1")
      .chooseOption("pass")
      .settle()
      .expectFinalDefense(3)
      .play("snatch|1")
      .blockWith()
      .passPriority()
      .react("sink below|1")
      .chooseOption("pass")
      .settle()
      .expectFinalDefense(4);
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

  it("Take the Lead plays from arsenal, prevents damage, and creates Blade Dance", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"], equipment: NO_EQUIPMENT },
        {
          hero: "dorinthea",
          life: 20,
          arsenal: ["take the lead|1"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("snatch|1", { settle: false })
      .passPriority()
      .passPriority()
      .passPriority()
      .passPriority()
      .blockWith()
      .passPriority();

    const takeTheLead = g.state.players[1]!.arsenal[0]!;
    expect(legalIntents(g.state, 1)).toContainEqual(expect.objectContaining({
      kind: "play-from-arsenal",
      instanceId: takeTheLead.instanceId,
    }));

    g.react("take the lead|1", { settle: false })
      .passPriority()
      .passPriority()
      .settle()
      .expectLife(1, 18)
      .expectInZone(1, "blade dance|0", "board");
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

  it("Shove Off returns a galvanized defender without its chain defense bonus", () => {
    const g = scenario({
      seats: [
        hala({ resources: 4, hand: ["shove off|3"] }),
        {
          hero: "dorinthea",
          hand: ["golden skywarden|2"],
          board: ["golden cog|0"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });
    g.activate("durendal|0")
      .blockWith("golden skywarden|2")
      .passPriority()
      .passPriority()
      .chooseCard("golden cog|0");
    // Choose the created Gold directly; chooseCard would settle past the
    // reaction window that Shove Off needs.
    const gold = g.state.players[1]!.board.find((card) => cardData[card.cardId]?.name === "Gold");
    g.doRaw({ kind: "choose", optionId: String(gold!.instanceId) });
    const skywarden = () => g.state.players[1]!.hand.concat(
      g.state.chain.flatMap((link) => link.defendingCards),
    ).find((card) => functionalKeyOf(cardData[card.cardId]!) === "golden skywarden|2");
    expect(skywarden()?.tempDefense).toBe(2);

    g.react("shove off|3").expectInZone(1, "golden skywarden|2", "hand");
    expect(skywarden()?.tempDefense).toBeUndefined();
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

describe("MPW — Lessons Learned", () => {
  it("shuffles up to 3 chosen attack reactions with different names into the deck", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["lessons learned|3"],
          deck: ["raging onslaught|1"],
          graveyard: ["run through|1", "run through|3", "quicksilver dance|3", "raging onslaught|2"],
        },
        { hero: "dorinthea" },
      ],
    });
    const graveyardId = (key: string) =>
      String(g.state.players[0]!.graveyard.find((card) => card.cardId === printingId(key))!.instanceId);

    g.play("lessons learned|3", { settle: false });
    while (g.state.pendingDecision?.chooseHook !== "lessons-learned") g.passPriority();
    const pd = g.state.pendingDecision!;
    expect(pd.distinctCardNames).toBe(true);
    expect([pd.minimumSelections, pd.maximumSelections]).toEqual([0, 3]);
    expect(pd.options).toHaveLength(3);

    expect(() =>
      g.doRaw({ kind: "choose-many", optionIds: [graveyardId("run through|1"), graveyardId("run through|3")] })
    ).toThrow(/different names/);
    g.chooseMany([graveyardId("quicksilver dance|3"), graveyardId("run through|3")])
      .settle();

    g.expectZoneSize(0, "deck", 3)
      .expectInZone(0, "run through|3", "deck")
      .expectInZone(0, "quicksilver dance|3", "deck")
      .expectInZone(0, "run through|1", "graveyard")
      .expectInZone(0, "raging onslaught|2", "graveyard");
  });
});
