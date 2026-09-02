import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHOOSE_X_PROMPT,
  scriptPromptParts,
  soulBanishCostPrompt,
} from "../scriptPresentation.js";

describe("script decision presentation", () => {
  it("keeps localized option messages aligned with final engine option order", () => {
    expect(scriptPromptParts({
      fallback: "Choose a mode",
      message: { id: "card.test.mode.choose" },
      optionMessagesByValue: {
        first: { id: "card.test.mode.first" },
        third: { id: "card.test.mode.third" },
      },
    }, ["third", "second", "first"])).toEqual({
      fallback: "Choose a mode",
      promptMessage: { id: "card.test.mode.choose" },
      optionMessages: [
        { id: "card.test.mode.third" },
        null,
        { id: "card.test.mode.first" },
      ],
    });
  });

  it("provides semantic defaults for X and soul-cost decisions", () => {
    expect(scriptPromptParts(DEFAULT_CHOOSE_X_PROMPT)).toEqual({
      fallback: "Choose X",
      promptMessage: { id: "engine.decision.x.choose" },
    });
    expect(soulBanishCostPrompt("Prism", "HERO-PRISM", 2, 3)).toEqual({
      fallback: "Prism: choose soul card 2 of 3 to banish as a cost",
      message: {
        id: "engine.decision.soul.banishcost",
        values: {
          card: { kind: "card", cardId: "HERO-PRISM" },
          current: 2,
          total: 3,
        },
      },
    });
  });
});
