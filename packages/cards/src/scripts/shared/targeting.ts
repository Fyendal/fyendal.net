import type { CardInstance, DeepReadonly, ScriptCtx, ScriptPrompt, TriggerDef, TriggerTarget } from "@fyendal/engine";
import type { GameMessage } from "@fyendal/shared";
import { isAlly } from "./cards.js";
import { commonOptionMessages, decisionPrompt } from "./messages.js";
import { opponentSeat } from "./state.js";

/** "Up to 1 target attack": any attack on the combat chain that hasn't ceased
 * to be one, optionally narrowed by `eligible`. The engine rechecks the
 * declared target on resolution, so effects can use `ctx.playTargetInstanceId`. */
export function upToOneTargetAttack(
  eligible: (ctx: ScriptCtx, attack: DeepReadonly<CardInstance>) => boolean = () => true,
): NonNullable<TriggerDef["target"]> {
  return {
    options: (ctx) =>
      ctx.state.chain
        .filter((link) => link.flags.attackGone !== true && eligible(ctx, link.attackingCard))
        .map((link) => link.attackingCard.instanceId),
    prompt: (ctx) =>
      decisionPrompt(`${ctx.data.name}: choose up to 1 target attack`, "card.common.attack.target.upto", {
        values: { card: { kind: "card", cardId: ctx.self.cardId } },
        optionMessages: commonOptionMessages("pass"),
      }),
    optional: true,
  };
}

/** "Target hero" declared by a trigger; read it with `targetHeroSeat`. */
export function heroTarget(
  opts: { optional?: boolean; eligible?: (ctx: ScriptCtx, seat: number) => boolean } = {},
): TriggerTarget {
  return {
    options: (ctx) =>
      ctx.state.players
        .filter((player) => !opts.eligible || opts.eligible(ctx, player.seat))
        .map((player) => player.hero.instanceId),
    prompt: (ctx) =>
      decisionPrompt(`${ctx.data.name}: choose target hero`, "card.common.target.hero.choose", {
        values: { card: { kind: "card", cardId: ctx.self.cardId } },
        ...(opts.optional ? { optionMessages: commonOptionMessages("pass") } : {}),
      }),
    ...(opts.optional ? { optional: true } : {}),
  };
}

/** Seat of the hero a resolving layer declared with `heroTarget`. */
export function targetHeroSeat(ctx: ScriptCtx): number | undefined {
  const id = ctx.playTargetInstanceId;
  return id === undefined ? undefined : ctx.state.players.find((player) => player.hero.instanceId === id)?.seat;
}

/** "Any target" for damage: each hero and each ally, as the card instance ids
 * a trigger declares. `opposing` keeps only those the opponent controls. */
function anyTargetIds(ctx: ScriptCtx, opts: { opposing?: boolean } = {}): number[] {
  return ctx.state.players
    .filter((player) => !opts.opposing || player.seat !== ctx.seat)
    .flatMap((player) => [
      player.hero.instanceId,
      ...player.board.filter((card) => isAlly(ctx, card)).map((card) => card.instanceId),
    ]);
}

/** A trigger's "any target" damage declaration over `anyTargetIds`. Pair it
 * with `dealToAnyTarget(ctx, ctx.playTargetInstanceId, …)` in the effect. */
export function anyDamageTarget(
  prompt: (ctx: ScriptCtx) => ScriptPrompt,
  opts: { opposing?: boolean; optional?: boolean } = {},
): TriggerTarget {
  return {
    options: (ctx) => anyTargetIds(ctx, opts),
    prompt,
    ...(opts.optional ? { optional: true } : {}),
  };
}

/** Deal damage to a hero or ally named by its instance id. Returns the damage
 * dealt, or 0 when nothing is named or the ally has left the arena. */
export function dealToAnyTarget(
  ctx: ScriptCtx,
  instanceId: number | undefined,
  amount: number,
  opts: { arcane?: boolean; sourceInstanceId?: number } = {},
): number {
  if (instanceId === undefined) return 0;
  const hero = ctx.state.players.find((player) => player.hero.instanceId === instanceId);
  if (hero) return ctx.dealDamage(hero.seat, amount, opts);
  const controller = ctx.state.players.find((player) => player.board.some((card) => card.instanceId === instanceId));
  if (!controller) return 0;
  return ctx.dealDamage(controller.seat, amount, { ...opts, targetAllyId: instanceId });
}

