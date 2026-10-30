import type { GameIntent } from "@fyendal/shared";
import { functionalKey, type BotPolicyInput } from "./policy.js";

/** An opponent's Bait locks every owned card until it attacks, and its free
 * pump is only legal on that attack, so the bot always takes both abilities. */
export function chooseBaitIntent(input: BotPolicyInput): GameIntent | undefined {
  const baits = new Set(input.view.players[input.seat].board
    .filter((card) => functionalKey(input.cards[card.cardId]) === "bait|0")
    .map((card) => card.instanceId));
  return input.legal.find((intent) =>
    intent.kind === "activate-ability" && baits.has(intent.sourceInstanceId)
  );
}
