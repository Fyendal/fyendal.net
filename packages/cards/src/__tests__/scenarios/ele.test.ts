import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";

const BLUE = "raging onslaught|3";
const EARTH = "autumn's touch|3";
const ICE = "winter's grasp|3";
const LIGHTNING = "heaven's claws|3";

const oldhim = { hero: "rhinar" as const, heroKey: "oldhim|0", weapons: [] as string[] };
const lexi = { hero: "rhinar" as const, heroKey: "lexi|0", weapons: [] as string[] };
const briar = { hero: "rhinar" as const, heroKey: "briar|0", weapons: [] as string[] };

describe("ELE — Fusion and Elemental heroes", () => {
  it("offers Blizzard only while an attack on the open combat chain is targetable", () => {
    const noChain = scenario({
      seats: [
        { hero: "rhinar", hand: ["blizzard|3"] },
        { hero: "dorinthea" },
      ],
    });
    const blizzardId = noChain.state.players[0]!.hand[0]!.instanceId;
    expect(legalIntents(noChain.state, 0).some((intent) =>
      intent.kind === "play-card" && intent.instanceId === blizzardId
    )).toBe(false);

    const openChain = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          hand: ["give and take|1", "head jab|1", "blizzard|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    openChain.play("give and take|1")
      .blockWith()
      .settle();

    const pastAttackId = openChain.state.chain[0]!.attackingCard.instanceId;
    const pastTargets = legalIntents(openChain.state, 0).flatMap((intent) =>
      intent.kind === "play-card" && intent.instanceId === openChain.state.players[0]!.hand.find(
        (card) => card.cardId === printingId("blizzard|3"),
      )?.instanceId && intent.targetCardInstanceId !== undefined
        ? [intent.targetCardInstanceId]
        : []
    );
    expect(new Set(pastTargets)).toEqual(new Set([pastAttackId]));

    openChain.play("head jab|1")
      .blockWith();

    const currentAttackId = openChain.state.chain[1]!.attackingCard.instanceId;
    const blizzard = openChain.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("blizzard|3"),
    )!;
    const allTargets = legalIntents(openChain.state, 0).flatMap((intent) =>
      intent.kind === "play-card" && intent.instanceId === blizzard.instanceId &&
        intent.targetCardInstanceId !== undefined
        ? [intent.targetCardInstanceId]
        : []
    );
    expect(new Set(allTargets)).toEqual(new Set([pastAttackId, currentAttackId]));
  });

  it("Blizzard prevents a later Snapdragon grant and resolves to graveyard when unpaid", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "ira, scarlet revenger|0",
          hand: ["head jab|1"],
          equipment: { legs: "snapdragon scalers|0" },
        },
        {
          hero: "dorinthea",
          heroKey: "jarl vetreiði|0",
          hand: ["shelter from the storm|1", "blizzard|3", "blink|3"],
        },
      ],
    });

    g.play("head jab|1")
      .blockWith()
      .activate("snapdragon scalers|0", { settle: false })
      .passPriority()
      .activate("shelter from the storm|1", { settle: false })
      .react("blizzard|3", { targetCard: "head jab|1", settle: false })
      .settle();
    g
      .chooseOption("legs")
      .settle();

    const link = g.state.chain.at(-1)!;
    expect(link.attackingCard.suppressedKeywords).toContain("go again");
    expect(link.goAgain).toBe(false);
    g.expectInZone(1, "blizzard|3", "graveyard")
      .expectInZone(0, "snapdragon scalers|0", "graveyard")
      .expectAP(0, 0);
  });

  it("an attack cannot regain go again after unpaid Blizzard resolves", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          hand: ["head jab|1"],
          equipment: { legs: "snapdragon scalers|0" },
        },
        { hero: "dorinthea", hand: ["blizzard|3"] },
      ],
    });

    g.play("head jab|1")
      .blockWith()
      .passPriority()
      .react("blizzard|3", { targetCard: "head jab|1", settle: false })
      .passPriority()
      .passPriority()
      .doRaw({ kind: "choose", optionId: "no" })
      .activate("snapdragon scalers|0", { settle: false })
      .passPriority()
      .passPriority();

    expect(g.state.chain.at(-1)?.goAgain).toBe(false);
  });

  it("Rosetta Thorn deals arcane damage after an attack and non-attack action", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["rosetta thorn|0"],
          resources: 1,
          hand: ["mauvrion skies|2", "head jab|1"],
        },
        { hero: "dorinthea", life: 20 },
      ],
    });

    g.play("mauvrion skies|2")
      .play("head jab|1")
      .blockWith()
      .settle();
    expect(g.state.players[1]!.life).toBe(17);
    const lifeBeforeRosetta = g.state.players[1]!.life;

    g.attackWithWeapon("rosetta thorn|0");
    expect(g.state.players[1]!.life).toBe(lifeBeforeRosetta - 2);
  });

  it("Duskblade gains a counter after an attack and non-attack action", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["duskblade|0"],
          resources: 1,
          hand: ["mauvrion skies|2", "head jab|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("mauvrion skies|2")
      .play("head jab|1")
      .blockWith()
      .settle();

    const duskbladeBeforeAttack = g.state.players[0]!.weapons.find(
      (card) => card.cardId === printingId("duskblade|0"),
    );
    expect(duskbladeBeforeAttack?.counters?.power).toBeUndefined();

    g.attackWithWeapon("duskblade|0");

    const duskblade = g.state.players[0]!.weapons.find(
      (card) => card.cardId === printingId("duskblade|0"),
    );
    expect(duskblade?.counters?.power).toBe(1);
  });

  it("Earth Fusion gives Entwine Earth +2 power", () => {
    const g = scenario({
      seats: [
        { ...oldhim, hand: ["entwine earth|1", EARTH, EARTH] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("entwine earth|1", { pitch: [EARTH] })
      .chooseCard(EARTH)
      .expectAttackValue(8)
      .blockWith()
      .settle()
      .expectFinalAttack(8);
  });

  it("Oaken Old asks for an Ice card, then an Earth card, with card previews", () => {
    const g = scenario({
      seats: [
        { ...oldhim, resources: 3, hand: ["oaken old|1", ICE, EARTH] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    const iceId = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId(ICE),
    )!.instanceId;
    const earthId = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId(EARTH),
    )!.instanceId;

    g.play("oaken old|1");

    expect(g.state.pendingDecision).toMatchObject({
      prompt: "Reveal an Ice card to fuse Oaken Old?",
      options: ["no", String(iceId)],
      cardOptions: [null, iceId],
    });
    expect(projectStateFor(g.state, 0).pendingDecision?.optionCards?.map(
      (card) => card?.instanceId ?? null,
    )).toEqual([null, iceId]);

    g.chooseCard(ICE);

    expect(g.state.pendingDecision).toMatchObject({
      prompt: "Reveal an Earth card to fuse Oaken Old?",
      options: ["no", String(earthId)],
      cardOptions: [null, earthId],
    });
    expect(projectStateFor(g.state, 0).pendingDecision?.optionCards?.map(
      (card) => card?.instanceId ?? null,
    )).toEqual([null, earthId]);

    g.chooseCard(EARTH)
      .expectAttackValue(9);
    const fusedLink = projectStateFor(g.state, 0).chain.at(-1);
    expect(fusedLink?.dominate).toBe(true);
    expect(fusedLink?.onHitEffects).toHaveLength(1);
  });

  it("Oaken Old can reveal the same card when it is both Ice and Earth", () => {
    const g = scenario({
      seats: [
        {
          ...oldhim,
          resources: 3,
          hand: ["oaken old|1", "pulse of isenloft|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    const pulseId = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("pulse of isenloft|3"),
    )!.instanceId;

    g.play("oaken old|1");
    expect(g.state.pendingDecision?.cardOptions).toEqual([null, pulseId]);

    g.chooseCard("pulse of isenloft|3");
    expect(g.state.pendingDecision?.cardOptions).toEqual([null, pulseId]);

    g.chooseCard("pulse of isenloft|3")
      .expectAttackValue(9);
  });

  it("Oaken Old is not fused after revealing only one required element", () => {
    const g = scenario({
      seats: [
        { ...oldhim, resources: 3, hand: ["oaken old|1", ICE, EARTH] },
        { hero: "dorinthea", hand: [BLUE, LIGHTNING] },
      ],
    });

    g.play("oaken old|1")
      .chooseCard(ICE)
      .chooseOption("no")
      .expectAttackValue(7);

    const unfusedLink = projectStateFor(g.state, 0).chain.at(-1);
    expect(unfusedLink?.dominate).toBe(false);
    expect(unfusedLink?.onHitEffects).toBeUndefined();
    g.blockWith()
      .settle()
      .expectHandSize(1, 2);
  });

  it("fused Entangle gives the hit hero's first attack next turn -2 power", () => {
    const g = scenario({
      seats: [
        { ...oldhim, hand: ["entangle|1", EARTH, EARTH] },
        { hero: "dorinthea", hand: ["ball lightning|1"] },
      ],
    });

    g.play("entangle|1", { pitch: [EARTH] })
      .chooseCard(EARTH)
      .blockWith()
      .settle()
      .endTurn()
      .play("ball lightning|1")
      .expectAttackValue(1);
  });

  it("Oldhim's Earth-pitched defense reaction prevents the next 2 damage", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...oldhim, hand: [EARTH] },
        { hero: "dorinthea", resources: 1, hand: ["heaven's claws|1"] },
      ],
    });

    g.play("heaven's claws|1")
      .blockWith()
      .passPriority()
      .activate("oldhim|0", { pitch: [EARTH] })
      .expectLife(0, 17);
  });

  it("Oldhim's Ice-pitched defense reaction puts an attacking hero's hand card on top", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...oldhim, hand: [ICE] },
        { hero: "dorinthea", resources: 1, hand: ["heaven's claws|1", BLUE] },
      ],
    });

    g.play("heaven's claws|1")
      .blockWith()
      .passPriority()
      .activate("oldhim|0", { pitch: [ICE] })
      .chooseCard(BLUE)
      .expectDeckTop(1, BLUE);
  });

  it("Lexi turns a Lightning arsenal card face up and gives the next attack go again", () => {
    const g = scenario({
      seats: [
        {
          ...lexi,
          resources: 1,
          arsenalFaceDown: [LIGHTNING],
          hand: ["heaven's claws|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.activate("lexi|0")
      .chooseCard(LIGHTNING)
      .expectFaceDown(0, LIGHTNING, false)
      .play("heaven's claws|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Lexi turns an Ice arsenal card face up and creates Frostbite", () => {
    const g = scenario({
      seats: [
        { ...lexi, arsenalFaceDown: [ICE] },
        { hero: "dorinthea" },
      ],
    });

    g.activate("lexi|0")
      .chooseCard(ICE)
      .chooseOption("opponent")
      .expectInZone(1, "frostbite|0", "board");
  });

  it("Cold Wave taxes an opposing activated ability after Ice Fusion", () => {
    const g = scenario({
      seats: [
        {
          ...lexi,
          weapons: ["death dealer|0"],
          resources: 1,
          arsenal: ["cold wave|1"],
          hand: [ICE],
        },
        { ...oldhim, hand: [EARTH] },
      ],
    });

    g.play("cold wave|1", { fromArsenal: true })
      .chooseCard(ICE)
      .blockWith()
      .passPriority();

    const oldhimId = g.state.players[1]!.hero.instanceId;
    expect(legalIntents(g.state, 1)).not.toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: oldhimId,
    }));
  });

  it("fused Snap Shot lets Death Dealer activate again as an instant", () => {
    const g = scenario({
      seats: [
        {
          ...lexi,
          weapons: ["death dealer|0"],
          resources: 2,
          hand: ["snap shot|1", LIGHTNING, "arc bending|1"],
          deck: [BLUE],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.activate("death dealer|0")
      .chooseCard("snap shot|1")
      .play("snap shot|1", { fromArsenal: true })
      .chooseCard(LIGHTNING)
      .blockWith()
      .settle()
      .expectAP(0, 0)
      .activate("death dealer|0")
      .chooseCard("arc bending|1")
      .expectInZone(0, "arc bending|1", "arsenal")
      .play("arc bending|1", { fromArsenal: true, pitch: [LIGHTNING] })
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("preserves Snap Shot's extra Death Dealer use when the bow was unused", () => {
    const g = scenario({
      seats: [
        {
          ...lexi,
          weapons: ["death dealer|0"],
          resources: 1,
          arsenal: ["snap shot|1"],
          hand: ["arc bending|1", "arc bending|1", LIGHTNING, LIGHTNING],
          deck: [BLUE, BLUE],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("snap shot|1", { fromArsenal: true })
      .chooseCard(LIGHTNING)
      .blockWith()
      .settle()
      .expectAP(0, 0)
      .activate("death dealer|0")
      .chooseCard("arc bending|1")
      .play("arc bending|1", { fromArsenal: true, pitch: [LIGHTNING] })
      .blockWith()
      .activate("death dealer|0")
      .chooseCard("arc bending|1")
      .expectInZone(0, "arc bending|1", "arsenal");
  });

  it("fused Snap Shot lets Voltaire activate an additional time as an instant", () => {
    const g = scenario({
      seats: [
        {
          ...lexi,
          weapons: ["voltaire, strike twice|0"],
          resources: 3,
          hand: ["snap shot|1", LIGHTNING, "dazzling crescendo|3", "arc bending|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.activate("voltaire, strike twice|0")
      .chooseCard("dazzling crescendo|3")
      .chooseOption("go again")
      .play("dazzling crescendo|3", { fromArsenal: true })
      .chooseOption("no")
      .blockWith()
      .settle()
      .activate("voltaire, strike twice|0")
      .chooseCard("snap shot|1")
      .chooseOption("go again")
      .play("snap shot|1", { fromArsenal: true })
      .chooseCard(LIGHTNING)
      .blockWith()
      .activate("voltaire, strike twice|0")
      .chooseCard("arc bending|1")
      .chooseOption("power")
      .expectInZone(0, "arc bending|1", "arsenal");
  });

  it("Turn Timber gets +2 defense when Earth fused", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...oldhim, hand: ["turn timber|1", EARTH, EARTH] },
        { hero: "dorinthea", hand: ["ball lightning|1"] },
      ],
    });

    g.play("ball lightning|1")
      .blockWith()
      .passPriority()
      .react("turn timber|1", { pitch: [EARTH] })
      .chooseCard(EARTH)
      .settle()
      .expectFinalDefense(8);
  });
});

describe("ELE — delayed and replacement effects", () => {
  it("fused Strength of Sequoia enters as an aura and creates Seismic Surge", () => {
    const g = scenario({
      seats: [
        { ...oldhim, hand: ["strength of sequoia|2", EARTH, EARTH] },
        { hero: "dorinthea" },
      ],
    });

    g.play("strength of sequoia|2", { pitch: [EARTH] })
      .chooseCard(EARTH)
      .expectInZone(0, "strength of sequoia|2", "board")
      .expectInZone(0, "seismic surge|0", "board");
  });

  it("Ball Lightning increases its combat damage and Electrify damage", () => {
    const g = scenario({
      seats: [
        {
          ...lexi,
          resources: 1,
          hand: ["electrify|1", "ball lightning|1"],
        },
        { hero: "dorinthea", life: 20, hand: [] },
      ],
    });

    g.play("electrify|1")
      .play("ball lightning|1")
      .blockWith()
      .settle()
      .expectLife(1, 12);
  });

  it("Vela Flash allows the next non-attack action to fuse and resolve as an instant", () => {
    const g = scenario({
      seats: [
        {
          ...briar,
          resources: 2,
          hand: ["vela flash|1", "inspire lightning|1", LIGHTNING],
        },
        { hero: "dorinthea", life: 20, hand: [] },
      ],
    });

    g.play("vela flash|1")
      .chooseCard(LIGHTNING)
      .blockWith()
      .react("inspire lightning|1")
      .chooseCard(LIGHTNING)
      .settle()
      .expectLife(1, 12);
  });

  it("Flash waits for the next action meeting its printed cost threshold", () => {
    const g = scenario({
      seats: [
        {
          ...lexi,
          resources: 2,
          hand: ["flash|3", "invigorate|3", "entwine earth|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("flash|3")
      .play("invigorate|3")
      .play("entwine earth|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Sow Tomorrow played from arsenal draws, recycles a legal card, and banishes itself", () => {
    const g = scenario({
      seats: [
        {
          ...oldhim,
          resources: 1,
          arsenal: ["sow tomorrow|1"],
          graveyard: ["entwine earth|1"],
          deck: [BLUE],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("sow tomorrow|1", { fromArsenal: true })
      .chooseCard("entwine earth|1")
      .expectInZone(0, "sow tomorrow|1", "banish")
      .expectDeckBottom(0, "entwine earth|1")
      .expectHandSize(0, 1);
  });

  it("Evergreen played from arsenal goes to the bottom when the chain closes", () => {
    const g = scenario({
      seats: [
        {
          ...oldhim,
          resources: 3,
          arsenal: ["evergreen|1"],
          deck: [BLUE, BLUE, BLUE, BLUE],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("evergreen|1", { fromArsenal: true })
      .blockWith()
      .settle()
      .endTurn()
      .expectDeckBottom(0, "evergreen|1")
      .expectNotInZone(0, "evergreen|1", "graveyard");
  });

  it("Mark of Lightning waits on a respondable trigger before dealing damage", () => {
    const g = scenario({
      seats: [
        { ...briar, equipment: { arms: "mark of lightning|0" }, hand: ["ball lightning|1"] },
        { hero: "dorinthea", hand: [BLUE, "sigil of solace|3"] },
      ],
    });

    g.play("ball lightning|1").blockWith(BLUE);

    expect(g.state.stack).toContainEqual(expect.objectContaining({
      sourceInstanceId: g.state.players[0]!.equipment.arms!.instanceId,
      optional: true,
    }));
    expect(g.state.pendingDecision?.kind).toBe("priority-window");

    g.passPriority()
      .passPriority()
      .chooseOption("yes")
      // Ball Lightning replaces the attack's 1 damage with 2.
      .expectLife(1, 18)
      .expectInZone(0, "mark of lightning|0", "graveyard");
    expect(g.state.players[0]!.equipment.arms).toBeUndefined();
  });

  it("unused Spellbound Creepers do not trigger during the end phase", () => {
    const g = scenario({
      seats: [
        { ...briar, equipment: { legs: "spellbound creepers|0" } },
        { hero: "dorinthea" },
      ],
    });

    g.endTurn().expectEquipped(0, "legs", "spellbound creepers|0");

    expect(g.state.log).not.toContainEqual(expect.objectContaining({
      publicText: expect.stringContaining("Spellbound Creepers triggers"),
    }));
  });

  it("activated Spellbound Creepers still perform their end-phase check", () => {
    const g = scenario({
      seats: [
        {
          ...briar,
          resources: 1,
          equipment: { legs: "spellbound creepers|0" },
          hand: ["ball lightning|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("ball lightning|1")
      .blockWith()
      .settle()
      .activate("spellbound creepers|0")
      .endTurn()
      .expectNoEquipment(0, "legs");
  });
});

describe("ELE — data registration", () => {
  it("registers the young heroes and native vanilla cards", () => {
    expect(printingId("oldhim|0")).toBe("ELE002");
    expect(printingId("lexi|0")).toBe("ELE032");
    expect(printingId("autumn's touch|1")).toBe("ELE128");
    expect(printingId("rotten old buckler|0")).toBe("ELE204");
  });
});
