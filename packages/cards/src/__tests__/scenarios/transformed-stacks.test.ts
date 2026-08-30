import { describe, expect, it } from "vitest";
import { actionCandidates, legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";

describe("transformed permanent stacks", () => {
  it("uses Mechropotent's 3 intellect after Singularity transforms the hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          resources: 6,
          hand: ["singularity|1"],
          deck: [
            "wounding blow|1",
            "wounding blow|2",
            "wounding blow|3",
            "raging onslaught|1",
          ],
          weapons: ["teklo leveler|0"],
          equipment: {
            head: "evo beta base head|3",
            chest: "evo beta base chest|3",
            arms: "evo beta base arms|3",
            legs: "evo beta base legs|3",
          },
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("singularity|1");

    expect(g.state.players[0]!.intellect).toBe(3);
    g.endTurn();
    expect(g.state.players[0]!.hand).toHaveLength(3);
  });

  it("projects every card transformed under the hero by Singularity", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          resources: 9,
          hand: ["singularity|1"],
          weapons: ["teklo leveler|0"],
          equipment: {
            head: "evo beta base head|3",
            chest: "evo beta base chest|3",
            arms: "evo beta base arms|3",
            legs: "evo beta base legs|3",
          },
        },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.actionPoints = 2;
    const head = g.state.players[0]!.equipment.head!;
    head.subcards = [{
      instanceId: g.state.nextInstanceId++,
      cardId: printingId("wounding blow|1"),
      owner: 0,
    }];

    g.play("singularity|1");

    expect(g.state.players[0]!.hero.cardId).toBe(printingId("teklovossen, the mechropotent|0"));
    expect(g.state.players[0]!.hero.subcards).toHaveLength(6);
    for (const viewer of [0, 1]) {
      expect(projectStateFor(g.state, viewer).players[0]!.heroSubcards).toHaveLength(6);
    }

    const transformedHero = g.state.players[0]!.hero;
    expect(actionCandidates(g.state, 0)).toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: transformedHero.instanceId,
      pitchRequired: 0,
    }));
    const nestedBase = transformedHero.subcards!
      .flatMap((card) => card.subcards ?? [])
      .find((card) => card.cardId === printingId("wounding blow|1"))!;
    const formerWeapon = transformedHero.subcards!
      .find((card) => card.cardId === printingId("teklo leveler|0"))!;
    g.activate("teklovossen, the mechropotent|0", { settle: false });
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-activation-soul");
    g.chooseOption(String(nestedBase.instanceId));
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "engine-activation-soul",
      prompt: expect.stringContaining("2 of 2"),
    });
    g.chooseOption(String(formerWeapon.instanceId));
    expect(g.state.players[0]!.soul).toHaveLength(0);
    expect(g.state.players[0]!.hero.subcards).toHaveLength(5);
    expect(g.state.players[0]!.banish.map((card) => card.cardId)).toEqual(expect.arrayContaining([
      printingId("wounding blow|1"),
      printingId("teklo leveler|0"),
    ]));
    expect(g.state.players[0]!.resources).toBe(0);
    expect(g.state.players[0]!.actionPoints).toBe(0);
    expect(g.state.chain.at(-1)?.attackingCard.instanceId).toBe(transformedHero.instanceId);
  });

  it("does not trigger Runechant when a non-weapon hero attack is activated", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          resources: 9,
          hand: ["singularity|1"],
          board: ["runechant|0"],
          weapons: ["teklo leveler|0"],
          equipment: {
            head: "evo beta base head|3",
            chest: "evo beta base chest|3",
            arms: "evo beta base arms|3",
            legs: "evo beta base legs|3",
          },
        },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.actionPoints = 2;

    g.play("singularity|1");
    const soul = g.state.players[0]!.hero.subcards!.slice(0, 2);
    g.activate("teklovossen, the mechropotent|0", { settle: false })
      .chooseOption(String(soul[0]!.instanceId))
      .chooseOption(String(soul[1]!.instanceId));

    g.expectInZone(0, "runechant|0", "board");
    expect(g.state.stack.some((layer) =>
      layer.label.includes("Destroy Runechant")
    )).toBe(false);
  });

  it("allows the Mechropotent to attack multiple times with sufficient AP, resources, and soul", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          resources: 12,
          hand: ["singularity|1"],
          soul: ["wounding blow|1", "wounding blow|2", "wounding blow|3", "raging onslaught|1"],
          weapons: ["teklo leveler|0"],
          equipment: {
            head: "evo beta base head|3",
            chest: "evo beta base chest|3",
            arms: "evo beta base arms|3",
            legs: "evo beta base legs|3",
          },
        },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.actionPoints = 3;

    g.play("singularity|1");
    const heroId = g.state.players[0]!.hero.instanceId;
    g.activate("teklovossen, the mechropotent|0", { settle: false })
      .chooseCard("wounding blow|1")
      .chooseCard("wounding blow|2")
      .blockWith()
      .settle();

    expect(actionCandidates(g.state, 0)).toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: heroId,
    }));
    g.activate("teklovossen, the mechropotent|0", { settle: false })
      .chooseCard("wounding blow|3")
      .chooseCard("raging onslaught|1")
      .blockWith()
      .settle();

    expect(g.state.chain.map((link) => link.attackingCard.instanceId)).toEqual([heroId, heroId]);
    expect(g.state.players[0]!.resources).toBe(0);
    expect(g.state.players[0]!.actionPoints).toBe(0);
    expect(g.state.players[0]!.soul).toHaveLength(0);
  });

  it("counts the Mechropotent as 4 equipped Evos for Terminator Tank", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          resources: 9,
          hand: ["singularity|1", "terminator tank|1"],
          weapons: ["teklo leveler|0"],
          equipment: {
            head: "evo beta base head|3",
            chest: "evo beta base chest|3",
            arms: "evo beta base arms|3",
            legs: "evo beta base legs|3",
          },
        },
        { hero: "dorinthea", hand: ["wounding blow|1", "wounding blow|2"] },
      ],
    });
    g.state.players[0]!.actionPoints = 2;

    g.play("singularity|1")
      .play("terminator tank|1")
      .expectAttackValue(9)
      .blockWith()
      .settle()
      .chooseCard("wounding blow|2")
      .settle();

    expect(g.state.players[0]!.resources).toBe(0);
    expect(g.state.players[1]!.hand).toHaveLength(1);
  });

  it("allows the Mechropotent to defend once per combat chain and applies Battleworn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "teklovossen|0",
          resources: 6,
          hand: ["singularity|1"],
          weapons: ["teklo leveler|0"],
          equipment: {
            head: "evo beta base head|3",
            chest: "evo beta base chest|3",
            arms: "evo beta base arms|3",
            legs: "evo beta base legs|3",
          },
        },
        { hero: "dorinthea", hand: ["head jab|1", "head jab|1"] },
      ],
    });

    g.play("singularity|1").endTurn();
    const heroId = g.state.players[0]!.hero.instanceId;
    g.play("head jab|1").blockWith("teklovossen, the mechropotent|0").settle();
    expect(g.state.chain.at(-1)?.defendingEquipment.map((card) => card.instanceId)).toContain(heroId);

    g.play("head jab|1");
    expect(legalIntents(g.state, 0)).not.toContainEqual(expect.objectContaining({
      kind: "stage-defenders",
      instanceIds: [heroId],
    }));
    g.blockWith().settle().endTurn();

    expect(g.state.players[0]!.hero.defCounters).toBe(1);
  });

  it("projects every card transformed under Nitro Mechanoid", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 4,
          hand: ["construct nitro mechanoid|2"],
          weapons: ["teklo plasma pistol|0"],
          equipment: {
            head: "teklo base head|0",
            chest: "teklo base chest|0",
            arms: "teklo base arms|0",
            legs: "teklo base legs|0",
          },
          board: ["hyper driver|0", "hyper driver|0", "hyper driver|0"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("construct nitro mechanoid|2");

    const nitro = g.state.players[0]!.board.find(
      (card) => card.cardId === printingId("nitro mechanoid|0"),
    );
    expect(nitro?.subcards).toHaveLength(8);
    for (const viewer of [0, 1]) {
      const projectedNitro = projectStateFor(g.state, viewer).players[0]!.board.find(
        (card) => card.cardId === printingId("nitro mechanoid|0"),
      );
      expect(projectedNitro?.subcards).toHaveLength(8);
    }
  });
});
