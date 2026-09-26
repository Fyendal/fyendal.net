import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrepArenaCards } from "./PrepArenaCards.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

describe("committed arena cards", () => {
  it("orders equipment consistently even when commitments use a different key order", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <PrepArenaCards owner="you" arena={{ weaponIds: [], equipment: { chest: "ARC156", head: "HVY195" } }} />
      </TestI18nProvider>,
    );
    expect(html.indexOf("HVY195.webp")).toBeLessThan(html.indexOf("ARC156.webp"));
  });

  it("shows the owner's committed cards without selection controls", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <PrepArenaCards owner="you" arena={{ weaponIds: ["GEM003", "GEM003"], equipment: { head: "HVY195" } }} />
      </TestI18nProvider>,
    );
    expect(html).toContain("Your arena cards");
    expect(html.match(/GEM003\.webp/g)).toHaveLength(2);
    expect(html).toContain("HVY195.webp");
    expect(html).not.toContain("prep-card-choice");
  });

  it("renders an opponent's Cloaked card without an identity or artwork", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <PrepArenaCards owner="opponent" arena={{ weaponIds: [], equipment: { head: null } }} />
      </TestI18nProvider>,
    );
    expect(html).toContain("Opponent’s arena cards");
    expect(html).toContain("Face-down equipment");
    expect(html).not.toContain(".webp");
  });
});
