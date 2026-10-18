import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import {
  cardColorOf,
  cardHasType,
  cardNameKeysOf,
  cardTypesOf,
  dataOf,
  instanceHasKeyword,
  scriptOf,
  wardValueOf,
} from "./cardProperties.js";
import {
  conditionalModifierGrantsGoAgain,
  conditionalScriptGrantsGoAgain,
  modifierApplies,
  modifierAppliesTo,
} from "./combatModifiers.js";
import {
  computeAttack,
  grantsAuraAttackMarker,
  replaceTemporalPowerGain,
} from "./combatValues.js";
import { payCost } from "./costs.js";
import {
  gameLogMessage,
  logCardValue,
  logNameOf,
  logPublic,
  nameOf,
} from "./gameLog.js";
import { abilityList, activatedFlagKey } from "./scripts.js";
import type { ActivatedAbility } from "./scripts.js";
import type { CardInstance, ChainLinkState, Modifier, PlayerState } from "./state.js";

import { controlledPermanents, observingHookSources } from "./sourceQueries.js";

import { activationCostReductionForCard, actionAbilityRestrictedByModifier } from "./abilityRules.js";
import {
  clearTemporaryObjectEffects,
  consumeNextActionGoAgain,
  noteActionPlayedOrActivated,
} from "./cardLifecycle.js";
import { attackCostReductionForTarget, consumeAttackCostReductions } from "./playRules.js";
import { actionLimitReached, consumeFirstActionExtraCost, consumeFirstAttackExtraCost, firstActionExtraCost, firstAttackExtraCost, goAgainSuppressed } from "./ruleQueries.js";
import { weaponAttacksProhibited } from "./combatRestrictions.js";

import {
  currentLink,
  opponent,
  removeFromArray,
} from "./zoneQueries.js";
import type { CardPlayOrigin } from "./stackCore.js";
import { transitionZone } from "./transitions.js";
import { dequeueAttack, enqueueAttack, type DeferredAttackLayer, type QueuedAttack } from "./attackQueue.js";

function replacePowerGain(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  amount: number,
): number {
  if (amount <= 0 || link.attackingCard.faceDown) return amount;
  if (
    link.flags.cannotGainPower === true ||
    (state.players[link.attacker] as PlayerState).flags.attacksCannotGainPower === true
  ) return 0;
  let replaced = scriptOf(state, link.attackingCard.cardId, link.attackingCard)?.replacePowerGain?.(
    runtime.makeCtx(state, link.attacker, link.attackingCard, link),
    amount,
  ) ?? amount;
  for (const defender of link.defendingEquipment) {
    const next = scriptOf(state, defender.cardId, defender)?.replacePowerGain?.(
      runtime.makeCtx(state, opponent(link.attacker), defender, link),
      replaced,
    );
    if (next !== undefined) replaced = next;
  }
  return replaceTemporalPowerGain(state, link, replaced);
}

/** Move matching "next-attack" modifiers onto the current chain link. */
function attachNextAttackModifiers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
): void {
  const attach = (mod: Modifier): void => {
    if (mod.attack !== undefined && mod.attack > 0) {
      mod.attack = replacePowerGain(state, runtime, link, mod.attack);
    }
    mod.scope = "chain-link";
    // granted types are stamped on the link so they keep counting once the
    // link has resolved and its chain-link modifiers have expired
    if (mod.grantType) link.flags[`grantedType:${mod.grantType.toLowerCase()}`] = true;
    if (mod.grantName) {
      const names = (link.attackingCard.grantedNames ??= []);
      if (!names.some((name) => name.toLowerCase() === mod.grantName!.toLowerCase())) {
        names.push(mod.grantName);
      }
    }
    if (mod.grantKeyword) {
      (link.attackingCard.grantedKeywords ??= []).push(mod.grantKeyword.toLowerCase());
    }
    if (mod.suppressKeyword) {
      (link.attackingCard.suppressedKeywords ??= []).push(mod.suppressKeyword.toLowerCase());
    }
  };
  // Type grants attach first so another next-attack modifier can match the
  // resulting type (for example, an attack made Illusionist this turn).
  for (const mod of state.modifiers) {
    if (mod.scope === "next-attack" && mod.grantType && modifierApplies(state, mod, link)) {
      attach(mod);
    }
  }
  for (const mod of state.modifiers) {
    if (mod.scope === "next-attack" && modifierApplies(state, mod, link)) {
      attach(mod);
    }
  }
  // combat-chain grants ("your attacks are Draconic this combat chain") stamp
  // every matching attack declared while they are active
  for (const mod of state.modifiers) {
    if (mod.scope === "combat-chain" && mod.grantType && modifierApplies(state, mod, link)) {
      link.flags[`grantedType:${mod.grantType.toLowerCase()}`] = true;
    }
  }
}

