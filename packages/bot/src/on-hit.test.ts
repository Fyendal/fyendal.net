import { describe, expect, it } from "vitest";
import { evaluateOnHit, type OnHitValueContext } from "./on-hit.js";

const base: Omit<OnHitValueContext, "effects"> = {
  sourceText: "",
  attackerCanContinue: false,
  attackerCanArsenal: false,
  defenderHasHand: true,
  defenderHasArsenal: true,
};

function value(text: string, context: Partial<OnHitValueContext> = {}): number {
  return evaluateOnHit({ ...base, ...context, effects: [{ text }] }).value;
}

function categories(text: string): readonly string[] {
  return evaluateOnHit({ ...base, effects: [{ text }] }).categories;
}

const BONDS = "When this hits a hero, look at their hand and choose a card. Search their hand, deck, and " +
  "graveyard and banish up to 3 cards with the same name as the chosen card. They shuffle.\"";
const SURGICAL = "When this hits a hero, banish the top card of their deck, then look at their hand and banish a card.";
const COMMAND = "When this hits a hero, destroy all cards in their arsenal.";
const RANDOM = "When this hits a hero, they discard a random card.";
const PUMMEL = "When this hits a hero, they discard a card.\"";
const MARK = "When this hits a hero, mark them.";
const DIG = "When this hits, destroy this zombie.\"";

describe("on-hit valuation", () => {
  it("ranks informed disruption highest and self-destruction lowest", () => {
    const ranked = [BONDS, SURGICAL, COMMAND, RANDOM, PUMMEL, MARK, DIG].map((text) => value(text));
    expect(ranked).toEqual([...ranked].sort((left, right) => right - left));
    expect(new Set(ranked).size).toBe(ranked.length);
    expect(value(DIG)).toBeLessThan(0);
  });

  it.each([
    [BONDS, ["informed-disruption"]],
    [SURGICAL, ["informed-disruption", "deck-disruption"]],
    [COMMAND, ["arsenal-disruption"]],
    [RANDOM, ["random-disruption"]],
    [PUMMEL, ["forced-discard"]],
    ["When this hits a hero, they banish face-down a card from their hand.", ["forced-discard"]],
    ["When this hits, draw a card.", ["card-advantage"]],
    ["If this hits, search your deck for a card named Sun Kiss, reveal it, put it into your hand.", ["card-advantage"]],
    ["If Searing Shot hits a hero, they lose 1{h}.", ["damage"]],
    ["When this hits a hero, create a Frostbite token under their control.", ["debuff-token"]],
    ["When this hits a hero, put a -1{d} counter on an equipment they control.", ["equipment-damage"]],
    ["When this hits, create a Gold token.", ["resource-token"]],
    ["When this hits, it gets go again.", ["tempo"]],
    ["When this hits, your next attack this turn gets +1{p}.", ["pump"]],
    [MARK, ["mark"]],
    ["When this hits a hero, banish the top card of their deck.", ["deck-disruption"]],
    [DIG, ["self-destruction"]],
    ["When this hits, something unprecedented happens.", ["unclassified"]],
  ])("classifies %s", (text, expected) => {
    expect(categories(text)).toEqual(expected);
  });

  it("values disruption only when the defender has something to lose", () => {
    expect(value(RANDOM, { defenderHasHand: false })).toBe(0);
    expect(value(COMMAND, { defenderHasArsenal: false })).toBe(0);
    expect(value(SURGICAL, { defenderHasHand: false })).toBeLessThan(1);
  });

  it("prices card draw higher when the attacker can convert it", () => {
    expect(value("When this hits, draw a card.")).toBe(3);
    expect(value("When this hits, draw a card.", { attackerCanContinue: true })).toBe(4);
    expect(value("When this hits a hero, create a Bloodrot Pox token under their control.")).toBe(2);
  });

  it("returns impact tags without consulting hidden zones", () => {
    const evaluation = evaluateOnHit({
      ...base,
      effects: [
        { text: "When this hits, draw a card." },
        { text: "The defending hero discards 2 cards from their hand." },
        { text: "Destroy a card in the defending hero's arsenal." },
        { text: "Create a Bloodrot Pox token." },
        { text: "Put a -1 defense counter on an equipment they control." },
      ],
    });

    expect(evaluation).toMatchObject({
      cardDraw: 1,
      delayedDamage: 2,
      handCardsLost: 2,
      destroysOccupiedArsenal: true,
      equipmentDamage: true,
      tokenCreation: true,
    });
  });

  it("reports who selects lost hand cards, keeping the harshest selector", () => {
    expect(evaluateOnHit({
      ...base,
      effects: [{ text: "When this hits a hero, they banish a card from their hand." }],
    })).toMatchObject({ handCardsLost: 1, handLossValue: 3.25 * 0.75, handLossSelector: "defender" });
    expect(evaluateOnHit({
      ...base,
      effects: [
        { text: "They banish a card from their hand." },
        { text: "The defending hero discards a random card from their hand." },
      ],
    })).toMatchObject({ handCardsLost: 2, handLossSelector: "random" });
    const empty = evaluateOnHit({
      ...base,
      defenderHasHand: false,
      effects: [{ text: "They banish a card from their hand." }],
    });
    expect(empty).toMatchObject({ handCardsLost: 0, handLossValue: 0 });
    expect(empty.handLossSelector).toBeUndefined();
  });

  it("falls back to structured impact when the text is not recognized", () => {
    expect(evaluateOnHit({
      ...base,
      effects: [{
        text: "Localized display text",
        impact: { drawCards: 2, discardCards: 1, destroysArsenal: true },
      }],
    })).toMatchObject({
      value: 2 * 3 + 3.25 * 0.75 + 4,
      cardDraw: 2,
      handCardsLost: 1,
      destroysOccupiedArsenal: true,
    });
  });
});
