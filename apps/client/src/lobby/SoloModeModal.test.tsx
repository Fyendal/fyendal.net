import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeckSummary } from "@fyendal/protocol";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("../store.js", () => ({
  useStore: (select: (state: Record<string, unknown>) => unknown) => select(store.state),
}));

import { defaultSoloOpponentDeck, PlayBothSidesModal, SoloModeModal } from "./SoloModeModal.js";

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
  it("opens on the choice between bot practice and playing both sides", () => {
    setStore();
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <SoloModeModal format="cc" deckId="deck-a" onSelectBot={vi.fn()} onStartSolo={vi.fn()} onClose={vi.fn()} />
      </TestI18nProvider>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Solo Practice");
    expect(html).toContain("Practice vs bot");
    expect(html).toContain("Play both sides");
    expect(html.match(/class="solo-mode-card"/g)).toHaveLength(2);
    expect(html).not.toContain("Choose Your Opponent");
  });

  it("picks the opponent deck from the format's decks with an import link and start", () => {
    setStore();
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <PlayBothSidesModal
          format="cc"
          deckId="deck-a"
          opponentDeckId={null}
          onChooseOpponentDeck={vi.fn()}
          onImport={vi.fn()}
          onBack={vi.fn()}
          onStart={vi.fn()}
          onClose={vi.fn()}
        />
      </TestI18nProvider>,
    );
    expect(html).toContain("Your deck");
    expect(html).toContain("Alpha Rhinar");
    expect(html).toContain("Opponent deck");
    expect(html).toContain("Beta Rhinar");
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
