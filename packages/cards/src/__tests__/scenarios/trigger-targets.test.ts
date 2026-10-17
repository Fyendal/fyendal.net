import { describe, expect, it } from "vitest";
import { printingId, scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

type Game = ReturnType<typeof scenario>;

/** The trigger's target is being declared: its layer is on the stack and no
 * player holds priority yet (CR 6.6.6a). */
function expectDeclaring(g: Game, label: string, targets: readonly (number | string)[]): void {
  expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
  expect(g.stackLabels()[0]).toBe(label);
  expect(g.state.pendingDecision?.options).toEqual(targets.map(String));
}

function heroId(g: Game, seat: number): number {
  return g.state.players[seat]!.hero.instanceId;
}

function instanceIds(g: Game, seat: number, zone: "board" | "weapons", key: string): number[] {
  const id = printingId(key);
  return g.state.players[seat]![zone].filter((card) => card.cardId === id).map((card) => card.instanceId);
}

describe("triggered abilities declare their targets before priority", () => {
  it("Caress of the Reaper declares an aura the damaged hero controls", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, hand: ["caress of the reaper|1", "raging onslaught|3"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT, board: ["runechant|0", "runechant|0"] },
      ],
    });

    g.play("caress of the reaper|1", { pitch: ["raging onslaught|3"] }).blockWith().settle();
    expectDeclaring(g, "Destroy target aura the damaged hero controls", instanceIds(g, 1, "board", "runechant|0"));
    g.declareTarget("runechant|0").expectLife(1, 15).expectZoneSize(1, "board", 1);
  });

  it("Caress of the Reaper's trigger ceases to exist when the damaged hero controls no aura", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, hand: ["caress of the reaper|1", "raging onslaught|3"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("caress of the reaper|1", { pitch: ["raging onslaught|3"] }).blockWith().settle();
    expect(g.state.pendingDecision?.chooseHook).not.toBe("trigger-target");
    g.expectLog("has no legal target").expectLife(1, 15);
  });

  it("Core Reaction declares any target, including an ally, as its start-of-action-phase trigger is added", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", board: ["core reaction|1"] },
        { hero: "dorinthea", board: ["barnacle|2"] },
      ],
    });

    g.endTurn();
    expectDeclaring(g, "Core Reaction", [
      heroId(g, 0),
      heroId(g, 1),
      ...instanceIds(g, 1, "board", "barnacle|2"),
    ]);
    g.declareTarget(1).expectLife(1, 16).expectNotInZone(0, "core reaction|1", "board");
  });

  it("Aether Slash declares its arcane damage target when it attacks", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, hand: ["aether slash|1", "tome of fyendal|2"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("aether slash|1", { pitch: ["tome of fyendal|2"] });
    expectDeclaring(g, "Deal 1 arcane damage to any target", [heroId(g, 0), heroId(g, 1)]);
    g.declareTarget(1).expectLife(1, 19);
  });

  it("Searing Touch declares its damage target when it attacks as chain link 4", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: [],
          equipment: NO_EQUIPMENT,
          resources: 1,
          hand: ["wounding blow|1", "wounding blow|2", "wounding blow|3", "searing touch|1"],
        },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.actionPoints = 4;

    g.play("wounding blow|1").blockWith().settle()
      .play("wounding blow|2").blockWith().settle()
      .play("wounding blow|3").blockWith().settle()
      .play("searing touch|1");
    expectDeclaring(g, "Deal 2 damage to any target", [heroId(g, 0), heroId(g, 1)]);
    const life = g.state.players[1]!.life;
    g.declareTarget(1).expectLife(1, life - 2);
  });

  it("Fist Pump declares a wrench when a Hyper Driver is banished from boosting", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["banksy|0"],
          equipment: { ...NO_EQUIPMENT, arms: "fist pump|0" },
          hand: ["zero to sixty|1"],
          deck: ["hyper driver|1", "raging onslaught|1"],
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("zero to sixty|1", { boost: true });
    expectDeclaring(
      g,
      "Target wrench you control gets +1 power this turn",
      instanceIds(g, 0, "weapons", "banksy|0"),
    );
    g.declareTarget("banksy|0");
    expect(g.state.players[0]!.weapons[0]!.tempPower).toBe(1);
  });

  it("Hurl declares its dagger as the paid attack trigger goes on the stack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["hurl|1"], weapons: ["spider's bite|0"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("hurl|1").chooseOption("pay");
    expectDeclaring(
      g,
      "Target dagger you control deals 1 damage to the opposing hero, then destroy it",
      instanceIds(g, 0, "weapons", "spider's bite|0"),
    );
    g.declareTarget("spider's bite|0").expectLife(1, 19);
    expect(g.state.players[0]!.weapons).toHaveLength(0);
  });

  it("Burning Blade Dance may declare a dagger as its on-hit layer is added", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          weapons: ["spider's bite|0"],
          equipment: NO_EQUIPMENT,
          hand: ["searing touch|1", "burning blade dance|1"],
        },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.actionPoints = 2;

    g.play("searing touch|1").blockWith().settle().play("burning blade dance|1").blockWith().settle();
    expectDeclaring(g, "On hit", ["pass", ...instanceIds(g, 0, "weapons", "spider's bite|0")]);
    const life = g.state.players[1]!.life;
    g.declareTarget("spider's bite|0").expectLife(1, life - 1);
    expect(g.state.players[0]!.weapons).toHaveLength(0);
  });

  it("Pain in the Backside declares its dagger as its on-hit layer is added", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["spider's bite|0"], equipment: NO_EQUIPMENT, hand: ["pain in the backside|1"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("pain in the backside|1").blockWith().settle();
    expectDeclaring(g, "On hit", instanceIds(g, 0, "weapons", "spider's bite|0"));
    const life = g.state.players[1]!.life;
    g.declareTarget("spider's bite|0").expectLife(1, life - 1);
  });

  it("Pain in the Backside may declare a dagger attack card on an earlier chain link", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["spider's bite|0"],
          equipment: NO_EQUIPMENT,
          hand: ["kiss of death|1", "pain in the backside|1"],
        },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });
    g.state.players[0]!.actionPoints = 2;

    g.play("kiss of death|1").blockWith().settle();
    const kissId = g.state.chain[0]!.attackingCard.instanceId;
    g.play("pain in the backside|1").blockWith().settle();
    expectDeclaring(g, "On hit", [...instanceIds(g, 0, "weapons", "spider's bite|0"), kissId]);
    const life = g.state.players[1]!.life;
    // One damage from Kiss of Death, which has hit and makes the hero lose 1{h}.
    g.declareTarget(String(kissId)).settle().expectLife(1, life - 2);
  });

  it("Runic Reclamation declares an aura the hit hero controls", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, weapons: [], equipment: NO_EQUIPMENT, hand: ["runic reclamation|1"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT, board: ["runechant|0", "runechant|0"] },
      ],
    });

    g.play("runic reclamation|1").blockWith().settle();
    expectDeclaring(g, "On hit", instanceIds(g, 1, "board", "runechant|0"));
    g.declareTarget(String(instanceIds(g, 1, "board", "runechant|0")[0]));
    expect(g.state.players[1]!.board).toHaveLength(1);
    expect(g.state.players[0]!.board).toHaveLength(1);
  });

  it("Bloodsong Gloomblade may decline to declare an aura", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, hand: ["bloodsong gloomblade|1"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT, board: ["runechant|0"] },
      ],
    });

    g.play("bloodsong gloomblade|1").blockWith().settle();
    expectDeclaring(g, "On hit", ["pass", ...instanceIds(g, 1, "board", "runechant|0")]);
    g.declareTarget("pass");
    expect(g.state.players[1]!.board).toHaveLength(1);
  });

  it("Mangle declares equipment with a -1 defense counter the hit hero controls", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 4, weapons: [], equipment: NO_EQUIPMENT, hand: ["mangle|1"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: { ...NO_EQUIPMENT, head: "fyendal's spring tunic|0" } },
      ],
    });
    const tunic = g.state.players[1]!.equipment.head!;
    tunic.defCounters = 1;

    g.play("mangle|1").blockWith().settle();
    expectDeclaring(g, "On hit", [tunic.instanceId]);
    g.declareTarget(String(tunic.instanceId));
    expect(g.state.players[1]!.equipment.head).toBeUndefined();
  });

  it("Blow for a Blow declares any target as its on-hit layer is added", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 2, weapons: [], equipment: NO_EQUIPMENT, hand: ["blow for a blow|1"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("blow for a blow|1").blockWith().settle();
    expectDeclaring(g, "On hit", [heroId(g, 0), heroId(g, 1)]);
    const life = g.state.players[0]!.life;
    g.declareTarget(0).expectLife(0, life - 1);
  });
});

