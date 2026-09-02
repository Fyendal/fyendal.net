import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { printingId, scenario } from "../harness.js";
import type { Scenario } from "../harness.js";

const viserai = {
  hero: "rhinar" as const,
  heroKey: "viserai|0",
  weapons: [] as string[],
};

function boardCard(g: Scenario, seat: number, key: string) {
  const card = g.state.players[seat]!.board.find((c) => c.cardId === printingId(key));
  expect(card, `no ${key} on seat ${seat}'s board`).toBeTruthy();
  return card!;
}

function yieldWindowTo(g: Scenario, seat: number): void {
  for (let i = 0; i < 12; i++) {
    const pending = g.state.pendingDecision;
    if (!pending) throw new Error(`no priority window for seat ${seat}`);
    if (pending.kind === "defend" || pending.kind === "choose-target" || pending.kind === "optional-effect") {
      throw new Error(`unexpected ${pending.kind} decision`);
    }
    if (pending.player === seat) return;
    g.passPriority();
  }
  throw new Error("priority window did not converge");
}

describe("SVI — Viserai and Runechants", () => {
  it("Viserai does not count the first Runeblade non-attack action as another card", () => {
    const g = scenario({
      seats: [
        { ...viserai, hand: ["mauvrion skies|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("mauvrion skies|1").expectNotInZone(0, "runechant|0", "board");
  });

  it("Viserai creates a Runechant after a prior non-attack action", () => {
    const g = scenario({
      seats: [
        {
          ...viserai,
          hand: ["mauvrion skies|1", "spellblade assault|1", "wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("mauvrion skies|1")
      .play("spellblade assault|1", { pitch: ["wrecker romp|3"] })
      .expectZoneSize(0, "board", 3) // Viserai's new Runechant plus Spellblade's two
      .blockWith()
      .settle()
      .expectLife(1, 16)
      .expectZoneSize(0, "board", 6); // Mauvrion creates three more on hit
  });

  it("Runechants reduce Amplify the Arknight's cost and trigger on its attack", () => {
    const g = scenario({
      seats: [
        {
          ...viserai,
          board: ["runechant|0", "runechant|0"],
          hand: ["amplify the arknight|1", "en garde|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("amplify the arknight|1", { pitch: ["en garde|1"] })
      .expectResources(0, 0)
      .blockWith()
      .settle()
      .expectLife(1, 12)
      .expectZoneSize(0, "board", 0);
  });

  it("Reduce to Runechant is discounted in the reaction window and creates a Runechant", () => {
    const g = scenario({
      active: 0,
      seats: [
        { hero: "rhinar", hand: ["wounded bull|1", "wrecker romp|3"] },
        { ...viserai, board: ["runechant|0"], hand: ["reduce to runechant|1"] },
      ],
    });

    g.play("wounded bull|1").blockWith();
    yieldWindowTo(g, 1);
    g.react("reduce to runechant|1");
    g.expectZoneSize(1, "board", 2).expectFinalDefense(4).expectLife(1, 17);
  });
});

describe("SVI — aura conditionals", () => {
  it("an aura played this turn powers Hit the High Notes", () => {
    const g = scenario({
      seats: [
        {
          ...viserai,
          hand: ["sigil of silphidae|3", "hit the high notes|1", "en garde|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("sigil of silphidae|3")
      .play("hit the high notes|1", { pitch: ["en garde|1"] })
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectFinalAttack(6);
  });

  it("an aura created this turn also powers Hit the High Notes", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["mauvrion skies|3", "spellblade assault|1", "hit the high notes|1", "wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("mauvrion skies|3")
      .play("spellblade assault|1", { pitch: ["wrecker romp|3"] })
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .play("hit the high notes|1")
      .expectAttackValue(6)
      .blockWith()
      .settle();
  });

  it("Runerager Swarm only gains go again after an aura was played or created", () => {
    const plain = scenario({
      seats: [{ ...viserai, hand: ["runerager swarm|1"] }, { hero: "dorinthea", hand: [] }],
    });
    plain.play("runerager swarm|1").blockWith().settle().expectAP(0, 0);

    const powered = scenario({
      seats: [
        { ...viserai, hand: ["sigil of silphidae|3", "runerager swarm|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    powered
      .play("sigil of silphidae|3")
      .play("runerager swarm|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Malefic Incantation removes one verse per turn and makes a Runechant", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["malefic incantation|1", "runerager swarm|1", "spellblade assault|1", "wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("malefic incantation|1").play("runerager swarm|1").blockWith().settle();
    expect(boardCard(g, 0, "malefic incantation|1").counters?.verse).toBe(2);
    g.expectLife(1, 17).expectAP(0, 1);

    g.play("spellblade assault|1", { pitch: ["wrecker romp|3"] }).blockWith().settle();
    expect(boardCard(g, 0, "malefic incantation|1").counters?.verse).toBe(2);
  });

  it("puts Malefic Incantation's attack-play trigger on the stack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["malefic incantation|1", "runerager swarm|1"] },
        { hero: "dorinthea", hand: ["sigil of solace|1"] },
      ],
    });

    g.play("malefic incantation|1")
      .play("runerager swarm|1", { settle: false });

    const view = projectStateFor(g.state, 0);
    expect(view.stack[0]).toMatchObject({
      card: { cardId: printingId("malefic incantation|1") },
      label: "Remove a verse counter and create a Runechant",
    });
    expect(boardCard(g, 0, "malefic incantation|1").counters?.verse).toBe(3);

    g.settle();
    expect(boardCard(g, 0, "malefic incantation|1").counters?.verse).toBe(2);
    g.expectInZone(0, "runechant|0", "board");
  });

  it("lets the controller order Runechant and Malefic Incantation play triggers", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["runechant|0"],
          hand: ["malefic incantation|1", "runerager swarm|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("malefic incantation|1");
    const runechantId = boardCard(g, 0, "runechant|0").instanceId;
    const maleficId = boardCard(g, 0, "malefic incantation|1").instanceId;

    g.play("runerager swarm|1", { settle: false });
    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      kind: "order-triggers",
      optionLabels: expect.arrayContaining([
        "Destroy Runechant: 1 arcane damage to the opposing hero",
        "Remove a verse counter and create a Runechant",
      ]),
    });

    g.doRaw({
      kind: "order-triggers",
      optionIds: [`${maleficId}:0`, `${runechantId}:0`],
    });
    expect(g.state.stack.map((layer) => layer.sourceInstanceId)).toEqual([
      maleficId,
      runechantId,
    ]);

    g.settle();
    expect(boardCard(g, 0, "malefic incantation|1").counters?.verse).toBe(2);
    g.expectLife(1, 19).expectZoneSize(0, "board", 2);
    expect(g.state.players[0]!.board.filter((card) =>
      cardData[card.cardId]?.name === "Runechant"
    )).toHaveLength(1);
  });

  it("Runechant still triggers when a weapon attack is activated", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["nebula blade|0"],
          board: ["runechant|0"],
          hand: ["wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    const runechantId = boardCard(g, 0, "runechant|0").instanceId;
    g.attackWithWeapon("nebula blade|0", {
      pitch: ["wrecker romp|3"],
      settle: false,
    });
    expect(g.state.stack[0]).toMatchObject({
      sourceInstanceId: runechantId,
      label: "Destroy Runechant: 1 arcane damage to the opposing hero",
    });

    g.settle();
    g.expectLife(1, 19).expectNotInZone(0, "runechant|0", "board");
  });
});

describe("SVI — attack effects", () => {
  it("Mauvrion Skies grants go again and creates Runechants on hit", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["mauvrion skies|1", "runerager swarm|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("mauvrion skies|1")
      .play("runerager swarm|1")
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectZoneSize(0, "board", 3);
  });

  it("Mauvrion Skies creates Runechants when the affected attack hits an ally", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["mauvrion skies|1", "runerager swarm|1"] },
        { hero: "dorinthea", board: ["barnacle|2"], hand: [] },
      ],
    });

    g.play("mauvrion skies|1")
      .play("runerager swarm|1", { targetAlly: "barnacle|2" })
      .expectZoneSize(0, "board", 3)
      .expectInZone(1, "barnacle|2", "graveyard");
  });

  it("Runic Fellingsong may banish a graveyard aura for arcane damage", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["runic fellingsong|1", "wrecker romp|3"],
          graveyard: ["malefic incantation|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("runic fellingsong|1", { pitch: ["wrecker romp|3"] })
      .chooseCard("malefic incantation|1")
      .expectLife(1, 19)
      .expectInZone(0, "malefic incantation|1", "banish")
      .blockWith()
      .settle()
      .expectLife(1, 12);
  });

  it("Vexing Malice deals 2 arcane damage when it attacks", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["vexing malice|3", "en garde|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("vexing malice|3", { pitch: ["en garde|1"] })
      .expectLife(1, 18)
      .blockWith()
      .settle()
      .expectLife(1, 17);
  });

  it("Condemn to Slaughter trades auras and buffs the next Runeblade attack", () => {
    const g = scenario({
      seats: [
        {
          ...viserai,
          board: ["malefic incantation|1"],
          hand: ["condemn to slaughter|1", "amplify the arknight|1", "wrecker romp|3", "en garde|1"],
        },
        { hero: "dorinthea", board: ["sigil of silphidae|3"], hand: [] },
      ],
    });

    g.play("condemn to slaughter|1", { pitch: ["wrecker romp|3"] })
      .chooseCard("malefic incantation|1")
      .chooseCard("sigil of silphidae|3")
      .expectZoneSize(0, "board", 0)
      .expectZoneSize(1, "board", 0)
      .play("amplify the arknight|1", { pitch: ["en garde|1"] })
      .expectAttackValue(9)
      .blockWith()
      .settle()
      .expectFinalAttack(9);
  });
});

describe("SVI — auras and equipment", () => {
  it("Sigil of Silphidae triggers on entry and destroys itself next action phase", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["sigil of silphidae|3"],
          graveyard: ["malefic incantation|1", "malefic incantation|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("sigil of silphidae|3")
      .chooseCard("malefic incantation|1")
      .expectLife(1, 19)
      .expectInZone(0, "sigil of silphidae|3", "board")
      .endTurn()
      .endTurn()
      .chooseCard("malefic incantation|1")
      .expectNotInZone(0, "sigil of silphidae|3", "board")
      .expectLife(1, 18);
  });

  it("Beckoning Haunt returns an aura with the announced X cost", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          graveyard: ["malefic incantation|1"],
          hand: ["en garde|1"],
          equipment: { arms: "beckoning haunt|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.activate("beckoning haunt|0", { settle: false });
    expect(g.state.pendingDecision?.options).toEqual(["X = 0"]);
    g.chooseOption("X = 0")
      .chooseOption("pay 1 — pitch En Garde")
      .chooseCard("malefic incantation|1")
      .expectInZone(0, "malefic incantation|1", "hand")
      .expectNoEquipment(0, "arms");
  });

  it("does not offer Beckoning Haunt without a payable aura cost", () => {
    const withoutAura = scenario({
      seats: [
        { hero: "rhinar", resources: 10, equipment: { arms: "beckoning haunt|0" } },
        { hero: "dorinthea" },
      ],
    });
    const withoutResources = scenario({
      seats: [
        {
          hero: "rhinar",
          graveyard: ["sigil of gravespawning|3"],
          equipment: { arms: "beckoning haunt|0" },
        },
        { hero: "dorinthea" },
      ],
    });

    for (const g of [withoutAura, withoutResources]) {
      const sourceId = g.state.players[0]!.equipment.arms!.instanceId;
      expect(legalIntents(g.state, 0).some((intent) =>
        intent.kind === "activate-ability" && intent.sourceInstanceId === sourceId
      )).toBe(false);
    }
  });

  it("Runebleed Robe and a Runechant prevent the next arcane damage", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          board: ["runechant|0"],
          equipment: { chest: "runebleed robe|0" },
        },
        { hero: "dorinthea", hand: ["sigil of solace|1", "vexing malice|3", "en garde|1"] },
      ],
    });

    g.play("sigil of solace|1", { settle: false })
      .passPriority()
      .activate("runebleed robe|0")
      .expectNoEquipment(0, "chest")
      .expectZoneSize(0, "board", 0)
      .play("vexing malice|3", { pitch: ["en garde|1"] })
      .expectLife(0, 19)
      .blockWith()
      .settle()
      .expectLife(0, 18);
  });

  it("Reaping Blade stops the hero ahead on life from gaining life", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", life: 15, weapons: ["reaping blade|0"] },
        { hero: "dorinthea", life: 20, hand: ["sigil of solace|1"] },
      ],
    });

    g.play("sigil of solace|1").expectLife(1, 20).expectLog("can't gain life");
  });
});
