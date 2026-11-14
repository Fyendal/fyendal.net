import type { CardInstance, CardScript, DeepReadonly, ScriptCtx, TriggerDef } from "@fyendal/engine";
import { SILVER } from "../tokens.js";
import { cardNamed, hasCardSubtype, isDagger } from "./cards.js";
import { decisionMessage, localizedCardLog } from "./messages.js";
import { opponentSeat, targetsHero } from "./state.js";

export function hitWithDaggerThisChain(ctx: ScriptCtx): boolean {
  return ctx.state.chain.some(
    (link) =>
      link.attacker === ctx.seat &&
      ((link.damage > 0 && isDagger(ctx, link.attackingCard)) ||
        Number(link.flags["effectDamageBySubtype:dagger"]) > 0),
  );
}

export function hitsHeroAfterDaggerHit(ctx: ScriptCtx): boolean {
  return targetsHero(ctx) && hitWithDaggerThisChain(ctx);
}

/** "Whenever you complete this contract, create a Silver token." */
export function completeContractForSilver(ctx: ScriptCtx): void {
  ctx.completeContract();
  ctx.createToken(SILVER);
}

/** Contract: complete it and create a Silver whenever a banished opposing card meets `condition`. */
export function contractWithSilver(
  condition: (ctx: ScriptCtx, card: DeepReadonly<CardInstance>) => boolean,
): CardScript {
  return {
    onFriendlyBanishesOpponentCard(ctx, card) {
      if (condition(ctx, card)) completeContractForSilver(ctx);
    },
  };
}

/** "While this is in your graveyard, at the start of your turn, you may
 * destroy N Silver you control. If you do, equip this." */
export function equipWithSilver(amount: number): TriggerDef {
  const silverControlled = (ctx: ScriptCtx) =>
    ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "Silver"));
  return {
    event: "start-of-turn",
    sourceZone: "graveyard",
    optional: true,
    label: `Destroy ${amount} Silver to equip this`,
    labelMessage: decisionMessage("card.trigger.common.silver.equip", { amount }),
    warningMessage: (ctx) =>
      canEquipFromGraveyard(ctx)
        ? undefined
        : decisionMessage("card.trigger.common.silver.equip.blocked", {
            card: { kind: "card", cardId: ctx.self.cardId },
          }),
    condition(ctx) {
      return silverControlled(ctx).length >= amount;
    },
    effect(ctx) {
      const silver = silverControlled(ctx).slice(0, amount);
      if (silver.length === amount && silver.every((card) => ctx.destroyPermanent(card.instanceId))) {
        ctx.equipFromGraveyard(ctx.self.instanceId);
      }
    },
  };
}

/** Equipment that may be equipped from the graveyard by destroying 2 Silver. */
export function silverEquipment(extra: CardScript = {}): CardScript {
  return { ...extra, triggers: [...(extra.triggers ?? []), equipWithSilver(2)] };
}

function canEquipFromGraveyard(ctx: ScriptCtx): boolean {
  const subtypes = ctx.cardTypes(ctx.self);
  const player = ctx.player(ctx.seat);
  const slot = (["head", "chest", "arms", "legs"] as const).find((candidate) => subtypes.includes(candidate));
  if (slot) return ctx.equipmentZoneEmpty(ctx.seat, slot);
  const hands = subtypes.includes("2h") ? 2 : 1;
  const occupied = player.weapons.reduce((total, card) => total + (hasCardSubtype(ctx, card, "2h") ? 2 : 1), 0);
  return occupied + hands <= 2;
}

/** Live Assassin attack action cards with contract on the chain. */
export function assassinContractAttackTargets(ctx: ScriptCtx): number[] {
  return ctx.state.chain
    .filter((link) =>
      link.flags.attackGone !== true &&
      link.attackCardType === "action" &&
      hasCardSubtype(ctx, link.attackingCard, "assassin") &&
      ctx.hasKeyword(link.attackingCard, "contract")
    )
    .map((link) => link.attackingCard.instanceId);
}

/** Shared printed ability of Arakni, Marionette and Arakni, Web of Deceit. */
export function markedStealthHeroScript(agentCardIds: readonly string[]): CardScript {
  return {
    modifyAttack(ctx) {
      const link = ctx.link;
      if (!link || link.targetAllyId !== undefined || !ctx.hasKeyword(link.attackingCard, "stealth")) return 0;
      return isMarked(ctx, opponentSeat(ctx)) ? 1 : 0;
    },
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return (
        !!link &&
        link.targetAllyId === undefined &&
        ctx.hasKeyword(link.attackingCard, "stealth") &&
        link.flags.targetWasMarkedOnHit === true
      );
    },
    onHit(ctx) {
      ctx.grantGoAgain();
    },
    triggers: [
      {
        event: "end-of-turn",
        condition: (ctx) => isMarked(ctx, opponentSeat(ctx)),
        label: "Become a random Agent of Chaos",
        effect(ctx) {
          ctx.becomeHero(agentCardIds[ctx.randomInt(agentCardIds.length)]!);
        },
      },
    ],
  };
}

export function isMarked(ctx: ScriptCtx, seat: number): boolean {
  return (ctx.player(seat).hero.scriptState?.marked ?? 0) > 0;
}

export function markHero(ctx: ScriptCtx, seat: number): void {
  const hero = ctx.player(seat).hero;
  if ((hero.scriptState?.marked ?? 0) > 0) return;
  ctx.addCardState(hero.instanceId, "marked", 1);
  ctx.logPublic(
    localizedCardLog(ctx, `${ctx.cardData(hero.cardId).name} is marked`, "card.log.common.hero.marked", {
      target: { kind: "card", cardId: hero.cardId },
    }),
  );
}

/** Mark is removed by the hit itself, so read the hit-event snapshot on the link. */
export function hitMarkedHero(ctx: ScriptCtx): boolean {
  return ctx.link?.flags.targetWasMarkedOnHit === true;
}
