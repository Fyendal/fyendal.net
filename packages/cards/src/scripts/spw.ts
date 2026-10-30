import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { attackAbility, cardNamed, crowdTrigger, opponentSeat } from "./shared-helpers.js";

/** Seats in turn order, starting with the turn player. */
function heroSeatsInTurnOrder(ctx: ScriptCtx): number[] {
  const count = ctx.state.players.length;
  return ctx.state.players.map((_, offset) => (ctx.state.activePlayer + offset) % count);
}

/** Player flags reset each turn, so the key marks the turn's first occurrence. */
function firstThisTurn(ctx: ScriptCtx, key: string): boolean {
  if (ctx.getFlag("player", key) === true) return false;
  ctx.setFlag("player", key, true);
  return true;
}

export const spw: Record<string, CardScript> = {
  "killjoy, the crooked blade|0": {
    triggers: [
      {
        event: "card-stolen",
        ...crowdTrigger("boo"),
        condition: (ctx, stolen) => !!stolen && cardNamed(ctx, stolen, "Gold"),
      },
    ],
    onBooed(ctx) {
      if (!firstThisTurn(ctx, "killjoyBooed")) return;
      const healthier = heroSeatsInTurnOrder(ctx).filter((seat) => ctx.compareLife(seat, ctx.seat) > 0);
      for (const seat of healthier) ctx.loseLife(seat, 1);
    },
  },
  "cutpurse rapier|0": {
    activated: attackAbility(1),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const gold = ctx.player(opponentSeat(ctx)).board.find((card) => cardNamed(ctx, card, "Gold"));
      if (gold) ctx.steal(gold.instanceId, { duration: "indefinite" });
    },
  },
  "zane, broadly beloved|0": {
    equipsTwoHandedAsOneHanded: "sword",
    triggers: [{ event: "wager-won", ...crowdTrigger("cheer") }],
    onCheered(ctx) {
      if (!firstThisTurn(ctx, "zaneCheered")) return;
      for (const seat of heroSeatsInTurnOrder(ctx)) ctx.drawCards(seat, 1);
    },
  },
  "celebrant broadsword|0": {
    activated: attackAbility(2),
    hasConditionalGoAgain: (ctx) => ctx.getFlag("player", "cheeredThisTurn") === true,
  },
};
