import { describe, expect, it, vi } from "vitest";
import { createFabraryClient, decodeFabraryDeck, parseFabraryDeckUrl } from "../fabrary.js";

const DECK_ID = "01G76G1DP5VVB050BT3YV9TQ7K";
const DECK_URL = `https://fabrary.net/decks/${DECK_ID}`;

describe("Fabrary deck URLs", () => {
  it("accepts only Fabrary deck pages and canonicalizes the URL", () => {
    expect(parseFabraryDeckUrl(`https://www.fabrary.net/decks/${DECK_ID.toLowerCase()}?matchupId=ignored`))
      .toEqual({ deckId: DECK_ID, canonicalUrl: DECK_URL });
    expect(parseFabraryDeckUrl(`https://evil.example/decks/${DECK_ID}`)).toBeNull();
    expect(parseFabraryDeckUrl(`https://fabrary.net.evil.example/decks/${DECK_ID}`)).toBeNull();
    expect(parseFabraryDeckUrl("https://fabrary.net/decks/not-a-deck-id")).toBeNull();
    expect(parseFabraryDeckUrl(`http://fabrary.net/decks/${DECK_ID}`)).toBeNull();
  });
});

describe("Fabrary response decoding", () => {
  it("translates identifiers, quantities, and sideboard quantities to export text", () => {
    const source = parseFabraryDeckUrl(DECK_URL);
    if (!source) throw new Error("test URL should parse");
    expect(decodeFabraryDeck({
      name: "Rhinar test",
      format: "cc",
      cards: [
        { identifier: "rhinar_reckless_rampage", total: 1 },
        { identifier: "sink_below_red", total: 3, sideboardTotal: 1 },
        { cardIdentifier: "future_card_blue", total: 0, sideboardTotal: 2 },
      ],
    }, source)).toEqual({
      canonicalUrl: DECK_URL,
      name: "Rhinar test",
      matchups: [],
      text: [
        "Name: Rhinar test",
        "Deck cards",
        "1x Rhinar, Reckless Rampage",
        "3x Sink Below (1)",
        "Sideboard cards",
        "1x Sink Below (1)",
        "2x future card (3)",
      ].join("\n"),
    });
  });

  it("decodes bounded matchup options and normalizes turn preferences", () => {
    const source = parseFabraryDeckUrl(DECK_URL);
    if (!source) throw new Error("test URL should parse");
    expect(decodeFabraryDeck({
      name: "Rhinar plans",
      cards: [{ identifier: "rhinar_reckless_rampage", total: 1 }],
      matchups: [{
        matchupId: "bravo-plan",
        name: "Into Bravo",
        heroIdentifiers: ["bravo_showstopper"],
        preferredTurnOrder: "First",
        notes: "Bring the poppers.",
      }],
    }, source)?.matchups).toEqual([{
      id: "bravo-plan",
      name: "Into Bravo",
      heroIdentifiers: ["bravo_showstopper"],
      preferredTurnOrder: "first",
      notes: "Bring the poppers.",
    }]);
  });

  it("resolves Fabrary's double-hyphen meld identifiers", () => {
    const source = parseFabraryDeckUrl(DECK_URL);
    if (!source) throw new Error("test URL should parse");
    expect(decodeFabraryDeck({
      name: "Aurora Ascended",
      cards: [
        { identifier: "burn-up--shock-red", name: "Burn Up // Shock", total: 3, sideboardTotal: 0 },
        { identifier: "vaporize--shock-yellow", name: "Vaporize // Shock", total: 0, sideboardTotal: 2 },
      ],
    }, source)?.text).toBe([
      "Name: Aurora Ascended",
      "Deck cards",
      "3x Burn Up // Shock (1)",
      "Sideboard cards",
      "2x Vaporize // Shock (2)",
    ].join("\n"));
  });

  it("resolves Fabrary's purple pitch identifier", () => {
    const source = parseFabraryDeckUrl(DECK_URL);
    if (!source) throw new Error("test URL should parse");
    expect(decodeFabraryDeck({
      name: "Levia test",
      cards: [
        { identifier: "soul_of_existence_purple", total: 1, sideboardTotal: 0 },
      ],
    }, source)?.text).toBe([
      "Name: Levia test",
      "Deck cards",
      "1x Soul of Existence (4)",
    ].join("\n"));
  });

  it("rejects malformed or unbounded card data", () => {
    const source = parseFabraryDeckUrl(DECK_URL);
    if (!source) throw new Error("test URL should parse");
    expect(decodeFabraryDeck({ name: "Deck", cards: [{ identifier: "sink_below_red", total: "3" }] }, source))
      .toBeNull();
    expect(decodeFabraryDeck({ name: "Deck", cards: [{ identifier: "sink_below_red", total: 100 }] }, source))
      .toBeNull();
  });
});

describe("Fabrary API client", () => {
  it("calls the fixed endpoint with the API key header", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      name: "API deck",
      cards: [{ identifier: "rhinar_reckless_rampage", total: 1 }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await createFabraryClient("secret-key", fetcher).fetchDeck(DECK_URL);

    expect(result).toMatchObject({ ok: true, deck: { name: "API deck", canonicalUrl: DECK_URL } });
    expect(fetcher).toHaveBeenCalledWith(
      `https://atofkpq0x8.execute-api.us-east-2.amazonaws.com/prod/v1/decks/${DECK_ID}`,
      expect.objectContaining({
        headers: { Accept: "application/json", "x-api-key": "secret-key" },
        redirect: "error",
      }),
    );
  });

  it("requests a selected matchup from the same fixed API endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      name: "API deck",
      cards: [{ identifier: "rhinar_reckless_rampage", total: 1 }],
    }), { status: 200 }));
    await createFabraryClient("secret-key", fetcher).fetchDeck(DECK_URL, "bravo-plan");

    expect(fetcher).toHaveBeenCalledWith(
      `https://atofkpq0x8.execute-api.us-east-2.amazonaws.com/prod/v1/decks/${DECK_ID}?matchupId=bravo-plan`,
      expect.any(Object),
    );
  });

  it("reports provider failures without exposing response bodies", async () => {
    const fetcher = vi.fn(async () => new Response("private upstream detail", { status: 403 }));
    await expect(createFabraryClient("bad-key", fetcher).fetchDeck(DECK_URL)).resolves.toEqual({
      ok: false,
      status: 502,
      error: "Fabrary rejected the deck request",
    });
  });

  it("does not make a request when the API key is missing", async () => {
    const fetcher = vi.fn();
    await expect(createFabraryClient("", fetcher).fetchDeck(DECK_URL)).resolves.toEqual({
      ok: false,
      status: 503,
      error: "Fabrary import is not configured",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