/** A board card that can attack via a matching grantsAuraAttack marker. */
export function isAuraAttacker(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
): boolean {
  if (!player.board.some((c) => c.instanceId === card.instanceId)) return false;
  if (card.tapped || card.faceDown) return false;
  if (!grantsAuraAttackMarker(state, player, card)) return false;
  const abilityIndex = abilityList(scriptOf(state, card.cardId, card)).length;
  return !player.flags[activatedFlagKey(card.instanceId, abilityIndex)];
}

/** The resource cost of a weapon/aura attack activation after the ability's
 *  own dynamic adjustment and modifyAttackActivationCost hooks on the
 *  attacker's hero and permanents
 *  (e.g. Enigma's "your first Spectral Shield attack each turn costs {r}
 *  less"). Pure — consulted in enumeration AND validation. */
export function attackActivationCost(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  attacker: CardInstance,
  baseCost: number,
  targetAllyId?: number,
  modifyCost?: ActivatedAbility["modifyCost"],
): number {
  let cost = modifyCost
    ? modifyCost(runtime.makeCtx(state, player.seat, attacker), baseCost)
    : baseCost;
  cost += firstActionExtraCost(state, player) + firstAttackExtraCost(state, player);
  const sources = controlledPermanents(state, player.seat, { faceDownEquipment: false });
  for (const src of sources) {
    const sourceScript = scriptOf(state, src.cardId, src);
    cost += Number(sourceScript?.additionalCostToController || 0);
    const hook = sourceScript?.modifyAttackActivationCost;
    if (hook) cost = hook(runtime.makeCtx(state, player.seat, src), attacker, cost);
  }
  for (const opposing of state.players as PlayerState[]) {
    if (opposing.seat === player.seat) continue;
    for (const source of controlledPermanents(state, opposing.seat, { faceDownEquipment: false })) {
      cost += Number(scriptOf(state, source.cardId, source)?.additionalCostToOpponents ?? 0);
    }
  }
  const data = dataOf(state, attacker.cardId);
  const cardType = cardTypesOf(state, attacker).includes("ally") ? "ally" : "weapon";
  for (const modifier of state.modifiers) {
    if (
      modifier.seat !== player.seat ||
      modifier.consumed ||
      !["combat-chain", "next-attack", "until-end-of-turn"].includes(modifier.scope) ||
      !modifier.attackActivationCostReduction ||
      (modifier.appliesToInstanceId !== undefined &&
        modifier.appliesToInstanceId !== attacker.instanceId) ||
      !modifierAppliesTo(
        state,
        modifier,
        data,
        cardType,
        cardColorOf(state, attacker),
        attacker,
      )
    ) continue;
    cost -= modifier.attackActivationCostReduction;
  }
  cost -= activationCostReductionForCard(state, player.seat, attacker);
  cost -= attackCostReductionForTarget(state, player.seat, attacker, targetAllyId);
  return Math.max(0, cost);
}

/**
 * Activate a granted aura attack: during their action phase, a matching ready
 * board card attacks like a weapon (it stays in play, doesn't tap) for 1 action
 * point + the marker's {r} cost, once per turn per aura. The granted ability
 * can have go again directly, or gain it from a +1{p} counter when the marker
 * has goAgainWithPowerCounter (also re-evaluated at link resolution).
 */
export function activateAuraAttack(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  player: PlayerState,
  card: CardInstance,
  pitchInstanceIds: number[],
  targetAllyId?: number,
  abilityIndex = 0,
): string | undefined {
  const marker = grantsAuraAttackMarker(state, player, card);
  const grantedIndex = abilityList(scriptOf(state, card.cardId, card)).length;
  if (!marker || abilityIndex !== grantedIndex || !isAuraAttacker(state, player, card)) {
    return `${nameOf(state, card.cardId)} has no such activated ability`;
  }
  if (weaponAttacksProhibited(player)) return "cannot attack with weapons this turn";
  if (actionAbilityRestrictedByModifier(state, runtime, seat, card, true)) {
    return "action ability is prohibited by a turn restriction";
  }
  if (player.actionPoints < 1) return "not enough action points";
  if (actionLimitReached(state, player)) return "cannot play or activate another action this turn";
  if (!attackTargetIsLegal(state, runtime, seat, targetAllyId)) {
    return "not a legal attack target";
  }
  const cost = attackActivationCost(state, runtime, player, card, marker.cost, targetAllyId);
  const costErr = payCost(state, runtime, player, cost, pitchInstanceIds);
  if (costErr) return costErr;
  consumeAttackCostReductions(state, seat, card, targetAllyId);
  consumeFirstActionExtraCost(state, player);
  consumeFirstAttackExtraCost(state, player);
  player.actionPoints -= 1;
  noteActionPlayedOrActivated(player);
  player.flags[activatedFlagKey(card.instanceId, grantedIndex)] = true;
  (card.counters ??= {}).attacked = 1;
  runtime.events.fireOnFriendlyActivate(state, seat, card, "action");
  // Observers may grant go again specifically to this action activation.
  const nextActionGoAgain = consumeNextActionGoAgain(player);
  // The granting effect makes the qualifying aura a weapon for the turn, so
  // activating this generated attack is a weapon-attack activation.
  runtime.dispatchFlow("deferEventTriggers", state, "weapon-attack-activated", seat, state.nextInstanceId, card);
  const goAgain =
    marker.goAgain === true ||
    (marker.goAgainWithPowerCounter === true && (card.counters?.power ?? 0) >= 1) ||
    nextActionGoAgain;
  declareAttack(state, runtime, seat, card, "weapon", goAgain, targetAllyId);
  return undefined;
}

