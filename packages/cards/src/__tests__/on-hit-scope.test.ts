import { describe, expect, it } from "vitest";
import { cardData, scripts } from "../index.js";
import { functionalKeyOf } from "../functional.js";
import { friendlyHitSourceKeys } from "../on-hit-scope.js";

describe("on-hit source scopes", () => {
  it("classifies every non-attacking hit observer and limits attack exceptions", () => {
    const seen = new Set<string>();
    const attackExceptions = new Set<string>();
    for (const [id, script] of Object.entries(scripts)) {
      if (!script.onHit) continue;
      const card = cardData[id]!;
      const key = functionalKeyOf(card);
      seen.add(key);
      if (card.attack === undefined) {
        expect(script.onHitScope, key).toBe("friendly");
      }
      if (card.attack !== undefined && script.onHitScope === "friendly") {
        attackExceptions.add(card.name.toLowerCase());
      }
    }

    expect([...friendlyHitSourceKeys].filter((key) => !seen.has(key))).toEqual([]);
    expect([...attackExceptions].sort()).toEqual([
      "beckoning light",
      "blizzard bolt",
      "buzz bolt",
      "chilling icevein",
      "poisoned blade",
    ]);
  });
});
