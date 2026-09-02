import { describe, expect, it } from "vitest";
import type { CardData } from "@fyendal/shared";
import type { CardScript } from "@fyendal/engine";
import { functionalKey, functionalKeyOf } from "../functional.js";
import { expandScripts, cardData, scripts } from "../index.js";
import { registry } from "../scripts/index.js";
import { localizedCardLog, localizedLog } from "../scripts/shared-helpers.js";

function fakeCard(id: string, name: string, pitch?: number): CardData {
  return { id, name, cardType: "action", text: "", ...(pitch !== undefined ? { pitch: pitch as 1 | 2 | 3 } : {}) };
}

describe("functional keys", () => {
  it("normalizes case and whitespace", () => {
    expect(functionalKey("Wrecker Romp", 3)).toBe("wrecker romp|3");
    expect(functionalKey("  Wrecker   Romp ", 3)).toBe("wrecker romp|3");
    expect(functionalKey("Dawnblade, Resplendent")).toBe("dawnblade, resplendent|0");
  });

  it("distinguishes pitch variants", () => {
    expect(functionalKey("Wrecker Romp", 1)).not.toBe(functionalKey("Wrecker Romp", 3));
  });
});

describe("localized card logs", () => {
  it("keeps fallback, typed values, and machine events in one reusable payload", () => {
    expect(localizedLog(
      "Test Card reveals Attack",
      "card.log.test.reveal",
      {
        card: { kind: "card", cardId: "SOURCE" },
        revealed: { kind: "card", cardId: "TARGET" },
      },
      {
        kind: "cards-revealed",
        cards: [{ cardId: "TARGET", ownerSeat: 0 }],
        sourceZone: "deck",
      },
    )).toEqual({
      fallback: "Test Card reveals Attack",
      message: {
        id: "card.log.test.reveal",
        values: {
          card: { kind: "card", cardId: "SOURCE" },
          revealed: { kind: "card", cardId: "TARGET" },
        },
      },
      event: {
        kind: "cards-revealed",
        cards: [{ cardId: "TARGET", ownerSeat: 0 }],
        sourceZone: "deck",
      },
    });
  });

  it("adds the script source card without repeating it at every producer", () => {
    expect(localizedCardLog(
      { self: { cardId: "SOURCE" } } as Parameters<typeof localizedCardLog>[0],
      "Test Card gets +2 attack",
      "card.log.test.attack",
      { amount: 2 },
    )).toEqual({
      fallback: "Test Card gets +2 attack",
      message: {
        id: "card.log.test.attack",
        values: {
          amount: 2,
          card: { kind: "card", cardId: "SOURCE" },
        },
      },
    });
  });
});

describe("script expansion", () => {
  it("maps two printings with the same functional identity to the same script object", () => {
    const script: CardScript = {
      onPlay(ctx) {
        ctx.logPublic({
          fallback: "romp",
          message: { id: "card.test.romp" },
        });
      },
    };
    const fakeRegistry: Record<string, CardScript> = { "wrecker romp|3": script };
    const printings = [
      fakeCard("RNR023", "Wrecker Romp", 3),
      fakeCard("FAB999", "Wrecker Romp", 3), // hypothetical reprint
      fakeCard("XXX000", "Unscripted Card", 1),
    ];
    const expanded = expandScripts(printings, fakeRegistry);
    expect(expanded["RNR023"]).toBe(script);
    expect(expanded["FAB999"]).toBe(script);
    expect(expanded["XXX000"]).toBeUndefined();
  });

  it("resolves every real scripted printing through the registry", () => {
    for (const [printingId, script] of Object.entries(scripts)) {
      const key = functionalKeyOf(cardData[printingId]!);
      expect(registry[key], `registry has ${key}`).toBeDefined();
      expect(script).toBe(registry[key]);
    }
  });
});
