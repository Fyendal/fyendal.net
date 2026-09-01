import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardData } from "@fyendal/shared";
import type { CardScript } from "./scripts.js";
import {
  cardAbilitiesSuppressed,
  cardColorOf,
  cardHasType,
  dataOf,
  instanceHasKeyword,
  scriptOf,
  wardValueOf,
} from "./cardProperties.js";
import {
  activeModifiers,
  attackGrantedType,
  hasClass,
  modifierApplies,
  modifierAppliesToDefense,
} from "./combatModifiers.js";
import type { CardInstance, ChainLinkState, CombatValueModifier, Modifier, PlayerState } from "./state.js";
import { findCardAnywhere, opponent } from "./zoneQueries.js";
import { controlledPermanents, hookSources, lingeringModifierSources } from "./sourceQueries.js";
import { heroAbilitiesDisabled } from "./stateQueries.js";

/** Consume delayed "the next time they defend" effects at the defend event
 * boundary and attach their adjustment to exactly the matching cards. */
export function applyOneShotDefenseModifiers(
  state: GameStateInternal,
  link: ChainLinkState,
  defenders: readonly CardInstance[],
): void {
  const additions: Modifier[] = [];
  for (const modifier of state.modifiers) {
    if (
      !modifier.once ||
      modifier.consumed ||
      !modifier.defense ||
      (modifier.scope !== "until-end-of-turn" && modifier.scope !== "static")
    ) continue;
    let matching = defenders.filter((card) => {
      if (modifier.seat !== card.owner) return false;
      const equipment = link.defendingEquipment.some(
        (candidate) => candidate.instanceId === card.instanceId,
      );
      if (equipment) return modifier.appliesToEquipment === true;
      if (modifier.appliesToEquipment === true) return false;
      return modifierAppliesToDefense(
        state,
        modifier,
        dataOf(state, card.cardId),
        cardColorOf(state, card),
        card,
      );
    });
    if (modifier.appliesToFirstDefenderOnly) matching = matching.slice(0, 1);
    if (matching.length === 0) continue;
    modifier.consumed = true;
    for (const card of matching) {
      additions.push({
        id: state.nextModifierId++,
        sourceInstanceId: modifier.sourceInstanceId,
        ...(modifier.sourceCardId ? { sourceCardId: modifier.sourceCardId } : {}),
        seat: card.owner,
        scope: "chain-link",
        defense: modifier.defense,
        appliesToInstanceId: card.instanceId,
        ...(modifier.appliesToEquipment ? { appliesToEquipment: true } : {}),
      });
    }
  }
  state.modifiers.push(...additions);
}

/** Apply temporal "if an attack would gain power, it gains that much plus N"
 * replacements. */
export function replaceTemporalPowerGain(
  state: GameStateInternal,
  link: ChainLinkState,
  amount: number,
): number {
  if (amount <= 0) return amount;
  let replaced = amount;
  for (const modifier of state.modifiers) {
    if (
      !modifier.powerGainBonus ||
      modifier.consumed ||
      modifier.seat !== link.attacker ||
      !["chain-link", "combat-chain", "until-end-of-turn", "static"].includes(
        modifier.scope,
      ) ||
      !modifierApplies(state, modifier, link)
    ) continue;
    replaced += modifier.powerGainBonus;
    if (modifier.once) modifier.consumed = true;
  }
  return replaced;
}

/** Printed defense minus any -1 defense counters (Battleworn/Temper). */
export function effectiveDefense(state: GameStateInternal, card: CardInstance): number {
  return Math.max(
    0,
    (dataOf(state, card.cardId).defense ?? 0) - (card.defCounters ?? 0),
  );
}

export function attackHasDominate(
  state: GameStateInternal,
  link: ChainLinkState,
): boolean {
  if (link.flags.attackAbilitiesSuppressed === true) return false;
  if ((link.attackingCard.suppressedKeywords ?? []).includes("dominate")) return false;
  const attacker = state.players[link.attacker] as PlayerState;
  if (Number(attacker.hero.counters?.suppressDominateUntilTurn ?? 0) >= state.turn) {
    return false;
  }
  if (instanceHasKeyword(state, link.attackingCard, "dominate")) return true;
  return activeModifiers(state, link, ["chain-link", "until-end-of-turn"])
    .some((modifier) => modifier.dominate);
}

/** Overpower (CR 8.3.22): at most one action card may defend the attack. */
export function attackHasOverpower(
  state: GameStateInternal,
  link: ChainLinkState,
): boolean {
  if (link.flags.attackAbilitiesSuppressed === true) return false;
  if (instanceHasKeyword(state, link.attackingCard, "overpower")) return true;
  if (link.flags.overpower === true) return true;
  return activeModifiers(state, link, ["chain-link", "until-end-of-turn"])
    .some((modifier) => modifier.overpower);
}

