import type {
  ActivatedAbility,
  CardInstance,
  CardScript,
  DamageEventContext,
  DeepReadonly,
  Modifier,
  ScriptCtx,
  ScriptDecisionPrompt,
  ScriptPrompt,
  TriggerDef,
  TriggerEventContext,
  TriggerTarget,
} from "@fyendal/engine";
import type { GameLogEvent, GameLogPayload, GameMessage } from "@fyendal/shared";
import { functionalKey, functionalKeyOf } from "../functional.js";

export interface DecisionPromptOptions {
  values?: GameMessage["values"];
  /** Labels keyed by the exact option value delivered to `onChoose`. Missing
   * entries intentionally fall back to the raw option without affecting the
   * ordering of localized entries. */
  optionMessages?: Readonly<Record<string, GameMessage>>;
  /** Modes already selected earlier in a multi-mode choice, shown beside the
   * remaining options. Labels come from `optionMessages`. */
  chosen?: readonly string[];
}

const commonDecisionOptionIds = {
  yes: "common.option.yes",
  no: "common.option.no",
  pass: "common.option.pass",
  decline: "common.option.decline",
  none: "common.option.none",
  done: "common.option.done",
  keep: "common.option.keep",
  bottom: "common.option.bottom",
  top: "common.option.top",
  close: "common.option.close",
  remove: "common.option.remove",
  destroy: "common.option.destroy",
  both: "common.option.both",
  opponent: "common.option.opponent",
  self: "common.option.self",
  "opposing hero": "common.option.opposinghero",
  "your hero": "common.option.yourhero",
  "take damage": "common.option.takedamage",
} as const;

export type CommonDecisionOption = keyof typeof commonDecisionOptionIds;

/** Construct semantic text metadata without coupling card scripts to any
 * locale catalog. The client resolves the id; the engine preserves fallback
 * text for old clients, persisted state, logs, and diagnostics. */
export function decisionMessage(id: string, values?: GameMessage["values"]): GameMessage {
  return { id, ...(values === undefined ? {} : { values }) };
}

/** A lingering modifier's projected effect text, for rules state the
 * ongoing-effects projection cannot describe (such as a bare marker that keeps
 * a resolved card's script observable). Lowercase, without the duration. */
export function ongoingLabel(
  fallback: string,
  id: string,
  values?: GameMessage["values"],
): Pick<Modifier, "ongoingLabel" | "ongoingLabelMessage"> {
  return { ongoingLabel: fallback, ongoingLabelMessage: decisionMessage(id, values) };
}

export interface DelayedEffectFilter {
  /** Modifier scope to match; "any" matches every scope. Defaults to
   * "until-end-of-turn". */
  scope?: Modifier["scope"] | "any";
  match?: (modifier: DeepReadonly<Modifier>) => boolean;
}

/** Arm a delayed effect of this card ("the next time …" this turn). The
 * unconsumed modifier is the effect's whole pending state: it keeps a resolved
 * or destroyed source's hooks observable and shows its label until the hook
 * that fires the effect consumes it. Each copy arms its own modifier, so two
 * copies never share state. */
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

/** The projected text of a granted on-hit script hook, after "when it hits:". */
export function hitHookLabel(
  fallback: string,
  id: string,
  values?: GameMessage["values"],
): { label: string; labelMessage: GameMessage } {
  return { label: fallback, labelMessage: decisionMessage(id, values) };
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
      decisionPrompt(`${ctx.data.name}: choose up to 1 target attack`, "card.omn.attack.target.upto", {
        values: { card: { kind: "card", cardId: ctx.self.cardId } },
        optionMessages: commonOptionMessages("pass"),
      }),
    optional: true,
  };
}

/** "Target hero" declared by a trigger: each eligible hero's instance id.
 * Two players play, so the choice is the opposing hero or your own. Read the
 * declared hero with `targetHeroSeat`. */
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

/** "Any target" for damage: each hero and each ally, as the card instance ids
 * a trigger declares. `opposing` keeps only those the opponent controls. */
