import { describe, expect, it } from "vitest";
import type { ActivatedAbility, CardScript } from "@fyendal/engine";
import { cardList, isImplemented, scripts } from "../index.js";

function abilitiesOf(script: CardScript | undefined): ActivatedAbility[] {
  if (!script?.activated) return [];
  return Array.isArray(script.activated) ? script.activated : [script.activated];
}

/** Equipment and weapon self-destruction printed before the ability's colon
 * is an activation cost. A delayed instruction such as Kunai of Retribution's
 * "destroy this when the combat chain closes" is part of attack resolution. */
function hasPrintedDestroySelfCost(name: string, text: string): boolean {
  const normalizedName = name.toLowerCase();
  return text.toLowerCase().split("\n").some((line) => {
    if (!/^(?:once per turn )?(?:action|instant|attack reaction|defense reaction)\s*[-—:]/.test(line)) {
      return false;
    }
    const costClause = line.split(":", 1)[0] ?? "";
    if (/destroy this when\b/.test(costClause)) return false;
    return costClause.includes("destroy this") ||
      costClause.includes(`destroy ${normalizedName}`);
  });
}

describe("activated ability cost audit", () => {
  it("declares printed equipment and weapon self-destruction as an activation cost", () => {
    const mismatches = cardList
      .filter((card) =>
        (card.cardType === "equipment" || card.cardType === "weapon") &&
        isImplemented(card) &&
        hasPrintedDestroySelfCost(card.name, card.text)
      )
      .filter((card) =>
        !abilitiesOf(scripts[card.id]).some((ability) => ability.destroySelfCost === true)
      )
      .map((card) => `${card.name}|${card.pitch ?? 0}`)
      .filter((key, index, keys) => keys.indexOf(key) === index)
      .sort();

    expect(mismatches).toEqual([]);
  });
});
