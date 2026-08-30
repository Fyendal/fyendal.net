import { describe, expect, it } from "vitest";
import { scripts } from "../../index.js";
import { scenario } from "../harness.js";

describe("promotional card pool", () => {
  it("Diamond destroys itself, draws, and returns the action point", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", board: ["diamond|0"], deck: ["snatch|1"] },
        { hero: "rhinar" },
      ],
    });

    g.activate("diamond|0")
      .expectNotInZone(0, "diamond|0", "board")
      .expectHandSize(0, 1)
      .expectAP(0, 1);
  });

  it("Jack-o'-Lantern banishes the top card and creates a Runechant on a color match", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["jack-o'-lantern|1"], deck: ["snatch|1"] },
        { hero: "rhinar" },
      ],
    });

    g.play("jack-o'-lantern|1")
      .expectInZone(0, "snatch|1", "banish")
      .expectInZone(0, "runechant|0", "board")
      .expectAP(0, 1);
  });

  it("a specialized Runechant expires on an attack and replaces itself with a Runechant", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["snatch|1"], board: ["runechant of greed|2"] },
        { hero: "rhinar" },
      ],
    });

    g.play("snatch|1")
      .expectNotInZone(0, "runechant of greed|2", "board")
      .expectInZone(0, "runechant|0", "board")
      .blockWith()
      .settle();
    expect(scripts["GEM177"]?.onUsurped).toBeTypeOf("function");
  });

  it("Drinking Buddy searches both decks and gains go again when both heroes find an item", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["drinking buddy|1", "raging onslaught|3"],
          deck: ["potion of strength|3"],
        },
        { hero: "rhinar", deck: ["crazy brew|3"] },
      ],
    });

    g.play("drinking buddy|1", { pitch: ["raging onslaught|3"] })
      .chooseCard("potion of strength|3")
      .chooseCard("crazy brew|3")
      .expectInZone(0, "potion of strength|3", "board")
      .expectInZone(1, "crazy brew|3", "board")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Brutus chooses the winner of a tied clash", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", resources: 1, deck: ["raging onslaught|1"] },
        {
          hero: "rhinar",
          heroKey: "brutus, summa rudis|0",
          hand: ["test of vigor|1"],
          deck: ["raging onslaught|1"],
        },
      ],
    });

    g.attackWithWeapon().blockWith("test of vigor|1")
      .passPriority().passPriority();
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-clash-winner");
    g.chooseCard("brutus, summa rudis|0")
      .expectInZone(1, "vigor|0", "board");
  });

  it("The Librarian moves a Tome from inventory to hand", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "the librarian, magister of history|0",
          inventory: ["tome of fyendal|2"],
        },
        { hero: "rhinar" },
      ],
    });

    g.activate("the librarian, magister of history|0")
      .chooseCard("tome of fyendal|2")
      .expectHandSize(0, 1)
      .expectAP(0, 1);
    expect(g.state.players[1]!.hero.counters?.bonusIntellectAtEndPhaseTurn).toBe(2);
  });

  it("Batter's large damage bypasses prevention and Theryon answers its equipment destruction", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "dorinthea",
          heroKey: "theryon, magister of justice|0",
          resources: 2,
          board: ["spectral shield|0"],
          equipment: { chest: "heartened cross strap|0" },
        },
        {
          hero: "rhinar",
          hand: ["batter to a pulp|1", "raging onslaught|3", "raging onslaught|3"],
          board: ["diamond|0"],
        },
      ],
    });

    g.play("batter to a pulp|1", {
      pitch: ["raging onslaught|3", "raging onslaught|3"],
    })
      .blockWith()
      .settle()
      .chooseOption("destroy")
      .expectLife(0, 10)
      .expectNotInZone(0, "spectral shield|0", "board")
      .chooseCard("heartened cross strap|0")
      .chooseOption("pay 2")
      .chooseCard("diamond|0")
      .expectNoEquipment(0, "chest")
      .expectNotInZone(1, "diamond|0", "board")
      .expectResources(0, 0);
  });

  it("Ruu'di reveals the top card and lets the opposing hero draw", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "ruu'di, gem keeper|0",
          hand: ["raging onslaught|3"],
          deck: ["snatch|1"],
        },
        { hero: "rhinar", deck: ["dodge|3"] },
      ],
    });

    g.activate("ruu'di, gem keeper|0", { pitch: ["raging onslaught|3"] })
      .chooseOption("yes")
      .expectHandSize(1, 1)
      .expectAP(0, 1);
  });
});
