import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { EffectChips, stackOngoingEffects } from "./EffectChips.js";

describe("stackOngoingEffects", () => {
  it("collapses only effects with the same seat, card, and label", () => {
    const effects = [
      { seat: 0, cardId: "WTR160", label: "+1 attack · next attack" },
      { seat: 0, cardId: "WTR160", label: "+1 attack · next attack" },
      { seat: 0, cardId: "WTR160", label: "Go again · next attack" },
      { seat: 0, cardId: "WTR161", label: "+1 attack · next attack" },
      { seat: 1, cardId: "WTR160", label: "+1 attack · next attack" },
    ];

    expect(stackOngoingEffects(effects).map(({ effect, count }) => ({ effect, count }))).toEqual([
      { effect: effects[0], count: 2 },
      { effect: effects[2], count: 1 },
      { effect: effects[3], count: 1 },
      { effect: effects[4], count: 1 },
    ]);
  });
});

describe("EffectChips", () => {
  it("renders identical lingering effects as one counted card stack", () => {
    const html = renderToStaticMarkup(createElement(
      TestI18nProvider,
      null,
      createElement(EffectChips, {
        area: "3 / 2 / 4 / 4",
        effects: [
          { seat: 0, cardId: "WTR160", label: "+1 attack · next attack" },
          { seat: 0, cardId: "WTR160", label: "+1 attack · next attack" },
        ],
      }),
    ));

    expect(html.match(/WTR160\.webp/g)).toHaveLength(1);
    expect(html).toContain('loading="eager"');
    expect(html).toContain("effect-mini-stacked");
    expect(html).toContain("×2");
    expect(html).toContain("+1 attack · next attack ×2");
  });
});
