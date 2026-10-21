import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import { cardTypesOf, scriptOf } from "./cardProperties.js";

import { activeModifiers, modifierApplies } from "./combatModifiers.js";
import {
  computeAttack,
  computeCombatDamage,
  computeDefense,
  equipmentDefense,
} from "./combatValues.js";
import {
  gameLogMessage,
  logCardValue,
  logPlayerValue,
  logPublic,
  nameOf,
} from "./gameLog.js";

import { recordAttackStats, recordHeroDamage } from "./stats.js";
import type { AdditionalTargetHit, ChainLinkState, PendingArcane, PlayerState } from "./state.js";

import { tokenCreationCauseForModifier } from "./tokenQueries.js";
import { createTokensFor } from "./tokens.js";
import {
  additionalTargetsAroundPrimary,
  currentLink,
  findCardAnywhere,
  isPermanentSource,
  opponent,
  orderedAttackTargetIds,
} from "./zoneQueries.js";
import { destroyPermanent } from "./zoneMoves.js";
import { hookSources, lingeringModifierSources } from "./sourceQueries.js";

import { removeMarkOnOpponentHit } from "./ruleQueries.js";

/** A suppressed hit still counts as the occurrence for ordinal and once-per-
 * turn trigger limits (CR 6.6.5f), but none of the trigger effects are put on
 * the stack. Scripts use the observer solely to stamp those limits. */
function dispatchSuppressedHitObservers(state: GameStateInternal,
  runtime: EngineRuntime, link: ChainLinkState): void {
  const attacker = state.players[link.attacker] as PlayerState;
  runtime.events.runHook(state, link.attacker, link.attackingCard, "onSuppressedHit", link);
  runtime.events.runHook(state, link.attacker, attacker.hero, "onSuppressedHit", link);
  for (const src of hookSources(state, link.attacker, { board: true, arsenal: true, equipment: true })) {
    if (src.instanceId === attacker.hero.instanceId) continue;
    runtime.events.runHook(state, link.attacker, src, "onSuppressedHit", link);
  }
}

/** Record that the link's attack hit this turn, as `hitType:<class/subtype>`
 * flags on the attacking player, so "if a <subtype> has hit this turn" checks
 * also see hits from before their source entered the arena. */
function recordAttackHit(state: GameStateInternal, link: ChainLinkState): void {
  const attacker = state.players[link.attacker] as PlayerState;
  const live = findCardAnywhere(state, link.attackingCard.instanceId)?.card ?? link.attackingCard;
  for (const type of cardTypesOf(state, live)) attacker.flags[`hitType:${type}`] = true;
}

