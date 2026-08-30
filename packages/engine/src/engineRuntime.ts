import type { EngineRuntime } from "./runtimePorts.js";
import { dispatchFlow } from "./flowDispatcher.js";
import { createScriptRuntime } from "./scriptRuntime.js";
import { setAttackActivationLimitKey } from "./abilityRules.js";
import { attackFromDeck, attackWithPermanent, replaceAttackFromHand } from "./attacks.js";
import { arsenalCapacity, drawCards, entersArena, settlePlayedCard, settlesInArena, stampControlledName, tapPermanent } from "./cardLifecycle.js";
import { crowdBoo, crowdCheer, requestClash } from "./clash.js";
import { applyOneShotDefenseModifiers, attackBonusAboveBase, attackHasDominate, attackHasOverpower, basePowerOf, chainLinkNumber, chainLinksControlled, computeAttack, computeDefense, currentPowerOf, hitsThisCombatChain, linkAttackHasType, noteAttackDefendedBy, replaceTemporalPowerGain } from "./combatValues.js";
import { boundArcaneCardBonus, dealEffectDamage, effectDamageBonus, gainHeroLife } from "./damageResolution.js";
import { queueDefendEventLayersAfterCurrent, resolveIntimidate } from "./defense.js";
import { recordDieResult, recordDieRoll, rollIgnoringLowest } from "./dieRoll.js";
import { notePitch, pitchIntoPool, pitchProhibitedByEffect, pitchValueOfInstance, scriptedPaymentOptions } from "./resources.js";
import { compareLife, snapshotSerializable } from "./ruleQueries.js";
import { discardToGraveyard, fireOnDiscard, fireTransformHook } from "./scriptContext.js";
import { createTokenFor, createTokensFor } from "./tokens.js";
import { banishCard, destroyPermanent, enterSoul, fireLeaveArena, moveToGraveyard, putCardOnDeckBottom, removeFromOwnerZones, removeFromStackResolution } from "./zoneMoves.js";

type RuntimeFunction = (...args: any[]) => any;

const runtime = {} as EngineRuntime;
const runtimeDispatch: EngineRuntime["dispatchFlow"] = (kind, state, ...args) =>
  dispatchFlow(runtime, kind, state, ...args);
const bind = (fn: RuntimeFunction, injectRuntime: boolean): RuntimeFunction =>
  injectRuntime
    ? (...args: any[]) => fn(args[0], runtime, ...args.slice(1))
    : (...args: any[]) => fn(...args);

Object.assign(runtime, {
  ...createScriptRuntime(runtime),
  dispatchFlow: runtimeDispatch,
  commands: Object.freeze({
    applyOneShotDefenseModifiers: bind(applyOneShotDefenseModifiers, false),
    arsenalCapacity: bind(arsenalCapacity, false),
    attackBonusAboveBase: bind(attackBonusAboveBase, true),
    attackFromDeck: bind(attackFromDeck, true),
    attackHasDominate: bind(attackHasDominate, false),
    attackHasOverpower: bind(attackHasOverpower, false),
    attackWithPermanent: bind(attackWithPermanent, true),
    banishCard: bind(banishCard, true),
    basePowerOf: bind(basePowerOf, true),
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
    destroyPermanent: bind(destroyPermanent, true),
    discardToGraveyard: bind(discardToGraveyard, true),
    drawCards: bind(drawCards, true),
    effectDamageBonus: bind(effectDamageBonus, false),
    enterSoul: bind(enterSoul, true),
    entersArena: bind(entersArena, false),
    fireLeaveArena: bind(fireLeaveArena, true),
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
    putCardOnDeckBottom: bind(putCardOnDeckBottom, true),
    queueDefendEventLayersAfterCurrent: bind(queueDefendEventLayersAfterCurrent, true),
    recordDieResult: bind(recordDieResult, true),
    recordDieRoll: bind(recordDieRoll, true),
    removeFromOwnerZones: bind(removeFromOwnerZones, false),
    removeFromStackResolution: bind(removeFromStackResolution, false),
    replaceAttackFromHand: bind(replaceAttackFromHand, true),
    replaceTemporalPowerGain: bind(replaceTemporalPowerGain, false),
    requestClash: bind(requestClash, true),
    resolveIntimidate: bind(resolveIntimidate, false),
    rollIgnoringLowest: bind(rollIgnoringLowest, false),
    scriptedPaymentOptions: bind(scriptedPaymentOptions, false),
    setAttackActivationLimitKey: bind(setAttackActivationLimitKey, false),
    settlePlayedCard: bind(settlePlayedCard, true),
    settlesInArena: bind(settlesInArena, false),
    snapshotSerializable: bind(snapshotSerializable, false),
    stampControlledName: bind(stampControlledName, false),
    tapPermanent: bind(tapPermanent, true),
  }),
});

Object.freeze(runtime);

export { runtime as engineRuntime };
