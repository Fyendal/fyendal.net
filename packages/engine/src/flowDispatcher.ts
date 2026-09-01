import type { FlowStepName } from "./flowTypes.js";
import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import { auraAttackGoAgain, beginAttackStep, startNextQueuedPermanentAttack } from "./attacks.js";
import { closeChain, finishLinkResolution } from "./combatChain.js";
import { resolveLink, resumeCombatDamage } from "./damage.js";
import { beginHeroDamage, dealAllyDamage, gainHeroLife } from "./damageResolution.js";
import { attackAllowsDefender, consumeQueuedIntimidate, proceedWithAttack, queueDefendEventLayersAfterCurrent, resolveDefendEventLayer, resolvePhantasmLayer, resolveSpectraLayer } from "./defense.js";
import { queueHitTriggers, resolveOnHitLayer } from "./hits.js";
import { beginReactionStep, reopenReactionWindow } from "./reactions.js";
import { announceCardPlayed, cancelEndActionPass, collectEventTriggerLayers, continueStack, deferEventTriggers, enterAttackLayerWindow, enterAttackWindow, finishDamageStep, finishStackCardResolution, flushPendingTriggersAboveStack, holdLayerWindow, queueEventTriggers, queueReactionEventTriggers, queueTriggeredLayers, resolveAbilityLayer, resolveTopStackCard, resolveTopStackLayer } from "./triggers.js";
import { continueEndPhase, endTurn } from "./turn.js";
import { resolveWagerLayer } from "./wagers.js";

type FlowHandler = (...args: any[]) => any;

const handlers: Readonly<Record<FlowStepName, { fn: FlowHandler; injectRuntime: boolean }>> = Object.freeze({
  announceCardPlayed: { fn: announceCardPlayed, injectRuntime: true },
  attackAllowsDefender: { fn: attackAllowsDefender, injectRuntime: true },
  auraAttackGoAgain: { fn: auraAttackGoAgain, injectRuntime: false },
  beginAttackStep: { fn: beginAttackStep, injectRuntime: true },
  beginHeroDamage: { fn: beginHeroDamage, injectRuntime: true },
  beginReactionStep: { fn: beginReactionStep, injectRuntime: false },
  cancelEndActionPass: { fn: cancelEndActionPass, injectRuntime: false },
  closeChain: { fn: closeChain, injectRuntime: true },
  collectEventTriggerLayers: { fn: collectEventTriggerLayers, injectRuntime: true },
  consumeQueuedIntimidate: { fn: consumeQueuedIntimidate, injectRuntime: false },
  continueEndPhase: { fn: continueEndPhase, injectRuntime: true },
  continueStack: { fn: continueStack, injectRuntime: true },
  dealAllyDamage: { fn: dealAllyDamage, injectRuntime: true },
  deferEventTriggers: { fn: deferEventTriggers, injectRuntime: true },
  endTurn: { fn: endTurn, injectRuntime: true },
  enterAttackLayerWindow: { fn: enterAttackLayerWindow, injectRuntime: true },
  enterAttackWindow: { fn: enterAttackWindow, injectRuntime: true },
  finishDamageStep: { fn: finishDamageStep, injectRuntime: true },
  finishLinkResolution: { fn: finishLinkResolution, injectRuntime: true },
  finishStackCardResolution: { fn: finishStackCardResolution, injectRuntime: true },
  flushPendingTriggersAboveStack: { fn: flushPendingTriggersAboveStack, injectRuntime: true },
  gainHeroLife: { fn: gainHeroLife, injectRuntime: true },
  holdLayerWindow: { fn: holdLayerWindow, injectRuntime: true },
  proceedWithAttack: { fn: proceedWithAttack, injectRuntime: true },
  queueDefendEventLayersAfterCurrent: { fn: queueDefendEventLayersAfterCurrent, injectRuntime: true },
  queueEventTriggers: { fn: queueEventTriggers, injectRuntime: true },
  queueHitTriggers: { fn: queueHitTriggers, injectRuntime: true },
  queueReactionEventTriggers: { fn: queueReactionEventTriggers, injectRuntime: true },
  queueTriggeredLayers: { fn: queueTriggeredLayers, injectRuntime: true },
  reopenReactionWindow: { fn: reopenReactionWindow, injectRuntime: true },
  resolveAbilityLayer: { fn: resolveAbilityLayer, injectRuntime: true },
  resolveDefendEventLayer: { fn: resolveDefendEventLayer, injectRuntime: true },
  resolveLink: { fn: resolveLink, injectRuntime: true },
  resolveOnHitLayer: { fn: resolveOnHitLayer, injectRuntime: true },
  resolvePhantasmLayer: { fn: resolvePhantasmLayer, injectRuntime: true },
  resolveSpectraLayer: { fn: resolveSpectraLayer, injectRuntime: true },
  resolveTopStackCard: { fn: resolveTopStackCard, injectRuntime: true },
  resolveTopStackLayer: { fn: resolveTopStackLayer, injectRuntime: true },
  resolveWagerLayer: { fn: resolveWagerLayer, injectRuntime: true },
  resumeCombatDamage: { fn: resumeCombatDamage, injectRuntime: true },
  startNextQueuedPermanentAttack: { fn: startNextQueuedPermanentAttack, injectRuntime: true },
});

export function dispatchFlow<T = any>(
  runtime: EngineRuntime,
  kind: FlowStepName,
  state: GameStateInternal,
  ...args: any[]
): T {
  const handler = handlers[kind];
  return (handler.injectRuntime
    ? handler.fn(state, runtime, ...args)
    : handler.fn(state, ...args)) as T;
}
