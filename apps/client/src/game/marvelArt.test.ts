import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cardData, cardList } from "@fyendal/cards/client";
import { CardArtwork, CardFace } from "./Card.js";
import { isMarvelCardImageUrl, resolveCardImageUrl, resolveCardImageUrls } from "./cardImageUrl.js";
import marvelArt from "./marvelArt.json" with { type: "json" };

describe("internal Marvel artwork selection", () => {
  it.each([
    ["HER133", "HNT054-MV"], // Adult hero, using another set's Marvel.
    ["1HP002", "PEN334-MV"], // Young hero; never substitute its adult version.
    ["OUT237", "FAB489-MV"], // Ponder token.
    ["DYN148", "TNP031-MV"], // Red Cut to the Chase.
    ["DYN149", "TNP032-MV"], // Yellow Cut to the Chase.
    ["DYN150", "TNP033-MV"], // Blue Cut to the Chase.
    ["UPR007", "UPR007-MV"],
    ["UPR007B", "UPR007-MV_BACK"],
    ["DTD164", "DTD164-MV_BACK"], // These Marvel faces reverse the ordinary ordering.
    ["DTD164B", "DTD164-MV"],
    ["MST010B", "MST010-MV_BACK"],
    ["HVY243", "SEA244-TP"], // Marvels do not all use the -MV suffix.
    ["IAR053", "GEM184-MV"], // Adult Malice's Marvel is a GEM promo.
    ["AMA001", "GEM184-MV"],
    ["IAR054", "IAR054-MV"],
    ["IAR084", "IAR084-MV"],
    ["IAR106", "IAR106-MV"],
    ["IAR106B", "IAR106-MV_BACK"],
    ["IAR221", "IAR221-MV"],
  ])("uses the matching Marvel face for %s", (id, imageId) => {
    expect(resolveCardImageUrl(id, undefined, true)).toBe(`https://content.fabrary.net/cards/${imageId}.webp`);
    expect(isMarvelCardImageUrl(resolveCardImageUrl(id, undefined, true))).toBe(true);
  });

  it("keeps ordinary artwork when disabled or no Marvel exists", () => {
    expect(resolveCardImageUrl("HER133", undefined, false)).toBe("https://content.fabrary.net/cards/HER133.webp");
    expect(resolveCardImageUrls("WTR215", undefined, true)).toEqual(["https://content.fabrary.net/cards/WTR215.webp"]);
    expect(resolveCardImageUrls("not-a-card", undefined, true)).toEqual(["https://content.fabrary.net/cards/not-a-card.webp"]);
  });

  it("retains ordinary art and HP1 fallbacks after a Marvel load failure", () => {
    expect(resolveCardImageUrls("1HP002", undefined, true)).toEqual([
      "https://content.fabrary.net/cards/PEN334-MV.webp",
      "https://content.fabrary.net/cards/WTR002.webp",
      "https://content.fabrary.net/cards/1HP002.webp",
    ]);
    expect(resolveCardImageUrls("OUT237", undefined, true)).toEqual([
      "https://content.fabrary.net/cards/FAB489-MV.webp",
      "https://content.fabrary.net/cards/OUT237.webp",
    ]);
    expect(resolveCardImageUrls("FAB489", undefined, true)).toEqual(["https://content.fabrary.net/cards/FAB489-MV.webp"]);
  });

  it("uses identical artwork for every printing of a token", () => {
    for (const card of cardList.filter((card) => card.name === "Ponder")) {
      expect(resolveCardImageUrl(card.id, card, true)).toBe("https://content.fabrary.net/cards/FAB489-MV.webp");
    }
    expect(resolveCardImageUrl("ROS162", cardData.ROS162, true)).toBe("https://content.fabrary.net/cards/ARC112.webp");
  });

  it("covers only imported identities and applies each entry to every matching printing", () => {
    const byKey = new Map<string, string[]>();
    for (const card of cardList) {
      const key = `${card.cardType}|${card.name.trim().toLowerCase().replace(/\s+/g, " ")}|${card.pitch ?? 0}`;
      byKey.set(key, [...byKey.get(key) ?? [], card.id]);
    }
    expect(Object.keys(marvelArt).length).toBeGreaterThan(300);
    for (const [key, imageId] of Object.entries(marvelArt)) {
      expect(imageId, key).toMatch(/^[A-Z0-9]{6}(?:[-_][A-Z0-9_]+)*$/);
      const printings = byKey.get(key);
      expect(printings?.length, key).toBeGreaterThan(0);
      for (const id of printings ?? []) {
        expect(resolveCardImageUrl(id, undefined, true), id).toBe(`https://content.fabrary.net/cards/${imageId}.webp`);
      }
    }
  });

  it("uses ordinary artwork in client cards and previews", () => {
    expect(resolveCardImageUrl("HNT054")).toBe("https://content.fabrary.net/cards/HNT054.webp");
    expect(resolveCardImageUrls("IAR053")[0]).toBe("https://content.fabrary.net/cards/IAR053.webp");
    const markup = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 1, cardId: "HNT054", owner: 0 },
      size: "zone", squareArt: true,
    }));
    expect(markup).toContain("HNT054.webp");
    expect(markup).toContain("board-square-name");
    expect(markup).not.toContain("card-board-square-marvel");
    const preview = renderToStaticMarkup(createElement(CardArtwork, { cardId: "DYN148", alt: "Cut to the Chase" }));
    expect(preview).toContain("DYN148.webp");
    expect(preview).not.toContain("TNP031-MV.webp");
  });

  it("falls back to ordinary Malice artwork after her GEM Marvel", () => {
    expect(resolveCardImageUrls("IAR053", undefined, true).slice(0, 2)).toEqual([
      "https://content.fabrary.net/cards/GEM184-MV.webp",
      "https://content.fabrary.net/cards/IAR053.webp",
    ]);
  });

});
