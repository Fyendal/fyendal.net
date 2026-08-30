import { describe, expect, it } from "vitest";
import type { CardScript } from "@fyendal/engine";
import { cardList } from "../catalog.js";
import { functionalKeyOf } from "../functional.js";
import { registry } from "../scripts/index.js";

type AnyFunction = (...args: never[]) => unknown;

function functionsIn(value: unknown, seen = new Set<unknown>()): AnyFunction[] {
  if (typeof value === "function") return [value as AnyFunction];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((entry) => functionsIn(entry, seen));
}

const dataByKey = new Map(cardList.map((card) => [functionalKeyOf(card), card]));

describe("discard implementation audit", () => {
  it("uses seeded random discard only when the printed text says random", () => {
    for (const [key, script] of Object.entries(registry)) {
      if (!script) continue;
      const directlyUsesRandomDiscard = functionsIn(script).some((fn) =>
        fn.toString().includes("discardRandom"),
      );
      if (!directlyUsesRandomDiscard) continue;
      const text = dataByKey.get(key)?.text.toLowerCase() ?? "";
      expect(text, `${key} calls discardRandom`).toContain("discard");
      expect(text, `${key} calls discardRandom`).toContain("random");
    }
  });

  it("marks every scripted random-discard additional cost as requiring a hand card", () => {
    for (const [key, script] of Object.entries(registry)) {
      if (!script) continue;
      const additionalCost = (script as CardScript).additionalCost;
      if (!additionalCost || !additionalCost.toString().includes("discardRandom")) continue;
      expect(
        script.requiredHandCardsForAdditionalCost,
        `${key} must reserve its random-discard cost card after pitching`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