export function attackIntimidateCount(
  state: GameStateInternal,
  link: ChainLinkState,
): number {
  if (link.flags.attackAbilitiesSuppressed === true) return 0;
  let count = instanceHasKeyword(state, link.attackingCard, "intimidate") ? 1 : 0;
  for (const modifier of activeModifiers(state, link, [
    "chain-link",
    "until-end-of-turn",
  ])) {
    if (modifier.intimidate) count += modifier.intimidate;
  }
  return count;
}

/** Strictest live limit on non-block defenders, if one exists. */
export function attackMaxNonBlockDefenders(
  state: GameStateInternal,
  link: ChainLinkState,
): number | undefined {
  let limit: number | undefined;
  for (const modifier of activeModifiers(state, link, [
    "chain-link",
    "until-end-of-turn",
  ])) {
    if (modifier.maxNonBlockDefenders === undefined) continue;
    limit = limit === undefined
      ? modifier.maxNonBlockDefenders
      : Math.min(limit, modifier.maxNonBlockDefenders);
  }
  return limit;
}

/** Whether a link's attack has a printed, stamped, or live granted type. */
export function linkAttackHasType(
  state: GameStateInternal,
  link: ChainLinkState,
  tag: string,
): boolean {
  const normalized = tag.toLowerCase();
  const data = dataOf(state, link.attackingCard.cardId);
  if (
    hasClass(data, normalized) ||
    (data.subtypes ?? []).some((subtype) => subtype.toLowerCase() === normalized)
  ) return true;
  if (attackGrantedType(link, normalized)) return true;
  return state.modifiers.some(
    (modifier) =>
      (modifier.scope === "chain-link" || modifier.scope === "combat-chain") &&
      modifier.grantType?.toLowerCase() === normalized &&
      modifierApplies(state, modifier, link),
  );
}

export function chainLinksControlled(
  state: GameStateInternal,
  seat: number,
  tag?: string,
): number {
  return state.chain.filter(
    (link, index) =>
      // Internally the pending attack is appended before its attack-layer
      // resolves. It does not become a chain link until the Attack Step
      // (CR 7.0.3a, 7.2.2), so it cannot yet contribute to this count.
      !(state.stackResume === "start-attack-step" && index === state.chain.length - 1) &&
      link.attacker === seat &&
      (tag === undefined || linkAttackHasType(state, link, tag)),
  ).length;
}

export function hitsThisCombatChain(state: GameStateInternal, seat?: number): number {
  return state.chain.filter(
    (link) => link.hit && (seat === undefined || link.attacker === seat),
  ).length;
}

/** A link's one-based position on the open combat chain. */
export function chainLinkNumber(
  state: GameStateInternal,
  link: ChainLinkState,
): number {
  const index = state.chain.indexOf(link);
  return index < 0 ? state.chain.length : index + 1;
}

export function conditionalAttackBonus(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  link: ChainLinkState,
): number {
  const script: CardScript | undefined = scriptOf(state, card.cardId, card);
  const suppressOwn =
    link.attackCardType === "action" &&
    state.players.some((candidate) => candidate.flags.suppressAttackPowerEffectGains === true);
  const own = suppressOwn ? 0 : script?.modifyAttack?.(runtime.makeCtx(state, seat, card, link)) ?? 0;
  const inherited = [
    ...(card.grantedBaseAbilitiesCardId ? [card.grantedBaseAbilitiesCardId] : []),
    ...(card.grantedBaseAbilitiesCardIds ?? []),
  ].reduce((sum, cardId) => sum + (state.scriptsRef[cardId]?.modifyAttack?.(
    runtime.makeCtx(state, seat, card, link),
  ) ?? 0), 0);
  return own + inherited;
}

function valueModifier(
  out: CombatValueModifier[],
  source: CardInstance | undefined,
  amount: number,
): void {
  if (!source || amount === 0) return;
  out.push({
    sourceInstanceId: source.instanceId,
    sourceCardId: source.cardId,
    amount,
  });
}

function defendingCardDefenseAdjustment(link: ChainLinkState, amount: number): number {
  return link.flags.defendingCardsCannotGainDefense === true && amount > 0 ? 0 : amount;
}

function defendingCardBaseDefense(
  link: ChainLinkState,
  printed: number,
  modified: number,
): number {
  return link.flags.defendingCardsCannotGainDefense === true && modified > printed
    ? printed
    : modified;
}

function linkBaseDefense(link: ChainLinkState, card: CardInstance, printed: number): number {
  const override = link.flags[`baseDefense:${card.instanceId}`];
  return typeof override === "number" ? override : printed;
}

interface AttackValueAdjustment {
  source?: CardInstance;
  amount: number;
}

/** Active Piercing contributions for this attack. Piercing is a static
 * ability (CR 8.3.23), so these values are evaluated continuously rather than
 * queued as triggers. */
