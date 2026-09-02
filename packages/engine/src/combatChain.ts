import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";

import { dataOf, hasKeyword, scriptOf } from "./cardProperties.js";
import { activeModifiers, conditionalModifierGrantsGoAgain } from "./combatModifiers.js";
import {
  attackHasDominate,
  attackHasOverpower,
  attackValueModifiers,
  computeAttack,
  computeDefense,
  defenseValueModifiers,
  equipmentDefense,
} from "./combatValues.js";
import { logPublic, nameOf } from "./gameLog.js";
import type { ChainLinkState, PlayerState, StackLayer } from "./state.js";

import { findCardAnywhere, removeFromArray } from "./zoneQueries.js";
import {
  destroyPermanent,
  enterBanish,
  enterSoul,
  moveToGraveyard,
} from "./zoneMoves.js";
import { controlledPermanents, lingeringModifierSources } from "./sourceQueries.js";
import { transitionZone } from "./transitions.js";

import { checkWin } from "./win.js";

/** The link stays on the chain until the chain closes; closeChain moves the
 *  cards to the graveyard and destroys blade-break / battleworn equipment.
 *  Snapshot the values now: chain-link modifiers expire with the link, so a
 *  past link's numbers (incl. reaction buffs) must not be recomputed live. */
function expireLinkModifiers(state: GameStateInternal,
  runtime: EngineRuntime, link: ChainLinkState): void {
  link.finalAttack = computeAttack(state, runtime, link);
  link.finalDefense = computeDefense(state, runtime, link);
  link.finalAttackModifiers = attackValueModifiers(state, runtime, link);
  link.finalDefenseModifiers = defenseValueModifiers(state, runtime, link);
  // Snapshot keyword presence too: granted keywords disappear with the modifiers.
  link.flags.dominateAtResolution = attackHasDominate(state, link);
  link.flags.overpowerAtResolution = attackHasOverpower(state, link);
  state.modifiers = state.modifiers.filter((m) => m.scope !== "chain-link");
}

/** Begin the Resolution Step. Go again pays out exactly once at this boundary;
 * granting it later in the step still gives the attack the ability but cannot
 * retroactively grant an action point (CR 8.3.5b). */
function beginLinkResolutionStep(state: GameStateInternal,
  runtime: EngineRuntime, link: ChainLinkState): void {
  if (link.flags.resolutionStepBegan === true) return;
  link.flags.resolutionStepBegan = true;
  // Aura attacks with a +1{p} counter have go again (Cosmo), evaluated at the
  // same beginning-of-Resolution-Step boundary as other go again abilities.
  if (!link.goAgain && runtime.dispatchFlow("auraAttackGoAgain", state, link)) runtime.events.grantLinkGoAgain(state, link);
  if (!link.goAgain && conditionalModifierGrantsGoAgain(
    state,
    link,
    computeAttack(state, runtime, link),
  )) {
    runtime.events.grantLinkGoAgain(state, link);
  }
  if (link.goAgain) {
    (state.players[link.attacker] as PlayerState).actionPoints += 1;
    logPublic(state, `${nameOf(state, link.attackingCard.cardId)} has Go again (+1 action point)`);
  }
}

/** The tail of chain-link resolution: value snapshot, resolution hooks, and
 * return to the action phase. */
