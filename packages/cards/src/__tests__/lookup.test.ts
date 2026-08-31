import { describe, expect, it } from "vitest";
import { cardData, findPrinting, isImplemented, normalizeCardName } from "../index.js";

describe("normalizeCardName", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalizeCardName("  Smash   With Big Tree ")).toBe("smash with big tree");
  });

  it("folds printed diacritics to keyboard-friendly ASCII", () => {
    expect(normalizeCardName("Jarl Vetreiði")).toBe("jarl vetreidi");
    expect(normalizeCardName("Potion of Déjà Vu")).toBe("potion of deja vu");
  });
});

describe("findPrinting", () => {
  it("resolves a name case-insensitively to a printing", () => {
    const card = findPrinting("awakening bellow");
    expect(card).toBeDefined();
    expect(card!.name).toBe("Awakening Bellow");
    expect(cardData[card!.id]).toBe(card);
  });

  it("resolves an ASCII spelling of a name containing eth", () => {
    const card = findPrinting("jarl vetreidi");
    expect(card).toBeDefined();
    expect(card!.name).toBe("Jarl Vetreiði");
    expect(card!.cardType).toBe("hero");
  });

  it("prefers an exact pitch match when given", () => {
    // The full card pool contains all three pitch variants. An explicit pitch
    // must select yellow regardless of which color name-only lookup returns.
    const exact = findPrinting("Raging Onslaught", 2);
    const any = findPrinting("Raging Onslaught");
    expect(exact).toBeDefined();
    expect(exact!.pitch).toBe(2);
    expect(exact!.id).toBe("WTR189");
    expect(any!.name).toBe("Raging Onslaught");
  });

  it("does not substitute another color when the requested pitch is absent", () => {
    // En Garde exists only as red; a yellow decklist entry must not resolve to it.
    expect(findPrinting("En Garde", 2)).toBeUndefined();
  });

  it("returns undefined for unknown cards", () => {
    expect(findPrinting("Not A Real Card")).toBeUndefined();
  });
});

describe("isImplemented", () => {
  it("is true for curated vanilla cards", () => {
    expect(isImplemented(findPrinting("Smash with Big Tree", 2)!)).toBe(true);
  });

  it("is true for scripted cards", () => {
    // Rhinar's hero is scripted
    const hero = Object.values(cardData).find((c) => c.cardType === "hero" && c.name.includes("Rhinar"));
    expect(hero).toBeDefined();
    expect(isImplemented(hero!)).toBe(true);
  });
});
