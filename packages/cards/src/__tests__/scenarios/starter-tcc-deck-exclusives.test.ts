import { legalIntents } from "@fyendal/engine";
import { describe, expect, it } from "vitest";
import { scenario } from "../harness.js";

describe("starter and demo products", () => {
  it("Sizzle buffs the following Elemental Lightning attack after enabling Lightning Flow", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["sizzle|2", "crackling|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("sizzle|2")
      .play("crackling|1")
      .expectAttackValue(6); // 3 base + 1 Lightning Flow + 2 Sizzle
  });

  it("Flourish replaces Strong Wood's Earth Bond power gain", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["flourish|3", "strong wood|1", "autumn's touch|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("flourish|3")
      .play("strong wood|1", { pitch: ["autumn's touch|3"] })
      .expectAttackValue(9); // 6 base + (1 Earth Bond + 2 Flourish)
  });

  it("Back for Seconds gives the first sword attack +2", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["back for seconds|2"], resources: 2 },
        { hero: "rhinar", hand: [] },
      ],
    });

    g.attackWithWeapon()
      .blockWith()
      .react("back for seconds|2")
      .expectFinalAttack(4); // 2 base + 2 on the first attack
  });
});

describe("TCC — Round the Table", () => {
  it("Professor Teklovossen plays a discounted Evo from banish and transforms its base", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "professor teklovossen|0",
          banish: ["evo energy matrix|3"],
          equipment: { chest: "proto base chest|0" },
          resources: 2,
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("evo energy matrix|3", { fromZone: "banish" })
      .expectEquipped(0, "chest", "evo energy matrix|3")
      .expectResources(0, 0);
  });

  it("Tiger Eye Reflex can Ambush from arsenal and creates a playable Crouching Tiger", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [], resources: 1 },
        { hero: "rhinar", hand: [], arsenalFaceDown: ["tiger eye reflex|2"] },
      ],
    });

    g.attackWithWeapon();
    const reflex = g.state.players[1]!.arsenal[0]!;
    expect(legalIntents(g.state, 1)).toContainEqual({
      kind: "stage-defenders",
      instanceIds: [reflex.instanceId],
    });

    g.blockWith("tiger eye reflex|2")
      .settle()
      .expectInZone(1, "crouching tiger|0", "banish");
  });

  it("Jinglewood lets the opposing hero choose a token and creates Copper", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "melody, sing-along|0",
          weapons: ["jinglewood, smash hit|0"],
          resources: 3,
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.activate("jinglewood, smash hit|0", { ability: 0 })
      .chooseOption("Might")
      .expectInZone(0, "copper|0", "board")
      .expectInZone(1, "might|0", "board");
  });
});

describe("deck-exclusive mentors", () => {
  it("Minerva Themis flips at the start of turn and gives a 1H weapon +1", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["titanium bauble|3", "titanium bauble|3", "titanium bauble|3", "titanium bauble|3"],
          arsenalFaceDown: ["minerva themis|0"],
          weapons: ["spider's bite|0"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });

    g.endTurn()
      .endTurn()
      .chooseOption("yes")
      .expectFaceDown(0, "minerva themis|0", false)
      .attackWithWeapon("spider's bite|0", { pitch: ["titanium bauble|3"] })
      .expectAttackValue(2);
  });

  it("The Hand can turn face up from arsenal and buff the contract attack already in combat", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["annihilate the armed|1"],
          arsenalFaceDown: ["the hand that pulls the strings|0"],
          resources: 1,
        },
        {
          hero: "dorinthea",
          heroKey: "emperor, dracai of aesir|0",
          hand: [],
        },
      ],
    });

    g.play("annihilate the armed|1")
      .blockWith()
      .activate("the hand that pulls the strings|0")
      .expectFaceDown(0, "the hand that pulls the strings|0", false)
      .expectFinalAttack(6)
      .expectAP(0, 1);
  });
});
