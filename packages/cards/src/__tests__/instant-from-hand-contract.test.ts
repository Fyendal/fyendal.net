import { describe, expect, it } from "vitest";
import type { ActivatedAbility, CardScript } from "@fyendal/engine";
import { cardList, isImplemented, scripts } from "../index.js";

function abilitiesOf(script: CardScript | undefined): ActivatedAbility[] {
  if (!script?.activated) return [];
  return Array.isArray(script.activated) ? script.activated : [script.activated];
}

/** Action cards with an "Instant - Discard this" mode are usable directly
 * from hand. The client relies on the engine exposing that mode as a separate
 * activate-ability intent so it can distinguish it from playing the card. */
function hasPrintedDiscardFromHandInstant(text: string | undefined): boolean {
  return /(?:^|\n)(?:Once per Turn )?Instant\s*[-—:][^\n]*discard this\b/i.test(text ?? "");
}

describe("action cards with from-hand instant abilities", () => {
  it("register every implemented printed mode as an instant from-hand ability", () => {
    const mismatches = cardList
      .filter((card) =>
        card.cardType === "action" &&
        isImplemented(card) &&
        hasPrintedDiscardFromHandInstant(card.text)
      )
      .filter((card) =>
        !abilitiesOf(scripts[card.id]).some(
          (ability) => ability.timing === "instant" && ability.fromHand === true,
        )
      )
      .map((card) => `${card.name}|${card.pitch ?? 0}`)
      .filter((key, index, keys) => keys.indexOf(key) === index)
      .sort();

    expect(mismatches).toEqual([]);
  });
});
