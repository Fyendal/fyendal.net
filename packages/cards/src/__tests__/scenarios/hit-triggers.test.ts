import { describe, expect, it } from "vitest";
import { cardData } from "../../index.js";
import { printingId, scenario, type SeatSpec } from "../harness.js";

const BLUE = "raging onslaught|3";
const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function seat(spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero: "rhinar", weapons: [], ...spec, equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) } };
}

function foe(spec: Partial<SeatSpec> = {}): SeatSpec {
  return {
    hero: "dorinthea",
    weapons: [],
    hand: [],
    ...spec,
    equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) },
  };
}

type Game = ReturnType<typeof scenario>;

function hitLayer(g: Game, key: string) {
  const id = printingId(key);
  return g.state.stack.find(
    (layer) => layer.engineEffect?.kind === "on-hit-hook" && layer.engineEffect.source.cardId === id,
  );
}

/** Pass priority until `key`'s on-hit trigger is on the stack, unresolved. */
function passUntilHitTrigger(g: Game, key: string): void {
  for (let guard = 0; guard < 12 && !hitLayer(g, key); guard++) g.passPriority();
  expect(hitLayer(g, key), `${key} on-hit trigger on the stack`).toBeDefined();
}

function named(g: Game, seatIndex: number, name: string): number {
  return g.state.players[seatIndex]!.board.filter((card) => cardData[card.cardId]?.name === name).length;
}

