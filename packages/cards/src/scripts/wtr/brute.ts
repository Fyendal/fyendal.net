import type { CardScript, ScriptCtx } from "@fyendal/engine";
import {
    isSixPlus,
  nextAttack,
  queueIntimidate,
  } from "../shared-helpers.js";

/** Store whether the random discard paid for this card had 6+ {p}. */
function rememberDiscardedSixPlus(ctx: ScriptCtx): void {
  ctx.setFlag("player", "discardingForBruteAttackCost", true);
  const [discarded] = ctx.discardRandom(ctx.seat, 1);
  ctx.setFlag("player", "discardingForBruteAttackCost", false);
  if (discarded) {
    ctx.setCounter("discardedSixPlus", isSixPlus(ctx, discarded) ? 1 : 0);
  }
}

/** Was the card's additional-cost discard a 6+ card? */
function discardedSixPlus(ctx: ScriptCtx): boolean {
  return ctx.getCounter("discardedSixPlus") === 1;
}

// ── WTR Brute actions ──

function awakeningBellow(attack: number): CardScript {
  return {
    onPlay(ctx) {
      nextAttack({ attack, appliesTo: "attack-action" })(ctx);
      queueIntimidate(ctx);
    },
  };
}

function barragingBeatdown(attack: number): CardScript {
  return {
    onPlay(ctx) {
      nextAttack({ attack, appliesToClass: "brute", defendedLessThanNonEquip: 2 })(ctx);
      queueIntimidate(ctx);
    },
  };
}

const breakneckBattery: CardScript = {
  requiredHandCardsForAdditionalCost: 1,
  additionalCost: rememberDiscardedSixPlus,
  onAttackDeclared(ctx) {
    if (discardedSixPlus(ctx)) {
      ctx.grantGoAgain();
      ctx.logPublic("Breakneck Battery gains go again");
    }
  },
};

function primevalBellow(attack: number): CardScript {
  return {
    requiredHandCardsForAdditionalCost: 1,
    additionalCost: rememberDiscardedSixPlus,
    onPlay: nextAttack({ attack, appliesTo: "attack-action" }),
  };
}

const savageFeast: CardScript = {
  requiredHandCardsForAdditionalCost: 1,
  additionalCost: rememberDiscardedSixPlus,
  onAttackDeclared(ctx) {
    if (discardedSixPlus(ctx)) {
      ctx.drawCards(ctx.seat, 1);
      ctx.logPublic("Savage Feast: draw a card");
    }
  },
};

export const brute: Record<string, CardScript> = {
  // Awakening Bellow (yellow / blue) — next Brute attack action +X, intimidate, go again
  "awakening bellow|2": awakeningBellow(2),
  "awakening bellow|3": awakeningBellow(1),

  // Barraging Beatdown (red / blue) — next Brute attack +X while defended by <2 non-equip, intimidate, go again
  "barraging beatdown|1": barragingBeatdown(4),
  "barraging beatdown|3": barragingBeatdown(2),

  // Breakneck Battery — discard random; go again if the discarded card has 6+ {p}
  "breakneck battery|1": breakneckBattery,
  "breakneck battery|2": breakneckBattery,
  "breakneck battery|3": breakneckBattery,

  // Primeval Bellow — discard random; next Brute attack +X; go again
  "primeval bellow|1": primevalBellow(5),
  "primeval bellow|2": primevalBellow(4),
  "primeval bellow|3": primevalBellow(3),

  // Savage Feast — discard random; draw a card if the discarded card has 6+ {p}
  "savage feast|1": savageFeast,
  "savage feast|2": savageFeast,
  "savage feast|3": savageFeast,

  // Savage Swing — discard random
  "savage swing|1": {
    requiredHandCardsForAdditionalCost: 1,
    additionalCost: rememberDiscardedSixPlus,
  },
  "savage swing|2": {
    requiredHandCardsForAdditionalCost: 1,
    additionalCost: rememberDiscardedSixPlus,
  },
  "savage swing|3": {
    requiredHandCardsForAdditionalCost: 1,
    additionalCost: rememberDiscardedSixPlus,
  },

  // Wrecker Romp (red / yellow) — discard random
  "wrecker romp|1": {
    requiredHandCardsForAdditionalCost: 1,
    additionalCost: rememberDiscardedSixPlus,
  },
  "wrecker romp|2": {
    requiredHandCardsForAdditionalCost: 1,
    additionalCost: rememberDiscardedSixPlus,
  },

  // Barkbone Strapping — destroy to roll a d6 and gain half (rounded down) resources
  "barkbone strapping|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      onActivate(ctx) {
        ctx.requestDieRoll("barkbone", 6);
      },
    },
    onDieRollResolved(ctx, hook, roll) {
      if (hook !== "barkbone") return;
        const gained = Math.floor(roll / 2);
        ctx.changeResources(ctx.seat, gained);
        ctx.logPublic(`Barkbone Strapping: rolled ${roll}, gained {r}${gained}`);
        ctx.destroySelf();
    },
  },
};
