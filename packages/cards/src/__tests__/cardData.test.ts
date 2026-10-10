import { describe, expect, it } from "vitest";
import { decodeCardDataList } from "../cardData.js";
import { cardList } from "../catalog.js";
import { functionalKeyOf } from "../functional.js";

describe("card data decoding", () => {
  it("accepts omitted variable numeric values", () => {
    expect(decodeCardDataList([{
      id: "TST001",
      name: "Variable Weapon",
      cardType: "weapon",
      text: "X is determined by the card script.",
    }])).toHaveLength(1);
  });

  it("accepts a printed color independently from pitch", () => {
    expect(decodeCardDataList([{
      id: "TST002",
      name: "Unpitchable Yellow",
      color: 2,
      cardType: "action",
      text: "This card can't be pitched.",
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

describe("conditional keyword overrides", () => {
  // Each card's script grants these keywords only when its printed condition
  // holds, so the dataset's printed keyword would make the grant unconditional.
  const conditional: Record<string, string[]> = {
    "open the center|1": ["Go again", "Dominate"],
    "open the center|2": ["Go again", "Dominate"],
    "open the center|3": ["Go again", "Dominate"],
    "rising knee thrust|1": ["Go again"],
    "rising knee thrust|2": ["Go again"],
    "rising knee thrust|3": ["Go again"],
    "mugenshi: release|2": ["Go again"],
    "hurricane technique|2": ["Go again"],
    "flood of force|2": ["Go again"],
    "tiger swipe|1": ["Go again"],
    "tempest palm gustwave|2": ["Go again"],
    "scour the battlescape|1": ["Go again"],
    "scour the battlescape|2": ["Go again"],
    "scour the battlescape|3": ["Go again"],
    "swarming gloomveil|1": ["Go again"],
    "bingo|1": ["Go again"],
    "douse in runeblood|1": ["Go again"],
    "tooth and claw|1": ["Go again"],
    "levels of enlightenment|3": ["Go again"],
    "emissary of wind|1": ["Go again"],
    "astral strike|1": ["Go again"],
    "bloodrush bellow|2": ["Go again"],
    "cogwerx dovetail|1": ["Go again"],
    "soul reaping|1": ["Go again"],
    "shadow of ursur|3": ["Go again"],
    "embalm|2": ["Go again"],
    "elemental strike|1": ["Go again", "Dominate"],
    "flowshard elemental|1": ["Go again"],
    "insult to injury|1": ["Go again"],
    "insult to injury|2": ["Go again"],
    "insult to injury|3": ["Go again"],
    "unwavering resolve|1": ["Go again"],
  };

  it("strips printed keywords that the card only gains conditionally", () => {
    const seen = new Set<string>();
    for (const card of cardList) {
      const forbidden = conditional[functionalKeyOf(card)];
      if (!forbidden) continue;
      seen.add(functionalKeyOf(card));
      for (const keyword of forbidden) expect(card.keywords ?? [], `${card.id} ${card.name}`).not.toContain(keyword);
    }
    expect([...seen].sort()).toEqual(Object.keys(conditional).sort());
  });
});
