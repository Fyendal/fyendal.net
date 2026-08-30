import { describe, expect, it } from "vitest";
import { decodeCardDataList } from "../cardData.js";

describe("card data decoding", () => {
  it("accepts omitted variable numeric values", () => {
    expect(decodeCardDataList([{
      id: "TST001",
      name: "Variable Weapon",
      cardType: "weapon",
      text: "X is determined by the card script.",
    }])).toHaveLength(1);
  });

  it("rejects null and non-finite numeric values at the JSON boundary", () => {
    for (const attack of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => decodeCardDataList([{
        id: "TST001",
        name: "Invalid Weapon",
        cardType: "weapon",
        text: "",
        attack,
      }], "fixture")).toThrow("fixture[0].attack");
    }
  });

  it("rejects unknown fields instead of silently widening CardData", () => {
    expect(() => decodeCardDataList([{
      id: "TST001",
      name: "Unknown Field",
      cardType: "action",
      text: "",
      power: 3,
    }], "fixture")).toThrow("fixture[0].power");
  });
});