function piercingValueModifiers(
  state: GameStateInternal,
  link: ChainLinkState,
): CombatValueModifier[] {
  if (link.defendingEquipment.length === 0) return [];
  const liveAttack =
    findCardAnywhere(state, link.attackingCard.instanceId)?.card ?? link.attackingCard;
  if (cardAbilitiesSuppressed(state, liveAttack)) return [];
  const suppressed = new Set(
    (liveAttack.suppressedKeywords ?? []).map((keyword) => keyword.trim().toLowerCase()),
  );
  const out: CombatValueModifier[] = [];
  for (const keyword of [
    ...(dataOf(state, link.attackingCard.cardId).keywords ?? []),
    ...(liveAttack.grantedKeywords ?? []),
  ]) {
    const normalized = keyword.trim().toLowerCase();
    if (suppressed.has(normalized)) continue;
    const match = /^piercing (\d+)$/.exec(normalized);
    if (match) valueModifier(out, liveAttack, Number(match[1]));
  }
  for (const modifier of activeModifiers(state, link, [
    "chain-link",
    "combat-chain",
    "until-end-of-turn",
    "static",
  ])) {
    if (!modifier.piercing) continue;
    if (suppressed.has(`piercing ${modifier.piercing}`)) continue;
    valueModifier(
      out,
      findCardAnywhere(state, modifier.sourceInstanceId)?.card,
      modifier.piercing,
    );
  }
  return out;
}

function attackCannotGainPower(
  state: GameStateInternal,
  link: ChainLinkState,
  data: CardData,
): boolean {
  const attacker = state.players[link.attacker] as PlayerState;
  return (
    attacker.flags.attacksCannotGainPower === true ||
    (isAttackActionData(data) &&
      Number(attacker.hero.counters?.attackActionNoPowerGainUntilTurn ?? 0) === state.turn)
  );
}

/** Collect every adjustment layered onto an attack's base power so the
 * authoritative total and projected modifier breakdown cannot drift apart. */
function attackValueAdjustments(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
): AttackValueAdjustment[] {
  const out: AttackValueAdjustment[] = [];
  const data = dataOf(state, link.attackingCard.cardId);
  const attacker = state.players[link.attacker] as PlayerState;
  const cannotGainPower = attackCannotGainPower(state, link, data);
  const add = (source: CardInstance | undefined, amount: number): void => {
    if (amount === 0 || (cannotGainPower && amount > 0)) return;
    out.push({ source, amount });
  };

  for (const modifier of activeModifiers(state, link, [
    "chain-link",
    "combat-chain",
    "until-end-of-turn",
    "static",
  ])) {
    if (
      modifier.defendedLessThanNonEquip !== undefined &&
      link.defendingCards.length >= modifier.defendedLessThanNonEquip
    ) continue;
    if (modifier.attack) {
      add(findCardAnywhere(state, modifier.sourceInstanceId)?.card, modifier.attack);
    }
  }

  const liveAttack =
    findCardAnywhere(state, link.attackingCard.instanceId)?.card ?? link.attackingCard;
  add(liveAttack, liveAttack.counters?.power ?? 0);
  add(liveAttack, liveAttack.tempPower ?? 0);
  for (const piercing of piercingValueModifiers(state, link)) {
    add(findCardAnywhere(state, piercing.sourceInstanceId)?.card, piercing.amount);
  }

  add(link.attackingCard, conditionalAttackBonus(state, runtime, link.attacker, link.attackingCard, link));
  if (!heroAbilitiesDisabled(state, link.attacker)) {
    add(attacker.hero, conditionalAttackBonus(state, runtime, link.attacker, attacker.hero, link));
  }
  for (const reaction of link.reactions) {
    add(reaction, conditionalAttackBonus(state, runtime, link.attacker, reaction, link));
  }

  const attackerSources = hookSources(state, link.attacker, {
    board: true,
    equipment: true,
    weapons: true,
  });
  for (const source of attackerSources) {
    if (source.instanceId === link.attackingCard.instanceId) continue;
    const hook = scriptOf(state, source.cardId, source)?.modifyFriendlyAttack;
    if (hook) {
      add(
        source,
        hook(runtime.makeCtx(state, link.attacker, source, link), link.attackingCard),
      );
    }
  }

  const defenderSeat = opponent(link.attacker);
  const defenderSources = hookSources(state, defenderSeat, {
    board: true,
    equipment: true,
    weapons: true,
  });
  for (const source of defenderSources) {
    const hook = scriptOf(state, source.cardId, source)?.modifyOpposingAttack;
    if (hook) add(source, hook(runtime.makeCtx(state, defenderSeat, source, link), link.attackingCard));
  }
  for (const source of lingeringModifierSources(state, defenderSeat)) {
    if (defenderSources.some((active) => active.instanceId === source.instanceId)) continue;
    const hook = scriptOf(state, source.cardId, source)?.modifyOpposingAttack;
    if (hook) add(source, hook(runtime.makeCtx(state, defenderSeat, source, link), link.attackingCard));
  }
  for (const source of link.defendingCards) {
    const hook = scriptOf(state, source.cardId, source)?.modifyOpposingAttack;
    if (hook) add(source, hook(runtime.makeCtx(state, source.owner, source, link), link.attackingCard));
  }

  for (const modifier of state.modifiers) {
    if (modifier.scope !== "until-end-of-turn" && modifier.scope !== "static") continue;
    if (!modifierApplies(state, modifier, link)) continue;
    if (modifier.sourceInstanceId === link.attackingCard.instanceId) continue;
    const found = findCardAnywhere(state, modifier.sourceInstanceId);
    if (!found) continue;
    const hook = scriptOf(state, found.card.cardId, found.card)?.modifyAttack;
    if (hook) add(found.card, hook(runtime.makeCtx(state, found.seat, found.card, link)));
  }
  return out;
}

