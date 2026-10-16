import { beforeAll, describe, expect, it } from "vitest";
import { type SweptEffect, sweepPlayedCardEffects } from "../../../../../packages/cards/src/__tests__/ongoingSweep.js";
import { createTestIntl } from "../../i18n/TestI18nProvider.js";
import { effectText } from "./effectModel.js";

describe("projected lingering effects", () => {
  let swept: SweptEffect[] = [];
  const intl = createTestIntl("en");

  // Plays about 1,300 cards, so it gets a generous budget.
  beforeAll(() => {
    swept = sweepPlayedCardEffects();
  }, 300_000);

  it("covers a broad sample of the registry", () => {
    expect(new Set(swept.map(({ key }) => key)).size).toBeGreaterThan(200);
  });

  it("render through the English catalog exactly as the engine's English fallback", () => {
    const mismatches = swept.flatMap(({ key, effect }) => {
      const rendered = effectText(intl, effect);
      return [
        ...(effect.summaryMessage && rendered.summary !== effect.summary
          ? [{ key, engine: effect.summary, catalog: rendered.summary }]
          : []),
        ...(effect.durationMessage && rendered.duration !== effect.duration
          ? [{ key, engine: effect.duration, catalog: rendered.duration }]
          : []),
      ];
    });
    expect(mismatches).toEqual([]);
  });

  it("describe what they do", () => {
    expect(swept
      .filter(({ effect }) => effect.summaryMessage?.id === "engine.effect.summary.ongoing")
      .map(({ key, effect }) => `${key}: ${effect.label}`)).toEqual([]);
  });

  it("carry semantic messages", () => {
    expect(swept
      .filter(({ effect }) => !effect.summaryMessage || !effect.durationMessage)
      .map(({ key, effect }) => `${key}: ${effect.label}`)).toEqual([]);
  });
});
