import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData, isImplemented } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { printingId, scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

describe("PEN — import and set mechanics", () => {
  it("registers every eligible PEN printing as implemented", () => {
    const cards = Object.values(cardData).filter((card) => card.set === "PEN");
    expect(cards).toHaveLength(348);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
    expect(new Set(cards.map(functionalKeyOf))).toHaveLength(348);
  });

  it("declares and pays Touch of Reality's X activation cost before tapping it", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["raging onslaught|3"], equipment: { ...NO_EQUIPMENT, arms: "touch of reality|0" } },
      { hero: "dorinthea", hand: ["sigil of solace|1"], equipment: NO_EQUIPMENT },
    ] });
    g.activate("touch of reality|0", { settle: false });
    expect(g.state.pendingDecision?.options).toContain("X = 2");
    expect(g.state.players[0]!.equipment.arms?.tapped).not.toBe(true);
    g.chooseOption("X = 2");
    expect(g.state.pendingDecision?.resourcePayment?.cost).toBe(2);
    g.doRaw({ kind: "choose", optionId: g.state.pendingDecision!.options![0]! });
    expect(g.state.players[0]!.equipment.arms?.tapped).toBe(true);
    expect(g.state.players[0]!.equipment.arms?.counters?.wardX).toBe(2);
    expect(g.state.stack).toHaveLength(1);
  });

  it("activates Touch of Reality at X=0 without an empty payment decision", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", equipment: { ...NO_EQUIPMENT, arms: "touch of reality|0" } },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("touch of reality|0", { settle: false });
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-variable-activation-x");

    g.chooseOption("X = 0");

    expect(g.state.pendingDecision?.chooseHook).not.toBe("engine-variable-activation-payment");
    expect(g.state.players[0]!.equipment.arms?.tapped).toBe(true);
  });

  it("pays Touch of Reality's X cost from floating resources without another decision", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        resources: 2,
        equipment: { ...NO_EQUIPMENT, arms: "touch of reality|0" },
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("touch of reality|0", { settle: false });
    g.chooseOption("X = 2");

    expect(g.state.pendingDecision?.chooseHook).not.toBe("engine-variable-activation-payment");
    expect(g.state.players[0]!.resources).toBe(0);
    expect(g.state.players[0]!.equipment.arms).toMatchObject({
      tapped: true,
      counters: { wardX: 2 },
    });
  });

  it("Oath of Oak creates the pitch-scaled Embodiment batch", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["oath of oak|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("oath of oak|1");
    expect(g.state.players[0]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!) === "embodiment of earth|0")).toHaveLength(3);
  });

  it("Rip Off the Top pitches a random card without asking the player to choose", () => {
    const g = scenario({
      seed: 1,
      seats: [
        {
          hero: "rhinar",
          hand: ["rip off the top|2", "dodge|3"],
          deck: ["pack hunt|1"],
          resources: 1,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("rip off the top|2");

    expect(g.state.pendingDecision?.chooseHook).not.toBe("rip-top-pitch");
    expect(g.state.players[0]!.hand).toHaveLength(1);
    expect(g.state.players[0]!.pitch).toHaveLength(1);
    g.expectInZone(0, "dodge|3", "pitch")
      .expectInZone(0, "pack hunt|1", "hand");
  });

  it("Cloud Cover prevents the next damage event", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", hand: ["cloud cover|2"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("head jab|1").blockWith().passPriority().react("cloud cover|2").settle().expectLife(0, 19);
  });

  it("Doubling Season adds one to each positive power gain", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["doubling season|1", "sprout strength|3"], resources: 3, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("sprout strength|3").play("doubling season|1").expectAttackValue(2);
  });

  it("Decompose chooses two Earth cards before the distinct action card", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["sowing thorns|1"],
          graveyard: ["fruits of the forest|1", "colors of aria|1", "wounding blow|1"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("sowing thorns|1");
    expect(g.state.pendingDecision?.prompt).toMatch(/first Earth/i);
    g.chooseCard("fruits of the forest|1");
    expect(g.state.pendingDecision?.prompt).toMatch(/second Earth/i);
    g.chooseCard("colors of aria|1");
    expect(g.state.pendingDecision?.prompt).toMatch(/action card/i);
    g.chooseCard("wounding blow|1").expectZoneSize(0, "banish", 3);
  });

  it("Excessive Bloodloss repeats once after banishing a red card", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["excessive bloodloss|1"], resources: 1, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", deck: ["head jab|1", "head jab|2"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("excessive bloodloss|1").blockWith().settle();
    expect(g.state.players[1]!.banish).toHaveLength(2);
    expect(g.state.players[0]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!) === "silver|0")).toHaveLength(1);
  });

  it("Smoldering Scales may replace an incoming Frostbite batch", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", equipment: { ...NO_EQUIPMENT, chest: "smoldering scales|0" } },
        { hero: "dorinthea", hand: ["song of larinkmorth white|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("song of larinkmorth white|3").chooseOption("yes");
    expect(g.state.players[0]!.equipment.chest).toBeUndefined();
    expect(g.state.players[0]!.board.some(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "frostbite|0",
    )).toBe(false);
  });

  it("Savage Claw gets +1 when a six-power card pays for its attack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["savage claw|0"], hand: ["smash instinct|2"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("savage claw|0", { pitch: ["smash instinct|2"] })
      .blockWith()
      .settle()
      .expectFinalAttack(4);
  });

  it("Blunten triggers on the stack only when it defends a weapon attack", () => {
    const weaponAttack = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["savage claw|0"],
          hand: ["wrecker romp|3", "snatch|1"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", hand: ["blunten|2"], equipment: NO_EQUIPMENT },
      ],
    });

    weaponAttack
      .attackWithWeapon("savage claw|0", { pitch: ["wrecker romp|3"] })
      .blockWith("blunten|2");

    expect(weaponAttack.state.chain.at(-1)?.attackCardType).toBe("weapon");
    expect(weaponAttack.state.stack[0]?.engineEffect?.kind).toBe("on-defend-hook");
    expect(weaponAttack.state.stack[0]?.label).toBe("When this defends");
    expect(weaponAttack.state.pendingDecision?.kind).toBe("priority-window");
    expect(weaponAttack.state.players[0]!.hand).toHaveLength(1);

    weaponAttack.settle();
    expect(weaponAttack.state.pendingDecision?.chooseHook).toBe("blunten-discard");
    weaponAttack.chooseCard("snatch|1").expectInZone(0, "snatch|1", "graveyard");

    const actionAttack = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1", "snatch|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["blunten|2"], equipment: NO_EQUIPMENT },
      ],
    });

    actionAttack.play("head jab|1").blockWith("blunten|2");

    expect(actionAttack.state.stack).toHaveLength(0);
  });

  it("Rainbow Goo Trap requires power above base, dominate, and go again", () => {
    const missingDominate = scenario({
      seats: [
        { hero: "rhinar", hand: ["nimblism|1", "head jab|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["rainbow goo trap|1"], equipment: NO_EQUIPMENT },
      ],
    });

    missingDominate.play("nimblism|1").play("head jab|1").blockWith().passPriority()
      .react("rainbow goo trap|1", { settle: false })
      .passPriority().passPriority();

    expect(missingDominate.state.stack).toHaveLength(0);

    const allConditions = scenario({
      seats: [
        { hero: "rhinar", heroKey: "ira, crimson haze|0", hand: ["head jab|1", "open the center|3", "wrecker romp|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["rainbow goo trap|1"], equipment: NO_EQUIPMENT },
      ],
    });

    allConditions.play("head jab|1").blockWith().settle()
      .play("open the center|3", { pitch: ["wrecker romp|3"] }).expectAttackValue(5)
      .blockWith().passPriority()
      .react("rainbow goo trap|1", { settle: false })
      .passPriority().passPriority();

    expect(allConditions.state.stack[0]?.engineEffect?.kind).toBe("on-defend-hook");
    allConditions.passPriority().passPriority().expectAttackValue(2);
    expect(allConditions.state.chain.at(-1)?.goAgain).toBe(false);
    expect(allConditions.state.chain.at(-1)?.flags.attackAbilitiesSuppressed).toBe(true);
  });

  it("Courageous Crossing guards on above-base power and can target an opposing permanent", () => {
    const basePower = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["courageous crossing|3"], equipment: NO_EQUIPMENT },
      ],
    });
    basePower.play("head jab|1").blockWith("courageous crossing|3");
    expect(basePower.state.stack).toHaveLength(0);

    const aboveBase = scenario({
      seats: [
        { hero: "rhinar", heroKey: "hala|0", weapons: ["durendal|0"], resources: 4, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["courageous crossing|3"], equipment: NO_EQUIPMENT },
      ],
    });
    aboveBase.activate("hala|0").activate("durendal|0").blockWith("courageous crossing|3").settle();
    expect(aboveBase.state.pendingDecision?.chooseHook).toBe("pen-remove-power");
    aboveBase.chooseCard("durendal|0");
    expect(aboveBase.state.players[0]!.weapons[0]!.counters?.power ?? 0).toBe(0);
  });

  it("Quickening Sand chooses any hero or ally to tap", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1"], board: ["aether ashwing|0"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["quickening sand|3"], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("head jab|1").blockWith("quickening sand|3").settle();
    expect(g.state.pendingDecision?.chooseHook).toBe("pen-quickening-tap");
    g.chooseCard("aether ashwing|0");
    expect(g.state.players[0]!.board.find((card) => cardData[card.cardId]?.name === "Aether Ashwing")?.tapped).toBe(true);
  });

  it("Tiger Trap counts only attacks whose power is greater than base", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["nimblism|1", "head jab|1", "nimblism|1", "head jab|1", "head jab|1"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", hand: ["tiger trap|1"], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("nimblism|1").play("head jab|1").blockWith().settle()
      .play("nimblism|1").play("head jab|1").blockWith().settle()
      .play("head jab|1").blockWith().passPriority()
      .react("tiger trap|1", { settle: false })
      .passPriority().passPriority();

    expect(g.state.stack).toHaveLength(0);
    expect(g.state.players[0]!.flags.attacksCannotGainPower).not.toBe(true);

    const qualifying = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["roar of the tiger|2", "crouching tiger|0", "crouching tiger|0"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", hand: ["tiger trap|1"], equipment: NO_EQUIPMENT },
      ],
    });

    qualifying.play("roar of the tiger|2")
      .play("crouching tiger|0").blockWith().settle()
      .play("crouching tiger|0").blockWith().settle()
      .play("DYN065").blockWith().passPriority()
      .react("tiger trap|1", { settle: false })
      .passPriority().passPriority();

    expect(qualifying.state.stack[0]?.engineEffect?.kind).toBe("on-defend-hook");
    qualifying.settle();
    expect(qualifying.state.players[0]!.flags.attacksCannotGainPower).toBe(true);
  });

  it("Heavy Metal Hardcore gets +1 after an Evo is banished for Boost", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["heavy metal hardcore|1"],
          deck: ["evo beta base head|3"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("heavy metal hardcore|1", { boost: true }).expectAttackValue(4);
    expect(g.state.players[0]!.flags["boostedSubtype:evo"]).toBe(true);
  });

  it("Ghost Protocol: Architect lets its controller choose which eligible Evo to banish", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["ghost protocol: architect|1"],
          deck: ["evo beta base head|3", "evo beta base chest|3"],
          equipment: { ...NO_EQUIPMENT, head: "evo sentry base head|1" },
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("ghost protocol: architect|1");
    expect(g.state.pendingDecision?.chooseHook).toBe("ghost-architect-evo");
    expect(g.state.pendingDecision?.options).toHaveLength(2);

    g.chooseCard("evo beta base chest|3");

    g.expectInZone(0, "evo beta base chest|3", "banish")
      .expectInZone(0, "evo beta base head|3", "deck")
      .expectLog("shuffles their deck");
  });

  it("Cheating Scoundrel may discard to replace a lost wager", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["cheating scoundrel|1", "head jab|1", "wrecker romp|3"],
          equipment: NO_EQUIPMENT,
        },
        {
          hero: "dorinthea",
          hand: ["raging onslaught|1", "raging onslaught|2"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("cheating scoundrel|1").play("head jab|1")
      .blockWith("raging onslaught|1", "raging onslaught|2").settle();
    expect(g.state.pendingDecision?.prompt).toContain("Discard a card to win the wager");
    g.chooseCard("wrecker romp|3");

    expect(g.state.players[0]!.board.some(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "gold|0",
    )).toBe(true);
    expect(g.state.players[1]!.board.some(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "gold|0",
    )).toBe(false);
    g.expectLog("Rhinar wins the wager");
  });

  it("Cheating Scoundrel replaces the first lost wager even when another effect created it", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["cheating scoundrel|1", "money where ya mouth is|1", "head jab|1", "wrecker romp|3"],
          resources: 20,
          equipment: NO_EQUIPMENT,
        },
        {
          hero: "dorinthea",
          hand: ["ten foot tall and bulletproof|1"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("cheating scoundrel|1").play("money where ya mouth is|1")
      .play("head jab|1", { settle: false });
    const order = g.state.pendingDecision;
    const moneyIndex = order?.optionLabels?.findIndex((label) => label === "Wager with the defending hero?") ?? -1;
    expect(order?.chooseHook).toBe("trigger-order");
    expect(moneyIndex).toBeGreaterThanOrEqual(0);
    g.doRaw({ kind: "choose", optionId: order!.options![moneyIndex]! })
      .settle().chooseOption("yes").settle()
      .blockWith("ten foot tall and bulletproof|1").settle();

    expect(g.state.pendingDecision?.prompt).toContain("Discard a card to win the wager");
    g.chooseCard("wrecker romp|3");
    expect(g.state.players[0]!.board.some(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "gold|0",
    )).toBe(true);
  });

  it("a spent Cheating Scoundrel does not block another copy", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: [
            "cheating scoundrel|1",
            "cheating scoundrel|1",
            "head jab|1",
            "wrecker romp|3",
          ],
          resources: 20,
          equipment: NO_EQUIPMENT,
        },
        {
          hero: "dorinthea",
          hand: ["ten foot tall and bulletproof|1", "ten foot tall and bulletproof|1"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("cheating scoundrel|1").play("cheating scoundrel|1")
      .play("head jab|1").blockWith(
        "ten foot tall and bulletproof|1",
        "ten foot tall and bulletproof|1",
      ).settle();
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "engine-wager-loss-replacement-order",
    });
    g.doRaw({
      kind: "choose",
      optionId: g.state.pendingDecision!.options![0]!,
    });
    expect(g.state.pendingDecision?.prompt).toContain("Discard a card to win the wager");
    g.chooseOption("no");
    expect(g.state.pendingDecision?.prompt).toContain("Discard a card to win the wager");
  });

  it("Channel Iceloch Glaze freezes an opposing arsenal conditionally", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", board: ["channel iceloch glaze|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", arsenal: ["head jab|1"], board: ["frostbite|0"], equipment: NO_EQUIPMENT },
      ],
    });
    const arsenal = g.state.players[1]!.arsenal[0]!;
    expect(legalIntents(g.state, 1).some((intent) =>
      intent.kind === "play-from-arsenal" && intent.instanceId === arsenal.instanceId,
    )).toBe(false);
  });
});

