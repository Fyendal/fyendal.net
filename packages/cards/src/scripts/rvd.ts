import type { CardScript } from "@fyendal/engine";
import { attackAbility } from "./shared-helpers.js";

export const rvd: Record<string, CardScript> = {
  "bone basher|0": {
    // Bone Basher — Once per Turn Action {r}{r}: Attack
    activated: attackAbility(2),
  },
};
