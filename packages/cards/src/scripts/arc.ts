import type { CardScript } from "@fyendal/engine";
import { mergeSetScripts } from "./shared-helpers.js";
import { arcArcane } from "./arc/arcane.js";
import { arcGeneric } from "./arc/generic.js";
import { arcMechanologist } from "./arc/mechanologist.js";
import { arcRanger } from "./arc/ranger.js";
import { arcHighRarity } from "./arc/high-rarity.js";

export const arc: Record<string, CardScript> = mergeSetScripts(
  "ARC",
  arcArcane,
  arcGeneric,
  arcMechanologist,
  arcRanger,
  arcHighRarity,
);