function applyHit(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  targetSeat = opponent(link.attacker),
): boolean {
  const defender = state.players[targetSeat] as PlayerState;
  const hitOriginalTarget = targetSeat === opponent(link.attacker);
  defender.life -= link.damage;
  if (link.damage > 0) defender.flags.lostLifeThisTurn = true;
  recordHeroDamage(state, link.attacker, link.damage);
  logPublic(
    state,
    gameLogMessage(
      `${nameOf(state, link.attackingCard.cardId)} ${hitOriginalTarget ? "hits" : "deals redirected damage"} for ${link.damage} (${nameOf(state, defender.heroCardId)} at ${defender.life} life)`,
      hitOriginalTarget ? "engine.log.damage.hit" : "engine.log.damage.redirected",
      {
        source: logCardValue(link.attackingCard.cardId),
        amount: link.damage,
        target: logPlayerValue(defender.seat),
        life: defender.life,
      },
      {
        kind: "damage",
        targetSeat: defender.seat,
        amount: link.damage,
        damageType: "physical",
        sourceCardId: link.attackingCard.cardId,
      },
    ),
  );
  if (hitOriginalTarget) recordAttackHit(state, link);
  if (hitOriginalTarget && removeMarkOnOpponentHit(state, link.attacker, defender.seat)) {
    // Hit-triggered effects still observe that their target was marked at the
    // moment of the event even though the condition has already been removed.
    link.flags.targetWasMarkedOnHit = true;
  }
  const attacker = state.players[link.attacker] as PlayerState;
  attacker.flags.dealtDamageThisTurn = true;
  attacker.flags.physicalDamageDealtThisTurn = true;
  attacker.flags.physicalDamageAmountDealtThisTurn =
    (Number(attacker.flags.physicalDamageAmountDealtThisTurn) || 0) + link.damage;
  defender.flags.damageTakenThisTurn = true;
  defender.flags.physicalDamageTakenThisTurn = true;
  runtime.events.fireHeroDealtDamage(state, defender.seat, link.damage, false);
  runtime.events.queueDamageDealt(state, link.attackingCard, {
    sourceSeat: link.attacker,
    targetSeat: defender.seat,
    amount: link.damage,
    arcane: false,
    combat: true,
    byController: link.attackCardType !== "ally",
  });
  const activeDamageSources = hookSources(state, link.attacker, {
    board: true,
    equipment: true,
    weapons: true,
  });
  const combatDamageSources = [
    ...activeDamageSources,
    ...lingeringModifierSources(state, link.attacker).filter(
      (candidate) => !activeDamageSources.some((source) => source.instanceId === candidate.instanceId),
    ),
  ];
  for (const source of combatDamageSources) {
    scriptOf(state, source.cardId, source)?.onFriendlyCombatDamageDealt?.(
      runtime.makeCtx(state, link.attacker, source, link),
      link.attackingCard,
      defender.seat,
      link.damage,
    );
  }
  const damageSource = findCardAnywhere(state, link.attackingCard.instanceId)?.card ?? link.attackingCard;
  scriptOf(state, damageSource.cardId, damageSource)?.onDealsDamage?.(
    runtime.makeCtx(state, link.attacker, damageSource, link),
    defender.seat,
    link.damage,
    false,
  );
  for (const modifier of activeModifiers(state, link, ["chain-link"])) {
    const tokenId = modifier.onDamageDealtCreateTokenPerPoint;
    if (!tokenId || link.damage <= 0 || link.targetAllyId !== undefined) continue;
    createTokensFor(
      state, runtime,
      defender,
      tokenId,
      link.damage,
      tokenCreationCauseForModifier(state, modifier),
    );
  }
  dealAdditionalTargetDamageAfterPrimary(state, runtime, link);
  if (damageSource.life !== undefined && damageSource.life <= 0) {
    destroyPermanent(state, runtime, link.attacker, damageSource);
  }
  if (!hitOriginalTarget) return missPrimaryTarget(state, runtime, link);
  return queueAttackHitEffects(state, runtime, link);
}

/** Queue the attack's hit triggers unless its hit effects are suppressed.
 * `primaryHit` is false when only additional targets were hit. */
function queueAttackHitEffects(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  primaryHit = true,
): boolean {
  const delayedSuppression = state.modifiers.find(
    (modifier) =>
      modifier.scope === "until-end-of-turn" &&
      modifier.suppressHitEffects === true &&
      !modifier.consumed &&
      modifierApplies(state, modifier, link),
  );
  if (delayedSuppression) delayedSuppression.consumed = true;
  const turnSuppression = state.modifiers.some(
    (modifier) =>
      modifier.scope === "until-end-of-turn" &&
      modifier.suppressHitEffectsThisTurn === true &&
      modifierApplies(state, modifier, link),
  );
  if (
    link.flags.suppressHitEffects === true ||
    delayedSuppression ||
    turnSuppression ||
    (link.attackCardType === "action" && state.players.some((player) =>
      hookSources(state, player.seat, { board: true, equipment: true, weapons: true, heroLast: true })
        .some((source) => scriptOf(state, source.cardId, source)?.suppressesAttackActionHitEffects === true)
    ))
  ) {
    dispatchSuppressedHitObservers(state, runtime, link);
    logPublic(state, gameLogMessage(
      `${nameOf(state, link.attackingCard.cardId)}'s hit effects are suppressed`,
      "engine.log.combat.hit.effects.suppressed",
      { card: logCardValue(link.attackingCard.cardId) },
    ));
  } else {
    return runtime.dispatchFlow("queueHitTriggers", state, link, primaryHit);
  }
  return false;
}

/** The primary attack-target was not hit. The attack has still hit when an
 * additional target was (CR 7.5.5), so its hit triggers replace on-miss. */
function missPrimaryTarget(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
): boolean {
  if ((link.additionalTargetHits?.length ?? 0) > 0) {
    return queueAttackHitEffects(state, runtime, link, false);
  }
  runtime.events.runHook(state, link.attacker, link.attackingCard, "onMiss", link);
  return false;
}

/** Attack-targets still in the arena that the attacker has not yet ordered
 * for combat damage. */
