import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import {
  cardAbilitiesSuppressed,
  scriptOf,
} from "./cardProperties.js";
import { activeModifiers } from "./combatModifiers.js";
import { logPublic, nameOf } from "./gameLog.js";
import type { CardInstance, ChainLinkState, Modifier, PlayerState, StackLayer } from "./state.js";
import { tokenCreationCauseForModifier } from "./tokenQueries.js";
import { createTokensFor } from "./tokens.js";

import { currentLink, findCardAnywhere, opponent } from "./zoneQueries.js";
import { moveToGraveyard } from "./zoneMoves.js";
import { hookSources } from "./sourceQueries.js";

import { drawCards } from "./cardLifecycle.js";

import { snapshotSerializable } from "./ruleQueries.js";

/** Resolve one granted on-hit effect after its triggered layer has received
 * priority. The modifier was snapshotted when the hit-event occurred; only
 * consumption is mirrored back to the live modifier. */
function resolveGrantedOnHitEffect(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  mod: Modifier,
): void {
  const attacker = state.players[link.attacker] as PlayerState;
  if (!link.goAgain && mod.onHitGoAgain) {
    runtime.events.grantLinkGoAgain(state, link);
  }
  const live = state.modifiers.find((candidate) => candidate.id === mod.id);
  if (mod.onHitGainLife) {
    if (live) live.consumed = true;
    runtime.dispatchFlow("gainHeroLife", state, link.attacker, Number(mod.onHitGainLife));
  }
  if (mod.onHitGainResources) {
    if (live) live.consumed = true;
    attacker.resources += Number(mod.onHitGainResources);
    logPublic(state, `${nameOf(state, attacker.heroCardId)} gains ${mod.onHitGainResources} resource`);
  }
  if (mod.onHitDraw) {
    drawCards(state, runtime, attacker, Number(mod.onHitDraw));
  }
  const grant = mod.onHitCreateToken;
  if (grant) {
    createTokensFor(
      state, runtime,
      attacker,
      grant.cardId,
      grant.count,
      tokenCreationCauseForModifier(state, mod),
    );
  }
  if (mod.onHitLoseLife && link.targetAllyId === undefined) {
    runtime.makeCtx(state, link.attacker, link.attackingCard, link).loseLife(
      opponent(link.attacker),
      mod.onHitLoseLife,
    );
  }
  if (mod.onHitDealDamage && link.targetAllyId === undefined) {
    runtime.makeCtx(state, link.attacker, link.attackingCard, link).dealDamage(
      opponent(link.attacker),
      mod.onHitDealDamage,
      { sourceInstanceId: link.attackingCard.instanceId },
    );
  }
  const deckDestruction = mod.onHitDestroyTopDeckCards;
  if (
    deckDestruction &&
    link.targetAllyId === undefined &&
    link.damage >= deckDestruction.minimumDamage
  ) {
    const defender = state.players[opponent(link.attacker)] as PlayerState;
    for (let i = 0; i < deckDestruction.count; i++) {
      const card = defender.deck.shift();
      if (!card) break;
      moveToGraveyard(state, runtime, card, "deck", link.attacker);
    }
  }
  if (mod.onHitToSoul) link.flags.attackToSoul = true;
  if (mod.onHitBottomDeck) link.flags.attackToBottom = true;
  if (mod.onHitMark && link.targetAllyId === undefined) {
    const hero = (state.players[opponent(link.attacker)] as PlayerState).hero;
    if ((hero.counters?.marked ?? 0) <= 0) {
      (hero.counters ??= {}).marked = 1;
      logPublic(state, `${nameOf(state, hero.cardId)} is marked`);
    }
  }
  if (mod.onHitClearHandAndArsenalAtEndPhase && link.targetAllyId === undefined) {
    const target = state.players[opponent(link.attacker)] as PlayerState;
    (target.hero.counters ??= {}).clearHandAndArsenalAtEndPhaseTurn = state.turn + 1;
  }
  // granted hit effects with their own scripted choices route back to the
  // granting card's script (which may since have changed zones)
  if (grantedScriptHookFires(mod, link)) {
    const source = findCardAnywhere(state, mod.sourceInstanceId)?.card;
    if (source) {
      scriptOf(state, source.cardId, source)?.onGrantedHit?.(
        runtime.makeCtx(state, link.attacker, source, link),
        mod.onHitScriptHook!.hook,
      );
    }
  }
  if (
    mod.onHitReenableAttacker ||
    (mod.onHitReenableAttackerIfMarked && link.flags.targetWasMarkedOnHit === true)
  ) {
    runtime.makeCtx(state, link.attacker, link.attackingCard, link)
      .grantAdditionalActivation(link.attackingCard.instanceId);
    logPublic(
      state,
      `${nameOf(state, link.attackingCard.cardId)} may attack an additional time this turn`,
    );
  }
}