/** Aura attacks with goAgainWithPowerCounter: go again while the attacking
 *  ward aura has a +1{p} counter — evaluated at link resolution, like other
 *  go again. */
export function auraAttackGoAgain(state: GameStateInternal, link: ChainLinkState): boolean {
  if (link.attackCardType !== "weapon") return false;
  const attacker = state.players[link.attacker] as PlayerState;
  const live = attacker.board.find((c) => c.instanceId === link.attackingCard.instanceId);
  if (!live || wardValueOf(dataOf(state, live.cardId)) === undefined) return false;
  const marker = grantsAuraAttackMarker(state, attacker, live);
  if (marker?.goAgainWithPowerCounter !== true) return false;
  return (live.counters?.power ?? 0) >= 1;
}

function attackGoAgain(state: GameStateInternal, card: CardInstance, cardType: "action" | "weapon" | "ally"): boolean {
  if (instanceHasKeyword(state, card, "go again")) return true;
  const link = currentLink(state);
  return state.modifiers.some(
    (m) =>
      m.goAgain &&
      // The attack's type can differ from its source card's printed type:
      // Cosmo turns an instant aura into a weapon attack, for example.
      (m.appliesToCardType === undefined || m.appliesToCardType === cardType) &&
      (m.scope === "until-end-of-turn" || m.scope === "next-attack" || m.scope === "combat-chain") &&
      (link
        ? modifierApplies(state, m, link)
        : modifierAppliesTo(state, m, dataOf(state, card.cardId), cardType, cardColorOf(state, card), card)),
  );
}

/** An attack resolved into the queue above this unresolved attack-layer. */
const ATTACKS_QUEUED_ABOVE_LAYER = "attacksQueuedAboveLayer";

/**
 * Open a chain link for an attack. Caller has already paid costs/AP and,
 * for action cards, removed the card from its zone (it is passed in `card`).
 * `targetAllyId` is the legacy wire field for an opposing non-hero attack
 * target: a living ally (CR 8.2.8d) or a permanent with Spectra (8.3.14a).
 * Callers validate it with findAttackTargetAlly first.
 */
export function declareAttack(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  cardType: "action" | "weapon" | "ally",
  grantedGoAgain = false,
  targetAllyId?: number,
  fromArsenal = false,
  boosted = false,
  declaredAtNextId = state.nextInstanceId,
  fromBanish = false,
  fromOutsideHandOrArsenal = false,
): void {
  const link: ChainLinkState = {
    attacker: seat,
    attackingCard: card,
    attackCardType: cardType,
    defendingCards: [],
    defendingEquipment: [],
    reactions: [],
    goAgain: false,
    damage: 0,
    hit: false,
    resolved: false,
    declaredAtNextId,
    flags: {
      ...(fromArsenal ? { fromArsenal: true } : {}),
      ...(boosted ? { boosted: true } : {}),
      ...(grantedGoAgain ? { grantedGoAgainAtLayer: true } : {}),
      ...(fromBanish ? { fromBanish: true } : {}),
      ...(fromOutsideHandOrArsenal ? { fromOutsideHandOrArsenal: true } : {}),
    },
    ...takeDeclaredAttackTargets(state, seat, card, targetAllyId),
  };
  state.chain.push(link);
  // The attack-layer exists now, but the object does not become attacking
  // until that layer resolves and the Attack Step begins.
  queueSpectraLayer(state);
  runtime.dispatchFlow("enterAttackLayerWindow", state);
}

/** Resolve the attack-layer into the Attack Step. Only now does the object
 * become attacking and generate its attack-declared hooks and triggers. */
