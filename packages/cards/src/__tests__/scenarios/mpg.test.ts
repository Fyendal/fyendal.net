import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData, isImplemented } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { scenario } from "../harness.js";

const valda = {
  hero: "rhinar" as const,
  heroKey: "valda brightaxe|0",
  weapons: [] as string[],
};

describe("MPG — import and Guardian pressure", () => {
  it("registers all eligible MPG printings as implemented cards", () => {
    const cards = Object.values(cardData).filter((card) => card.set === "MPG");
    expect(cards).toHaveLength(130);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
    expect(new Set(cards.map(functionalKeyOf))).toHaveLength(130);
  });

  it("Testament of Valahai gets +4 defense with six Seismic Surges", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          ...valda,
          hand: [],
          board: Array.from({ length: 6 }, () => "seismic surge|0"),
          equipment: { chest: "testament of valahai|0" },
        },
        { hero: "dorinthea", hand: ["head jab|1"] },
      ],
    });

    g.play("head jab|1").blockWith("testament of valahai|0").settle().expectFinalDefense(5);
  });

  it("Leave a Dent grants its deck-mill crush trigger to the next Guardian attack", () => {
    const g = scenario({
      seats: [
        { ...valda, hand: ["leave a dent|3", "aftershock|1"], resources: 4 },
        { hero: "dorinthea", hand: [], deck: ["head jab|1", "head jab|2", "head jab|3", "raging onslaught|1"] },
      ],
    });

    g.play("leave a dent|3").play("aftershock|1").blockWith().settle().expectZoneSize(1, "graveyard", 4);

    const belowCrush = scenario({
      seats: [
        { ...valda, hand: ["leave a dent|3", "aftershock|1"], resources: 4 },
        {
          hero: "dorinthea",
          hand: ["aftershock|3", "aftershock|3"],
          deck: ["head jab|1", "head jab|2", "head jab|3", "raging onslaught|1"],
        },
      ],
    });

    belowCrush
      .play("leave a dent|3")
      .play("aftershock|1")
      .blockWith("aftershock|3", "aftershock|3")
      .settle()
      .expectZoneSize(1, "deck", 4);
  });

  it("Gauntlet of Boulderhold buffs only the next Guardian attack played from arsenal", () => {
    const g = scenario({
      seats: [
        {
          ...valda,
          hand: ["thunder quake|3", "thunder quake|3", "thunder quake|3"],
          arsenal: ["aftershock|3"],
          equipment: { arms: "gauntlet of boulderhold|0" },
        },
        { ...valda, hand: [] },
      ],
    });

    g.activate("gauntlet of boulderhold|0", { pitch: ["thunder quake|3"] })
      .play("aftershock|3", {
        fromArsenal: true,
        pitch: ["thunder quake|3", "thunder quake|3"],
      })
      .expectAttackValue(8);
  });

  it("Promising Terrain increases Richter Scale's token batch once", () => {
    const g = scenario({
      seats: [
        {
          ...valda,
          hand: [],
          board: ["promising terrain|3"],
          equipment: { chest: "richter scale|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.activate("richter scale|0").expectZoneSize(0, "board", 4);
    expect(g.state.players[0]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!) === "seismic surge|0")).toHaveLength(3);
  });

  it("Tectonic Instability cycles each arsenal and creates one Surge per draw", () => {
    const g = scenario({
      seats: [
        {
          ...valda,
          heroKey: "bravo|0",
          hand: ["tectonic instability|3"],
          deck: ["head jab|1"],
          arsenal: ["raging onslaught|1"],
        },
        {
          hero: "dorinthea",
          hand: [],
          deck: ["head jab|2"],
          arsenal: ["raging onslaught|2"],
        },
      ],
    });

    g.play("tectonic instability|3")
      .chooseCard("raging onslaught|1")
      .chooseCard("raging onslaught|2")
      .expectHandSize(0, 1)
      .expectHandSize(1, 1);
    expect(g.state.players[0]!.board.filter((card) => functionalKeyOf(cardData[card.cardId]!) === "seismic surge|0")).toHaveLength(2);
  });

  it("Clash of Heads marks the losing hero's equipped head", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...valda, hand: ["clash of heads|2"], deck: ["thunder quake|1"] },
        {
          ...valda,
          hand: ["aftershock|1", "thunder quake|3", "thunder quake|3"],
          deck: ["head jab|1"],
          equipment: { head: "ironrot helm|0" },
        },
      ],
    });

    g.play("aftershock|1", { pitch: ["thunder quake|3", "thunder quake|3"] })
      .blockWith("clash of heads|2")
      .settle()
      .expectEquipmentDefense(1, "head", 0);
  });

  it("Geyser removes its last energy counter, creates a Surge, and destroys itself", () => {
    const g = scenario({
      seats: [
        { ...valda, hand: ["geyser of seismic stirrings|3", "thunder quake|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("geyser of seismic stirrings|3", { pitch: ["thunder quake|3"] })
      .endTurn()
      .expectInZone(0, "geyser of seismic stirrings|3", "graveyard")
      .expectInZone(0, "seismic surge|0", "board");
  });

  it("Renounce Grandeur gains power from an aura token and stops next-turn aura creation", () => {
    const g = scenario({
      seats: [
        {
          ...valda,
          hand: ["renounce grandeur|1", "thunder quake|3"],
        },
        {
          ...valda,
          hand: ["seismic stir|3", "thunder quake|3"],
          board: ["seismic surge|0"],
        },
      ],
    });

    g.play("renounce grandeur|1", { pitch: ["thunder quake|3"] })
      .expectAttackValue(8)
      .blockWith()
      .settle()
      .endTurn()
      .play("seismic stir|3", { pitch: ["thunder quake|3"] })
      .expectNotInZone(1, "seismic surge|0", "board")
      .expectLog("can't create aura tokens");
  });

  it("Sunkwater equipment cycles a face-up arsenal card for +1 defense", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          ...valda,
          hand: [],
          deck: ["raging onslaught|1"],
          arsenal: ["head jab|1"],
          equipment: { head: "sunkwater lookout|0" },
        },
        { hero: "dorinthea", hand: [], resources: 1 },
      ],
    });

    g.attackWithWeapon("dawnblade, resplendent|0")
      .blockWith("sunkwater lookout|0")
      .passPriority()
      .passPriority()
      .chooseCard("head jab|1")
      .expectFinalDefense(1)
      .expectHandSize(0, 1)
      .expectDeckBottom(0, "head jab|1");
  });

  it("Fearless Confrontation can weaken an opponent's attack", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...valda, hand: ["fearless confrontation|3"] },
        { hero: "dorinthea", hand: ["head jab|1"] },
      ],
    });

    g.play("head jab|1", { settle: false })
      .passPriority()
      .activate("fearless confrontation|3", { settle: false })
      .passPriority()
      .passPriority()
      .expectAttackValue(2)
      .blockWith()
      .settle()
      .expectFinalAttack(2)
      .expectInZone(0, "fearless confrontation|3", "graveyard");
  });

  it("Fearless Confrontation can weaken an opponent's attack targeting an ally", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...valda, hand: ["fearless confrontation|3"], board: ["barnacle|2"] },
        { hero: "dorinthea", hand: ["head jab|1"] },
      ],
    });

    g.play("head jab|1", { targetAlly: "barnacle|2", settle: false })
      .passPriority()
      .passPriority()
      .passPriority()
      .activate("fearless confrontation|3", { settle: false })
      .passPriority()
      .passPriority()
      .expectAttackValue(2)
      .settle()
      .expectFinalAttack(2)
      .expectInZone(0, "fearless confrontation|3", "graveyard");
  });

  it("Fearless Confrontation removes dominate from an opponent's attack before defense", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          ...valda,
          hand: ["fearless confrontation|3", "head jab|1", "head jab|2"],
        },
        {
          ...valda,
          heroKey: "bravo, showstopper|0",
          hand: ["aftershock|1"],
          resources: 6,
        },
      ],
    });

    g.activate("bravo, showstopper|0")
      .play("aftershock|1", { settle: false })
      .passPriority()
      .activate("fearless confrontation|3", { settle: false })
      .passPriority()
      .passPriority()
      .blockWith("head jab|1", "head jab|2")
      .settle()
      .expectFinalDefense(4);
  });

  it("Fearless Confrontation can target an attack from a previous chain link", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...valda, hand: ["fearless confrontation|3"] },
        { hero: "dorinthea", hand: ["head jab|1", "snatch|1"] },
      ],
    });

    g.play("head jab|1").blockWith().settle();
    const previousAttackId = g.state.chain[0]!.attackingCard.instanceId;

    g.play("snatch|1", { settle: false })
      .passPriority()
      .activate("fearless confrontation|3", { settle: false })
      .passPriority()
      .passPriority()
      .chooseCard("head jab|1")
      .expectAttackValue(4);

    expect(g.state.chain.find(
      (link) => link.attackingCard.instanceId === previousAttackId,
    )?.finalAttack).toBe(2);
  });

  it("Blinding of the Old Ones removes all abilities from owned cards", () => {
    const g = scenario({
      seats: [
        {
          ...valda,
          hand: ["blinding of the old ones|1", "thunder quake|3", "thunder quake|3"],
        },
        {
          ...valda,
          hand: ["head jab|1", "seismic stir|3", "thunder quake|3"],
          equipment: { chest: "richter scale|0" },
        },
      ],
    });

    g.play("blinding of the old ones|1", { pitch: ["thunder quake|3", "thunder quake|3"] })
      .blockWith()
      .settle()
      .endTurn();
    g.state.players[1]!.actionPoints = 2;
    expect(legalIntents(g.state, 1).some((intent) =>
      intent.kind === "activate-ability" &&
      intent.sourceInstanceId === g.state.players[1]!.equipment.chest?.instanceId
    )).toBe(false);
    g.play("head jab|1")
      .blockWith()
      .settle()
      .expectAP(1, 1)
      .play("seismic stir|3", { pitch: ["thunder quake|3"] })
      .expectNotInZone(1, "seismic surge|0", "board");
  });

  it("Annexation of All Things Known transfers face-up arsenal play access", () => {
    const g = scenario({
      seats: [
        {
          ...valda,
          hand: ["annexation of all things known|2", "thunder quake|3", "thunder quake|3"],
          deck: ["thunder quake|3", "thunder quake|3", "thunder quake|3", "thunder quake|3"],
        },
        { ...valda, hand: [], arsenal: ["seismic stir|1"] },
      ],
    });

    g.play("annexation of all things known|2", { pitch: ["thunder quake|3", "thunder quake|3"] })
      .blockWith()
      .settle();
    const arsenal = g.state.players[1]!.arsenal[0]!;
    g.endTurn();
    expect(legalIntents(g.state, 1).some((intent) =>
      (intent.kind === "play-card" || intent.kind === "play-from-arsenal") &&
      intent.instanceId === arsenal.instanceId
    )).toBe(false);
    g.endTurn();
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "play-from-arsenal" && intent.instanceId === arsenal.instanceId
    )).toBe(true);
    g.play("seismic stir|1", { fromArsenal: true, pitch: ["thunder quake|3"] })
      .expectInZone(1, "seismic stir|1", "graveyard");
  });

  it("Annexation of the Forge equips opposing equipment", () => {
    const g = scenario({
      seats: [
        {
          ...valda,
          hand: ["annexation of the forge|2", "thunder quake|3", "thunder quake|3"],
          equipment: { head: null },
        },
        { ...valda, hand: [], equipment: { head: "ironrot helm|0" } },
      ],
    });

    g.play("annexation of the forge|2", { pitch: ["thunder quake|3", "thunder quake|3"] })
      .blockWith()
      .settle()
      .chooseCard("ironrot helm|0")
      .expectEquipped(0, "head", "ironrot helm|0")
      .expectNoEquipment(1, "head");
  });
});
