import type {
  CardData,
  CardPoolMode,
  Decklist,
  DeckPool,
  EquipmentSlot,
  Format,
  PresentedDeck,
  PresentedArena,
} from "@fyendal/shared";
import { formatLegalityIssues } from "./formatLegality.js";
import { equipmentFitsSlot, isWeaponZoneCard } from "./equipment.js";

export const MIN_DECK_SIZE: Record<Format, number> = {
  "classic-battles": 40,
  cc: 60,
  "silver-age": 40,
};

export const EXACT_DECK_SIZE: Partial<Record<Format, number>> = {
  "silver-age": 40,
};

const MAX_PRESENTED_WEAPONS = 2;
const EQUIPMENT_SLOTS: EquipmentSlot[] = ["head", "chest", "arms", "legs"];

export type PresentationResult =
  | { ok: true; decklist: Decklist }
  | { ok: false; error: string };

function counts(ids: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const id of ids) result.set(id, (result.get(id) ?? 0) + 1);
  return result;
}

function outsideSubset(
  cards: Record<string, CardData>,
  part: Map<string, number>,
  whole: Map<string, number>,
): string | null {
  for (const [id, quantity] of part) {
    if (quantity > (whole.get(id) ?? 0)) return cards[id]?.name ?? id;
  }
  return null;
}

function hasKeyword(card: CardData | undefined, keyword: string): boolean {
  return card?.keywords?.some((candidate) => candidate.trim().toLowerCase() === keyword) === true;
}

export type WeaponSelectionIssueCode =
  | "not-weapon-zone"
  | "single-weapon-zone"
  | "multiple-quivers"
  | "multiple-off-hands"
  | "too-many"
  | "multiple-two-handers"
  | "two-hander-pairing";

export interface WeaponSelectionIssue {
  code: WeaponSelectionIssueCode;
  /** The offending card, when one card alone causes the issue. */
  cardId?: string;
}

const SINGLE_WEAPON_ZONE_HEROES = ["kayo, strong-arm", "kayo, armed and dangerous"];

/** Find why cards can't share the two weapon zones. A two-hander only
 * occupies one of the zones it is equipped to, allowing a quiver with a 2H bow
 * or a Perched off-hand with any 2H weapon to occupy the other zone. */
function weaponZoneIssue(
  cards: Record<string, CardData>,
  ids: readonly string[],
): WeaponSelectionIssue | null {
  const invalid = ids.find((id) => !isWeaponZoneCard(cards[id]));
  if (invalid) return { code: "not-weapon-zone", cardId: invalid };
  const quivers = ids.filter((id) => cards[id]?.subtypes?.includes("quiver"));
  const offHands = ids.filter((id) => cards[id]?.subtypes?.includes("off-hand"));
  if (quivers.length > 1) return { code: "multiple-quivers" };
  if (offHands.length > 1) return { code: "multiple-off-hands" };
  if (ids.length > MAX_PRESENTED_WEAPONS) return { code: "too-many" };

  const twoHanders = ids.filter((id) => cards[id]?.subtypes?.includes("2h"));
  if (twoHanders.length === 0 || ids.length === 1) return null;
  if (twoHanders.length > 1) return { code: "multiple-two-handers", cardId: twoHanders[0] };

  const twoHander = cards[twoHanders[0]!];
  const companionId = ids.find((id) => id !== twoHanders[0]);
  const companion = companionId ? cards[companionId] : undefined;
  const canShare = hasKeyword(companion, "perched") ||
    (companion?.subtypes?.includes("quiver") === true &&
      twoHander?.subtypes?.includes("bow") === true);
  if (!canShare) return { code: "two-hander-pairing", cardId: twoHanders[0] };
  return null;
}

/** Find why a weapon-zone selection is illegal for this hero, as a stable
 * code the client can explain in the player's language. */
export function arenaWeaponIssue(
  cards: Record<string, CardData>,
  heroId: string,
  ids: readonly string[],
): WeaponSelectionIssue | null {
  if (SINGLE_WEAPON_ZONE_HEROES.includes(cards[heroId]?.name.toLowerCase() ?? "") && ids.length > 1) {
    return { code: "single-weapon-zone", cardId: heroId };
  }
  return weaponZoneIssue(cards, ids);
}

function weaponIssueMessage(
  cards: Record<string, CardData>,
  ids: readonly string[],
  issue: WeaponSelectionIssue,
): string {
  const name = issue.cardId ? cards[issue.cardId]?.name ?? issue.cardId : "";
  switch (issue.code) {
    case "single-weapon-zone": return `${name} starts with only one weapon zone`;
    case "not-weapon-zone": return `${name} can't be equipped to a weapon zone`;
    case "multiple-quivers": return "only one quiver may be presented";
    case "multiple-off-hands": return "only one off-hand may be presented";
    case "too-many": return `too many weapons (${ids.length}, max ${MAX_PRESENTED_WEAPONS})`;
    case "multiple-two-handers": return "only one two-hand weapon may be presented";
    case "two-hander-pairing":
      return "a two-hand weapon can only be paired with a compatible quiver or Perched card";
  }
}

