import { describe, expect, it } from "vitest";
import { cardList, scripts } from "../index.js";
import snapshot from "./printed-types.json" with { type: "json" };

// Regenerate with `node scripts/snapshot-printed-types.mjs <fabrary version>`.
const printed = new Map(
  Object.entries(snapshot.types).flatMap(([types, names]) =>
    names.map((name) => [name, types.split(",")] as const)),
);

describe("printed card types", () => {
  it("every card lists all of its printed types", () => {
    const mismatches: string[] = [];
    let checked = 0;
    for (const card of cardList) {
      const expected = printed.get(card.name.toLowerCase());
      if (!expected) continue;
      checked++;
      // Meld halves keep their own types in the script; the card is an instant.
      const want = scripts[card.id]?.meld ? ["instant"] : expected;
      if (card.types.join(",") !== want.join(",")) {
        mismatches.push(`${card.id} ${card.name}: ${card.types.join(",")} (printed ${expected.join(",")})`);
      }
    }
    expect(checked).toBeGreaterThan(3000);
    expect(mismatches).toEqual([]);
  });
});
