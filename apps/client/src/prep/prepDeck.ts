import type { DeckDetailResponse } from "@fyendal/protocol";
import { cardData, precon } from "@fyendal/cards/client";

export type PrepDeck = DeckDetailResponse["deck"];

/** A built-in precon represented like a registered deck. */
export function preconPrepDeck(id: string): PrepDeck | null {
  const fixed = precon(id);
  if (!fixed) return null;
  const pool = fixed.pool;
  return {
    id: fixed.id,
    name: fixed.name,
    format: fixed.format,
    fabraryUrl: null,
    heroName: cardData[pool.heroId]?.name ?? fixed.name,
    deckSize:
      pool.weaponIds.length + pool.equipmentPool.length + pool.deck.length +
      (pool.inventoryPool?.length ?? 0) +
      (pool.sideboard?.length ?? 0),
    updatedAt: 0,
    art: { highestRarity: false, picks: {} },
    decklist: pool,
  };
}
