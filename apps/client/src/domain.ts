import type { EquipmentSlot, Format } from "@fyendal/shared";

export const EQUIPMENT_SLOTS = ["head", "chest", "arms", "legs"] as const satisfies readonly EquipmentSlot[];

export const FORMATS = ["cc", "silver-age"] as const satisfies readonly Format[];
