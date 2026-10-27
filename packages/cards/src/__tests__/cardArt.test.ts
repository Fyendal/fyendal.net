import { describe, expect, it } from "vitest";
import { STANDARD_CARD_ART, type DeckPool } from "@fyendal/shared";
import {
  cardArtVariants,
  deckCardArt,
  highestRarityArt,
  isValidCardArt,
  normalizeDeckArt,
  resolveDeckArt,
} from "../cardArt.js";

const pool: DeckPool = {
  heroId: "WTR001",
  weaponIds: [],
  equipmentPool: [],
  deck: ["ARC159", "ARC159", "WTR159"],
};

describe("card art catalog", () => {
  it("shares one variant list across every printing of a card", () => {
    expect(cardArtVariants("ARC159")).toEqual(cardArtVariants("DYN000"));
    expect(cardArtVariants("ARC159").map((variant) => variant.image)).toContain("DYN000-CF");
  });

  it("keeps one image per face and adds curated printings", () => {
    const images = (cardId: string) => cardArtVariants(cardId).map((variant) => variant.image);
    // A Marvel promo's back object repeats the same face as full-bleed art.
    expect(images("HNT215")).toContain("FAB294-MV");
    expect(images("HNT215")).not.toContain("FAB294-MV_BACK");
    // A double-faced card's back face keeps its own Marvel.
    expect(images("UPR012B")).toContain("UPR012-MV_BACK");
    // Malice's only alternatives come from the Marvel and curated supplements.
    expect(images("IAR053")).toEqual(expect.arrayContaining(["GEM184-MV", "KO_HER172-RF"]));
    expect(isValidCardArt("IAR053", "KO_HER172-RF")).toBe(true);
  });

  it("ranks rarity before art variation and foil", () => {
    // The Fabled cold foil outranks Legendary extended-art rainbow foils.
    expect(highestRarityArt("ARC159")).toBe("DYN000-CF");
    expect(highestRarityArt("WTR159")).toBe("ANQ000-MV");
  });

  it("accepts only images of the same functional card", () => {
    expect(isValidCardArt("ARC159", "HNT260")).toBe(true);
    expect(isValidCardArt("ARC159", "ANQ000-MV")).toBe(false);
    expect(isValidCardArt("not-a-card", "ARC159")).toBe(false);
  });

  it("lets picks override highest rarity, including a pick of standard art", () => {
    const art = { highestRarity: true, picks: { ARC159: "HNT260", WTR159: STANDARD_CARD_ART } };
    expect(deckCardArt("ARC159", art)).toBe("HNT260");
    expect(deckCardArt("WTR159", art)).toBeUndefined();
    expect(deckCardArt("WTR159", { highestRarity: false, picks: {} })).toBeUndefined();
    const resolved = resolveDeckArt(pool, art);
    expect(resolved.ARC159).toBe("HNT260");
    expect(resolved).not.toHaveProperty("WTR159");
  });

  it("drops picks for cards outside the deck and images of other cards", () => {
    expect(normalizeDeckArt(pool, {
      highestRarity: false,
      picks: { ARC159: "ANQ000-MV", WTR159: "PEN320", CRU001: "CRU001" },
    })).toEqual({ highestRarity: false, picks: { WTR159: "PEN320" } });
  });
});
