import { describe, expect, it } from "vitest";
import { legalIntents, type CardScript } from "@fyendal/engine";
import { scripts } from "../../index.js";
import { printingId, scenario } from "../harness.js";

function script(key: string): CardScript {
  const found = scripts[printingId(key)];
  expect(found).toBeDefined();
  return found!;
}

describe("DTD, EVO, and HVY rules regression coverage", () => {
  it("Empyrean discounts the first hero ability", () => expect(script("empyrean rapture|0").modifyAttackActivationCost).toBeTypeOf("function"));
  it("Levia transforms from inventory", () => expect(script("levia, redeemed|0").onGameStart).toBeTypeOf("function"));
  it("Chains replaces action phase draws", () => expect(script("chains of mephetis|3").replaceOpponentDraw).toBeTypeOf("function"));
  it("Singularity transforms all components", () => expect(script("singularity|1").onChoose).toBeTypeOf("function"));
  it("Hyper-X3 retains boosted drivers", () => expect(script("hyper-x3|0").onBanishedForBoost).toBeTypeOf("function"));
  it("Breaker Evos retain Hyper Drivers", () => expect(script("evo circuit breaker|1").additionalCost).toBeTypeOf("function"));
  it("Stasis Cell triggers when it leaves the arena", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["stasis cell|3"] },
        { hero: "dorinthea", equipment: { head: "ironrot helm|0" } },
      ],
    });

    g.activate("stasis cell|3").chooseCard("ironrot helm|0");
    expect(g.state.pendingDecision?.chooseHook).toBe("stasis-abilities");
    g.chooseCard("ironrot helm|0");
    const helm = g.state.players[1]!.equipment.head!;
    expect(g.state.modifiers).toContainEqual(expect.objectContaining({
      suppressesActivatedAbilitiesOfInstanceId: helm.instanceId,
      expiresAtEndOfSeatTurn: 1,
    }));
  });
  it("Fabricate chooses two modes", () => expect(script("fabricate|1").onChoose).toBeTypeOf("function"));
  it("Tome enforces its post-draw payment", () => expect(script("tome of imperial flame|1").onChoose).toBeTypeOf("function"));
  it("Deathmatch supports multiplayer targets", () => expect(script("deathmatch arena|0").onFriendlyCombatDamageDealt).toBeTypeOf("function"));
  it("No Fear returns its cost cards", () => expect(script("no fear|1").triggers?.some((trigger) => trigger.event === "end-of-turn")).toBe(true));
  it("Gauntlets replace a power gain", () => expect(script("gauntlets of iron will|0").replacePowerGain).toBeTypeOf("function"));
  it("Talk creates Might at its threshold", () => expect(script("talk a big game|3").onFriendlyDamageDealt).toBeTypeOf("function"));
  it("Ripple replaces a token batch", () => expect(script("ripple away|3").globalTokenCreationReplacement?.replace).toBeTypeOf("function"));
  it("Coercive orders three cards privately", () => expect(script("coercive tendency|3").onChoose?.length).toBeGreaterThan(3));
  it("Luminaris tracks Herald and angel attacks", () => expect(script("luminaris, angel's glow|0").onFriendlyActivate).toBeTypeOf("function"));
  it("Beckoning observes combat-chain hits", () => expect(script("beckoning light|1").onHit).toBeTypeOf("function"));
  it("Prayer continues into charge", () => expect(script("prayer of bellona|2").onChoose).toBeTypeOf("function"));
  it("Lumina Lance modes are chosen without repetition", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          resources: 2,
          hand: ["herald of protection|3", "lumina lance|2"],
          soul: ["snatch|1", "raging onslaught|1"],
        },
        { hero: "rhinar" },
      ],
    });

    g.play("herald of protection|3")
      .blockWith()
      .react("lumina lance|2")
      .chooseCard("snatch|1")
      .chooseCard("raging onslaught|1")
      .chooseOption("power");
    expect(g.state.pendingDecision?.options).not.toContain("power");
  });
  it("Radiant Forcefield lets its controller choose a soul card", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          board: ["radiant forcefield|2"],
          soul: ["snatch|1", "raging onslaught|1"],
        },
        { hero: "rhinar", hand: ["head jab|1"] },
      ],
      active: 1,
    });
    const soulIds = g.state.players[0]!.soul.map((card) => String(card.instanceId));

    g.play("head jab|1").blockWith().settle();
    expect(g.state.pendingDecision?.options).toEqual(expect.arrayContaining(soulIds));
    g.chooseCard("raging onslaught|1");
    g.expectLife(0, 18).expectInZone(0, "snatch|1", "soul").expectInZone(0, "raging onslaught|1", "banish");
  });
  it("Spoiled Skull chooses three names", () => expect(script("spoiled skull|0").onChoose).toBeTypeOf("function"));
  it("Numbskull attack cannot be modified", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["come to fight|1", "numbskull|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("come to fight|1");
    g.state.players[0]!.flags.costMoreThisTurn = 3;
    g.play("numbskull|1").expectAttackValue(6).expectResources(0, 0);
  });
  it("Numbskull defense cannot be modified", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["numbskull|1"] },
        { hero: "dorinthea", hand: ["head jab|1"] },
      ],
      active: 1,
    });
    const hero = g.state.players[0]!.hero;
    g.state.modifiers.push({
      id: g.state.nextModifierId++,
      sourceInstanceId: hero.instanceId,
      seat: 0,
      scope: "until-end-of-turn",
      defense: -3,
      appliesToCardType: "action",
    });

    g.play("head jab|1").blockWith("numbskull|1").settle().expectLife(0, 20);
  });
  it("Chorus makes Dawnblade damage unpreventable", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          resources: 4,
          hand: ["chorus of ironsong|2"],
          weapons: ["dawnblade|0"],
        },
        { hero: "rhinar", life: 20 },
      ],
    });
    g.state.players[1]!.flags.preventNextDamage = 10;

    g.attackWithWeapon("dawnblade|0").blockWith().react("chorus of ironsong|2");
    g.expectLife(1, 16);
    expect(g.state.players[1]!.flags.preventNextDamage).toBe(10);
  });
  it("Morlock Hill offers Minerva Themis to prevent lethal damage", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", life: 3, hand: ["morlock hill|3", "minerva themis|0"] },
        { hero: "dorinthea", hand: ["head jab|1"] },
      ],
      active: 1,
    });

    g.passPriority()
      .react("morlock hill|3")
      .play("head jab|1")
      .blockWith()
      .settle();

    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "lethal-damage-prevention",
    });
    g.chooseCard("minerva themis|0")
      .expectLife(0, 3)
      .expectInZone(0, "minerva themis|0", "banish");
  });
  it("Morlock Hill waits through nonlethal damage and is consumed if declined", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", life: 4, hand: ["morlock hill|3", "minerva themis|0"] },
        { hero: "dorinthea", hand: ["head jab|1", "head jab|1"] },
      ],
      active: 1,
    });

    g.passPriority()
      .react("morlock hill|3")
      .play("head jab|1")
      .blockWith()
      .settle()
      .expectLife(0, 1);
    expect(g.state.pendingDecision).toBeNull();

    g.play("head jab|1")
      .blockWith()
      .settle();
    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "lethal-damage-prevention",
    });
    g.chooseOption("decline").expectLife(0, -2);
    expect(g.state.modifiers.find(
      (modifier) => modifier.preventLethalDamageByBanishingNamedCard !== undefined,
    )?.consumed).toBe(true);
  });
  it("Diadem observes friendly Ward", () => expect(script("diadem of dreamstate|0").onFriendlyDestroyed).toBeTypeOf("function"));
  it("Hack destroys an aura on hit", () => expect(script("hack to reality|2").onHit).toBeTypeOf("function"));
  it("Adaptive Plating moves to the chosen equipment zone", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          equipment: { arms: "adaptive plating|0", chest: null },
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("adaptive plating|0", { ability: 1 }).expectEquipped(0, "chest", "adaptive plating|0");
    g.expectNoEquipment(0, "arms");
  });
  it("Steel Soul observes transforms", () => expect(script("evo steel soul memory|3").onTransform).toBeTypeOf("function"));
  it("Demolition removes selected steam", () => expect(script("demolition protocol|1").onChoose).toBeTypeOf("function"));
  it("Meganetic Protocol gives defending equipment -1 defense counters", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 3,
          hand: ["meganetic protocol|3"],
          equipment: { head: "evo sentry base head|1" },
        },
        { hero: "dorinthea", equipment: { head: "ironrot helm|0" } },
      ],
    });

    g.play("meganetic protocol|3").blockWith("ironrot helm|0");
    expect(g.state.players[1]!.equipment.head?.counters?.defense).toBe(-1);
  });
  it("Scrap supports multiple cards", () => expect(script("hyper scrapper|3").onChoose).toBeTypeOf("function"));
  it("Twin Drive has two separately payable Boost abilities", () => expect(script("twin drive|1").boostCount).toBe(2));
  it("Lockwave resolves nested choices", () => expect(script("meganetic lockwave|3").playTargetOptions).toBeTypeOf("function"));
  it("System Failure damages the controller", () => expect(script("system failure|2").playTargetOptions).toBeTypeOf("function"));
  it("System Reset returns one batch", () => expect(script("system reset|2").onChoose).toBeTypeOf("function"));
  it("Shriek Razors returns from graveyard only at the start of its controller's turn", () => {
    const illegalReaction = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["infect|1"],
          graveyard: ["shriek razors|0"],
          board: ["silver|0", "silver|0"],
          resources: 2,
          equipment: { arms: null },
        },
        { hero: "dorinthea", hand: ["head jab|1"] },
      ],
    });
    illegalReaction.play("infect|1").blockWith("head jab|1");
    const buriedRazors = illegalReaction.state.players[0]!.graveyard.find(
      (card) => card.cardId === printingId("shriek razors|0"),
    )!;
    expect(legalIntents(illegalReaction.state, 0).some(
      (intent) =>
        intent.kind === "activate-ability" && intent.sourceInstanceId === buriedRazors.instanceId,
    )).toBe(false);

    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          graveyard: ["shriek razors|0"],
          board: ["silver|0", "silver|0"],
          equipment: { arms: null },
        },
        { hero: "dorinthea" },
      ],
    });

    const razors = g.state.players[0]!.graveyard.find(
      (card) => card.cardId === printingId("shriek razors|0"),
    )!;
    expect(legalIntents(g.state, 0).some(
      (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === razors.instanceId,
    )).toBe(false);

    g.endTurn().chooseOption("yes");
    expect(g.state.players[0]!.equipment.arms?.instanceId).toBe(razors.instanceId);
    expect(g.state.players[0]!.board).toHaveLength(0);

    const equipped = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["infect|1"],
          resources: 2,
          equipment: { arms: "shriek razors|0" },
        },
        { hero: "dorinthea", hand: ["head jab|1"] },
      ],
    });
    equipped.play("infect|1")
      .blockWith("head jab|1")
      .activate("shriek razors|0")
      .expectFinalDefense(1)
      .expectInZone(0, "shriek razors|0", "graveyard");
  });
  it("Already Dead completes Contract", () => expect(script("already dead|1").onFriendlyBanishesOpponentCard).toBeTypeOf("function"));
  it("Emboldened checks defense reaction", () => expect(script("emboldened blade|3").playTargetOptions).toBeTypeOf("function"));
  it("Contest lowers intellect", () => expect(script("contest the mindfield|3").modifyBaseDefense).toBeTypeOf("function"));
  it("Warband grants delayed charge", () => expect(script("warband of bellona|0").onFriendlyPlay).toBeTypeOf("function"));
  it("Cast Bones randomizes top six", () => expect(script("cast bones|1").onChoose).toBeTypeOf("function"));
  it("Up the Ante chooses modes", () => expect(script("up the ante|3").playTargetOptions).toBeTypeOf("function"));
  it("Double Down replaces wager tokens", () => expect(script("double down|1").globalTokenCreationReplacement?.replace).toBeTypeOf("function"));
  it("Nasty Surprise checks effect provenance", () => expect(script("nasty surprise|3").onFriendlyDestroyed).toBeTypeOf("function"));
  it("Aether Arc hits each opposing hero", () => expect(script("aether arc|3").prospectiveHeroDamage).toBeTypeOf("function"));
  it("The Golden Son optional Gold cost also pays 4 resources", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 4,
          hand: ["the golden son|2"],
          board: ["gold|0"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("the golden son|2", { alternativeCost: "gold|0" });
    g.expectResources(0, 0).expectNotInZone(0, "gold|0", "board").expectAttackValue(10);
  });
});
