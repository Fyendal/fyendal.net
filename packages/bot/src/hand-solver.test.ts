import { describe, expect, it } from "vitest";
import { HandSolver, type SolverCard } from "./hand-solver.js";

let nextId = 1;
function card(partial: Partial<SolverCard> & Pick<SolverCard, "kind">): SolverCard {
  const id = nextId++;
  return {
    instanceId: id,
    cardId: partial.name ?? `c${id}`,
    name: partial.name ?? `c${id}`,
    zone: "hand",
    cost: 0,
    pitch: 1,
    power: 0,
    defense: 3,
    goAgain: false,
    traits: [],
    onHit: 0,
    arsenalValue: 0,
    heldValue: 0,
    ...partial,
  };
}

const red = (power: number, extra: Partial<SolverCard> = {}) =>
  card({ kind: "attack", power, pitch: 1, name: `red${power}${extra.goAgain ? "ga" : ""}`, ...extra });
const blue = (extra: Partial<SolverCard> = {}) => card({ kind: "block", pitch: 3, name: "blue", ...extra });

describe("hand solver", () => {
  it("plays one terminal attack per action point", () => {
    const result = new HandSolver([red(6), red(5)]).solve();
    expect(result.damage).toBe(6);
    expect(result.line).toHaveLength(1);
  });

  it("chains go-again attacks before the terminal attack", () => {
    const result = new HandSolver([red(3, { goAgain: true }), red(4, { goAgain: true }), red(6)]).solve();
    expect(result.damage).toBe(13);
    expect(result.line.at(-1)?.damage).toBe(6);
  });

  it("caps a hand of reds by the resources it can actually pitch", () => {
    // Four cost-1 go-again reds pitch for one each: two attack, two pay.
    const reds = [0, 1, 2, 3].map(() => red(4, { goAgain: true, cost: 1, name: "jab" }));
    const result = new HandSolver(reds).solve();
    expect(result.damage).toBe(8);
    expect(result.line).toHaveLength(2);
  });

  it("pays a cost of three with two smaller pitch cards", () => {
    const big = red(7, { cost: 3 });
    const yellows = [card({ kind: "block", pitch: 2, name: "y" }), card({ kind: "block", pitch: 2, name: "y" })];
    const result = new HandSolver([big, ...yellows]).solve();
    expect(result.damage).toBe(7);
    expect(result.line[0]?.pitchIds).toHaveLength(2);
  });

  it("does not over-pitch and keeps the spare card's held value", () => {
    const attack = red(6, { cost: 2 });
    const spare = blue({ heldValue: 1.5, name: "keeper" });
    const pitch = blue({ name: "pitch" });
    const result = new HandSolver([attack, pitch, spare]).solve();
    expect(result.line[0]?.pitchIds).toHaveLength(1);
    expect(result.value).toBeCloseTo(6 + 1.5);
  });

  it("swings a weapon once per turn after a go-again card", () => {
    const sword = card({ kind: "weapon", zone: "weapon", power: 3, cost: 1, pitch: 0, name: "sword" });
    const result = new HandSolver([red(3, { goAgain: true }), blue(), sword]).solve();
    expect(result.damage).toBe(6);
    expect(result.line.filter((step) => step.kind === "weapon")).toHaveLength(1);
  });

  it("applies a pending pump to the next matching attack only", () => {
    const pump = card({
      kind: "action", goAgain: true, pitch: 1, name: "pump",
      after: () => ({ pending: [{ key: "pump", uses: 1, power: 3, appliesTo: (target) => target.cost <= 1 }] }),
    });
    const cheap = red(3);
    const result = new HandSolver([pump, cheap]).solve();
    expect(result.damage).toBe(6);
  });

  it("adds attack reaction power to the current attack without an action point", () => {
    const reaction = card({ kind: "attack-reaction", reactionPower: 3, pitch: 1, name: "ar" });
    const result = new HandSolver([red(5), reaction]).solve();
    expect(result.damage).toBe(8);
  });

  it("closes the reaction window once an action-speed card follows the attack", () => {
    const reaction = card({
      kind: "attack-reaction", reactionPower: 3, name: "ar", reactionTarget: (attack) => attack.name === "first",
    });
    const result = new HandSolver([red(2, { goAgain: true, name: "first" }), red(4), reaction]).solve();
    // The reaction must go on the go-again attack before the terminal attack.
    expect(result.damage).toBe(9);
    expect(result.line.map((step) => step.kind)).toEqual(["play", "react", "play"]);
  });

  it("uses an equipment go-again grant and charges its consumed value", () => {
    const trackers = card({
      kind: "equipment", zone: "equipment", speed: "action", goAgain: true, pitch: 0, consumeCost: 1,
      name: "trackers",
      after: () => ({ pending: [{ key: "agility", uses: 1, grantsGoAgain: true }] }),
    });
    const result = new HandSolver([red(6), red(6), trackers]).solve();
    expect(result.damage).toBe(12);
    expect(result.value).toBeCloseTo(11);
  });

  it("arsenals the best leftover only when the slot ends empty", () => {
    const keep = red(5, { arsenalValue: 4.5, heldValue: 0.5, name: "keep" });
    const terminal = red(7, { cost: 1 });
    const result = new HandSolver([terminal, blue(), keep]).solve();
    expect(result.arsenalInstanceId).toBe(keep.instanceId);
    expect(result.leftoverValue).toBeCloseTo(4.5);

    const occupied = red(4, { zone: "arsenal", arsenalValue: 3, name: "held" });
    const withArsenal = new HandSolver([terminal, blue(), keep, occupied]).solve();
    expect(withArsenal.arsenalInstanceId).toBeUndefined();
  });

  it("prefers arsenaling a go-again attack over a line the turn cannot fund", () => {
    const expensive = red(5, { cost: 3, goAgain: true, arsenalValue: 5, name: "expensive" });
    const result = new HandSolver([red(4), expensive]).solve();
    expect(result.damage).toBe(4);
    expect(result.arsenalInstanceId).toBe(expensive.instanceId);
  });

  it("builds a subset table whose full-hand entry matches a direct solve", () => {
    const hand = [red(3, { goAgain: true }), red(5), blue()];
    const solver = new HandSolver(hand);
    const table = solver.subsetValues(hand.map((entry) => entry.instanceId));
    expect(table.size).toBe(8);
    expect(table.get(0b111)?.value).toBeCloseTo(new HandSolver(hand).solve().value);
    expect(table.get(0)?.value).toBe(0);
    // Losing the blue (needed by nothing here) costs nothing.
    expect(table.get(0b011)?.value).toBeCloseTo(table.get(0b111)!.value);
  });

  it("honours flag-dependent go again from earlier links", () => {
    const opener = red(3, { goAgain: true, traits: ["draconic"], name: "opener" });
    const conditional = red(3, {
      traits: ["draconic"], name: "conditional",
      goAgainIn: (view) => view.flag("links:draconic") + 1 >= 2,
    });
    const finisher = red(5, { name: "finisher" });
    const result = new HandSolver([conditional, finisher, opener]).solve();
    expect(result.damage).toBe(11);
    expect(result.line.map((step) => step.instanceId)).toEqual([
      opener.instanceId, conditional.instanceId, finisher.instanceId,
    ]);
  });
});