/** Numeric attack modifiers with the card instance that produced each one.
 * Printed/base power is intentionally excluded: this is provenance for the
 * adjustments layered onto the attack's base value. */
export function attackValueModifiers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
): CombatValueModifier[] {
  const out: CombatValueModifier[] = [];
  for (const adjustment of attackValueAdjustments(state, runtime, link)) {
    valueModifier(out, adjustment.source, adjustment.amount);
  }
  return out;
}

function attackingDefenseModifierSources(
  state: GameStateInternal,
  link: ChainLinkState,
): CardInstance[] {
  return [
    link.attackingCard,
    ...hookSources(state, link.attacker, { board: true, equipment: true, weapons: true })
      .filter((source) => source.instanceId !== link.attackingCard.instanceId),
  ];
}

function defendingCardModifiers(
  state: GameStateInternal,
  link: ChainLinkState,
  card: CardInstance,
): Modifier[] {
  const data = dataOf(state, card.cardId);
  const color = cardColorOf(state, card);
  return state.modifiers.filter((modifier) => {
    if (!modifier.defense || modifier.consumed || modifier.appliesToEquipment) return false;
    if (
      modifier.scope !== "until-end-of-turn" &&
      modifier.scope !== "static" &&
      !(modifier.scope === "chain-link" && modifier.appliesToInstanceId !== undefined)
    ) return false;
    if (
      modifier.seat !== card.owner ||
      !modifierAppliesToDefense(state, modifier, data, color, card)
    ) return false;
    if (!modifier.appliesToFirstDefenderOnly) return true;
    const first = link.defendingCards.find((candidate) =>
      modifierAppliesToDefense(
        state,
        modifier,
        dataOf(state, candidate.cardId),
        cardColorOf(state, candidate),
        candidate,
      )
    );
    return first?.instanceId === card.instanceId;
  });
}

function defendingEquipmentModifiers(
  state: GameStateInternal,
  card: CardInstance,
): Modifier[] {
  return state.modifiers.filter((modifier) =>
    !!modifier.defense &&
    !modifier.consumed &&
    modifier.appliesToEquipment === true &&
    modifier.seat === card.owner &&
    (modifier.appliesToInstanceId === undefined ||
      modifier.appliesToInstanceId === card.instanceId) &&
    (
      modifier.scope === "static" ||
      modifier.scope === "until-end-of-turn" ||
      modifier.scope === "chain-link"
    )
  );
}

function linkDefenseModifiers(
  state: GameStateInternal,
  link: ChainLinkState,
): Modifier[] {
  const defender = opponent(link.attacker);
  return state.modifiers.filter((modifier) =>
    modifier.scope === "chain-link" &&
    modifier.appliesToInstanceId === undefined &&
    !!modifier.defense &&
    modifier.seat === defender
  );
}

/** Numeric defense modifiers with their source card. Printed defense for each
 * committed defender is intentionally excluded. */
