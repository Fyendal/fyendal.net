import type { CardInstance, CardScript, DeepReadonly, Modifier, ScriptCtx, TriggerDef } from "@fyendal/engine";
import type { GameMessage } from "@fyendal/shared";
import { decisionMessage, localizedLog } from "./messages.js";
import { opponentSeat } from "./state.js";

interface DelayedEffectFilter {
  /** Modifier scope to match; "any" matches every scope. Defaults to
   * "until-end-of-turn". */
  scope?: Modifier["scope"] | "any";
  match?: (modifier: DeepReadonly<Modifier>) => boolean;
}

/** Arm "the next time … this turn"; the unconsumed modifier is the whole pending state, one per copy. */
export function armDelayedEffect(
  ctx: ScriptCtx,
  label?: Pick<Modifier, "ongoingLabel" | "ongoingLabelMessage">,
): void {
  ctx.addModifier({ scope: "until-end-of-turn", ...label });
}

/** This card's first unconsumed modifier matching the filter. */
export function pendingDelayedEffect(
  ctx: ScriptCtx,
  { scope = "until-end-of-turn", match }: DelayedEffectFilter = {},
): DeepReadonly<Modifier> | undefined {
  return ctx.state.modifiers.find(
    (modifier) =>
      modifier.sourceInstanceId === ctx.self.instanceId &&
      (scope === "any" || modifier.scope === scope) &&
      !modifier.consumed &&
      (match?.(modifier) ?? true),
  );
}

/** Consume this card's pending delayed effect, returning whether one was
 * pending. Call it when the effect fires so its label disappears with it. */
export function consumeDelayedEffect(ctx: ScriptCtx, filter?: DelayedEffectFilter): boolean {
  const pending = pendingDelayedEffect(ctx, filter);
  return pending ? ctx.consumeModifier(pending.id) : false;
}

const GRANTED_HIT_TARGET = "grantedHitTarget";

/** Grant this card's on-hit rider to an attack, by default the active one, for
 * the combat chain. The attack keeps it after its link resolves, so a later
 * effect hit (Flick Knives) must still fire it. */
export function armGrantedHitRider(
  ctx: ScriptCtx,
  label?: Pick<Modifier, "ongoingLabel" | "ongoingLabelMessage">,
  target: number = ctx.link!.attackingCard.instanceId,
): void {
  ctx.addModifier({ scope: "until-end-of-turn", expiresOnChainClose: true, ...label });
  ctx.setState(GRANTED_HIT_TARGET, target);
}

function grantedHitRiderOn(ctx: ScriptCtx, card: DeepReadonly<CardInstance> | undefined): boolean {
  return !!card && ctx.getState(GRANTED_HIT_TARGET) === card.instanceId && !!pendingDelayedEffect(ctx);
}

/** The hit hooks for a rider armed with `armGrantedHitRider`: "When this hits a hero, ...".
 * Its card also needs both on-hit-scope.ts entries, or a resolved reaction never fires it. */
export function chainHitRider(
  effect: (ctx: ScriptCtx, hitSeat: number) => void,
): Pick<CardScript, "canTriggerOnHit" | "onHit" | "onFriendlyEffectHitCondition" | "onFriendlyEffectHit"> {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined && grantedHitRiderOn(ctx, ctx.link?.attackingCard),
    onHit: (ctx) => effect(ctx, opponentSeat(ctx)),
    onFriendlyEffectHitCondition: grantedHitRiderOn,
    onFriendlyEffectHit: (ctx, _source, targetSeat) => effect(ctx, targetSeat),
  };
}

/** "When this enters the arena" or "When this is equipped": a triggered layer
 * added after the object enters (CR 6.6.5), not an immediate hook. Keep
 * replacement effects such as "enters the arena with counters" in
 * `onEnterArena`. Starting equipment never enters mid-game; give it an
 * `onGameStart` when its equip effect must also apply at game start.
 *
 * For "When …, if …", pass the "if" as `condition` and check it again in the
 * effect: it belongs to the generated effect, which is evaluated on
 * resolution (CR 6.6.1c, 6.1.3). The same applies to `leavesArenaTrigger`. */
export function entersArenaTrigger(
  label: string,
  labelMessage: GameMessage,
  effect: (ctx: ScriptCtx) => void,
  extra: Partial<TriggerDef> = {},
): TriggerDef {
  return { event: "card-entered-arena", sourceZone: "self", label, labelMessage, effect, ...extra };
}

