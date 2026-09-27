import type { CardScript } from "@fyendal/engine";
import { attackAbility } from "./shared-helpers.js";

function heraldOfHope(): CardScript {
  return {
    onHit(ctx) {
      ctx.putIntoSoul(ctx.self.instanceId);
      ctx.gainLife(ctx.seat, 1);
    },
  };
}

export const sat: Record<string, CardScript> = {
  "herald of hope|1": heraldOfHope(),
  "herald of hope|2": heraldOfHope(),
  "herald of hope|3": heraldOfHope(),
  "suraya, archangel of endless hope|0": {
    activated: attackAbility(2),
    onTransform(ctx, direction) {
      if (direction === "from") {
        ctx.gainLife(ctx.seat, 1);
      }
    },
  },
};
