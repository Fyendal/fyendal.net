import { describe, expect, it } from "vitest";
import {
  decisionMessage,
  decisionPrompt,
  yesNoPrompt,
} from "../scripts/shared-helpers.js";

describe("card-script decision presentation", () => {
  it("constructs prompt-only metadata with optional interpolation values", () => {
    expect(decisionPrompt(
      "Choose a target",
      "card.test.target.choose",
      { values: { amount: 2, optional: true } },
    )).toEqual({
      fallback: "Choose a target",
      message: {
        id: "card.test.target.choose",
        values: { amount: 2, optional: true },
      },
    });
  });

  it("supports dynamic and partially localized options keyed by stable value", () => {
    const prompt = decisionPrompt("Choose a target", "card.test.target.choose", {
      optionMessages: {
        "hero:1": decisionMessage("card.test.target.card", {
          card: { kind: "card", cardId: "HERO1" },
        }),
      },
    });

    expect(prompt.optionMessagesByValue).toEqual({
      "hero:1": {
        id: "card.test.target.card",
        values: { card: { kind: "card", cardId: "HERO1" } },
      },
    });
  });

  it("provides reusable yes/no option messages", () => {
    expect(yesNoPrompt("Use the effect?", "card.test.effect.use"))
      .toEqual({
        fallback: "Use the effect?",
        message: { id: "card.test.effect.use" },
        optionMessagesByValue: {
          yes: { id: "common.option.yes" },
          no: { id: "common.option.no" },
        },
      });
  });
});