type HeroChoiceOption = "opposing hero" | "your hero";

/** Hero choice named relative to the chooser; resolve with `heroChoiceSeat`. */
export function requestHeroChoice(
  ctx: ScriptCtx,
  hook: string,
  fallback: string,
  id: string,
  options: {
    values?: GameMessage["values"];
    defaultOption?: HeroChoiceOption;
    /** Seats that may be chosen; both by default. */
    seats?: readonly number[];
    /** Offer "pass" first, for "you may" effects. */
    optional?: boolean;
  } = {},
): void {
  const heroes = (["opposing hero", "your hero"] as const).filter((option) =>
    !options.seats || options.seats.includes(heroChoiceSeat(ctx, option)!));
  const choices = [...(options.optional ? (["pass"] as const) : []), ...heroes];
  ctx.requestChoice(
    hook,
    decisionPrompt(fallback, id, { values: options.values, optionMessages: commonOptionMessages(...choices) }),
    [...choices],
    undefined,
    undefined,
    options.defaultOption,
  );
}

/** Seat named by a `requestHeroChoice` answer. */
export function heroChoiceSeat(ctx: ScriptCtx, option: string): number | undefined {
  // "you"/"opponent" were UPR's options; pending decisions in stored games may still carry them.
  if (option === "your hero" || option === "you") return ctx.seat;
  if (option === "opposing hero" || option === "opponent") return opponentSeat(ctx);
  return undefined;
}

interface AnyTargetChoiceOptions {
  /** Heroes only ("target hero"). */
  heroesOnly?: boolean;
  /** Only targets the opponent controls. */
  opposing?: boolean;
  /** Offer "no" first, for "you may" effects. */
  optional?: boolean;
  /** Source whose arcane bonuses the previewed amount includes; this card by default. */
  sourceInstanceId?: number;
}

/** Ask for the target of `amount` arcane damage as a text choice: "opposing
 * hero", "your hero", then each ally from `anyTargetIds` as `ally:<seat>:<id>`.
 * The prompt previews the amount. Resolve the answer with `anyTargetChoice`. */
export function requestAnyTargetChoice(
  ctx: ScriptCtx,
  hook: string,
  amount: number,
  opts: AnyTargetChoiceOptions = {},
): void {
  const preview = ctx.previewArcaneDamage(
    amount,
    opts.sourceInstanceId === undefined ? undefined : { sourceInstanceId: opts.sourceInstanceId },
  );
  const heroes: HeroChoiceOption[] = opts.opposing ? ["opposing hero"] : ["opposing hero", "your hero"];
  const allies = opts.heroesOnly
    ? []
    : anyTargetIds(ctx, { opposing: opts.opposing }).flatMap((id) => {
        const controller = ctx.state.players.find((player) => player.board.some((card) => card.instanceId === id));
        return controller ? [{ option: `ally:${controller.seat}:${id}`, id }] : [];
      });
  const options = [...(opts.optional ? ["no"] : []), ...heroes, ...allies.map((ally) => ally.option)];
  ctx.requestChoice(
    hook,
    decisionPrompt(
      `${ctx.data.name}: deal ${preview} arcane damage to a ${opts.heroesOnly ? "hero" : "target"}`,
      opts.heroesOnly ? "card.common.arcane.hero.choose" : "card.common.arcane.target.choose",
      {
        values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: preview },
        optionMessages: commonOptionMessages(...(opts.optional ? (["no"] as const) : []), ...heroes),
      },
    ),
    options,
    ctx.seat,
    [...(opts.optional ? [null] : []), ...heroes.map(() => null), ...allies.map((ally) => ally.id)],
    "opposing hero",
  );
}

/** The hero seat and ally named by a `requestAnyTargetChoice` answer;
 * undefined when the choice was declined. */
export function anyTargetChoice(ctx: ScriptCtx, option: string): { seat: number; allyId?: number } | undefined {
  const ally = /^ally:(\d+):(\d+)$/.exec(option);
  if (ally) return { seat: Number(ally[1]), allyId: Number(ally[2]) };
  const seat = heroChoiceSeat(ctx, option);
  return seat === undefined ? undefined : { seat };
}
