import type { CardData, EquipmentSlot } from "@fyendal/shared";

/** Whether an equipment card may be presented in a given starting zone.
 * Modular cards acquire the subtype of whichever equipment zone they occupy
 * (CR 8.3.30), so their printed data intentionally has no fixed slot subtype. */
export function equipmentFitsSlot(card: CardData | undefined, slot: EquipmentSlot): boolean {
  return card?.cardType === "equipment" && (
    card.subtypes?.includes(slot) === true ||
    card.keywords?.some((keyword) => keyword.trim().toLowerCase() === "modular") === true
  );
}
