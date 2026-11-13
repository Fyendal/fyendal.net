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
import { hasType } from "@fyendal/shared";

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

/** "pass" lets the client pick the charged card in hand instead of in a popup. */
const CHARGE_DECLINE = "pass";

/** Options for an optional charge: decline, then each hand card. */
export function optionalChargeOptions(ctx: ScriptCtx): (string | number)[] {
  return [CHARGE_DECLINE, ...ctx.player(ctx.seat).hand.map((card) => card.instanceId)];
}

export const chargeDeclineMessages = { [CHARGE_DECLINE]: decisionMessage("common.option.decline") };

/** "no" still declines decisions persisted before charges declined with "pass". */
export function isChargeDecline(option: string): boolean {
  return option === CHARGE_DECLINE || option === "no";
}

const CHARGE_COST_HOOK = "charge-cost";
/** Hooks of charge-cost decisions persisted before the cost was shared. */
const LEGACY_CHARGE_COST_HOOKS: ReadonlySet<string> = new Set(["asb-charge", "dtd-charge", "mon-charge"]);

/** "As an additional cost, you may charge your hero's soul." The charged
 * card's pitch is kept as `chargedPitch` (0 when nothing was charged);
 * `extra`'s additional cost and choices follow the charge. */
export function chargeAttack(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    additionalCost(ctx) {
      if (ctx.player(ctx.seat).hand.length > 0)
        ctx.requestCardChoice(
          CHARGE_COST_HOOK,
          decisionPrompt(
            `${ctx.data.name}: choose a card from your hand to charge, or decline`,
            "card.common.charge.choose",
            { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: chargeDeclineMessages },
          ),
          optionalChargeOptions(ctx),
        );
      extra.additionalCost?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== CHARGE_COST_HOOK && !LEGACY_CHARGE_COST_HOOKS.has(hook)) {
        extra.onChoose?.(ctx, hook, option);
        return;
      }
      if (isChargeDecline(option)) return;
      const charged = ctx.charge(Number(option));
      if (charged) ctx.setState("chargedPitch", ctx.cardColor(charged));
    },
  };
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

/** Heave N can be paid and this card can still move from hand to arsenal. */
export function canHeave(ctx: ScriptCtx, amount: number): boolean {
  return ctx.hasArsenalSpace() &&
    ctx.player(ctx.seat).hand.some((card) => card.instanceId === ctx.self.instanceId) &&
    ctx.canPayResources(amount, [ctx.self.instanceId]);
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

/** Warn the deciding player when a prompt's action point can't be gained now. */
export function warnIfNoActionPoint(ctx: ScriptCtx, prompt: ScriptDecisionPrompt): ScriptDecisionPrompt {
  return ctx.canGainActionPoint()
    ? prompt
    : { ...prompt, warningMessage: decisionMessage("card.common.actionpoint.nogain") };
}

export const BLOODROT_POX = "OUT234";
export const FRAILTY = "OUT235";
export const INERTIA = "OUT236";
export const NAMED_DISEASE_TOKENS: readonly string[] = [FRAILTY, INERTIA, BLOODROT_POX];

/** Effective class, talent or subtype (case-insensitive). Card types use `ctx.hasCardType`. */
export function hasCardSubtype(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.trim().toLowerCase());
}

export function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasCardSubtype(ctx, card, "attack");
}

export function isNonAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !hasCardSubtype(ctx, card, "attack");
}

export function isAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasCardSubtype(ctx, card, "aura");
}

/** An aura of suspense: an aura with Suspense. */
export function isSuspenseAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return isAura(ctx, card) && ctx.hasKeyword(card, "suspense");
}

export function isArrow(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasCardSubtype(ctx, card, "arrow");
}

export function isSword(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasCardSubtype(ctx, card, "sword");
}

export function isDagger(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasCardSubtype(ctx, card, "dagger");
}

export function isDisease(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("disease");
}

export function isDiseaseToken(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "token") && isDisease(ctx, card);
}

export function controlledDiseases(ctx: ScriptCtx, seat: number): DeepReadonly<CardInstance>[] {
  return ctx.player(seat).board.filter((card) => isDisease(ctx, card));
}

