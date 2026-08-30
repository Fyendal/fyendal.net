import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";

const BLUE = "raging onslaught|3";

describe("CRU — Runeblade", () => {
  it("Viserai, Rune Blood does not count the first Runeblade non-attack action as another card", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "viserai, rune blood|0", hand: ["mauvrion skies|2"] },
        { hero: "dorinthea" },
      ],
    });

    s.play("mauvrion skies|2").expectNotInZone(0, "runechant|0", "board");
  });

  it("Viserai and Mauvrion Skies create Runechants around the next Runeblade attack", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "viserai, rune blood|0",
          hand: ["mauvrion skies|2", "consuming volition|3", BLUE],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("mauvrion skies|2")
      .play("consuming volition|3", { pitch: [BLUE] })
      .expectZoneSize(0, "board", 1)
      .expectLife(1, 20)
      .blockWith()
      .settle()
      .expectZoneSize(0, "board", 3)
      .expectAP(0, 1);
  });

  it("Nebula Blade gets +3 after a non-attack action and creates a Runechant on hit", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["nebula blade|0"],
          hand: ["mauvrion skies|2", BLUE],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("mauvrion skies|2")
      .attackWithWeapon("nebula blade|0", { pitch: [BLUE] })
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectZoneSize(0, "board", 1);
  });

  it("Consuming Volition makes the hit hero choose a discard after arcane damage", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["runechant|0"],
          hand: ["consuming volition|3", BLUE],
        },
        { hero: "dorinthea", hand: ["brutal assault|3"] },
      ],
    });

    s.play("consuming volition|3", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .chooseCard("brutal assault|3")
      .expectHandSize(1, 0);
  });

  it("Consuming Volition does not discard when it hits an ally", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["runechant|0"],
          hand: ["consuming volition|3", BLUE],
        },
        { hero: "dorinthea", hand: ["brutal assault|3"], board: ["barnacle|2"] },
      ],
    });

    s.play("consuming volition|3", {
      pitch: [BLUE],
      targetAlly: "barnacle|2",
    }).expectHandSize(1, 1);
  });

  it("Meat and Greet gains go again after damaging an opposing hero with arcane damage", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", board: ["runechant|0"], hand: ["meat and greet|3", BLUE] },
        { hero: "dorinthea" },
      ],
    });

    s.play("meat and greet|3", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectZoneSize(0, "board", 1);
  });

  it("Sutcliffe's Research Notes counts Runeblade attacks and lets its controller reorder", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["sutcliffe's research notes|1", BLUE],
          deck: ["consuming volition|1", "brutal assault|3", "meat and greet|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("sutcliffe's research notes|1", { pitch: [BLUE] })
      .chooseCard("brutal assault|3")
      .chooseCard("meat and greet|1")
      .chooseCard("consuming volition|1")
      .expectDeckTop(0, "consuming volition|1")
      .expectDeckBottom(0, "brutal assault|3")
      .expectZoneSize(0, "board", 2);
  });
});

describe("CRU — Wizard", () => {
  it("Kano banishes the top non-attack action and permits it as an instant", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "kano, dracai of aether|0",
          resources: 4,
          deck: ["snapback|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.activate("kano, dracai of aether|0")
      .chooseCard("snapback|3")
      .expectInZone(0, "snapback|3", "banish");
    const card = s.state.players[0]!.banish[0]!;
    expect(
      legalIntents(s.state, 0).some(
        (intent) =>
          intent.kind === "play-from-zone" &&
          intent.zone === "banish" &&
          intent.instanceId === card.instanceId,
      ),
    ).toBe(true);
  });

  it("Aether Conduit deals 2 arcane damage to the chosen hero", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", weapons: ["aether conduit|0"], resources: 2 },
        { hero: "dorinthea" },
      ],
    });

    s.activate("aether conduit|0").chooseOption("opposing hero").expectLife(1, 18);
  });

  it("Foreboding Bolt deals non-arcane damage and opts", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["foreboding bolt|3", BLUE], deck: ["brutal assault|3"] },
        { hero: "dorinthea" },
      ],
    });

    s.play("foreboding bolt|3", { pitch: [BLUE] })
      .chooseOption("opposing hero")
      .expectLife(1, 19)
      .chooseOption("top")
      .expectDeckTop(0, "brutal assault|3");
  });

  it("Rousing Aether amplifies the next arcane-damage card", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["rousing aether|3", "snapback|3", BLUE] },
        { hero: "dorinthea" },
      ],
    });

    s.play("rousing aether|3", { pitch: [BLUE] })
      .chooseOption("opposing hero")
      .expectLife(1, 18);
    expect(projectStateFor(s.state, 0).ongoing).toContainEqual({
      seat: 0,
      cardId: printingId("rousing aether|3"),
      label: "amp 1 · next arcane damage card",
    });
    s.play("snapback|3")
      .chooseOption("opposing hero")
      .expectLife(1, 16);
    expect(projectStateFor(s.state, 0).ongoing).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: expect.stringContaining("amp") }),
      ]),
    );
  });
});

