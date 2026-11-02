import { arenaWeaponIssue, cardData, equipmentFitsSlot } from "@fyendal/cards/client";
import type { DeckPool, EquipmentSlot, PresentedArena, PresentedDeck } from "@fyendal/shared";
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
export function defaultWeapons(weaponIds: readonly string[], heroId: string): string[] {
  return defaultWeaponIndexes(weaponIds, heroId).map((index) => weaponIds[index]!);
}

export function defaultWeaponIndexes(weaponIds: readonly string[], heroId: string): number[] {
  const selected: string[] = [];
  const selectedIndexes: number[] = [];

  for (const [index, id] of weaponIds.entries()) {
    const candidate = [...selected, id];
    if (arenaWeaponIssue(cardData, heroId, candidate) === null) {
      selected.push(id);
      selectedIndexes.push(index);
    }
    if (selected.length === 2) break;
  }

  return selectedIndexes;
}

const ONE_PER_ARENA_SUBTYPES = ["off-hand", "quiver"];

/** Add a weapon in place of the selected off-hand or quiver it would duplicate. */
export function addWeaponIndex(
  weaponIds: readonly string[],
  selected: readonly number[],
  index: number,
): number[] {
  const subtypes = cardData[weaponIds[index]!]?.subtypes ?? [];
  const subtype = ONE_PER_ARENA_SUBTYPES.find((candidate) => subtypes.includes(candidate));
  const replaced = subtype === undefined ? undefined : selected.find(
    (candidate) => cardData[weaponIds[candidate]!]?.subtypes?.includes(subtype),
  );
  return replaced === undefined
    ? [...selected, index]
    : selected.map((candidate) => (candidate === replaced ? index : candidate));
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
    weaponIndexes: defaultWeaponIndexes(pool.weaponIds, pool.heroId),
    equipment,
    main,
  };
}

export type ArenaGap = "weapon" | EquipmentSlot;

/** Arena zones left bare although the pool registers cards that fit them. */
export function arenaGaps(pool: DeckPool, selection: PrepSelection): ArenaGap[] {
  const gaps: ArenaGap[] = pool.weaponIds.length > 0 && selection.weaponIndexes.length === 0 ? ["weapon"] : [];
  for (const slot of EQUIPMENT_SLOTS) {
    if (!selection.equipment[slot] && pool.equipmentPool.some((id) => equipmentFitsSlot(cardData[id], slot))) {
      gaps.push(slot);
    }
  }
  return gaps;
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

/** Compose Ready from the committed arena, independently of the active preset. */
export function presentedDeckFromSelection(
  selection: Pick<PrepSelection, "main">,
  arena: PresentedArena,
): PresentedDeck {
  return {
    weaponIds: [...arena.weaponIds],
    equipment: { ...arena.equipment },
    deck: [...selection.main].flatMap(([id, count]) => Array<string>(count).fill(id)),
  };
}

/** Opening a reconnect restores only the owner's previously presented main deck. */
export function restoreMainDeck(selection: PrepSelection, deck: readonly string[] | undefined): PrepSelection {
  if (!deck) return selection;
  const main = new Map<string, number>();
  for (const id of deck) main.set(id, (main.get(id) ?? 0) + 1);
  return { ...selection, main };
}
