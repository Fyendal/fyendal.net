import { describe, expect, it } from "vitest";
import { heroImageUrl } from "../lobby/heroImage.js";

describe("heroImageUrl", () => {
  it.each([
    ["Dash I/O", "dash-io"],
    ["Jarl Vetreiði", "jarl-vetreidi"],
    ["Maxx 'The Hype' Nitro", "maxx-the-hype-nitro"],
    ["Arakni, 5L!p3d 7hRu 7h3 cR4X", "arakni-5lp3d-7hru-7h3-cr4x"],
  ])("maps %s to Fabrary's %s slug", (heroName, slug) => {
    expect(heroImageUrl(heroName)).toBe(`https://content.fabrary.net/heroes/${slug}.webp`);
  });
});
