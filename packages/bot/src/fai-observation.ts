import { legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { CardView } from "@fyendal/shared";
import { ownCards, type BotPolicyInput } from "./policy.js";

/** The caller must supply the actual starting presentation. No Aggro default
 * or strategy import belongs in this shared observation layer.
 * Known starting presentation minus visible owned cards, never the real deck or
 * hidden opponent card identities. Returns a multiset, not a predicted order. */
export function knownRemainingFaiDeck(input: BotPolicyInput, startingDeck: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of startingDeck) counts.set(id, (counts.get(id) ?? 0) + 1);
  const visible = new Map<number, CardView>();
  for (const card of ownCards(input).values()) visible.set(card.instanceId, card);
  for (const link of input.view.chain) {
    for (const card of [link.attackingCard, ...link.defendingCards, ...link.reactions]) {
      if (card.owner === input.seat) visible.set(card.instanceId, card);
    }
  }
  for (const layer of input.view.stack) {
    // Cards on the stack are projected by the engine; no log parsing.
    if (layer.card?.owner === input.seat) visible.set(layer.card.instanceId, layer.card);
  }
  for (const card of visible.values()) {
    const count = counts.get(card.cardId) ?? 0;
    if (count > 0) counts.set(card.cardId, count - 1);
  }
  return [...counts].flatMap(([id, count]) => Array<string>(count).fill(id)).sort();
}

/** Sandbox copy only. The actual game is changed solely by applyIntent in the
 * caller. Unknown opponent objects have inert identities, with counts kept. */
export function createFaiSandbox(input: BotPolicyInput, startingDeck: readonly string[]): GameState | undefined {
  if (!input.state) return undefined;
  const { cardsRef, scriptsRef, ...serializable } = input.state;
  const state = JSON.parse(JSON.stringify(serializable)) as GameState;
  const unknownId = "__fai_rollout_unknown__";
  state.cardsRef = { ...cardsRef, [unknownId]: {
    id: unknownId, name: "Unknown opponent card", cardType: "action", classes: [],
    subtypes: [], cost: 0, attack: 0, defense: 0, text: "",
  } };
  state.scriptsRef = scriptsRef;
  state.rngState = 1;
  state.seed = 1;
  const opponent = state.players[1 - input.seat]!;
  for (const zone of [opponent.hand, opponent.deck, opponent.arsenal, opponent.pitch]) {
    for (const card of zone) card.cardId = unknownId;
  }
  state.players[input.seat].deck = knownRemainingFaiDeck(input, startingDeck).map((cardId) => ({
    cardId, instanceId: state.nextInstanceId++, owner: input.seat,
  }));
  return state;
}

export function observeFaiState(state: GameState, input: BotPolicyInput): BotPolicyInput {
  return { ...input, state, view: projectStateFor(state, input.seat, input.view.gameId),
    legal: legalIntents(state, input.seat) };
}
