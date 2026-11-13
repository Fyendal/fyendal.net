import type { CardScript, ScriptCtx, TriggerDef } from "@fyendal/engine";
import { RUNECHANT } from "../tokens.js";
import { hasCardSubtype, isAttackAction, isNonAttackAction } from "./cards.js";
import { decisionMessage, localizedLog } from "./messages.js";
import { opponentSeat } from "./state.js";
import { anyTargetChoice, heroTarget, requestAnyTargetChoice, targetHeroSeat } from "./targeting.js";
import { buffNextAttack } from "./triggers.js";

/** Deal 1 arcane damage to the hero a resolving layer declared. */
export function dealArcaneToTargetHero(ctx: ScriptCtx): void {
  const seat = targetHeroSeat(ctx);
  if (seat !== undefined) dealArcane(ctx, seat, 1);
}

/** "When you attack with this[, if …], deal N arcane damage to target hero."
 * The "if" is checked again on resolution (CR 6.6.1c). */
export function attackArcaneHeroTrigger(amount = 1, condition?: (ctx: ScriptCtx) => boolean): TriggerDef {
  return {
    event: "attack-declared",
    sourceZone: "self",
    label: `Deal ${amount} arcane damage to target hero`,
    labelMessage: decisionMessage("card.trigger.common.arcane.target", { amount }),
    ...(condition ? { condition } : {}),
    target: heroTarget(),
    effect(ctx) {
      const seat = targetHeroSeat(ctx);
      if (seat !== undefined && (!condition || condition(ctx))) dealArcane(ctx, seat, amount);
    },
  };
}

/** Deal `amount` arcane damage to the target a `requestAnyTargetChoice` named. */
export function dealArcaneToAnyTargetChoice(
  ctx: ScriptCtx,
  option: string,
  amount: number,
): { seat: number; allyId?: number } | undefined {
  const target = anyTargetChoice(ctx, option);
  if (target) dealArcane(ctx, target.seat, amount, target.allyId);
  return target;
}

/** "The next card you play this turn with an arcane damage effect deals +N"; bound on play, unlike Amp. */
export function buffNextArcaneDamageCard(ctx: ScriptCtx, n: number): void {
  const bonus = Number(ctx.getPlayerFlag(ctx.seat, "nextArcaneCardBonus")) + n;
  ctx.setPlayerFlag(ctx.seat, "nextArcaneCardBonus", bonus);
  const sourceKey = `nextArcaneCardBonusSource:${ctx.self.instanceId}`;
  const sourceBonus = Number(ctx.getPlayerFlag(ctx.seat, sourceKey)) + n;
  ctx.setPlayerFlag(ctx.seat, sourceKey, sourceBonus);
  ctx.logPublic(
    localizedLog(
      `${ctx.data.name}: your next arcane damage card this turn gets +${n}`,
      "card.log.common.arcane.card.bonus",
      {
        card: { kind: "card", cardId: ctx.self.cardId },
        amount: n,
      },
    ),
  );
}

/** Withdraw this source's unbound share of `buffNextArcaneDamageCard`'s pool. */
export function withdrawNextArcaneDamageCard(ctx: ScriptCtx): void {
  const sourceKey = `nextArcaneCardBonusSource:${ctx.self.instanceId}`;
  const own = Number(ctx.getPlayerFlag(ctx.seat, sourceKey));
  if (own <= 0) return;
  const pool = Number(ctx.getPlayerFlag(ctx.seat, "nextArcaneCardBonus"));
  ctx.setPlayerFlag(ctx.seat, "nextArcaneCardBonus", Math.max(0, pool - own));
  ctx.setPlayerFlag(ctx.seat, sourceKey, 0);
}

/** Amp N: the controller's next positive arcane damage event this turn deals +N. */
export function ampNextArcane(ctx: ScriptCtx, n: number): void {
  const bonus = Number(ctx.getPlayerFlag(ctx.seat, "nextArcaneBonus")) + n;
  ctx.setPlayerFlag(ctx.seat, "nextArcaneBonus", bonus);
  const sourceKey = `nextArcaneBonusSource:${ctx.self.instanceId}`;
  const sourceBonus = Number(ctx.getPlayerFlag(ctx.seat, sourceKey)) + n;
  ctx.setPlayerFlag(ctx.seat, sourceKey, sourceBonus);
  ctx.logPublic(
    localizedLog(
      `${ctx.data.name}: your next arcane damage event this turn gets +${n}`,
      "card.log.common.arcane.event.bonus",
      {
        card: { kind: "card", cardId: ctx.self.cardId },
        amount: n,
      },
    ),
  );
}

