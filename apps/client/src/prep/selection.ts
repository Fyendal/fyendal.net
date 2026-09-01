import { cardData, equipmentFitsSlot, weaponSelectionError } from "@fyendal/cards/client";
import type { DeckPool, EquipmentSlot } from "@fyendal/shared";
import { EQUIPMENT_SLOTS } from "../domain.js";

export interface PrepSelection {
  /** Deck this selection belongs to (rebuilt when the pool loads/changes). */
  forDeck: string;
  /** Indexes into DeckPool.weaponIds. Indexes preserve the identity of
   * separately registered copies that share the same printing id. */
  weaponIndexes: number[];
  equipment: Partial<Record<EquipmentSlot, string>>;
  /** cardId -> copies currently in the presented main deck. */
  main: Map<string, number>;
}

/** Select the earliest compatible weapon-zone cards, including a quiver or
 * Perched off-hand that can share the unoccupied side of a two-hander. */
export function defaultWeapons(weaponIds: readonly string[]): string[] {
  return defaultWeaponIndexes(weaponIds).map((index) => weaponIds[index]!);
}

export function defaultWeaponIndexes(weaponIds: readonly string[]): number[] {
  const selected: string[] = [];
  const selectedIndexes: number[] = [];

  for (const [index, id] of weaponIds.entries()) {
    const candidate = [...selected, id];
    if (weaponSelectionError(cardData, candidate) === null) {
      selected.push(id);
      selectedIndexes.push(index);
    }
    if (selected.length === 2) break;
  }

  return selectedIndexes;
}

/** Start from the deck/sideboard split the player registered. */
export function defaultSelection(pool: DeckPool, forDeck: string): PrepSelection {
  const equipment: Partial<Record<EquipmentSlot, string>> = {};
  for (const id of pool.equipmentPool) {
    const slot = EQUIPMENT_SLOTS.find(
      (candidate) => !equipment[candidate] && equipmentFitsSlot(cardData[id], candidate),
    );
    if (slot) equipment[slot] = id;
  }

  const main = new Map<string, number>();
  for (const id of pool.deck) main.set(id, (main.get(id) ?? 0) + 1);

  return {
    forDeck,
    weaponIndexes: defaultWeaponIndexes(pool.weaponIds),
    equipment,
    main,
  };
}

/** Copies available per cardId across the registered deck and sideboard. */
export function poolCounts(pool: DeckPool): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of [...pool.deck, ...(pool.sideboard ?? [])]) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Move exactly one copy across the main-deck/inventory boundary. */
export function adjustMainCount(
  main: ReadonlyMap<string, number>,
  available: ReadonlyMap<string, number>,
  id: string,
  delta: -1 | 1,
): Map<string, number> {
  const current = main.get(id) ?? 0;
  const next = Math.max(0, Math.min(available.get(id) ?? 0, current + delta));
  const updated = new Map(main);
  if (next === 0) updated.delete(id);
  else updated.set(id, next);
  return updated;
}