function unorderedLiveAttackTargets(state: GameStateInternal, link: ChainLinkState): number[] {
  const defender = state.players[opponent(link.attacker)] as PlayerState;
  const ordered = link.attackTargetDamageOrder ?? [];
  return orderedAttackTargetIds(state, link).filter((id) =>
    !ordered.includes(id) &&
    (id === defender.hero.instanceId || defender.board.some((card) => card.instanceId === id))
  );
}

/** Damage is dealt separately to each attack-target, and the controller of
 * the attack orders targets controlled by the same player (CR 7.5.2c). Ask
 * for the next target while two or more remain unordered. */
function openAttackTargetOrderDecision(state: GameStateInternal, link: ChainLinkState): boolean {
  const remaining = unorderedLiveAttackTargets(state, link);
  if (remaining.length < 2) return false;
  const first = (link.attackTargetDamageOrder?.length ?? 0) === 0;
  state.pendingDecision = {
    player: link.attacker,
    kind: "choose-target",
    prompt: first
      ? "Choose the attack-target to deal combat damage to first"
      : "Choose the next attack-target to deal combat damage to",
    promptMessage: {
      id: first ? "engine.decision.combat.damage.order.first" : "engine.decision.combat.damage.order.next",
    },
    options: remaining.map(String),
    cardOptions: remaining,
    defaultOption: String(remaining[0]),
    chooseHook: "engine-combat-damage-order",
  };
  return true;
}

export function answerAttackTargetDamageOrder(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pending = state.pendingDecision;
  const link = currentLink(state);
  if (
    !pending ||
    !link ||
    pending.player !== seat ||
    pending.chooseHook !== "engine-combat-damage-order"
  ) return "not your decision";
  const targetId = Number(optionId);
  if (!pending.options?.includes(optionId) || !Number.isSafeInteger(targetId)) return "invalid option";
  link.attackTargetDamageOrder = [...(link.attackTargetDamageOrder ?? []), targetId];
  state.pendingDecision = null;
  resolveLink(state, runtime);
  return undefined;
}

/** Deal combat damage to these additional attack-targets, in order and
 * separately (CR 7.5.2c). They cannot be defended, and one that has ceased to
 * exist is dealt nothing (CR 7.5.2b). Their hit-events are kept for the hit
 * triggers queued with the primary target's. */
function dealAdditionalTargetDamage(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  targetAllyIds: readonly number[],
): void {
  if (targetAllyIds.length === 0) return;
  const defenderPlayer = state.players[opponent(link.attacker)] as PlayerState;
  const attack = computeAttack(state, runtime, link);
  const hits: AdditionalTargetHit[] = [];
  for (const targetAllyId of targetAllyIds) {
    const target = defenderPlayer.board.find((card) => card.instanceId === targetAllyId);
    if (!target) {
      logPublic(state, gameLogMessage(
        `${nameOf(state, link.attackingCard.cardId)} finds no target (the ally is gone)`,
        "engine.log.combat.no.target.ally.gone",
        { card: logCardValue(link.attackingCard.cardId) },
      ));
      continue;
    }
    const dealt = runtime.dispatchFlow<number>("dealAllyDamage", state, {
      sourceInstanceId: link.attackingCard.instanceId,
      sourceSeat: link.attacker,
      sourceIsAlly: link.attackCardType === "ally" || undefined,
      targetSeat: defenderPlayer.seat,
      targetAllyId,
      amount: computeCombatDamage(state, runtime, link, attack, 0),
      arcane: false,
      combat: true,
    });
    if (dealt > 0) {
      hits.push({ targetAllyId, damage: dealt });
      link.hit = true;
      recordAttackHit(state, link);
    } else {
      logPublic(state, gameLogMessage(
        `${nameOf(state, link.attackingCard.cardId)} deals no damage to ${nameOf(state, target.cardId)}`,
        "engine.log.damage.none.to.ally",
        {
          source: logCardValue(link.attackingCard.cardId),
          target: logCardValue(target.cardId),
        },
      ));
    }
  }
  if (hits.length > 0) link.additionalTargetHits = [...(link.additionalTargetHits ?? []), ...hits];
}

/** Deal damage to the additional attack-targets ordered after the primary
 * target, once the primary target's damage has been dealt. */
function dealAdditionalTargetDamageAfterPrimary(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
): void {
  dealAdditionalTargetDamage(state, runtime, link, additionalTargetsAroundPrimary(state, link).after);
}

