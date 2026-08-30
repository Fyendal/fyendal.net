import type { CardScript } from "@fyendal/engine";
import { mergeSetScripts } from "./shared-helpers.js";
import { brute } from "./wtr/brute.js";
import { generic } from "./wtr/generic.js";
import { guardian } from "./wtr/guardian.js";
import { ninja } from "./wtr/ninja.js";
import { warrior } from "./wtr/warrior.js";
import { wtrHighRarity } from "./wtr/high-rarity.js";

export const wtr: Record<string, CardScript> = mergeSetScripts(
  "WTR",
  brute,
  generic,
  guardian,
  ninja,
  warrior,
  wtrHighRarity,
);
