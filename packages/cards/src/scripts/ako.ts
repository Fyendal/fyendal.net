import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { discardSixPlusPayoff, isSixPlus, localizedCardLog, opponentSeat, yesNoPrompt } from "./shared-helpers.js";

const MIGHT = "AKO028";

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("attack");
}

function isOnCombatChain(ctx: ScriptCtx, instanceId: number): boolean {
  return ctx.state.chain.some((link) => [
    link.attackingCard,
    ...link.defendingCards,
    ...link.defendingEquipment,
    ...link.reactions,
  ].some((card) => card.instanceId === instanceId));
}

export const ako: Record<string, CardScript> = {
  "kayo, armed and dangerous|0": {
    modifyBasePower(ctx, card, base) {
      if (card.owner !== ctx.seat || !isAttackAction(ctx, card) || isOnCombatChain(ctx, card.instanceId)) {
        return base;
      }
      return base + 1;
    },
    triggers: [{
      event: "card-discarded",
      label: "Create a Might token",
      condition: (ctx, discarded) =>
        ctx.state.activePlayer === ctx.seat &&
        ctx.state.phase !== "start" &&
        ctx.state.phase !== "end" &&
        ctx.state.phase !== "game-over" &&
        ctx.getFlag("player", "kayoMightTriggered") !== true &&
        isSixPlus(ctx, discarded),
      onTrigger: (ctx) => ctx.setFlag("player", "kayoMightTriggered", true),
      effect: (ctx) => ctx.createToken(MIGHT),
    }],
  },
  "savage sash|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          appliesTo: "attack-action",
          minBasePower: 6,
          playCostReduction: 1,
        });
      },
    },
  },
  "hide tanner|0": {
    triggers: [{
      event: "card-discarded",
      label: "Destroy this to create 2 Might tokens?",
      condition: (ctx, discarded, eventContext) =>
        eventContext?.atRandom === true && isSixPlus(ctx, discarded),
      effect: (ctx) => ctx.requestChoice(
        "hide-tanner",
        yesNoPrompt(
          "Destroy Hide Tanner to create 2 Might tokens?",
          "card.ako.hide.tanner.destroy",
        ),
        ["yes", "no"],
      ),
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "hide-tanner" || option !== "yes") return;
      ctx.destroySelf();
      ctx.createTokens(MIGHT, 2);
    },
  },
  "savage beatdown|1": {
    canPlay: (ctx) => ctx.getFlag("player", "discardedSixPlusThisTurn") === true,
    requiredHandCardsForAdditionalCost: 1,
    additionalCost(ctx) {
      const discarded = ctx.discardRandom(ctx.seat, 1)[0];
      ctx.setCounter("discardedSix", isSixPlus(ctx, discarded) ? 1 : 0);
    },
    modifyAttack: (ctx) => ctx.getCounter("discardedSix") === 1 ? 6 : 0,
  },
  "strength rules all|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const arsenal = ctx.player(opponentSeat(ctx)).arsenal[0];
      if (!arsenal) return;
      ctx.turnArsenalFaceUp(arsenal.instanceId);
      if (isAttackAction(ctx, arsenal) && ctx.basePower(arsenal) < (ctx.link?.damage ?? 0)) {
        ctx.banish(arsenal.instanceId);
      }
    },
  },
  // Bare Fangs (red)
  "bare fangs|1": discardSixPlusPayoff((ctx) => {
    ctx.addModifier({ scope: "chain-link", attack: 2 });
    ctx.logPublic(localizedCardLog(ctx, "Bare Fangs gains +2 attack", "card.log.ska.barefangs.attack", { amount: 2 }));
  }),
  // Wild Ride (red)
  "wild ride|1": discardSixPlusPayoff((ctx) => {
    ctx.grantGoAgain();
    ctx.logPublic(localizedCardLog(ctx, "Wild Ride gains go again", "card.log.common.goagain.gained"));
  }),
};