describe("CRU — Generic and Merchant", () => {
  it("Promise of Plenty from arsenal gains go again and fills empty arsenals on hit", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", arsenal: ["promise of plenty|3"], deck: ["brutal assault|3"] },
        { hero: "dorinthea", deck: ["brutal assault|2"] },
      ],
    });

    s.play("promise of plenty|3", { fromArsenal: true })
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectZoneSize(0, "arsenal", 1)
      .expectZoneSize(1, "arsenal", 1)
      .expectFaceDown(0, "brutal assault|3", true)
      .expectFaceDown(1, "brutal assault|2", true);
  });

  it("Lunging Press gives the attacking action +1 power", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["brutal assault|3", "lunging press|3", BLUE] },
        { hero: "dorinthea" },
      ],
    });

    s.play("brutal assault|3", { pitch: [BLUE] })
      .blockWith()
      .react("lunging press|3")
      .expectFinalAttack(5);
  });

  it("Lunging Press cannot be played for a weapon attack", () => {
    const s = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["edge of autumn|0"],
          resources: 1,
          hand: ["lunging press|3"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });

    s.attackWithWeapon("edge of autumn|0").blockWith();
    const press = s.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("lunging press|3"),
    )!;
    expect(
      legalIntents(s.state, 0).some(
        (intent) => intent.kind === "play-card" && intent.instanceId === press.instanceId,
      ),
    ).toBe(false);
  });

  it("Reinforce the Line gives a defending attack action +4 defense", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["brutal assault|1", BLUE] },
        { hero: "dorinthea", hand: ["brutal assault|3", "reinforce the line|1"] },
      ],
    });

    s.play("brutal assault|1", { pitch: [BLUE] })
      .blockWith("brutal assault|3")
      .passPriority()
      .react("reinforce the line|1")
      .chooseCard("brutal assault|3")
      .expectFinalDefense(7);
  });

  it("Copper destroys itself for 4 resources and draws a card with go again", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", board: ["copper|0"], resources: 4, deck: ["brutal assault|3"] },
        { hero: "dorinthea" },
      ],
    });

    s.activate("copper|0")
      .expectNotInZone(0, "copper|0", "board")
      .expectHandSize(0, 1)
      .expectAP(0, 1);
  });

  it("Kavdaen trades life from the higher hero to the lower and creates Copper", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "kavdaen, trader of skins|0", life: 20, resources: 3 },
        { hero: "dorinthea", life: 15 },
      ],
    });

    s.activate("kavdaen, trader of skins|0")
      .expectLife(0, 19)
      .expectLife(1, 16)
      .expectInZone(0, "copper|0", "board")
      .expectAP(0, 1);
  });

  it("Cash In can destroy 4 Coppers instead of paying its resource cost", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["copper|0", "copper|0", "copper|0", "copper|0"],
          hand: ["cash in|2"],
          deck: [BLUE, BLUE],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("cash in|2", {
      alternativeCost: ["copper|0", "copper|0", "copper|0", "copper|0"],
    }).expectHandSize(0, 2);
    expect(s.state.players[0]!.board.some((card) => card.cardId === printingId("copper|0"))).toBe(false);
  });
});