describe("target-hero triggers declare their hero before priority", () => {
  const BLUE = "raging onslaught|3";

  it("Singeing Steelblade may declare its own controller's hero", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, hand: ["singeing steelblade|1", BLUE] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("singeing steelblade|1", { pitch: [BLUE] });
    expectDeclaring(g, "Deal 1 arcane damage to target hero", [heroId(g, 0), heroId(g, 1)]);
    g.declareTarget(0).expectLife(0, 19).expectLife(1, 20);
  });

  it("Bramble Spark's granted attack trigger declares its target hero", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, resources: 1, hand: ["bramble spark|1", "singeing steelblade|1"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("bramble spark|1").play("singeing steelblade|1");
    expect(g.stackLabels()).toEqual(["Deal 1 arcane damage to target hero", "Deal 1 arcane damage to target hero"]);
    g.declareTarget(1).declareTarget(1).expectLife(1, 18);
  });

  it("Seeds of Agony's granted attack trigger declares its target hero", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, hand: ["seeds of agony|1", "stinging sprite|1"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("seeds of agony|1").play("stinging sprite|1");
    expect(g.stackLabels()).toEqual(["Deal 1 arcane damage to target hero", "Deal 1 arcane damage to target hero"]);
    g.declareTarget(1).declareTarget(1).expectLife(1, 18);
  });

  it("Sting of Sorcery declares a target hero for each attack action", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, hand: ["sting of sorcery|3", "head jab|1"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("sting of sorcery|3").play("head jab|1");
    expectDeclaring(g, "Deal 1 arcane damage to target hero", [heroId(g, 0), heroId(g, 1)]);
    g.declareTarget(1).expectLife(1, 19);
  });

  it("Stinging Sprite declares a target hero when it defends", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, hand: ["head jab|1"] },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT, hand: ["stinging sprite|1"] },
      ],
    });

    g.play("head jab|1").blockWith("stinging sprite|1").settle();
    expectDeclaring(g, "When this defends", [heroId(g, 0), heroId(g, 1)]);
    g.declareTarget(0).expectLife(0, 19);
  });

  it("Dimenxxional Crossroads declares a target hero when a card is played from banish", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: [],
          equipment: NO_EQUIPMENT,
          board: ["dimenxxional crossroads|2"],
          banish: ["seeds of agony|1"],
        },
        { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("seeds of agony|1", { fromZone: "banish" });
    expectDeclaring(g, "Deal 1 arcane damage to target hero", [heroId(g, 0), heroId(g, 1)]);
    g.declareTarget(1).expectLife(1, 19);
  });

  it("Blessing of Patience declares the hero that gains life as its start-of-turn trigger is added", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", life: 10, board: ["blessing of patience|1"] },
        { hero: "dorinthea", life: 10 },
      ],
    });

    g.endTurn();
    expectDeclaring(g, "Destroy this Blessing", [heroId(g, 0), heroId(g, 1)]);
    g.declareTarget(1).expectLife(1, 13).expectLife(0, 10);
  });

  it("Wayfinder's Crest declares the hero whose deck top it looks at", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, hand: ["head jab|1"] },
        { hero: "dorinthea", weapons: [], hand: [], equipment: { ...NO_EQUIPMENT, head: "wayfinder's crest|0" } },
      ],
    });

    g.play("head jab|1").blockWith("wayfinder's crest|0").settle();
    expectDeclaring(g, "When this defends", [heroId(g, 0), heroId(g, 1)]);
    g.declareTarget(0);
  });

  it("Turn Heads may only declare a Brute hero", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", heroKey: "pleiades, superstar|0", board: ["turn heads|3", "in the palm of your hand|1"] },
        { hero: "rhinar" },
      ],
    });
    for (const card of g.state.players[0]!.board) card.counters = { suspense: 1 };

    g.activate("pleiades, superstar|0", { settle: false });
    const turnHeads = g.state.players[0]!.board.find((card) => card.cardId === printingId("turn heads|3"))!;
    g.doRaw({ kind: "choose", optionId: String(turnHeads.instanceId) });
    expectDeclaring(g, "Tap the Brute hero", [heroId(g, 1)]);
    g.declareTarget(1);
    expect(g.state.players[1]!.hero.tapped).toBe(true);
  });

  it("Nettling Shot may declare an untapped ally as it is loaded face up", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "azalea, ace in the hole|0",
          weapons: ["death dealer|0"],
          equipment: NO_EQUIPMENT,
          hand: ["nettling shot|1", "wounding blow|1"],
          deck: ["raging onslaught|3"],
        },
        { hero: "rhinar", hand: [], board: ["aether ashwing|0"] },
      ],
    });

    g.activate("death dealer|0", { pitch: ["wounding blow|1"] }).chooseCard("nettling shot|1");
    expectDeclaring(g, "When put face up into arsenal", ["pass", ...instanceIds(g, 1, "board", "aether ashwing|0")]);
    g.declareTarget("aether ashwing|0");
    expect(g.state.players[1]!.board[0]!.tapped).toBe(true);
  });
});