export function anyTargetIds(ctx: ScriptCtx, opts: { opposing?: boolean } = {}): number[] {
  return ctx.state.players
    .filter((player) => !opts.opposing || player.seat !== ctx.seat)
    .flatMap((player) => [
      player.hero.instanceId,
      ...player.board.filter((card) => ctx.cardTypes(card).includes("ally")).map((card) => card.instanceId),
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

/** Construct one audience-safe semantic log payload for any card script.
 * Keeping this beside the decision helpers gives every set the same fallback,
 * message-value, and optional machine-event contract without importing engine
 * internals or a locale catalog. */
export function localizedLog(
  fallback: string,
  id: string,
  values?: GameMessage["values"],
  event?: GameLogEvent,
): GameLogPayload {
  return {
    fallback,
    message: decisionMessage(id, values),
    ...(event === undefined ? {} : { event }),
  };
}

/** Construct a semantic log whose conventional `card` value is the script
 * source. Additional values remain generic, and callers can attach the same
 * audience-safe machine event supported by `localizedLog`. */
export function localizedCardLog(
  ctx: Pick<ScriptCtx, "self">,
  fallback: string,
  id: string,
  values?: GameMessage["values"],
  event?: GameLogEvent,
): GameLogPayload {
  return localizedLog(
    fallback,
    id,
    {
      ...values,
      card: { kind: "card", cardId: ctx.self.cardId },
    },
    event,
  );
}

/** Log that a resolving Heave trigger offered no prompt because its cost
 * could not be paid. The trigger itself already named the card publicly. */
export function logHeaveUnaffordable(ctx: ScriptCtx, amount: number): void {
  ctx.logPublic(
    localizedCardLog(
      ctx,
      `${ctx.data.name}: can't pay ${amount} to heave it`,
      "card.log.common.heave.unaffordable",
      { amount },
    ),
  );
}

const HYPER_DRIVER_STEAM_FROM_BOOST_HOOK = "common-hyper-driver-steam-from-boost";

/** Shared "banished from boosting" effect used by Crankshaft and Big Bertha.
 * A lone Hyper Driver is unambiguous; multiple copies require their controller
 * to choose the one that receives the counter. */
export function hyperDriverCounterFromBoostBanish(): CardScript {
  const hyperDrivers = (ctx: ScriptCtx) =>
    ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "Hyper Driver"));
  const addCounter = (ctx: ScriptCtx, instanceId: number) => {
    const driver = hyperDrivers(ctx).find((card) => card.instanceId === instanceId);
    if (!driver) return;
    const steam = driver.counters?.steam ?? 0;
    ctx.addCounter(driver.instanceId, "steam", 1);
    ctx.logPublic(
      localizedCardLog(
        ctx,
        `${ctx.data.name}: Hyper Driver gains a steam counter (${steam} → ${steam + 1})`,
        "card.log.sda.hyperdriver.counter",
        { from: steam, to: steam + 1 },
      ),
    );
  };

  return {
    onBanishedForBoost(ctx) {
      const drivers = hyperDrivers(ctx);
      if (drivers.length === 1) {
        addCounter(ctx, drivers[0]!.instanceId);
      } else if (drivers.length > 1) {
        ctx.requestCardChoice(
          HYPER_DRIVER_STEAM_FROM_BOOST_HOOK,
          decisionPrompt("Put a steam counter on a Hyper Driver", "card.common.hyperdriver.steam.add"),
          drivers.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === HYPER_DRIVER_STEAM_FROM_BOOST_HOOK) addCounter(ctx, Number(option));
    },
  };
}

/** Localize recurring option values without changing the stable value sent
 * back to card scripts. */
export function commonOptionMessages(
  ...options: readonly CommonDecisionOption[]
): Readonly<Record<string, GameMessage>> {
  return Object.fromEntries(options.map((option) => [option, decisionMessage(commonDecisionOptionIds[option])]));
}

/** Describe a localizable decision prompt and any localized option labels.
 * This presentation object works with every ScriptCtx decision API. */
export function decisionPrompt(
  fallback: string,
  id: string,
  options: DecisionPromptOptions = {},
): ScriptDecisionPrompt {
  return {
    fallback,
    message: decisionMessage(id, options.values),
    ...(options.optionMessages ? { optionMessagesByValue: options.optionMessages } : {}),
    ...(options.chosen?.length ? { chosenOptions: options.chosen } : {}),
  };
}

/** Common optional-effect presentation. Stable yes/no option values remain
 * engine-facing while their labels use the shared catalog messages. */
export function yesNoPrompt(fallback: string, id: string, values?: GameMessage["values"]): ScriptDecisionPrompt {
  return decisionPrompt(fallback, id, {
    values,
    optionMessages: commonOptionMessages("yes", "no"),
  });
}

/** Ask the controller which of the given disease token printings to create.
 * The chosen token id is delivered to `onChoose` under `hook`. */
export function requestDiseaseTokenChoice(ctx: ScriptCtx, hook: string, tokenIds: readonly string[]): void {
  ctx.requestChoice(
    hook,
    decisionPrompt("Choose a disease token", "card.common.disease.token.choose", {
      optionMessages: Object.fromEntries(
        tokenIds.map((cardId) => [cardId, decisionMessage("card.common.target.card", { card: { kind: "card", cardId } })]),
      ),
    }),
    [...tokenIds],
  );
}

/** Shared presentation for effects that inspect a deck top and either keep it
 * there or move it to the bottom. */
export function bottomOrKeepPrompt(fallback = "Put the looked-at card on the bottom?"): ScriptDecisionPrompt {
  return decisionPrompt(fallback, "card.common.lookedcard.bottom", {
    optionMessages: commonOptionMessages("bottom", "keep"),
  });
}

/** Compose one set's implementation partitions without allowing a later
 * partition to silently replace an earlier functional script. */
export function mergeSetScripts(
  set: string,
  ...parts: readonly Readonly<Record<string, CardScript>>[]
): Record<string, CardScript> {
  const merged: Record<string, CardScript> = {};
  for (const part of parts) {
    for (const [key, script] of Object.entries(part)) {
      if (Object.hasOwn(merged, key)) {
        throw new Error(`duplicate functional script key "${key}" within set ${set}`);
      }
      merged[key] = script;
    }
  }
  return merged;
}

// ── seat / state accessors ──────────────────────────────────────────────────

export function opponentSeat(ctx: ScriptCtx): number {
  return ctx.seat === 0 ? 1 : 0;
}

export type HeroChoiceOption = "opposing hero" | "your hero";

/** Ask which hero an effect targets as a plain text choice. Games have two
 * players, so heroes are named relative to the chooser instead of shown as
 * cards. Space picks `defaultOption`: "your hero" for protection, "opposing
 * hero" for damage and other harm. Resolve the answer with `heroChoiceSeat`. */
export function requestHeroChoice(
  ctx: ScriptCtx,
  hook: string,
  fallback: string,
  id: string,
  options: {
    values?: DecisionPromptOptions["values"];
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
  if (option === "your hero") return ctx.seat;
  if (option === "opposing hero") return opponentSeat(ctx);
  return undefined;
}

/** "card-moved-from-deck-by-effect" condition for "when an activated ability
 * or action card effect puts this face-up into a zone from your deck". The
 * engine reports only face-up deck moves. */
export function effectPutSelfFaceUpFromDeck(
  ctx: ScriptCtx,
  card: DeepReadonly<CardInstance> | undefined,
  event: TriggerEventContext | undefined,
): boolean {
  return card?.instanceId === ctx.self.instanceId &&
    (event?.effectSource === "action-card" || event?.effectSource === "activated-ability");
}

/** Damage facts of a "damage-dealt" event when a hero, not an ally, was dealt
 * the damage. Conditions receive them at trigger time; effects receive the
 * persisted copy at resolution. */
export function heroDamage(event: TriggerEventContext | undefined): DamageEventContext | undefined {
  const damage = event?.damage;
  return damage && damage.targetAllyInstanceId === undefined ? damage : undefined;
}

/** Hero damage dealt to a hero other than this trigger controller's. */
export function opposingHeroDamage(
  ctx: ScriptCtx,
  event: TriggerEventContext | undefined,
): DamageEventContext | undefined {
  const damage = heroDamage(event);
  return damage && damage.targetSeat !== ctx.seat ? damage : undefined;
}

/** The damage-dealt event's source is this trigger's own card. */
export function dealtByThis(ctx: ScriptCtx, eventCard: DeepReadonly<CardInstance> | undefined): boolean {
  return eventCard?.instanceId === ctx.self.instanceId;
}

/** "Whenever a card defends this": one trigger for each defending card. */
export const cardDefendsThisTrigger: NonNullable<CardScript["friendlyDefendedTrigger"]> = {
  label: "Whenever a card defends this",
  labelMessage: { id: "card.trigger.common.defend.card" },
  perDefender: true,
};

/** Channel Lightning: at the beginning of the controller's end phase add a
 * flow counter, then put one Lightning card from pitch on the bottom per flow
 * counter or destroy this. `remainingKey` tracks unpaid cards across the
 * resumable `hook` choices. */
export function channelLightning(
  remainingKey: string,
  hook: string,
): { triggers: TriggerDef[]; onChoose: NonNullable<CardScript["onChoose"]> } {
  const payNext = (ctx: ScriptCtx): void => {
    const remaining = ctx.getState(remainingKey);
    if (remaining <= 0) return;
    const lightning = ctx.player(ctx.seat).pitch.filter((card) => ctx.cardTypes(card).includes("lightning"));
    if (lightning.length < remaining) {
      ctx.destroySelf();
      return;
    }
    ctx.requestCardChoice(
      hook,
      decisionPrompt("Put a Lightning card from pitch on the bottom", "card.ele.pitch.card.bottom", {
        values: { type: "Lightning" },
      }),
      lightning.map((card) => card.instanceId),
    );
  };
  return {
    triggers: [
      {
        event: "end-of-turn",
        label: "Channel Lightning",
        labelMessage: { id: "card.trigger.common.channel.lightning" },
        effect(ctx) {
          const flow = ctx.getCounter("flow") + 1;
          ctx.setCounter("flow", flow);
          ctx.setState(remainingKey, flow);
          payNext(ctx);
        },
      },
    ],
    onChoose(ctx, choiceHook, option) {
      if (choiceHook !== hook) return;
      if (ctx.putOnDeckBottom(Number(option))) {
        ctx.setState(remainingKey, ctx.getState(remainingKey) - 1);
        payNext(ctx);
      }
    },
  };
}

/** A Suspense aura's own "when this enters/leaves the arena" ability. */
export type SuspenseTrigger = Pick<TriggerDef, "label" | "condition" | "optional" | "target"> & {
  labelMessage: GameMessage;
  effect: (ctx: ScriptCtx) => void;
};

/** "Your next attack this turn gets +N{p}" as a Suspense leave trigger. */
export function suspenseNextAttackBuff(amount: number): SuspenseTrigger {
  return {
    label: `Your next attack this turn gets +${amount} power`,
    labelMessage: decisionMessage("card.trigger.common.nextattack.turn.attack", { amount }),
    effect: (ctx) => buffNextAttack(ctx, { attack: amount }),
  };
}

/** "The crowd cheers/boos you" as an enter or leave trigger. */
export function crowdTrigger(kind: "cheer" | "boo"): SuspenseTrigger {
  return kind === "cheer"
    ? {
        label: "The crowd cheers you",
        labelMessage: decisionMessage("card.trigger.common.crowd.cheer"),
        effect: (ctx) => ctx.crowdCheer(ctx.seat),
      }
    : {
        label: "The crowd boos you",
        labelMessage: decisionMessage("card.trigger.common.crowd.boo"),
        effect: (ctx) => ctx.crowdBoo(ctx.seat),
      };
}

/** Shared Suspense lifecycle (CR 8.3.42). The suspense counters and the
 * `suspenseAurasLeftThisTurn` bookkeeping stay in the arena hooks; the card's
 * printed enter/leave abilities become stack triggers. `onEnterArena` is only
 * for non-triggered work done as the aura enters (static abilities). */
export function suspenseAura(
  options: {
    enters?: SuspenseTrigger | readonly SuspenseTrigger[];
    leaves?: SuspenseTrigger | readonly SuspenseTrigger[];
    onEnterArena?: (ctx: ScriptCtx) => void;
    logCounterRemoval?: boolean;
  } = {},
): CardScript {
  const list = (value: SuspenseTrigger | readonly SuspenseTrigger[] | undefined): readonly SuspenseTrigger[] =>
    value === undefined ? [] : "label" in value ? [value as SuspenseTrigger] : (value as readonly SuspenseTrigger[]);
  const toTrigger = (
    make: typeof entersArenaTrigger,
    { label, labelMessage, effect, ...extra }: SuspenseTrigger,
  ): TriggerDef => make(label, labelMessage, effect, extra);
  return {
    destroyAtZeroCounter: "suspense",
    onEnterArena(ctx) {
      ctx.setCounter("suspense", 2);
      options.onEnterArena?.(ctx);
    },
    onLeaveArena(ctx) {
      ctx.setFlag(
        "player",
        "suspenseAurasLeftThisTurn",
        Number(ctx.getFlag("player", "suspenseAurasLeftThisTurn")) + 1,
      );
    },
    triggers: [
      ...list(options.enters).map((trigger) => toTrigger(entersArenaTrigger, trigger)),
      ...list(options.leaves).map((trigger) => toTrigger(leavesArenaTrigger, trigger)),
      {
        event: "start-of-turn",
        label: "Remove a suspense counter",
        labelMessage: decisionMessage("card.trigger.common.suspense.remove"),
        effect(ctx) {
          const next = Math.max(0, ctx.getCounter("suspense") - 1);
          ctx.setCounter("suspense", next);
          if (options.logCounterRemoval) {
            ctx.logPublic(
              localizedLog(
                `${ctx.data.name}: a suspense counter is removed (${next} left)`,
                "card.log.common.suspense.counter.removed",
                {
                  card: { kind: "card", cardId: ctx.self.cardId },
                  remaining: next,
                },
              ),
            );
          }
          if (next === 0) ctx.destroySelf();
        },
      },
    ],
  };
}

/** Record a Contract completion for turn-wide checks such as Pay Day. */
export function markContractCompleted(ctx: ScriptCtx): void {
  ctx.setFlag("player", "completedContractThisTurn", true);
  ctx.setFlag("player", "contractCompletionsThisTurn", contractCompletionCount(ctx) + 1);
}

/** Number of Contracts this player has completed during the current turn. */
export function contractCompletionCount(ctx: ScriptCtx): number {
  return Number(ctx.getFlag("player", "contractCompletionsThisTurn"));
}

/** Implement the standard Contract reward while keeping the condition local
 * to the card script. The engine only calls this hook for cards banished by
 * this source's controller while the Contract card is active in the arena. */
export function contractWithSilver(
  condition: (ctx: ScriptCtx, card: DeepReadonly<CardInstance>) => boolean,
): CardScript {
  return {
    onFriendlyBanishesOpponentCard(ctx, card) {
      if (!condition(ctx, card)) return;
      markContractCompleted(ctx);
      ctx.createToken("DYN245");
    },
  };
}

/** Ask the affected hero to choose one of their hand cards to discard. */
export function requestDiscardChoice(ctx: ScriptCtx, hook: string, prompt: ScriptPrompt, targetSeat: number): boolean {
  const hand = ctx.player(targetSeat).hand;
  if (hand.length === 0) return false;
  ctx.requestCardChoice(
    hook,
    prompt,
    hand.map((card) => card.instanceId),
    targetSeat,
  );
  return true;
}

/** Validate and perform a pending affected-player discard choice. */
export function resolveDiscardChoice(
  ctx: ScriptCtx,
  option: string,
  targetSeat: number,
): DeepReadonly<CardInstance> | undefined {
  return ctx.discardCard(targetSeat, Number(option));
}

// ── shared helpers ──────────────────────────────────────────────────────────

/** The attack object on the most recent previous chain link. The active link
 * is unresolved while Combo conditions and their generated hit effects are
 * evaluated, so selecting the latest resolved link remains correct in both
 * windows. */
export function previousAttack(ctx: ScriptCtx): DeepReadonly<CardInstance> | undefined {
  return [...ctx.state.chain].reverse().find((link) => link.resolved)?.attackingCard;
}

/** Match a Combo name against every effective name of the previous attack,
 * including names gained by effects such as Be Like Water. */
export function previousAttackHasName(ctx: ScriptCtx, ...names: readonly string[]): boolean {
  const previous = previousAttack(ctx);
  if (!previous) return false;
  const wanted = new Set(names.map((name) => name.trim().toLowerCase()));
  return ctx.cardNames(previous).some((name) => wanted.has(name));
}

/** Match "with WORDS in its name" Combo conditions using whole words, as
 * required by the name-property rules, across every effective name. */
export function previousAttackNameContains(ctx: ScriptCtx, ...parts: readonly string[]): boolean {
  const previous = previousAttack(ctx);
  return !!previous && cardNameContains(ctx, previous, ...parts);
}

/** Whether a card currently has a name: printed, gained from an effect, or
 * held in all zones. Cards whose names are suppressed have no name. */
export function cardNamed(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string): boolean {
  return ctx.cardNames(card).includes(name.trim().toLowerCase());
}

/** Whether two cards share at least one effective name. */
export function sharesName(
  ctx: ScriptCtx,
  card: DeepReadonly<CardInstance>,
  other: DeepReadonly<CardInstance>,
): boolean {
  const names = ctx.cardNames(other);
  return ctx.cardNames(card).some((name) => names.includes(name));
}

/** Match "with WORDS in its name" using whole words across every effective
 * name, including names gained from effects. */
export function cardNameContains(
  ctx: ScriptCtx,
  card: DeepReadonly<CardInstance>,
  ...parts: readonly string[]
): boolean {
  return ctx.cardNames(card).some((name) => {
    const words = name.split(/\s+/);
    return parts.some((part) => {
      const wanted = part.trim().toLowerCase().split(/\s+/);
      return words.some((_, index) => wanted.every((word, offset) => words[index + offset] === word));
    });
  });
}

/** Shared printed ability of Arakni, Marionette and Arakni, Web of Deceit. */
export function markedStealthHeroScript(agentCardIds: readonly string[]): CardScript {
  const hasStealth = (ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean => {
    if ((card.suppressedKeywords ?? []).some((keyword) => keyword.toLowerCase() === "stealth")) {
      return false;
    }
    return [...(ctx.cardData(card.cardId).keywords ?? []), ...(card.grantedKeywords ?? [])].some(
      (keyword) => keyword.toLowerCase() === "stealth",
    );
  };
  return {
    modifyAttack(ctx) {
      const link = ctx.link;
      if (!link || link.targetAllyId !== undefined || !hasStealth(ctx, link.attackingCard)) return 0;
      return (ctx.player(opponentSeat(ctx)).hero.scriptState?.marked ?? 0) > 0 ? 1 : 0;
    },
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return (
        !!link &&
        link.targetAllyId === undefined &&
        hasStealth(ctx, link.attackingCard) &&
        link.flags.targetWasMarkedOnHit === true
      );
    },
    onHit(ctx) {
      ctx.grantGoAgain();
    },
    triggers: [
      {
        event: "end-of-turn",
        condition: (ctx) => (ctx.player(opponentSeat(ctx)).hero.scriptState?.marked ?? 0) > 0,
        label: "Become a random Agent of Chaos",
        effect(ctx) {
          ctx.becomeHero(agentCardIds[ctx.randomInt(agentCardIds.length)]!);
        },
      },
    ],
  };
}

function weaponHands(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): number {
  return ctx.cardTypes(card).includes("2h") ? 2 : 1;
}

function canEquipDagger(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  if (card.faceDown || !ctx.cardTypes(card).includes("dagger") || ctx.cardData(card.cardId).cardType !== "weapon") {
    return false;
  }
  const occupiedHands = ctx.player(ctx.seat).weapons.reduce((total, weapon) => total + weaponHands(ctx, weapon), 0);
  return occupiedHands + weaponHands(ctx, card) <= 2;
}

export function retrievableDaggerIds(ctx: ScriptCtx): number[] {
  return ctx
    .player(ctx.seat)
    .graveyard.filter((card) => canEquipDagger(ctx, card))
    .map((card) => card.instanceId);
}

/** Retrieve (CR 8.5.51): offer only dagger weapons that can currently be
 * equipped, then let the player pay the equip cost from resources or pitch. */
export function offerRetrieveDagger(ctx: ScriptCtx, hook: string): void {
  const ids = retrievableDaggerIds(ctx);
  if (ids.length === 0) return;
  ctx.requestCardChoice(
    hook,
    decisionPrompt("Retrieve a dagger from your graveyard?", "card.common.retrieve.dagger", {
      optionMessages: commonOptionMessages("pass"),
    }),
    ["pass", ...ids],
  );
}

export function resolveRetrieveDagger(ctx: ScriptCtx, hook: string, option: string, expected: string): boolean {
  if (hook === expected) {
    if (option === "pass") return true;
    const id = Number(option);
    if (!retrievableDaggerIds(ctx).includes(id)) return true;
    ctx.requestPayment(
      `retrieve-pay:${expected}:${id}`,
      decisionPrompt("Retrieve: pay {r} to equip this dagger?", "card.common.retrieve.dagger.pay", {
        values: { amount: 1 },
      }),
      1,
    );
    return true;
  }
  const prefix = `retrieve-pay:${expected}:`;
  if (!hook.startsWith(prefix)) return false;
  if (option === "paid") ctx.equipFromGraveyard(Number(hook.slice(prefix.length)));
  return true;
}

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

/** Printed Blood Debt, unless the owner is Levia, Redeemed (her cards lose it). */
export function hasBloodDebt(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  if (!(ctx.cardData(card.cardId).keywords ?? []).some((keyword) => keyword.trim().toLowerCase() === "blood debt"))
    return false;
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

/** Reprint-safe identity check: true if the card is functionally the named card. */
export function isCard(ctx: ScriptCtx, cardId: string, name: string, pitch?: number): boolean {
  const d = ctx.cardData(cardId);
  return functionalKey(d.name, d.pitch) === functionalKey(name, pitch);
}

export function queueIntimidate(ctx: ScriptCtx): void {
  const n = Number(ctx.getFlag("player", "pendingIntimidate")) || 0;
  ctx.setFlag("player", "pendingIntimidate", n + 1);
  ctx.logPublic(
    localizedLog(`${ctx.data.name}: intimidate`, "card.log.common.intimidate", {
      card: { kind: "card", cardId: ctx.self.cardId },
    }),
  );
}

export function isSixPlus(ctx: ScriptCtx, card: DeepReadonly<CardInstance> | undefined): boolean {
  if (!card) return false;
  return ctx.basePower(card) >= 6;
}

/** "When this attacks, draw a card then discard a random card" — returns the discard. */
function drawThenDiscard(ctx: ScriptCtx): DeepReadonly<CardInstance> | undefined {
  ctx.drawCards(ctx.seat, 1);
  return ctx.discardRandom(ctx.seat, 1)[0];
}

/** "When this attacks, draw a card then discard a random card. If a 6+ card was discarded, …" */
export function discardSixPlusPayoff(payoff: (ctx: ScriptCtx) => void): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (isSixPlus(ctx, drawThenDiscard(ctx))) payoff(ctx);
    },
  };
}

/** "Reveal the top card of your deck. If it has 6+, put it on top. Otherwise, on the bottom." */
export function revealTopSixPlusStays(ctx: ScriptCtx): void {
  const p = ctx.player(ctx.seat);
  const top = p.deck[0];
  if (!top) return;
  const d = ctx.cardData(top.cardId);
  if (ctx.basePower(top) >= 6) {
    ctx.logPublic(
      localizedLog(
        `${ctx.data.name} reveals ${d.name} — it stays on top`,
        "card.log.common.reveal.top.stays",
        {
          card: { kind: "card", cardId: ctx.self.cardId },
          revealed: { kind: "card", cardId: top.cardId },
        },
        {
          kind: "cards-revealed",
          cards: [{ cardId: top.cardId, ownerSeat: ctx.seat }],
          sourceZone: "deck",
        },
      ),
    );
  } else {
    ctx.putOnDeckBottom(top.instanceId);
    ctx.logPublic(
      localizedLog(
        `${ctx.data.name} reveals ${d.name} — put on the bottom of the deck`,
        "card.log.common.reveal.top.bottom",
        {
          card: { kind: "card", cardId: ctx.self.cardId },
          revealed: { kind: "card", cardId: top.cardId },
        },
        {
          kind: "cards-revealed",
          cards: [{ cardId: top.cardId, ownerSeat: ctx.seat }],
          sourceZone: "deck",
        },
      ),
    );
  }
}

/** Mentor payoff: banish self from arsenal, search deck for a card into arsenal, shuffle. */
export function mentorPayoff(ctx: ScriptCtx, searchName: string, searchPitch?: number): void {
  const p = ctx.player(ctx.seat);
  if (p.arsenal.some((c) => c.instanceId === ctx.self.instanceId)) {
    ctx.banish(ctx.self.instanceId);
    ctx.logPublic(
      localizedLog(
        `${ctx.data.name} is banished`,
        "card.log.common.banished",
        { card: { kind: "card", cardId: ctx.self.cardId } },
        {
          kind: "card-moved",
          cardId: ctx.self.cardId,
          ownerSeat: ctx.seat,
          from: "arsenal",
          to: "banish",
        },
      ),
    );
  }
  const key = functionalKey(searchName, searchPitch);
  const found = p.deck.find((c) => functionalKeyOf(ctx.cardData(c.cardId)) === key);
  if (found && ctx.putIntoArsenal(found.instanceId, "deck")) {
    ctx.logPrivate(
      ctx.seat,
      localizedLog(
        `searched ${ctx.cardData(found.cardId).name} into arsenal`,
        "card.log.common.mentor.search.private",
        { result: { kind: "card", cardId: found.cardId } },
        {
          kind: "card-moved",
          cardId: found.cardId,
          ownerSeat: ctx.seat,
          from: "deck",
          to: "arsenal",
        },
      ),
      localizedLog("searched a card into arsenal", "card.log.common.mentor.search.public", undefined, {
        kind: "card-moved",
        ownerSeat: ctx.seat,
        from: "deck",
        to: "arsenal",
      }),
    );
  }
  ctx.shuffleDeck();
}

function isSpecialization(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return (ctx.cardData(card.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase().includes("specialization"));
}

/** Mentor payoff for the generic "search your deck for a specialization"
 * wording. The search remains private, while the card put face up into
 * arsenal is logged publicly only after the controller chooses it. */
export function mentorSpecializationPayoff(ctx: ScriptCtx, hook: string): void {
  if (ctx.player(ctx.seat).arsenal.some((card) => card.instanceId === ctx.self.instanceId)) {
    ctx.banish(ctx.self.instanceId);
    ctx.logPublic(
      localizedLog(
        `${ctx.data.name} is banished`,
        "card.log.common.banished",
        { card: { kind: "card", cardId: ctx.self.cardId } },
        {
          kind: "card-moved",
          cardId: ctx.self.cardId,
          ownerSeat: ctx.seat,
          from: "arsenal",
          to: "banish",
        },
      ),
    );
  }
  const choices = ctx.player(ctx.seat).deck.filter((card) => isSpecialization(ctx, card));
  if (choices.length === 0) {
    ctx.shuffleDeck();
    return;
  }
  ctx.requestCardChoice(
    hook,
    decisionPrompt(
      `${ctx.data.name}: choose a specialization card to put face up into arsenal`,
      "card.common.specialization.arsenal",
      { values: { card: { kind: "card", cardId: ctx.self.cardId } } },
    ),
    choices.map((card) => card.instanceId),
  );
}

/** Complete a generic mentor specialization search started above. */
export function resolveMentorSpecializationChoice(
  ctx: ScriptCtx,
  hook: string,
  receivedHook: string,
  option: string,
): boolean {
  if (receivedHook !== hook) return false;
  const card = ctx
    .player(ctx.seat)
    .deck.find((candidate) => candidate.instanceId === Number(option) && isSpecialization(ctx, candidate));
  if (card && ctx.putIntoArsenal(card.instanceId, "deck")) {
    ctx.logPrivate(
      ctx.seat,
      localizedLog(
        `searched ${ctx.cardData(card.cardId).name} into arsenal`,
        "card.log.common.mentor.search.private",
        { result: { kind: "card", cardId: card.cardId } },
        {
          kind: "card-moved",
          cardId: card.cardId,
          ownerSeat: ctx.seat,
          from: "deck",
          to: "arsenal",
        },
      ),
      localizedLog("searched a card into arsenal", "card.log.common.mentor.search.public", undefined, {
        kind: "card-moved",
        ownerSeat: ctx.seat,
        from: "deck",
        to: "arsenal",
      }),
    );
  }
  ctx.shuffleDeck();
  return true;
}

/** Mentor flip: optional start-of-turn "Turn face up?" trigger while face down in arsenal. */
export function mentorFlipTrigger(): TriggerDef {
  return {
    event: "start-of-turn",
    condition: (ctx) => ctx.self.faceDown === true,
    optional: true,
    label: "Turn face up?",
    onAccept(ctx) {
      ctx.flipFaceUp();
    },
  };
}

/** Additional cost: discard a random card. */
export function discardRandomCost(ctx: ScriptCtx): void {
  ctx.discardRandom(ctx.seat, 1);
}

/** Add a lesson counter to self; counters live on the card and persist across turns. */
export function lessonCounter(ctx: ScriptCtx): number {
  const n = ctx.getCounter("lessons") + 1;
  ctx.setCounter("lessons", n);
  ctx.logPublic(
    localizedLog(`${ctx.data.name} gets a lesson counter (${n})`, "card.log.common.lesson.counter.gained", {
      card: { kind: "card", cardId: ctx.self.cardId },
      count: n,
    }),
  );
  return n;
}

export function isWeaponAttack(ctx: ScriptCtx): boolean {
  return ctx.link?.attackCardType === "weapon";
}

export function isSwordAttack(ctx: ScriptCtx): boolean {
  const link = ctx.link;
  if (!link || link.attackCardType !== "weapon") return false;
  return ctx.cardTypes(link.attackingCard).includes("sword");
}

export function attackedWithWeapon(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "attackedWithWeaponThisTurn") === true;
}

/** Weapon / ally tap-attack ability factory. */
export function attackAbility(
  cost: number,
  opts?: {
    goAgain?: boolean;
    oncePerTurn?: boolean;
    activationsPerTurn?: number;
    tap?: boolean;
    canActivate?: ActivatedAbility["canActivate"];
  },
): ActivatedAbility[] {
  return [
    {
      cost,
      isAttack: true,
      goAgain: opts?.goAgain ?? false,
      oncePerTurn: opts?.oncePerTurn ?? true,
      ...(opts?.activationsPerTurn === undefined ? {} : { activationsPerTurn: opts.activationsPerTurn }),
      tap: opts?.tap,
      label: "Attack",
      ...(opts?.canActivate ? { canActivate: opts.canActivate } : {}),
    },
  ];
}

/** Reprise: the current attack was defended by a card from hand. */
export function reprise(ctx: ScriptCtx): boolean {
  return ctx.link?.flags.defendedFromHand === true;
}

export function weaponAttackCount(ctx: ScriptCtx): number {
  return Number(ctx.getFlag("player", "weaponAttackCount")) || 0;
}

/** Generic "pay {r} for +N{d}" defense boost. `onPlay: true` registers the
 *  choice on play instead of on defend; `destroyOnClose` marks the card to be
 *  destroyed when the combat chain closes (Ironhide style). */
export function payForDefenseBoost(
  cost: number,
  defense: number,
  opts?: {
    destroyOnClose?: boolean;
    onPlay?: boolean;
    message?: string | ((ctx: ScriptCtx) => string);
    logMessage?: string | ((ctx: ScriptCtx) => string);
  },
): CardScript {
  const resourceString = Array(cost).fill("{r}").join("");
  const resolve = (v: string | ((ctx: ScriptCtx) => string) | undefined, ctx: ScriptCtx, fallback: string) =>
    typeof v === "function" ? v(ctx) : (v ?? fallback);
  const request = (ctx: ScriptCtx) => {
    ctx.requestPayment(
      "pay-boost",
      resolve(opts?.message, ctx, `${ctx.data.name}: pay ${resourceString} for +${defense}{d}?`),
      cost,
    );
  };
  const onChoose = (ctx: ScriptCtx, hook: string, option: string) => {
    if (hook !== "pay-boost" || option !== "paid") return;
    ctx.addModifier({ scope: "chain-link", defense });
    if (opts?.destroyOnClose) {
      ctx.setFlag("link", `destroyOnClose:${ctx.self.instanceId}`, true);
    }
    ctx.logPublic(
      localizedLog(
        resolve(opts?.logMessage, ctx, `${ctx.data.name} gains +${defense} defense`),
        "card.log.common.defense.gained",
        {
          card: { kind: "card", cardId: ctx.self.cardId },
          defense,
        },
      ),
    );
  };
  return opts?.onPlay ? { onPlay: request, onChoose } : { defendCost: cost, onDefend: request, onChoose };
}

/** Ironhide-style: "when you defend with this, you may pay {r}: +2{d}, destroy when the chain closes" */
export function ironhideScript(): CardScript {
  return payForDefenseBoost(1, 2, {
    destroyOnClose: true,
    message: (ctx) => `${ctx.data.name}: pay {r} for +2 defense? (it is destroyed when the combat chain closes)`,
  });
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

// ── arcane damage replacement effects ───────────────────────────────────────

/** Add to a legacy "the next card you play this turn with an arcane damage
 * effect deals that much plus N" pool. The engine binds this bonus to the
 * matching card when it is played, unlike Amp which waits for a damage event. */
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

/** Remove this source's unbound share of the next-arcane-card pool, for a
 * static source whose bonus ends when it leaves the arena. */
export function withdrawNextArcaneDamageCard(ctx: ScriptCtx): void {
  const sourceKey = `nextArcaneCardBonusSource:${ctx.self.instanceId}`;
  const own = Number(ctx.getPlayerFlag(ctx.seat, sourceKey));
  if (own <= 0) return;
  const pool = Number(ctx.getPlayerFlag(ctx.seat, "nextArcaneCardBonus"));
  ctx.setPlayerFlag(ctx.seat, "nextArcaneCardBonus", Math.max(0, pool - own));
  ctx.setPlayerFlag(ctx.seat, sourceKey, 0);
}

/** Add to the controller's Amp pool: the next positive arcane-damage event
 *  they control this turn deals that much plus N. */
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

/** Shared Wizard instant permission used by the Blaze and Iyslander pools.
 * Blaze stamps a specific card with `asInstant:<id>`; Stir the Aetherwinds
 * grants the next Wizard non-attack action; Iyslander permits blue copies
 * from arsenal during the opposing turn. Zone membership is checked directly
 * because private arsenal cards are still face-down while legality is built. */
export function wizardActionAsInstant(ctx: ScriptCtx): boolean {
  if (ctx.getFlag("player", `asInstant:${ctx.self.instanceId}`) === true) return true;
  const nonAttackAction = ctx.hasCardType(ctx.self, "action") && !ctx.cardTypes(ctx.self).includes("attack");
  if (!nonAttackAction) return false;
  const player = ctx.state.players[ctx.seat]!;
  if (
    ctx.cardData(player.heroCardId).name === "Iyslander" &&
    ctx.state.activePlayer !== ctx.seat &&
    ctx.cardColor(ctx.self) === 3 &&
    player.arsenal.some((card) => card.instanceId === ctx.self.instanceId)
  )
    return true;
  const wizardNonAttack = ctx.cardTypes(ctx.self).includes("wizard");
  if (!wizardNonAttack) return false;
  if (ctx.getFlag("player", "nextWizardNonAttackAsInstant") === true) return true;
  return false;
}

/** Deal arcane effect damage. Source-side arcane bonuses are applied by the
 * engine so every card script follows the same first-positive-event rule. */
export function dealArcane(ctx: ScriptCtx, targetSeat: number, n: number, targetAllyId?: number): number {
  return ctx.dealDamage(targetSeat, n, { arcane: true, targetAllyId });
}

// ── opt ─────────────────────────────────────────────────────────────────────

/**
 * Opt N: the controller privately looks at the top N cards of their deck, then
 * puts each on the top or the bottom. The scripted choice carries two options
 * per looked card — `top:<id>` / `bottom:<id>` — tagged with the card instance
 * so the client can render each card with a top button above and a bottom
 * button below; the looked cards show in the decision float itself, so no
 * separate look is needed. Cards may be assigned in any click order. Each
 * choice is applied immediately, so the last card assigned to the top becomes
 * the top card and the last card assigned to the bottom becomes the bottom
 * card. A trailing "pass" option (the Space default) finishes the opt early,
 * leaving every remaining card on top in its current order. `chargeHero`
 * (Blaze, Firemind): when the opt finishes, the hero gets that many energy
 * counters. Every script using optN must delegate its onChoose to optOnChoose
 * (the choice re-requests itself until every looked card is assigned).
 */
/** Per-card opt options (top/bottom pairs tagged with their card instance). */
function optOptions(ids: number[]): { options: string[]; cardOptions: (number | null)[] } {
  return {
    options: [...ids.flatMap((id) => [`top:${id}`, `bottom:${id}`]), "pass"],
    cardOptions: [...ids.flatMap((id) => [id, id]), null],
  };
}

function optOptionMessages(ids: number[]): Readonly<Record<string, GameMessage>> {
  return {
    ...Object.fromEntries(
      ids.flatMap((id) => [
        [`top:${id}`, decisionMessage("common.option.top")],
        [`bottom:${id}`, decisionMessage("common.option.bottom")],
      ]),
    ),
    pass: decisionMessage("common.option.pass"),
  };
}

export function optN(ctx: ScriptCtx, n: number, chargeHero = false): void {
  const p = ctx.player(ctx.seat);
  const looked = p.deck.slice(0, n).map((c) => c.instanceId);
  if (looked.length === 0) return;
  const { options, cardOptions } = optOptions(looked);
  const chargesBlaze = chargeHero || ctx.cardData(p.heroCardId).name === "Blaze, Firemind";
  ctx.requestChoice(
    `${chargesBlaze ? "optc" : "opt"}:${looked.length}:${looked.join(",")}`,
    decisionPrompt(`${ctx.data.name}: Opt ${looked.length}`, "card.common.opt", {
      values: { card: { kind: "card", cardId: ctx.self.cardId }, count: looked.length },
      optionMessages: optOptionMessages(looked),
    }),
    options,
    undefined,
    cardOptions,
    "pass",
  );
}

/** Handles the per-card top/bottom choices queued by optN; returns true when
 *  the hook was an opt hook. */
export function optOnChoose(ctx: ScriptCtx, hook: string, option: string, onComplete?: () => void): boolean {
  const m = /^(optc?):(\d+):([\d,]+)$/.exec(hook);
  if (!m) return false;
  const charge = m[1] === "optc";
  const total = Number(m[2]);
  const ids = m[3]!.split(",").map(Number);
  const finish = (): void => {
    ctx.logPublic(
      localizedLog(`${ctx.data.name}: opt ${total}`, "card.log.common.opt.completed", {
        card: { kind: "card", cardId: ctx.self.cardId },
        count: total,
      }),
    );
    if (charge && total > 0) {
      // Blaze, Firemind: "Whenever you opt, put energy counters on Blaze equal
      // to the number of cards looked at this way."
      const hero = ctx.player(ctx.seat).hero;
      const n = (hero.counters?.energy ?? 0) + total;
      ctx.setCardCounter(hero.instanceId, "energy", n);
      ctx.logPublic(
        localizedLog(
          `${ctx.cardData(hero.cardId).name} gets ${total} energy counter(s) (${n})`,
          "card.log.common.energy.counters.gained",
          {
            card: { kind: "card", cardId: hero.cardId },
            amount: total,
            count: n,
          },
        ),
      );
    }
    onComplete?.();
  };
  // pass finishes the opt without moving the remaining cards (they stay on
  // top in their current order)
  if (option === "pass") {
    finish();
    return true;
  }
  // per-card options "top:<id>" / "bottom:<id>"; a bare "top"/"bottom" (harness
  // fragment picks) assigns the first remaining card
  const pm = /^(top|bottom)(?::(\d+))?$/.exec(option);
  const id = pm?.[2] ? Number(pm[2]) : ids[0]!;
  if (!pm || !ids.includes(id)) return true;
  if (pm[1] === "bottom") ctx.putOnDeckBottom(id);
  else ctx.putOnDeckTop(id);
  const rest = ids.filter((x) => x !== id);
  if (rest.length > 0) {
    const { options, cardOptions } = optOptions(rest);
    ctx.requestChoice(
      `${m[1]}:${total}:${rest.join(",")}`,
      decisionPrompt(`${ctx.data.name}: Opt ${total} · ${rest.length} left`, "card.common.opt.remaining", {
        values: {
          card: { kind: "card", cardId: ctx.self.cardId },
          count: total,
          remaining: rest.length,
        },
        optionMessages: optOptionMessages(rest),
      }),
      options,
      undefined,
      cardOptions,
      "pass",
    );
    return true;
  }
  finish();
  return true;
}

const SPIRE_SNIPING_FIRST_HOOK = "spire-sniping-first";
const SPIRE_SNIPING_LAST_HOOK = "spire-sniping-last";

function requestSpireSnipingCard(ctx: ScriptCtx, hook: string, cards: readonly DeepReadonly<CardInstance>[]): void {
  // Looking at the top cards is not a search, so this bypasses the
  // deck-search prohibition that requestCardChoice applies to deck cards.
  ctx.requestChoice(
    hook,
    decisionPrompt(
      "Choose the next card to put back on top of your deck; the last card put back ends on top",
      "card.saz.spire.order.next",
    ),
    cards.map((card) => String(card.instanceId)),
    undefined,
    cards.map((card) => card.instanceId),
  );
}

/** Spire Sniping: the controller puts the top two cards back one at a time;
 * the last card put back ends on top. */
export function spireSnipingScript(): CardScript {
  return {
    onEnterArsenalWhenTurnedFaceUp: true,
    onEnterArsenal(ctx) {
      const top = ctx.player(ctx.seat).deck.slice(0, 2);
      for (const card of top) ctx.lookAt(card.instanceId);
      if (top.length === 2) requestSpireSnipingCard(ctx, SPIRE_SNIPING_FIRST_HOOK, top);
    },
    onChoose(ctx, hook, option) {
      const deck = ctx.player(ctx.seat).deck;
      const instanceId = Number(option);
      if (hook === SPIRE_SNIPING_FIRST_HOOK) {
        if (!deck.slice(0, 2).some((card) => card.instanceId === instanceId)) return;
        ctx.putOnDeckTop(instanceId);
        // The other card now sits directly beneath the one just put back.
        const last = ctx.player(ctx.seat).deck[1];
        if (last) requestSpireSnipingCard(ctx, SPIRE_SNIPING_LAST_HOOK, [last]);
      } else if (hook === SPIRE_SNIPING_LAST_HOOK && deck[1]?.instanceId === instanceId) {
        ctx.putOnDeckTop(instanceId);
      }
    },
  };
}

/** An activated ability whose only effect is gaining `amount` resources. The
 * same amount sets `resourceSource`, so auto-pass and the gain can't drift
 * apart. `afterGain` receives the amount and is for logging only; an ability
 * with any other effect must not use this helper. */
export function resourceAbility(
  amount: number,
  ability: Omit<ActivatedAbility, "onActivate" | "resourceSource">,
  afterGain?: (ctx: ScriptCtx, amount: number) => void,
): ActivatedAbility {
  return {
    ...ability,
    resourceSource: amount,
    onActivate(ctx) {
      ctx.changeResources(ctx.seat, amount);
      afterGain?.(ctx, amount);
    },
  };
}
