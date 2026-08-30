import type { EquipmentSlot, Format } from "@fyendal/shared";

export const EQUIPMENT_SLOTS = ["head", "chest", "arms", "legs"] as const satisfies readonly EquipmentSlot[];

export type ConstructedFormat = Exclude<Format, "classic-battles">;

export const CONSTRUCTED_FORMATS = ["cc", "silver-age"] as const satisfies readonly ConstructedFormat[];
