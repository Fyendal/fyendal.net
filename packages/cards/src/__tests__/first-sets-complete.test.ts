import { describe, expect, it } from "vitest";
import { cardData, isImplemented } from "../index.js";
import { functionalKeyOf } from "../functional.js";

describe("complete first three sets", () => {
  it.each([
    ["WTR", 226],
    ["ARC", 219],
    ["CRU", 198],
  ] as const)("registers every %s printing as implemented", (set, count) => {
    const cards = Object.values(cardData).filter((card) => card.set === set);
    expect(cards).toHaveLength(count);
    const missing = cards.filter((card) => !isImplemented(card));
    expect(missing.map((card) => `${card.id} ${functionalKeyOf(card)}`)).toEqual([]);
  });
});
