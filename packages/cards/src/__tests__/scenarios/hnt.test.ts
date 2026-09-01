import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, isImplemented } from "../../index.js";
import { printingId, scenario } from "../harness.js";

it("registers every HNT printing as implemented", () => {
  const cards = Object.values(cardData).filter((card) => card.set === "HNT");
  expect(cards).toHaveLength(265);
  expect(cards.filter((card) => !isImplemented(card)).map((card) => card.id)).toEqual([]);
});

describe("HNT — marked heroes and daggers", () => {
  it("Kabuto of Imperial Authority prohibits subsequent weapon attacks this turn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: ["kunai of retribution|0"],
          hand: ["head jab|3"],
          resources: 1,
        },
        {
          hero: "dorinthea",
          equipment: { head: "kabuto of imperial authority|0" },
        },
      ],
    });

    g.play("head jab|3")
      .blockWith("kabuto of imperial authority|0")
      .settle();

    const kunai = g.state.players[0]!.weapons[0]!;
    expect(legalIntents(g.state, 0)).not.toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: kunai.instanceId,
    }));
    expect(applyIntent(g.state, 0, {
      kind: "activate-ability",
      sourceInstanceId: kunai.instanceId,
      pitchInstanceIds: [],
    })).toEqual({ ok: false, error: "cannot attack with weapons this turn" });
  });

  it("journals Relentless Pursuit's self-move as a deck-bottom placement", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["relentless pursuit|3"] },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.flags.attackedHeroThisTurn = true;

    g.play("relentless pursuit|3").expectDeckBottom(0, "relentless pursuit|3");
    expect(g.lastEvents).toContainEqual(expect.objectContaining({
      from: { kind: "stack", seat: 0 },
      to: { kind: "deck", seat: 0, position: "bottom" },
    }));
  });

  it.each([
    ["defang the dragon|1", "fang|0"],
    ["extinguish the flames|1", "cindra|0"],
  ] as const)("%s records its named-hero Contract completion", (contract, targetHero) => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: [contract], deck: ["wrecker romp|3"] },
        { hero: "dorinthea", heroKey: targetHero },
      ],
    });
    g.state.players[1]!.hero.counters = { marked: 1 };

    g.play(contract).blockWith().settle().expectHandSize(0, 1);
    expect(g.state.players[0]!.flags.completedContractThisTurn).toBe(true);
  });

  it("War Cry of Bellona discards itself as a cost and reflects qualifying weapon damage", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          hand: ["war cry of bellona|2"],
          soul: ["soul food|2", "tome of divinity|2", "celestial cataclysm|2"],
        },
        { hero: "dorinthea", weapons: ["dawnblade|0"], hand: ["raging onslaught|3"] },
      ],
    });

    g.attackWithWeapon(undefined, { pitch: ["raging onslaught|3"], settle: false })
      .passPriority()
      .activate("war cry of bellona|2", { settle: false })
      .chooseOption("X = 3")
      .chooseCard("soul food|2")
      .chooseCard("tome of divinity|2")
      .chooseCard("celestial cataclysm|2")
      .chooseCard("dawnblade|0")
      .expectInZone(0, "war cry of bellona|2", "graveyard")
      .settle()
      .blockWith()
      .settle()
      .expectLife(0, 20)
      .expectLife(1, 17);
  });

  it("War Cry of Themis chooses X, pays from soul, then turns X banished cards face-down", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["war cry of themis|2"],
          soul: ["soul food|2", "tome of divinity|2"],
        },
        {
          hero: "dorinthea",
          banish: ["wounding blow|1", "wounding blow|2"],
        },
      ],
    });

    g.activate("war cry of themis|2", { settle: false });
    expect(g.state.pendingDecision?.options).toEqual(["X = 0", "X = 1", "X = 2"]);

    g.chooseOption("X = 2")
      .chooseCard("soul food|2")
      .chooseCard("tome of divinity|2")
      .chooseCard("wounding blow|1")
      .chooseCard("wounding blow|2")
      .expectInZone(0, "war cry of themis|2", "graveyard")
      .expectZoneSize(0, "soul", 0);

    expect(g.state.players[1]!.banish).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: printingId("wounding blow|1"), faceDown: true }),
      expect.objectContaining({ cardId: printingId("wounding blow|2"), faceDown: true }),
    ]));
  });

  it("Mask of Deceit lets its controller choose an Agent when the attacking hero is marked", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        {
          hero: "dorinthea",
          heroKey: "arakni, marionette|0",
          equipment: { head: "mask of deceit|0" },
        },
      ],
    });
    g.state.players[0]!.hero.counters = { marked: 1 };

    g.play("snatch|1").blockWith("mask of deceit|0").settle();

    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "mask-agent",
      prompt: "Mask of Deceit: choose an Agent of Chaos",
    });
    expect(g.state.pendingDecision?.options).toEqual([
      "Arakni, Black Widow",
      "Arakni, Funnel Web",
      "Arakni, Orb-Weaver",
      "Arakni, Redback",
      "Arakni, Tarantula",
      "Arakni, Trap-Door",
    ]);
    expect(projectStateFor(g.state, 1).pendingDecision?.optionCards?.map((card) => card?.cardId))
      .toEqual(["HNT003", "HNT004", "HNT005", "HNT006", "HNT007", "HNT008"]);

    g.chooseOption("Orb-Weaver");
    expect(g.state.players[1]!.heroCardId).toBe("HNT005");
  });

  it("Blood Runs Deep makes each controlled dagger hit and then destroys it", () => {
    const g = scenario({ seats: [{ hero: "rhinar", weapons: ["graphene chelicera|0"], hand: ["blood runs deep|1", "wrecker romp|3"] }, { hero: "dorinthea" }] });
    g.play("blood runs deep|1", { pitch: ["wrecker romp|3"] }).expectLife(1, 19);
    expect(g.state.players[0]!.weapons).toHaveLength(0);
  });

  it("Throw Dagger cannot destroy the dagger on the active chain link", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          weapons: ["kunai of retribution|0", "kunai of retribution|0"],
          hand: ["throw dagger|3"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.attackWithWeapon("kunai of retribution|0")
      .blockWith()
      .react("throw dagger|3");

    const attackingDaggerId = g.state.chain.at(-1)!.attackingCard.instanceId;
    const otherDaggerId = g.state.players[0]!.weapons.find((card) =>
      card.instanceId !== attackingDaggerId
    )!.instanceId;
    expect(g.state.pendingDecision?.options).toEqual([String(otherDaggerId)]);
    expect(g.state.pendingDecision?.options).not.toContain(String(attackingDaggerId));
    g.chooseCard("kunai of retribution|0");
    expect(g.state.players[0]!.weapons.some((card) => card.instanceId === attackingDaggerId))
      .toBe(true);
  });

  it("Throw Dagger cannot be played without an off-link dagger", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          weapons: ["kunai of retribution|0"],
          hand: ["throw dagger|3"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.attackWithWeapon("kunai of retribution|0").blockWith();

    const throwDagger = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("throw dagger|3"),
    )!;
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "play-card" &&
      intent.instanceId === throwDagger.instanceId
    )).toBe(false);
  });

  it("Kunai of Retribution destroys itself when its combat chain closes", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 0,
          weapons: ["kunai of retribution|0"],
          hand: ["wrecker romp|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.attackWithWeapon("kunai of retribution|0", { pitch: ["wrecker romp|3"] })
      .blockWith()
      .settle();
    expect(g.state.players[0]!.weapons).toHaveLength(1);

    g.endTurn()
      .expectInZone(0, "kunai of retribution|0", "graveyard");
    expect(g.state.players[0]!.weapons).toHaveLength(0);
  });

  it("Blood Splattered Vest is optional and is destroyed by its third stain counter", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["graphene chelicera|0"],
          equipment: { chest: "blood splattered vest|0" },
          hand: ["bite|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    const vest = g.state.players[0]!.equipment.chest!;
    vest.counters = { stain: 2 };

    g.play("bite|1")
      .chooseCard("graphene chelicera|0");
    expect(g.state.pendingDecision).toMatchObject({
      prompt: "Blood Splattered Vest: gain 1 resource and add a stain counter?",
      options: ["yes", "no"],
    });

    g.chooseOption("yes")
      .expectResources(0, 1)
      .expectInZone(0, "blood splattered vest|0", "graveyard");
    expect(g.state.players[0]!.equipment.chest).toBeUndefined();
  });

  it("Blood Splattered Vest gains no resource or stain when declined", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["graphene chelicera|0"],
          equipment: { chest: "blood splattered vest|0" },
          hand: ["bite|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("bite|1")
      .chooseCard("graphene chelicera|0")
      .chooseOption("no")
      .expectResources(0, 0);
    expect(g.state.players[0]!.equipment.chest?.counters?.stain ?? 0).toBe(0);
  });

  it("Ignite discounts Cindra's Draconic hero activation and is consumed once", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: [],
          hand: ["ignite|1", "ignite|1", "demonstrate devotion|1"],
          graveyard: ["kunai of retribution|0"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("ignite|1").blockWith().settle()
      .play("ignite|1").blockWith().settle();

    const hero = g.state.players[0]!.hero;
    expect(g.state.modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        activationCostReduction: 1,
        appliesToSubtype: "draconic",
      }),
    ]));
    expect(legalIntents(g.state, 0)).toContainEqual({
      kind: "activate-ability",
      sourceInstanceId: hero.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    });

    g.activate("cindra|0")
      .chooseCard("kunai of retribution|0")
      .settle()
      .expectNoLegalPlay("demonstrate devotion|1");
  });

  it("Art of the Dragon: Blood discounts exactly the next 3 Draconic plays", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["fealty|0"],
          hand: [
            "art of the dragon: blood|1",
            "demonstrate devotion|1",
            "demonstrate devotion|1",
            "demonstrate devotion|1",
            "demonstrate devotion|1",
          ],
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("fealty|0")
      .play("art of the dragon: blood|1").blockWith().settle();
    for (let play = 0; play < 3; play++) {
      g.play("demonstrate devotion|1").blockWith().settle();
    }
    g.expectNoLegalPlay("demonstrate devotion|1");
  });

  it("Art of the Dragon: Blood does not get go again unless it is Draconic", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["art of the dragon: blood|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("art of the dragon: blood|1");

    expect(g.state.chain.at(-1)?.goAgain).toBe(false);
  });

  it("a dagger effect hit removes Mark and lets Cindra create Fealty", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: ["graphene chelicera|0"],
          hand: ["proclaim vengeance|1", "bite|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.play("proclaim vengeance|1")
      .play("bite|1")
      .chooseCard("graphene chelicera|0")
      .expectLife(1, 19)
      .expectInZone(0, "fealty|0", "board");
    expect(g.state.players[1]!.hero.counters?.marked ?? 0).toBe(0);
  });

  it("Cindra does not trigger for a dagger effect hit on an unmarked hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: ["graphene chelicera|0"],
          hand: ["bite|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("bite|1")
      .chooseCard("graphene chelicera|0")
      .expectNoLog("Cindra triggers");
    expect(g.state.players[0]!.board).toHaveLength(0);
  });

  it("Savor Bloodshed ignores an unmarked hit, then draws when a dagger hits a marked hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          weapons: ["graphene chelicera|0", "kunai of retribution|0"],
          hand: ["proclaim vengeance|1", "savor bloodshed|1"],
          deck: ["wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("savor bloodshed|1")
      .attackWithWeapon("kunai of retribution|0")
      .blockWith()
      .settle()
      .expectHandSize(0, 1)
      .play("proclaim vengeance|1")
      .attackWithWeapon("graphene chelicera|0")
      .blockWith()
      .settle()
      .expectHandSize(0, 1);

    expect(g.state.players[1]!.hero.counters?.marked ?? 0).toBe(0);
  });

  it("Savor Bloodshed draws when a dagger effect hits a marked hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["graphene chelicera|0"],
          hand: ["savor bloodshed|1", "bite|1"],
          deck: ["wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.state.players[1]!.hero.counters = { marked: 1 };

    g.play("savor bloodshed|1")
      .play("bite|1")
      .chooseCard("graphene chelicera|0")
      .expectHandSize(0, 1);

    expect(g.state.players[1]!.hero.counters?.marked ?? 0).toBe(0);
  });

  it("Savor Bloodshed does not trigger when a dagger effect hits an unmarked hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["graphene chelicera|0"],
          hand: ["savor bloodshed|1", "bite|1"],
          deck: ["wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("savor bloodshed|1")
      .play("bite|1")
      .chooseCard("graphene chelicera|0")
      .expectHandSize(0, 0)
      .expectNoLog("Savor Bloodshed triggers");
  });

  it("Tarantula Toxin can choose both modes for Kiss of Death", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["kiss of death|1", "tarantula toxin|1"] },
        { hero: "dorinthea", hand: ["wrecker romp|1"] },
      ],
    });

    g.play("kiss of death|1")
      .blockWith("wrecker romp|1")
      .react("tarantula toxin|1");

    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "tarantula-mode",
      options: ["+3 attack", "-3 defense", "both"],
    });

    g.chooseOption("both")
      .chooseCard("wrecker romp|1")
      .expectFinalAttack(6)
      .expectFinalDefense(0);
  });

  it("Tarantula Toxin can choose only its attack mode for a dagger with stealth", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["kiss of death|1", "tarantula toxin|1"] },
        { hero: "dorinthea", hand: ["wrecker romp|1"] },
      ],
    });

    g.play("kiss of death|1")
      .blockWith("wrecker romp|1")
      .react("tarantula toxin|1")
      .chooseOption("+3 attack")
      .expectFinalAttack(6)
      .expectFinalDefense(3);
  });

  it("Tarantula Toxin can choose only its defense mode for Graphene Chelicera", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          weapons: ["graphene chelicera|0"],
          hand: ["tarantula toxin|1"],
        },
        {
          hero: "dorinthea",
          equipment: { head: "ironrot helm|0" },
        },
      ],
    });

    g.attackWithWeapon("graphene chelicera|0")
      .blockWith("ironrot helm|0")
      .react("tarantula toxin|1");

    expect(g.state.pendingDecision?.options).toEqual(["+3 attack", "-3 defense", "both"]);

    g.chooseOption("-3 defense")
      .chooseCard("ironrot helm|0")
      .expectFinalAttack(1)
      .expectFinalDefense(0);
  });

  it("Retrieve pays one resource and equips the selected dagger", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: [],
          hand: ["up sticks and run|2", "wrecker romp|3"],
          graveyard: ["kunai of retribution|0"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.play("up sticks and run|2").chooseCard("kunai of retribution|0");
    const payment = projectStateFor(g.state, 0).pendingDecision?.resourcePayment;
    expect(payment).toMatchObject({ cost: 1 });
    expect(payment?.options).toHaveLength(1);
    expect(payment?.options[0]?.pitchInstanceIds).toEqual([
      g.state.players[0]!.hand.find((card) => card.cardId === printingId("wrecker romp|3"))!.instanceId,
    ]);

    g.chooseOption(payment!.options[0]!.optionId).expectResources(0, 2);
    expect(g.state.players[0]!.weapons.some((card) => card.cardId === printingId("kunai of retribution|0"))).toBe(true);
    expect(g.state.players[0]!.pitch.some((card) => card.cardId === printingId("wrecker romp|3"))).toBe(true);
  });

  it("Retrieve offers dagger weapons but not Kiss of Death", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: [],
          resources: 1,
          hand: ["up sticks and run|2"],
          graveyard: ["kiss of death|1", "kunai of retribution|0"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("up sticks and run|2");

    expect(projectStateFor(g.state, 0).pendingDecision?.optionCards?.map((card) => card?.cardId ?? null))
      .toEqual([null, printingId("kunai of retribution|0")]);
  });

  it("Calming Breeze prevents one damage from each of three events", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["calming breeze|1"] },
        { hero: "dorinthea" },
      ],
    });
    g.play("calming breeze|1");
    const breeze = g.state.modifiers.find((modifier) => modifier.preventDamagePerEvent === 1);
    expect(breeze?.preventDamageEventsRemaining).toBe(3);
  });

  it("projects Shelter from the Storm's remaining prevention events", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["shelter from the storm|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.activate("shelter from the storm|1");

    expect(projectStateFor(g.state, 0).ongoing).toContainEqual({
      seat: 0,
      cardId: printingId("shelter from the storm|1"),
      label: "prevent 1 damage from each of the next 3 damage events · this turn",
    });
  });
});

