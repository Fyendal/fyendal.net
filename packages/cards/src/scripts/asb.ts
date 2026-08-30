import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";

const COURAGE = "ASB027";
const QUICKEN = "ASB028";
const CHARGE_HOOK = "asb-charge";

function isLight(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("light");
}

function chargeAdditionalCost(ctx: ScriptCtx): void {
  const hand = ctx.player(ctx.seat).hand;
  if (hand.length) {
    ctx.requestCardChoice(CHARGE_HOOK, `${ctx.data.name}: choose a card to charge, or decline`, [
      "no",
      ...hand.map((card) => card.instanceId),
    ]);
  }
}

function chargeOnChoose(ctx: ScriptCtx, hook: string, option: string): boolean {
  if (hook !== CHARGE_HOOK) return false;
  if (option !== "no") {
    const charged = ctx.charge(Number(option));
    if (charged) ctx.setCounter("chargedPitch", ctx.cardColor(charged));
  }
  return true;
}

function graceEquipment(effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    onDefend(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length) {
        ctx.requestCardChoice("grace-charge", `${ctx.data.name}: charge a card, or decline`, [
          "no",
          ...hand.map((card) => card.instanceId),
        ]);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "grace-charge" || option === "no") return;
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
  "saving grace|2": {
    additionalCost: chargeAdditionalCost,
    onPlay(ctx) {
      if (ctx.getFlag("player", "chargedThisTurn") === true) {
        ctx.addModifier({ scope: "chain-link", attack: -2, seat: ctx.link?.attacker });
      }
    },
    onChoose(ctx, hook, option) {
      chargeOnChoose(ctx, hook, option);
    },
  },
  "lumina ascension|2": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", appliesTo: "weapon", attack: 1 });
      if (ctx.getFlag("player", "chargedThisTurn") === true) {
        for (const weapon of ctx.player(ctx.seat).weapons) ctx.grantAdditionalActivation(weapon.instanceId);
      }
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.attackingCard !== undefined && ctx.cardData(ctx.link.attackingCard.cardId).cardType === "weapon";
    },
    onHit(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(top.cardId).name}`);
      if (isLight(ctx, top)) {
        ctx.putIntoSoul(top.instanceId);
        ctx.gainLife(ctx.seat, 1);
      } else {
        ctx.putOnDeckBottom(top.instanceId);
      }
    },
  },
};
