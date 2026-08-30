import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { opponentSeat } from "./shared-helpers.js";

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).some((candidate) => candidate.toLowerCase() === type);
}

function hasContract(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return (ctx.cardData(card.cardId).keywords ?? []).some(
    (keyword) => keyword.toLowerCase() === "contract",
  );
}

function applyContractBonus(
  ctx: ScriptCtx,
  attacking: DeepReadonly<CardInstance>,
  duringAttack = false,
): void {
  if (
    !ctx.hasCardType(attacking, "action") ||
    !ctx.cardTypes(attacking).includes("attack") ||
    !hasContract(ctx, attacking) ||
    ctx.getPlayerFlag(ctx.seat, "handContractAttackThisTurn") === true
  ) return;

  ctx.setPlayerFlag(ctx.seat, "handContractAttackThisTurn", true);
  if (duringAttack) {
    ctx.grantGoAgain();
    if (hasType(ctx, ctx.player(opponentSeat(ctx)).hero, "royal")) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
    }
    return;
  }
  ctx.addModifier({
    scope: "next-attack",
    appliesToInstanceId: attacking.instanceId,
    goAgain: true,
    ...(hasType(ctx, ctx.player(opponentSeat(ctx)).hero, "royal") ? { attack: 1 } : {}),
  });
}

export const ark: Record<string, CardScript> = {
  "the hand that pulls the strings|0": {
    activeWhileFaceUpInArsenal: true,
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      timing: "attack-reaction",
      fromArsenal: true,
      turnsFaceUp: true,
      label: "Turn this face up",
      onActivate(ctx) {
        if (ctx.link) applyContractBonus(ctx, ctx.link.attackingCard, true);
      },
    },
    onFriendlyPlay(ctx, played) {
      applyContractBonus(ctx, played);
    },
    triggers: [{
      event: "end-of-turn",
      whose: "subject",
      label: "Destroy a Silver or put this on the bottom and draw",
      effect(ctx) {
        const silver = ctx.player(ctx.seat).board.find((card) => ctx.cardData(card.cardId).name === "Silver");
        if (silver) ctx.destroyPermanent(silver.instanceId);
        else {
          ctx.putOnDeckBottom(ctx.self.instanceId);
          ctx.drawCards(ctx.seat, 1);
        }
      },
    }],
  },
};