export function defenseValueModifiers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
): CombatValueModifier[] {
  const out: CombatValueModifier[] = [];
  for (const card of link.defendingCards) {
    for (const source of attackingDefenseModifierSources(state, link)) {
      const amount = defendingCardDefenseAdjustment(
        link,
        scriptOf(state, source.cardId, source)?.modifyDefendingDefense?.(
          runtime.makeCtx(state, link.attacker, source, link),
          card,
        ) ?? 0,
      );
      valueModifier(out, source, amount);
    }
    for (const modifier of defendingCardModifiers(state, link, card)) {
      valueModifier(
        out,
        findCardAnywhere(state, modifier.sourceInstanceId)?.card,
        defendingCardDefenseAdjustment(link, modifier.defense ?? 0),
      );
    }
    valueModifier(
      out,
      card,
      defendingCardDefenseAdjustment(
        link,
        scriptOf(state, card.cardId, card)?.modifyDefense?.(
          runtime.makeCtx(state, card.owner, card, link),
        ) ?? 0,
      ),
    );
    for (const modifier of activeModifiers(state, link, ["chain-link", "until-end-of-turn"])) {
      const adjustment = modifier.defendingPitchDefenseAdjustment;
      if (!adjustment) continue;
      if (adjustment.requiresAimCounter && !(link.attackingCard.counters?.aim ?? 0)) continue;
      if (cardColorOf(state, card) === adjustment.pitch) {
        valueModifier(
          out,
          findCardAnywhere(state, modifier.sourceInstanceId)?.card,
          defendingCardDefenseAdjustment(link, adjustment.amount),
        );
      }
    }
    valueModifier(out, card, defendingCardDefenseAdjustment(link, card.tempDefense ?? 0));
  }

  for (const card of link.defendingEquipment) {
    valueModifier(out, card, -(card.defCounters ?? 0));
    valueModifier(out, card, defendingCardDefenseAdjustment(link, card.tempDefense ?? 0));
    valueModifier(
      out,
      card,
      defendingCardDefenseAdjustment(
        link,
        scriptOf(state, card.cardId, card)?.modifyDefense?.(
          runtime.makeCtx(state, card.owner, card, link),
        ) ?? 0,
      ),
    );
    valueModifier(
      out,
      link.attackingCard,
      defendingCardDefenseAdjustment(
        link,
        scriptOf(state, link.attackingCard.cardId, link.attackingCard)
          ?.modifyDefendingEquipmentDefense?.(
            runtime.makeCtx(state, link.attacker, link.attackingCard, link),
            card,
          ) ?? 0,
      ),
    );
    for (const modifier of defendingEquipmentModifiers(state, card)) {
      valueModifier(
        out,
        findCardAnywhere(state, modifier.sourceInstanceId)?.card,
        defendingCardDefenseAdjustment(link, modifier.defense ?? 0),
      );
    }
  }
  for (const modifier of linkDefenseModifiers(state, link)) {
    valueModifier(
      out,
      findCardAnywhere(state, modifier.sourceInstanceId)?.card,
      defendingCardDefenseAdjustment(link, modifier.defense ?? 0),
    );
  }
  return out;
}

function isAttackActionData(data: CardData): boolean {
  return data.cardType === "action" && (data.subtypes ?? []).includes("attack");
}

/**
 * A controlled card's base power/defense after continuous base-value effects:
 * the controller's hero script (modifyBasePower/modifyBaseDefense — halving
 * and the like) and the hero counter `halveBaseAttackActionUntil` holding the
 * last turn number the player's attack action cards have their base {p}/{d}
 * halved for (counters survive end-of-turn flag cleanup, so "until the end of
 * their next turn" works across the turn boundary). Also applies to cards
 * revealed from the deck (clash): their controller's base effects count.
 */
export function basePowerOf(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  raw: number,
): number {
  if (scriptOf(state, card.cardId, card)?.unmodifiableCharacteristics?.includes("power")) {
    return raw;
  }
  return applyBaseModifier(state, runtime, seat, card, card.temporaryAlly?.power ?? raw, "power");
}

/** Current power of a card while it is defending. This is distinct from base
 * power and includes instance modifiers plus opposing continuous effects. */
export function currentPowerOf(
  state: GameStateInternal,
  runtime: EngineRuntime,
  card: CardInstance,
  link?: ChainLinkState,
): number {
  if (scriptOf(state, card.cardId, card)?.unmodifiableCharacteristics?.includes("power")) {
    return dataOf(state, card.cardId).attack ?? 0;
  }
  let power = basePowerOf(state, runtime, card.owner, card, dataOf(state, card.cardId).attack ?? 0);
  power += Number(card.counters?.power ?? 0) + Number(card.tempPower ?? 0);
  if (!link || !link.defendingCards.some((candidate) => candidate.instanceId === card.instanceId)) {
    return power;
  }
  power += scriptOf(state, link.attackingCard.cardId, link.attackingCard)?.modifyDefendingPower?.(
    runtime.makeCtx(state, link.attacker, link.attackingCard, link),
    card,
  ) ?? 0;
  const activeDamageObservers = hookSources(state, link.attacker, {
    board: true,
    equipment: true,
    weapons: true,
  });
  const damageObservers = [
    ...activeDamageObservers,
    ...lingeringModifierSources(state, link.attacker).filter(
      (candidate) => !activeDamageObservers.some((source) => source.instanceId === candidate.instanceId),
    ),
  ];
  for (const source of damageObservers) {
    power += scriptOf(state, source.cardId, source)?.modifyOpposingPower?.(
      runtime.makeCtx(state, link.attacker, source, link),
      card,
    ) ?? 0;
  }
  return power;
}

