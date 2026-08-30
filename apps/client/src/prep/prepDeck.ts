import type { HeroId } from "@fyendal/shared";
import type { DeckDetailResponse } from "@fyendal/protocol";
import { cardData, deckPoolForHero, precon } from "@fyendal/cards/client";

export type PrepDeck = DeckDetailResponse["deck"];

/** The fixed Classic Battles box list represented like a registered deck. */
export function classicBattlesPrepDeck(hero: HeroId): PrepDeck {
  const decklist = deckPoolForHero(hero);
  return {
    id: `classic-battles-${hero}`,
    name: hero === "rhinar" ? "Rhinar (Classic Battles)" : "Dorinthea (Classic Battles)",
    format: "classic-battles",
    fabraryUrl: null,
    heroName: cardData[decklist.heroId]?.name ?? (hero === "rhinar" ? "Rhinar" : "Dorinthea"),
    deckSize: decklist.deck.length,
    updatedAt: 0,
    decklist,
  };
}

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
    decklist: pool,
  };
}
