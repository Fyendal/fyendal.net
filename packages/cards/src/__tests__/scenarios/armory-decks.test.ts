import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, isImplemented } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { printingId, scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

describe("Armory Decks — AKO, ASB, and AAZ", () => {
  it.each([
    ["AKO", 28],
    ["ASB", 28],
    ["AAZ", 32],
  ] as const)("registers every %s printing as implemented", (set, count) => {
    const cards = Object.values(cardData).filter((card) => card.set === set);
    expect(cards).toHaveLength(count);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
  });

  it("Kayo creates Might on the first 6-power discard in his action phase", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "kayo, armed and dangerous|0", hand: ["wild ride|1"], deck: ["wrecker romp|3"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("wild ride|1");
    expect(g.state.players[0]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!) === "might|0")).toHaveLength(1);
  });

  it("Romping Club sees a 5-power discard modified to 6 by Kayo", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "kayo, armed and dangerous|0",
          weapons: ["romping club|0"],
          hand: ["wild ride|1"],
          deck: ["reincarnate|3"],
          resources: 4,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("wild ride|1")
      .blockWith()
      .settle()
      .attackWithWeapon("romping club|0")
      .expectAttackValue(5);
  });

  it("Lumina Ascension pumps Raydn and puts a revealed Light card into soul on hit", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "ser boltyn, breaker of dawn|0", weapons: ["raydn, duskbane|0"], hand: ["lumina ascension|2"], deck: ["beaming bravado|1"], life: 15, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("lumina ascension|2").activate("raydn, duskbane|0").blockWith().settle();
    g.expectFinalAttack(1).expectZoneSize(0, "soul", 1).expectLife(0, 16);
  });

  it("Target Totalizer draws when an aimed arrow hits", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "azalea, ace in the hole|0",
          weapons: ["death dealer|0"],
          equipment: { ...NO_EQUIPMENT, head: "target totalizer|0" },
          hand: ["line it up|2"],
          arsenalFaceDown: ["infecting shot|3"],
          deck: ["ravenous rabble|1"],
          resources: 3,
        },
        { hero: "rhinar", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("line it up|2").chooseOption("yes").activate("target totalizer|0")
      .play("infecting shot|3", { fromArsenal: true }).blockWith().settle();
    g.expectHandSize(0, 1);
  });
});

describe("Armory Decks — AIO, AJV, and AST", () => {
  it.each([
    ["AIO", 27],
    ["AJV", 30],
    ["AST", 28],
  ] as const)("registers every %s printing as implemented", (set, count) => {
    const cards = Object.values(cardData).filter((card) => card.set === set);
    expect(cards).toHaveLength(count);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
  });

  it("Heavy Industry Power Plant keeps paying for boosts after it is destroyed", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["zero to sixty|1"],
          deck: ["data link|3"],
          resources: 1,
          equipment: { ...NO_EQUIPMENT, chest: "heavy industry power plant|0" },
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("heavy industry power plant|0")
      .play("zero to sixty|1", { boost: true })
      .blockWith()
      .settle()
      .expectResources(0, 1)
      .expectLog("Heavy Industry Power Plant: gain {r}");
  });

  it("Heavy Industry Power Plant does not pay for boosts until activated", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "dash i/o|0",
          hand: ["data link|1"],
          deck: ["boom grenade|1"],
          equipment: { ...NO_EQUIPMENT, chest: "heavy industry power plant|0" },
        },
        {
          hero: "rhinar",
          heroKey: "gravy bones|0",
          board: ["sawbones, dock hand|2"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("data link|1", { boost: true, targetAlly: "sawbones, dock hand|2" })
      .expectResources(0, 0);
  });

  it("Dash I/O plays the top low-cost Mechanologist item as an instant exactly once", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "dash i/o|0",
          hand: ["raging onslaught|3"],
          deck: ["cerebellum processor|3", "steam canister|3"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    const top = g.state.players[0]!.deck[0]!;
    expect(projectStateFor(g.state, 0).players[0]!.visibleDeckTop).toMatchObject({
      instanceId: top.instanceId,
      cardId: top.cardId,
    });
    expect(projectStateFor(g.state, 1).players[0]!.visibleDeckTop).toBeUndefined();
    const topPlays = legalIntents(g.state, 0).filter((intent) =>
      intent.kind === "play-from-zone"
      && intent.zone === "deck"
      && intent.instanceId === top.instanceId
    );
    expect(topPlays.length).toBeGreaterThan(0);
    expect(topPlays.every((intent) =>
      intent.kind === "play-from-zone" && intent.asInstant === true
    )).toBe(true);
    expect(applyIntent(g.state, 0, {
      kind: "play-from-zone",
      zone: "deck",
      instanceId: top.instanceId,
      pitchInstanceIds: [g.state.players[0]!.hand[0]!.instanceId],
    })).toEqual({
      ok: false,
      error: "Cerebellum Processor must be played as an instant",
    });
    g.play("cerebellum processor|3", {
      fromZone: "deck",
      asInstant: true,
      pitch: ["raging onslaught|3"],
    }).chooseOption("no");
    g.expectInZone(0, "cerebellum processor|3", "board").expectAP(0, 1);
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "play-from-zone" && intent.instanceId === g.state.players[0]!.deck[0]?.instanceId,
    )).toBe(false);
  });

  it("Dash I/O sees a non-item deck top without being allowed to play it", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "dash i/o|0",
          deck: ["raging onslaught|3"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    const top = g.state.players[0]!.deck[0]!;
    expect(projectStateFor(g.state, 0).players[0]!.visibleDeckTop).toMatchObject({
      instanceId: top.instanceId,
      cardId: top.cardId,
    });
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "play-from-zone" && intent.instanceId === top.instanceId,
    )).toBe(false);
  });

  it("Symbiosis Shot may gain steam when a Mechanologist item is played", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["symbiosis shot|0"], hand: ["cerebellum processor|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("cerebellum processor|3").chooseOption("no");
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "symbiosis-steam",
      defaultOption: "yes",
    });
    g.chooseOption("yes");
    expect(g.state.players[0]!.weapons[0]!.counters?.steam).toBe(1);
  });

  it("Crank records the turn event used by Fast and Furious", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["cerebellum processor|3", "fast and furious|1"], resources: 1, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("cerebellum processor|3")
      .chooseOption("yes")
      .play("fast and furious|1")
      .blockWith()
      .settle()
      .expectFinalAttack(4);
  });

  it("Jarl creates a Frostbite in an exposed zone when he plays an Ice card", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "jarl vetreiði|0", hand: ["icy encounter|1"], resources: 5, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("icy encounter|1").chooseOption("head").blockWith().settle();
    expect(g.state.players[1]!.board.some((card) => card.counters?.["frostZone:head"] === 1)).toBe(true);
  });

  it("Jarl treats a played Colors of Aria as an Ice card", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "jarl vetreiði|0",
          hand: ["colors of aria|1"],
          resources: 3,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("colors of aria|1").chooseOption("head");
    expect(g.state.players[1]!.board.some(
      (card) => card.counters?.["frostZone:head"] === 1,
    )).toBe(true);
  });

  it("Summit gets Heavy while it is the only equipped weapon", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["summit, the unforgiving|0"], resources: 6, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.attackWithWeapon("summit, the unforgiving|0")
      .blockWith()
      .settle()
      .chooseOption("head")
      .expectFinalAttack(6);
  });

  it("Arc Lightning observes go again on a later attack from the graveyard", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["arc lightning|2", "skyzyk|1"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("arc lightning|2");
    g.chooseOption("opposing hero");
    g.play("skyzyk|1");
    g
      .chooseOption("opposing hero")
      .blockWith()
      .settle()
      .expectLife(1, 14)
      .expectFinalAttack(4);
  });

  it("Aurora creates Embodiment of Lightning after a Lightning card was played", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "aurora, shooting star|0", hand: ["written in the stars|3"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("written in the stars|3").activate("aurora, shooting star|0");
    expect(g.state.players[0]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!) === "embodiment of lightning|0")).toHaveLength(2);
  });
});