export function beginAttackStep(state: GameStateInternal, runtime: EngineRuntime): void {
  const link = currentLink(state);
  if (!link || link.flags.attackStepBegan === true) return;
  if (deferAttackLayerBehindQueue(state, runtime, link)) return;
  link.flags.attackStepBegan = true;
  const seat = link.attacker;
  const card = link.attackingCard;
  const cardType = link.attackCardType;
  const targetAllyId = link.targetAllyId;
  const grantedGoAgain = link.flags.grantedGoAgainAtLayer === true;
  delete link.flags.grantedGoAgainAtLayer;
  const player = state.players[seat] as PlayerState;
  player.flags.attacksDeclaredThisTurn =
    (Number(player.flags.attacksDeclaredThisTurn) || 0) + 1;
  for (const attackName of cardNameKeysOf(state, card)) {
    player.flags[`attackedName:${attackName}`] = true;
    player.flags[`attackedNameCount:${attackName}`] =
      (Number(player.flags[`attackedNameCount:${attackName}`]) || 0) + 1;
  }
  player.flags[`attackedInstance:${card.instanceId}`] =
    (Number(player.flags[`attackedInstance:${card.instanceId}`]) || 0) + 1;
  if (targetAllyId === undefined) player.flags.attackedHeroThisTurn = true;
  if (cardType === "weapon") {
    player.flags.attackedWithWeaponThisTurn = true;
    player.flags.weaponAttackCount = (Number(player.flags.weaponAttackCount) || 0) + 1;
  } else if (cardType === "action") {
    player.flags.attackedWithAttackActionThisTurn = true;
  }
  // go again the attack is declared with (keyword / modifiers / ability-granted);
  // must be read before next-attack modifiers attach (they change scope)
  const innateGoAgain = !goAgainSuppressed(state, seat) &&
    (grantedGoAgain || attackGoAgain(state, card, cardType));
  // types granted to the card for this play ("the next card you play is
  // Draconic") count on the resulting attack — stamped before next-attack
  // modifiers attach so type-filtered modifiers see them
  for (const t of card.grantedTypes ?? []) {
    link.flags[`grantedType:${t.toLowerCase()}`] = true;
  }
  const penaltyUntil = Number(player.hero.counters?.nextAttackPowerPenaltyUntilTurn || 0);
  const penalty = Number(player.hero.counters?.nextAttackPowerPenalty || 0);
  if (penalty > 0 && penaltyUntil === state.turn) {
    state.modifiers.push({
      id: state.nextModifierId++,
      sourceInstanceId: player.hero.instanceId,
      seat,
      scope: "chain-link",
      attack: -penalty,
    });
    (player.hero.counters ??= {}).nextAttackPowerPenalty = 0;
  }
  attachNextAttackModifiers(state, runtime, link);
  if (
    innateGoAgain ||
    conditionalModifierGrantsGoAgain(state, link, computeAttack(state, runtime, link)) ||
    conditionalScriptGrantsGoAgain(state, runtime, link)
  ) {
    runtime.events.grantLinkGoAgain(state, link);
  }
  const target = findAttackTargetAlly(state, seat, targetAllyId);
  const attack = computeAttack(state, runtime, link);
  const attackFallback = `${nameOf(state, player.heroCardId)} attacks with ${logNameOf(state, card.cardId)} (${attack} power)${target ? `, targeting ${nameOf(state, target.cardId)}` : ""}`;
  logPublic(state, gameLogMessage(
    attackFallback,
    target ? "engine.log.combat.attacks.targeting" : "engine.log.combat.attacks",
    {
      hero: logCardValue(player.heroCardId),
      card: logCardValue(card.cardId),
      attack,
      ...(target ? { target: logCardValue(target.cardId) } : {}),
    },
  ));
  // Sources created while players responded to the unresolved attack-layer
  // exist when the attack event occurs and are therefore valid observers.
  link.declaredAtNextId = state.nextInstanceId;
  // Snapshot observers before running hooks: an object created by a
  // declaration hook did not exist when the attack became attacking.
  const observers = observingHookSources(state, seat, {
    board: true,
    arsenal: true,
    equipment: true,
    weapons: true,
    heroLast: true,
  }).filter((source) => source.instanceId !== card.instanceId);

  runtime.events.runHook(state, seat, card, "onAttackDeclared", link);
  for (const source of [card, ...observers]) {
    runtime.events.runHook(state, seat, source, "onFriendlyAttackDeclared", link);
  }

  // A script may have paused declaration on a choice; resume via declareTail afterwards.
  if (state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume = { kind: "after-declare" };
    return;
  }
  declareTail(state, runtime);
}

/** Start an attack with a deck card without playing it. The caller's ability
 * has already paid its own cost and action point; ordinary attack-declared
 * processing still occurs because the object genuinely attacks. */
export function attackFromDeck(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  instanceId: number,
): boolean {
  const player = state.players[seat] as PlayerState;
  const index = player.deck.findIndex((card) => card.instanceId === instanceId);
  if (index < 0) return false;
  const card = player.deck[index] as CardInstance;
  const data = dataOf(state, card.cardId);
  if (data.cardType !== "action" || !(data.subtypes ?? []).includes("attack")) return false;
  player.deck.splice(index, 1);
  declareAttack(state, runtime, seat, card, "action");
  return true;
}

/** Whether a queued entry is an attack card waiting in the resolving zone,
 * rather than an attack by a weapon or ally that stays in the arena. */
