import { attackAbility } from "../shared-helpers.js";

/** Storm of Sandikai grants the same zero-cost attack to every Dragon ally. */
export function dragonAttack() {
  return attackAbility(0, {
    canActivate(ctx) {
      return ctx.player(ctx.seat).weapons.some((weapon) => ctx.cardData(weapon.cardId).name === "Storm of Sandikai");
    },
  });
}
