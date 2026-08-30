import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeckSummary } from "@fyendal/protocol";

describe("deckChoicesFor", () => {
  it("lists the user's decks before shared precons", async () => {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    const { deckChoicesFor } = await import("./DeckGrid.js");
    const ownDeck: DeckSummary = {
      id: "saved-deck",
      name: "My Briar Deck",
      format: "silver-age",
      fabraryUrl: null,
      heroName: "Briar",
      deckSize: 40,
      updatedAt: 1,
    };

    const choices = deckChoicesFor("silver-age", [ownDeck]);

    expect(choices[0]).toEqual(ownDeck);
    expect(choices.slice(1).every((deck) => deck.id.startsWith("precon-"))).toBe(true);
  });

  it("shows banned card names on the red legality warning and blocks room play", async () => {
    const { DeckTile, deckIsLegalForRoom } = await import("./DeckGrid.js");
    const deck: DeckSummary = {
      id: "banned-deck",
      name: "Banned deck",
      format: "cc",
      fabraryUrl: null,
      heroName: "Bravo",
      deckSize: 80,
      updatedAt: 1,
      bannedCards: ["Art of War"],
    };

    const html = renderToStaticMarkup(createElement(DeckTile, {
      deck,
      onSelect: () => {},
    }));

    expect(html).toContain("Includes banned card");
    expect(html).toContain("Banned cards:\nArt of War");
    expect(html).toContain("deck-legality-hint banned");
    expect(deckIsLegalForRoom(deck, false)).toBe(false);
  });
});

describe("filterAndSortDecks", () => {
  it("searches by hero, filters legality, and sorts saved decks by update time", async () => {
    const { filterAndSortDecks } = await import("./DeckGrid.js");
    const decks: DeckSummary[] = [
      {
        id: "old",
        name: "Old Bravo",
        format: "cc",
        fabraryUrl: null,
        heroName: "Bravo",
        deckSize: 80,
        updatedAt: 1,
      },
      {
        id: "new",
        name: "Tournament List",
        format: "cc",
        fabraryUrl: null,
        heroName: "Bravo, Star of the Show",
        deckSize: 80,
        updatedAt: 9,
      },
      {
        id: "future",
        name: "Future Aurora",
        format: "cc",
        fabraryUrl: null,
        heroName: "Aurora",
        deckSize: 80,
        updatedAt: 12,
        futureCards: ["Future Card"],
      },
    ];

    expect(filterAndSortDecks(decks, {
      query: "bravo",
      legality: "playable",
      allowFutureCards: false,
      catalog: "mine",
    }).map((deck) => deck.id)).toEqual(["new", "old"]);
    expect(filterAndSortDecks(decks, {
      query: "",
      legality: "attention",
      allowFutureCards: false,
      catalog: "mine",
    }).map((deck) => deck.id)).toEqual(["future"]);
  });
});
