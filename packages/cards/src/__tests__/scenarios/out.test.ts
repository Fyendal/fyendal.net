import { describe, expect, it } from "vitest";
import { projectStateFor } from "@fyendal/engine";
import { cardData, scripts } from "../../index.js";
import { scenario } from "../harness.js";

const BLUE = "wrecker romp|3";
const NON_ATTACK = "nimblism|3";

describe("OUT — registration and core mechanics", () => {
  it("registers every printing and all heroes", () => {
    expect(Object.keys(cardData).filter((id) => id.startsWith("OUT"))).toHaveLength(239);
    for (const id of ["OUT002", "OUT003", "OUT046", "OUT047", "OUT090", "OUT092"]) {
      expect(cardData[id]?.cardType).toBe("hero");
      expect(scripts[id]).toBeDefined();
    }
  });

  it("Arakni gives only the first stealth attack go again and Prowl buffs the next one", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "arakni, solitary confinement|0", hand: ["prowl|1", "infect|1"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("prowl|1").blockWith().settle().expectAP(0, 1)
      .play("infect|1").expectAttackValue(4).blockWith().settle().expectAP(0, 0)
      .expectInZone(1, "bloodrot pox|0", "board");
  });

  it.each([
    ["nerve scalpel|0", "ancestral empowerment|1", 2],
    ["orbitoclast|0", "bloodrush bellow|2", 2],
    ["scale peeler|0", "ironrot helm|0", 0],
  ] as const)("%s applies its delayed defense penalty when the matching card defends", (dagger, defender, expectedDefense) => {
    const defenderEquipment = defender === "ironrot helm|0"
      ? { head: defender }
      : undefined;
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          resources: 2,
          hand: ["infect|1"],
          weapons: [dagger],
        },
        {
          hero: "dorinthea",
          ...(defenderEquipment ? { equipment: defenderEquipment } : { hand: [defender] }),
        },
      ],
    });

    s.attackWithWeapon(dagger).blockWith().settle()
      .play("infect|1")
      .blockWith(defender)
      .settle()
      .expectFinalDefense(expectedDefense);
  });

  it("an activated attack reaction enables Sneak Attack's +4 power", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 4, hand: ["sneak attack|1"], equipment: { arms: "fisticuffs|0" } },
        { hero: "dorinthea" },
      ],
    });
    s.play("sneak attack|1").blockWith()
      .activate("fisticuffs|0", { settle: false })
      .passPriority().passPriority()
      .expectAttackValue(8);
  });

  it("shows Flick Knives on the chain after its attack reaction resolves", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["infect|1"],
          equipment: { arms: "flick knives|0" },
          weapons: ["spider's bite|0", "nerve scalpel|0"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("infect|1").blockWith()
      .activate("flick knives|0", { settle: false });

    expect(projectStateFor(s.state, 0).chain.at(-1)?.reactions).toEqual([]);
    s.passPriority().passPriority();
    expect(projectStateFor(s.state, 0).chain.at(-1)?.reactions).toEqual([]);
    s.chooseCard("spider's bite|0");
    expect(projectStateFor(s.state, 0).chain.at(-1)?.reactions).toContainEqual(
      expect.objectContaining({ cardId: "OUT139" }),
    );
  });

  it("Humble suppresses the defending hero through the end of their next turn", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["humble|1", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    s.play("humble|1", { pitch: [BLUE] }).blockWith().settle();
    expect(s.state.modifiers).toContainEqual(expect.objectContaining({
      seat: 1,
      suppressesHeroAbilities: true,
      expiresAtEndOfSeatTurn: 1,
    }));
  });

  it("Toxicity makes the next Assassin or Ranger hit cause life loss", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["toxicity|1", "infect|1"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("toxicity|1").play("infect|1").blockWith().settle().expectLife(1, 12);
  });

  it("Hurl attributes its optional effect hit to the chosen dagger and destroys it", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["hurl|1"], weapons: ["spider's bite|0"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("hurl|1").chooseOption("pay").chooseCard("spider's bite|0")
      .expectLife(1, 19);
    expect(s.state.players[0]!.weapons).toHaveLength(0);
  });

  it("Flick Knives chooses an eligible dagger, including Kiss of Death on a prior link", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          weapons: ["spider's bite|0"],
          equipment: { arms: "flick knives|0" },
          hand: ["kiss of death|1", "infect|1"],
        },
        { hero: "dorinthea", hand: [BLUE, BLUE] },
      ],
    });

    s.play("kiss of death|1").blockWith(BLUE).settle().expectAP(0, 1);
    const kissId = s.state.chain[0]!.attackingCard.instanceId;
    const weaponId = s.state.players[0]!.weapons[0]!.instanceId;

    s.play("infect|1").blockWith(BLUE).activate("flick knives|0");
    expect(s.state.pendingDecision?.options).toEqual(expect.arrayContaining([
      String(kissId),
      String(weaponId),
    ]));

    s.chooseCard("kiss of death|1").expectLife(1, 18);
    expect(s.state.players[0]!.weapons.map((card) => card.instanceId)).toContain(weaponId);
    expect(s.state.players[0]!.graveyard.map((card) => card.instanceId)).toContain(kissId);
    expect(s.state.chain[0]!.flags.attackGone).toBe(true);
  });

  it("Flick Knives applies Hunter's Klaive's on-hit effect", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["infect|1"],
          weapons: ["hunter's klaive|0"],
          equipment: { arms: "flick knives|0" },
        },
        { hero: "dorinthea" },
      ],
    });
    const klaiveId = s.state.players[0]!.weapons[0]!.instanceId;

    s.play("infect|1").blockWith()
      .activate("flick knives|0", { settle: false })
      .passPriority().passPriority()
      .doRaw({ kind: "choose", optionId: String(klaiveId) })
      .expectLife(1, 19);

    s.expectInZone(0, "hunter's klaive|0", "graveyard");
    expect(s.state.players[1]!.hero.counters?.marked ?? 0).toBe(0);
    expect(s.state.stack[0]?.engineEffect?.kind).toBe("on-effect-hit-hook");
    expect(s.state.pendingDecision?.kind).toBe("attack-reaction");

    s.passPriority().passPriority();
    expect(s.state.players[1]!.hero.counters?.marked).toBe(1);
  });

  it.each([
    ["spider's bite|0", "wounding blow|1", 2],
    ["nerve scalpel|0", "ancestral empowerment|1", 2],
    ["orbitoclast|0", "bloodrush bellow|2", 2],
    ["scale peeler|0", "ironrot helm|0", 0],
  ] as const)("Flick Knives applies %s's on-hit defense penalty", (dagger, defender, expectedDefense) => {
    const defenderEquipment = defender === "ironrot helm|0"
      ? { head: defender }
      : undefined;
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          hand: ["infect|1", "infect|1"],
          weapons: [dagger],
          equipment: { arms: "flick knives|0" },
        },
        {
          hero: "dorinthea",
          hand: [BLUE, ...(defenderEquipment ? [] : [defender])],
          ...(defenderEquipment ? { equipment: defenderEquipment } : {}),
        },
      ],
    });

    s.play("infect|1").blockWith(BLUE)
      .activate("flick knives|0")
      .chooseCard(dagger)
      .play("infect|1")
      .blockWith(defender)
      .settle()
      .expectFinalDefense(expectedDefense);
  });

  it("Flick Knives keeps a fully defended link in Mask of Momentum's hit streak", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["head jab|1", "head jab|1", "head jab|1", "head jab|1"],
          deck: [BLUE],
          weapons: ["spider's bite|0"],
          equipment: { head: "mask of momentum|0", arms: "flick knives|0" },
        },
        { hero: "dorinthea", hand: [BLUE] },
      ],
    });

    s.play("head jab|1").blockWith().settle();
    s.play("head jab|1").blockWith().settle();
    s.play("head jab|1").blockWith(BLUE).activate("flick knives|0").chooseCard("spider's bite|0");

    expect(s.state.chain[2]).toMatchObject({ damage: 0, hit: true, resolved: true });
    s.expectHandSize(0, 1).expectZoneSize(0, "deck", 1);

    s.play("head jab|1").blockWith().settle()
      .expectInZone(0, BLUE, "hand");
  });

  it("Fletch weakens matching-pitch defenders when the arrow has an aim counter", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["fletch a red tail|1", BLUE], arsenal: ["falcon wing|1"], weapons: ["death dealer|0"] },
        { hero: "dorinthea", hand: ["wounding blow|1"] },
      ],
    });
    s.state.players[0]!.arsenal[0]!.counters = { aim: 1 };
    s.play("fletch a red tail|1", { pitch: [BLUE] })
      .play("falcon wing|1", { fromArsenal: true })
      .blockWith("wounding blow|1").settle()
      .expectLife(1, 14);
  });

  it("Tarpit Trap suppresses the next attack-action hit without being spent by a miss", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1", "infect|1"] },
        { hero: "dorinthea", arsenal: ["tarpit trap|2"] },
      ],
    });
    s.play("head jab|1").blockWith().passPriority().react("tarpit trap|2").settle()
      .play("infect|1").blockWith().settle();
    expect(s.state.players[1]!.board.some((card) => cardData[card.cardId]?.name === "Bloodrot Pox")).toBe(false);
  });

  it("Shake Down presents the revealed hand and lets the attacker choose the named color", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 4,
          hand: ["shake down|1"],
          equipment: { arms: "fisticuffs|0" },
        },
        { hero: "dorinthea", hand: ["raging onslaught|1", "wrecker romp|3"] },
      ],
    });

    s.play("shake down|1").blockWith()
      .activate("fisticuffs|0")
      .chooseOption("red");
    expect(s.state.pendingDecision?.chooseHook).toBe("shake-banish");
    expect(s.state.pendingDecision?.revealedCardIds).toHaveLength(2);
    expect(s.state.pendingDecision?.options).toHaveLength(1);
    expect(projectStateFor(s.state, 1).pendingDecision?.revealedCards).toHaveLength(2);
    s.chooseCard("raging onslaught|1").expectInZone(1, "raging onslaught|1", "banish");
  });
});

