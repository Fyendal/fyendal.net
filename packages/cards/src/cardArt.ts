import type { CardData, DeckArt, DeckPool } from "@fyendal/shared";
import { STANDARD_CARD_ART } from "@fyendal/shared";
import { cardData } from "./catalog.js";
import catalogJson from "./data/cardArt.json" with { type: "json" };

/** One alternate image of a functional card, as Fabrary serves it. */
export interface CardArtVariant {
  /** Fabrary image object id, e.g. "DYN234-CF". */
  image: string;
  set: string;
  /** the-fab-cube rarity code: C R S M L F V P T B. */
  rarity: string;
  /** R rainbow, C cold, G gold; absent for non-foil. */
  foil?: string;
  /** FA full, EA extended, AA alternate, AB alternate border, AT alternate text. */
  variation?: string;
  /** BCP 47 language of a non-English printing. */
  language?: string;
}

const CATALOG: Readonly<Record<string, readonly CardArtVariant[]>> = catalogJson;

const RARITY_RANK: Readonly<Record<string, number>> = {
  V: 9, F: 8, L: 7, M: 6, S: 5, R: 4, P: 4, C: 3, B: 2, T: 2,
};
const VARIATION_RANK: Readonly<Record<string, number>> = { FA: 5, EA: 4, AA: 3, AB: 2, AT: 1 };
const FOIL_RANK: Readonly<Record<string, number>> = { G: 3, C: 2, R: 1 };

/** Functional identity shared by every printing of one card. */
export function cardArtKey(card: Pick<CardData, "cardType" | "name" | "pitch">): string {
  return `${card.cardType}|${card.name.trim().toLowerCase().replace(/\s+/g, " ")}|${card.pitch ?? 0}`;
}

export function cardArtVariants(cardId: string): readonly CardArtVariant[] {
  const card = cardData[cardId];
  return card ? CATALOG[cardArtKey(card)] ?? [] : [];
}

export function isValidCardArt(cardId: string, image: string): boolean {
  return cardArtVariants(cardId).some((variant) => variant.image === image);
}

/** Higher is rarer: rarity, then art variation, then foil. */
export function compareCardArt(a: CardArtVariant, b: CardArtVariant): number {
  return (RARITY_RANK[a.rarity] ?? 0) - (RARITY_RANK[b.rarity] ?? 0)
    || (VARIATION_RANK[a.variation ?? ""] ?? 0) - (VARIATION_RANK[b.variation ?? ""] ?? 0)
    || (FOIL_RANK[a.foil ?? ""] ?? 0) - (FOIL_RANK[b.foil ?? ""] ?? 0)
    || a.image.localeCompare(b.image);
}

export function highestRarityArt(cardId: string): string | undefined {
  const variants = cardArtVariants(cardId);
  return variants.length ? variants.reduce((best, next) => compareCardArt(next, best) > 0 ? next : best).image : undefined;
}

/** The image a deck shows for one printing; undefined keeps the standard art. */
export function deckCardArt(cardId: string, art: DeckArt): string | undefined {
  const pick = art.picks[cardId];
  if (pick === STANDARD_CARD_ART) return undefined;
  if (pick !== undefined && isValidCardArt(cardId, pick)) return pick;
  return art.highestRarity ? highestRarityArt(cardId) : undefined;
}

export function deckPoolCardIds(pool: DeckPool): string[] {
  return [...new Set([
    pool.heroId,
    ...pool.weaponIds,
    ...pool.equipmentPool,
    ...(pool.inventoryPool ?? []),
    ...pool.deck,
    ...(pool.sideboard ?? []),
  ])];
}

/** Every non-standard image the deck shows, keyed by printing id. */
export function resolveDeckArt(pool: DeckPool, art: DeckArt): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const cardId of deckPoolCardIds(pool)) {
    const image = deckCardArt(cardId, art);
    if (image !== undefined) resolved[cardId] = image;
  }
  return resolved;
}

/** Drop picks that no longer name a valid image for a card in the deck. */
export function normalizeDeckArt(pool: DeckPool, art: DeckArt): DeckArt {
  const ids = new Set(deckPoolCardIds(pool));
  const picks = Object.fromEntries(Object.entries(art.picks).filter(([cardId, image]) =>
    ids.has(cardId) && (image === STANDARD_CARD_ART || isValidCardArt(cardId, image))));
  return { highestRarity: art.highestRarity, picks };
}