describe("HNT — rules regression coverage", () => {
  it("Retrace the Past names itself after a Gustwave attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: [
            "surging strike|1",
            "raging onslaught|3",
            "whelming gustwave|1",
            "retrace the past|3",
          ],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("surging strike|1", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .play("whelming gustwave|1")
      .blockWith()
      .settle()
      .play("retrace the past|3");

    expect(g.state.pendingDecision).toMatchObject({
      kind: "choose-name",
      chooseHook: "retrace-name",
    });

    g.chooseName("Head Jab").expectAttackValue(4);
    expect(g.state.chain.at(-1)?.attackingCard.grantedNames).toContain("Head Jab");
  });

  it("Sharpened Senses checks an already-buffed weapon attack when it is declared", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["dawnblade|0"],
          resources: 1,
          hand: ["sharpened senses|2", "sharpen steel|1"],
        },
        { hero: "rhinar" },
      ],
    });

    g.play("sharpened senses|2")
      .play("sharpen steel|1")
      .attackWithWeapon("dawnblade|0");

    expect(g.state.chain.at(-1)).toMatchObject({ goAgain: true });
  });

  it("Sharpened Senses grants go again when a weapon attack becomes greater than twice its base", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["dawnblade|0"],
          resources: 2,
          hand: ["sharpened senses|2", "jagged edge|1"],
        },
        { hero: "rhinar" },
      ],
    });

    g.play("sharpened senses|2").attackWithWeapon("dawnblade|0").blockWith();

    expect(g.state.chain.at(-1)).toMatchObject({ goAgain: false });

    g.react("jagged edge|1");

    expect(g.state.chain.at(-1)).toMatchObject({ goAgain: true });
  });

  it("Provoke lets the defending hero choose the revealed card", () => {
    const action = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["dawnblade|0"],
          resources: 2,
          hand: ["provoke|3"],
        },
        { hero: "rhinar", hand: ["snatch|1", "sink below|1"] },
      ],
    });

    action.attackWithWeapon().blockWith().react("provoke|3");
    const actionOptions = action.state.players[1]!.hand.map((card) => String(card.instanceId));
    expect(action.state.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "provoke-reveal",
      prompt: "Provoke: choose a card to reveal",
      options: actionOptions,
    });

    action.chooseCard("snatch|1");
    expect(action.state.chain.at(-1)?.defendingCards).toContainEqual(
      expect.objectContaining({ cardId: printingId("snatch|1") }),
    );
    action.expectInZone(1, "sink below|1", "hand");

    const nonAction = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["dawnblade|0"],
          resources: 2,
          hand: ["provoke|3"],
        },
        { hero: "rhinar", hand: ["snatch|1", "sink below|1"] },
      ],
    });

    nonAction.attackWithWeapon().blockWith().react("provoke|3").chooseCard("sink below|1")
      .expectInZone(1, "sink below|1", "graveyard")
      .expectInZone(1, "snatch|1", "hand");
  });

  it("Leap Frog equipment may add itself after an opposing attack reaction", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["snatch|1", "razor reflex|1"] },
        { hero: "dorinthea", equipment: { head: "leap frog vocal sac|0" } },
      ],
    });
    g.play("snatch|1").blockWith().react("razor reflex|1", { settle: false }).settle().chooseOption("yes");
    const link = g.state.chain[g.state.chain.length - 1]!;
    expect(link.defendingEquipment.some((card) => card.cardId === printingId("leap frog vocal sac|0"))).toBe(true);
  });

  it("Heart of Vengeance discounts the next attack targeting Arakni", () => {
    const cardAttack = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          hand: ["compounding anger|1"],
          equipment: { chest: "heart of vengeance|0" },
        },
        { hero: "dorinthea", heroKey: "arakni|0" },
      ],
    });
    cardAttack.activate("heart of vengeance|0").play("compounding anger|1");

    const weaponAttack = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["kunai of retribution|0"],
          equipment: { chest: "heart of vengeance|0" },
        },
        { hero: "dorinthea", heroKey: "arakni|0" },
      ],
    });
    weaponAttack.activate("heart of vengeance|0").activate("kunai of retribution|0", { settle: false });
  });

  it("Coat of Allegiance restricts its controller to Draconic cards", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          hand: ["snatch|1", "compounding anger|1"],
          equipment: { chest: "coat of allegiance|0" },
        },
        { hero: "dorinthea" },
      ],
    });
    g.activate("coat of allegiance|0");
    expect(() => g.play("snatch|1")).toThrow();
    g.play("compounding anger|1", { settle: false });
  });

  it("Fealty lets a non-Draconic card satisfy Oath of Loyalty's play restriction", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["fealty|0"],
          hand: ["oath of loyalty|1", "art of the dragon: blood|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("oath of loyalty|1").blockWith().settle()
      .activate("fealty|0")
      .play("art of the dragon: blood|1");

    expect(g.state.chain.at(-1)?.attackingCard.grantedTypes).toContain("draconic");
  });
});