export function isInfected(ctx: ScriptCtx, seat: number): boolean {
  return controlledDiseases(ctx, seat).length > 0;
}

export function targetsHero(ctx: ScriptCtx): boolean {
  return ctx.link?.targetAllyId === undefined;
}

export function defenderInfected(ctx: ScriptCtx): boolean {
  return targetsHero(ctx) && isInfected(ctx, opponentSeat(ctx));
}

/** Create the disease chosen through `requestDiseaseTokenChoice` under the opponent's control. */
export function createChosenDisease(ctx: ScriptCtx, option: string): void {
  if (NAMED_DISEASE_TOKENS.includes(option)) ctx.createToken(option, opponentSeat(ctx));
}

/** Ask the controller which of the given disease token printings to create.
 * The chosen token id is delivered to `onChoose` under `hook`. */
export function requestDiseaseTokenChoice(
  ctx: ScriptCtx,
  hook: string,
  tokenIds: readonly string[] = NAMED_DISEASE_TOKENS,
  chooser?: number,
): void {
  ctx.requestChoice(
    hook,
    decisionPrompt("Choose a disease token", "card.common.disease.token.choose", {
      optionMessages: diseaseTokenOptionMessages(tokenIds),
    }),
    [...tokenIds],
    chooser,
  );
}

