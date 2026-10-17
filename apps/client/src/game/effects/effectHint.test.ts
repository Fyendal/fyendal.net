import { describe, expect, it } from "vitest";
import { effectHintAttributes, readEffectHint, sameEffectHint, type EffectHint } from "./effectHint.js";

/** How the browser exposes data-* attributes on `dataset`. */
function dataset(attributes: Record<string, string>): DOMStringMap {
  return Object.fromEntries(Object.entries(attributes).map(([name, value]) => [
    name.slice("data-".length).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    value,
  ]));
}

describe("effect hints", () => {
  it("round-trips through chip data attributes", () => {
    const hint: EffectHint = {
      summary: "Can't draw cards",
      duration: "Next turn",
      icon: "effect-later",
      count: 2,
      imposedBy: "Briar",
      inactive: true,
    };
    const read = readEffectHint(dataset(effectHintAttributes(hint)));
    expect(read).toEqual(hint);
    expect(sameEffectHint(hint, read)).toBe(true);
  });

  it("ignores elements that are not effect chips or carry an unknown glyph", () => {
    expect(readEffectHint({ cardid: "WTR160" })).toBeUndefined();
    expect(readEffectHint({ effectSummary: "x", effectDuration: "y", effectIcon: "close" })).toBeUndefined();
  });
});