function baseDefenseOf(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  raw: number,
): number {
  if (scriptOf(state, card.cardId, card)?.unmodifiableCharacteristics?.includes("defense")) {
    return raw;
  }
  return applyBaseModifier(state, runtime, seat, card, raw, "defense");
}

function applyBaseModifier(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  raw: number,
  kind: "power" | "defense",
): number {
  let base = raw;
  const player = state.players[seat] as PlayerState;

  // Characteristic-defining abilities, such as Rockyard Rodeo's */power,
  // function in every zone. Apply the card's own definition before effects
  // from its controller so those effects see the defined base value.
  if (card.instanceId !== player.hero.instanceId) {
    const ownKey = kind === "power" ? "modifyBasePower" : "modifyBaseDefense";
    const ownHook = scriptOf(state, card.cardId, card)?.[ownKey];
    if (ownHook) base = ownHook(runtime.makeCtx(state, seat, card), card, base);
  }

  if (!heroAbilitiesDisabled(state, seat)) {
    const key = kind === "power" ? "modifyBasePower" : "modifyBaseDefense";
    const hook = scriptOf(state, player.hero.cardId, player.hero)?.[key];
    if (hook) base = hook(runtime.makeCtx(state, seat, player.hero), card, base);
  }
  // Per-card base-value effects use the CR stage order: multiplication before
  // division. Kayo's low roll is the round-down division; other halving
  // effects below explicitly round up.
  if (kind === "power") {
    const doublings = Math.max(0, Number(card.counters?.doubleBasePower ?? 0));
    for (let i = 0; i < doublings; i++) base *= 2;
    const roundDownHalvings = Math.max(
      0,
      Number(card.counters?.halveBasePowerRoundDown ?? 0),
    );
    for (let i = 0; i < roundDownHalvings; i++) base = Math.floor(base / 2);
  }
  if (halveAttackActionBase(state, player, card)) {
    base = Math.ceil(base / 2);
  }
  if (Number(card.counters?.halveBasePower ?? 0) > 0) {
    base = Math.ceil(base / 2);
  }
  return base;
}

function halveAttackActionBase(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
): boolean {
  const until = Number(player.hero.counters?.halveBaseAttackActionUntil ?? 0);
  return until >= state.turn && isAttackActionData(dataOf(state, card.cardId));
}

export function computeAttack(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
): number {
  const data = dataOf(state, link.attackingCard.cardId);
  // Granted aura attacks use an explicit base when supplied (Reality
  // Refractor), otherwise their Ward value (Cosmo).
  const auraMarker = link.attackCardType === "weapon"
    ? grantsAuraAttackMarker(
        state,
        state.players[link.attacker] as PlayerState,
        link.attackingCard,
      )
    : undefined;
  const rawAttack = data.attack ?? auraMarker?.basePower ?? wardValueOf(data) ?? 0;
  if (scriptOf(state, link.attackingCard.cardId, link.attackingCard)
    ?.unmodifiableCharacteristics?.includes("power")) {
    return Math.max(0, rawAttack);
  }
  let total = basePowerOf(state, runtime, link.attacker, link.attackingCard, rawAttack);
  for (const adjustment of attackValueAdjustments(state, runtime, link)) {
    total += adjustment.amount;
  }
  return Math.max(0, total);
}

export function computeDefense(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
): number {
  let total = 0;
  for (const c of link.defendingCards) {
    total += defendingCardDefense(state, runtime, link, c);
  }
  for (const c of link.defendingEquipment) {
    total += equipmentDefense(state, runtime, link, c);
  }
  for (const modifier of linkDefenseModifiers(state, link)) {
    total += defendingCardDefenseAdjustment(link, modifier.defense ?? 0);
  }
  return Math.max(0, total);
}

/** Current defense of one non-equipment defending card. */
function defendingCardDefense(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  card: CardInstance,
): number {
  const data = dataOf(state, card.cardId);
  if (scriptOf(state, card.cardId, card)?.unmodifiableCharacteristics?.includes("defense")) {
    return Math.max(0, data.defense ?? 0);
  }
  const printed = data.defense ?? 0;
  const raw = linkBaseDefense(link, card, printed);
  let defense = defendingCardBaseDefense(
    link,
    printed,
    baseDefenseOf(state, runtime, card.owner, card, raw),
  );
  defense += defendingCardDefenseAdjustment(link, Number(card.counters?.defense ?? 0));
  for (const source of attackingDefenseModifierSources(state, link)) {
    defense += defendingCardDefenseAdjustment(
      link,
      scriptOf(state, source.cardId, source)?.modifyDefendingDefense?.(
        runtime.makeCtx(state, link.attacker, source, link),
        card,
      ) ?? 0,
    );
  }
  for (const modifier of defendingCardModifiers(state, link, card)) {
    defense += defendingCardDefenseAdjustment(link, modifier.defense ?? 0);
  }
  defense += defendingCardDefenseAdjustment(
    link,
    scriptOf(state, card.cardId, card)?.modifyDefense?.(
      runtime.makeCtx(state, card.owner, card, link),
    ) ?? 0,
  );
  for (const modifier of activeModifiers(state, link, ["chain-link", "until-end-of-turn"])) {
    const adjustment = modifier.defendingPitchDefenseAdjustment;
    if (!adjustment) continue;
    if (adjustment.requiresAimCounter && !(link.attackingCard.counters?.aim ?? 0)) continue;
    if (cardColorOf(state, card) === adjustment.pitch) {
      defense += defendingCardDefenseAdjustment(link, adjustment.amount);
    }
  }
  defense += defendingCardDefenseAdjustment(link, card.tempDefense ?? 0);
  return Math.max(0, defense);
}