export function finishLinkResolution(state: GameStateInternal,
  runtime: EngineRuntime, link: ChainLinkState): void {
  beginLinkResolutionStep(state, runtime, link);
  if (
    link.wagers?.length &&
    link.flags.wagerResultsQueued !== true
  ) {
    link.flags.wagerResultsQueued = true;
    const layers: StackLayer[] = link.wagers.map((wager, wagerIndex) => ({
      sourceInstanceId: wager.source.instanceId,
      seat: wager.controllerSeat,
      triggerIndex: -2000 - wagerIndex,
      label: `Resolve wager: ${wager.rewardLabel}`,
      optional: false,
      engineEffect: { kind: "wager-result", wagerIndex },
    }));
    state.phase = "layer";
    runtime.dispatchFlow("queueTriggeredLayers", state, [{ seat: link.attacker, layers }], "finish-link-resolution");
    return;
  }
  const defendedByAttackAction = link.defendingCards.some((card) => {
    const data = dataOf(state, card.cardId);
    return data.cardType === "action" && (data.subtypes ?? []).includes("attack");
  });
  if (defendedByAttackAction) {
    const counters = activeModifiers(state, link, ["chain-link"])
      .reduce((sum, modifier) => sum + Number(modifier.onDefendedByAttackActionPowerCounters ?? 0), 0);
    if (counters > 0) {
      const live = findCardAnywhere(state, link.attackingCard.instanceId)?.card;
      if (live) {
        (live.counters ??= {}).power = Number(live.counters?.power ?? 0) + counters;
        logPublic(state, `${nameOf(state, live.cardId)} gets ${counters} +1{p} counter(s)`);
      }
    }
  }
  const resolvedSources = [
    link.attackingCard,
    ...controlledPermanents(state, link.attacker, { faceDownEquipment: false }),
    ...lingeringModifierSources(state, link.attacker),
  ].filter((source, index, sources) =>
    sources.findIndex((candidate) => candidate.instanceId === source.instanceId) === index,
  );
  for (const source of resolvedSources) {
    scriptOf(state, source.cardId, source)?.onAttackResolved?.(
      runtime.makeCtx(state, link.attacker, source, link),
    );
  }
  const linkParticipants = [
    link.attackingCard,
    ...link.defendingCards,
    ...link.defendingEquipment,
    ...link.reactions,
  ];
  for (const source of linkParticipants) {
    scriptOf(state, source.cardId, source)?.onChainLinkResolved?.(
      runtime.makeCtx(state, source.owner, source, link),
    );
  }
  // Delayed effects may mark attack-action cards on the active link to return
  // when that link resolves (Electromagnetic Somersault). The link keeps its
  // last-known attacking object, while close-chain settlement skips it.
  if (link.attackingCard.counters?.returnToHandAtLinkResolution) {
    (state.players[link.attackingCard.owner] as PlayerState).hand.push(link.attackingCard);
    link.flags.attackGone = true;
    delete link.attackingCard.counters.returnToHandAtLinkResolution;
    logPublic(state, `${nameOf(state, link.attackingCard.cardId)} returns to its owner's hand`);
  }
  const returningDefenders = link.defendingCards.filter(
    (card) => card.counters?.returnToHandAtLinkResolution,
  );
  for (const card of returningDefenders) {
    delete card.counters?.returnToHandAtLinkResolution;
    (state.players[card.owner] as PlayerState).hand.push(card);
    logPublic(state, `${nameOf(state, card.cardId)} returns to its owner's hand`);
  }
  if (returningDefenders.length > 0) {
    const ids = new Set(returningDefenders.map((card) => card.instanceId));
    link.defendingCards = link.defendingCards.filter((card) => !ids.has(card.instanceId));
  }
  expireLinkModifiers(state, runtime, link);
  link.resolved = true;
  state.reactionPasses = 0;
  if (checkWin(state)) return;
  const pd = state.pendingDecision;
  if (pd?.chooseHook) {
    // A resolution-step script paused for a choice (Buckling Blow's target,
    // Katsu's search, ...): the link is resolved, but the choice must stay
    // answerable. Nothing is deferred — resolution is already complete.
    pd.resume = state.stack.length > 0 || (state.pendingTriggeredLayers?.length ?? 0) > 0
      ? { kind: "continue-stack" }
      : { kind: "after-resolution" };
  } else {
    state.pendingDecision = null;
    if (state.stack.length > 0 || (state.pendingTriggeredLayers?.length ?? 0) > 0) {
      state.stackResume ??= "begin-action";
      runtime.dispatchFlow("continueStack", state);
      return;
    }
  }
  state.phase = "action";
  state.priorityPlayer = state.activePlayer;
  if (!pd?.chooseHook) runtime.dispatchFlow("startNextQueuedPermanentAttack", state, link.attacker);
}

