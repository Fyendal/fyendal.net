import type { CardInstance, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, commonOptionMessages, decisionPrompt, localizedLog } from "../shared-helpers.js";

type Card = DeepReadonly<CardInstance>;

const BLADE_DANCE = "MPW134";
const MPW_FLURRY = "MPW135";
const SBL_FLURRY = "SBL036";

export const SHARPEN_FOLLOWUP = {
  SBL_FLURRY: 1,
  DISCOUNT: 2,
  BLADE_DANCE: 3,
  MPW_FLURRY: 4,
  DRAW_ON_HIT: 5,
  TOP_ATTACK_REACTION: 6,
  ATTACK_WITH_SWORD: 7,
  DEFENDED_DAMAGE: 8,
} as const;

export type SharpenFollowupKind = typeof SHARPEN_FOLLOWUP[keyof typeof SHARPEN_FOLLOWUP];

export interface SharpenFollowup {
  threshold: number;
  kind: SharpenFollowupKind;
}

function isSword(ctx: ScriptCtx, card: Card): boolean {
  return ctx.cardTypes(card).some((type) => type.toLowerCase() === "sword");
}

function controlledSword(ctx: ScriptCtx, instanceId: number): Card | undefined {
  return ctx.player(ctx.seat).weapons.find((card) =>
    card.instanceId === instanceId && isSword(ctx, card)
  );
}

export function resolveSharpenFollowup(
  ctx: ScriptCtx,
  instanceId: number,
  threshold: number,
  kind: number,
): void {
  const sword = controlledSword(ctx, instanceId);
  if (!sword || Number(sword.counters?.power ?? 0) < threshold) return;

  switch (kind) {
    case SHARPEN_FOLLOWUP.SBL_FLURRY:
      ctx.createToken(SBL_FLURRY);
      break;
    case SHARPEN_FOLLOWUP.DISCOUNT:
      buffNextAttack(ctx, { attackActivationCostReduction: 1, appliesToInstanceId: instanceId });
      break;
    case SHARPEN_FOLLOWUP.BLADE_DANCE:
      ctx.createToken(BLADE_DANCE);
      break;
    case SHARPEN_FOLLOWUP.MPW_FLURRY:
      ctx.createToken(MPW_FLURRY);
      break;
    case SHARPEN_FOLLOWUP.DRAW_ON_HIT:
      ctx.addModifier({
        scope: "until-end-of-turn",
        appliesToInstanceId: instanceId,
        onHitDraw: 1,
        once: true,
      });
      break;
    case SHARPEN_FOLLOWUP.TOP_ATTACK_REACTION: {
      const reactions = ctx.player(ctx.seat).graveyard.filter((card) =>
        ctx.cardData(card.cardId).cardType === "attack-reaction"
      );
      if (reactions.length) {
        ctx.requestCardChoice(
          "rerebrace-honed-top",
          decisionPrompt("Put an attack reaction on top?", "card.aha.attackreaction.top", { optionMessages: commonOptionMessages("no") }),
          ["no", ...reactions.map((card) => card.instanceId)],
        );
      }
      break;
    }
    case SHARPEN_FOLLOWUP.ATTACK_WITH_SWORD:
      ctx.attackWithPermanent(instanceId);
      break;
    case SHARPEN_FOLLOWUP.DEFENDED_DAMAGE:
      ctx.addModifier({
        scope: "next-attack",
        appliesToInstanceId: instanceId,
        onDefendedDealDamage: 1,
      });
      break;
  }
}

/** Apply the Sharpen keyword and the Hala armory-deck interactions that can
 * replace or continuously react to that event. */
export function sharpenSword(
  ctx: ScriptCtx,
  instanceId: number,
  count = 1,
  followup?: SharpenFollowup,
): void {
  const sword = controlledSword(ctx, instanceId);
  if (!sword) return;

  const extra = ctx.getFlag("player", "ahaExtraSharpen") === true ? 1 : 0;
  if (extra) ctx.setFlag("player", "ahaExtraSharpen", false);
  const total = count + extra;
  ctx.addCounter(instanceId, "power", total);
  ctx.setCardCounter(instanceId, "sharpenedTurn", ctx.state.turn);
  ctx.setFlag(
    "player",
    "clearWeaponPowerCountersAtTurn",
    ctx.state.activePlayer === ctx.seat ? ctx.state.turn : ctx.state.turn + 1,
  );
  ctx.logPublic(localizedLog(`${ctx.cardData(sword.cardId).name} is sharpened ${total} time(s)`, "card.log.aha.sword.sharpened", { target: { kind: "card", cardId: sword.cardId }, count: total }));

  const isZenithBlade = ctx.cardData(sword.cardId).name === "Zenith Blade";
  if (
    isZenithBlade &&
    ctx.link?.attackingCard.instanceId === instanceId &&
    Number(ctx.getFlag("player", `attackedInstance:${instanceId}`)) === 1
  ) {
    ctx.grantGoAgain(instanceId);
  }

  const rerebrace = isZenithBlade
    ? Object.values(ctx.player(ctx.seat).equipment).find((card) =>
        card && ctx.cardData(card.cardId).name === "Reverent Rerebrace"
      )
    : undefined;
  if (rerebrace) {
    ctx.setCardCounter(rerebrace.instanceId, "sharpenTarget", instanceId);
    ctx.setCardCounter(rerebrace.instanceId, "sharpenFollowupThreshold", followup?.threshold ?? 0);
    ctx.setCardCounter(rerebrace.instanceId, "sharpenFollowupKind", followup?.kind ?? 0);
    const requested = ctx.requestPaymentFrom(
      rerebrace.instanceId,
      "rerebrace-sharpen",
      decisionPrompt("Reverent Rerebrace: pay 1 and destroy this to sharpen an additional time?", "card.aha.rerebrace.pay.sharpen", { values: { amount: 1 } }),
      1,
    );
    if (requested) return;
  }

  if (followup) resolveSharpenFollowup(ctx, instanceId, followup.threshold, followup.kind);
}