/** Observe a card becoming a defender. Some attacking permanents create a
 * delayed self-destruction at that moment; later power/defense changes do not
 * undo or retroactively create it. */
export function noteAttackDefendedBy(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  defending: CardInstance,
): boolean {
  const defendingData = dataOf(state, defending.cardId);
  const defendingColor = cardColorOf(state, defending);
  if (defendingColor > 0) {
    const owner = state.players[defending.owner] as PlayerState;
    owner.flags[`defendedPitch:${defendingColor}`] =
      (Number(owner.flags[`defendedPitch:${defendingColor}`]) || 0) + 1;
  }
  if (
    defendingData.cardType === "action" &&
    (defendingData.subtypes ?? []).includes("attack")
  ) {
    (state.players[defending.owner] as PlayerState).flags.defendedWithAttackActionThisTurn = true;
  }
  const defense = link.defendingEquipment.some(
    (card) => card.instanceId === defending.instanceId,
  )
    ? equipmentDefense(state, runtime, link, defending)
    : defendingCardDefense(state, runtime, link, defending);
  const attackScript = scriptOf(state, link.attackingCard.cardId, link.attackingCard);
  if (link.defendingEquipment.some((card) => card.instanceId === defending.instanceId)) {
    attackScript?.onDefendedByEquipment?.(
      runtime.makeCtx(state, link.attacker, link.attackingCard, link),
      defending,
    );
  }
  const fragmentTriggered = defense >= 2 && instanceHasKeyword(state, link.attackingCard, "fragment");
  if (
    attackScript?.destroyOnChainCloseWhenDefendedByHigherDefense === true &&
    defense > computeAttack(state, runtime, link)
  ) {
    link.flags.destroyAttackerOnChainClose = true;
  }
  return fragmentTriggered;
}

/** Current defense of an equipment defending on `link`, including counters
 * and continuous/scripted modifiers such as Unity. Temper checks this same
 * value after adding its counter when the combat chain closes. */
export function equipmentDefense(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  c: CardInstance,
): number {
  const printed = dataOf(state, c.cardId).defense ?? 0;
  const raw = linkBaseDefense(link, c, printed);
  if (scriptOf(state, c.cardId, c)?.unmodifiableCharacteristics?.includes("defense")) {
    return Math.max(0, printed);
  }
  const attackScript = scriptOf(state, link.attackingCard.cardId, link.attackingCard);
  const attackAdjustment = attackScript?.modifyDefendingEquipmentDefense?.(
    runtime.makeCtx(state, link.attacker, link.attackingCard, link),
    c,
  ) ?? 0;
  let friendlyAdjustment = 0;
  for (const source of hookSources(state, c.owner, {
    board: true,
    equipment: true,
    weapons: true,
    heroLast: true,
  })) {
    friendlyAdjustment += defendingCardDefenseAdjustment(
      link,
      scriptOf(state, source.cardId, source)?.modifyFriendlyEquipmentDefense?.(
        runtime.makeCtx(state, c.owner, source, link),
        c,
      ) ?? 0,
    );
  }
  const modifierAdjustment = defendingEquipmentModifiers(state, c)
    .reduce(
      (total, modifier) => total + defendingCardDefenseAdjustment(link, modifier.defense ?? 0),
      0,
    );
  const modified =
    defendingCardBaseDefense(
      link,
      printed,
      baseDefenseOf(state, runtime, c.owner, c, raw),
    ) -
    (c.defCounters ?? 0) +
    defendingCardDefenseAdjustment(link, Number(c.counters?.defense ?? 0)) +
    defendingCardDefenseAdjustment(link, c.tempDefense ?? 0) +
    defendingCardDefenseAdjustment(
      link,
      scriptOf(state, c.cardId, c)?.modifyDefense?.(runtime.makeCtx(state, c.owner, c, link)) ?? 0,
    ) +
    defendingCardDefenseAdjustment(link, attackAdjustment) +
    friendlyAdjustment +
    modifierAdjustment;
  return Math.max(0, modified);
}

