import { cardData, decklists } from "@fyendal/cards";
import { describe, expect, it } from "vitest";
import { deckStyle, hitChance, MAX_HIT_CHANCE, MIN_HIT_CHANCE, type DefenderProfile } from "./hit-model.js";

const deck = (name: keyof typeof decklists) => decklists[name]!.deck;

const typical: DefenderProfile = { handCount: 4, life: 30, armor: [1], blockPropensity: 0.5, cardDefense: 3 };

describe("hit model", () => {
  it("lands a plain four-power attack near the old flat chance", () => {
    expect(hitChance(4, 0, typical)).toBeGreaterThan(0.5);
    expect(hitChance(4, 0, typical)).toBeLessThan(0.65);
  });

  it("expects armor to stop a one-power attack carrying a big on-hit", () => {
    // Bug 37AB80: Scorpio with Burn Up's 4 arcane was blocked for one point of armor.
    expect(hitChance(1, 5, typical)).toBeLessThan(0.2);
    expect(hitChance(1, 5, { ...typical, armor: [], handCount: 0 })).toBe(MAX_HIT_CHANCE);
  });

  it("blocks attacks with richer on-hits more often", () => {
    expect(hitChance(4, 4, typical)).toBeLessThan(hitChance(4, 0, typical));
  });

  it("lets a racing deck take hits a blocking deck stops", () => {
    expect(hitChance(4, 0, { ...typical, blockPropensity: 0.1 }))
      .toBeGreaterThan(hitChance(4, 0, { ...typical, blockPropensity: 0.9 }));
  });

  it("blocks more at low life and everything it can against lethal", () => {
    expect(hitChance(4, 0, { ...typical, life: 6 })).toBeLessThan(hitChance(4, 0, typical));
    // Only the chance a hidden blocker falls short remains.
    expect(hitChance(4, 0, { ...typical, life: 4 })).toBeCloseTo(0.1);
    expect(hitChance(1, 0, { ...typical, life: 1 })).toBe(MIN_HIT_CHANCE);
  });

  it("lands when the hand cannot complete a block", () => {
    expect(hitChance(7, 0, { ...typical, handCount: 1 })).toBe(MAX_HIT_CHANCE);
  });

  it("reads a racing and a blocking style from decklists", () => {
    const rhinar = deckStyle(deck("rhinar"), cardData);
    const dorinthea = deckStyle(deck("dorinthea"), cardData);
    expect(rhinar.blockPropensity).toBeLessThan(0.3);
    expect(dorinthea.blockPropensity).toBeGreaterThan(rhinar.blockPropensity);
    expect(deckStyle(undefined, cardData).blockPropensity).toBe(0.5);
  });
});
