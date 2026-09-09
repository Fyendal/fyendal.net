import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, isImplemented } from "../../index.js";
import { printingId, scenario } from "../harness.js";

it("registers every MST printing as implemented", () => {
  const cards = Object.values(cardData).filter((card) => card.set === "MST");
  expect(cards).toHaveLength(251);
  expect(cards.filter((card) => !isImplemented(card)).map((card) => card.id)).toEqual([]);
});

describe("MST — Mystic heroes and cloaked equipment", () => {
  it("Enigma, New Moon turns Ward equipment face-up and creates three Spectral Shields", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "enigma, new moon|0",
          hand: ["inner chi|3"],
          equipment: { chest: "heirloom of rabbit hide|0" },
        },
        { hero: "dorinthea" },
      ],
    });
    expect(g.state.players[0]!.equipment.chest?.faceDown).toBe(true);
    g.activate("enigma, new moon|0", { pitch: ["inner chi|3"] })
      .chooseCard("heirloom of rabbit hide|0")
      .expectZoneSize(0, "board", 3);
    expect(g.state.players[0]!.equipment.chest?.faceDown).toBeUndefined();
  });

  it("a face-down Keikoi can destroy itself to prevent the next damage", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["wrecker romp|3"] },
        { hero: "rhinar", equipment: { head: "skycrest keikoi|0" } },
      ],
    });
    g.attackWithWeapon(undefined, { pitch: ["wrecker romp|3"] }).blockWith().passPriority()
      .activate("skycrest keikoi|0", { settle: false })
      .settle()
      .expectNoEquipment(1, "head")
      .expectLife(1, 19);
  });

  it("Moon Chakra uses the larger prevention after transcend", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["wrecker romp|3"] },
        { hero: "rhinar", hand: ["moon chakra|1"] },
      ],
    });
    g.state.players[1]!.flags.transcendedThisTurn = true;
    g.attackWithWeapon(undefined, { pitch: ["wrecker romp|3"] }).blockWith().passPriority()
      .react("moon chakra|1", { settle: false })
      .settle()
      .expectLife(1, 20);
  });

  it("Essence of Ancestry prevents the matching color event after Ward destroys it", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", board: ["essence of ancestry: body|1"] },
      ],
    });
    g.play("snatch|1").blockWith().settle()
      .chooseOption("destroy")
      .expectLife(1, 20)
      .expectInZone(1, "essence of ancestry: body|1", "graveyard");
  });

  it("Restless Coalescence moves any number of +1 power counters from controlled auras", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["spectral shield|0"],
          hand: ["astral etchings|1", "restless coalescence|2", "wrecker romp|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("astral etchings|1", { pitch: ["wrecker romp|3"] })
      .chooseCard("spectral shield|0")
      .play("restless coalescence|2")
      .chooseCard("spectral shield|0")
      .chooseCard("spectral shield|0")
      .chooseOption("done");

    const shield = g.state.players[0]!.board.find(
      (card) => card.cardId === printingId("spectral shield|0"),
    )!;
    const restless = g.state.players[0]!.board.find(
      (card) => card.cardId === printingId("restless coalescence|2"),
    )!;
    expect(shield.counters?.power).toBe(1);
    expect(restless.counters?.power).toBe(2);
  });
});

