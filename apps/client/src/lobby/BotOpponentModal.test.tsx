import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BotOpponentModal } from "./BotOpponentModal.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

describe("BotOpponentModal", () => {
  it("offers Ira, Hala, Cindra, and Jarl in a focused opponent dialog", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <BotOpponentModal format="cc" onSelect={vi.fn()} onClose={vi.fn()} />
      </TestI18nProvider>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Choose your opponent");
    expect(html).toContain("Ira");
    expect(html).toContain("Scarlet Revenger");
    expect(html).toContain("Beginner");
    expect(html).toContain("A straightforward Armory Deck that&#x27;s great for beginners.");
    expect(html).toContain("Hala");
    expect(html).toContain("Bladesaint of the Vow");
    expect(html).toContain("Midrange");
    expect(html).toContain("A flexible value deck that balances offense and defense.");
    expect(html).toContain("Cindra");
    expect(html).toContain("Dracai of Retribution");
    expect(html).toContain("Aggro");
    expect(html).toContain("A fast redline deck built to keep the pressure on.");
    expect(html).toContain("Jarl");
    expect(html).toContain("Vetreiði");
    expect(html).toContain("Defensive");
    expect(html).toContain("A patient Earth and Ice Guardian that blocks efficiently and attacks with disruptive two-card hands.");
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(4);
  });

  it("offers Briar and Bravo for Silver Age", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <BotOpponentModal format="silver-age" onSelect={vi.fn()} onClose={vi.fn()} />
      </TestI18nProvider>,
    );

    expect(html).toContain("Briar");
    expect(html).toContain("Elemental Runeblade");
    expect(html).toContain("Aggro");
    expect(html).toContain("Bravo");
    expect(html).toContain("Flattering Showman");
    expect(html).toContain("Defensive");
    expect(html).not.toContain("Scarlet Revenger");
  });
});
