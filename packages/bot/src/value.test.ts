import { describe, expect, it } from "vitest";
import {
  evaluateOnHit,
  expectedOnHitValue,
  lifeThresholdRisk,
  valueBreakdown,
} from "./value.js";

describe("damage-equivalent value", () => {
  it("adds threatened, prevented, and future value while subtracting costs", () => {
    expect(valueBreakdown({
      damageThreatened: 7,
      damagePrevented: 3,
      onHitValue: 2,
      arsenalValue: 1,
      equipmentCost: 1,
      overblockCost: 1.5,
      lifeThresholdRisk: 0.5,
    }).total).toBe(10);
  });

  it("prices public on-hits by their expected effect instead of a fixed bonus", () => {
    const base = {
      sourceText: "",
      attackerCanContinue: false,
      attackerCanArsenal: false,
      defenderHasHand: true,
      defenderHasArsenal: true,
    };
    const bloodrot = expectedOnHitValue({
      ...base,
      effects: [{ text: "When this hits, create a Bloodrot Pox token." }],
    });
    const convertibleDraw = expectedOnHitValue({
      ...base,
      attackerCanContinue: true,
      effects: [{ text: "When this hits, draw a card." }],
    });

    expect(bloodrot).toBe(2);
    expect(convertibleDraw).toBe(4);
  });

  it("returns impact tags without consulting hidden zones", () => {
    const evaluation = evaluateOnHit({
      sourceText: "",
      attackerCanContinue: false,
      attackerCanArsenal: false,
      defenderHasHand: true,
      defenderHasArsenal: true,
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

  it("prefers structured public impact over display-text parsing", () => {
    expect(evaluateOnHit({
      sourceText: "",
      attackerCanContinue: false,
      attackerCanArsenal: false,
      defenderHasHand: true,
      defenderHasArsenal: true,
      effects: [{
        text: "Localized display text",
        impact: { drawCards: 2, discardCards: 1, destroysArsenal: true },
      }],
    })).toMatchObject({
      value: 13,
      cardDraw: 2,
      handCardsLost: 1,
      destroysOccupiedArsenal: true,
    });
  });

  it("charges nonlinear risk only after crossing low-life breakpoints", () => {
    expect(lifeThresholdRisk(5)).toBe(0);
    expect(lifeThresholdRisk(4)).toBe(1);
    expect(lifeThresholdRisk(2)).toBe(2.5);
    expect(lifeThresholdRisk(1)).toBe(4);
  });
});