export function diseaseTokenOptionMessages(tokenIds: readonly string[]): Record<string, GameMessage> {
  return Object.fromEntries(
    tokenIds.map((cardId) => [cardId, decisionMessage("card.common.target.card", { card: { kind: "card", cardId } })]),
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

/** "If you are X": whether the seat's current hero has that moniker. A suffix
 * after the comma is not part of the moniker (CR 2.7.3). */
export function heroHasMoniker(ctx: ScriptCtx, seat: number, moniker: string): boolean {
  const personalName = ctx.cardData(ctx.player(seat).heroCardId).name.split(",")[0]!;
  return personalName.toLowerCase().split(/\s+/).includes(moniker.toLowerCase());
}

export function opponentSeat(ctx: ScriptCtx): number {
  return ctx.seat === 0 ? 1 : 0;
}

/** Graveyard cards an effect may refer to; face-down ones are private (CR 3.0.4e). */
export function faceUpGraveyard(ctx: ScriptCtx, seat = ctx.seat): DeepReadonly<CardInstance>[] {
  return ctx.player(seat).graveyard.filter((card) => !card.faceDown);
}

/** Grant `seat` +1 intellect during the end phase of `turn`; repeated grants for that turn stack. */
export function grantEndPhaseIntellect(ctx: ScriptCtx, seat: number, turn: number): void {
  const hero = ctx.player(seat).hero;
  const pending = Number(hero.scriptState?.bonusIntellectAtEndPhaseTurn ?? 0) === turn
    ? Number(hero.scriptState?.bonusIntellectAtEndPhaseCount ?? 1)
    : 0;
  ctx.setCardState(hero.instanceId, "bonusIntellectAtEndPhaseTurn", turn);
  ctx.setCardState(hero.instanceId, "bonusIntellectAtEndPhaseCount", pending + 1);
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

export interface AnyTargetChoiceOptions {
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

/** "card-moved-from-deck-by-effect" condition for "when an activated ability
 * or action card effect puts this face-up into a zone from your deck". The
 * engine reports only face-up deck moves. */
export function effectPutSelfFaceUpFromDeck(
  ctx: ScriptCtx,
  card: DeepReadonly<CardInstance> | undefined,
  event: TriggerEventContext | undefined,
): boolean {
  return card?.instanceId === ctx.self.instanceId && event?.to !== "hand" &&
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

// ── Reload ──────────────────────────────────────────────────────────────────

const RELOAD_HOOK = "reload";
/** Hooks of reload decisions persisted before reload was shared. */
const LEGACY_RELOAD_HOOKS: ReadonlySet<string> = new Set([
  "aaz-reload",
  "arc-reload",
  "cru-high-reload",
  "ele-reload",
  "high-reload",
  "over-flex-reload",
]);

/** Reload (CR 8.5.23): if your arsenal is empty, you may put a card from your
 * hand into it face down. Answer with `resolveReload`. */
export function reload(ctx: ScriptCtx, hook = RELOAD_HOOK): void {
  const player = ctx.player(ctx.seat);
  if (player.arsenal.length > 0 || player.hand.length === 0) return;
  ctx.requestCardChoice(
    hook,
    decisionPrompt("Reload: put a card from your hand into your arsenal?", "card.common.reload", {
      optionMessages: commonOptionMessages("pass"),
    }),
    ["pass", ...player.hand.map((card) => card.instanceId)],
  );
}

/** Answers a `reload` choice; true when `hook` was it. */
export function resolveReload(ctx: ScriptCtx, hook: string, option: string, expected = RELOAD_HOOK): boolean {
  if (hook !== expected && !(expected === RELOAD_HOOK && LEGACY_RELOAD_HOOKS.has(hook))) return false;
  if (option !== "pass") ctx.putIntoArsenal(Number(option), "hand", { faceUp: false });
  return true;
}

// ── Fusion ──────────────────────────────────────────────────────────────────

export type FusionType = "earth" | "ice" | "lightning";

const FUSION_FROSTBITE = "SIY035";
const ELEMENTAL_FUSION_HOOK = "elemental-fusion";
/** Hooks of decisions persisted before fusion was shared. */
const LEGACY_FUSION_HOOKS: Readonly<Record<string, string>> = {
  fusion: "lightning-fusion",
  "high-fuse:earth": "earth-fusion",
  "high-fuse:ice": "ice-fusion",
  "high-fuse:lightning": "lightning-fusion",
  "upr-high-fuse": "ice-fusion",
  "ajv-fusion": ELEMENTAL_FUSION_HOOK,
  "oaken-fuse-ice": "ice-fusion",
};

function fusionLabel(type: FusionType): string {
  return type[0]!.toUpperCase() + type.slice(1);
}

/** Whether this card was fused. */
export function isFused(ctx: ScriptCtx): boolean {
  return ctx.getState("fused") > 0;
}

/** Whether this card was fused with a card of `type`. */
export function isFusedWith(ctx: ScriptCtx, type: FusionType): boolean {
  return ctx.getState(`fused:${type}`) > 0;
}

/** Isenhowl Weathervane: "the next time you Ice fuse this turn". */
export function isenhowlFrostbitesKey(targetSeat: number): string {
  return `nextIceFusionFrostbites:${targetSeat}`;
}

function completeFusion(
  ctx: ScriptCtx,
  revealed: readonly { card: DeepReadonly<CardInstance>; type: FusionType }[],
): void {
  if (revealed.length === 0 || !ctx.revealCards([...new Set(revealed.map(({ card }) => card.instanceId))])) return;
  ctx.setState("fused", 1);
  ctx.setFlag("player", "fusedThisTurn", true);
  for (const { type } of revealed) {
    ctx.setState(`fused:${type}`, 1);
    ctx.setFlag("player", `${type}FusedThisTurn`, true);
  }
  if (!revealed.some(({ type }) => type === "ice")) return;
  for (const player of ctx.state.players) {
    const key = isenhowlFrostbitesKey(player.seat);
    const count = Number(ctx.getPlayerFlag(ctx.seat, key));
    if (count > 0) ctx.createTokens(FUSION_FROSTBITE, count, player.seat);
    ctx.setPlayerFlag(ctx.seat, key, 0);
  }
}

function fusionCandidates(ctx: ScriptCtx, type: FusionType): DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).hand.filter((card) => hasCardSubtype(ctx, card, type));
}

function handCard(ctx: ScriptCtx, option: string | number, type: FusionType): DeepReadonly<CardInstance> | undefined {
  return fusionCandidates(ctx, type).find((card) => card.instanceId === Number(option));
}

function requestFusionReveal(ctx: ScriptCtx, type: FusionType): void {
  const matches = fusionCandidates(ctx, type);
  if (matches.length === 0) return;
  const label = fusionLabel(type);
  ctx.requestCardChoice(
    `${type}-fusion`,
    decisionPrompt(
      `${ctx.data.name}: reveal ${type === "lightning" ? "a" : "an"} ${label} card to fuse?`,
      "card.ele.fusion.reveal.named",
      {
        values: { card: { kind: "card", cardId: ctx.self.cardId }, type: label },
        optionMessages: commonOptionMessages("no"),
      },
    ),
    ["no", ...matches.map((card) => card.instanceId)],
  );
}

function requestElementalFusion(ctx: ScriptCtx, first: FusionType, second: FusionType): void {
  const hand = ctx.player(ctx.seat).hand;
  const firstCards = fusionCandidates(ctx, first);
  const secondCards = fusionCandidates(ctx, second);
  const firstLabel = fusionLabel(first);
  const secondLabel = fusionLabel(second);
  const options = new Set<string>(["no"]);
  for (const card of firstCards) options.add(`${first}:${card.instanceId}`);
  for (const card of secondCards) options.add(`${second}:${card.instanceId}`);
  for (const a of firstCards)
    for (const b of secondCards) options.add(`both:${a.instanceId}:${b.instanceId}`);
  if (options.size === 1) return;
  const optionMessages: Record<string, GameMessage> = { ...commonOptionMessages("no") };
  for (const option of options) {
    const [kind, firstId, secondId] = option.split(":");
    const a = hand.find((card) => card.instanceId === Number(firstId));
    const b = hand.find((card) => card.instanceId === Number(secondId));
    if (!a) continue;
    optionMessages[option] =
      kind !== "both"
        ? decisionMessage("card.ele.fusion.option.single", {
            card: { kind: "card", cardId: a.cardId },
            type: kind === first ? firstLabel : secondLabel,
          })
        : a.instanceId === b?.instanceId
          ? decisionMessage("card.ele.fusion.option.both.single", {
              card: { kind: "card", cardId: a.cardId },
              firstType: firstLabel,
              secondType: secondLabel,
            })
          : decisionMessage("card.ele.fusion.option.both", {
              first: { kind: "card", cardId: a.cardId },
              second: { kind: "card", cardId: b!.cardId },
              firstType: firstLabel,
              secondType: secondLabel,
            });
  }
  ctx.requestChoice(
    ELEMENTAL_FUSION_HOOK,
    decisionPrompt(`Reveal ${first} and/or ${second} cards to fuse?`, "card.ele.fusion.multiple", {
      values: { firstType: firstLabel, secondType: secondLabel },
      optionMessages,
    }),
    [...options],
  );
}

type FusionChoice = Required<Pick<CardScript, "additionalCost">> & {
  /** True when `hook` was this fusion's choice. */
  onChoose(ctx: ScriptCtx, hook: string, option: string): boolean;
};

function fusionChoice(types: FusionType | readonly [FusionType, FusionType], mode: "and" | "and/or"): FusionChoice {
  if (typeof types === "string") {
    const type = types;
    return {
      additionalCost: (ctx) => requestFusionReveal(ctx, type),
      onChoose(ctx, rawHook, option) {
        if ((LEGACY_FUSION_HOOKS[rawHook] ?? rawHook) !== `${type}-fusion`) return false;
        const card = option === "no" ? undefined : handCard(ctx, option, type);
        if (card) completeFusion(ctx, [{ card, type }]);
        return true;
      },
    };
  }
  const [first, second] = types;
  if (mode === "and")
    return {
      additionalCost(ctx) {
        if (fusionCandidates(ctx, second).length > 0) requestFusionReveal(ctx, first);
      },
      onChoose(ctx, rawHook, option) {
        const hook = LEGACY_FUSION_HOOKS[rawHook] ?? rawHook;
        if (hook === `${first}-fusion`) {
          const card = option === "no" ? undefined : handCard(ctx, option, first);
          ctx.setState("fusionFirstReveal", card?.instanceId ?? 0);
          if (card) requestFusionReveal(ctx, second);
          return true;
        }
        if (hook !== `${second}-fusion`) return false;
        const firstCard = handCard(ctx, ctx.getState("fusionFirstReveal"), first);
        const secondCard = option === "no" ? undefined : handCard(ctx, option, second);
        ctx.setState("fusionFirstReveal", 0);
        if (firstCard && secondCard)
          completeFusion(ctx, [
            { card: firstCard, type: first },
            { card: secondCard, type: second },
          ]);
        return true;
      },
    };
  return {
    additionalCost: (ctx) => requestElementalFusion(ctx, first, second),
    onChoose(ctx, rawHook, option) {
      if ((LEGACY_FUSION_HOOKS[rawHook] ?? rawHook) !== ELEMENTAL_FUSION_HOOK) return false;
      if (option === "no") return true;
      const [kind, firstId, secondId] = option.split(":");
      const revealed =
        kind === "both"
          ? [
              { card: handCard(ctx, firstId!, first), type: first },
              { card: handCard(ctx, secondId!, second), type: second },
            ]
          : kind === first || kind === second
            ? [{ card: handCard(ctx, firstId!, kind), type: kind }]
            : [];
      completeFusion(
        ctx,
        revealed.filter((entry): entry is { card: DeepReadonly<CardInstance>; type: FusionType } => !!entry.card),
      );
      return true;
    },
  };
}

/** Fusion: an optional additional cost to reveal a card of each element from
 * hand. `"ice"` is single-element fusion; a pair is "X and/or Y Fusion", or
 * "X and Y Fusion" with `mode: "and"`, where both must be revealed (one card
 * may count for both). Read the result with `isFused`/`isFusedWith`; revealing
 * Ice consumes Isenhowl Weathervane's Frostbites. `script`'s additional cost
 * and choices follow the fusion. */
export function withFusion(
  types: FusionType | readonly [FusionType, FusionType],
  script: CardScript = {},
  mode: "and" | "and/or" = "and/or",
): CardScript {
  const fuse = fusionChoice(types, mode);
  return {
    ...script,
    additionalCost(ctx) {
      fuse.additionalCost(ctx);
      script.additionalCost?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (!fuse.onChoose(ctx, hook, option)) script.onChoose?.(ctx, hook, option);
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

export function hitWithDaggerThisChain(ctx: ScriptCtx): boolean {
  return ctx.state.chain.some(
    (link) =>
      link.attacker === ctx.seat &&
      ((link.damage > 0 && ctx.cardTypes(link.attackingCard).includes("dagger")) ||
        Number(link.flags["effectDamageBySubtype:dagger"]) > 0),
  );
}

export function hitsHeroAfterDaggerHit(ctx: ScriptCtx): boolean {
  return targetsHero(ctx) && hitWithDaggerThisChain(ctx);
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
      ctx.completeContract();
      ctx.createToken("DYN245");
    },
  };
}

/** Token-creation counterpart of contractWithSilver, completed per token
 * this source's controller creates under an opposing hero's control. */
export function tokenContractWithSilver(
  condition: (ctx: ScriptCtx, token: DeepReadonly<CardInstance>) => boolean,
): CardScript {
  return {
    onFriendlyCreatesOpponentToken(ctx, token) {
      if (!condition(ctx, token)) return;
      ctx.completeContract();
      ctx.createToken("DYN245");
    },
  };
}

/** "While this is in your graveyard, at the start of your turn, you may
 * destroy N Silver you control. If you do, equip this." */
export function equipWithSilver(amount: number): TriggerDef {
  const silverControlled = (ctx: ScriptCtx) =>
    ctx.player(ctx.seat).board.filter((card) => ctx.cardData(card.cardId).name === "Silver");
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

function canEquipFromGraveyard(ctx: ScriptCtx): boolean {
  const subtypes = ctx.cardTypes(ctx.self);
  const player = ctx.player(ctx.seat);
  const slot = (["head", "chest", "arms", "legs"] as const).find((candidate) => subtypes.includes(candidate));
  if (slot) return ctx.equipmentZoneEmpty(ctx.seat, slot);
  const hands = subtypes.includes("2h") ? 2 : 1;
  const occupied = player.weapons.reduce((total, card) => total + (ctx.cardTypes(card).includes("2h") ? 2 : 1), 0);
  return occupied + hands <= 2;
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

/** Live Assassin attack action cards with contract on the chain. */
export function assassinContractAttackTargets(ctx: ScriptCtx): number[] {
  return ctx.state.chain
    .filter((link) =>
      link.flags.attackGone !== true &&
      link.attackCardType === "action" &&
      ctx.cardTypes(link.attackingCard).includes("assassin") &&
      ctx.hasKeyword(link.attackingCard, "contract")
    )
    .map((link) => link.attackingCard.instanceId);
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
  return {
    modifyAttack(ctx) {
      const link = ctx.link;
      if (!link || link.targetAllyId !== undefined || !ctx.hasKeyword(link.attackingCard, "stealth")) return 0;
      return (ctx.player(opponentSeat(ctx)).hero.scriptState?.marked ?? 0) > 0 ? 1 : 0;
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
  if (card.faceDown || !ctx.cardTypes(card).includes("dagger") || !hasType(ctx.cardData(card.cardId), "weapon")) {
    return false;
  }
  const occupiedHands = ctx.player(ctx.seat).weapons.reduce((total, weapon) => total + weaponHands(ctx, weapon), 0);
  return occupiedHands + weaponHands(ctx, card) <= 2;
}

export function retrievableDaggerIds(ctx: ScriptCtx): number[] {
  return faceUpGraveyard(ctx)
    .filter((card) => canEquipDagger(ctx, card))
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

/** Beat Chest: optional additional cost of discarding a card with 6 or more base {p}. */
export function beatChest(
  extra: CardScript = {},
  opts: { hook?: string; messageId?: string } = {},
): CardScript {
  const hook = opts.hook ?? "beat-chest";
  return {
    ...extra,
    additionalCost(ctx) {
      const sixes = ctx.player(ctx.seat).hand.filter((card) => isSixPlus(ctx, card));
      if (sixes.length) {
        ctx.requestCardChoice(
          hook,
          decisionPrompt(
            `${ctx.data.name}: discard a card with 6 or more power to beat chest?`,
            opts.messageId ?? "card.hvy.beatchest.discard",
            {
              values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: 6 },
              optionMessages: commonOptionMessages("no"),
            },
          ),
          ["no", ...sixes.map((card) => card.instanceId)],
        );
      }
      extra.additionalCost?.(ctx);
    },
    onChoose(ctx, chosenHook, option) {
      if (chosenHook !== hook) {
        extra.onChoose?.(ctx, chosenHook, option);
        return;
      }
      const attackAction = ctx.hasCardType(ctx.self, "action") && ctx.cardTypes(ctx.self).includes("attack");
      ctx.setFlag("player", "discardingToBeatChest", true);
      if (attackAction) ctx.setFlag("player", "discardingForBruteAttackCost", true);
      const discarded = option !== "no" && ctx.discardCard(ctx.seat, Number(option));
      ctx.setFlag("player", "discardingToBeatChest", false);
      if (attackAction) ctx.setFlag("player", "discardingForBruteAttackCost", false);
      if (discarded) {
        ctx.setFlag("player", "beatenChestThisTurn", true);
        ctx.setCardState(ctx.self.instanceId, "beatChestPaid", 1);
      }
    },
  };
}

export function beatenChest(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "beatenChestThisTurn") === true;
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
  return isSword(ctx, link.attackingCard);
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
      ctx.gainResources(ctx.seat, amount);
      afterGain?.(ctx, amount);
    },
  };
}

/** Flip the controller's double-faced hero; returns the face it flipped into. */
export function flipHero(ctx: ScriptCtx): "front" | "back" | undefined {
  const hero = ctx.player(ctx.seat).hero;
  const backId = ctx.cardData(hero.cardId).backId;
  if (backId) {
    ctx.becomeHero(backId);
    return "back";
  }
  const frontId = hero.originalHeroCardId;
  if (frontId && ctx.cardData(frontId).backId === hero.cardId) {
    ctx.becomeHero(frontId);
    return "front";
  }
  return undefined;
}

/** Whether this source's until-end-of-turn effect is still live, even after the source left the arena. */
export function hasLiveTurnEffect(ctx: ScriptCtx): boolean {
  return ctx.state.modifiers.some(
    (modifier) =>
      modifier.sourceInstanceId === ctx.self.instanceId &&
      modifier.scope === "until-end-of-turn" &&
      !modifier.consumed,
  );
}
