import type { CardScript } from "@fyendal/engine";
import { buffNextAttack, crushTriggered, opponentSeat } from "./shared-helpers.js";

export const bdd: Record<string, CardScript> = {
  "knock 'em off their feet|1": {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      ctx.tap(ctx.player(opponentSeat(ctx)).hero.instanceId);
    },
  },
  "crash down|1": {
    triggers: [
      {
        event: "start-of-turn",
        whose: "subject",
        label: "Destroy Crash Down — next Guardian attack gets +6{p}",
        effect(ctx) {
          ctx.destroySelf();
          buffNextAttack(ctx, { attack: 6, appliesToClass: "guardian", appliesTo: "attack-action" });
        },
      },
    ],
  },
};
