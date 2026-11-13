import type { ActivatedAbility, CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { yesNoPrompt } from "./messages.js";

const BLOOD_DEBT = {
  simultaneousKey: "blood-debt",
  label: "Blood Debt — lose 1 life",
  publicLog: "Blood Debt triggers",
  publicLogMessage: { id: "card.log.common.blooddebt.triggered" },
  transformHookPrefix: "blood-debt-transform:",
  youngLeviaName: "levia",
  adultLeviaName: "levia, shadowborn abomination",
  blasmophetName: "blasmophet, levia consumed",
  redeemedName: "levia, redeemed",
} as const;

/** Blood Debt, unless the owner is Levia, Redeemed (her cards lose it). */
export function hasBloodDebt(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  if (!ctx.hasKeyword(card, "blood debt")) return false;
  const ownerHero = ctx.cardData(ctx.player(card.owner).hero.cardId).name.toLowerCase();
  return ownerHero !== BLOOD_DEBT.redeemedName || ctx.heroAbilitiesDisabled(card.owner);
}

function activeHeroName(ctx: ScriptCtx): string {
  return ctx.cardData(ctx.player(ctx.seat).hero.cardId).name.toLowerCase();
}

function isOriginalLevia(heroName: string): boolean {
  return heroName === BLOOD_DEBT.youngLeviaName || heroName === BLOOD_DEBT.adultLeviaName;
}

function leviaRemovesBloodDebt(ctx: ScriptCtx, heroName: string): boolean {
  return isOriginalLevia(heroName) && ctx.getFlag("player", "banishedSixPlusThisTurn") === true;
}

/** Levia's double-faced demi-hero card in inventory, with the printing id of
 * the requested face. Either face may be registered, so check both. */
function leviaTwinFace(
  ctx: ScriptCtx,
  faceName: string,
): { card: DeepReadonly<CardInstance>; faceCardId: string } | undefined {
  for (const card of ctx.player(ctx.seat).inventory ?? []) {
    const registered = ctx.cardData(card.cardId);
    if (registered.name.toLowerCase() === faceName) return { card, faceCardId: card.cardId };
    if (registered.backId && ctx.cardData(registered.backId).name.toLowerCase() === faceName) {
      return { card, faceCardId: registered.backId };
    }
  }
  return undefined;
}

/** Levia's visible proxy for the action ability of her private twin-card
 * (CR 9.1.4a). The source card remains in inventory until resolution. */
export const leviaRedeemedAbility: ActivatedAbility = {
  cost: 0,
  isAttack: false,
  goAgain: false,
  timing: "action",
  label: "Transform into Levia, Redeemed",
  canActivate(ctx) {
    return (
      leviaTwinFace(ctx, BLOOD_DEBT.redeemedName) !== undefined &&
      ctx
        .player(ctx.seat)
        .banish.filter((card) => !card.faceDown && hasBloodDebt(ctx, card)).length >= 13
    );
  },
  onCostPaid(ctx) {
    for (const card of ctx.player(ctx.seat).banish) {
      ctx.setCardFaceDown(card.instanceId, true);
    }
  },
  onActivate(ctx) {
    const twin = leviaTwinFace(ctx, BLOOD_DEBT.redeemedName);
    if (twin) ctx.becomeHeroFromInventory(twin.card.instanceId, twin.faceCardId);
  },
};

/** Printed Blood Debt (CR 8.3.11), including Levia suppression and demi-hero
 * transformation/replacement interactions. */
export function bloodDebtScript(extra: CardScript = {}, playableFromBanish = false): CardScript {
  return {
    ...extra,
    ...(playableFromBanish ? { staticPlayableFrom: ["banish" as const] } : {}),
    onPlay(ctx) {
      if (hasBloodDebt(ctx, ctx.self))
        ctx.setFlag(
          "player",
          "bloodDebtCardsPlayedThisTurn",
          Number(ctx.getFlag("player", "bloodDebtCardsPlayedThisTurn")) + 1,
        );
      extra.onPlay?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook.startsWith(BLOOD_DEBT.transformHookPrefix)) {
        if (option === "yes") {
          const twin = leviaTwinFace(ctx, BLOOD_DEBT.blasmophetName);
          const instanceId = Number(hook.slice(BLOOD_DEBT.transformHookPrefix.length));
          if (twin?.card.instanceId === instanceId) ctx.becomeHeroFromInventory(instanceId, twin.faceCardId);
        }
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
    triggers: [
      ...(extra.triggers ?? []),
      {
        event: "end-of-turn",
        simultaneousKey: BLOOD_DEBT.simultaneousKey,
        sourceZone: "banish",
        label: BLOOD_DEBT.label,
        publicLog: BLOOD_DEBT.publicLog,
        publicLogMessage: BLOOD_DEBT.publicLogMessage,
        condition(ctx) {
          // Hero exceptions live in the hero's text box, so they stop while
          // its abilities are suppressed (e.g. Crush Confidence, Dishonor).
          if (ctx.heroAbilitiesDisabled()) return true;
          const heroName = activeHeroName(ctx);
          if (heroName === BLOOD_DEBT.redeemedName) return false;
          return !leviaRemovesBloodDebt(ctx, heroName);
        },
        effect(ctx) {
          const player = ctx.player(ctx.seat);
          const heroName = activeHeroName(ctx);
          if (heroName === BLOOD_DEBT.blasmophetName && !ctx.heroAbilitiesDisabled()) {
            const top = player.deck[0];
            if (top) ctx.banish(top.instanceId);
            return;
          }
          const previousLife = player.life;
          ctx.loseLife(ctx.seat, 1);
          if (previousLife <= 13 || ctx.player(ctx.seat).life !== 13) return;
          const transform = leviaTwinFace(ctx, BLOOD_DEBT.blasmophetName);
          if (!transform || !isOriginalLevia(heroName)) return;
          ctx.requestChoice(
            `${BLOOD_DEBT.transformHookPrefix}${transform.card.instanceId}`,
            yesNoPrompt("Transform into Blasmophet, Levia Consumed?", "card.common.levia.transform"),
            ["yes", "no"],
            undefined,
            undefined,
            "no",
          );
        },
      },
    ],
  };
}
