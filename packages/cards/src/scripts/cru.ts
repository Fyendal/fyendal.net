import type { CardScript } from "@fyendal/engine";
import { mergeSetScripts } from "./shared-helpers.js";
import { cruArcaneGeneric } from "./cru/arcane-generic.js";
import { cruBruteGuardian } from "./cru/brute-guardian.js";
import { cruMechanologistRanger } from "./cru/mechanologist-ranger.js";
import { cruNinjaWarrior } from "./cru/ninja-warrior.js";
import { cruHighRarity } from "./cru/high-rarity.js";

export const cru: Record<string, CardScript> = mergeSetScripts(
  "CRU",
  cruBruteGuardian,
  cruNinjaWarrior,
  cruMechanologistRanger,
  cruArcaneGeneric,
  cruHighRarity,
);
