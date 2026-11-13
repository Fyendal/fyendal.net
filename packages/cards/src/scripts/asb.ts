import type { CardScript, ScriptCtx } from "@fyendal/engine";
import {
  chargeAttack,
  chargeDeclineMessages,
  chargedThisTurn,
  decisionPrompt,
  isChargeDecline,
  isLight,
  localizedCardLog,
  optionalChargeOptions,
} from "./shared-helpers.js";
import { COURAGE, QUICKEN } from "./tokens.js";

function graceEquipment(effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    onDefend(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length) {
        ctx.requestCardChoice(
          "grace-charge",
          decisionPrompt(`${ctx.data.name}: charge a card, or decline`, "card.asb.charge.choose", {
            values: { card: { kind: "card", cardId: ctx.self.cardId } },
            optionMessages: chargeDeclineMessages,
          }),
          optionalChargeOptions(ctx),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "grace-charge" || isChargeDecline(option)) return;
      const charged = ctx.charge(Number(option));
      if (charged && ctx.cardColor(charged) === 2) effect(ctx);
    },
  };
}

export const asb: Record<string, CardScript> = {
  "helm of halo's grace|0": graceEquipment((ctx) => ctx.drawCards(ctx.seat, 1)),
  "bracers of bellona's grace|0": graceEquipment((ctx) => ctx.createToken(COURAGE)),
  "warpath of winged grace|0": graceEquipment((ctx) => ctx.createToken(QUICKEN)),
  "solar plexus|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      banishSoulCost: 1,
      onActivate(ctx) {
        ctx.addModifier({ scope: "until-end-of-turn", appliesToPitch: 2, playCostReduction: 1 });
      },
    },
  },
  "saving grace|2": chargeAttack({
    onPlay(ctx) {
      if (chargedThisTurn(ctx)) {
        ctx.addModifier({ scope: "chain-link", attack: -2, seat: ctx.link?.attacker });
      }
    },
  }),
  "lumina ascension|2": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", appliesTo: "weapon", attack: 1 });
      if (chargedThisTurn(ctx)) {
        for (const weapon of ctx.player(ctx.seat).weapons) ctx.grantAdditionalActivation(weapon.instanceId);
      }
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.attackingCard !== undefined && ctx.hasCardType(ctx.link.attackingCard, "weapon");
    },
    onHit(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      ctx.logPublic(
        localizedCardLog(
          ctx,
          `${ctx.data.name} reveals ${ctx.cardData(top.cardId).name}`,
          "card.log.common.decktop.revealed",
          { revealed: { kind: "card", cardId: top.cardId } },
          { kind: "cards-revealed", cards: [{ cardId: top.cardId, ownerSeat: ctx.seat }], sourceZone: "deck" },
        ),
      );
      if (isLight(ctx, top)) {
        ctx.putIntoSoul(top.instanceId);
        ctx.gainLife(ctx.seat, 1);
      } else {
        ctx.putOnDeckBottom(top.instanceId);
      }
    },
  },
};
