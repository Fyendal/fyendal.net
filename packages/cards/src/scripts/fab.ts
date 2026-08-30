import type { CardScript } from "@fyendal/engine";
import { ironhideScript, revealTopSixPlusStays } from "./shared-helpers.js";

export const fab: Record<string, CardScript> = {
  "bone vizier|0": {
    // Bone Vizier — when destroyed, reveal top; 6+ stays, else bottom
    onDestroyed: revealTopSixPlusStays,
  },
  "ironhide gauntlet|0": ironhideScript(),
  "diamond|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: false,
      destroySelfCost: true,
      label: "Destroy: draw a card",
      onActivate(ctx) { ctx.drawCards(ctx.seat, 1); },
    },
  },
};
