import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import { scriptOf } from "./cardProperties.js";

import { activeModifiers, modifierApplies } from "./combatModifiers.js";
import {
  computeAttack,
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
import type { ChainLinkState, PendingArcane, PlayerState } from "./state.js";

import { tokenCreationCauseForModifier } from "./tokenQueries.js";
import { createTokensFor } from "./tokens.js";
import { currentLink, findCardAnywhere, opponent } from "./zoneQueries.js";
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
  if (damageSource.life !== undefined && damageSource.life <= 0) {
    destroyPermanent(state, runtime, link.attacker, damageSource);
  }
  const delayedSuppression = hitOriginalTarget ? state.modifiers.find(
    (modifier) =>
      modifier.scope === "until-end-of-turn" &&
      modifier.suppressHitEffects === true &&
      !modifier.consumed &&
      modifierApplies(state, modifier, link),
  ) : undefined;
  if (delayedSuppression) delayedSuppression.consumed = true;
  if (!hitOriginalTarget) {
    runtime.events.runHook(state, link.attacker, link.attackingCard, "onMiss", link);
  } else if (
    link.flags.suppressHitEffects === true ||
    delayedSuppression ||
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
    return runtime.dispatchFlow("queueHitTriggers", state, link);
  }
  return false;
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
    runtime.events.runHook(state, link.attacker, link.attackingCard, "onMiss", link);
  }
  return false;
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
  const id = link.attackingCard.instanceId;
  if (attacker.weapons.some((c) => c.instanceId === id)) return true;
  return attacker.board.some((c) => c.instanceId === id);
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
  const defenderPlayer = state.players[opponent(link.attacker)] as PlayerState;
  const attack = computeAttack(state, runtime, link);
  const defense = computeDefense(state, runtime, link);
  const baseDamage = Math.max(0, attack - defense);
  const damageBonus = baseDamage > 0
    ? activeModifiers(state, link, ["chain-link", "combat-chain", "until-end-of-turn", "static"])
      .reduce((sum, modifier) => sum + Number(modifier.damage || 0), 0)
    : 0;
  let damage = baseDamage + damageBonus;
  const damageScript = scriptOf(state, link.attackingCard.cardId, link.attackingCard);
  damage = Math.max(0, Math.floor(damageScript?.modifyCombatDamage?.(
    runtime.makeCtx(state, link.attacker, link.attackingCard, link),
    damage,
  ) ?? damage));
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
      link.hit = false;
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
      link.hit = dealt > 0;
      if (dealt > 0) {
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
        runtime.events.runHook(state, link.attacker, link.attackingCard, "onMiss", link);
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
