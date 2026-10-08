import type { CardView } from "@fyendal/shared";
import { isAttack, type BotPolicyInput } from "./policy.js";

export function leviaEffectActive(input: BotPolicyInput, name: string): boolean {
  return input.view.activePlayer === input.seat && input.view.ongoing.some((effect) =>
    effect.seat === input.seat && input.cards[effect.cardId]?.name.toLowerCase() === name
  );
}

export function leviaAttackPlayable(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  if (!isAttack(data)) return false;
  const me = input.view.players[input.seat];
  if (data?.name === "Consuming Lash") return me.board.some((permanent) =>
    input.cards[permanent.cardId]?.name === "Blasmophet, the Insatiable Hunger"
  );
  // These attacks pay an additional graveyard cost before they can attack.
  if (["Dread Screamer", "Endless Maw", "Shadowrealm Horror"]
    .includes(data?.name ?? "")) return me.graveyard.length >= 3;
  if (data?.name === "Soul Harvest") return me.graveyard.length >= 6;
  if (data?.name === "Wrecker Romp") return me.hand.length >= 2;
  return true;
}

export function leviaAttackContinues(card: CardView, input: BotPolicyInput, future = false): boolean {
  const data = input.cards[card.cardId];
  if (data?.name === "Feeding Frenzy") {
    // Its own attack trigger can establish go again. Never inspect the next draw.
    return (!future && input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn === true) ||
      input.view.players[input.seat].deckCount > 0;
  }
  if (data?.name === "Dread Screamer") return input.view.players[input.seat].graveyard.some((card) =>
    (input.cards[card.cardId]?.attack ?? 0) >= 6
  );
  if (data?.name === "Shadowrealm Horror") return input.view.players[input.seat].graveyard.filter((card) =>
    (input.cards[card.cardId]?.attack ?? 0) >= 6
  ).length >= 2;
  return data?.keywords?.includes("Go again") === true;
}

/** Compare two attacks without also spending either attack as a pitch card.
 * Used for resource setup and the next-turn Sash block prediction, not legality. */
export function leviaAttackPair(
  input: BotPolicyInput,
  cards: readonly CardView[],
  options: { sash?: boolean; resources?: number; grantGoAgain?: boolean; future?: boolean } = {},
): boolean {
  const me = input.view.players[input.seat];
  const attacks = cards.filter((card) => leviaAttackPlayable(card, input));
  const sash = options.sash || (!options.future && leviaEffectActive(input, "savage sash"));
  const grantedGoAgain = options.grantGoAgain || (!options.future && leviaEffectActive(input, "consuming lash"));
  const cost = (card: CardView) => {
    const data = input.cards[card.cardId];
    return Math.max(0, (data?.cost ?? 0) - (sash && (data?.attack ?? 0) >= 6 ? 1 : 0));
  };
  for (const first of attacks) {
    if (!grantedGoAgain && !leviaAttackContinues(first, input, options.future) &&
      (options.future || me.actionPoints < 2)) continue;
    for (const second of attacks) {
      if (first.instanceId === second.instanceId) continue;
      // Do not promise a retained pair through a random discard additional cost.
      if ([first, second].some((card) => input.cards[card.cardId]?.name === "Wrecker Romp")) continue;
      const pitch = me.hand.filter((card) => cards.some((available) => available.instanceId === card.instanceId) &&
        card.instanceId !== first.instanceId && card.instanceId !== second.instanceId
      ).reduce((sum, card) => sum + (input.cards[card.cardId]?.pitch ?? 0), 0);
      const resources = options.future ? 0 : options.resources ?? me.resources;
      if (resources + pitch >= cost(first) + cost(second)) return true;
    }
  }
  return false;
}

export function leviaSashEnablesPair(input: BotPolicyInput, cards: readonly CardView[], future = false): boolean {
  return leviaAttackPair(input, cards, { sash: true, future }) &&
    !leviaAttackPair(input, cards, { future });
}
