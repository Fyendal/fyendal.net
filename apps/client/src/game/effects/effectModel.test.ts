import type { OngoingEffectView } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { effectLifetime, effectImposed, splitByPlacement, stackOngoingEffects } from "./effectModel.js";

const effect = (overrides: Partial<OngoingEffectView>): OngoingEffectView => ({
  seat: 0,
  cardId: "WTR160",
  label: "+1 attack · next attack",
  ...overrides,
});

describe("stackOngoingEffects", () => {
  it("collapses only effects with the same seat, card, label, and source", () => {
    const effects = [
      effect({}),
      effect({}),
      effect({ label: "Go again · next attack" }),
      effect({ cardId: "WTR161" }),
      effect({ seat: 1 }),
      effect({ sourceSeat: 1 }),
    ];

    expect(stackOngoingEffects(effects).map(({ effect: e, count }) => ({ e, count }))).toEqual([
      { e: effects[0], count: 2 },
      { e: effects[2], count: 1 },
      { e: effects[3], count: 1 },
      { e: effects[4], count: 1 },
      { e: effects[5], count: 1 },
    ]);
  });
});

describe("effectLifetime", () => {
  it("prefers the projected lifetime", () => {
    expect(effectLifetime(effect({ lifetime: "game", label: "x · this turn" }))).toBe("game");
  });

  it("infers a lifetime from legacy labels", () => {
    expect(effectLifetime(effect({ label: "+1 attack · next attack" }))).toBe("once");
    expect(effectLifetime(effect({ label: "x · next red action card" }))).toBe("once");
    expect(effectLifetime(effect({ label: "x · this combat chain" }))).toBe("chain");
    expect(effectLifetime(effect({ label: "x · this turn" }))).toBe("turn");
    expect(effectLifetime(effect({ label: "x · next turn" }))).toBe("later");
    expect(effectLifetime(effect({ label: "x · next action phase" }))).toBe("later");
    expect(effectLifetime(effect({ label: "no duration" }))).toBe("turn");
  });
});

describe("effect placement", () => {
  it("pins rest-of-game effects to the hero and orders the slot by lifetime", () => {
    const later = effect({ label: "a · next turn", lifetime: "later" });
    const once = effect({ label: "b · next attack", lifetime: "once" });
    const game = effect({ label: "c · rest of the game", lifetime: "game", sourceSeat: 1 });

    const { slot, pins } = splitByPlacement([later, game, once]);
    expect(slot.map((stack) => stack.effect)).toEqual([once, later]);
    expect(pins.map((stack) => stack.effect)).toEqual([game]);
    expect(effectImposed(game)).toBe(true);
    expect(effectImposed(once)).toBe(false);
  });
});
