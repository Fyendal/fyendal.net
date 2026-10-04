import type { ReactElement, ImgHTMLAttributes, SyntheticEvent } from "react";
import { describe, expect, it } from "vitest";
import { LifeHeroPortrait } from "./LifeHeroPortrait.js";

describe("life hero portrait", () => {
  it.each([
    ["Blasmophet, Levia Consumed", "DTD164", "DTD164"],
    ["Levia, Redeemed", "DTD164B", "DTD164_BACK"],
  ])("falls back to the correct card face for %s", (heroName, heroCardId, imageId) => {
    const portrait: ReactElement<ImgHTMLAttributes<HTMLImageElement>> = LifeHeroPortrait({ heroName, heroCardId });
    const image = { src: portrait.props.src, hidden: false };
    const event = { currentTarget: image } as SyntheticEvent<HTMLImageElement>;

    portrait.props.onError!(event);
    expect(image.src).toBe(`https://content.fabrary.net/cards/${imageId}.webp`);
    expect(image.hidden).toBe(false);

    // Stop retrying if the card image is also unavailable.
    portrait.props.onError!(event);
    expect(image.hidden).toBe(true);
  });

  it("replaces the image element on transformation and undo to clear failed-image state", () => {
    const original = LifeHeroPortrait({ heroName: "Levia", heroCardId: "MON120" });
    const transformed = LifeHeroPortrait({ heroName: "Levia, Redeemed", heroCardId: "DTD164B" });
    const restored = LifeHeroPortrait({ heroName: "Levia", heroCardId: "MON120" });
    expect(transformed.key).not.toBe(original.key);
    expect(restored.key).not.toBe(transformed.key);
    expect(restored.props.src).toBe("https://content.fabrary.net/heroes/levia.webp");
  });
});
