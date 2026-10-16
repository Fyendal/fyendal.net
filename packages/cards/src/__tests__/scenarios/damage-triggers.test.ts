import { describe, expect, it } from "vitest";
import { cardData } from "../../index.js";
import { printingId, scenario, type SeatSpec } from "../harness.js";

const BLUE = "raging onslaught|3";
const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function seat(spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, ...spec };
}

function foe(spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero: "dorinthea", weapons: [], hand: [], equipment: NO_EQUIPMENT, ...spec };
}

type Game = ReturnType<typeof scenario>;

function triggerLayer(g: Game, key: string) {
  const id = printingId(key);
  return g.state.stack.find((layer) => layer.triggerSource?.cardId === id);
}

/** Pass priority until `key`'s damage trigger is on the stack, unresolved. */
function passUntilTrigger(g: Game, key: string): void {
  for (let guard = 0; guard < 12 && !triggerLayer(g, key); guard++) g.passPriority();
  expect(triggerLayer(g, key), `${key} trigger on the stack`).toBeDefined();
}

function named(g: Game, seatIndex: number, name: string): number {
  return g.state.players[seatIndex]!.board.filter((card) => cardData[card.cardId]?.name === name).length;
}

describe("damage-dealt triggers use the stack", () => {
  it("Talisman of Warfare triggers on exactly 2 damage to an opposing hero", () => {
    const g = scenario({
      seats: [
        seat({ board: ["talisman of warfare|2"], hand: ["wounding blow|3"], arsenal: ["snatch|1"] }),
        foe({ arsenal: ["snatch|1"] }),
      ],
    });

    g.play("wounding blow|3").blockWith();
    passUntilTrigger(g, "talisman of warfare|2");
    g.expectLife(1, 18).expectInZone(0, "talisman of warfare|2", "board");
    g.settle()
      .expectInZone(0, "talisman of warfare|2", "graveyard")
      .expectZoneSize(0, "arsenal", 0)
      .expectZoneSize(1, "arsenal", 0);
  });

  it("Talisman of Warfare ignores damage other than exactly 2", () => {
    const g = scenario({
      seats: [seat({ board: ["talisman of warfare|2"], hand: ["wounding blow|1"] }), foe({ arsenal: ["snatch|1"] })],
    });

    g.play("wounding blow|1").blockWith().settle().expectLife(1, 16);
    g.expectInZone(0, "talisman of warfare|2", "board").expectZoneSize(1, "arsenal", 1);
  });

  it("Ode to Wrath makes the damaged opponent lose life after arcane damage", () => {
    const g = scenario({ seats: [seat({ board: ["ode to wrath|2"], hand: ["zap|1"] }), foe()] });

    g.play("zap|1").chooseOption("opposing hero").settle().expectLife(1, 16).expectLog("Ode to Wrath triggers");
  });

  it("Ley Line of the Old Ones creates a Seismic Surge whenever you deal damage", () => {
    const g = scenario({ seats: [seat({ board: ["ley line of the old ones|3"], hand: ["zap|1"] }), foe()] });

    g.play("zap|1").chooseOption("opposing hero").settle();
    expect(named(g, 0, "Seismic Surge")).toBe(1);
  });

  it("Ring of Roses gains life only for the turn's first arcane damage", () => {
    const g = scenario({ seats: [seat({ board: ["ring of roses|2"], hand: ["zap|1", "zap|2"] }), foe()] });
    g.state.players[0]!.actionPoints = 2;

    g.play("zap|1").chooseOption("opposing hero").settle().expectLife(0, 21);
    g.play("zap|2").chooseOption("opposing hero").settle().expectLife(0, 21).expectLife(1, 15);
  });

  it("Talk a Big Game creates Might for the chosen amount of physical damage", () => {
    const g = scenario({ seats: [seat({ hand: ["talk a big game|3", "wounding blow|1"] }), foe()] });

    g.play("talk a big game|3").chooseOption("4");
    g.play("wounding blow|1").blockWith();
    passUntilTrigger(g, "talk a big game|3");
    expect(named(g, 0, "Might")).toBe(0);
    g.settle();
    expect(named(g, 0, "Might")).toBe(4);
  });

  it("Talk a Big Game does not trigger below the chosen number", () => {
    const g = scenario({ seats: [seat({ hand: ["talk a big game|3", "wounding blow|1"] }), foe()] });

    g.play("talk a big game|3").chooseOption("5");
    g.play("wounding blow|1").blockWith().settle().expectLife(1, 16);
    expect(named(g, 0, "Might")).toBe(0);
  });

  it("Leech Vitality's rider gains life as a triggered layer", () => {
    const g = scenario({ seats: [seat({ hand: ["leech vitality|1", "wounding blow|1", BLUE] }), foe()] });

    g.play("leech vitality|1", { pitch: [BLUE] });
    g.play("wounding blow|1").blockWith();
    passUntilTrigger(g, "leech vitality|1");
    g.expectLife(0, 20);
    g.settle().expectLife(0, 21).expectLife(1, 13);
  });

  it("Leech Renown's rider destroys an aura token the damaged hero controls", () => {
    const g = scenario({
      seats: [seat({ hand: ["leech renown|1", "wounding blow|1", BLUE] }), foe({ board: ["runechant|0"] })],
    });

    g.play("leech renown|1", { pitch: [BLUE] });
    g.play("wounding blow|1").blockWith().settle().chooseCard("runechant|0");
    g.expectZoneSize(1, "board", 0);
  });

  it("Leech Memory's rider puts a graveyard attack on the bottom of your deck", () => {
    const g = scenario({
      seats: [seat({ hand: ["leech memory|1", "wounding blow|1", BLUE], graveyard: ["snatch|1"] }), foe()],
    });

    g.play("leech memory|1", { pitch: [BLUE] });
    g.play("wounding blow|1").blockWith().settle().chooseCard("snatch|1");
    g.expectDeckBottom(0, "snatch|1");
  });

  it("Bloodspill Invocation is destroyed by a trigger when your hero is dealt damage", () => {
    const g = scenario({
      active: 1,
      seats: [seat({ board: ["bloodspill invocation|1"], hand: [] }), foe({ hand: ["wounding blow|1"] })],
    });

    g.play("wounding blow|1").blockWith();
    passUntilTrigger(g, "bloodspill invocation|1");
    g.expectLife(0, 16).expectInZone(0, "bloodspill invocation|1", "board");
    g.settle().expectInZone(0, "bloodspill invocation|1", "graveyard");
  });

  it("Arcanic Reproach answers only the first damage an opposing hero deals each turn", () => {
    const g = scenario({
      active: 1,
      seats: [
        seat({ board: ["arcanic reproach|3"], hand: ["lightning surge|1"] }),
        foe({ hand: ["zap|1", "zap|2"] }),
      ],
    });
    g.state.players[1]!.actionPoints = 2;

    g.play("zap|1").chooseOption("opposing hero").chooseCard("lightning surge|1");
    g.expectLife(0, 17).expectLife(1, 19);
    g.play("zap|2").chooseOption("opposing hero").settle();
    g.expectLife(0, 15).expectLife(1, 19);
    expect(g.state.pendingDecision).toBeNull();
  });

  it("Suraya, Archangel of Knowledge gains life equal to the damage she deals", () => {
    const g = scenario({ seats: [seat({ board: ["suraya, archangel of knowledge|0"] }), foe()] });

    g.activate("suraya, archangel of knowledge|0").blockWith();
    passUntilTrigger(g, "suraya, archangel of knowledge|0");
    g.expectLife(1, 16).expectLife(0, 20);
    g.settle().expectLife(0, 24);
  });

  it("Caress of the Reaper destroys a chosen aura the damaged hero controls", () => {
    const g = scenario({
      seats: [seat({ hand: ["caress of the reaper|1", BLUE] }), foe({ board: ["runechant|0", "runechant|0"] })],
    });

    g.play("caress of the reaper|1", { pitch: [BLUE] }).blockWith().settle().chooseCard("runechant|0");
    g.expectLife(1, 15).expectZoneSize(1, "board", 1);
  });

  it("Tempestuous Kiss makes the damaged hero discard once", () => {
    const g = scenario({
      seats: [seat({ hand: ["tempestuous kiss|1", BLUE] }), foe({ hand: ["snatch|1", "snatch|2"] })],
    });

    g.play("tempestuous kiss|1", { pitch: [BLUE] }).blockWith().settle().chooseCard("snatch|1");
    g.expectLife(1, 15).expectZoneSize(1, "hand", 1);
    expect(g.state.pendingDecision).toBeNull();
  });

  it("Cryptic Crossing's mixed-pitch rider discards and draws on its first damage", () => {
    const g = scenario({
      seats: [
        seat({ hand: ["cryptic crossing|2", "wounding blow|1", "nimblism|2"], deck: [BLUE] }),
        foe({ hand: ["snatch|1"] }),
      ],
    });

    g.play("cryptic crossing|2", { pitch: ["wounding blow|1", "nimblism|2"] }).blockWith().settle();
    g.chooseCard("snatch|1").expectLife(1, 14).expectZoneSize(1, "hand", 0).expectHandSize(0, 1);
  });

  it("Quickstrike's first-damage trigger fires once for arcane then combat damage", () => {
    const g = scenario({
      seats: [
        seat({
          heroKey: "aurora, emissary of lightning|0",
          hand: ["quick succession|3", "singeing flowstride|1", BLUE],
        }),
        foe(),
      ],
    });

    g.play("quick succession|3").play("singeing flowstride|1", { pitch: [BLUE] }).expectLife(1, 19);
    expect(named(g, 0, "Lightning Flow")).toBe(1);
    g.blockWith().settle();
    expect(g.state.players[1]!.life).toBeLessThan(19);
    expect(named(g, 0, "Lightning Flow")).toBe(1);
  });

  it("Stunning Swipe triggers only for damage to a Lightning hero", () => {
    const lightning = scenario({
      seats: [seat({ hand: ["stunning swipe|1"] }), foe({ heroKey: "aurora, emissary of lightning|0" })],
    });
    lightning.play("stunning swipe|1").blockWith().settle().chooseCard("aurora, emissary of lightning|0");
    expect(lightning.state.players[1]!.hero.tapped).toBe(true);

    const other = scenario({ seats: [seat({ hand: ["stunning swipe|1"] }), foe()] });
    other.play("stunning swipe|1").blockWith().settle().expectLife(1, 17);
    expect(other.state.pendingDecision).toBeNull();
    expect(other.state.players[1]!.hero.tapped).not.toBe(true);
  });

  it("Mercurial Skies' rider destroys a Lightning Flow for arcane damage on the first hit", () => {
    const g = scenario({
      seats: [seat({ hand: ["mercurial skies|1", "lightning surge|1"], board: ["lightning flow|0"] }), foe()],
    });

    g.play("mercurial skies|1").play("lightning surge|1").blockWith().settle().chooseCard("lightning flow|0");
    g.expectLife(1, 13);
    expect(named(g, 0, "Lightning Flow")).toBe(0);
  });

  it("fused Explosive Growth triggers for its arcane damage and its combat damage", () => {
    const g = scenario({
      seats: [seat({ hand: ["explosive growth|1", "sow tomorrow|3", BLUE] }), foe()],
    });

    g.play("explosive growth|1", { pitch: [BLUE] }).chooseCard("sow tomorrow|3");
    expect(g.stackLabels()[0]).toBe("Deal 1 arcane damage to target hero");
    g.declareTarget(1).expectLife(1, 19).expectAttackValue(4);
    g.blockWith().settle().expectLife(1, 15);
  });

  it("unfused Explosive Growth does not trigger", () => {
    const g = scenario({ seats: [seat({ hand: ["explosive growth|1", BLUE] }), foe()] });

    g.play("explosive growth|1", { pitch: [BLUE] }).declareTarget(1).expectLife(1, 19).expectAttackValue(3);
  });

  it("Staff of Verdant Shoots creates Embodiment of Earth on the next arcane damage", () => {
    const g = scenario({
      seats: [seat({ weapons: ["staff of verdant shoots|0"], hand: ["sow tomorrow|3", "zap|1", "zap|2"] }), foe()],
    });
    g.state.players[0]!.actionPoints = 2;

    g.activate("staff of verdant shoots|0", { pitch: ["sow tomorrow|3"] });
    g.play("zap|1").chooseOption("opposing hero").settle();
    expect(named(g, 0, "Embodiment of Earth")).toBe(1);
    g.play("zap|2").chooseOption("opposing hero").settle();
    expect(named(g, 0, "Embodiment of Earth")).toBe(1);
  });

  it("Conduit of Frostburn's granted trigger destroys a frozen arsenal card", () => {
    const g = scenario({
      seats: [
        seat({ equipment: { ...NO_EQUIPMENT, arms: "conduit of frostburn|0" }, hand: ["zap|1"] }),
        foe({ arsenal: ["snatch|1"] }),
      ],
    });
    g.state.players[1]!.arsenal[0]!.counters = { frozenUntilTurn: 99 };

    g.activate("conduit of frostburn|0");
    g.play("zap|1").chooseOption("opposing hero").settle().expectLife(1, 17).expectZoneSize(1, "arsenal", 0);
  });

  it("Nekria triggers when she is dealt damage", () => {
    const g = scenario({
      active: 1,
      seats: [seat({ board: ["nekria|0"], hand: [] }), foe({ hand: ["wounding blow|1"] })],
    });

    g.play("wounding blow|1", { targetAlly: "nekria|0" });
    if (g.state.pendingDecision?.kind === "defend") g.blockWith();
    g.settle();
    const nekria = g.state.players[0]!.board.find((card) => card.cardId === printingId("nekria|0"));
    expect(nekria?.life).toBe(2);
    expect(named(g, 0, "Ash")).toBe(1);
  });

  it("Arcane Cussing is destroyed by a trigger when you are dealt damage", () => {
    const g = scenario({
      active: 1,
      seats: [seat({ board: ["arcane cussing|1"], hand: [] }), foe({ hand: ["wounding blow|1"] })],
    });

    g.play("wounding blow|1").blockWith();
    passUntilTrigger(g, "arcane cussing|1");
    g.settle().expectInZone(0, "arcane cussing|1", "graveyard").expectZoneSize(0, "board", 0);
  });
});
