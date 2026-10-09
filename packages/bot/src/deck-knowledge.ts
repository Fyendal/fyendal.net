import type { GameState } from "@fyendal/engine";
import type { BotDecklists, CardData, CardView, GameView } from "@fyendal/shared";
import type { BotPolicyInput } from "./policy.js";

/**
 * Card-pool knowledge for value estimates. Policies only ever see *counts of
 * card ids that have not been publicly seen*; zone placement and deck order
 * are never exposed through this module, so it cannot leak which hidden card
 * is in hand versus deck.
 */
export type CardCounts = ReadonlyMap<string, number>;

const NON_DECK_TYPES = new Set(["hero", "token", "weapon", "equipment"]);
/** Presentation data and inventory (outside the game until redeemed). */
const SKIPPED_STATE_KEYS = new Set(["cardsRef", "scriptsRef", "log", "gameStats", "inventory", "globalCardIds"]);

function isDeckCard(data: CardData | undefined): boolean {
  return !!data && !NON_DECK_TYPES.has(data.cardType);
}

/** Main-deck card ids owned by each seat, recovered from authoritative state.
 * Used by the server and match harness to populate `BotPolicyInput.decklists`
 * with the bot's own list and the opponent's full list. */
export function decklistsFromState(state: GameState, seat: 0 | 1): BotDecklists {
  const cards = state.cardsRef as Readonly<Record<string, CardData>>;
  const byOwner: [string[], string[]] = [[], []];
  const seen = new Set<number>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 12 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.instanceId === "number" && typeof record.cardId === "string" &&
      (record.owner === 0 || record.owner === 1) && !seen.has(record.instanceId)) {
      seen.add(record.instanceId);
      if (isDeckCard(cards[record.cardId])) byOwner[record.owner].push(record.cardId);
    }
    for (const [key, child] of Object.entries(record)) {
      if (!SKIPPED_STATE_KEYS.has(key)) visit(child, depth + 1);
    }
  };
  visit(state, 0);
  const sorted = (ids: string[]) => [...ids].sort();
  return { own: sorted(byOwner[seat]), opponent: sorted(byOwner[1 - seat]!) };
}

function countIds(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

function publiclyPlacedCards(view: GameView, owner: number, includeOwnPrivate: boolean): CardView[] {
  const placed: CardView[] = [];
  for (const player of view.players) {
    const zones: CardView[] = [
      ...player.graveyard,
      ...player.banish,
      ...player.soul,
      ...player.board,
      ...player.arsenal,
      ...player.pitch,
      ...(includeOwnPrivate ? player.hand : []),
    ];
    for (const card of zones) if (card.owner === owner) placed.push(card);
  }
  for (const link of view.chain) {
    for (const card of [link.attackingCard, ...link.defendingCards, ...link.reactions]) {
      if (card.owner === owner) placed.push(card);
    }
  }
  for (const layer of view.stack) if (layer.card?.owner === owner) placed.push(layer.card);
  return placed;
}

/**
 * Multiset of deck card ids for `whose` that are not in a public (or, for the
 * bot itself, known) zone. For the bot this is exactly its remaining deck
 * contents; for the opponent it is their hand plus deck, never split.
 */
export function unseenCounts(
  input: Pick<BotPolicyInput, "view" | "seat" | "cards" | "decklists">,
  whose: "own" | "opponent",
): CardCounts | undefined {
  const list = input.decklists?.[whose];
  if (!list || list.length === 0) return undefined;
  const owner = whose === "own" ? input.seat : 1 - input.seat;
  const counts = countIds(list);
  const seen = new Set<number>();
  for (const card of publiclyPlacedCards(input.view, owner, whose === "own")) {
    if (seen.has(card.instanceId)) continue;
    seen.add(card.instanceId);
    const remaining = counts.get(card.cardId);
    if (remaining === undefined) continue;
    if (remaining <= 1) counts.delete(card.cardId);
    else counts.set(card.cardId, remaining - 1);
  }
  return counts;
}

export function totalCount(counts: CardCounts): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

/** Count-weighted mean of `value` over a card multiset. */
export function averageOver(
  counts: CardCounts,
  value: (cardId: string) => number,
): number | undefined {
  const total = totalCount(counts);
  if (total === 0) return undefined;
  let sum = 0;
  for (const [cardId, count] of counts) sum += value(cardId) * count;
  return sum / total;
}

/** Hypergeometric P(at least one success) when drawing `draws` cards without
 * replacement from `population` cards containing `successes`. */
export function probabilityAtLeastOne(successes: number, population: number, draws: number): number {
  if (successes <= 0 || draws <= 0 || population <= 0) return 0;
  if (successes >= population || draws > population - successes) return 1;
  let none = 1;
  for (let index = 0; index < draws; index++) {
    none *= (population - successes - index) / (population - index);
  }
  return 1 - none;
}