/** English validation error for a weapon-zone selection, ignoring hero limits. */
export function weaponSelectionError(
  cards: Record<string, CardData>,
  ids: readonly string[],
): string | null {
  const issue = weaponZoneIssue(cards, ids);
  return issue ? weaponIssueMessage(cards, ids, issue) : null;
}

/** Pure presentation validator shared by browser and server. */
export function validateArenaAgainstCards(
  cards: Record<string, CardData>,
  pool: DeckPool,
  presented: PresentedArena,
  format: Format,
  options: { cardPoolMode?: CardPoolMode } = {},
): { ok: true } | { ok: false; error: string } {
  const legalityIssue = formatLegalityIssues(cards, pool, format, options)[0];
  if (legalityIssue) return { ok: false, error: legalityIssue.message };

  const weaponIssue = arenaWeaponIssue(cards, pool.heroId, presented.weaponIds);
  if (weaponIssue) {
    return { ok: false, error: weaponIssueMessage(cards, presented.weaponIds, weaponIssue) };
  }
  const badWeapon = outsideSubset(cards, counts(presented.weaponIds), counts(pool.weaponIds));
  if (badWeapon) return { ok: false, error: `${badWeapon} is not in your registered weapons` };

  const poolEquipment = counts(pool.equipmentPool);
  const selectedEquipment = Object.values(presented.equipment).filter(
    (id): id is string => id !== undefined,
  );
  const badEquipment = outsideSubset(cards, counts(selectedEquipment), poolEquipment);
  if (badEquipment) {
    return { ok: false, error: `${badEquipment} is not in your registered equipment` };
  }
  for (const [slot, cardId] of Object.entries(presented.equipment)) {
    if (!cardId) continue;
    if (!EQUIPMENT_SLOTS.includes(slot as EquipmentSlot)) {
      return { ok: false, error: `unknown equipment slot ${slot}` };
    }
    const card = cards[cardId];
    if (!equipmentFitsSlot(card, slot as EquipmentSlot)) {
      return { ok: false, error: `${card?.name ?? cardId} is not a ${slot} equipment` };
    }
  }

  return { ok: true };
}

/** Pure presentation validator shared by browser and server. */
export function validatePresentationAgainstCards(
  cards: Record<string, CardData>,
  pool: DeckPool,
  presented: PresentedDeck,
  format: Format,
  options: { cardPoolMode?: CardPoolMode } = {},
): PresentationResult {
  const arena = validateArenaAgainstCards(cards, pool, presented, format, options);
  if (!arena.ok) return arena;
  const selectedEquipment = Object.values(presented.equipment).filter(
    (id): id is string => id !== undefined,
  );

  const mainPool = counts([...pool.deck, ...(pool.sideboard ?? [])]);
  const badMain = outsideSubset(cards, counts(presented.deck), mainPool);
  if (badMain) return { ok: false, error: `${badMain} is not in your registered pool` };
  const incarnate = presented.deck
    .map((id) => cards[id])
    .find((card) => card?.keywords?.some((keyword) => keyword.toLowerCase() === "incarnate"));
  if (incarnate) {
    return { ok: false, error: `${incarnate.name} can't start in your deck (Incarnate)` };
  }
  const exact = EXACT_DECK_SIZE[format];
  if (exact !== undefined && presented.deck.length !== exact) {
    return {
      ok: false,
      error: `main deck must be exactly ${exact} cards for ${format} (${presented.deck.length} presented)`,
    };
  }
  const minimum = MIN_DECK_SIZE[format];
  if (presented.deck.length < minimum) {
    return {
      ok: false,
      error: `main deck too small (${presented.deck.length} cards, ${format} requires at least ${minimum})`,
    };
  }

  return {
    ok: true,
    decklist: {
      heroId: pool.heroId,
      weaponIds: [...presented.weaponIds],
      equipment: { ...presented.equipment },
      deck: [...presented.deck],
      inventory: [
        ...(pool.inventoryPool ?? []),
        ...multisetRemainder(pool.weaponIds, presented.weaponIds),
        ...multisetRemainder(pool.equipmentPool, selectedEquipment),
        ...multisetRemainder([...pool.deck, ...(pool.sideboard ?? [])], presented.deck),
      ],
    },
  };
}

function multisetRemainder(pool: readonly string[], selected: readonly string[]): string[] {
  const remaining = counts(selected);
  return pool.filter((id) => {
    const count = remaining.get(id) ?? 0;
    if (count <= 0) return true;
    remaining.set(id, count - 1);
    return false;
  });
}
