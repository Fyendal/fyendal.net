import type { CardData, CardType } from "./types.js";

/** Canonical order of `CardData.types`. The first type a card has is its
 * primary type, which keys card art and labels the card. */
export const CARD_TYPE_ORDER: readonly CardType[] = [
  "hero",
  "weapon",
  "equipment",
  "attack-reaction",
  "defense-reaction",
  "instant",
  "resource",
  "block",
  "mentor",
  "token",
  "action",
];

/** The kind of object a card is outside the deck: the zone it starts in or is
 * created into. Every other card is an ordinary deck card. */
export type ObjectKind = "hero" | "weapon" | "equipment" | "token" | "deck";

type Typed = Pick<CardData, "types"> | null | undefined;

/** Whether a card's printed type line includes `type`. */
export function hasType(data: Typed, type: CardType): boolean {
  return data?.types.includes(type) === true;
}

/** A card's first type in `CARD_TYPE_ORDER`. */
export function primaryType(data: Pick<CardData, "types">): CardType {
  return CARD_TYPE_ORDER.find((type) => data.types.includes(type)) ?? data.types[0]!;
}

/** Zone kind by priority, so a Weapon - Equipment is a weapon and a
 * Demi-Hero - Equipment is a hero. Equipment that is also an action or
 * instant (an Evo) is played from the deck. */
export function objectKind(data: Pick<CardData, "types">): ObjectKind {
  if (data.types.includes("hero")) return "hero";
  if (data.types.includes("weapon")) return "weapon";
  if (data.types.includes("equipment")) {
    return data.types.includes("action") || data.types.includes("instant") ? "deck" : "equipment";
  }
  if (data.types.includes("token")) return "token";
  return "deck";
}