function queuedAttackIsCard(queued: QueuedAttack): boolean {
  return queued.layer ? queued.layer.cardType === "action" : queued.cardOrigin !== undefined;
}

/** CR 5.3.1a: a resolved attack-card layer moves to the attack queue. The
 * card waits in the resolving zone and attacks after the current attack, in
 * queue order with effect-generated permanent attacks. */
export function queueAttackCard(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
  cardOrigin: CardPlayOrigin,
): void {
  if (!state.resolving.some((candidate) => candidate.instanceId === card.instanceId)) {
    state.resolving.push(card);
  }
  enqueueAttack(state.players[seat] as PlayerState, { instanceId: card.instanceId, cardOrigin });
  // The engine announces a played attack as its chain link at once, but its
  // attack-layer is still beneath every layer played in its Layer Step. An
  // attack resolving from above it reaches the queue first (CR 7.1.2a).
  const link = currentLink(state);
  if (
    link &&
    link.attacker === seat &&
    state.stackResume === "start-attack-step"
  ) {
    link.flags[ATTACKS_QUEUED_ABOVE_LAYER] = true;
  }
  logAttackQueued(state, card);
}

function logAttackQueued(state: GameStateInternal, card: CardInstance): void {
  logPublic(state, gameLogMessage(
    `${nameOf(state, card.cardId)} is put into the attack queue`,
    "engine.log.attack.queued",
    { card: logCardValue(card.cardId) },
  ));
}

/** CR 7.1.2a / 7.2.2: when an attack-layer resolves after attacks played
 * above it, it joins the attack queue behind them and the queue's first
 * attack becomes the chain link instead. */
function deferAttackLayerBehindQueue(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
): boolean {
  if (link.flags[ATTACKS_QUEUED_ABOVE_LAYER] !== true) return false;
  delete link.flags[ATTACKS_QUEUED_ABOVE_LAYER];
  state.chain.pop();
  const card = link.attackingCard;
  if (link.attackCardType === "action") state.resolving.push(card);
  // The queue keeps only the primary target; the card carries the rest.
  if (link.additionalTargetAllyIds) {
    card.attackTargetIds = [
      link.targetAllyId ?? (state.players[opponent(link.attacker)] as PlayerState).hero.instanceId,
      ...link.additionalTargetAllyIds,
    ];
  }
  enqueueAttack(state.players[link.attacker] as PlayerState, {
    instanceId: card.instanceId,
    ...(link.targetAllyId !== undefined ? { targetAllyId: link.targetAllyId } : {}),
    layer: { cardType: link.attackCardType, flags: link.flags },
  });
  logAttackQueued(state, card);
  return runtime.dispatchFlow("startNextQueuedAttack", state, link.attacker);
}

/** CR 7.7.3: attack cards still queued when the combat chain closes are
 * cleared to their owners' graveyards, as are held-back attack-layers.
 * Queued effect-generated permanent attacks keep their existing order. */
export function clearAttackQueue(state: GameStateInternal, runtime: EngineRuntime): void {
  for (const player of state.players as PlayerState[]) {
    const kept: QueuedAttack[] = [];
    for (let queued = dequeueAttack(player); queued; queued = dequeueAttack(player)) {
      if (!queuedAttackIsCard(queued)) {
        if (!queued.layer) kept.push(queued);
        continue;
      }
      const card = state.resolving.find((candidate) => candidate.instanceId === queued.instanceId);
      if (!card) continue;
      removeFromArray(state.resolving, card.instanceId);
      delete card.attackTargetIds;
      runtime.commands.moveToGraveyard(state, card, "stack");
    }
    for (const entry of kept) enqueueAttack(player, entry);
  }
}

/** Move the next queued attack onto the combat chain: an effect-generated
 * permanent attack, an attack card played at instant speed, or a held-back
 * attack-layer. Invalid attacks are cleared and the next queued attack is
 * tried, matching CR 7.2.2c. */
