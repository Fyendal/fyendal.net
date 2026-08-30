import type { CardScript } from "@fyendal/engine";
import { discardRandomCost, nextAttack } from "./shared-helpers.js";

export const oneHp: Record<string, CardScript> = {
  "alpha rampage|1": {
    // Alpha Rampage — additional cost: discard a random card
    requiredHandCardsForAdditionalCost: 1,
    additionalCost: discardRandomCost,
  },
  "come to fight|3": {
    // Come to Fight (blue)
    onPlay: nextAttack({ attack: 1, appliesTo: "attack-action" }),
  },
};