/** "When this leaves the arena": a triggered layer added after the object left
 * (CR 6.6.5). Its effect reads the object's last-known information. Keep
 * bookkeeping that must happen as it leaves in `onLeaveArena`. */
export function leavesArenaTrigger(
  label: string,
  labelMessage: GameMessage,
  effect: (ctx: ScriptCtx) => void,
  extra: Partial<TriggerDef> = {},
): TriggerDef {
  return { event: "card-left-arena", sourceZone: "self", label, labelMessage, effect, ...extra };
}

/** Solflare: a triggered layer raised when this is charged to its hero's soul. */
export function solflareTrigger(
  label: string,
  labelMessage: GameMessage,
  effect: (ctx: ScriptCtx) => void,
): TriggerDef {
  return { event: "card-charged", sourceZone: "self", label, labelMessage, effect };
}

/** "When this is destroyed, ...": a triggered layer raised by this card's own
 * destruction, added before the next player receives priority (CR 6.6.6). */
export function destroyedTrigger(
  label: string,
  labelMessage: GameMessage,
  effect: (ctx: ScriptCtx) => void,
): TriggerDef {
  return {
    event: "card-destroyed",
    sourceZone: "self",
    label,
    labelMessage,
    condition: (ctx, destroyed) => destroyed?.instanceId === ctx.self.instanceId,
    effect,
  };
}

/** "When this attacks[ a hero][, if …], intimidate[ them]." Intimidate is an
 * effect keyword (CR 8.5.10): the printed keyword grants nothing, so every
 * attack that intimidates declares this trigger. `hero` limits it to attacks
 * on a hero; `effect` runs any further payoff of the same ability. The "if" is
 * checked again on resolution (CR 6.6.1c). */
export function attackIntimidateTrigger(
  opts: {
    hero?: boolean;
    condition?: (ctx: ScriptCtx) => boolean;
    effect?: (ctx: ScriptCtx) => void;
  } = {},
): TriggerDef {
  const applies = (ctx: ScriptCtx) =>
    (!opts.hero || ctx.link?.targetAllyId === undefined) && (!opts.condition || opts.condition(ctx));
  return {
    event: "attack-declared",
    sourceZone: "self",
    label: "Intimidate",
    labelMessage: decisionMessage("card.trigger.common.intimidate"),
    condition: applies,
    effect(ctx) {
      if (!applies(ctx)) return;
      opts.effect?.(ctx);
      ctx.intimidate();
    },
  };
}

/** "Whenever a card defends this": one trigger for each defending card. */
export const cardDefendsThisTrigger: NonNullable<CardScript["friendlyDefendedTrigger"]> = {
  label: "Whenever a card defends this",
  labelMessage: { id: "card.trigger.common.defend.card" },
  perDefender: true,
};

export function queueIntimidate(ctx: ScriptCtx): void {
  const n = Number(ctx.getFlag("player", "pendingIntimidate")) || 0;
  ctx.setFlag("player", "pendingIntimidate", n + 1);
  ctx.logPublic(
    localizedLog(`${ctx.data.name}: intimidate`, "card.log.common.intimidate", {
      card: { kind: "card", cardId: ctx.self.cardId },
    }),
  );
}

type NextAttackMod = Omit<Modifier, "id" | "sourceInstanceId" | "sourceCardId" | "scope" | "defense" | "seat">;

type NextAttackModWithSeat = NextAttackMod & { seat?: number };

/** Apply a modifier scoped to the controller's next attack this turn. */
export function buffNextAttack(ctx: ScriptCtx, mod: NextAttackModWithSeat, source?: DeepReadonly<CardInstance>): void {
  ctx.addModifier({ scope: "next-attack", seat: ctx.seat, ...mod }, source);
}

/** "Your next … attack this turn gains …" on-play buff factory */
export function nextAttack(mod: NextAttackMod) {
  return (ctx: ScriptCtx) => buffNextAttack(ctx, mod);
}

/** This source's next-attack modifier landed on the active link, so its granted riders apply. */
export function armedBySelf(ctx: ScriptCtx): boolean {
  return ctx.state.modifiers.some((m) => m.scope === "chain-link" && m.sourceInstanceId === ctx.self.instanceId);
}