/** Whether a granted scripted on-hit hook fires for this hit: "hits a hero"
 *  wording excludes ally targets, and counter-gated grants (Dead Eye's aim
 *  condition) require the counter on the attacking card. */
function grantedScriptHookFires(mod: Modifier, link: ChainLinkState): boolean {
  const hook = mod.onHitScriptHook;
  if (!hook) return false;
  if (hook.heroOnly && link.targetAllyId !== undefined) return false;
  if (
    hook.requiresAttackCounter !== undefined &&
    Number(link.attackingCard.counters?.[hook.requiresAttackCounter] ?? 0) <= 0
  ) return false;
  return true;
}

function hasGrantedOnHitEffect(mod: Modifier, link: ChainLinkState): boolean {
  return !!(
    mod.onHitGoAgain ||
    mod.onHitGainLife ||
    mod.onHitGainResources ||
    mod.onHitCreateToken ||
    mod.onHitDraw ||
    mod.onHitLoseLife ||
    mod.onHitDealDamage ||
    (mod.onHitDestroyTopDeckCards &&
      link.damage >= mod.onHitDestroyTopDeckCards.minimumDamage) ||
    mod.onHitToSoul ||
    mod.onHitBottomDeck ||
    mod.onHitReenableAttacker ||
    mod.onHitReenableAttackerIfMarked ||
    mod.onHitMark ||
    mod.onHitClearHandAndArsenalAtEndPhase ||
    grantedScriptHookFires(mod, link)
  );
}

type PendingOnHitEffect =
  | { kind: "hook"; source: CardInstance; rulesCardIds: string[] }
  | { kind: "modifier"; modifier: Modifier };

/** Effects that would trigger if the current attack hits. This is shared by
 * hit resolution and projection so the combat UI never has to infer rules
 * behavior from printed text. */
export function pendingOnHitEffects(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
): PendingOnHitEffect[] {
  const attacker = state.players[link.attacker] as PlayerState;
  const effects: PendingOnHitEffect[] = [];
  const seenSources = new Set<number>();
  const addHook = (source: CardInstance): void => {
    if (seenSources.has(source.instanceId)) return;
    seenSources.add(source.instanceId);
    if (cardAbilitiesSuppressed(state, source)) return;
    const ctx = runtime.makeCtx(state, link.attacker, source, link);
    const ownScript = scriptOf(state, source.cardId, source);
    const ownHit = ownScript?.onHit && (ownScript.canTriggerOnHit?.(ctx) ?? true)
      ? ownScript.onHit
      : undefined;
    const inheritedCardId = source.grantedBaseAbilitiesCardId;
    const inheritedScript = inheritedCardId ? state.scriptsRef[inheritedCardId] : undefined;
    const inheritedHit = inheritedScript?.onHit && (inheritedScript.canTriggerOnHit?.(ctx) ?? true)
      ? inheritedScript.onHit
      : undefined;
    if (!ownHit && !inheritedHit) return;
    effects.push({
      kind: "hook",
      source,
      rulesCardIds: [
        ...(ownHit ? [source.cardId] : []),
        ...(inheritedHit && inheritedHit !== ownHit ? [inheritedCardId!] : []),
      ],
    });
  };

  const attackAbilitiesSuppressed = link.flags.attackAbilitiesSuppressed === true;
  if (!attackAbilitiesSuppressed) addHook(link.attackingCard);
  // Attack reactions grant their scripted hit abilities to the attack on the
  // link where they resolved. Reading them directly from the link keeps that
  // lifetime exact without requiring an until-end-of-turn source marker.
  if (!attackAbilitiesSuppressed) {
    for (const reaction of link.reactions) addHook(reaction);
  }
  addHook(attacker.hero);
  for (const source of hookSources(state, link.attacker, {
    board: true,
    arsenal: true,
    equipment: true,
  })) {
    addHook(source);
  }
  // Some delayed riders consume their marker when the matching attack is
  // declared, but retain event data on the link for their on-hit hook.
  for (const mod of state.modifiers) {
    const found = findCardAnywhere(state, mod.sourceInstanceId);
    if (found?.seat === link.attacker) addHook(found.card);
  }

  const triggeredModifiers = new Map<number, Modifier>();
  const addModifier = (mod: Modifier | undefined): void => {
    if (mod && hasGrantedOnHitEffect(mod, link)) triggeredModifiers.set(mod.id, mod);
  };
  if (!attackAbilitiesSuppressed) {
    for (const mod of activeModifiers(state, link, ["chain-link"])) {
      if (!mod.consumed) addModifier(mod);
    }
  }
  for (const mod of activeModifiers(state, link, ["combat-chain", "until-end-of-turn"])) {
    if (!mod.consumed) addModifier(mod);
  }
  for (const modifier of triggeredModifiers.values()) {
    effects.push({ kind: "modifier", modifier });
  }
  return effects;
}