describe("friendly hit observers use on-hit layers", () => {
  it("Aether Crackers may destroy itself to deal arcane damage to the hit hero", () => {
    const g = scenario({
      seats: [seat({ equipment: { arms: "aether crackers|0" }, hand: ["wounding blow|1"] }), foe()],
    });

    g.play("wounding blow|1").blockWith();
    passUntilHitTrigger(g, "aether crackers|0");
    g.expectLife(1, 16).expectEquipped(0, "arms", "aether crackers|0");
    g.settle().chooseOption("yes").expectLife(1, 15).expectNoEquipment(0, "arms");
  });

  it("Cutting Couriers gives the hitting sword attack go again", () => {
    const g = scenario({
      seats: [seat({ weapons: ["dawnblade|0"], equipment: { legs: "cutting couriers|0" }, resources: 1 }), foe()],
    });

    g.attackWithWeapon().blockWith();
    passUntilHitTrigger(g, "cutting couriers|0");
    g.settle().chooseOption("yes").expectNoEquipment(0, "legs").expectAP(0, 1);
  });

  it("Squire's Bracers buffs the sword's next attack after a hit", () => {
    const g = scenario({
      seats: [seat({ weapons: ["dawnblade|0"], equipment: { arms: "squire's bracers|0" }, resources: 1 }), foe()],
    });

    g.attackWithWeapon().blockWith().settle().chooseOption("yes").expectNoEquipment(0, "arms");
    expect(g.state.modifiers).toContainEqual(expect.objectContaining({ attack: 2, appliesTo: "sword" }));
  });

  it("Anticipating Gaze trades a sword's +1 counter for a card", () => {
    const g = scenario({
      seats: [
        seat({ weapons: ["dawnblade|0"], equipment: { head: "anticipating gaze|0" }, resources: 1, deck: [BLUE] }),
        foe(),
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 1 };

    g.attackWithWeapon().blockWith().settle().chooseOption("yes");
    g.expectNoEquipment(0, "head").expectHandSize(0, 1);
    expect(g.state.players[0]!.weapons[0]!.counters?.power ?? 0).toBe(0);
  });

  it("Anticipating Gaze does not trigger without a +1 counter on the sword", () => {
    const g = scenario({
      seats: [seat({ weapons: ["dawnblade|0"], equipment: { head: "anticipating gaze|0" }, resources: 1 }), foe()],
    });

    g.attackWithWeapon().blockWith().settle();
    expect(g.state.pendingDecision).toBeNull();
    g.expectEquipped(0, "head", "anticipating gaze|0");
  });

  it("Tick Tock Clock destroys itself and up to 2 chosen items, then deals that much damage", () => {
    const g = scenario({
      seats: [
        seat({ board: ["tick tock clock|1", "energy potion|3", "energy potion|3"], hand: ["sky skimmer|1"] }),
        foe({ board: ["energy potion|3"] }),
      ],
    });
    const [, mine] = g.state.players[0]!.board;
    const theirs = g.state.players[1]!.board[0]!;

    g.play("sky skimmer|1").blockWith();
    passUntilHitTrigger(g, "tick tock clock|1");
    g.settle();
    const pd = g.state.pendingDecision!;
    expect(pd.chooseHook).toBe("tick-tock-item");
    expect([pd.minimumSelections, pd.maximumSelections]).toEqual([0, 2]);
    expect(pd.options).toHaveLength(3);

    g.chooseMany([String(mine!.instanceId), String(theirs.instanceId)])
      .expectLife(1, 13)
      .expectZoneSize(0, "board", 1)
      .expectZoneSize(1, "board", 0);
  });

  it("Tick Tock Clock may destroy no other items and still deals damage for itself", () => {
    const g = scenario({
      seats: [seat({ board: ["tick tock clock|1", "energy potion|3"], hand: ["sky skimmer|1"] }), foe()],
    });

    g.play("sky skimmer|1").blockWith();
    passUntilHitTrigger(g, "tick tock clock|1");
    g.settle().chooseMany([]).expectLife(1, 15).expectZoneSize(0, "board", 1);
  });

  it("Autosave Script puts the hitting Mechanologist attack on the bottom of the deck", () => {
    const g = scenario({
      seats: [seat({ board: ["autosave script|3"], hand: ["sky skimmer|1"], deck: [BLUE] }), foe()],
    });

    g.play("sky skimmer|1").blockWith();
    passUntilHitTrigger(g, "autosave script|3");
    g.settle().expectDeckBottom(0, "sky skimmer|1");
  });
});

describe("Concealed traps trigger when an attack hits you", () => {
  function concealed(attack: string): Game {
    const g = scenario({
      active: 1,
      seats: [seat({ equipment: { chest: "concealed nerve gas|0" }, hand: [] }), foe({ hand: [attack] })],
    });
    g.state.players[0]!.equipment.chest!.faceDown = true;
    return g;
  }

  it("Concealed Nerve Gas answers a go-again attack anonymously", () => {
    const g = concealed("head jab|1");

    g.play("head jab|1").blockWith().settle();
    g.expectLog("face-down card triggers").expectNoLog("Concealed Nerve Gas triggers").expectNoEquipment(0, "chest");
    expect(named(g, 1, "Frailty")).toBe(1);
  });

  it("Concealed Nerve Gas ignores an attack without go again", () => {
    const g = concealed("wounding blow|1");

    g.play("wounding blow|1").blockWith().settle().expectLife(0, 16);
    expect(named(g, 1, "Frailty")).toBe(0);
    expect(g.state.players[0]!.equipment.chest?.faceDown).toBe(true);
  });

  function pathogen(hand: string[]): Game {
    const g = scenario({
      active: 1,
      seats: [seat({ equipment: { chest: "concealed pathogen|0" }, hand: [] }), foe({ hand })],
    });
    g.state.players[0]!.equipment.chest!.faceDown = true;
    return g;
  }

  it("Concealed Pathogen answers a hit after its controller played an attack reaction", () => {
    const g = pathogen(["wounding blow|1", "razor reflex|1", "raging onslaught|2"]);

    g.play("wounding blow|1").blockWith().react("razor reflex|1", { pitch: ["raging onslaught|2"] }).settle();
    g.expectLog("face-down card triggers").expectNoEquipment(0, "chest");
    expect(named(g, 1, "Bloodrot Pox")).toBe(1);
  });

  it("Concealed Pathogen ignores a hit without an attack reaction", () => {
    const g = pathogen(["wounding blow|1"]);

    g.play("wounding blow|1").blockWith().settle().expectLife(0, 16);
    expect(named(g, 1, "Bloodrot Pox")).toBe(0);
    expect(g.state.players[0]!.equipment.chest?.faceDown).toBe(true);
  });
});
