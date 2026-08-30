import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, isSwordAttack } from "./shared-helpers.js";

function swordHit(ctx: ScriptCtx, sourceCardId: string, amount: number): boolean {
  if (amount <= 0 || !ctx.link || ctx.link.attackingCard.cardId !== sourceCardId) return false;
  return ctx.link.attackCardType === "weapon" && ctx.cardTypes(ctx.link.attackingCard).includes("sword");
}

export const ddd: Record<string, CardScript> = {
  "squire's bracers|0": {
    onFriendlyCombatDamageDealt(ctx, source, _target, amount) {
      if (!swordHit(ctx, source.cardId, amount)) return;
      ctx.requestChoice(
        "squires-bracers",
        "Squire's Bracers: destroy this so the sword's next attack gets +2{p}?",
        ["yes", "no"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "squires-bracers" || option !== "yes") return;
      ctx.destroySelf();
      buffNextAttack(ctx, { attack: 2, appliesTo: "sword" });
    },
  },
  "cutting couriers|0": {
    onFriendlyCombatDamageDealt(ctx, source, _target, amount) {
      if (!swordHit(ctx, source.cardId, amount)) return;
      ctx.requestChoice(
        "cutting-couriers",
        "Cutting Couriers: destroy this so the attack gets go again?",
        ["yes", "no"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "cutting-couriers" || option !== "yes") return;
      ctx.destroySelf();
      ctx.grantGoAgain();
    },
  },
  "back for seconds|2": {
    canPlay: isSwordAttack,
    onPlay(ctx) {
      const attacks = Number(ctx.getPlayerFlag(ctx.seat, "attacksDeclaredThisTurn"));
      ctx.addModifier({ scope: "chain-link", attack: attacks === 2 ? 3 : 2 });
    },
  },
};