/** Collect rules text that triggers during the Damage Step when an attack
 * hits. Each generated effect becomes a stack layer before the turn-player
 * receives priority; the Resolution Step begins only after this stack clears. */
export function queueHitTriggers(state: GameStateInternal,
  runtime: EngineRuntime, link: ChainLinkState): boolean {
  const scriptedChoice = state.pendingDecision?.chooseHook
    ? state.pendingDecision
    : undefined;
  const layers: StackLayer[] = [];
  for (const effect of pendingOnHitEffects(state, runtime, link)) {
    if (effect.kind === "hook") {
      const { source } = effect;
      layers.push({
        sourceInstanceId: source.instanceId,
        seat: link.attacker,
        triggerIndex: -2,
        label: "On hit",
        optional: false,
        engineEffect: { kind: "on-hit-hook", source: snapshotSerializable(source) },
      });
      logPublic(state, `${nameOf(state, source.cardId)} triggers: On hit`);
      continue;
    }
    const { modifier } = effect;
    const source = findCardAnywhere(state, modifier.sourceInstanceId)?.card;
    const live = state.modifiers.find((candidate) => candidate.id === modifier.id);
    if (live && modifier.once) live.consumed = true;
    layers.push({
      sourceInstanceId: modifier.sourceInstanceId,
      seat: modifier.seat,
      triggerIndex: -1000 - modifier.id,
      label: "On hit",
      optional: false,
      engineEffect: { kind: "on-hit-modifier", modifier: snapshotSerializable(modifier) },
    });
    logPublic(state, `${source ? nameOf(state, source.cardId) : "A delayed effect"} triggers: On hit`);
  }

  if (layers.length === 0) return false;
  // Reaction has ended. The hit-event occurs in the Damage Step, whose
  // priority is represented by the engine's ordinary layer window.
  state.phase = "layer";
  runtime.dispatchFlow("queueTriggeredLayers", state, [{ seat: link.attacker, layers }], "finish-link-resolution");
  if (scriptedChoice) {
    // Combat-damage observers may ask a direct scripted choice before the
    // same hit's triggered layers receive priority. For example, Okana Scar
    // Wraps may ask to equip Edge of Autumn while Legacy of Ikaru's on-hit
    // ability is already queued. Keep that choice in front, then enter the
    // prepared stack once it has been answered.
    scriptedChoice.resume = { kind: "continue-stack", seat: link.attacker };
  }
  return true;
}

/** Resolve a generated on-hit stack layer. */
export function resolveOnHitLayer(state: GameStateInternal,
  runtime: EngineRuntime, layer: StackLayer): void {
  const link = currentLink(state);
  if (!link) {
    logPublic(state, "An on-hit trigger resolves without effect (the chain link is gone)");
    return;
  }
  const effect = layer.engineEffect;
  if (effect?.kind === "on-hit-hook") {
    const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? effect.source;
    runtime.events.runHook(state, layer.seat, source, "onHit", link);
    return;
  }
  if (effect?.kind === "on-hit-modifier") {
    resolveGrantedOnHitEffect(state, runtime, link, effect.modifier);
  }
}