describe("PEN — generalized rules interactions", () => {
  it("Seismic Shift lets its controller announce X, tap exactly X Surges, and choose its targets", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["seismic shift|1"], board: ["seismic surge|0", "seismic surge|0"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", board: ["frostbite|0", "frostbite|0"], equipment: NO_EQUIPMENT },
      ],
    });
    const surges = g.state.players[0]!.board.map((card) => card.instanceId);
    g.play("seismic shift|1", { settle: false });
    expect(g.state.pendingDecision?.prompt).toMatch(/choose x/i);
    g.chooseOption("1").chooseCard("seismic surge|0").chooseCard("frostbite|0");
    expect(g.state.players[0]!.board.filter(
      (card) => surges.includes(card.instanceId) && card.tapped,
    )).toHaveLength(1);
    expect(g.state.players[1]!.board.filter(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "frostbite|0",
    )).toHaveLength(1);
  });

  it("Stormweaver's Aegis grants owned instants a discard prevention ability", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["flash bolt|1"], equipment: { ...NO_EQUIPMENT, chest: "stormweaver's aegis|0" } },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("stormweaver's aegis|0");
    const instant = g.state.players[0]!.hand[0]!;
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === instant.instanceId,
    )).toBe(true);
    g.activate("flash bolt|1");
    expect(g.state.players[0]!.graveyard.some((card) => card.instanceId === instant.instanceId)).toBe(true);
    expect(g.state.players[0]!.flags.preventNextDamage).toBe(2);
  });

  it("Sigil of Gravespawning triggers whenever an aura leaves its graveyard", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["sigil of gravespawning|3"], graveyard: ["sigil of gravespawning|3"], resources: 3, equipment: { ...NO_EQUIPMENT, arms: "beckoning haunt|0" } },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("beckoning haunt|0", { ability: 1 }).chooseCard("sigil of gravespawning|3").expectLife(1, 19);
  });

  it("Dynastic Diadem protects Fealty from opposing effects", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", board: ["fealty|0"], equipment: { ...NO_EQUIPMENT, head: "dynastic diadem|0" } },
        { hero: "dorinthea", hand: ["destructive fleetfoot|1"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("destructive fleetfoot|1").blockWith().settle().chooseCard("fealty|0").expectInZone(0, "fealty|0", "board");
  });

  it("Colors of Aria supplies all three elemental types in hand", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["seeds of strength|1", "colors of aria|1"], resources: 1, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("seeds of strength|1", { pitch: ["colors of aria|1"] });
    expect(g.state.players[0]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!) === "might|0")).toHaveLength(4);
  });

  it("Distant Rumbling inserts the chosen card fifth from the top", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["distant rumbling|3", "head jab|1"], deck: ["head jab|2", "head jab|3", "smash instinct|1", "smash instinct|2", "smash instinct|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("distant rumbling|3").chooseCard("head jab|1");
    expect(functionalKeyOf(cardData[g.state.players[0]!.deck[4]!.cardId]!)).toBe("head jab|1");
  });

  it("Tigrine Reflex recognizes a previous attack that gained Crouching Tiger's name", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["crouching tiger|0", "become the bottle|1", "tigrine reflex|1"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("crouching tiger|0").blockWith().settle()
      .play("become the bottle|1").chooseCard("crouching tiger|0")
      .blockWith().settle();

    expect(g.state.chain[1]!.attackingCard.grantedNames).toContain("Crouching Tiger");

    g.play("tigrine reflex|1")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Shimmering Mirage may be played again during its combat chain", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1", "head jab|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["shimmering mirage|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("head jab|1").blockWith().passPriority().react("shimmering mirage|3").settle();
    const mirage = g.state.players[1]!.banish.find((card) => card.cardId === printingId("shimmering mirage|3"));
    expect(mirage).toBeDefined();
    g.play("head jab|1").blockWith().passPriority();
    expect(legalIntents(g.state, 1).some((intent) =>
      intent.kind === "play-from-zone" && intent.zone === "banish" && intent.instanceId === mirage?.instanceId,
    )).toBe(true);
  });

  it("Graven equipment returns from graveyard by destroying two Silver", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", graveyard: ["graven cowl|0"], board: ["silver|0", "silver|0"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.endTurn().endTurn().chooseOption("yes");
    expect(g.state.players[0]!.equipment.head?.cardId).toBe(printingId("graven cowl|0"));
    expect(g.state.players[0]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!) === "silver|0")).toHaveLength(0);
  });

  it("Seeker Kunai returns from graveyard only at the start of its controller's turn", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          graveyard: ["seeker kunai|1"],
          board: ["silver|0", "silver|0"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    const kunai = g.state.players[0]!.graveyard.find(
      (card) => card.cardId === printingId("seeker kunai|1"),
    )!;
    expect(legalIntents(g.state, 0).some(
      (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === kunai.instanceId,
    )).toBe(false);

    g.endTurn().chooseOption("yes");
    expect(g.state.players[0]!.board.some((card) => card.instanceId === kunai.instanceId)).toBe(true);
    expect(g.state.players[0]!.board.filter(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "silver|0",
    )).toHaveLength(0);

    const activated = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["infect|1"],
          board: ["seeker kunai|1"],
          resources: 1,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    activated.play("infect|1")
      .blockWith()
      .activate("seeker kunai|1")
      .expectFinalAttack(4)
      .expectInZone(0, "seeker kunai|1", "graveyard");
  });

  it("Ransack and Raze declares the chosen landmark's cost as X", () => {
    const g = scenario({
      globals: ["treasure island|0"],
      seats: [
        { hero: "rhinar", hand: ["ransack and raze|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("ransack and raze|3").chooseOption("X = 0").settle();
    expect(g.state.globalCardIds).not.toContain(printingId("treasure island|0"));
  });
});