export function startNextQueuedAttack(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
): boolean {
  const player = state.players[seat] as PlayerState;
  for (let queued = dequeueAttack(player); queued; queued = dequeueAttack(player)) {
    if (queuedAttackIsCard(queued)) {
      const card = state.resolving.find((candidate) => candidate.instanceId === queued.instanceId);
      if (!card) continue;
      removeFromArray(state.resolving, card.instanceId);
      if (!attackTargetIsLegal(state, runtime, seat, queued.targetAllyId)) {
        delete card.attackTargetIds;
        runtime.commands.moveToGraveyard(state, card, "stack");
        continue;
      }
      const origin = queued.cardOrigin;
      startQueuedAttack(state, runtime, seat, card, queued.targetAllyId, queued.layer ?? {
        cardType: "action",
        flags: {
          ...(origin === "arsenal" ? { fromArsenal: true } : {}),
          ...(origin === "banish" ? { fromBanish: true } : {}),
          ...(origin !== "hand" && origin !== "arsenal" ? { fromOutsideHandOrArsenal: true } : {}),
        },
      });
      return true;
    }
    const weapon = player.weapons.find((card) => card.instanceId === queued.instanceId);
    const ally = player.board.find((card) =>
      card.instanceId === queued.instanceId && cardTypesOf(state, card).includes("ally")
    );
    const card = weapon ?? ally;
    if (
      !card ||
      player.flags[`cannotAttackInstance:${queued.instanceId}`] === true ||
      (weapon !== undefined && weaponAttacksProhibited(player)) ||
      !attackTargetIsLegal(state, runtime, seat, queued.targetAllyId)
    ) continue;
    if (queued.layer) {
      startQueuedAttack(state, runtime, seat, card, queued.targetAllyId, queued.layer);
      return true;
    }
    // An effect-generated attack waited here as an unresolved attack-layer
    // (CR 8.5.38), so its Layer Step still opens now.
    declareAttack(state, runtime, seat, card, weapon ? "weapon" : "ally", false, queued.targetAllyId);
    return true;
  }
  return false;
}

/** CR 7.2.2: a queued attack whose layer already resolved (a card played at
 * instant speed, or a held-back attack-layer) moves onto the combat chain and
 * becomes attacking at once; no Layer Step window opens for it again. A
 * held-back attack-layer keeps the flags recorded when it was played. */
function startQueuedAttack(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  targetAllyId: number | undefined,
  layer: DeferredAttackLayer,
): void {
  state.chain.push({
    attacker: seat,
    attackingCard: card,
    attackCardType: layer.cardType,
    defendingCards: [],
    defendingEquipment: [],
    reactions: [],
    goAgain: false,
    damage: 0,
    hit: false,
    resolved: false,
    declaredAtNextId: state.nextInstanceId,
    flags: layer.flags,
    ...takeDeclaredAttackTargets(state, seat, card, targetAllyId),
  });
  queueSpectraLayer(state);
  // Enter the Attack Step exactly as a resolved attack-layer does: the open
  // priority window and its stack continuation are finished.
  state.phase = "layer";
  state.stackResume = null;
  if (!state.pendingDecision?.chooseHook) state.pendingDecision = null;
  runtime.dispatchFlow("beginAttackStep", state);
}

/** Generate an effect-driven attack with a controlled weapon or ally. The
 * effect, rather than an activated ability, supplies the attack and pays no
 * printed activation costs or action point. Attack-layers generated during
 * combat wait until the active chain link has resolved (CR 8.5.38 / 7.6.3b). */
export function attackWithPermanent(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  instanceId: number,
  targetAllyId?: number,
  targetDeclared = false,
): boolean {
  const player = state.players[seat] as PlayerState;
  const weapon = player.weapons.find((card) => card.instanceId === instanceId);
  const ally = player.board.find((card) =>
    card.instanceId === instanceId && cardTypesOf(state, card).includes("ally")
  );
  const card = weapon ?? ally;
  if (
    !card ||
    player.flags[`cannotAttackInstance:${instanceId}`] === true ||
    (weapon !== undefined && weaponAttacksProhibited(player))
  ) return false;

  if (!targetDeclared) {
    const mandatory = mandatoryAttackTargets(state, runtime, seat);
    const permanents = mandatory.length > 0
      ? mandatory
      : attackablePermanents(state, opponent(seat));
    const options = [
      ...(mandatory.length === 0 ? ["opposing hero"] : []),
      ...permanents.map((target) => String(target.instanceId)),
    ];
    if (options.length > 1) {
      const opposingHero = (state.players[opponent(seat)] as PlayerState).hero;
      state.pendingDecision = {
        player: seat,
        kind: "choose-target",
        prompt: `${nameOf(state, card.cardId)}: choose an attack target`,
        promptMessage: {
          id: "engine.decision.attack.target",
          values: { card: { kind: "card", cardId: card.cardId } },
        },
        options,
        cardOptions: [
          ...(mandatory.length === 0 ? [opposingHero.instanceId] : []),
          ...permanents.map((target) => target.instanceId),
        ],
        sourceInstanceId: instanceId,
        chooseHook: "engine-effect-attack-target",
      };
      return true;
    }
    targetAllyId = mandatory[0]?.instanceId;
  }

  if (!attackTargetIsLegal(state, runtime, seat, targetAllyId)) return false;
  if (state.stack.length > 0 || state.resolving.length > 0 || currentLink(state)) {
    enqueueAttack(player, { instanceId, ...(targetAllyId !== undefined ? { targetAllyId } : {}) });
    return true;
  }
  declareAttack(state, runtime, seat, card, weapon ? "weapon" : "ally", false, targetAllyId);
  return true;
}

/** Uzuri-style active-link replacement. Both zone moves validate before
 * either occurs, making the swap atomic. The replacement was neither played
 * nor declared as an attacker, so those event hooks deliberately do not run. */
