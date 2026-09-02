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

  it("gives every distinct ability on a multi-ability card an explicit label", () => {
    for (const [key, script] of Object.entries(registry)) {
      if (!Array.isArray(script.activated) || script.activated.length < 2) continue;
      for (const [index, ability] of script.activated.entries()) {
        expect(ability.label, `${key} ability ${index + 1}`).toBeTruthy();
      }
    }
  });

  it.each([
    ["jolly bludger|2", 3],
    ["cogwerx dovetail|1", 3],
    ["palantir aeronought|1", 3],
  ])("models %s as one printed ability usable %i times per turn", (key, limit) => {
    const activated = registry[key]!.activated;
    expect(Array.isArray(activated)).toBe(false);
    expect(activated && !Array.isArray(activated) ? activated.activationsPerTurn : undefined)
      .toBe(limit);
  });

  it.each([
    "cloud skiff|1",
    "cloud skiff|2",
    "cloud skiff|3",
    "sky skimmer|1",
    "sky skimmer|2",
    "sky skimmer|3",
    "backspin thrust|1",
  ])("models %s's modal text as one once-per-turn ability", (key) => {
    const activated = registry[key]!.activated;
    expect(Array.isArray(activated)).toBe(false);
    expect(activated && !Array.isArray(activated) ? activated.oncePerTurn : undefined)
      .toBe(true);
  });

  it("models Adaptive Plating and Beckoning Haunt as single abilities", () => {
    const adaptive = registry["adaptive plating|0"]!.activated;
    const beckoning = registry["beckoning haunt|0"]!.activated;
    expect(Array.isArray(adaptive)).toBe(false);
    expect(adaptive && !Array.isArray(adaptive) ? adaptive.oncePerTurn : undefined)
      .toBeUndefined();
    expect(Array.isArray(beckoning)).toBe(false);
    expect(beckoning && !Array.isArray(beckoning) ? beckoning.variableCost : undefined)
      .toMatchObject({ base: 1, resourcesPerX: 2, counterKey: "beckoningX" });
  });
});
