import type { CardScript } from "@fyendal/engine";
import {
  discardRandomCost,
  isSixPlus,
  nextAttack,
  queueIntimidate,
} from "./shared-helpers.js";

// ── Rhinar (hero / deck cards present in RNR) ──
export const rnr: Record<string, CardScript> = {
  "rhinar|0": {
    triggers: [{
      event: "card-discarded",
      label: "Intimidate",
      publicLog: "Rhinar's ability triggers",
      condition: (ctx, discarded) =>
        ctx.state.activePlayer === ctx.seat &&
        ctx.state.phase !== "start" &&
        ctx.state.phase !== "end" &&
        ctx.state.phase !== "game-over" &&
        isSixPlus(ctx, discarded),
      effect: (ctx) => ctx.intimidate(),
    }],
  },
  "awakening bellow|1": {
    // Awakening Bellow (red)
    onPlay(ctx) {
      nextAttack({ attack: 3, appliesTo: "attack-action" })(ctx);
      queueIntimidate(ctx);
    },
  },
  "barraging beatdown|2": {
    // Barraging Beatdown (yellow)
    onPlay(ctx) {
      nextAttack({ attack: 3, appliesTo: "attack-action", defendedLessThanNonEquip: 2 })(ctx);
      queueIntimidate(ctx);
    },
  },
  "wounded bull|2": {
    // Wounded Bull (yellow)
    triggers: [{ event: "card-played", sourceZone: "self", label: "Gain +1 attack", condition(ctx) { const me = ctx.state.players[ctx.seat]!; const opp = ctx.state.players[ctx.seat === 0 ? 1 : 0]!; return me.life < opp.life; }, effect(ctx, played) { if (played) ctx.addCardTempPower(played.instanceId, 1); } }],
  },
  "wrecker romp|3": {
    // Wrecker Romp (blue)
    requiredHandCardsForAdditionalCost: 1,
    additionalCost(ctx) {
      ctx.setFlag("player", "discardingForBruteAttackCost", true);
      discardRandomCost(ctx);
      ctx.setFlag("player", "discardingForBruteAttackCost", false);
    },
  },
};