export function replaceAttackFromHand(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  instanceId: number,
  maximumCost: number,
): boolean {
  return replaceAttackFromPlayerZone(state, runtime, seat, instanceId, maximumCost, "hand");
}

/** Uzuri-style active-link replacement using the face-up card paid as the
 * ability's banish cost. */
export function replaceAttackFromBanish(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  instanceId: number,
  maximumCost: number,
): boolean {
  return replaceAttackFromPlayerZone(state, runtime, seat, instanceId, maximumCost, "banish");
}

function replaceAttackFromPlayerZone(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  instanceId: number,
  maximumCost: number,
  from: "hand" | "banish",
): boolean {
  const link = currentLink(state);
  const player = state.players[seat] as PlayerState;
  if (!link || link.attacker !== seat || link.flags.attackGone === true) return false;
  const source = player[from];
  const index = source.findIndex((card) => card.instanceId === instanceId);
  if (index < 0) return false;
  const replacement = source[index] as CardInstance;
  const replacementData = dataOf(state, replacement.cardId);
  if (
    replacement.faceDown === true ||
    replacementData.cardType !== "action" ||
    !(replacementData.subtypes ?? []).includes("attack") ||
    (replacementData.cost ?? 0) > maximumCost
  ) return false;
  const previous = link.attackingCard;
  const previousCardType = link.attackCardType;
  const previousIsToken = cardHasType(state, previous, "token");
  const previousIsInArena = previousCardType === "action" ||
    player.weapons.some((card) => card.instanceId === previous.instanceId) ||
    player.board.some((card) => card.instanceId === previous.instanceId);
  if (!previousIsInArena) return false;
  source.splice(index, 1);
  link.attackingCard = replacement;
  link.attackCardType = "action";
  if (previousCardType === "action") {
    const previousOwner = state.players[previous.owner] as PlayerState;
    clearTemporaryObjectEffects(previous);
    previousOwner.deck.push(previous);
    runtime.transitions.move(
      previous,
      transitionZone("chain", previousOwner.seat),
      transitionZone("deck", previousOwner.seat, "bottom"),
      { to: true },
    );
    runtime.commands.fireLeaveCombatChain(state, seat, previous, "attacking");
  } else {
    runtime.commands.putCardOnDeckBottom(state, previous.instanceId);
  }
  runtime.transitions.move(
    replacement,
    transitionZone(from, player.seat),
    transitionZone("chain", player.seat),
    { from: true },
  );
  if (instanceHasKeyword(state, replacement, "go again")) runtime.events.grantLinkGoAgain(state, link);
  if (!previousIsToken) {
    logPublic(
      state,
      gameLogMessage(
        `${nameOf(state, previous.cardId)} is put on the bottom of its owner's deck and replaced by ${nameOf(state, replacement.cardId)} as the attacking card`,
        "engine.log.combat.attacker.replaced",
        {
          previous: logCardValue(previous.cardId),
          replacement: logCardValue(replacement.cardId),
        },
      ),
    );
  }
  return true;
}

/** Tail of the attack event: attack-declared triggers, then Attack Step priority. */
export function declareTail(state: GameStateInternal, runtime: EngineRuntime): void {
  runtime.dispatchFlow("enterAttackWindow", state);
}

/** Opposing board permanents an attack may target: living allies (CR 8.2.8d)
 * and nonliving objects whose Spectra keyword permits attacks (8.3.14a). */
export function attackablePermanents(state: GameStateInternal, defenderSeat: number): CardInstance[] {
  const p = state.players[defenderSeat] as PlayerState;
  return p.board.filter((c) => {
    const data = dataOf(state, c.cardId);
    const livingAlly = cardTypesOf(state, c).includes("ally") &&
      (data.life !== undefined || c.temporaryAlly !== undefined);
    return livingAlly || (!c.faceDown && instanceHasKeyword(state, c, "spectra"));
  });
}

/** Mandatory non-hero targets among the otherwise attackable permanents. */
export function mandatoryAttackTargets(state: GameStateInternal,
  runtime: EngineRuntime, attackerSeat: number): CardInstance[] {
  const defenderSeat = opponent(attackerSeat);
  return attackablePermanents(state, defenderSeat).filter((card) => {
    const requirement = scriptOf(state, card.cardId, card)?.mandatoryAttackTarget;
    return requirement === true ||
      (typeof requirement === "function" && requirement(runtime.makeCtx(state, defenderSeat, card)));
  });
}

/** Authoritative target validation, including effects that prohibit choosing
 * the defending hero while a mandatory permanent target exists. */