describe("Armory Decks — AMX, AGB, and ASR", () => {
  it.each([
    ["AMX", 29],
    ["AGB", 31],
    ["ASR", 27],
  ] as const)("registers every %s printing as implemented", (set, count) => {
    const cards = Object.values(cardData).filter((card) => card.set === set);
    expect(cards).toHaveLength(count);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
  });

  it("Puffer Jacket gives a non-token Hyper Driver an additional steam counter", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "maxx 'the hype' nitro|0", hand: ["hyper driver|1"], resources: 1, equipment: { ...NO_EQUIPMENT, chest: "puffer jacket|0" } },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("hyper driver|1").chooseOption("no");
    const driver = g.state.players[0]!.board.find((card) => functionalKeyOf(cardData[card.cardId]!) === "hyper driver|1");
    expect(driver?.counters?.steam).toBe(4);
  });

  it("Construct Bank Breaker transforms a wrench and three Hyper Drivers into the equipped back face", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "maxx 'the hype' nitro|0", weapons: ["banksy|0"], hand: ["construct bank breaker|2"], board: ["hyper driver|1", "hyper driver|2", "hyper driver|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("construct bank breaker|2")
      .chooseCard("banksy|0")
      .chooseCard("hyper driver|1")
      .chooseCard("hyper driver|2")
      .chooseCard("hyper driver|3");
    const bank = g.state.players[0]!.weapons[0]!;
    expect(functionalKeyOf(cardData[bank.cardId]!)).toBe("bank breaker|0");
    expect(bank.subcards).toHaveLength(4);
    expect(g.state.players[0]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!).startsWith("hyper driver|"))).toHaveLength(0);
  });

  it("Call to the Grave searches a card into the graveyard and shuffles", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "gravy bones, shipwrecked looter|0", hand: ["call to the grave|3"], deck: ["fiddler's green|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("call to the grave|3").chooseCard("fiddler's green|1");
    g.expectInZone(0, "fiddler's green|1", "graveyard");
  });

  it("Ira gives the second attack each turn +1 power", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "ira, scarlet revenger|0", weapons: ["edge of autumn|0"], hand: ["head jab|3"], resources: 1, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.attackWithWeapon("edge of autumn|0").blockWith().settle()
      .play("head jab|3").blockWith().settle();
    expect(g.state.players[0]!.flags.iraAttacks).toBe(2);
    g.expectFinalAttack(2);
  });
});

describe("Armory Decks — APS, ARR, and AAC", () => {
  it.each([
    ["APS", 32],
    ["ARR", 30],
    ["AAC", 31],
  ] as const)("registers every %s printing as implemented", (set, count) => {
    const cards = Object.values(cardData).filter((card) => card.set === set);
    expect(cards).toHaveLength(count);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
  });

  it("Pleiades creates Confidence when Superstar makes the crowd cheer", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "pleiades, superstar|0", hand: ["superstar|3"], resources: 1, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("superstar|3");
    expect(g.state.players[0]!.board.some((card) => functionalKeyOf(cardData[card.cardId]!) === "confidence|0")).toBe(true);
  });

  it("Bare Swing beats chest and gets +2 power while no chest is equipped", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["bare swing|1", "alpha instinct|3"], resources: 3, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("bare swing|1").chooseCard("alpha instinct|3").blockWith().settle().expectFinalAttack(9);
    expect(g.state.players[0]!.board.some((card) => functionalKeyOf(cardData[card.cardId]!) === "might|0")).toBe(true);
  });

  it("Arakni gives the first stealth attack each turn go again", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "arakni, 5l!p3d 7hru 7h3 cr4x|0", hand: ["infect|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("infect|1").blockWith().settle().expectAP(0, 1);
    expect(g.state.players[1]!.board.some((card) => functionalKeyOf(cardData[card.cardId]!) === "bloodrot pox|0")).toBe(true);
  });
});