/**
 * Close the combat chain: every card on its links goes to its owner's
 * graveyard (attacking weapons and other permanents stay in play), and
 * defending equipment resolves its close-of-chain keyword: Blade Break and
 * destroy-on-close flags destroy it, while Battleworn and Guardwell add
 * defense counters.
 * Called when a non-attack action is played and at the end of the turn.
 */
export function closeChain(state: GameStateInternal, runtime: EngineRuntime): void {
  // the chain can only close while it is still open: links exist, the last
  // link has resolved, and no new attack has been declared since (a declared
  // attack is a new unresolved link — mid-combat the chain is not closable)
  const last = state.chain[state.chain.length - 1];
  if (!last || !last.resolved) return;
  logPublic(state, "The combat chain closes");
  // Snapshot every defending close hook before any close effect moves cards.
  // This keeps the event simultaneous across all links and includes equipment,
  // which remains in its arena slot while represented on the chain.
  const defendingCloseHooks = new Map(
    state.chain.map((link) => [
      link,
      [...link.defendingCards, ...link.defendingEquipment],
    ] as const),
  );
  for (const link of state.chain) {
    delete link.attackingCard.grantedNames;
    const closingAttacker =
      findCardAnywhere(state, link.attackingCard.instanceId)?.card ?? link.attackingCard;
    if (link.flags.attackGone !== true) {
      scriptOf(state, closingAttacker.cardId, closingAttacker)?.onCombatChainClosed?.(
        runtime.makeCtx(state, link.attacker, closingAttacker, link),
      );
    }
    if (link.attackingCard.copyOriginalCardId) {
      link.attackingCard.cardId = link.attackingCard.copyOriginalCardId;
      delete link.attackingCard.copyOriginalCardId;
    }
    delete link.attackingCard.grantedBaseAbilitiesCardId;
    delete link.attackingCard.grantedBaseAbilitiesCardIds;
    if (link.attackCardType === "action" && link.flags.attackGone !== true) {
      // "if this hits, put it into your hero's soul" (Illuminate, Engulfing
      // Light): the attacking card goes to the soul instead of the graveyard
      if (link.flags.attackToSoul === true) {
        enterSoul(state, runtime, link.attackingCard, false);
      } else if (link.flags.attackToBanish === true) {
        enterBanish(state, runtime, link.attackingCard, "chain");
      } else if (link.flags.attackToBottom === true) {
        const owner = state.players[link.attackingCard.owner] as PlayerState;
        owner.deck.push(link.attackingCard);
        runtime.transitions.move(
          link.attackingCard,
          transitionZone("chain", owner.seat),
          transitionZone("deck", owner.seat, "bottom"),
          { to: true },
        );
        logPublic(state, `${nameOf(state, link.attackingCard.cardId)} is put on the bottom of the deck`);
      } else {
        moveToGraveyard(state, runtime, link.attackingCard);
      }
    }
    if (link.flags.destroyAttackerOnChainClose === true) {
      const controller = state.players[link.attacker] as PlayerState;
      const liveAttacker =
        controller.weapons.find(
          (card) => card.instanceId === link.attackingCard.instanceId,
        ) ??
        controller.board.find(
          (card) => card.instanceId === link.attackingCard.instanceId,
        );
      if (liveAttacker) destroyPermanent(state, runtime, link.attacker, liveAttacker);
    }
    for (const c of defendingCloseHooks.get(link) ?? []) {
      scriptOf(state, c.cardId, c)?.onDefendingCombatChainClosed?.(
        runtime.makeCtx(state, c.owner, c, link),
      );
    }
    for (const c of link.defendingCards) {
      if (link.flags[`banishOnClose:${c.instanceId}`] === true) {
        enterBanish(state, runtime, c, "chain");
      } else if (scriptOf(state, c.cardId, c)?.settlesToSoulOnChainClose) {
        enterSoul(state, runtime, c, false);
      } else {
        moveToGraveyard(state, runtime, c);
      }
    }
    for (const c of link.reactions) {
      moveToGraveyard(state, runtime, c);
    }
    for (const c of [...link.defendingEquipment]) {
      if (link.flags[`equipmentGone:${c.instanceId}`] === true) continue;
      if (link.flags[`banishOnClose:${c.instanceId}`] === true) {
        // Equipment remains in its arena slot while defending and may be
        // represented on more than one link. Clear every chain representation
        // first so the ordinary zone-movement command removes the live object.
        for (const chainLink of state.chain) {
          if (removeFromArray(chainLink.defendingEquipment, c.instanceId)) {
            chainLink.flags[`equipmentGone:${c.instanceId}`] = true;
          }
        }
        runtime.makeCtx(state, c.owner, c, link).banish(c.instanceId);
        continue;
      }
      const flagged = link.flags[`destroyOnClose:${c.instanceId}`] === true;
      if (flagged || hasKeyword(state, c, "blade break")) {
        destroyPermanent(state, runtime, c.owner, c);
      } else if (hasKeyword(state, c, "battleworn")) {
        // Battleworn (8.3.2): a -1 defense counter, not destruction. Mutate the
        // live equipment object — the link may hold a stale clone of it.
        const live = findCardAnywhere(state, c.instanceId)?.card ?? c;
        live.defCounters = (live.defCounters ?? 0) + 1;
        logPublic(
          state,
          `${nameOf(state, c.cardId)} gets a -1 defense counter (Battleworn)`,
        );
      } else if (hasKeyword(state, c, "guardwell")) {
        // Guardwell (8.3.34): -1 defense counters equal to its defense
        const live = findCardAnywhere(state, c.instanceId)?.card ?? c;
        const n = equipmentDefense(state, runtime, link, live);
        if (n > 0) {
          live.defCounters = (live.defCounters ?? 0) + n;
          logPublic(
            state,
            `${nameOf(state, c.cardId)} gets ${n} -1 defense counter(s) (Guardwell)`,
          );
        }
      } else if (hasKeyword(state, c, "temper")) {
        // Temper: add a -1 defense counter, then destroy the equipment only
        // if its current defense is 0. Continuous modifiers that still apply
        // during the close step (such as Unity) are part of that value.
        const live = findCardAnywhere(state, c.instanceId)?.card ?? c;
        live.defCounters = (live.defCounters ?? 0) + 1;
        logPublic(state, `${nameOf(state, c.cardId)} gets a -1 defense counter (Temper)`);
        if (equipmentDefense(state, runtime, link, live) <= 0) {
          destroyPermanent(state, runtime, live.owner, live);
        }
      }
    }
  }
  state.chain = [];
  // combat-chain scoped effects ("your attacks are Draconic this combat
  //  chain") expire when the chain closes
  state.modifiers = state.modifiers.filter(
    (m) => m.scope !== "combat-chain" && !m.expiresOnChainClose,
  );
  // per-instance "this combat chain" defense grants (Shred) expire too
  for (const p of state.players as PlayerState[]) {
    for (const zone of [p.hand, p.deck, p.arsenal, p.pitch, p.graveyard, p.banish, p.board]) {
      for (const c of zone) {
        if (c.playableFromUntilChainClose !== true) continue;
        delete c.playableFrom;
        delete c.playableFromSourceCardId;
        delete c.playableBySeat;
        delete c.playCostReduction;
        delete c.playCostReductionSeat;
        delete c.playableFromExpiry;
        delete c.playableFromEndTurnExpiry;
        delete c.playableFromUntilStartOfSeatTurn;
        delete c.playableFromUntilEndOfSeatTurn;
        delete c.playableFromGrantedTurn;
        delete c.playableFromUntilChainClose;
      }
    }
    for (const c of Object.values(p.equipment)) {
      if (c?.tempDefense !== undefined) delete c.tempDefense;
    }
  }
}
