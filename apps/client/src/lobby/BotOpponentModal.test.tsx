import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { BOT_MATCHMAKING_PREFERENCE_STORAGE_KEY } from "../storage.js";
import type { StoreState } from "../store/types.js";

const botModalStore = vi.hoisted(() => ({ state: { betaTester: false } as StoreState }));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(botModalStore.state),
}));

import { BotOpponentModal } from "./BotOpponentModal.js";

afterEach(() => {
  vi.unstubAllGlobals();
  botModalStore.state = { betaTester: false } as StoreState;
});

describe("BotOpponentModal", () => {
  it("offers Ira, Hala, Cindra, Jarl, Levia, and Boltyn to beta testers in a focused opponent dialog", () => {
    botModalStore.state = { betaTester: true } as StoreState;
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <BotOpponentModal format="cc" onSelect={vi.fn()} onClose={vi.fn()} />
      </TestI18nProvider>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Choose Your Opponent");
    expect(html).toContain("Keep searching for a real player");
    expect(html).toContain('type="checkbox" checked=""');
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
    expect(html).toContain("A fatigue deck that blocks efficiently and wins the long game.");
    expect(html).toContain("Levia");
    expect(html).toContain("Shadowborn Abomination");
    expect(html).toContain("An aggressive deck that builds Gates for explosive Bloodrush turns.");
    expect(html).toContain("Boltyn");
    expect(html).toContain("Breaker of Dawn");
    expect(html).toContain("A tempo deck that charges Soul for Raydn swings and explosive V of the Vanguard turns.");
    expect(html).not.toContain("Starvo");
    expect(html).not.toContain("Star of the Show");
    expect(html).toContain('aria-label="Close Choose Your Opponent"');
    expect(html).toContain('class="bot-deck-type bot-deck-type-aggro">Aggro</span>');
    // Deck-type chips are text only; the dialog's close icon is the sole decoration.
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(1);
  });

  it("hides the beta-only Boltyn bot from other players", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <BotOpponentModal format="cc" onSelect={vi.fn()} onClose={vi.fn()} />
      </TestI18nProvider>,
    );

    expect(html).toContain("Levia");
    expect(html).not.toContain("Boltyn");
    expect(html).not.toContain("Breaker of Dawn");
  });

  it("offers Kayo, Briar, and Bravo for Silver Age", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <BotOpponentModal format="silver-age" onSelect={vi.fn()} onClose={vi.fn()} />
      </TestI18nProvider>,
    );

    expect(html).toContain("Briar");
    expect(html).toContain("Kayo");
    expect(html).toContain("Elemental Runeblade");
    expect(html).toContain("Aggro");
    expect(html).toContain("Bravo");
    expect(html).toContain("Flattering Showman");
    expect(html).toContain("Defensive");
    expect(html).not.toContain("Scarlet Revenger");
  });

  it("shows benched Briar with an accessible custom tooltip for restricted cards", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <BotOpponentModal
          format="silver-age"
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("Briar");
    expect(html).toContain("Includes banned");
    expect(html).toContain('role="tooltip">Banned cards:\nBriar');
    expect(html).toContain('aria-describedby=');
    expect(html).not.toContain('title="Banned cards:');
    expect(html).toContain("Kayo");
    expect(html).toContain("Bravo");
  });

  it("restores a disabled matchmaking preference", () => {
    const getItem = vi.fn((key: string) => key === BOT_MATCHMAKING_PREFERENCE_STORAGE_KEY
      ? JSON.stringify({ version: 1, searchForPlayer: false })
      : null);
    vi.stubGlobal("localStorage", {
      getItem,
      setItem: vi.fn(),
    });
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <BotOpponentModal format="cc" onSelect={vi.fn()} onClose={vi.fn()} />
      </TestI18nProvider>,
    );

    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('type="checkbox" checked=""');
    expect(getItem).toHaveBeenCalledWith(BOT_MATCHMAKING_PREFERENCE_STORAGE_KEY);
  });
});