describe("OUT — rules regression coverage", () => {
  it.each(["Crazy Brew", "Crouching Tiger", "Moon Wish"])(
    "Mask of Many Faces can name %s",
    (chosenName) => {
      const s = scenario({
        seats: [
          {
            hero: "rhinar",
            resources: 1,
            hand: ["head jab|1"],
            equipment: { head: "mask of many faces|0" },
          },
          { hero: "dorinthea" },
        ],
      });

      s.activate("mask of many faces|0");
      expect(s.state.pendingDecision).toMatchObject({
        kind: "choose-name",
        chooseHook: "mask-name",
      });

      s.chooseName(chosenName).play("head jab|1");
      expect(s.state.chain.at(-1)!.attackingCard.grantedNames).toContain(chosenName);
    },
  );

  it("Riptide deals damage when a controlled trap triggers", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", heroKey: "riptide|0", arsenal: ["frailty trap|1"] },
        { hero: "dorinthea", hand: ["head jab|1", BLUE] },
      ],
    });
    s.play("head jab|1").blockWith().passPriority().react("frailty trap|1").settle();
    expect(s.state.players[1]!.life).toBe(19);
  });

  it("Be Like Water's chosen name enables the matching Combo condition", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["be like water|1", "descendent gustwave|1", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    s.play("be like water|1").blockWith().settle()
      .chooseOption("pay 1").chooseOption("Surging Strike")
      .play("descendent gustwave|1")
      .expectAttackValue(5);
  });

  it("Back Heel Kick replaces an existing all-zone power gain", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["twin twisters|1", "back heel kick|1", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    s.play("twin twisters|1", { pitch: [BLUE] })
      .chooseOption("next attack")
      .blockWith().settle()
      .play("back heel kick|1")
      .expectAttackValue(5);
  });

  it("Brush Off skips an oversized packet and prevents the next eligible packet", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", hand: ["brush off|1"] },
        { hero: "dorinthea", hand: ["dust runner outlaw|1", "be like water|1", BLUE] },
      ],
    });
    s.play("dust runner outlaw|1", { pitch: [BLUE] }).blockWith()
      .passPriority().react("brush off|1").settle()
      .expectLife(0, 16)
      .play("be like water|1").blockWith().settle()
      .expectLife(0, 16);
  });

  it("Uzuri replaces the stealth attack with the same card banished for the cost", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "uzuri|0", hand: ["infect|1", "sneak attack|1", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    s.play("infect|1").blockWith()
      .activate("uzuri|0")
      .chooseCard("sneak attack|1");
    expect(cardData[s.state.chain.at(-1)!.attackingCard.cardId]!.name).toBe("Sneak Attack");
    expect(s.state.players[0]!.hand.map((card) => cardData[card.cardId]?.name)).toContain("Wrecker Romp");
    expect(s.state.players[0]!.banish).toHaveLength(0);
    expect(s.state.log.find((entry) => entry.publicText?.includes("banished"))?.publicText)
      .toBe("A face-down card is banished");
  });

  it("Uzuri turns an ineligible cost card face up without replacing the attack", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "uzuri|0", hand: ["infect|1", NON_ATTACK] },
        { hero: "dorinthea" },
      ],
    });
    s.play("infect|1").blockWith()
      .activate("uzuri|0")
      .chooseCard(NON_ATTACK);
    expect(cardData[s.state.chain.at(-1)!.attackingCard.cardId]!.name).toBe("Infect");
    expect(s.state.players[0]!.banish).toHaveLength(1);
    expect(s.state.players[0]!.banish[0]!.faceDown).not.toBe(true);
  });
});
