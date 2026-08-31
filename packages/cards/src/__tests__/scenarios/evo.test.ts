import { describe, expect, it } from "vitest";
import { actionCandidates, legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, scripts } from "../../index.js";
import { printingId, scenario } from "../harness.js";

const BLUE = "wrecker romp|3";

describe("EVO — registration and core mechanics", () => {
  it("registers the complete set", () => {
    expect(Object.keys(cardData).filter((id) => id.startsWith("EVO"))).toHaveLength(252);
    for (const id of ["EVO001", "EVO002", "EVO004", "EVO005", "EVO007", "EVO008", "EVO010B"]) {
      expect(cardData[id]?.cardType).toBe("hero");
      expect(scripts[id]).toBeDefined();
    }
  });

  it("all playable Evo equipment supports next-Evo instant permissions", () => {
    const playableEvos = Object.values(cardData).filter((card) =>
      card.cardType === "equipment" &&
      (card.subtypes ?? []).includes("evo") &&
      scripts[card.id]?.playableEquipment === true
    );

    expect(playableEvos.length).toBeGreaterThan(0);
    for (const card of playableEvos) {
      expect(scripts[card.id]?.playAsInstant, card.name).toBeTypeOf("function");
    }
  });

  it("Dash, Database sees and plays an eligible top-deck item as an instant with the tax", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "dash, database|0", resources: 1, deck: ["fuel injector|3"] },
        { hero: "dorinthea" },
      ],
    });
    const top = s.state.players[0]!.deck[0]!;
    expect(legalIntents(s.state, 0)).toContainEqual({
      kind: "play-from-zone",
      zone: "deck",
      instanceId: top.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
      asInstant: true,
    });
    s.play("fuel injector|3", { fromZone: "deck", asInstant: true })
      .expectResources(0, 0)
      .expectInZone(0, "fuel injector|3", "board");
  });

  it("Dash, Database can play the top-deck item during a response window", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "dash, database|0", resources: 1, hand: ["sigil of solace|1"], deck: ["fuel injector|3"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("sigil of solace|1", { settle: false });
    const top = s.state.players[0]!.deck[0]!;
    const intent = legalIntents(s.state, 0).find((candidate) =>
      candidate.kind === "play-from-zone" && candidate.zone === "deck" && candidate.instanceId === top.instanceId,
    );
    expect(intent).toMatchObject({ asInstant: true });
    s.doRaw(intent!).settle().expectInZone(0, "fuel injector|3", "board");
  });

  it("an Evo transforms matching base equipment and retains it underneath", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          hand: ["evo sentry base head|1", BLUE],
          equipment: { head: "teklo base head|0" },
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("evo sentry base head|1", { pitch: [BLUE] })
      .expectEquipped(0, "head", "evo sentry base head|1");
    const evo = s.state.players[0]!.equipment.head!;
    expect(evo.subcards).toHaveLength(1);
    expect(evo.subcards![0]!.cardId).toBe(printingId("teklo base head|0"));
  });

  it("Fabricate lets its controller choose an Evo equipment to put it under", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["fabricate|1"],
          equipment: {
            head: "evo sentry base head|1",
            arms: "evo circuit breaker|1",
          },
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("fabricate|1")
      .chooseOption("under")
      .chooseOption("defense")
      .chooseCard("evo circuit breaker|1");

    expect(s.state.players[0]!.equipment.head?.subcards).toBeUndefined();
    expect(s.state.players[0]!.equipment.arms?.subcards).toEqual([
      expect.objectContaining({ cardId: printingId("fabricate|1") }),
    ]);
    expect(s.state.players[0]!.graveyard).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: printingId("fabricate|1") }),
    ]));
  });

  it("Teklovossen lets high-rarity Evos from hand and banish be played as instants", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          resources: 3,
          hand: ["sigil of solace|1", "evo circuit breaker|1"],
          banish: ["evo atom breaker|1"],
          equipment: {
            head: "proto base head|0",
            chest: "proto base chest|0",
          },
        },
        { hero: "dorinthea" },
      ],
    });

    s.activate("teklovossen|0");
    s.play("sigil of solace|1", { settle: false });

    const handEvo = s.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("evo circuit breaker|1"),
    )!;
    const banishedEvo = s.state.players[0]!.banish.find(
      (card) => card.cardId === printingId("evo atom breaker|1"),
    )!;
    const legal = legalIntents(s.state, 0);

    expect(legal).toContainEqual({
      kind: "play-card",
      instanceId: handEvo.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    });
    expect(legal).toContainEqual({
      kind: "play-from-zone",
      zone: "banish",
      instanceId: banishedEvo.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    });

    s.react("evo atom breaker|1", { settle: false });
    expect(s.state.stack.find((layer) => layer.card)?.card?.instanceId).toBe(banishedEvo.instanceId);
    expect(projectStateFor(s.state, 0).stack.some((layer) => layer.card?.cardId === banishedEvo.cardId)).toBe(true);
    expect(projectStateFor(s.state, 1).stack.some((layer) => layer.card?.cardId === banishedEvo.cardId)).toBe(true);
    expect(s.state.players[0]!.banish).not.toContainEqual(banishedEvo);
    expect(s.state.players[0]!.equipment.chest?.cardId).toBe(printingId("proto base chest|0"));

    s.settle().expectEquipped(0, "chest", "evo atom breaker|1");
  });

  it("an Evo played from banish as an action remains on the stack until it resolves", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          banish: ["evo circuit breaker|1"],
          equipment: { head: "proto base head|0" },
        },
        { hero: "dorinthea", hand: ["sigil of solace|1"] },
      ],
    });
    const evo = s.state.players[0]!.banish[0]!;

    s.play("evo circuit breaker|1", { fromZone: "banish", settle: false });

    expect(s.state.stack[0]?.card?.instanceId).toBe(evo.instanceId);
    expect(projectStateFor(s.state, 0).stack[0]?.card?.cardId).toBe(evo.cardId);
    expect(projectStateFor(s.state, 1).stack[0]?.card?.cardId).toBe(evo.cardId);
    expect(s.state.players[0]!.banish).not.toContainEqual(evo);
    expect(s.state.players[0]!.equipment.head?.cardId).toBe(printingId("proto base head|0"));

    s.settle().expectEquipped(0, "head", "evo circuit breaker|1");
  });

  it("offers a banished Evo Beta Base Legs after Teklovossen resolves before defense", () => {
    const s = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen, esteemed magnate|0",
          hand: ["ghost protocol: mainframe|3"],
          banish: ["evo beta base legs|3"],
          equipment: { legs: "proto base legs|0" },
        },
        {
          hero: "dorinthea",
          resources: 3,
          weapons: ["edge of autumn|0"],
        },
      ],
    });

    s.attackWithWeapon("edge of autumn|0", { settle: false })
      .passPriority()
      .activate("teklovossen, esteemed magnate|0", {
        pitch: ["ghost protocol: mainframe|3"],
        settle: false,
      })
      .passPriority()
      .passPriority();

    expect(s.state.pendingDecision).toMatchObject({
      player: 1,
      kind: "priority-window",
    });
    s.passPriority();

    expect(s.state.phase).toBe("layer");
    expect(s.state.pendingDecision).toMatchObject({
      player: 0,
      kind: "priority-window",
    });
    const evo = s.state.players[0]!.banish.find(
      (card) => card.cardId === printingId("evo beta base legs|3"),
    )!;
    expect(legalIntents(s.state, 0)).toContainEqual({
      kind: "play-from-zone",
      zone: "banish",
      instanceId: evo.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    });

    s.react("evo beta base legs|3", { settle: false });
    expect(s.state.stack.find((layer) => layer.card)?.card?.instanceId).toBe(evo.instanceId);
    expect(s.state.phase).toBe("layer");
  });

  it("can play Evo Steel Soul Controller from hand as an action after Teklovossen resolves", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen, esteemed magnate|0",
          resources: 7,
          hand: ["evo steel soul controller|3"],
          equipment: { arms: "proto base arms|0" },
        },
        { hero: "dorinthea" },
      ],
    });

    s.activate("teklovossen, esteemed magnate|0");
    const controller = s.state.players[0]!.hand[0]!;
    const variants = legalIntents(s.state, 0).filter(
      (intent): intent is Extract<ReturnType<typeof legalIntents>[number], { kind: "play-card" }> =>
        intent.kind === "play-card" && intent.instanceId === controller.instanceId,
    );
    expect(variants.some((intent) => intent.asInstant !== true)).toBe(true);
    expect(variants.some((intent) => intent.asInstant === true)).toBe(true);

    s.play("evo steel soul controller|3", { asInstant: false })
      .expectAP(0, 0)
      .expectEquipped(0, "arms", "evo steel soul controller|3");
  });

  it("advertises an unaffordable Steel Soul Controller over Adaptive Alpha Mold", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen, esteemed magnate|0",
          resources: 3,
          hand: [
            "evo steel soul controller|3",
            "pulsewave harpoon|1",
            "fabricate|1",
            "firewall|1",
          ],
          equipment: { arms: "adaptive alpha mold|0" },
        },
        { hero: "dorinthea" },
      ],
    });

    s.activate("teklovossen, esteemed magnate|0");
    const controller = s.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("evo steel soul controller|3"),
    )!;

    expect(legalIntents(s.state, 0).some(
      (intent) => intent.kind === "play-card" && intent.instanceId === controller.instanceId,
    )).toBe(false);
    const candidates = actionCandidates(s.state, 0).filter(
      (intent) => intent.kind === "play-card" && intent.instanceId === controller.instanceId,
    );
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ pitchInstanceIds: [], pitchRequired: 4 }),
      expect.objectContaining({ pitchInstanceIds: [], pitchRequired: 4, asInstant: true }),
    ]));
  });

  it("holds priority for an unaffordable Evo after Teklovossen resolves", () => {
    const s = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen, esteemed magnate|0",
          resources: 3,
          hand: ["evo steel soul processor|3"],
          equipment: { chest: "proto base chest|0" },
        },
        { hero: "dorinthea" },
      ],
    });

    // The turn player yields, Teklovossen's controller activates, and both
    // players pass so the permission to play the next Evo resolves.
    s.passPriority()
      .activate("teklovossen, esteemed magnate|0", { settle: false })
      .passPriority()
      .passPriority();

    expect(s.state.phase).toBe("action");
    expect(s.state.priorityPlayer).toBe(1);

    // Passing action priority must still offer the opponent a window because
    // the client advertises the structurally playable Evo even though no
    // pitch sequence can currently pay its cost.
    s.passPriority();
    expect(s.state.pendingDecision).toMatchObject({
      kind: "priority-window",
      player: 0,
    });

    const processor = s.state.players[0]!.hand[0]!;
    expect(legalIntents(s.state, 0).some(
      (intent) => intent.kind === "play-card" && intent.instanceId === processor.instanceId,
    )).toBe(false);
    expect(actionCandidates(s.state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: processor.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 4,
    }));
  });

  it("applies Beta Base Arms' discount without triggering an unrelated Processor", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["evo steel soul controller|3", BLUE],
          equipment: {
            chest: "evo steel soul processor|3",
            arms: "evo beta base arms|3",
          },
        },
        { hero: "dorinthea" },
      ],
    });
    const controller = s.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("evo steel soul controller|3"),
    )!;

    expect(actionCandidates(s.state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: controller.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 3,
    }));

    s.play("evo steel soul controller|3", { pitch: [BLUE] })
      .expectEquipped(0, "arms", "evo steel soul controller|3");
    expect(s.state.players[0]!.resources).toBe(0);
  });

  it("triggers Processor only when Processor itself transforms from or into another Evo", () => {
    const intoProcessor = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["evo steel soul processor|3", BLUE],
          equipment: { chest: "evo beta base chest|3" },
        },
        { hero: "dorinthea" },
      ],
    });
    intoProcessor.play("evo steel soul processor|3", { pitch: [BLUE] })
      .expectEquipped(0, "chest", "evo steel soul processor|3");
    expect(intoProcessor.state.players[0]!.resources).toBe(3);

    const fromProcessor = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 10,
          hand: ["evo atom breaker|1"],
          equipment: { chest: "evo steel soul processor|3" },
        },
        { hero: "dorinthea" },
      ],
    });
    const atomCost = cardData[printingId("evo atom breaker|1")]!.cost ?? 0;
    fromProcessor.play("evo atom breaker|1")
      .expectEquipped(0, "chest", "evo atom breaker|1");
    expect(fromProcessor.state.players[0]!.resources).toBe(10 - atomCost + 3);
  });

  it("Teklo Leveler's +1 power applies only to Teklo Leveler's attack", () => {
    const equipment = {
      head: "evo steel soul memory|3",
      chest: "evo steel soul processor|3",
      arms: "evo steel soul controller|3",
      legs: "evo steel soul tower|3",
    } as const;
    const actionAttack = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          weapons: ["teklo leveler|0"],
          hand: ["zero to sixty|1"],
          equipment,
        },
        { hero: "dorinthea" },
      ],
    });
    actionAttack.play("zero to sixty|1").expectAttackValue(4);

    const levelerAttack = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          weapons: ["teklo leveler|0"],
          resources: 3,
          equipment,
        },
        { hero: "dorinthea" },
      ],
    });
    levelerAttack.attackWithWeapon("teklo leveler|0").expectAttackValue(3);
  });

  it("Scrap destroys the chosen material and enables the attack rider", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["junkyard dogg|1"], board: ["medkit|3"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("junkyard dogg|1").chooseCard("medkit|3")
      .expectAttackValue(7)
      .expectInZone(0, "medkit|3", "graveyard");
  });

  it("Galvanize destroys an item and gives the defending card +2 defense", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["raging onslaught|1"] },
        { hero: "dorinthea", hand: ["cognition field|1"], board: ["medkit|3"] },
      ],
    });
    s.play("raging onslaught|1").blockWith("cognition field|1")
      .passPriority().passPriority()
      .chooseCard("medkit|3").settle()
      .expectLife(1, 18);
  });

  it.each([
    ["fuel injector|3", 4],
    ["evo beta base head|3", 4],
    ["raging onslaught|3", 3],
  ] as const)("Sprocket Rocket checks the card banished for its own Boost: %s", (top, attack) => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["sprocket rocket|1"], deck: [top] },
        { hero: "dorinthea" },
      ],
    });

    s.play("sprocket rocket|1", { boost: true }).expectAttackValue(attack);
  });

  it("Master Cog may add a steam counter to an item with crank when pitched", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["big bertha|2", "master cog|2"], board: ["grinding gears|3"] },
        { hero: "dorinthea" },
      ],
    });
    const masterCog = s.state.players[0]!.hand.find((card) => card.cardId === printingId("master cog|2"))!;

    s.play("big bertha|2", { pitch: ["master cog|2"], settle: false });
    expect(s.state.players[0]!.board[0]!.counters?.steam).toBeUndefined();
    expect(s.state.stack[0]).toMatchObject({
      sourceInstanceId: masterCog.instanceId,
      label: "Put a steam counter on an item with crank?",
    });

    s.passPriority().passPriority();
    expect(s.state.pendingDecision?.chooseHook).toBe("master-cog");
    s.chooseCard("grinding gears|3");
    expect(s.state.players[0]!.board[0]!.counters?.steam).toBe(1);
  });

  it("Twin Drive offers zero, one, or two Boost payments and applies the chosen count", () => {
    const setup = () => scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          hand: ["twin drive|1"],
          deck: ["raging onslaught|1", "zero to fifty|2"],
        },
        { hero: "dorinthea" },
      ],
    });

    const offered = setup();
    const twinDriveId = offered.state.players[0]!.hand[0]!.instanceId;
    const boostCounts = legalIntents(offered.state, 0)
      .filter((intent): intent is Extract<ReturnType<typeof legalIntents>[number], { kind: "play-card" }> =>
        intent.kind === "play-card" && intent.instanceId === twinDriveId,
      )
      .map((intent) => intent.boost === true ? (intent.boostCount ?? 1) : 0);
    expect(new Set(boostCounts)).toEqual(new Set([0, 1, 2]));

    const once = setup();
    once.play("twin drive|1", { boost: true, boostCount: 1, settle: false });
    expect(once.state.players[0]!.banish).toHaveLength(1);
    expect(once.state.players[0]!.flags.boostCountThisTurn).toBe(1);
    expect(once.state.chain[0]!.goAgain).toBe(false);

    const twice = setup();
    twice.play("twin drive|1", { boost: true, boostCount: 2, settle: false });
    expect(twice.state.players[0]!.banish).toHaveLength(2);
    expect(twice.state.players[0]!.flags.boostCountThisTurn).toBe(2);
    expect(twice.state.chain[0]!.goAgain).toBe(true);
  });

  it("Pulsewave Protocol presents every reveal and marks only legal defenders", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 3,
          hand: ["pulsewave protocol|2"],
          equipment: {
            head: "evo sentry base head|1",
            chest: "evo sentry base chest|1",
            arms: "evo sentry base arms|1",
          },
        },
        {
          hero: "dorinthea",
          hand: ["medkit|3", "raging onslaught|1", "wrecker romp|1"],
        },
      ],
    });

    s.play("pulsewave protocol|2");
    const decision = s.state.pendingDecision;
    expect(decision?.chooseHook).toBe("pulsewave");
    expect(decision?.revealedCardIds).toHaveLength(3);
    expect(decision?.options).toHaveLength(1);
    expect(decision?.options?.[0]).toBe(String(s.state.players[1]!.hand[0]!.instanceId));
    expect(projectStateFor(s.state, 0).pendingDecision?.revealedCards).toHaveLength(3);
    expect(projectStateFor(s.state, 1).pendingDecision?.revealedCards).toHaveLength(3);
  });

  it("Pulsewave Protocol pauses on Close when no revealed card can defend", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 3,
          hand: ["pulsewave protocol|2"],
          equipment: {
            head: "evo sentry base head|1",
            chest: "evo sentry base chest|1",
          },
        },
        { hero: "dorinthea", hand: ["raging onslaught|1", "wrecker romp|1"] },
      ],
    });

    s.play("pulsewave protocol|2");
    expect(s.state.pendingDecision?.options).toEqual(["Close"]);
    expect(s.state.pendingDecision?.revealedCardIds).toHaveLength(2);
    s.chooseOption("Close");
    expect(s.state.pendingDecision?.kind).toBe("defend");
  });

  it("Pulsewave Protocol does not expose a hand when reveals are prohibited", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 3,
          hand: ["pulsewave protocol|2"],
          board: ["channel the bleak expanse|3"],
          equipment: { head: "evo sentry base head|1" },
        },
        { hero: "dorinthea", hand: ["medkit|3"] },
      ],
    });

    s.play("pulsewave protocol|2");
    expect(s.state.pendingDecision?.chooseHook).not.toBe("pulsewave");
    expect(projectStateFor(s.state, 0).pendingDecision?.revealedCards).toBeUndefined();
  });
});