/** Defense contributed by an uncommitted staged set if those cards became
 * defenders on `link`. This mirrors the committed per-card calculation
 * without moving cards, firing defend hooks, or adding link-wide defense a
 * second time (the projected link value already includes those modifiers). */
export function stagedDefenseTotal(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  staged: CardInstance[],
): number {
  const cards = staged.filter((card) => !cardHasType(state, card, "equipment"));
  const equipment = staged.filter((card) => cardHasType(state, card, "equipment"));
  const stagedLink: ChainLinkState = {
    ...link,
    defendingCards: [...link.defendingCards, ...cards],
    defendingEquipment: [...link.defendingEquipment, ...equipment],
  };
  return cards.reduce(
    (total, card) => total + defendingCardDefense(state, runtime, stagedLink, card),
    0,
  ) + equipment.reduce(
    (total, card) => total + equipmentDefense(state, runtime, stagedLink, card),
    0,
  );
}

/** The first grantsAuraAttack marker among the player's permanents. Face-down
 *  (Cloaked) permanents are inert. */
export function grantsAuraAttackMarker(
  state: GameStateInternal,
  player: PlayerState,
  card?: CardInstance,
): CardScript["grantsAuraAttack"] | undefined {
  const sources = controlledPermanents(state, player.seat, { faceDownEquipment: false });
  for (const src of sources) {
    const marker = scriptOf(state, src.cardId, src)?.grantsAuraAttack;
    if (!marker) continue;
    if (card) {
      const data = dataOf(state, card.cardId);
      if (marker.requiresWard !== false && wardValueOf(data) === undefined) continue;
      if (
        marker.requiresClass &&
        !(data.classes ?? []).some((candidate) =>
          candidate.toLowerCase() === marker.requiresClass!.toLowerCase())
      ) continue;
      if (
        marker.requiresSubtype &&
        !(data.subtypes ?? []).some((candidate) =>
          candidate.toLowerCase() === marker.requiresSubtype!.toLowerCase())
      ) continue;
    }
    return marker;
  }
  return undefined;
}

/**
 * The attack's current bonus over its base {p}: modifier-granted plus
 * script-granted contributions from the attacking object, hero, reactions,
 * friendly continuous sources, and lingering effect sources.
 * `excludeInstanceId` drops a card's own conditional contribution, so "if
 * this has {p} greater than its base" does not count the bonus the check
 * itself would grant (and cannot recurse).
 */
export function attackBonusAboveBase(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  excludeInstanceId?: number,
): number {
  if (scriptOf(state, link.attackingCard.cardId, link.attackingCard)
    ?.unmodifiableCharacteristics?.includes("power")) return 0;
  let n = activeModifiers(state, link, ["chain-link", "until-end-of-turn", "static"])
    .reduce((total, modifier) => total + (modifier.attack ?? 0), 0);
  // +1{p} counters and this-turn power grants on the attacking card are
  // above-base too
  const liveAttack =
    findCardAnywhere(state, link.attackingCard.instanceId)?.card ?? link.attackingCard;
  n += liveAttack.counters?.power ?? 0;
  n += liveAttack.tempPower ?? 0;
  const attacker = state.players[link.attacker] as PlayerState;
  if (link.attackingCard.instanceId !== excludeInstanceId) {
    n += conditionalAttackBonus(state, runtime, link.attacker, link.attackingCard, link);
  }
  if (!heroAbilitiesDisabled(state, link.attacker)) {
    n += conditionalAttackBonus(state, runtime, link.attacker, attacker.hero, link);
  }
  for (const r of link.reactions) {
    n += conditionalAttackBonus(state, runtime, link.attacker, r, link);
  }
  for (const source of hookSources(state, link.attacker, {
    board: true,
    equipment: true,
    weapons: true,
  })) {
    if (
      source.instanceId === link.attackingCard.instanceId ||
      source.instanceId === excludeInstanceId
    ) continue;
    const hook = scriptOf(state, source.cardId, source)?.modifyFriendlyAttack;
    if (hook) {
      n += hook(runtime.makeCtx(state, link.attacker, source, link), link.attackingCard);
    }
  }
  for (const mod of state.modifiers) {
    if (mod.scope !== "until-end-of-turn" && mod.scope !== "static") continue;
    if (!modifierApplies(state, mod, link)) continue;
    if (mod.sourceInstanceId === link.attackingCard.instanceId) continue;
    if (mod.sourceInstanceId === excludeInstanceId) continue;
    const src = findCardAnywhere(state, mod.sourceInstanceId);
    if (!src) continue;
    const script = scriptOf(state, src.card.cardId, src.card);
    if (script?.modifyAttack) {
      n += script.modifyAttack(runtime.makeCtx(state, src.seat, src.card, link));
    }
  }
  return n;
}
