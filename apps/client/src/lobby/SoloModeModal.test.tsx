import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeckSummary } from "@fyendal/protocol";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { SOLO_BOTH_SIDES_SEEN_STORAGE_KEY } from "../storage.js";

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("../store.js", () => ({
  useStore: (select: (state: Record<string, unknown>) => unknown) => select(store.state),
}));

import { defaultSoloOpponentDeck, PlayBothSides, SoloModeModal } from "./SoloModeModal.js";

function deck(id: string, name: string, updatedAt: number): DeckSummary {
  return {
    id, name, format: "cc", fabraryUrl: "", heroName: "Rhinar, Reckless Rampage", deckSize: 60, updatedAt,
    art: { highestRarity: false, picks: {} },
  } as DeckSummary;
}

const decks = [deck("deck-a", "Alpha Rhinar", 3), deck("deck-b", "Beta Rhinar", 2)];

function setStore() {
  store.state = {
    authUser: "alice",
    cardPoolModes: { cc: "legal", "silver-age": "legal" },
    decks,
    deckPlayedAt: {},
    refreshDecks: vi.fn(),
    betaTester: false,
  };
}

describe("SoloModeModal", () => {
  it("opens on the bot roster with self-play one tab away", () => {
    setStore();
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <SoloModeModal format="cc" deckId="deck-a" onSelectBot={vi.fn()} onStartSolo={vi.fn()} onClose={vi.fn()} />
      </TestI18nProvider>,
    );
    expect(html.match(/role="dialog"/g)).toHaveLength(1);
    expect(html).toContain("Solo Practice");
    expect(html).toContain('role="tablist" aria-label="Solo Practice"');
    expect(html).toMatch(/role="tab" class="selected" aria-selected="true"[^>]*>.*?Practice vs bot<\/button>/);
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*tabindex="-1">.*?Play both sides<\/button>/);
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("Keep searching for a real player");
    expect(html.match(/class="bot-opponent-card"/g)?.length).toBeGreaterThan(0);
    expect(html).not.toContain("Choose Your Opponent");
    expect(html).not.toContain("Start game");
  });

  it("marks the self-play tab with a dot until this browser has opened it", () => {
    setStore();
    const render = (seen: string | null) => {
      vi.stubGlobal("localStorage", { getItem: (key: string) => key === SOLO_BOTH_SIDES_SEEN_STORAGE_KEY ? seen : null });
      const html = renderToStaticMarkup(
        <TestI18nProvider>
          <SoloModeModal format="cc" deckId="deck-a" onSelectBot={vi.fn()} onStartSolo={vi.fn()} onClose={vi.fn()} />
        </TestI18nProvider>,
      );
      vi.unstubAllGlobals();
      return html;
    };
    expect(render(null)).toContain('Play both sides<span class="solo-tab-unseen" aria-hidden="true"></span></button>');
    expect(render("1")).not.toContain("solo-tab-unseen");
  });

  it("faces your deck against the picked opponent deck with an import link and start", () => {
    setStore();
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <PlayBothSides
          format="cc"
          deckId="deck-a"
          opponentDeckId={null}
          onChooseOpponentDeck={vi.fn()}
          onImport={vi.fn()}
          onStart={vi.fn()}
        />
      </TestI18nProvider>,
    );
    expect(html).toMatch(/class="solo-matchup-seat">.*?Your deck.*?Alpha Rhinar/);
    expect(html).toMatch(/class="solo-matchup-seat opposing">.*?Opponent deck.*?Beta Rhinar/);
    expect(html).toContain('class="solo-matchup-versus">vs<');
    expect(html).toContain("Import another deck");
    expect(html).toMatch(/<button type="submit" class="btn-cta">Start game<\/button>/);
  });
});

describe("defaultSoloOpponentDeck", () => {
  it("prefers the remembered deck, then another deck, then a mirror", () => {
    expect(defaultSoloOpponentDeck(decks, "legal", {}, "deck-a", "deck-a")?.id).toBe("deck-a");
    expect(defaultSoloOpponentDeck(decks, "legal", {}, "deck-a", null)?.id).toBe("deck-b");
    expect(defaultSoloOpponentDeck(decks, "legal", {}, "deck-a", "missing")?.id).toBe("deck-b");
    expect(defaultSoloOpponentDeck([decks[0]!], "legal", {}, "deck-a", null)?.id).toBe("deck-a");
    expect(defaultSoloOpponentDeck([], "legal", {}, "deck-a", null)).toBeUndefined();
  });
});