/** Zone membership is checked directly because private arsenal cards are still face down while legality is built. */
export function wizardActionAsInstant(ctx: ScriptCtx): boolean {
  if (ctx.getFlag("player", `asInstant:${ctx.self.instanceId}`) === true) return true;
  const nonAttackAction = isNonAttackAction(ctx, ctx.self);
  if (!nonAttackAction) return false;
  const player = ctx.state.players[ctx.seat]!;
  if (
    ctx.cardData(player.heroCardId).name === "Iyslander" &&
    !ctx.heroAbilitiesDisabled(ctx.seat) &&
    ctx.state.activePlayer !== ctx.seat &&
    ctx.cardColor(ctx.self) === 3 &&
    player.arsenal.some((card) => card.instanceId === ctx.self.instanceId)
  )
    return true;
  const wizardNonAttack = hasCardSubtype(ctx, ctx.self, "wizard");
  if (!wizardNonAttack) return false;
  if (ctx.getFlag("player", "nextWizardNonAttackAsInstant") === true) return true;
  return false;
}

/** Arcane effect damage; the engine applies source-side arcane bonuses. */
export function dealArcane(ctx: ScriptCtx, targetSeat: number, n: number, targetAllyId?: number): number {
  return ctx.dealDamage(targetSeat, n, { arcane: true, targetAllyId });
}

export function createRunechants(ctx: ScriptCtx, count: number): void {
  ctx.createTokens(RUNECHANT, count);
}

export function runeCount(ctx: ScriptCtx): number {
  return ctx.player(ctx.seat).board.filter((card) => ctx.isRunechant(card)).length;
}

export function spellbladeAssault(): CardScript {
  return { onAttackDeclared: (ctx) => createRunechants(ctx, 2) };
}

export function mauvrionSkies(runechants: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        goAgain: true,
        appliesTo: "attack-action",
        appliesToClass: "runeblade",
        onHitCreateToken: { cardId: RUNECHANT, count: runechants },
      });
    },
  };
}

export function maleficIncantation(verses: number): CardScript {
  return {
    destroyAtZeroCounter: "verse",
    onEnterArena(ctx) {
      ctx.setCounter("verse", verses);
    },
    triggers: [
      {
        event: "card-played",
        label: "Remove a verse counter and create a Runechant",
        condition(ctx, played) {
          const onceKey = `maleficUsed:${ctx.self.instanceId}`;
          return (
            !!played &&
            isAttackAction(ctx, played) &&
            ctx.getFlag("player", onceKey) !== true &&
            ctx.getCounter("verse") > 0
          );
        },
        onTrigger(ctx) {
          ctx.setFlag("player", `maleficUsed:${ctx.self.instanceId}`, true);
        },
        effect(ctx) {
          ctx.setCounter("verse", ctx.getCounter("verse") - 1);
          createRunechants(ctx, 1);
        },
      },
    ],
  };
}

/** Instant-speed Wizard spell: deal arcane damage to any target. */
export function arcaneSpell(damage: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [damage],
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      requestAnyTargetChoice(ctx, "arcane-target", damage);
    },
    onChoose(ctx, hook, option) {
      if (hook === "arcane-target") {
        const target = dealArcaneToAnyTargetChoice(ctx, option, damage);
        ctx.setState("targetedAlly", target?.allyId === undefined ? 0 : 1);
      } else if (hook === "arcane") {
        // UPR asked with hero/ally instance ids; pending decisions in stored games may still carry them.
        const id = Number(option);
        const hero = ctx.state.players.find((player) => player.hero.instanceId === id);
        const owner = ctx.state.players.find((player) => player.board.some((card) => card.instanceId === id));
        if (hero) dealArcane(ctx, hero.seat, damage);
        else if (owner) dealArcane(ctx, owner.seat, damage, id);
      }
    },
  };
}

/** Deal arcane damage to a hero; `surge` runs when more than `amount` was dealt. */
export function arcaneHero(
  amount: number,
  surge?: (ctx: ScriptCtx, target: number, dealt: number) => void,
): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [amount],
    onPlay(ctx) {
      requestAnyTargetChoice(ctx, "arcane-hero", amount, { heroesOnly: true });
    },
    onChoose(ctx, hook, option) {
      if (hook === "arcane-hero") dealArcane(ctx, option === "your hero" ? ctx.seat : opponentSeat(ctx), amount);
    },
    ...(surge
      ? {
          onDamageDealt(ctx, target, dealt, arcane) {
            if (arcane && dealt > amount) surge(ctx, target, dealt);
          },
        }
      : {}),
  };
}
