import type { GameState } from "@fyendal/engine";
import type { BotPolicyInput } from "./policy.js";
import type { TurnPlannerRoot } from "./turn-planner.js";

/** Facts about a simulated route, not a strategy score. Endpoint locations are
 * deliberately separate: a card in pitch is not evidence that it was played,
 * and a card in graveyard may have been discarded rather than played. */
export function collectFaiRouteFacts(
  state: GameState,
  input: BotPolicyInput,
  root: Pick<TurnPlannerRoot, "opponentLife" | "deckIds">,
) {
  const me = input.view.players[input.seat];
  const ids = (cards: readonly { instanceId: number }[]): ReadonlySet<number> =>
    new Set(cards.map((card) => card.instanceId));
  return {
    damage: Math.max(0, root.opponentLife - input.view.players[1 - input.seat]!.life),
    // Cleanup draws belong to the next hand, not this route's reserve/waste.
    currentHand: me.hand.filter((card) => !root.deckIds.has(card.instanceId)),
    locations: {
      hand: ids(me.hand),
      arsenal: ids(me.arsenal),
      banish: ids(me.banish),
      pitch: ids(me.pitch),
      graveyard: ids(me.graveyard),
      // Only call on the caller's sanitized rollout, never an opponent oracle.
      deck: ids(state.players[input.seat].deck),
    },
  };
}
