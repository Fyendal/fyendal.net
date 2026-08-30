import { describe, expect, it } from "vitest";
import { basePowerOf, legalIntents } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { printingId, scenario } from "../harness.js";

const kayo = {
  hero: "rhinar" as const,
  heroKey: "kayo|0",
  weapons: ["mandible claw|0"],
};

describe("SKA — Kayo and equipment", () => {
  it("Kayo treats a 5-power discard as 6, creates Might, and Beaten Trackers can cash in", () => {
    const g = scenario({
      seats: [
        {
          ...kayo,
          hand: ["bare fangs|1", "agile windup|3"],
          deck: ["reincarnate|3"],
          equipment: { legs: "beaten trackers|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("bare fangs|1", { pitch: ["agile windup|3"] })
      .chooseOption("yes")
      .expectInZone(0, "might|0", "board")
      .expectNoEquipment(0, "legs")
      .expectDeckBottom(0, "reincarnate|3")
      .expectAttackValue(8)
      .expectAP(0, 1);
  });

  it("Mandible Claw has go again after a 6-power discard", () => {
    const g = scenario({
      seats: [
        { ...kayo, hand: [], resources: 2 },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.state.players[0]!.flags.discardedSixPlusThisTurn = true;

    g.attackWithWeapon("mandible claw|0").blockWith().settle().expectAP(0, 1);
  });

  it("Knucklehead rolls deterministically, changes base intellect, and destroys itself", () => {
    const g = scenario({
      seed: 42,
      seats: [
        { ...kayo, hand: [], equipment: { head: "knucklehead|0" } },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.activate("knucklehead|0").expectNoEquipment(0, "head");
    const rolled = Number(g.state.players[0]!.flags.baseIntellectThisTurn);
    expect(rolled).toBeGreaterThanOrEqual(1);
    expect(rolled).toBeLessThanOrEqual(6);
  });

  it("Predatory Plating can be destroyed during a 6-power attack to gain a resource", () => {
    const g = scenario({
      seats: [
        {
          ...kayo,
          hand: ["strongest survive|1", "agile windup|3"],
          equipment: { chest: "predatory plating|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("strongest survive|1", { pitch: ["agile windup|3"], settle: false })
      .activate("predatory plating|0")
      .expectNoEquipment(0, "chest")
      .expectResources(0, 1);
  });
});

describe("SKA — attacks and clashes", () => {
  it("Buckwild sees Kayo's 6-power blue in pitch but attacks at its printed power", () => {
    const g = scenario({
      seats: [
        { ...kayo, hand: ["buckwild|3"], pitch: ["agile windup|3"], resources: 3 },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("buckwild|3").expectAttackValue(5).blockWith().settle().expectAP(0, 1);
  });

  it("Buckwild sees Rockyard Rodeo as 7 power while Rok is equipped", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["rok|0"], hand: ["buckwild|3", "rockyard rodeo|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("buckwild|3", { pitch: ["rockyard rodeo|3"] }).expectAttackValue(5);
    const rodeo = g.state.players[0]!.pitch.find(
      (card) => card.cardId === printingId("rockyard rodeo|3"),
    )!;
    expect(basePowerOf(g.state, 0, rodeo, cardData[rodeo.cardId]!.attack ?? 0)).toBe(7);

    g.blockWith().settle().expectAP(0, 1);
  });

  it("High Pitched Howl creates Vigor and Rough Up gets +1 from a 6-power pitch card", () => {
    const howl = scenario({
      seats: [
        { ...kayo, hand: ["high pitched howl|1"], pitch: ["agile windup|3"], resources: 2 },
        { hero: "dorinthea", hand: [] },
      ],
    });
    howl.play("high pitched howl|1").expectInZone(0, "vigor|0", "board");

    const rough = scenario({
      seats: [
        { ...kayo, hand: ["rough up|1"], pitch: ["agile windup|3"], resources: 2 },
        { hero: "dorinthea", hand: [] },
      ],
    });
    rough.play("rough up|1").expectAttackValue(7);
  });

  it("Pulping gains dominate from a 6-power discard and go again with fewer than two defenders", () => {
    const g = scenario({
      seats: [
        {
          ...kayo,
          hand: ["pulping|1", "agile windup|3"],
          deck: ["reincarnate|3"],
        },
        { hero: "dorinthea", hand: ["head jab|1", "raging onslaught|1"] },
      ],
    });

    g.play("pulping|1", { pitch: ["agile windup|3"] });
    const handIds = g.state.players[1]!.hand.map((card) => card.instanceId);
    const twoCardDefense = legalIntents(g.state, 1).some(
      (intent) =>
        intent.kind === "defend" && handIds.every((instanceId) => intent.instanceIds.includes(instanceId)),
    );
    expect(twoCardDefense).toBe(false);
    g.blockWith().settle().expectAP(0, 1);
  });

  it("a winning Unexpected Backhand clash deals 1 and Clash of Agility creates its token", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...kayo, hand: ["clash of agility|1"], deck: ["unexpected backhand|3"] },
        { hero: "dorinthea", hand: [], deck: ["head jab|1"], resources: 1 },
      ],
    });

    g.attackWithWeapon("dawnblade, resplendent|0")
      .blockWith("clash of agility|1")
      .settle()
      .expectLife(1, 19)
      .expectInZone(0, "agility|0", "board");
  });

  it("Strongest Survive lets the defending hero reveal enough power instead of discarding", () => {
    const g = scenario({
      seats: [
        { ...kayo, hand: ["strongest survive|1", "agile windup|3"] },
        { hero: "dorinthea", hand: ["head jab|1", "macho grande|3"] },
      ],
    });

    g.play("strongest survive|1", { pitch: ["agile windup|3"] })
      .blockWith("head jab|1")
      .settle()
      .chooseOption("reveal")
      .expectHandSize(1, 1)
      .expectLife(1, 15);
  });
});

describe("SKA — utility cards", () => {
  it("Agile Windup discards from hand at instant speed to create Agility", () => {
    const g = scenario({
      seats: [
        { ...kayo, hand: ["agile windup|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.activate("agile windup|3")
      .expectHandSize(0, 0)
      .expectInZone(0, "agility|0", "board");
  });

  it("Bear Hug and Run Roughshod enforce their 6-power setup conditions", () => {
    const g = scenario({
      seats: [
        {
          ...kayo,
          hand: ["bear hug|3", "run roughshod|3"],
          pitch: ["agile windup|3"],
          resources: 2,
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    const before = legalIntents(g.state, 0).filter((intent) => intent.kind === "play-card");
    expect(before.some((intent) => intent.instanceId === g.state.players[0]!.hand[0]!.instanceId)).toBe(true);
    expect(before.some((intent) => intent.instanceId === g.state.players[0]!.hand[1]!.instanceId)).toBe(false);

    g.state.players[0]!.flags.discardedSixPlusThisTurn = true;
    const after = legalIntents(g.state, 0).filter((intent) => intent.kind === "play-card");
    const roughshod = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("run roughshod|3"),
    )!;
    expect(after.some((intent) => intent.instanceId === roughshod.instanceId)).toBe(true);
  });

  it("Rally the Coast Guard discards a card for +3 defense", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...kayo, hand: ["rally the coast guard|3", "bear hug|3"] },
        { hero: "dorinthea", hand: [], resources: 1 },
      ],
    });

    g.attackWithWeapon("dawnblade, resplendent|0")
      .blockWith("rally the coast guard|3")
      .passPriority()
      .activate("rally the coast guard|3", { pitch: ["bear hug|3"] })
      .expectFinalDefense(5);
  });
});