/** Deal the link's remaining combat damage to the defending hero: hit hooks
 *  on damage, on-miss hook otherwise. */
function applyCombatDamage(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  damage: number,
  targetSeat = opponent(link.attacker),
): boolean {
  link.damage = damage;
  // Effects such as Flick Knives can make the active chain link hit during
  // the Reaction Step even when the attack itself is fully defended. Preserve
  // that aggregate result while resolving the attack's combat damage.
  link.hit ||= damage > 0 && targetSeat === opponent(link.attacker);
  if (damage > 0) {
    return applyHit(state, runtime, link, targetSeat);
  } else {
    logPublic(state, gameLogMessage(
      `${nameOf(state, link.attackingCard.cardId)} is fully defended`,
      "engine.log.combat.fully.defended",
      { card: logCardValue(link.attackingCard.cardId) },
    ));
    dealAdditionalTargetDamageAfterPrimary(state, runtime, link);
    return missPrimaryTarget(state, runtime, link);
  }
}

/** Ward answers for a combat-damage packet are done (util.ts damage flow):
 *  apply the remaining damage and finish the paused chain-link resolution. */
export function resumeCombatDamage(state: GameStateInternal,
  runtime: EngineRuntime, packet: PendingArcane): void {
  const link = currentLink(state);
  if (!link) return;
  const waitingOnHitTriggers = applyCombatDamage(state, runtime, link, packet.amount, packet.targetSeat);
  if (!waitingOnHitTriggers) runtime.dispatchFlow("finishDamageStep", state);
}

/** Is the attacking permanent still in the arena? An attack whose source left
 *  the arena mid-combat (a ward aura or ally destroyed at instant speed during
 *  the attack or reaction window) fails to resolve: no damage is dealt and go
 *  again is not refunded. Played action cards ride the chain itself and always
 *  resolve. */
function attackSourceInArena(state: GameStateInternal, link: ChainLinkState): boolean {
  if (link.attackCardType === "action") return true;
  const attacker = state.players[link.attacker] as PlayerState;
  return isPermanentSource(attacker, link.attackingCard.instanceId);
}