export function attackTargetIsLegal(
  state: GameStateInternal,
  runtime: EngineRuntime,
  attackerSeat: number,
  targetAllyId?: number,
): boolean {
  const mandatory = mandatoryAttackTargets(state, runtime, attackerSeat);
  if (mandatory.length > 0) {
    return targetAllyId !== undefined && mandatory.some((card) => card.instanceId === targetAllyId);
  }
  return targetAllyId === undefined || !!findAttackTargetAlly(state, attackerSeat, targetAllyId);
}

/** The non-hero object an attack targets. The function retains its original
 *  name because targetAllyId is a stable wire field. */
function findAttackTargetAlly(
  state: GameStateInternal,
  attackerSeat: number,
  targetAllyId?: number,
): CardInstance | undefined {
  if (targetAllyId === undefined) return undefined;
  return attackablePermanents(state, opponent(attackerSeat)).find(
    (c) => c.instanceId === targetAllyId,
  );
}

/** Consume the targets declared while the card was played (CR 1.4.5c) as
 *  chain-link fields. A hero among them is the primary target, so defenders
 *  keep answering that hero. */
function takeDeclaredAttackTargets(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
  targetAllyId: number | undefined,
): Pick<ChainLinkState, "targetAllyId" | "additionalTargetAllyIds"> {
  const declared = card.attackTargetIds;
  delete card.attackTargetIds;
  if (!declared || declared.length < 2) return targetAllyId === undefined ? {} : { targetAllyId };
  const heroId = (state.players[opponent(seat)] as PlayerState).hero.instanceId;
  const allies = declared.filter((id) => id !== heroId);
  const primary = declared.includes(heroId) ? undefined : allies.shift();
  return {
    ...(primary === undefined ? {} : { targetAllyId: primary }),
    ...(allies.length > 0 ? { additionalTargetAllyIds: allies } : {}),
  };
}

/** The attack action card with this instance id while it is being played. */
function cardBeingPlayed(state: GameStateInternal, instanceId: number): CardInstance | undefined {
  return state.resolving.find((card) =>
    card.instanceId === instanceId && card.attackTargetIds !== undefined
  );
}

/** Objects that may become an additional attack-target of the attack action
 *  card being played: each must be separate from the targets already
 *  declared and legal to declare (CR 1.4.5c). Hero targets are hero ids. */
export function additionalAttackTargetOptions(
  state: GameStateInternal,
  seat: number,
  instanceId: number,
): number[] {
  const declared = cardBeingPlayed(state, instanceId)?.attackTargetIds;
  if (!declared) return [];
  const defender = state.players[opponent(seat)] as PlayerState;
  return [defender.hero, ...attackablePermanents(state, defender.seat)]
    .map((card) => card.instanceId)
    .filter((id) => !declared.includes(id));
}

/** Declare an additional attack-target for the attack action card being
 *  played. Returns false when the target is not a legal additional target. */
export function declareAdditionalAttackTarget(
  state: GameStateInternal,
  seat: number,
  instanceId: number,
  targetInstanceId: number,
): boolean {
  const card = cardBeingPlayed(state, instanceId);
  if (!card || !additionalAttackTargetOptions(state, seat, instanceId).includes(targetInstanceId)) {
    return false;
  }
  card.attackTargetIds!.push(targetInstanceId);
  const defender = state.players[opponent(seat)] as PlayerState;
  const target = defender.hero.instanceId === targetInstanceId
    ? defender.hero
    : defender.board.find((candidate) => candidate.instanceId === targetInstanceId)!;
  logPublic(state, gameLogMessage(
    `${logNameOf(state, card.cardId)} attacks an additional target: ${nameOf(state, target.cardId)}`,
    "engine.log.combat.additional.target",
    { card: logCardValue(card.cardId), target: logCardValue(target.cardId) },
  ));
  return true;
}

/** Spectra (8.3.14): becoming an attack target creates a mandatory triggered
 *  layer. It is queued before the generic attack-declared layers so all of
 *  them resolve before the attack can advance to the attack step. */
function queueSpectraLayer(state: GameStateInternal): void {
  const link = currentLink(state);
  if (!link) return;
  const targetIds = [
    ...(link.targetAllyId === undefined ? [] : [link.targetAllyId]),
    ...(link.additionalTargetAllyIds ?? []),
  ];
  for (const targetId of targetIds) queueSpectraLayerFor(state, link, targetId);
}

function queueSpectraLayerFor(state: GameStateInternal, link: ChainLinkState, targetId: number): void {
  const target = findAttackTargetAlly(state, link.attacker, targetId);
  if (!target || !instanceHasKeyword(state, target, "spectra")) return;
  state.stack.push({
    sourceInstanceId: target.instanceId,
    seat: target.owner,
    triggerIndex: -4,
    label: "Spectra — destroy this",
    optional: false,
    engineEffect: { kind: "spectra-destroy" },
  });
  logPublic(state, gameLogMessage(
    `${nameOf(state, target.cardId)} triggers Spectra`,
    "engine.log.trigger.spectra",
    { card: logCardValue(target.cardId) },
  ));
}
