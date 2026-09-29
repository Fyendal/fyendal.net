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
  it("shows saved decks from both formats with direct edit and delete actions", () => {
    libraryStore.state = {
      decks: [
        { id: "cc", name: "Bravo Deck", format: "cc", fabraryUrl: null, heroName: "Bravo", deckSize: 80, updatedAt: 2 },
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
    expect(html.match(/>Edit Deck<\/button>/g)).toHaveLength(2);
    expect(html.match(/>Delete Deck<\/button>/g)).toHaveLength(2);
    expect(html).toContain("Create / Import Deck");
    expect(html).not.toContain("Find Match");
    expect(html).not.toContain("Play vs Bot");

    const ccOnly = renderToStaticMarkup(
      <TestI18nProvider>
        <DeckLibrary formatFilter="cc" onFormatFilterChange={() => {}} />
      </TestI18nProvider>,
    );
    expect(ccOnly).toContain("Bravo Deck");
    expect(ccOnly).not.toContain("Briar Deck");
  });
});