describe("MST — Mechanologist", () => {
  it("Evo Recall plays as an instant, transforms a base head, and recalls a banished action", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["evo recall|3"],
          banish: ["zero to sixty|1"],
          equipment: { head: "cogwerx base head|0" },
        },
        { hero: "dorinthea" },
      ],
    });
    const recall = g.state.players[0]!.hand[0]!;

    expect(legalIntents(g.state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: recall.instanceId,
      asInstant: true,
    }));

    g.play("evo recall|3", { asInstant: true })
      .chooseCard("zero to sixty|1")
      .expectEquipped(0, "head", "evo recall|3");
    expect(g.state.players[0]!.equipment.head?.subcards?.[0]?.cardId)
      .toBe(printingId("cogwerx base head|0"));
    expect(g.state.players[0]!.deck[0]?.cardId).toBe(printingId("zero to sixty|1"));
  });

  it("MST instant Evos require matching base equipment", () => {
    for (const [evo, equipment] of [
      ["evo recall|3", { head: "cogwerx base head|0" }],
      ["evo heartdrive|3", { chest: "cogwerx base chest|0" }],
      ["evo shortcircuit|3", { arms: "cogwerx base arms|0" }],
      ["evo speedslip|3", { legs: "cogwerx base legs|0" }],
    ] as const) {
      const withBase = scenario({
        seats: [
          { hero: "rhinar", hand: [evo], equipment },
          { hero: "dorinthea" },
        ],
      });
      const playableCard = withBase.state.players[0]!.hand[0]!;
      expect(legalIntents(withBase.state, 0)).toContainEqual(expect.objectContaining({
        kind: "play-card",
        instanceId: playableCard.instanceId,
        asInstant: true,
      }));

      const withoutBase = scenario({
        seats: [
          { hero: "rhinar", hand: [evo], equipment: { head: null, chest: null, arms: null, legs: null } },
          { hero: "dorinthea" },
        ],
      });
      const blockedCard = withoutBase.state.players[0]!.hand[0]!;
      expect(legalIntents(withoutBase.state, 0).some(
        (intent) => intent.kind === "play-card" && intent.instanceId === blockedCard.instanceId,
      ), evo).toBe(false);
    }
  });

  it("Evo Speedslip gives Twin Drive a third Boost ability", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          hand: ["evo speedslip|3", "twin drive|1"],
          deck: ["zero to sixty|1", "zipper hit|2", "throttle|3"],
          equipment: { legs: "cogwerx base legs|0" },
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("evo speedslip|3", { asInstant: true });

    const twinDrive = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("twin drive|1"),
    )!;
    const boostCounts = legalIntents(g.state, 0)
      .filter((intent): intent is Extract<ReturnType<typeof legalIntents>[number], { kind: "play-card" }> =>
        intent.kind === "play-card" && intent.instanceId === twinDrive.instanceId,
      )
      .map((intent) => intent.boost === true ? (intent.boostCount ?? 1) : 0);
    expect(new Set(boostCounts)).toEqual(new Set([0, 1, 2, 3]));

    g.play("twin drive|1", { boost: true, boostCount: 3, settle: false });
    expect(g.state.players[0]!.banish).toHaveLength(3);
    expect(g.state.players[0]!.flags.boostCountThisTurn).toBe(3);
  });
});

describe("MST — Assassin", () => {
  it("Nuu banishes action cards defending a stealth attack when the link resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "nuu|0", hand: ["art of desire: soul|2"] },
        { hero: "dorinthea", hand: ["wounding blow|3"] },
      ],
    });
    g.play("art of desire: soul|2")
      .blockWith("wounding blow|3")
      .settle()
      .expectInZone(1, "wounding blow|3", "banish")
      .expectNotInZone(1, "wounding blow|3", "graveyard");
  });

  it("Nuu banishes Action Equipment defending a stealth attack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "nuu|0", hand: ["art of desire: soul|2"] },
        {
          hero: "dorinthea",
          equipment: {
            head: "ironrot helm|0",
            arms: "evo steel soul controller|3",
          },
        },
      ],
    });

    g.play("art of desire: soul|2")
      .blockWith("ironrot helm|0", "evo steel soul controller|3")
      .settle()
      .expectNoEquipment(1, "arms")
      .expectEquipped(1, "head", "ironrot helm|0")
      .expectInZone(1, "evo steel soul controller|3", "banish")
      .expectNotInZone(1, "evo steel soul controller|3", "graveyard")
      .expectNotInZone(1, "ironrot helm|0", "banish");
  });

  it("Double Trouble counts two attack reactions and banishes two cards on hit", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["double trouble|1", "fang strike|0", "fang strike|0"] },
        { hero: "dorinthea", deck: ["wounding blow|1", "wounding blow|2"] },
      ],
    });
    g.play("double trouble|1").blockWith()
      .react("fang strike|0", { settle: false })
      .react("fang strike|0", { settle: false })
      .settle()
      .expectFinalAttack(7)
      .expectZoneSize(1, "banish", 2);
  });

  it("Just a Nick lets Unmake the Underlings choose both modes and banish on hit", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["unmake the underlings|3", "just a nick|1"] },
        { hero: "dorinthea", deck: ["wounding blow|1"] },
      ],
    });

    g.play("unmake the underlings|3")
      .blockWith()
      .react("just a nick|1");

    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "just-a-nick-mode",
      options: ["power", "banish", "both"],
    });

    g.chooseOption("both")
      .expectFinalAttack(6)
      .settle()
      .expectLife(1, 14)
      .expectInZone(1, "wounding blow|1", "banish")
      .expectZoneSize(1, "deck", 0);
  });

  it("Nuu may play an opponent's banished blue card for free", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "nuu|0", hand: ["inner chi|3"] },
        { hero: "dorinthea", deck: ["wounding blow|3"] },
      ],
    });
    g.activate("nuu|0", { pitch: ["inner chi|3"] }).chooseOption("yes");
    const card = g.state.players[1]!.banish.find((candidate) => candidate.cardId === printingId("wounding blow|3"))!;
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "play-from-zone" && intent.instanceId === card.instanceId && intent.pitchInstanceIds.length === 0,
    )).toBe(true);
    g.play("wounding blow|3", { fromZone: "banish" })
      .blockWith()
      .settle()
      .endTurn()
      .expectInZone(1, "wounding blow|3", "graveyard")
      .expectNotInZone(1, "wounding blow|3", "banish");
  });
});