describe("Armory Decks — AHA, AZS, and AOL", () => {
  it.each([
    ["AHA", 27],
    ["AZS", 30],
    ["AOL", 28],
  ] as const)("registers every %s printing as implemented", (set, count) => {
    const cards = Object.values(cardData).filter((card) => card.set === set);
    expect(cards).toHaveLength(count);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
  });

  it("Hala sharpens Zenith Blade and its first attack gets go again", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "hala, bladesaint of the vow|0", weapons: ["zenith blade|0"], hand: ["brimming blade|1"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("brimming blade|1").attackWithWeapon("zenith blade|0").blockWith().settle();
    g.expectFinalAttack(5).expectAP(0, 1);
  });

  it("Blur Reality returns a Lightning aura with a holo counter", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["blur reality|3"], board: ["stardust spike|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("blur reality|3");
    const spike = g.state.players[0]!.board.find((card) => functionalKeyOf(cardData[card.cardId]!) === "stardust spike|1");
    expect(spike?.counters?.holo).toBe(1);
  });

  it("Blur Reality is not playable without an eligible Lightning aura", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["blur reality|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    const blur = g.state.players[0]!.hand[0]!;

    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "play-card" && intent.instanceId === blur.instanceId
    )).toBe(false);
  });

  it("Blur Reality leaves the stack before the returned aura's enter choice", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["shattering flowtide|1", "blur reality|3"],
          board: ["auric shards|1", "stardust spike|1"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("shattering flowtide|1")
      .blockWith()
      .react("blur reality|3")
      .chooseCard("auric shards|1");

    expect(g.state.pendingDecision?.chooseHook).toBe("aura-enter-attack-target");
    expect(g.state.stack).toHaveLength(0);
    expect(projectStateFor(g.state, 0).stack).toHaveLength(0);
    g.expectInZone(0, "blur reality|3", "graveyard");
  });

  it("Stardust Spike leaves behind a visible amp effect when Ward destroys it", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["stardust spike|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["head jab|3"], equipment: NO_EQUIPMENT },
      ],
      active: 1,
    });
    g.play("head jab|3").blockWith().settle().chooseOption("destroy");

    expect(g.state.players[0]!.resources).toBe(1);
    expect(g.state.players[0]!.flags.nextArcaneBonus).toBe(1);
    expect(projectStateFor(g.state, 0).ongoing).toContainEqual({
      seat: 0,
      cardId: printingId("stardust spike|1"),
      label: "amp 1 · next arcane damage event",
    });
  });

  it("Blitz Kicks asks for Arcane Barrier payment against a Runechant", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          heroKey: "zyggy starlight|0",
          hand: ["raging onslaught|3"],
          equipment: { ...NO_EQUIPMENT, legs: "blitz kicks|0" },
        },
        {
          hero: "dorinthea",
          board: ["runechant|0"],
          hand: ["head jab|3"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("head jab|3");
    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "arcane-barrier",
      options: ["pay 0", "pay 1"],
    });

    g.chooseOption("pay 1")
      .chooseCard("raging onslaught|3")
      .expectLife(0, 40);
    expect(g.state.players[0]!.equipment.legs?.cardId).toBe(printingId("blitz kicks|0"));
  });

  it("Blitz Kicks can prevent a Runechant before Auric Shards' Ward applies", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          heroKey: "zyggy starlight|0",
          hand: ["raging onslaught|3"],
          board: ["auric shards|1"],
          equipment: { ...NO_EQUIPMENT, legs: "blitz kicks|0" },
        },
        {
          hero: "dorinthea",
          board: ["runechant|0"],
          hand: ["head jab|3"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("head jab|3");
    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "arcane-barrier",
      options: ["pay 0", "pay 1"],
    });

    g.chooseOption("pay 1")
      .chooseCard("raging onslaught|3")
      .expectLife(0, 40)
      .expectInZone(0, "auric shards|1", "board");
  });

  it("declining Blitz Kicks' Arcane Barrier lets Auric Shards' Ward apply afterward", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          heroKey: "zyggy starlight|0",
          hand: ["raging onslaught|3"],
          board: ["auric shards|1"],
          equipment: { ...NO_EQUIPMENT, legs: "blitz kicks|0" },
        },
        {
          hero: "dorinthea",
          board: ["runechant|0"],
          hand: ["head jab|3"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("head jab|3").chooseOption("pay 0");
    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "ward",
    });

    g.chooseOption("destroy")
      .expectLife(0, 40)
      .expectNotInZone(0, "auric shards|1", "board")
      .expectZoneSize(0, "hand", 1);
  });

  it("marks which identical aura attacked until end-of-turn cleanup", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["reality refractor|0"],
          board: ["stardust spike|1", "stardust spike|1"],
          resources: 2,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.activate("stardust spike|1").blockWith().settle();
    const attacked = g.state.players[0]!.board.find((card) => card.counters?.attacked === 1);
    const ready = g.state.players[0]!.board.find((card) => card.counters?.attacked !== 1);
    expect(attacked).toBeDefined();
    expect(ready).toBeDefined();

    const projected = projectStateFor(g.state, 0).players[0]!.board;
    expect(projected.find((card) => card.instanceId === attacked!.instanceId)?.counters?.attacked).toBe(1);
    expect(projected.find((card) => card.instanceId === ready!.instanceId)?.counters?.attacked).toBeUndefined();

    g.endTurn();
    expect(g.state.players[0]!.board.find((card) => card.instanceId === attacked!.instanceId)?.counters?.attacked).toBeUndefined();
  });

  it("Starfield Veil gives the next aura holo after an attack fragments", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "zyggy starlight|0", hand: ["ebbing arcstride|1", "auric shards|1"], resources: 1, equipment: { ...NO_EQUIPMENT, head: "starfield veil|0" } },
        { hero: "dorinthea", hand: ["head jab|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("ebbing arcstride|1").blockWith("head jab|3");
    expect(g.state.players[0]!.flags.fragmentedThisTurn).not.toBe(true);
    expect(g.state.stack[0]?.engineEffect?.kind).toBe("fragment");
    // Both players pass over Fragment. Its -2{p} resolves, then the separate
    // "whenever this fragments" trigger receives priority.
    g.passPriority().passPriority();
    expect(g.state.players[0]!.flags.fragmentedThisTurn).toBe(true);
    expect(g.state.stack[0]?.engineEffect?.kind).toBe("on-fragment-hook");
    g.activate("starfield veil|0").play("auric shards|1").settle();
    const shards = g.state.players[0]!.board.find((card) => functionalKeyOf(cardData[card.cardId]!) === "auric shards|1");
    expect(shards?.counters?.holo).toBe(1);
  });

  it("Olympia creates Gold the first time an attack wins a wager", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "olympia, prized fighter|0", weapons: ["golden grail|0"], hand: ["money where ya mouth is|1"], deck: ["alpha instinct|3"], resources: 5, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", deck: ["head jab|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("money where ya mouth is|1").attackWithWeapon("golden grail|0").chooseOption("yes");
    expect(g.state.players[0]!.board.some((card) => functionalKeyOf(cardData[card.cardId]!) === "gold|0")).toBe(false);
    g.blockWith().settle();
    expect(g.state.players[0]!.board.filter(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "gold|0",
    )).toHaveLength(2);
  });

  it("a hitting Belly Buster wager gives Olympia Courage and Gold", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "olympia, prized fighter|0",
          weapons: ["golden grail|0"],
          hand: ["belly buster|1"],
          resources: 3,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("belly buster|1").attackWithWeapon("golden grail|0").chooseOption("yes")
      .blockWith().settle();

    expect(g.state.players[0]!.board.map(
      (card) => functionalKeyOf(cardData[card.cardId]!),
    )).toEqual(expect.arrayContaining(["courage|0", "gold|0"]));
    expect(g.state.log.some((entry) => entry.publicText?.includes(" reveals "))).toBe(false);
  });

  it("retires Money Where Ya Mouth Is and Belly Buster after the next attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "olympia, prized fighter|0",
          weapons: ["golden grail|0"],
          hand: ["money where ya mouth is|1", "belly buster|1"],
          resources: 6,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("money where ya mouth is|1").play("belly buster|1");
    expect(projectStateFor(g.state, 0).ongoing.map((effect) => effect.cardId)).toEqual(
      expect.arrayContaining([printingId("money where ya mouth is|1"), printingId("belly buster|1")]),
    );

    g.attackWithWeapon("golden grail|0");
    const firstWagerPrompt = g.state.pendingDecision?.prompt;
    expect(firstWagerPrompt).toMatch(/Money Where Ya Mouth Is|Belly Buster/);
    g.chooseOption("yes");
    const secondWagerPrompt = g.state.pendingDecision?.prompt;
    expect(secondWagerPrompt).toMatch(/Money Where Ya Mouth Is|Belly Buster/);
    expect(secondWagerPrompt).not.toBe(firstWagerPrompt);
    g.chooseOption("yes");

    expect(g.state.chain.at(-1)?.wagerRewards).toEqual(
      expect.arrayContaining(["Winner creates Gold", "Winner creates Courage"]),
    );
    expect(g.state.chain.at(-1)?.wagers).toHaveLength(2);
    expect(g.state.log.some(
      (entry) => entry.publicText?.includes("skipped duplicate choice"),
    )).toBe(false);
    g.blockWith().settle();

    const ongoingCardIds = projectStateFor(g.state, 0).ongoing.map((effect) => effect.cardId);
    expect(ongoingCardIds).not.toContain(printingId("money where ya mouth is|1"));
    expect(ongoingCardIds).not.toContain(printingId("belly buster|1"));
  });

  it("awards a missed wager's prize to the defending hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["golden grail|0"],
          hand: ["belly buster|1"],
          resources: 3,
          equipment: NO_EQUIPMENT,
        },
        {
          hero: "dorinthea",
          hand: ["raging onslaught|1", "raging onslaught|2", "raging onslaught|3"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("belly buster|1").attackWithWeapon("golden grail|0").chooseOption("yes")
      .blockWith("raging onslaught|1", "raging onslaught|2", "raging onslaught|3").settle();

    expect(g.state.players[0]!.board.some(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "courage|0",
    )).toBe(false);
    expect(g.state.players[1]!.board.some(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "courage|0",
    )).toBe(true);
  });

  it("Prizeworn Pathfinders triggers for an attacking wager winner and removes its counter", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          weapons: ["golden grail|0"],
          equipment: { ...NO_EQUIPMENT, legs: "prizeworn pathfinders|0" },
          hand: ["money where ya mouth is|1", "wrecker romp|3", "wrecker romp|3"],
        },
        { hero: "dorinthea", hand: ["head jab|3"], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("head jab|3").blockWith("prizeworn pathfinders|0").settle().endTurn();
    expect(g.state.players[0]!.equipment.legs?.defCounters).toBe(1);

    g.play("money where ya mouth is|1", { pitch: ["wrecker romp|3"] })
      .attackWithWeapon("golden grail|0")
      .chooseOption("yes")
      .blockWith()
      .settle();

    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "pathfinders",
    });
    expect(g.state.log.some(
      (entry) => entry.publicText?.includes("Prizeworn Pathfinders triggers"),
    )).toBe(true);

    g.chooseOption("pay 1");
    expect(g.state.players[0]!.equipment.legs?.defCounters).toBe(0);
  });

  it("Prizeworn Pathfinders triggers when the defending hero wins a wager", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          equipment: { ...NO_EQUIPMENT, legs: "prizeworn pathfinders|0" },
          hand: [
            "raging onslaught|1",
            "raging onslaught|2",
            "raging onslaught|3",
            "wrecker romp|3",
          ],
        },
        {
          hero: "dorinthea",
          weapons: ["golden grail|0"],
          equipment: NO_EQUIPMENT,
          hand: ["head jab|3", "money where ya mouth is|1", "wrecker romp|3"],
        },
      ],
    });

    g.play("head jab|3").blockWith("prizeworn pathfinders|0").settle().endTurn();
    g.endTurn();
    expect(g.state.players[0]!.equipment.legs?.defCounters).toBe(1);

    g.play("money where ya mouth is|1", { pitch: ["wrecker romp|3"] })
      .attackWithWeapon("golden grail|0")
      .chooseOption("yes")
      .blockWith("raging onslaught|1", "raging onslaught|2", "raging onslaught|3")
      .settle();

    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "pathfinders",
    });
    g.chooseOption("pay 1");
    expect(g.state.players[0]!.equipment.legs?.defCounters).toBe(0);
  });

  it.each([
    ["Golden Galea", "head", "golden galea|0"],
    ["Golden Heart Plate", "chest", "golden heart plate|0"],
    ["Golden Gauntlets", "arms", "golden gauntlets|0"],
    ["Golden Gait", "legs", "golden gait|0"],
  ] as const)("Golden Grail can destroy %s as a Gold", (_name, slot, equipmentKey) => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["golden grail|0"],
          resources: 0,
          equipment: { ...NO_EQUIPMENT, [slot]: equipmentKey },
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.attackWithWeapon("golden grail|0");

    expect(g.state.players[0]!.equipment[slot]).toBeUndefined();
    expect(g.state.players[0]!.graveyard.some(
      (card) => functionalKeyOf(cardData[card.cardId]!) === equipmentKey,
    )).toBe(true);
  });

  it("Golden Grail offers resource payment and each controlled Gold", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["golden grail|0"],
          board: ["gold|0"],
          resources: 2,
          equipment: { ...NO_EQUIPMENT, arms: "golden gauntlets|0" },
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    const player = g.state.players[0]!;
    const grailId = player.weapons[0]!.instanceId;
    const goldIds = [player.board[0]!.instanceId, player.equipment.arms!.instanceId];
    const payments = legalIntents(g.state, 0).filter(
      (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === grailId,
    );

    expect(payments.some((intent) =>
      intent.kind === "activate-ability" && intent.alternativeCostCardInstanceIds === undefined
    )).toBe(true);
    expect(payments.flatMap((intent) =>
      intent.kind === "activate-ability" ? (intent.alternativeCostCardInstanceIds ?? []) : []
    ).sort((a, b) => a - b)).toEqual(goldIds.sort((a, b) => a - b));
  });

  it("Flurry lets Golden Grail destroy a Gold to pay for its second attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["golden grail|0"],
          board: ["flurry|0", "gold|0"],
          resources: 2,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.actionPoints = 2;
    const grailId = g.state.players[0]!.weapons[0]!.instanceId;
    const goldId = g.state.players[0]!.board.find((card) =>
      functionalKeyOf(cardData[card.cardId]!) === "gold|0"
    )!.instanceId;

    const firstAttack = legalIntents(g.state, 0).find((intent) =>
      intent.kind === "activate-ability" &&
      intent.sourceInstanceId === grailId &&
      intent.alternativeCostCardInstanceIds === undefined
    );
    expect(firstAttack).toBeDefined();
    g.doRaw(firstAttack!).settle().blockWith().settle();

    const secondAttack = legalIntents(g.state, 0).find((intent) =>
      intent.kind === "activate-ability" &&
      intent.sourceInstanceId === grailId &&
      intent.alternativeCostCardInstanceIds?.includes(goldId)
    );
    expect(secondAttack).toBeDefined();
    g.doRaw(secondAttack!).settle().blockWith().settle();

    expect(g.state.chain).toHaveLength(2);
    expect(g.state.players[0]!.board.some((card) => card.instanceId === goldId)).toBe(false);
    expect(g.state.players[0]!.flags[`activationCount:${grailId}:0`]).toBe(2);
  });

  it("Check-Raise buffs the next attack when it wagers", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["golden grail|0"], hand: ["check-raise|1", "money where ya mouth is|1"], deck: ["alpha instinct|3"], resources: 6, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", deck: ["head jab|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("check-raise|1").play("money where ya mouth is|1")
      .attackWithWeapon("golden grail|0").chooseOption("yes").blockWith().settle();
    g.expectFinalAttack(11);
  });

  it("Check-Raise buffs a weapon that gains its wager from Prized Galea", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "olympia, prized fighter|0",
          weapons: ["golden grail|0"],
          hand: ["check-raise|1"],
          resources: 3,
          equipment: { ...NO_EQUIPMENT, head: "prized galea|0" },
        },
        {
          hero: "dorinthea",
          heroKey: "cindra, dracai of retribution|0",
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("check-raise|1")
      .attackWithWeapon("golden grail|0")
      .blockWith()
      .activate("prized galea|0", { settle: false })
      .doRaw({ kind: "pass" })
      .doRaw({ kind: "pass" });

    expect(g.state.stack[0]?.label).toBe("The wagering attack gets +4");
    expect(g.state.pendingTriggeredLayers).toEqual([]);

    g.doRaw({ kind: "pass" })
      .doRaw({ kind: "pass" })
      .expectAttackValue(8)
      .settle()
      .expectFinalAttack(8);
  });

  it("Heads Up gives its wagered sword attack dominate", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["golden grail|0"],
          hand: ["heads up|1", "money where ya mouth is|1"],
          deck: ["alpha instinct|3"],
          resources: 6,
          equipment: NO_EQUIPMENT,
        },
        {
          hero: "dorinthea",
          hand: ["raging onslaught|1", "raging onslaught|2"],
          deck: ["head jab|3"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("heads up|1").play("money where ya mouth is|1")
      .attackWithWeapon("golden grail|0").chooseOption("yes").settle();

    expect(projectStateFor(g.state, 0).chain.at(-1)?.dominate).toBe(true);
    expect(legalIntents(g.state, 1).some(
      (intent) => intent.kind === "defend" && intent.instanceIds.length === 2,
    )).toBe(false);
  });

  it("mandatory sword wagers still trigger when the attack targets an ally", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", weapons: ["golden grail|0"], hand: ["big slick|1"], resources: 20, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", board: ["barnacle|2"], equipment: NO_EQUIPMENT },
    ] });
    g.play("big slick|1").attackWithWeapon("golden grail|0", { targetAlly: "barnacle|2" }).settle();
    expect(g.state.chain.at(-1)?.wagers).toHaveLength(1);
  });

  it("Donkey lets a winner with multiple arsenal cards choose one", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", weapons: ["golden grail|0"], hand: ["donkey|3"], arsenal: ["head jab|1", "wrecker romp|3"], resources: 20, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.attackWithWeapon("golden grail|0").blockWith()
      .react("donkey|3").settle();
    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "donkey-arsenal",
    });
    expect(g.state.pendingDecision?.options).toHaveLength(2);
  });

  it("Into the Muck can target only non-equipment defenders", () => {
    const onlyEquipment = scenario({ seats: [
      { hero: "rhinar", hand: ["wage gold|1", "into the muck|1"], resources: 20, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: { ...NO_EQUIPMENT, head: "ironrot helm|0" } },
    ] });
    onlyEquipment.play("wage gold|1").chooseOption("yes")
      .blockWith("ironrot helm|0");
    const muckId = printingId("into the muck|1");
    expect(legalIntents(onlyEquipment.state, 0).some(
      (intent) => intent.kind === "play-card" && onlyEquipment.state.players[0]!.hand
        .some((card) => card.instanceId === intent.instanceId && card.cardId === muckId),
    )).toBe(false);

    const mixed = scenario({ seats: [
      { hero: "rhinar", hand: ["wage gold|1", "into the muck|1"], resources: 20, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["head jab|3"], equipment: { ...NO_EQUIPMENT, head: "ironrot helm|0" } },
    ] });
    mixed.play("wage gold|1").chooseOption("yes")
      .blockWith("head jab|3", "ironrot helm|0")
      .react("into the muck|1", { settle: false })
      .passPriority().passPriority();
    mixed.expectInZone(1, "head jab|3", "banish");
    expect(mixed.state.chain.at(-1)?.defendingEquipment.some(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "ironrot helm|0",
    )).toBe(true);
  });
});

