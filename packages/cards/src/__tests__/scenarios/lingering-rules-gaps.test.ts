import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario, type SeatSpec } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function hero(spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero: "rhinar", weapons: [], ...spec, equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) } };
}

function foe(spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero: "dorinthea", weapons: [], ...spec, equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) } };
}

const ongoing = (g: ReturnType<typeof scenario>, cardKey: string) =>
  projectStateFor(g.state, 0).ongoing.filter((effect) => effect.cardId === printingId(cardKey));

describe("Arc Lightning grants go again to the next action card only", () => {
  it("Arc Lightning does not give a weapon attack go again", () => {
    const g = scenario({
      seats: [hero({ heroKey: "aurora|0", weapons: ["dawnblade|0"], resources: 1, hand: ["arc lightning|2"] }), foe()],
    });
    g.play("arc lightning|2").declareTarget(1).expectAP(0, 1);
    g.attackWithWeapon("dawnblade|0").blockWith().settle().expectAP(0, 0);
  });

  it("Arc Lightning gives a non-attack action card go again", () => {
    const g = scenario({
      seats: [hero({ heroKey: "aurora|0", hand: ["arc lightning|2", "healing balm|1"] }), foe()],
    });
    g.play("arc lightning|2").declareTarget(1).play("healing balm|1").declareTarget(1).expectAP(0, 1);
  });

  it("Arc Lightning gives an attack action card go again", () => {
    const g = scenario({
      seats: [hero({ heroKey: "aurora|0", hand: ["arc lightning|2", "lightning surge|1"] }), foe()],
    });
    g.play("arc lightning|2").declareTarget(1).play("lightning surge|1").blockWith().settle().declareTarget(1)
      .expectAP(0, 1);
  });

  it("Arc Lightning labels its go again for the next action card and its arcane trigger for the turn", () => {
    const g = scenario({
      seats: [hero({ heroKey: "aurora|0", hand: ["arc lightning|2"] }), foe()],
    });
    g.play("arc lightning|2").declareTarget(1);
    expect(ongoing(g, "arc lightning|2").map((effect) => effect.label).sort()).toEqual([
      "deal 1 arcane damage to any target whenever you go again · this turn",
      "go again · next action card",
    ]);
  });
});

describe("Mercurial Skies grants go again to the next Runeblade or Lightning attack action card", () => {
  it("Mercurial Skies does not give a non-attack Runeblade action card go again", () => {
    const g = scenario({
      seats: [hero({ hand: ["mercurial skies|1", "read the runes|1", "lightning surge|1"] }), foe()],
    });
    g.play("mercurial skies|1").expectAP(0, 1).play("read the runes|1").expectAP(0, 0);
  });

  it("Mercurial Skies is not used up by a weapon attack before the Runeblade attack action card", () => {
    const g = scenario({
      seats: [hero({ resources: 2, weapons: ["spider's bite|0"], hand: ["mercurial skies|1", "lightning surge|1"] }), foe()],
    });
    g.play("mercurial skies|1").attackWithWeapon("spider's bite|0").blockWith().settle()
      .play("lightning surge|1").blockWith().settle().expectAP(0, 1);
  });

  it("Mercurial Skies labels its go again and rider for the next Runeblade or Lightning attack action card", () => {
    const g = scenario({ seats: [hero({ hand: ["mercurial skies|1"] }), foe()] });
    g.play("mercurial skies|1");
    expect(ongoing(g, "mercurial skies|1").map((effect) => effect.label)).toEqual([
      "go again, may destroy a Lightning Flow to deal 3 arcane damage the first time it damages a hero · " +
        "next Runeblade or Lightning attack action card this turn",
    ]);
  });

  it("Mercurial Skies still gives a later Runeblade attack action card go again", () => {
    const g = scenario({
      seats: [hero({ hand: ["mercurial skies|1", "lightning surge|1"] }), foe()],
    });
    g.play("mercurial skies|1").play("lightning surge|1").blockWith().settle().expectAP(0, 1);
  });
});

describe("Runebleed Robe prevents only arcane damage", () => {
  it("Runebleed Robe does not prevent physical damage", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", board: ["runechant|0"], equipment: { chest: "runebleed robe|0" } },
        { hero: "dorinthea", weapons: ["dawnblade|0"], resources: 1, hand: ["sigil of solace|1"] },
      ],
    });
    g.play("sigil of solace|1", { settle: false })
      .passPriority()
      .activate("runebleed robe|0")
      .attackWithWeapon("dawnblade|0")
      .blockWith()
      .settle()
      .expectLife(0, 17);
  });
});

describe("Bios Update buffs the next attack action card you boost", () => {
  it("Bios Update does not buff an unboosted Mechanologist attack", () => {
    const g = scenario({
      seats: [hero({ resources: 1, hand: ["bios update|1", "zipper hit|1"], deck: ["zipper hit|1"] }), foe()],
    });
    g.play("bios update|1");
    const unboosted = legalIntents(g.state, 0).find(
      (intent) =>
        intent.kind === "play-card" &&
        !intent.boost &&
        g.state.players[0]!.hand.some(
          (card) => card.instanceId === intent.instanceId && card.cardId === printingId("zipper hit|1"),
        ),
    );
    expect(unboosted).toBeDefined();
    g.doRaw(unboosted!).settle().expectAttackValue(5);
  });

  it("Bios Update buffs a boosted Mechanologist attack action card", () => {
    const g = scenario({
      seats: [hero({ resources: 1, hand: ["bios update|1", "zipper hit|1"], deck: ["zipper hit|1"] }), foe()],
    });
    g.play("bios update|1");
    expect(ongoing(g, "bios update|1").map((effect) => effect.label)).toEqual([
      "the next attack you boost gets +3 power, put the next Mechanologist item with cost 2 or less banished " +
        "to pay a boost cost into the arena · this turn",
    ]);
    g.play("zipper hit|1", { boost: true }).expectAttackValue(8);
  });
});

describe("Toxicity grants its life loss to an Assassin or Ranger attack action card", () => {
  it("Toxicity does not give an Assassin weapon attack its life loss", () => {
    const g = scenario({
      seats: [hero({ resources: 3, weapons: ["spider's bite|0"], hand: ["toxicity|1"] }), foe()],
    });
    g.play("toxicity|1").attackWithWeapon("spider's bite|0").blockWith().settle().expectLife(1, 19);
  });
});

describe("Chromatic Refinement discounts the next card of its colour", () => {
  it("Chromatic Refinement labels its discount for the next red card and keeps its damage rider", () => {
    const g = scenario({
      seats: [
        hero({ heroKey: "oscilio, scion of the third age|0", board: ["chromatic refinement|1"], hand: ["meteoric impact|1"] }),
        foe(),
      ],
    });
    g.endTurn().endTurn();
    expect(ongoing(g, "chromatic refinement|1").map((effect) => effect.label)).toEqual([
      "costs 1 less to play · next red card this turn",
    ]);
    g.play("meteoric impact|1").chooseOption("opposing hero").expectLife(1, 14).expectResources(0, 0);
    expect(ongoing(g, "chromatic refinement|1")).toEqual([]);
  });
});