describe("MST — Ninja and generic", () => {
  it("Orihon draws three cards when a blue card paid for it", () => {
    const g = scenario({ seats: [{ hero: "rhinar", resources: 1, hand: ["orihon of mystic tenets|3", "wrecker romp|3"], deck: ["wounding blow|1", "wounding blow|2", "wounding blow|3"] }, { hero: "dorinthea" }] });
    g.play("orihon of mystic tenets|3", { pitch: ["wrecker romp|3"] }).expectHandSize(0, 3);
  });

  it("Prismatic Leyline buffs only the next attack of each color", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: [
            "prismatic leyline|2",
            "head jab|1",
            "head jab|2",
            "head jab|3",
            "head jab|2",
          ],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("prismatic leyline|2")
      .play("head jab|1")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .play("head jab|2")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .play("head jab|3")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .play("head jab|2")
      .expectAttackValue(2);
  });

  it("Prismatic Leyline's next matching attack can be an ally attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["goldkiss rum|0", "wailer humperdinck|2"],
          resources: 7,
          hand: ["prismatic leyline|2", "saltwater swell|2"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("prismatic leyline|2")
      .activate("goldkiss rum|0")
      .activate("wailer humperdinck|2")
      .expectAttackValue(13)
      .blockWith()
      .settle()
      .play("saltwater swell|2")
      .expectAttackValue(2);
  });

  it("Aspect of Tiger triggers only after an attack action of its color", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1", "aspect of tiger: body|1"] },
        { hero: "rhinar", hand: ["snatch|1"] },
      ],
    });
    g.play("head jab|1").blockWith().settle()
      .play("aspect of tiger: body|1")
      .expectZoneSize(0, "banish", 1)
      .blockWith().settle()
      .expectAP(0, 1);
  });

  it("Battlefront Bastion prevents the next damage when it defends alone", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["snatch|1"] },
        { hero: "rhinar", hand: ["battlefront bastion|3"] },
      ],
    });
    g.play("snatch|1").blockWith("battlefront bastion|3").settle().expectLife(1, 19);
  });

  it("Blanch removes every owned card's color through the defending hero's next turn", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["blanch|1", "wrecker romp|3"] },
        {
          hero: "dorinthea",
          hand: ["sky fire lanterns|1", "raging onslaught|3", "wrecker romp|3", "dodge|3"],
          deck: ["wounding blow|1"],
        },
      ],
    });
    g.play("blanch|1", { pitch: ["wrecker romp|3"] }).blockWith().settle();
    expect(g.state.players[1]!.hero.counters?.colorsSuppressedUntilTurn).toBe(2);
    g.endTurn()
      .play("sky fire lanterns|1")
      .expectZoneSize(1, "board", 0)
      // Losing color is independent from pitch: the colorless blue card still
      // pitches for 3 resources and pays for this attack normally.
      .play("raging onslaught|3", { pitch: ["wrecker romp|3"] })
      .blockWith()
      .settle();
  });
});

describe("MST — look-at floats", () => {
  it("Siren's Call floats the full hand with only the blue card selectable", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1", "siren's call|1", "wrecker romp|3"] },
        { hero: "dorinthea", hand: ["snatch|1", "raging onslaught|3"] },
      ],
    });
    g.play("head jab|1").blockWith();
    g.react("siren's call|1", { pitch: ["wrecker romp|3"] });

    const oppHand = g.state.players[1]!.hand;
    const blueId = oppHand.find((card) => cardData[card.cardId]!.pitch === 3)!.instanceId;
    const redId = oppHand.find((card) => card.instanceId !== blueId)!.instanceId;
    const pd = g.state.pendingDecision;
    expect(pd?.chooseHook).toBe("siren-blue");
    // the blue card is the only legal pick; the rest of the hand stays as
    // inert looked-at context in the same float
    expect(pd?.cardOptions).toEqual([blueId]);
    expect(pd?.lookedCardIds).toEqual([redId]);
    const ownView = projectStateFor(g.state, 0);
    expect(ownView.pendingDecision?.optionCards?.filter(Boolean)).toHaveLength(1);
    expect(ownView.pendingDecision?.lookedCards).toHaveLength(1);
    expect(projectStateFor(g.state, 1).pendingDecision?.lookedCards).toBeUndefined();

    g.chooseCard("raging onslaught|3"); // added to the chain link as a defender
    expect(g.state.chain.at(-1)?.defendingCards.map((card) => card.instanceId)).toContain(blueId);
  });
});
