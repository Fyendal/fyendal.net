import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, isSwordAttack, yesNoPrompt } from "./shared-helpers.js";

function swordWeaponAttack(ctx: ScriptCtx): boolean {
  return ctx.link?.attackCardType === "weapon" && ctx.cardTypes(ctx.link.attackingCard).includes("sword");
}

export const ddd: Record<string, CardScript> = {
  "squire's bracers|0": {
    canTriggerOnHit: swordWeaponAttack,
    onHit(ctx) {
      ctx.requestChoice(
        "squires-bracers",
        yesNoPrompt(
          "Squire's Bracers: destroy this so the sword's next attack gets +2{p}?",
          "card.ddd.squires.bracers.destroy",
        ),
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
    canTriggerOnHit: swordWeaponAttack,
    onHit(ctx) {
      ctx.requestChoice(
        "cutting-couriers",
        yesNoPrompt("Cutting Couriers: destroy this so the attack gets go again?", "card.ddd.cutting.couriers.destroy"),
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
