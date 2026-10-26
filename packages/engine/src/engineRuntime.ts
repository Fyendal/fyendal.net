import type { EngineRuntime } from "./runtimePorts.js";
import { dispatchFlow } from "./flowDispatcher.js";
import { createScriptRuntime } from "./scriptRuntime.js";
import { setAttackActivationLimitKey } from "./abilityRules.js";
import { additionalAttackTargetOptions, attackFromDeck, attackWithPermanent, declareAdditionalAttackTarget, replaceAttackFromBanish, replaceAttackFromHand } from "./attacks.js";
import { arsenalCapacity, drawCards, entersArena, settlePlayedCard, settlesInArena, stampControlledName, tapPermanent } from "./cardLifecycle.js";
import { crowdBoo, crowdCheer, requestClash } from "./clash.js";
import { applyOneShotDefenseModifiers, attackBonusAboveBase, attackHasDominate, attackHasGoAgain, attackHasOverpower, basePowerOf, chainLinkNumber, chainLinksControlled, computeAttack, computeDefense, currentPowerOf, defendingDefenseOf, hitsThisCombatChain, linkAttackHasType, noteAttackDefendedBy, replaceTemporalPowerGain } from "./combatValues.js";
import { boundArcaneCardBonus, dealEffectDamage, effectDamageBonus, gainHeroLife } from "./damageResolution.js";
import { queueDefendEventLayersAfterCurrent, resolveIntimidate } from "./defense.js";
import { recordDieResult, recordDieRoll, rollIgnoringLowest } from "./dieRoll.js";
import { notePitch, pitchIntoPool, pitchProhibitedByEffect, pitchValueOfInstance, scriptedPaymentOptions } from "./resources.js";
import { compareLife, snapshotSerializable } from "./ruleQueries.js";
import { discardToGraveyard, fireOnDiscard, fireTransformHook } from "./scriptContext.js";
import { createTokenFor, createTokensFor } from "./tokens.js";
import { banishCard, bindPermanent, destroyPermanent, enterSoul, fireLeaveArena, fireLeaveCombatChain, moveToGraveyard, putCardIntoSoul, putCardOnDeckBottom, removeFromOwnerZones, removeFromStackResolution, shuffleCardsIntoDeck } from "./zoneMoves.js";
import { noopTransitionRecorder, type TransitionRecorder } from "./transitions.js";

type RuntimeFunction = (...args: any[]) => any;

export function createEngineRuntime(
  transitions: TransitionRecorder = noopTransitionRecorder(),
): EngineRuntime {
  const runtime = {} as EngineRuntime;
  const runtimeDispatch: EngineRuntime["dispatchFlow"] = (kind, state, ...args) =>
    dispatchFlow(runtime, kind, state, ...args);
  const bind = (fn: RuntimeFunction, injectRuntime: boolean): RuntimeFunction =>
    injectRuntime
      ? (...args: any[]) => fn(args[0], runtime, ...args.slice(1))
      : (...args: any[]) => fn(...args);

  Object.assign(runtime, {
    ...createScriptRuntime(runtime),
    transitions,
    dispatchFlow: runtimeDispatch,
    commands: Object.freeze({
      additionalAttackTargetOptions: bind(additionalAttackTargetOptions, false),
      applyOneShotDefenseModifiers: bind(applyOneShotDefenseModifiers, false),
      arsenalCapacity: bind(arsenalCapacity, false),
      attackBonusAboveBase: bind(attackBonusAboveBase, true),
      attackFromDeck: bind(attackFromDeck, true),
      attackHasDominate: bind(attackHasDominate, true),
      attackHasGoAgain: bind(attackHasGoAgain, true),
      attackHasOverpower: bind(attackHasOverpower, true),
      attackWithPermanent: bind(attackWithPermanent, true),
      banishCard: bind(banishCard, true),
      basePowerOf: bind(basePowerOf, true),
      bindPermanent: bind(bindPermanent, false),
      boundArcaneCardBonus: bind(boundArcaneCardBonus, false),
      chainLinkNumber: bind(chainLinkNumber, false),
      chainLinksControlled: bind(chainLinksControlled, false),
      compareLife: bind(compareLife, false),
      computeAttack: bind(computeAttack, true),
      computeDefense: bind(computeDefense, true),
      createTokenFor: bind(createTokenFor, true),
      createTokensFor: bind(createTokensFor, true),
      crowdBoo: bind(crowdBoo, true),
      crowdCheer: bind(crowdCheer, true),
      currentPowerOf: bind(currentPowerOf, true),
      dealEffectDamage: bind(dealEffectDamage, true),
      declareAdditionalAttackTarget: bind(declareAdditionalAttackTarget, false),
      defendingDefenseOf: bind(defendingDefenseOf, true),
      destroyPermanent: bind(destroyPermanent, true),
      discardToGraveyard: bind(discardToGraveyard, true),
      drawCards: bind(drawCards, true),
      effectDamageBonus: bind(effectDamageBonus, false),
      enterSoul: bind(enterSoul, true),
      entersArena: bind(entersArena, false),
      fireLeaveArena: bind(fireLeaveArena, true),
      fireLeaveCombatChain: bind(fireLeaveCombatChain, true),
      fireOnDiscard: bind(fireOnDiscard, true),
      fireTransformHook: bind(fireTransformHook, true),
      gainHeroLife: bind(gainHeroLife, true),
      hitsThisCombatChain: bind(hitsThisCombatChain, false),
      linkAttackHasType: bind(linkAttackHasType, false),
      moveToGraveyard: bind(moveToGraveyard, true),
      noteAttackDefendedBy: bind(noteAttackDefendedBy, true),
      notePitch: bind(notePitch, false),
      pitchIntoPool: bind(pitchIntoPool, true),
      pitchProhibitedByEffect: bind(pitchProhibitedByEffect, false),
      pitchValueOfInstance: bind(pitchValueOfInstance, false),
      putCardIntoSoul: bind(putCardIntoSoul, true),
      putCardOnDeckBottom: bind(putCardOnDeckBottom, true),
      queueDefendEventLayersAfterCurrent: bind(queueDefendEventLayersAfterCurrent, true),
      recordDieResult: bind(recordDieResult, true),
      recordDieRoll: bind(recordDieRoll, true),
      removeFromOwnerZones: bind(removeFromOwnerZones, false),
      removeFromStackResolution: bind(removeFromStackResolution, false),
      replaceAttackFromBanish: bind(replaceAttackFromBanish, true),
      replaceAttackFromHand: bind(replaceAttackFromHand, true),
      replaceTemporalPowerGain: bind(replaceTemporalPowerGain, false),
      requestClash: bind(requestClash, true),
      resolveIntimidate: bind(resolveIntimidate, true),
      rollIgnoringLowest: bind(rollIgnoringLowest, false),
      scriptedPaymentOptions: bind(scriptedPaymentOptions, false),
      setAttackActivationLimitKey: bind(setAttackActivationLimitKey, false),
      settlePlayedCard: bind(settlePlayedCard, true),
      settlesInArena: bind(settlesInArena, false),
      shuffleCardsIntoDeck: bind(shuffleCardsIntoDeck, true),
      snapshotSerializable: bind(snapshotSerializable, false),
      stampControlledName: bind(stampControlledName, false),
      tapPermanent: bind(tapPermanent, true),
    }),
  });
  return Object.freeze(runtime);
}

export const engineRuntime = createEngineRuntime();