describe("Armory Decks — rules regression coverage", () => {
  it("Cap of Quick Thinking prevents damage by discarding instants", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["sigil of solace|1"], deck: ["sigil of solace|1"], equipment: { ...NO_EQUIPMENT, head: "cap of quick thinking|0" } },
        { hero: "dorinthea", hand: ["head jab|1", "head jab|1"], equipment: NO_EQUIPMENT },
      ],
      active: 1,
    });
    g.play("head jab|1").blockWith().passPriority().activate("cap of quick thinking|0");
    expect(g.state.pendingDecision?.prompt).toContain("discard");
    g.chooseCard("sigil of solace|1").expectLife(0, 18);
    g.play("head jab|1").blockWith().settle();
    expect(g.state.pendingDecision?.prompt).toContain("discard");
    g.chooseCard("sigil of solace|1").expectLife(0, 16);
  });

  it("Symbiosis Shot gains steam when an item is put directly into the arena", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["symbiosis shot|0"], hand: ["expedite|3", "cerebellum processor|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("expedite|3").blockWith().settle()
      .chooseCard("cerebellum processor|3").chooseOption("no").chooseOption("yes");
    const shot = g.state.players[0]!.weapons[0]!;
    expect(shot.counters?.steam).toBe(1);
  });

  it("Arc Lightning triggers when a non-attack action gains go again", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["arc lightning|2", "skyward serenade|2"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("arc lightning|2");
    expect(g.state.pendingDecision?.prompt).toContain("Arc Lightning");
  });

  it("Hidden Agenda turns its arsenal arrow face up as an activation cost", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", arsenalFaceDown: ["infecting shot|3"], equipment: { ...NO_EQUIPMENT, chest: "hidden agenda|0" } },
        { hero: "rhinar", hand: ["sigil of solace|1"], equipment: NO_EQUIPMENT },
      ],
    });
    g.activate("hidden agenda|0", { settle: false });
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-activation-effect-cost");
    const arrow = g.state.players[0]!.arsenal[0]!;
    const paid = applyIntent(g.state, 0, { kind: "choose", optionId: String(arrow.instanceId) });
    expect(paid.ok).toBe(true);
    if (!paid.ok) throw new Error(paid.error);
    g.state = paid.state;
    expect(g.state.players[0]!.arsenal[0]!.faceDown).toBeFalsy();
    expect(g.state.players[0]!.resources).toBe(0);
  });

  it("Barbed Undertow prohibits the chosen pitch color through the attacker's next turn", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", heroKey: "azalea, ace in the hole|0", weapons: ["death dealer|0"], hand: ["line it up|2"], arsenalFaceDown: ["barbed undertow|1"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "rhinar", hand: ["raging onslaught|2", "wrecker romp|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("line it up|2").chooseOption("yes").play("barbed undertow|1", { fromArsenal: true }).blockWith().settle();
    expect(g.state.pendingDecision?.options).toEqual(expect.arrayContaining(["red", "yellow", "blue"]));
    g.chooseOption("blue").endTurn();
    const costly = g.state.players[1]!.hand.find((card) => card.cardId === printingId("raging onslaught|2"));
    const blue = g.state.players[1]!.hand.find((card) => card.cardId === printingId("wrecker romp|3"));
    expect(costly).toBeDefined();
    expect(blue).toBeDefined();
    const result = applyIntent(g.state, 1, {
      kind: "play-card",
      instanceId: costly!.instanceId,
      pitchInstanceIds: [blue!.instanceId],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("blue pitch should be prohibited");
    expect(result.error).toMatch(/cannot be pitched this turn/);
  });

  it("Red in the Ledger limits the defending hero to one action next turn", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", heroKey: "azalea, ace in the hole|0", weapons: ["death dealer|0"], arsenal: ["red in the ledger|1"], resources: 1, equipment: NO_EQUIPMENT },
        { hero: "rhinar", hand: ["head jab|1", "head jab|1"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("red in the ledger|1", { fromArsenal: true }).blockWith().settle().endTurn();
    g.play("head jab|1").blockWith().settle();
    const second = g.state.players[1]!.hand.find((card) => card.cardId === printingId("head jab|1"));
    expect(legalIntents(g.state, 1).some((intent) => intent.kind === "play-card" && intent.instanceId === second?.instanceId)).toBe(false);
  });

  it("Stone Rain returns its face-down banished card at the defending hero's next end phase", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", heroKey: "azalea, ace in the hole|0", weapons: ["death dealer|0"], hand: ["line it up|2"], arsenalFaceDown: ["stone rain|1"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "rhinar", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("line it up|2").chooseOption("yes").play("stone rain|1", { fromArsenal: true }).blockWith().settle();
    g.expectPendingReturn(1, 1);
    g.endTurn();
    g.expectPendingReturn(1, 1);
    g.endTurn();
    expect(g.state.players[1]!.hand.some((card) => card.cardId === printingId("head jab|1"))).toBe(true);
  });

  it("Sawbones prevents the next damage to a Pirate ally", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "gravy bones|0", board: ["sawbones, dock hand|2", "barnacle|2"], equipment: NO_EQUIPMENT },
        { hero: "rhinar", hand: ["head jab|2"], equipment: NO_EQUIPMENT },
      ],
      active: 1,
    });
    g.play("head jab|2", { targetAlly: "barnacle|2", settle: false })
      .passPriority()
      .activate("sawbones, dock hand|2", { ability: 1 });
    const barnacle = g.state.players[0]!.board.find((card) => functionalKeyOf(cardData[card.cardId]!) === "barnacle|2");
    expect(barnacle?.life).toBe(2);
  });

  it("Standing Ovation grants an extra turn after three suspense auras leave", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "pleiades, superstar|0", hand: ["standing ovation|3"], resources: 6, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.flags.suspenseAurasLeftThisTurn = 3;
    g.play("standing ovation|3").blockWith().settle().endTurn();
    expect(g.state.activePlayer).toBe(0);
  });

  it("Never Give Up activates from the graveyard", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", life: 10, graveyard: ["never give up|2"], hand: ["raging onslaught|3"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", life: 20, hand: ["head jab|1"], equipment: NO_EQUIPMENT },
      ],
      active: 1,
    });
    g.state.players[0]!.flags.cheeredThisTurn = true;
    g.play("head jab|1").blockWith("raging onslaught|3").passPriority();
    const neverGiveUp = g.state.players[0]!.graveyard.find((card) => card.cardId === printingId("never give up|2"));
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === neverGiveUp?.instanceId,
    )).toBe(true);
    g.activate("never give up|2").chooseCard("raging onslaught|3");
    expect(g.state.chain.at(-1)?.defendingCards[0]?.tempDefense).toBe(3);
    expect(g.state.players[0]!.deck.at(-1)?.cardId).toBe(printingId("never give up|2"));
  });

  it("Horrors of the Past copies the last stealth attack's base abilities", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "arakni, 5l!p3d 7hru 7h3 cr4x|0", hand: ["infect|1", "horrors of the past|2"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("infect|1").blockWith().settle().play("horrors of the past|2").blockWith().settle();
    expect(g.state.players[1]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!) === "bloodrot pox|0")).toHaveLength(2);
  });

  it("Horrors of the Past resolves choices from inherited base abilities", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "arakni, 5l!p3d 7hru 7h3 cr4x|0", hand: ["undercover acquisition|1", "horrors of the past|2"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", board: ["copper|0", "silver|0"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("undercover acquisition|1").blockWith().settle().chooseCard("copper|0");
    g.play("horrors of the past|2").blockWith().settle().chooseCard("silver|0");
    expect(g.state.players[0]!.board.filter((card) =>
      ["copper|0", "silver|0"].includes(functionalKeyOf(cardData[card.cardId]!)),
    )).toHaveLength(2);
  });

  it("Take Up the Mantle makes its target a copy of the banished stealth attack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "arakni, 5l!p3d 7hru 7h3 cr4x|0", hand: ["creep|1", "take up the mantle|2"], graveyard: ["infect|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[1]!.hero.counters = { marked: 1 };
    g.play("creep|1").blockWith().react("take up the mantle|2").chooseCard("infect|1").settle();
    expect(g.state.players[1]!.board.some((card) => functionalKeyOf(cardData[card.cardId]!) === "bloodrot pox|0")).toBe(true);
    g.doRaw({ kind: "close-chain" }).expectInZone(0, "creep|1", "graveyard");
  });

  it("Creep gives Prowl go again and Prowl buffs the following stealth attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, 5l!p3d 7hru 7h3 cr4x|0",
          hand: ["creep|1", "prowl|1", "infect|1"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("creep|1").blockWith().settle().expectAP(0, 1)
      .play("prowl|1").blockWith().settle().expectAP(0, 1)
      .play("infect|1").expectAttackValue(4);
  });

  it("Spinal Crush suppresses go again during the defending hero's next action phase", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["spinal crush|1"], resources: 5, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("spinal crush|1").blockWith().settle().endTurn()
      .play("head jab|1").blockWith().settle().expectAP(1, 0);
  });

  it("simultaneous Beat Chest equipment triggers are all ordered onto the stack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["bare swing|1", "alpha instinct|3"],
          resources: 4,
          equipment: { head: "echo casque|0", chest: "torc of vim|0", arms: null, legs: "trampling trackers|0" },
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("bare swing|1");
    const alpha = g.state.players[0]!.hand.find((card) => card.cardId === printingId("alpha instinct|3"));
    expect(alpha).toBeDefined();
    const paid = applyIntent(g.state, 0, { kind: "choose", optionId: String(alpha!.instanceId) });
    expect(paid.ok).toBe(true);
    if (!paid.ok) throw new Error(paid.error);
    g.state = paid.state;
    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-order");
  });

  it("Massacre intimidates when discarded for any Brute attack action cost", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "kayo, armed and dangerous|0", hand: ["swing fist, think later|1", "massacre|1"], resources: 1, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("swing fist, think later|1").blockWith().settle();
    g.expectPendingReturn(1, 1);
  });

  it("blue Edict of Steel waits on the stack before sharpening", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["zenith blade|0"], hand: ["edict of steel|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 2 };
    const edictId = g.state.players[0]!.hand[0]!.instanceId;

    g.play("edict of steel|3", { settle: false });
    expect(g.state.phase).toBe("layer");
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    expect(g.state.stack[0]?.card?.instanceId).toBe(edictId);
    expect(g.state.players[0]!.weapons[0]!.counters?.power).toBe(2);

    g.passPriority().passPriority();
    expect(g.state.players[0]!.weapons[0]!.counters?.power).toBe(3);
    expect(g.state.players[0]!.board.some((card) =>
      functionalKeyOf(cardData[card.cardId]!) === "flurry|0"
    )).toBe(true);
  });

  it("blue Edict of Steel creates Flurry after Reverent Rerebrace reaches its threshold", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["zenith blade|0"],
          hand: ["edict of steel|3"],
          resources: 1,
          equipment: { ...NO_EQUIPMENT, arms: "reverent rerebrace|0" },
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 1 };

    g.play("edict of steel|3");
    expect(g.state.pendingDecision?.prompt).toContain("Reverent Rerebrace");
    expect(g.state.players[0]!.weapons[0]!.counters?.power).toBe(2);
    expect(g.state.players[0]!.board.some((card) =>
      functionalKeyOf(cardData[card.cardId]!) === "flurry|0"
    )).toBe(false);

    g.chooseOption("pay 1");
    expect(g.state.players[0]!.weapons[0]!.counters?.power).toBe(3);
    expect(g.state.players[0]!.board.some((card) =>
      functionalKeyOf(cardData[card.cardId]!) === "flurry|0"
    )).toBe(true);
  });

  it("multiple Flurry tokens still set a weapon's total attack limit to two", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["zenith blade|0"],
          board: ["flurry|0"],
          hand: ["gleam of the blade|1"],
          resources: 3,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.actionPoints = 3;
    const weaponId = g.state.players[0]!.weapons[0]!.instanceId;

    g.attackWithWeapon("zenith blade|0").blockWith().settle();
    g.activate("gleam of the blade|1");
    g.attackWithWeapon("zenith blade|0").blockWith().settle();

    const thirdAttack = legalIntents(g.state, 0).some((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId
    );
    expect(thirdAttack).toBe(false);
    expect(g.state.players[0]!.flags[`activationCount:${weaponId}:0`]).toBe(2);
    expect(g.state.players[0]!.flags[`setAttackActivationLimit:${weaponId}`]).toBe(2);
  });

  it("Reverent Rerebrace replaces a Zenith Blade sharpen", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["zenith blade|0"], hand: ["brimming blade|1"], resources: 2, equipment: { ...NO_EQUIPMENT, arms: "reverent rerebrace|0" } },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("brimming blade|1");
    expect(g.state.pendingDecision?.prompt).toContain("pay");
    g.chooseOption("pay 1");
    expect(g.state.players[0]!.weapons[0]!.counters?.power).toBe(3);
    expect(g.state.players[0]!.equipment.arms).toBeUndefined();
  });

  it("Reverent Rerebrace replaces Sharpening Sparks and Zenith Blade gains go again", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "hala, bladesaint of the vow|0",
          weapons: ["zenith blade|0"],
          hand: ["sharpening sparks|1"],
          resources: 2,
          equipment: { ...NO_EQUIPMENT, arms: "reverent rerebrace|0" },
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.attackWithWeapon("zenith blade|0")
      .blockWith()
      .react("sharpening sparks|1")
      .settle();

    expect(g.state.pendingDecision?.prompt).toContain("Reverent Rerebrace");
    expect(g.state.chain.at(-1)?.goAgain).toBe(true);

    g.chooseOption("pay 1");
    expect(g.state.players[0]!.weapons[0]!.counters?.power).toBe(2);
    expect(g.state.players[0]!.equipment.arms).toBeUndefined();
    g.expectAP(0, 1);
  });

  it("Polished Blade removes a chosen number of counters and modes", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["zenith blade|0"], hand: ["polished blade|1"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 2, sharpenedTurn: g.state.turn };
    g.attackWithWeapon("zenith blade|0").blockWith().react("polished blade|1");
    expect(g.state.pendingDecision?.prompt).toContain("counters");
    g.chooseOption("remove 2").chooseOption("go again").chooseOption("additional attack").chooseOption("discount");
    expect(g.state.chain.at(-1)!.attackingCard.counters?.power).toBeUndefined();
    expect(g.state.players[0]!.actionPoints).toBe(1);
  });

  it("Indefensibly Honed damages the hero when the sharpened sword is defended", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["zenith blade|0"], hand: ["indefensibly honed|3"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["raging onslaught|3", "raging onslaught|3", "raging onslaught|3"], life: 20, equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 2 };
    g.play("indefensibly honed|3").attackWithWeapon("zenith blade|0")
      .blockWith("raging onslaught|3", "raging onslaught|3", "raging onslaught|3").settle();
    expect(g.state.players[1]!.life).toBe(19);
  });

  it("Zenith Blade has no intrinsic defended trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["zenith blade|0"], resources: 1, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["sink below|1"], equipment: NO_EQUIPMENT },
      ],
    });

    g.attackWithWeapon("zenith blade|0").blockWith().passPriority()
      .react("sink below|1").chooseOption("pass");

    expect(g.state.log.some((entry) =>
      entry.publicText?.includes("defended by 1 or more cards")
    )).toBe(false);
  });

  it("Indefensibly Honed grants its trigger to the targeted sword attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["cintari saber|0"],
          hand: ["indefensibly honed|3"],
          resources: 2,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", hand: ["sink below|1"], equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 2 };

    g.play("indefensibly honed|3").attackWithWeapon("cintari saber|0")
      .blockWith().passPriority()
      .react("sink below|1").chooseOption("pass").settle();

    expect(g.state.log.filter((entry) =>
      entry.publicText?.includes("Indefensibly Honed triggers")
    )).toHaveLength(1);
    expect(g.state.players[1]!.life).toBe(18); // 1 combat damage + 1 from the granted trigger
  });

  it("Indefensibly Honed is consumed by the targeted weapon's next attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["zenith blade|0"],
          hand: ["indefensibly honed|3"],
          board: ["flurry|0"],
          resources: 3,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", hand: ["raging onslaught|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 2 };

    g.play("indefensibly honed|3").attackWithWeapon("zenith blade|0")
      .blockWith().settle()
      .attackWithWeapon("zenith blade|0")
      .blockWith("raging onslaught|3");

    expect(g.state.log.some((entry) =>
      entry.publicText?.includes("Indefensibly Honed triggers")
    )).toBe(false);
  });

  it("Indefensibly Honed ignores other weapons and expires at end of turn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["zenith blade|0", "cintari saber|0"],
          hand: ["indefensibly honed|3"],
          resources: 2,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 2 };

    g.play("indefensibly honed|3").chooseCard("zenith blade|0")
      .attackWithWeapon("cintari saber|0").blockWith().settle();

    expect(g.state.modifiers.some((modifier) =>
      modifier.scope === "next-attack" &&
      modifier.appliesToInstanceId === g.state.players[0]!.weapons[0]!.instanceId &&
      modifier.onDefendedDealDamage === 1
    )).toBe(true);

    g.endTurn();
    expect(g.state.modifiers.some((modifier) => modifier.onDefendedDealDamage === 1)).toBe(false);
  });

  it("Miraging Metamorph creates a token copy of a controlled aura", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["miraging metamorph|1"], board: ["stardust spike|1"], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["alpha instinct|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("miraging metamorph|1").blockWith("alpha instinct|3").settle().chooseCard("stardust spike|1");
    expect(g.state.players[0]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!) === "stardust spike|1")).toHaveLength(2);
  });

  it("Bluff Catcher increases the wager winner's next end-phase intellect", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["golden grail|0"], hand: ["bluff catcher|2"], deck: ["alpha instinct|3", "head jab|1", "head jab|2", "head jab|3", "raging onslaught|3", "ravenous rabble|1"], resources: 4, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", deck: ["head jab|3"], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("bluff catcher|2").attackWithWeapon("golden grail|0").blockWith().settle().endTurn();
    expect(g.state.players[0]!.hand).toHaveLength(5);
  });

  it("Visit the Prize Room equips Prized Galea from inventory", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["visit the prize room|3"], board: ["gold|0"], inventory: ["prized galea|0"], resources: 1, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("visit the prize room|3");
    expect(g.state.pendingDecision?.prompt).toContain("Gold");
    g.chooseCard("gold|0");
    expect(cardData[g.state.players[0]!.equipment.head!.cardId]!.name).toBe("Prized Galea");
  });
});
