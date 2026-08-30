import type { CardView, EquipmentSlot } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { EQUIPMENT_SLOTS } from "../domain.js";

export interface BoardCardGroup {
  card: CardView;
  count: number;
  activatable: boolean;
}

/** Flatten public cards retained under equipment from oldest/deepest to the
 * currently equipped top card so every exposed edge can be inspected. */
export function equipmentStackCards(topCard: CardView): CardView[] {
  return [
    ...(topCard.subcards ?? []).flatMap(equipmentStackCards),
    topCard,
  ];
}

function occupiesEquipmentZone(card: CardView, slot: EquipmentSlot): boolean {
  return (card.counters?.[`frostZone:${slot}`] ?? 0) > 0;
}

/** Return the board aura visually assigned to an exposed equipment zone. */
export function boardCardInEquipmentZone(
  cards: readonly CardView[],
  slot: EquipmentSlot,
): CardView | undefined {
  return cards.find((card) => occupiesEquipmentZone(card, slot));
}

/** Slot-assigned auras render in their equipment cells instead of the arena strip. */
export function boardCardsOutsideEquipmentZones(cards: readonly CardView[]): CardView[] {
  return cards.filter(
    (card) => !EQUIPMENT_SLOTS.some((slot) => occupiesEquipmentZone(card, slot)),
  );
}

function sortedRecordEntries(record: Record<string, number> | undefined): [string, number][] {
  return Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

/** Tokens with the same functional identity may have several printing IDs and
 * arts. They are one arena object type and should share a visual stack. */
function boardCardIdentity(card: CardView): string {
  const data = cardData[card.cardId];
  if (data?.cardType !== "token") return card.cardId;
  const name = data.name.trim().toLowerCase().replace(/\s+/g, " ");
  return `token:${name}|${data.pitch ?? 0}`;
}

/** Public and interactive state that must match before board cards can share
 * one visual stack. Instance identity is deliberately excluded. */
function boardCardStatusKey(card: CardView, activatable: boolean): string {
  return JSON.stringify([
    boardCardIdentity(card),
    card.owner,
    card.attack,
    card.defense,
    card.faceDown ?? false,
    card.tapped ?? false,
    card.defCounters ?? 0,
    sortedRecordEntries(card.counters),
    [...(card.usedAbilityIndexes ?? [])].sort((a, b) => a - b),
    card.life,
    card.hidden ?? false,
    activatable,
  ]);
}

/** Group equal board cards without mutating the authoritative GameView list. */
export function groupBoardCards(
  cards: readonly CardView[],
  activatableIds?: ReadonlySet<number>,
): BoardCardGroup[] {
  const groups = new Map<string, BoardCardGroup>();
  for (const card of cards) {
    const activatable = activatableIds?.has(card.instanceId) ?? false;
    const key = boardCardStatusKey(card, activatable);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { card, count: 1, activatable });
    }
  }
  return [...groups.values()];
}
