import type { CardData } from "@fyendal/shared";

/**
 * Functional identity of a card: the same card reprinted in another set shares
 * one key, so scripts are registered once per functional card rather than per
 * printing. Pitch distinguishes the red/yellow/blue variants of a card.
 */
export function functionalKey(name: string, pitch?: number): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, " ")}|${pitch ?? 0}`;
}

export function functionalKeyOf(card: CardData): string {
  return functionalKey(card.name, card.pitch);
}
