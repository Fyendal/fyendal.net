import type {
  ActivatedAbility,
  CardInstance,
  CardScript,
  DeepReadonly,
  Modifier,
  ScriptCtx,
  ScriptDecisionPrompt,
  ScriptPrompt,
  TriggerDef,
} from "@fyendal/engine";
import type {
  GameLogEvent,
  GameLogPayload,
  GameMessage,
} from "@fyendal/shared";
import { functionalKey, functionalKeyOf } from "../functional.js";

export interface DecisionPromptOptions {
  values?: GameMessage["values"];
  /** Labels keyed by the exact option value delivered to `onChoose`. Missing
   * entries intentionally fall back to the raw option without affecting the
   * ordering of localized entries. */
  optionMessages?: Readonly<Record<string, GameMessage>>;
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
export function decisionMessage(
  id: string,
  values?: GameMessage["values"],
): GameMessage {
  return { id, ...(values === undefined ? {} : { values }) };
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

/** Localize recurring option values without changing the stable value sent
 * back to card scripts. */
export function commonOptionMessages(
  ...options: readonly CommonDecisionOption[]
): Readonly<Record<string, GameMessage>> {
  return Object.fromEntries(options.map((option) => [
    option,
    decisionMessage(commonDecisionOptionIds[option]),
  ]));
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
    ...(options.optionMessages
      ? { optionMessagesByValue: options.optionMessages }
      : {}),
  };
}

/** Common optional-effect presentation. Stable yes/no option values remain
 * engine-facing while their labels use the shared catalog messages. */
export function yesNoPrompt(
  fallback: string,
  id: string,
  values?: GameMessage["values"],
): ScriptDecisionPrompt {
  return decisionPrompt(fallback, id, {
    values,
    optionMessages: commonOptionMessages("yes", "no"),
  });
}

/** Shared presentation for effects that inspect a deck top and either keep it
 * there or move it to the bottom. */
export function bottomOrKeepPrompt(
  fallback = "Put the looked-at card on the bottom?",
): ScriptDecisionPrompt {
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

/** Shared Suspense lifecycle (CR 8.3.42). Card-specific enter/leave effects
 * remain callbacks so the engine only sees the generic counter behavior. */
export function suspenseAura(options: {
  onEnter?: ((ctx: ScriptCtx) => void) | undefined;
  onLeave?: ((ctx: ScriptCtx) => void) | undefined;
  logCounterRemoval?: boolean;
} = {}): CardScript {
  return {
    destroyAtZeroCounter: "suspense",
    onEnterArena(ctx) {
      ctx.setCounter("suspense", 2);
      options.onEnter?.(ctx);
    },
    onLeaveArena(ctx) {
      ctx.setFlag(
        "player",
        "suspenseAurasLeftThisTurn",
        Number(ctx.getFlag("player", "suspenseAurasLeftThisTurn")) + 1,
      );
      options.onLeave?.(ctx);
    },
    triggers: [{
      event: "start-of-turn",
      label: "Remove a suspense counter",
      effect(ctx) {
        const next = Math.max(0, ctx.getCounter("suspense") - 1);
        ctx.setCounter("suspense", next);
        if (options.logCounterRemoval) {
          ctx.logPublic(localizedLog(
            `${ctx.data.name}: a suspense counter is removed (${next} left)`,
            "card.log.common.suspense.counter.removed",
            {
              card: { kind: "card", cardId: ctx.self.cardId },
              remaining: next,
            },
          ));
        }
        if (next === 0) ctx.destroySelf();
      },
    }],
  };
}

/** Record a Contract completion for turn-wide checks such as Pay Day. */
export function markContractCompleted(ctx: ScriptCtx): void {
  ctx.setFlag("player", "completedContractThisTurn", true);
  ctx.setFlag(
    "player",
    "contractCompletionsThisTurn",
    contractCompletionCount(ctx) + 1,
  );
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
export function requestDiscardChoice(
  ctx: ScriptCtx,
  hook: string,
  prompt: ScriptPrompt,
  targetSeat: number,
): boolean {
  const hand = ctx.player(targetSeat).hand;
  if (hand.length === 0) return false;
  ctx.requestCardChoice(hook, prompt, hand.map((card) => card.instanceId), targetSeat);
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
export function previousAttackNameContains(
  ctx: ScriptCtx,
  ...parts: readonly string[]
): boolean {
  const previous = previousAttack(ctx);
  if (!previous) return false;
  return ctx.cardNames(previous).some((name) => {
    const words = name.split(/\s+/);
    return parts.some((part) => {
      const wanted = part.trim().toLowerCase().split(/\s+/);
      return words.some((_, index) =>
        wanted.every((word, offset) => words[index + offset] === word)
      );
    });
  });
}

/** Shared printed ability of Arakni, Marionette and Arakni, Web of Deceit. */
export function markedStealthHeroScript(agentCardIds: readonly string[]): CardScript {
  const hasStealth = (ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean => {
    if ((card.suppressedKeywords ?? []).some((keyword) => keyword.toLowerCase() === "stealth")) {
      return false;
    }
    return [
      ...(ctx.cardData(card.cardId).keywords ?? []),
      ...(card.grantedKeywords ?? []),
    ].some((keyword) => keyword.toLowerCase() === "stealth");
  };
  return {
    modifyAttack(ctx) {
      const link = ctx.link;
      if (!link || link.targetAllyId !== undefined || !hasStealth(ctx, link.attackingCard)) return 0;
      return (ctx.player(opponentSeat(ctx)).hero.counters?.marked ?? 0) > 0 ? 1 : 0;
    },
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return !!link &&
        link.targetAllyId === undefined &&
        hasStealth(ctx, link.attackingCard) &&
        link.flags.targetWasMarkedOnHit === true;
    },
    onHit(ctx) {
      ctx.grantGoAgain();
    },
    triggers: [{
      event: "end-of-turn",
      condition: (ctx) => (ctx.player(opponentSeat(ctx)).hero.counters?.marked ?? 0) > 0,
      label: "Become a random Agent of Chaos",
      effect(ctx) {
        ctx.becomeHero(agentCardIds[ctx.randomInt(agentCardIds.length)]!);
      },
    }],
  };
}

function weaponHands(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): number {
  return ctx.cardTypes(card).includes("2h") ? 2 : 1;
}

function canEquipDagger(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  if (
    card.faceDown
    || !ctx.cardTypes(card).includes("dagger")
    || ctx.cardData(card.cardId).cardType !== "weapon"
  ) {
    return false;
  }
  const occupiedHands = ctx.player(ctx.seat).weapons.reduce(
    (total, weapon) => total + weaponHands(ctx, weapon),
    0,
  );
  return occupiedHands + weaponHands(ctx, card) <= 2;
}

export function retrievableDaggerIds(ctx: ScriptCtx): number[] {
  return ctx.player(ctx.seat).graveyard
    .filter((card) => canEquipDagger(ctx, card))
    .map((card) => card.instanceId);
}

/** Retrieve (CR 8.5.51): offer only dagger weapons that can currently be
 * equipped, then let the player pay the equip cost from resources or pitch. */
export function offerRetrieveDagger(ctx: ScriptCtx, hook: string): void {
  const ids = retrievableDaggerIds(ctx);
  if (ids.length === 0) return;
  ctx.requestCardChoice(hook, decisionPrompt(
    "Retrieve a dagger from your graveyard?",
    "card.common.retrieve.dagger",
    { optionMessages: commonOptionMessages("pass") },
  ), ["pass", ...ids]);
}

export function resolveRetrieveDagger(
  ctx: ScriptCtx,
  hook: string,
  option: string,
  expected: string,
): boolean {
  if (hook === expected) {
    if (option === "pass") return true;
    const id = Number(option);
    if (!retrievableDaggerIds(ctx).includes(id)) return true;
    ctx.requestPayment(`retrieve-pay:${expected}:${id}`, decisionPrompt(
      "Retrieve: pay {r} to equip this dagger?",
      "card.common.retrieve.dagger.pay",
      { values: { amount: 1 } },
    ), 1);
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
  transformHookPrefix: "blood-debt-transform:",
  youngLeviaName: "levia",
  adultLeviaName: "levia, shadowborn abomination",
  blasmophetName: "blasmophet, levia consumed",
  redeemedName: "levia, redeemed",
} as const;

function activeHeroName(ctx: ScriptCtx): string {
  return ctx.cardData(ctx.player(ctx.seat).hero.cardId).name.toLowerCase();
}

function isOriginalLevia(heroName: string): boolean {
  return (
    heroName === BLOOD_DEBT.youngLeviaName ||
    heroName === BLOOD_DEBT.adultLeviaName
  );
}

function leviaRemovesBloodDebt(ctx: ScriptCtx, heroName: string): boolean {
  return isOriginalLevia(heroName) &&
    ctx.getFlag("player", "banishedSixPlusThisTurn") === true;
}

function blasmophetInInventory(
  ctx: ScriptCtx,
): DeepReadonly<CardInstance> | undefined {
  return ctx.player(ctx.seat).inventory?.find((card) =>
    ctx.cardData(card.cardId).name.toLowerCase() === BLOOD_DEBT.blasmophetName
  );
}

/** Printed Blood Debt (CR 8.3.11), including Levia suppression and demi-hero
 * transformation/replacement interactions. */
export function bloodDebtScript(extra: CardScript = {}, playableFromBanish = false): CardScript {
  return {
    ...extra,
    ...(playableFromBanish ? { staticPlayableFrom: ["banish" as const] } : {}),
    onPlay(ctx) {
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
          ctx.becomeHeroFromInventory(
            Number(hook.slice(BLOOD_DEBT.transformHookPrefix.length)),
          );
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
        condition(ctx) {
          const heroName = activeHeroName(ctx);
          if (heroName === BLOOD_DEBT.redeemedName) return false;
          return !leviaRemovesBloodDebt(ctx, heroName);
        },
        effect(ctx) {
          const player = ctx.player(ctx.seat);
          const heroName = activeHeroName(ctx);
          if (heroName === BLOOD_DEBT.blasmophetName) {
            const top = player.deck[0];
            if (top) ctx.banish(top.instanceId);
            return;
          }
          const previousLife = player.life;
          ctx.loseLife(ctx.seat, 1);
          if (previousLife <= 13 || ctx.player(ctx.seat).life !== 13) return;
          const transform = blasmophetInInventory(ctx);
          if (!transform || !isOriginalLevia(heroName)) return;
          ctx.requestChoice(
            `${BLOOD_DEBT.transformHookPrefix}${transform.instanceId}`,
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
  ctx.logPublic(localizedLog(
    `${ctx.data.name}: intimidate`,
    "card.log.common.intimidate",
    { card: { kind: "card", cardId: ctx.self.cardId } },
  ));
}

export function isSixPlus(
  ctx: ScriptCtx,
  card: DeepReadonly<CardInstance> | undefined,
): boolean {
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
  if ((d.attack ?? 0) >= 6) {
    ctx.logPublic(localizedLog(
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
    ));
  } else {
    ctx.putOnDeckBottom(top.instanceId);
    ctx.logPublic(localizedLog(
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
    ));
  }
}

/** Mentor payoff: banish self from arsenal, search deck for a card into arsenal, shuffle. */
export function mentorPayoff(ctx: ScriptCtx, searchName: string, searchPitch?: number): void {
  const p = ctx.player(ctx.seat);
  if (p.arsenal.some((c) => c.instanceId === ctx.self.instanceId)) {
    ctx.banish(ctx.self.instanceId);
    ctx.logPublic(localizedLog(
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
    ));
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
      localizedLog(
        "searched a card into arsenal",
        "card.log.common.mentor.search.public",
        undefined,
        {
          kind: "card-moved",
          ownerSeat: ctx.seat,
          from: "deck",
          to: "arsenal",
        },
      ),
    );
  }
  ctx.shuffleDeck();
}

function isSpecialization(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return (ctx.cardData(card.cardId).keywords ?? []).some((keyword) =>
    keyword.toLowerCase().includes("specialization")
  );
}

/** Mentor payoff for the generic "search your deck for a specialization"
 * wording. The search remains private, while the card put face up into
 * arsenal is logged publicly only after the controller chooses it. */
export function mentorSpecializationPayoff(ctx: ScriptCtx, hook: string): void {
  if (ctx.player(ctx.seat).arsenal.some((card) => card.instanceId === ctx.self.instanceId)) {
    ctx.banish(ctx.self.instanceId);
    ctx.logPublic(localizedLog(
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
    ));
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
  const card = ctx.player(ctx.seat).deck.find(
    (candidate) => candidate.instanceId === Number(option) && isSpecialization(ctx, candidate),
  );
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
      localizedLog(
        "searched a card into arsenal",
        "card.log.common.mentor.search.public",
        undefined,
        {
          kind: "card-moved",
          ownerSeat: ctx.seat,
          from: "deck",
          to: "arsenal",
        },
      ),
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
  ctx.logPublic(localizedLog(
    `${ctx.data.name} gets a lesson counter (${n})`,
    "card.log.common.lesson.counter.gained",
    {
      card: { kind: "card", cardId: ctx.self.cardId },
      count: n,
    },
  ));
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
      ...(opts?.activationsPerTurn === undefined
        ? {}
        : { activationsPerTurn: opts.activationsPerTurn }),
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
    typeof v === "function" ? v(ctx) : v ?? fallback;
  const request = (ctx: ScriptCtx) => {
    ctx.requestPayment(
      "pay-boost",
      resolve(
        opts?.message,
        ctx,
        `${ctx.data.name}: pay ${resourceString} for +${defense}{d}?`,
      ),
      cost,
    );
  };
  const onChoose = (ctx: ScriptCtx, hook: string, option: string) => {
    if (hook !== "pay-boost" || option !== "paid") return;
    ctx.addModifier({ scope: "chain-link", defense });
    if (opts?.destroyOnClose) {
      ctx.setFlag("link", `destroyOnClose:${ctx.self.instanceId}`, true);
    }
    ctx.logPublic(localizedLog(
      resolve(opts?.logMessage, ctx, `${ctx.data.name} gains +${defense} defense`),
      "card.log.common.defense.gained",
      {
        card: { kind: "card", cardId: ctx.self.cardId },
        defense,
      },
    ));
  };
  return opts?.onPlay
    ? { onPlay: request, onChoose }
    : { defendCost: cost, onDefend: request, onChoose };
}

/** Ironhide-style: "when you defend with this, you may pay {r}: +2{d}, destroy when the chain closes" */
export function ironhideScript(): CardScript {
  return payForDefenseBoost(1, 2, {
    destroyOnClose: true,
    message: (ctx) =>
      `${ctx.data.name}: pay {r} for +2 defense? (it is destroyed when the combat chain closes)`,
  });
}

type NextAttackMod = Omit<Modifier, "id" | "sourceInstanceId" | "sourceCardId" | "scope" | "defense" | "seat">;
type NextAttackModWithSeat = NextAttackMod & { seat?: number };

/** Apply a modifier scoped to the controller's next attack this turn. */
export function buffNextAttack(ctx: ScriptCtx, mod: NextAttackModWithSeat): void {
  ctx.addModifier({ scope: "next-attack", seat: ctx.seat, ...mod });
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
  ctx.logPublic(localizedLog(
    `${ctx.data.name}: your next arcane damage card this turn gets +${n}`,
    "card.log.common.arcane.card.bonus",
    {
      card: { kind: "card", cardId: ctx.self.cardId },
      amount: n,
    },
  ));
}

/** Add to the controller's Amp pool: the next positive arcane-damage event
 *  they control this turn deals that much plus N. */
export function ampNextArcane(ctx: ScriptCtx, n: number): void {
  const bonus = Number(ctx.getPlayerFlag(ctx.seat, "nextArcaneBonus")) + n;
  ctx.setPlayerFlag(ctx.seat, "nextArcaneBonus", bonus);
  const sourceKey = `nextArcaneBonusSource:${ctx.self.instanceId}`;
  const sourceBonus = Number(ctx.getPlayerFlag(ctx.seat, sourceKey)) + n;
  ctx.setPlayerFlag(ctx.seat, sourceKey, sourceBonus);
  ctx.logPublic(localizedLog(
    `${ctx.data.name}: your next arcane damage event this turn gets +${n}`,
    "card.log.common.arcane.event.bonus",
    {
      card: { kind: "card", cardId: ctx.self.cardId },
      amount: n,
    },
  ));
}

/** Shared Wizard instant permission used by the Blaze and Iyslander pools.
 * Blaze stamps a specific card with `asInstant:<id>`; Stir the Aetherwinds
 * grants the next Wizard non-attack action; Iyslander permits blue copies
 * from arsenal during the opposing turn. Zone membership is checked directly
 * because private arsenal cards are still face-down while legality is built. */
export function wizardActionAsInstant(ctx: ScriptCtx): boolean {
  if (ctx.getFlag("player", `asInstant:${ctx.self.instanceId}`) === true) return true;
  const nonAttackAction =
    ctx.hasCardType(ctx.self, "action") &&
    !ctx.cardTypes(ctx.self).includes("attack");
  if (!nonAttackAction) return false;
  const player = ctx.state.players[ctx.seat]!;
  if (
    ctx.cardData(player.heroCardId).name === "Iyslander" &&
    ctx.state.activePlayer !== ctx.seat &&
    ctx.cardColor(ctx.self) === 3 &&
    player.arsenal.some((card) => card.instanceId === ctx.self.instanceId)
  ) return true;
  const wizardNonAttack = ctx.cardTypes(ctx.self).includes("wizard");
  if (!wizardNonAttack) return false;
  if (ctx.getFlag("player", "nextWizardNonAttackAsInstant") === true) return true;
  return false;
}

/** Deal arcane effect damage. Source-side arcane bonuses are applied by the
 * engine so every card script follows the same first-positive-event rule. */
export function dealArcane(
  ctx: ScriptCtx,
  targetSeat: number,
  n: number,
  targetAllyId?: number,
): number {
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
    ...Object.fromEntries(ids.flatMap((id) => [
      [`top:${id}`, decisionMessage("common.option.top")],
      [`bottom:${id}`, decisionMessage("common.option.bottom")],
    ])),
    pass: decisionMessage("common.option.pass"),
  };
}

export function optN(ctx: ScriptCtx, n: number, chargeHero = false): void {
  const p = ctx.player(ctx.seat);
  const looked = p.deck.slice(0, n).map((c) => c.instanceId);
  if (looked.length === 0) return;
  const { options, cardOptions } = optOptions(looked);
  const chargesBlaze =
    chargeHero || ctx.cardData(p.heroCardId).name === "Blaze, Firemind";
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
export function optOnChoose(
  ctx: ScriptCtx,
  hook: string,
  option: string,
  onComplete?: () => void,
): boolean {
  const m = /^(optc?):(\d+):([\d,]+)$/.exec(hook);
  if (!m) return false;
  const charge = m[1] === "optc";
  const total = Number(m[2]);
  const ids = m[3]!.split(",").map(Number);
  const finish = (): void => {
    ctx.logPublic(localizedLog(
      `${ctx.data.name}: opt ${total}`,
      "card.log.common.opt.completed",
      {
        card: { kind: "card", cardId: ctx.self.cardId },
        count: total,
      },
    ));
    if (charge && total > 0) {
      // Blaze, Firemind: "Whenever you opt, put energy counters on Blaze equal
      // to the number of cards looked at this way."
      const hero = ctx.player(ctx.seat).hero;
      const n = (hero.counters?.energy ?? 0) + total;
      ctx.setCardCounter(hero.instanceId, "energy", n);
      ctx.logPublic(localizedLog(
        `${ctx.cardData(hero.cardId).name} gets ${total} energy counter(s) (${n})`,
        "card.log.common.energy.counters.gained",
        {
          card: { kind: "card", cardId: hero.cardId },
          amount: total,
          count: n,
        },
      ));
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
