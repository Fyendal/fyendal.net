import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StoreState } from "../store/types.js";

const libraryStore = vi.hoisted(() => ({ state: {} as StoreState }));
vi.mock("../store.js", () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(libraryStore.state),
}));

import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { DeckLibrary } from "./DeckLibrary.js";

describe("DeckLibrary", () => {
  it("links Fabrary decks, keeps pasted lists editable, and shows selection controls", () => {
    libraryStore.state = {
      decks: [
        { id: "cc", name: "Bravo Deck", format: "cc", fabraryUrl: "https://www.fabrary.net/decks/01M1WZTPC64GDCMN2GX752E3R7?matchup=abc", heroName: "Bravo", deckSize: 80, updatedAt: 2 },
        { id: "sa", name: "Briar Deck", format: "silver-age", fabraryUrl: null, heroName: "Briar", deckSize: 40, updatedAt: 1 },
      ],
      decksLoading: false,
      cardPoolModes: { cc: "legal", "silver-age": "legal" },
    } as StoreState;

    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <DeckLibrary formatFilter="all" onFormatFilterChange={() => {}} />
      </TestI18nProvider>,
    );

    expect(html).toContain("Bravo Deck");
    expect(html).toContain("Briar Deck");
    expect(html).toContain('href="https://fabrary.net/decks/01M1WZTPC64GDCMN2GX752E3R7"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('aria-label="View Bravo Deck on Fabrary"');
    expect(html).toContain('aria-label="Select Bravo Deck"');
    expect(html).toContain('aria-label="Select Briar Deck"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/>Edit Deck<\/button>/g)).toHaveLength(2);
    expect(html.match(/>Delete Deck<\/button>/g)).toHaveLength(2);
    expect(html).toContain("Create / Import Deck");
    expect(html).not.toContain("Find Match");
    expect(html).not.toContain("Play vs AI");

    const ccOnly = renderToStaticMarkup(
      <TestI18nProvider>
        <DeckLibrary formatFilter="cc" onFormatFilterChange={() => {}} />
      </TestI18nProvider>,
    );
    expect(ccOnly).toContain("Bravo Deck");
    expect(ccOnly).not.toContain("Briar Deck");
  });

  it("does not turn an invalid saved URL into a link", () => {
    libraryStore.state = {
      decks: [{ id: "bad", name: "Old Deck", format: "cc", fabraryUrl: "javascript:alert(1)", heroName: "Bravo", deckSize: 80, updatedAt: 1 }],
      decksLoading: false,
      cardPoolModes: { cc: "legal", "silver-age": "legal" },
    } as StoreState;
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <DeckLibrary formatFilter="all" onFormatFilterChange={() => {}} />
      </TestI18nProvider>,
    );
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('class="deck-card"');
  });
});
