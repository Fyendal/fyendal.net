import type { CardScript } from "@fyendal/engine";
import { buffNextAttack, opponentSeat } from "./shared-helpers.js";

function crushed(ctx: Parameters<NonNullable<CardScript["onHit"]>>[0]): boolean {
  const link = ctx.link;
  return !!link && link.targetAllyId === undefined && link.hit && link.damage >= 4;
}

export const bdd: Record<string, CardScript> = {
  "knock 'em off their feet|1": {
    canTriggerOnHit: crushed,
    onHit(ctx) {
      ctx.tap(ctx.player(opponentSeat(ctx)).hero.instanceId);
    },
  },
  "crash down|1": {
    triggers: [{
      event: "start-of-turn",
      whose: "subject",
      label: "Destroy Crash Down — next Guardian attack gets +6{p}",
      effect(ctx) {
        ctx.destroySelf();
        buffNextAttack(ctx, { attack: 6, appliesToClass: "guardian", appliesTo: "attack-action" });
      },
    }],
  },
};