describe("EVO — rules regression coverage", () => {
  it("Maxx grants Crank to a Hyper Driver as it enters", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "maxx nitro|0", resources: 2 },
        { hero: "dorinthea" },
      ],
    });
    s.state.players[0]!.flags.boostedThisTurn = true;
    s.activate("maxx nitro|0", { settle: false });
    while (s.state.pendingDecision?.kind === "priority-window") s.passPriority();
    expect(s.state.pendingDecision?.chooseHook).toBe("engine-crank");
  });

  it("Polarity Reversal Script lowers action-card defense only against Mechanologist attacks", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["zero to fifty|1"], board: ["polarity reversal script|1"] },
        { hero: "dorinthea", hand: ["raging onslaught|1"] },
      ],
    });
    s.play("zero to fifty|1").blockWith("raging onslaught|1").settle()
      .expectLife(1, 19);
  });

  it("Smash and Grab permanently gains control of an opposing item", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["smash and grab|1"] },
        { hero: "dorinthea", board: ["medkit|3"] },
      ],
    });
    s.state.players[0]!.flags.boostCountThisTurn = 2;
    s.play("smash and grab|1").blockWith().settle().chooseCard("medkit|3").endTurn();
    expect(s.state.players[0]!.board.some((card) => card.cardId === printingId("medkit|3"))).toBe(true);
  });
});
