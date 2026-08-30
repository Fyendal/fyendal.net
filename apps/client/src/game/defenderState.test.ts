import { describe, expect, it } from "vitest";
import type { ChainLinkView } from "@fyendal/shared";
import { chainDefenderIds } from "./defenderState.js";

function link(attackerId: number, defenderIds: number[]): ChainLinkView {
  return {
    attackingCard: { instanceId: attackerId, cardId: "ATTACK", owner: 0 },
    defendingCards: defenderIds.map((instanceId) => ({
      instanceId,
      cardId: "EQUIPMENT",
      owner: 1,
    })),
    attackValue: 3,
    defenseValue: defenderIds.length,
    damage: 0,
    resolved: true,
    reactions: [],
  };
}

describe("chainDefenderIds", () => {
  it("includes equipment defending on previous and current chain links", () => {
    expect(chainDefenderIds([link(1, [11, 12]), link(2, [13])])).toEqual(
      new Set([11, 12, 13]),
    );
  });
});
