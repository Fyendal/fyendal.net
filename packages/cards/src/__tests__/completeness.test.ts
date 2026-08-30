import { describe, expect, it } from "vitest";
import type { CardData } from "@fyendal/shared";
import { functionalKeyOf } from "../functional.js";
import { cardData } from "../index.js";
import { registry } from "../scripts/index.js";
import vanilla from "../data/vanilla.json" with { type: "json" };

/**
 * Completeness gate: every functional card in the data pool must be accounted
 * for — either it has a script in the registry, or it is listed in
 * data/vanilla.json (human-curated: provably no rules text beyond what the
 * engine's keyword handling already implements). vanilla.json must not
 * contain stale entries (keys no longer in the data, or keys that now have
 * scripts).
 */
const printings = Object.values(cardData) as CardData[];
const dataKeys = new Set(printings.map((c) => functionalKeyOf(c)));
const vanillaKeys = new Set(Object.keys(vanilla));
const functionalCards = new Map<string, CardData>();
for (const card of printings) functionalCards.set(functionalKeyOf(card), card);

function keysWithKeyword(keyword: string): string[] {
  const normalized = keyword.toLowerCase();
  return [...functionalCards]
    .filter(([, card]) => (card.keywords ?? []).some(
      (candidate) => candidate.trim().toLowerCase() === normalized,
    ))
    .map(([key]) => key)
    .sort();
}

function hasStandaloneKeywordLine(card: CardData, keyword: string): boolean {
  const normalized = keyword.toLowerCase();
  return card.text.split("\n").some(
    (line) => line.trim().replace(/\.$/, "").toLowerCase() === normalized,
  );
}

describe("script completeness", () => {
  it("every functional key has a script or is curated as vanilla", () => {
    const uncovered = [...dataKeys].filter(
      (key) => !(key in registry) && !vanillaKeys.has(key),
    );
    expect(uncovered).toEqual([]);
  });

  it("no scripted key is also listed as vanilla", () => {
    const both = [...vanillaKeys].filter((key) => key in registry);
    expect(both).toEqual([]);
  });

  it("no stale vanilla entries: every listed key exists in the card data", () => {
    const stale = [...vanillaKeys].filter((key) => !dataKeys.has(key));
    expect(stale).toEqual([]);
  });

  it("every Combo card has a functional script", () => {
    const missing = keysWithKeyword("Combo").filter((key) => !(key in registry));
    expect(missing).toEqual([]);
  });

  it("vanilla entries carry no functional text beyond their keyword lines", () => {
    const offenders: string[] = [];
    for (const key of vanillaKeys) {
      const card = printings.find((c) => functionalKeyOf(c) === key)!;
      const kws = (card.keywords ?? []).map((k) => k.toLowerCase());
      const lines = card.text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const ok = lines.every((l) => {
        const norm = l.replace(/\.$/, "").toLowerCase();
        return kws.some(
          (k) => norm === k || norm === `when this attacks, ${k}`,
        );
      });
      if (!ok) offenders.push(`${key}: ${JSON.stringify(card.text)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("marks every printed Stealth card with Stealth keyword metadata", () => {
    const missing = printings
      .filter((card) =>
        hasStandaloneKeywordLine(card, "Stealth") &&
        !(card.keywords ?? []).some(
          (keyword) => keyword.trim().toLowerCase() === "stealth",
        )
      )
      .map((card) => card.id)
      .sort();
    const unexpected = printings
      .filter((card) =>
        (card.keywords ?? []).some(
          (keyword) => keyword.trim().toLowerCase() === "stealth",
        ) && !hasStandaloneKeywordLine(card, "Stealth")
      )
      .map((card) => card.id)
      .sort();

    expect({ missing, unexpected }).toEqual({ missing: [], unexpected: [] });
  });

  it("every Rune Gate card declares the Rune Gate script marker", () => {
    const missing = keysWithKeyword("Rune Gate").filter(
      (key) => registry[key]?.runeGate !== true,
    );
    expect(missing).toEqual([]);
  });

  it("printed card-play triggered abilities use card-played stack layers", () => {
    const printedCardPlayTrigger = /(?:whenever you play|when you play|when this is played|the (?:first|second|third) time you play)/i;
    const engineManaged = new Set([
      // The hit creates a duration-based delayed effect represented by an
      // engine stack layer because its source no longer controls the trigger.
      "remorseless|1",
    ]);
    const missing = [...functionalCards]
      .filter(([, card]) => printedCardPlayTrigger.test(card.text))
      .filter(([key]) => !engineManaged.has(key))
      .filter(([key]) => registry[key]?.triggers?.some(
        (trigger) => trigger.event === "card-played",
      ) !== true)
      .map(([key]) => key)
      .sort();

    expect(missing).toEqual([]);
  });

  it("Rune Gate script markers correspond to printed Rune Gate cards", () => {
    const printed = new Set(keysWithKeyword("Rune Gate"));
    const unexpected = Object.entries(registry)
      .filter(([key, script]) => script?.runeGate === true && !printed.has(key))
      .map(([key]) => key)
      .sort();
    expect(unexpected).toEqual([]);
  });

  it("every Blood Debt card declares its public-banish end-phase trigger", () => {
    const missing = keysWithKeyword("Blood Debt").filter((key) =>
      registry[key]?.triggers?.some(
        (trigger) => trigger.event === "end-of-turn" && trigger.sourceZone === "banish",
      ) !== true
    );
    expect(missing).toEqual([]);
  });

  it("Blood Debt life-loss triggers correspond to printed Blood Debt cards", () => {
    const printed = new Set(keysWithKeyword("Blood Debt"));
    const unexpected = Object.entries(registry)
      .filter(([key, script]) =>
        script?.triggers?.some(
          (trigger) =>
            trigger.event === "end-of-turn" &&
            trigger.sourceZone === "banish" &&
            trigger.label === "Blood Debt — lose 1 life",
        ) === true && !printed.has(key)
      )
      .map(([key]) => key)
      .sort();
    expect(unexpected).toEqual([]);
  });
});
