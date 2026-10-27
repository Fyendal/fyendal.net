import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as catalog from "@fyendal/cards/art";
import { STANDARD_CARD_ART } from "@fyendal/shared";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { resolveCardImageUrls } from "../game/cardImageUrl.js";
import { CardArtVariants, cardArtOptions, chooseCardArt, shownCardArt } from "./CardArtVariants.js";

const off = { highestRarity: false, picks: {} };
const on = { highestRarity: true, picks: {} };

describe("card art choices", () => {
  it("lists standard art once, then the rarest alternatives", () => {
    const options = cardArtOptions(catalog, "ARC159");
    expect(options[0]).toEqual({ image: undefined });
    expect(options[1]?.image).toBe("DYN000-CF");
    expect(options.map((option) => option.image)).not.toContain("ARC159");
  });

  it("stores only picks that differ from the deck's automatic choice", () => {
    expect(chooseCardArt(catalog, off, "ARC159", "HNT260")).toEqual({ highestRarity: false, picks: { ARC159: "HNT260" } });
    expect(chooseCardArt(catalog, { ...off, picks: { ARC159: "HNT260" } }, "ARC159", undefined)).toEqual(off);
    expect(chooseCardArt(catalog, on, "ARC159", "DYN000-CF")).toEqual(on);
    expect(chooseCardArt(catalog, on, "ARC159", undefined))
      .toEqual({ highestRarity: true, picks: { ARC159: STANDARD_CARD_ART } });
  });

  it("reports the card's own printing as standard art", () => {
    expect(shownCardArt(catalog, "ARC159", { ...off, picks: { ARC159: "ARC159" } })).toBeUndefined();
    expect(shownCardArt(catalog, "ARC159", on)).toBe("DYN000-CF");
  });

  it("marks the selected printing and the automatic one", () => {
    const html = renderToStaticMarkup(createElement(TestI18nProvider, null,
      createElement(CardArtVariants, {
        catalog,
        cardId: "ARC159",
        art: { highestRarity: true, picks: { ARC159: "HNT260" } },
        onChange: () => {},
      })));
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain("Use auto");
    expect(html).toContain("Fabled, Cold Foil");
  });
});

describe("chosen art images", () => {
  it("tries the chosen image first and keeps the standard fallback", () => {
    expect(resolveCardImageUrls("ARC159", undefined, false, "DYN000-CF")).toEqual([
      "https://content.fabrary.net/cards/DYN000-CF.webp",
      "https://content.fabrary.net/cards/ARC159.webp",
    ]);
  });
});