export function resolveLink(state: GameStateInternal, runtime: EngineRuntime): void {
  const link = currentLink(state);
  if (!link) return;
  if (link.flags.attackGone === true) {
    logPublic(state, gameLogMessage(
      `${nameOf(state, link.attackingCard.cardId)} fails to resolve (the attack left the combat chain)`,
      "engine.log.combat.resolve.failed.left.chain",
      { card: logCardValue(link.attackingCard.cardId) },
    ));
    link.damage = 0;
    link.hit = false;
    link.goAgain = false;
    link.resolved = true;
    state.modifiers = state.modifiers.filter((modifier) => modifier.scope !== "chain-link");
    runtime.dispatchFlow("closeChain", state);
    // Layers still on the stack (such as defend triggers) resolve after the
    // Close Step; the combat step they were queued to continue no longer exists.
    if (
      state.stackResume === "start-attack-step" ||
      state.stackResume === "continue-attack" ||
      state.stackResume === "start-reaction-step" ||
      state.stackResume === "finish-link-resolution"
    ) state.stackResume = "begin-action";
    state.reactionPasses = 0;
    if (!state.pendingDecision?.chooseHook) state.pendingDecision = null;
    state.phase = "action";
    state.priorityPlayer = state.activePlayer;
    return;
  }
  if (!attackSourceInArena(state, link)) {
    logPublic(state, gameLogMessage(
      `${nameOf(state, link.attackingCard.cardId)} fails to resolve (its source left the arena)`,
      "engine.log.combat.resolve.failed.source.left.arena",
      { card: logCardValue(link.attackingCard.cardId) },
    ));
    link.damage = 0;
    link.hit = false;
    link.goAgain = false; // no refund — the attack never resolved
    runtime.dispatchFlow("finishLinkResolution", state, link);
    return;
  }
  if (openAttackTargetOrderDecision(state, link)) return;
  // Once combat damage is being calculated, CR 7.7.2c no longer closes the
  // chain merely because the active attack later ceases to exist. This also
  // distinguishes the Damage Step priority point from pre-damage windows.
  link.flags.combatDamageCalculated = true;
  const defenderPlayer = state.players[opponent(link.attacker)] as PlayerState;
  const attack = computeAttack(state, runtime, link);
  const defense = computeDefense(state, runtime, link);
  const damageScript = scriptOf(state, link.attackingCard.cardId, link.attackingCard);
  const damage = computeCombatDamage(state, runtime, link, attack, defense);
  const { before, after } = additionalTargetsAroundPrimary(state, link);
  dealAdditionalTargetDamage(state, runtime, link, before);
  if (link.targetAllyId !== undefined) {
    // Ally target (CR 8.2.8d/e/f): the attack could not be defended, damage
    // is dealt to the ally (the hero's prevention shields do not soak it, the
    // controller is not considered to have been dealt damage). Unqualified
    // on-hit hooks still fire; scripts whose text says "hits a hero" filter
    // out links with targetAllyId.
    const targetAlly = defenderPlayer.board.find((c) => c.instanceId === link.targetAllyId);
    if (!targetAlly) {
      logPublic(state, gameLogMessage(
        `${nameOf(state, link.attackingCard.cardId)} finds no target (the ally is gone)`,
        "engine.log.combat.no.target.ally.gone",
        { card: logCardValue(link.attackingCard.cardId) },
      ));
      link.damage = 0;
      dealAdditionalTargetDamage(state, runtime, link, after);
      if ((link.additionalTargetHits?.length ?? 0) > 0) {
        link.hit = true;
        if (queueAttackHitEffects(state, runtime, link, false)) return;
      }
    } else {
      const dealt = runtime.dispatchFlow("dealAllyDamage", state, {
        sourceInstanceId: link.attackingCard.instanceId,
        sourceSeat: link.attacker,
        sourceIsAlly: link.attackCardType === "ally" || undefined,
        targetSeat: defenderPlayer.seat,
        targetAllyId: targetAlly.instanceId,
        amount: damage,
        arcane: false,
        combat: true,
      });
      link.damage = dealt;
      dealAdditionalTargetDamage(state, runtime, link, after);
      link.hit = dealt > 0 || (link.additionalTargetHits?.length ?? 0) > 0;
      if (dealt > 0) {
        recordAttackHit(state, link);
        if (runtime.dispatchFlow("queueHitTriggers", state, link)) return;
      } else {
        logPublic(state, gameLogMessage(
          `${nameOf(state, link.attackingCard.cardId)} deals no damage to ${nameOf(state, targetAlly.cardId)}`,
          "engine.log.damage.none.to.ally",
          {
            source: logCardValue(link.attackingCard.cardId),
            target: logCardValue(targetAlly.cardId),
          },
        ));
        if (missPrimaryTarget(state, runtime, link)) return;
      }
    }
  } else {
    recordAttackStats(
      state,
      link.attacker,
      defenderPlayer.seat,
      Math.min(attack, defense) + damage,
      Math.min(attack, defense),
    );
    // "damage that would be dealt by this can't be prevented": ordinary
    // shields remain untouched, while prevention replacements still apply so
    // their costs and additional modifications happen (CR 6.4.10h).
    const threshold = damageScript?.combatDamageUnpreventableAtLeast;
    const unpreventable = link.flags.unpreventable === true ||
      activeModifiers(state, link, ["chain-link", "until-end-of-turn", "static"])
        .some((modifier) => modifier.damageUnpreventable === true) ||
      (threshold !== undefined && damage >= threshold);
    const replacement = activeModifiers(state, link, ["chain-link", "until-end-of-turn"])
      .find((modifier) => modifier.replaceCombatDamageWithDefendingEquipment === true);
    const eligibleEquipment = damage > 0 && replacement
      ? link.defendingEquipment.filter((card) =>
          link.flags[`equipmentGone:${card.instanceId}`] !== true &&
          equipmentDefense(state, runtime, link, card) < damage
        )
      : [];
    // Prevention replacements and shields soak combat damage too. The
    // attacking card is looked up by instance id:
    // cloneState's JSON round-trips split the chain copy from the zone copy,
    // and the shield may have been stamped on either.
    runtime.dispatchFlow("beginHeroDamage", state, {
      sourceInstanceId: link.attackingCard.instanceId,
      sourceSeat: link.attacker,
      targetSeat: defenderPlayer.seat,
      amount: damage,
      arcane: false,
      combat: true,
      ...(eligibleEquipment.length > 0
        ? { combatDamageEquipmentReplacementIds: eligibleEquipment.map((card) => card.instanceId) }
        : {}),
      ...(unpreventable ? { unpreventable: true } : {}),
    });
    return;
  }
  runtime.dispatchFlow("finishDamageStep", state);
}
