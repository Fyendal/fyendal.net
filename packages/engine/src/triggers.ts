import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { MeldSide, PlayableZone } from "@fyendal/shared";
import type { CardScript, TriggerEvent, TriggerEventContext } from "./scripts.js";
import {
  activatedAbilitiesSuppressed,
  cardHasType,
  dataOf,
  instanceDataOf,
  isChiCard,
  meldSideHasType,
  scriptOf,
} from "./cardProperties.js";
import { logNameOf, logPublic, nameOf } from "./gameLog.js";
import {
  isValidVariableX,
  payCost,
  resolveVariablePlayCost,
  variableResourceChoices,
  variableResourceCost,
} from "./costs.js";
import type { CardInstance, PlayerState, StackLayer, StackResume } from "./state.js";
import { currentLink, findCardAnywhere, opponent, removeFromArray } from "./zoneQueries.js";
import { moveToGraveyard } from "./zoneMoves.js";

import {
  applyOneShotDefenseModifiers,
  attackHasDominate,
  noteAttackDefendedBy,
} from "./combatValues.js";

import { abilityResourceCost, activatedAbilityAvailable, canPayAbilityLifeCost, canPayActivatedEffectCardCosts, discardCostOptions, effectiveAbilityList } from "./abilityRules.js";
import { settlesInArena, settlePlayedCard } from "./cardLifecycle.js";
import { alternativePlayCostOptions, canPlayAsInstant, cardPlayCost, cardPlayReductionForSeat, cardPlayRestrictedByModifier, cardsPlayableFromArsenal, cardsPlayableFromZone, cardLayerGoAgain, mayPlayFromArsenal, mayPlayFromZone, noteCardPlayed, payAlternativePlayCost, playTargetOptions, preparePlayTarget } from "./playRules.js";
import { canPayRequiredHandCardsForAdditionalCost, pitchValueOfInstance } from "./resources.js";
import { heroAbilitiesDisabled } from "./stateQueries.js";
import { goAgainSuppressed, isFrozen, opposingInstantsProhibited, snapshotSerializable } from "./ruleQueries.js";
import { opposingActionsProhibited } from "./restrictions.js";
import { defendingHeroCannotRespondBelowPower } from "./combatRestrictions.js";
import { pushCardLayer } from "./stackCore.js";

import {
  holdPriorityWindow,
  passPriorityWindow,
  type PriorityWindow,
} from "./priority.js";

/**
 * The layer/priority machine. Triggered abilities are queued as stack layers;
 * while the stack is non-empty (or an attack has been declared but is not yet
 * attacking) players hold a priority window in which they may play instants,
 * passing back and forth. Two consecutive passes resolve the top layer; when
 * the stack is empty, the pending continuation (`stackResume`) runs.
 */

/** Rough affordability check for window eligibility (payCost does the real
 *  validation). Chi points count toward resource costs; with a chi cost, only
 *  chi-subtype pitches count and the chi pool must cover the chi part. */
function canAfford(
  state: GameStateInternal,
  player: PlayerState,
  cost: number,
  excludeInstanceIds: readonly number[],
  chiCost = 0,
): boolean {
  const excluded = new Set(excludeInstanceIds);
  let sum = player.resources + player.chi;
  let chi = player.chi;
  for (const c of player.hand) {
    if (excluded.has(c.instanceId)) continue;
    if (chiCost > 0 && !isChiCard(state, c)) continue;
    const v = pitchValueOfInstance(state, c);
    sum += v;
    if (isChiCard(state, c)) chi += v;
  }
  if (chiCost > 0 && chi < chiCost) return false;
  return sum >= cost + chiCost;
}

/** Instants `seat` could play in a priority window right now. Candidate mode
 * retains structurally playable cards without checking resource affordability. */
export function windowInstantPlays(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  includeUnaffordable = false,
): { card: CardInstance; fromArsenal: boolean; fromZone?: PlayableZone }[] {
  if (opposingActionsProhibited(state, seat) || opposingInstantsProhibited(state, seat) || defendingHeroCannotRespondBelowPower(state, runtime, seat)) return [];
  const player = state.players[seat] as PlayerState;
  const link = currentLink(state);
  const out: { card: CardInstance; fromArsenal: boolean; fromZone?: PlayableZone }[] = [];
  const sources: { arr: CardInstance[]; fromArsenal: boolean; fromZone?: PlayableZone }[] = [
    { arr: player.hand, fromArsenal: false },
    { arr: cardsPlayableFromArsenal(state, seat), fromArsenal: true },
    {
      arr: cardsPlayableFromZone(state, runtime, seat, "banish"),
      fromArsenal: false,
      fromZone: "banish",
    },
    {
      arr: cardsPlayableFromZone(state, runtime, seat, "graveyard"),
      fromArsenal: false,
      fromZone: "graveyard",
    },
    { arr: cardsPlayableFromZone(state, runtime, seat, "deck"), fromArsenal: false, fromZone: "deck" },
  ];
  for (const { arr, fromArsenal, fromZone } of sources) {
    for (const card of arr) {
      const script = scriptOf(state, card.cardId, card);
      // actions a script makes playable "as though they were instants"
      // (Cindering Foresight, ...) count as instants for window legality
      const asInstant = canPlayAsInstant(state, runtime, seat, card, link, fromZone ?? (fromArsenal ? "arsenal" : "hand"));
      if (!asInstant) continue;
      if (card.faceDown && !fromArsenal && fromZone !== "banish") continue;
      if (isFrozen(state, card)) continue;
      if (cardPlayRestrictedByModifier(state, seat, card)) continue;
      if (
        script?.canPlay &&
        !script.canPlay(runtime.makeCtx(state, seat, card, link, fromArsenal))
      ) continue;
      const targets = script?.playTargetOptions
        ? playTargetOptions(state, runtime, seat, card, link, fromArsenal)
        : [undefined];
      if (targets.length === 0) continue;
      if (!includeUnaffordable) {
        const perCardReduction = cardPlayReductionForSeat(card, seat);
        const printedAffordable = targets.some((targetCardInstanceId) =>
          canAfford(
            state,
            player,
            cardPlayCost(state, runtime, seat, card, link, {
              ...(script?.variablePlayCost
                ? { baseCostOverride: script.variablePlayCost.base +
                    (script.variablePlayCost.minimum ?? 0) * (script.variablePlayCost.resourcesPerX ?? 1) }
                : {}),
              targetCardInstanceId,
              perCardReduction,
            }),
            [card.instanceId],
          ));
        const alternativeCosts = alternativePlayCostOptions(state, player, card);
        const alternativeAffordable = targets.some((targetCardInstanceId) =>
          alternativeCosts.some((alternativeCostCardInstanceIds) =>
            canAfford(
              state,
              player,
              cardPlayCost(state, runtime, seat, card, link, {
                alternativeCost: true,
                targetCardInstanceId,
                perCardReduction,
              }),
              [card.instanceId, ...alternativeCostCardInstanceIds],
            )));
        if (!printedAffordable && !alternativeAffordable) continue;
      }
      out.push({ card, fromArsenal, ...(fromZone ? { fromZone } : {}) });
    }
  }
  return out;
}

/** Permanents whose instant-speed abilities are usable in a layer window for
 *  `seat`: hero, equipment, board cards, the weapon slots (off-hand equipment
 *  like Compass of Sunken Depths lives there) — and the attacking card, which
 *  is in the arena while it is on the combat chain. */
function windowAbilitySources(state: GameStateInternal, seat: number): CardInstance[] {
  const player = state.players[seat] as PlayerState;
  const link = currentLink(state);
  return [
    ...(!heroAbilitiesDisabled(state, seat) ? [player.hero] : []),
    ...(Object.values(player.equipment).filter((c): c is CardInstance => !!c)),
    ...player.weapons,
    ...player.board,
    ...(link && link.attacker === seat ? [link.attackingCard] : []),
  ];
}

/** True if `seat` could activate an instant-speed ability of a permanent (or
 *  of their attacking card) right now. */
function anyWindowAbility(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  includeUnaffordable = false,
): boolean {
  if (opposingActionsProhibited(state, seat) || opposingInstantsProhibited(state, seat) || defendingHeroCannotRespondBelowPower(state, runtime, seat)) return false;
  const player = state.players[seat] as PlayerState;
  const link = currentLink(state);
  for (const card of windowAbilitySources(state, seat)) {
    if (activatedAbilitiesSuppressed(state, card)) continue;
    const abilities = effectiveAbilityList(state, seat, card);
    for (let ai = 0; ai < abilities.length; ai++) {
      const ability = abilities[ai]!;
      if (ability.isAttack || ability.fromHand) continue;
      // Cloaked: only flip-up cost abilities function while face-down
      if (card.faceDown && !ability.turnsFaceUp && !ability.usableWhileFaceDown) continue;
      if ((ability.timing ?? "action") !== "instant") continue;
      if (!activatedAbilityAvailable(player, card.instanceId, ai, ability)) continue;
      if (ability.tap && card.tapped) continue;
      if (ability.canActivate && !ability.canActivate(runtime.makeCtx(state, seat, card, link))) continue;
      if (!includeUnaffordable && !canPayAbilityLifeCost(player, ability)) continue;
      if (
        ability.discardCost &&
        discardCostOptions(state, player, ability).length < ability.discardCost.count
      ) {
        continue;
      }
      if (
        !includeUnaffordable &&
        !canAfford(
          state,
          player,
          abilityResourceCost(state, runtime, seat, card, ability, link),
          [card.instanceId],
          ability.chiCost,
        )
      ) continue;
      return true;
    }
  }
  // from-hand instant abilities (Amp — the card is discarded as the cost)
  for (const card of player.hand) {
    if (card.faceDown) continue;
    const abilities = effectiveAbilityList(state, seat, card);
    for (let ai = 0; ai < abilities.length; ai++) {
      const ability = abilities[ai]!;
      if (!ability.fromHand || ability.isAttack) continue;
      if ((ability.timing ?? "action") !== "instant") continue;
      if (!activatedAbilityAvailable(player, card.instanceId, ai, ability)) continue;
      if (ability.canActivate && !ability.canActivate(runtime.makeCtx(state, seat, card, link))) continue;
      if (!includeUnaffordable && !canPayAbilityLifeCost(player, ability)) continue;
      if (
        ability.discardCost &&
        discardCostOptions(state, player, ability)
          .filter((candidate) => candidate.instanceId !== card.instanceId).length < ability.discardCost.count
      ) continue;
      if (!canPayActivatedEffectCardCosts(state, player, ability)) continue;
      return true;
    }
  }
  return false;
}

function anyWindowAction(state: GameStateInternal, runtime: EngineRuntime): boolean {
  return (
    windowInstantPlays(state, runtime, 0).length > 0 ||
    windowInstantPlays(state, runtime, 1).length > 0 ||
    anyWindowAbility(state, runtime, 0) ||
    anyWindowAbility(state, runtime, 1)
  );
}

/** Start and End Phase layers resolve as if every player passes priority.
 * Game-over is terminal; every other engine phase may expose a real window. */
function phaseAllowsPriority(state: GameStateInternal): boolean {
  return state.phase !== "start" && state.phase !== "end" && state.phase !== "game-over";
}

/**
 * Priority-window prompt for viewer `forSeat`. The top layer's source is named
 * unless it is a face-down card the viewer doesn't own (e.g. an unflipped
 * mentor) — its identity stays secret.
 */
export function windowPrompt(state: GameStateInternal, forSeat: number | null): string {
  const layer = state.stack[0];
  if (layer) {
    // card layers (instants) are public: the card was played openly
    if (layer.card) {
      return `${nameOf(state, layer.card.cardId)} on the stack — play an instant or pass`;
    }
    const found = findCardAnywhere(state, layer.sourceInstanceId);
    const secret = found && found.card.faceDown && found.card.owner !== forSeat;
    const name = secret
      ? "A face-down card"
      : found
        ? nameOf(state, found.card.cardId)
        : "Triggered ability";
    if (layer.ability) {
      return `${name}'s ability on the stack — play an instant or pass`;
    }
    return `${name} triggers: ${layer.label} — play an instant or pass`;
  }
  const link = currentLink(state);
  if (link) {
    return link.flags.attackStepBegan === true
      ? `${nameOf(state, link.attackingCard.cardId)} is attacking — play an instant or pass`
      : `${nameOf(state, link.attackingCard.cardId)} on the stack — play an instant or pass`;
  }
  return "Priority — play an instant or pass";
}

function openWindow(state: GameStateInternal, seat?: number, initialPasses = 0): void {
  // An explicit seat keeps priority after adding a new layer. After a layer
  // resolves, callers omit the seat (or pass the turn player) per CR 1.11.3.
  const priority = seat ?? state.activePlayer;
  state.phase = "layer";
  state.stackPasses = initialPasses;
  state.priorityPlayer = priority;
  state.pendingDecision = {
    player: priority,
    kind: "priority-window",
    prompt: windowPrompt(state, priority),
  };
}

/** Finish the Damage Step after combat damage. Players receive priority before
 * the step ends; once both pass, the link enters and completes the beginning
 * of its Resolution Step. Skip the window when neither player has an
 * instant-speed action. */
export function finishDamageStep(state: GameStateInternal, runtime: EngineRuntime): void {
  const link = currentLink(state);
  // Damage observers may pause on a direct scripted choice. Preserve that
  // choice through the existing link-resolution continuation instead of
  // replacing it with a priority window.
  if (state.pendingDecision?.chooseHook) {
    if (link) runtime.dispatchFlow("finishLinkResolution", state, link);
    return;
  }
  if (!link) return;
  // Event-based triggers generated during combat damage are added before the
  // next priority point (CR 6.6.6). Expose those layers instead of opening an
  // empty Damage Step window ahead of them.
  if ((state.pendingTriggeredLayers?.length ?? 0) > 0) {
    state.stackResume = "finish-link-resolution";
    continueStack(state, runtime);
    return;
  }
  if (link.flags.damageStepPriorityOpened !== true && anyWindowAction(state, runtime)) {
    link.flags.damageStepPriorityOpened = true;
    state.stackResume = "finish-link-resolution";
    openWindow(state);
    return;
  }
  runtime.dispatchFlow("finishLinkResolution", state, link);
}

/** The layer window's priority protocol (see passPriorityWindow/holdPriorityWindow). */
function priorityWindow(runtime: EngineRuntime): PriorityWindow {
  return {
  phase: "layer",
  passField: "stackPasses",
  noWindowError: "no priority window",
  buildDecision: (state, player) => ({
    player,
    kind: "priority-window",
    prompt: windowPrompt(state, player),
  }),
    onBothPass: (state) => advanceStack(state, runtime),
  };
}

export function passWindow(state: GameStateInternal,
  runtime: EngineRuntime, seat: number): string | undefined {
  if (state.pendingDecision?.kind !== "priority-window") {
    return "no priority window";
  }
  return passPriorityWindow(state, seat, priorityWindow(runtime));
}

/**
 * The turn-player's empty-stack pass does not end the action phase by itself:
 * every other player must also pass in succession (CR 4.3.4). Open the
 * opponent's priority window when they have an instant-speed play candidate;
 * otherwise the caller may advance directly to the end phase. Candidate
 * discovery deliberately ignores resource affordability so it matches the
 * actions the client presents and does not auto-pass underneath one of them.
 */
export function offerEndActionPriority(
  state: GameStateInternal,
  runtime: EngineRuntime,
  passingSeat: number,
): boolean {
  const nextSeat = opponent(passingSeat);
  if (
    windowInstantPlays(state, runtime, nextSeat, true).length === 0 &&
    !anyWindowAbility(state, runtime, nextSeat, true)
  ) {
    return false;
  }
  state.stackResume = "end-action-phase";
  // The turn-player's pass is already the first consecutive pass.
  openWindow(state, nextSeat, 1);
  return true;
}

/** Playing or activating during the proposed end-of-action window cancels
 * that proposal. Once the response stack empties, ordinary action priority
 * returns to the turn player. */
export function cancelEndActionPass(state: GameStateInternal): void {
  if (state.stackResume === "end-action-phase") state.stackResume = "begin-action";
}

/** `seat` keeps priority in the layer window (e.g. after activating an
 *  instant-speed ability). */
export function holdLayerWindow(state: GameStateInternal,
  runtime: EngineRuntime, seat: number): void {
  holdPriorityWindow(state, seat, priorityWindow(runtime));
}

export function playWindowInstant(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  instanceId: number,
  fromArsenal: boolean,
  pitchInstanceIds: number[],
  meldSide?: MeldSide,
  targetCardInstanceId?: number,
  fromZone?: PlayableZone,
  declaredVariableX?: number,
  alternativeCostCardInstanceIds?: number[],
): string | undefined {
  if (state.phase !== "layer" || (
    declaredVariableX === undefined && state.pendingDecision?.kind !== "priority-window"
  )) {
    return "no priority window";
  }
  if (state.priorityPlayer !== seat) return "not your priority";
  if (opposingInstantsProhibited(state, seat)) return "opposing effect prohibits instants";
  if (defendingHeroCannotRespondBelowPower(state, runtime, seat)) return "defending hero cannot respond to this attack";
  const player = state.players[seat] as PlayerState;
  const source = fromZone
    ? ((state.players as PlayerState[]).find((owner) =>
        owner[fromZone].some((candidate) => candidate.instanceId === instanceId)
      )?.[fromZone] ?? player[fromZone])
    : fromArsenal
    ? ((state.players as PlayerState[]).find((owner) =>
        owner.arsenal.some((candidate) => candidate.instanceId === instanceId)
      )?.arsenal ?? player.arsenal)
    : player.hand.some((candidate) => candidate.instanceId === instanceId)
      ? player.hand
      : player.banish.find((candidate) =>
          candidate.instanceId === instanceId && mayPlayFromZone(state, runtime, candidate, "banish", seat)
        )
        ? player.banish
        : player.hand;
  const card = source.find((c) => c.instanceId === instanceId);
  if (!card) return "card not found in that zone";
  if (fromArsenal && !mayPlayFromArsenal(state, card, seat)) {
    return `${nameOf(state, card.cardId)} may not be played from arsenal`;
  }
  const data = instanceDataOf(state, card);
  const link = currentLink(state);
  const script = scriptOf(state, card.cardId, card);
  if (script?.meld && !meldSide) return "choose a meld side";
  if (!script?.meld && meldSide) return `${nameOf(state, card.cardId)} does not have meld`;
  if (meldSide && meldSideHasType(state, card, meldSide, "action")) {
    return "only instants can be played in a priority window";
  }
  if (meldSide) card.meldSide = meldSide;
  if (data.cardType !== "instant") {
    // an action whose script allows it may be played as though it were an instant
    const asInstant = canPlayAsInstant(state, runtime, seat, card, link, fromZone ?? (fromArsenal ? "arsenal" : "hand"));
    if (!asInstant) return "only instants can be played in a priority window";
  }
  if (card.faceDown && !fromArsenal && source !== player.banish) {
    return "face-down cards cannot be played";
  }
  if (isFrozen(state, card)) return `${nameOf(state, card.cardId)} is frozen`;
  if (cardPlayRestrictedByModifier(state, seat, card)) {
    return `${nameOf(state, card.cardId)} cannot be played due to a card-type restriction`;
  }
  if (script?.canPlay && !script.canPlay(runtime.makeCtx(state, seat, card, link, fromArsenal))) {
    return `${nameOf(state, card.cardId)} cannot be played now`;
  }
  if (alternativeCostCardInstanceIds !== undefined && !script?.alternativePlayCost) {
    return `${nameOf(state, card.cardId)} has no alternative play cost`;
  }
  if (alternativeCostCardInstanceIds?.some((id) => pitchInstanceIds.includes(id))) {
    return "cannot pitch an alternative-cost card";
  }
  const targetErr = preparePlayTarget(
    state, runtime,
    seat,
    card,
    targetCardInstanceId,
    link,
    fromArsenal,
  );
  if (targetErr) return targetErr;
  const variableCost = alternativeCostCardInstanceIds === undefined
    ? script?.variablePlayCost
    : undefined;
  const costForBase = (baseCostOverride?: number): number => cardPlayCost(state, runtime, seat, card, link, {
    ...(baseCostOverride === undefined ? {} : { baseCostOverride }),
    meldSide,
    alternativeCost: alternativeCostCardInstanceIds !== undefined,
    targetCardInstanceId,
    perCardReduction: cardPlayReductionForSeat(card, seat),
  });
  let variableBaseCost: number | undefined;
  if (variableCost) {
    if (declaredVariableX === undefined) {
      if (pitchInstanceIds.length > 0) return "declare X before pitching for this card";
      const resolvedVariableCost = resolveVariablePlayCost(
        variableCost,
        runtime.makeCtx(state, seat, card, link, fromArsenal),
      );
      const choices = variableResourceChoices(
        state,
        player,
        card.instanceId,
        resolvedVariableCost,
        costForBase,
      );
      const options = Object.keys(choices);
      if (options.length === 0) return "not enough resources";
      const origin = fromZone ?? (fromArsenal
        ? "arsenal"
        : source === player.banish ? "banish" : "hand");
      state.pendingDecision = {
        player: seat,
        kind: "choose-target",
        prompt: resolvedVariableCost.prompt ?? "Choose X",
        options,
        sourceInstanceId: card.instanceId,
        chooseHook: "engine-variable-play-x",
        variablePlayCost: {
          mode: "window",
          seat,
          instanceId: card.instanceId,
          from: origin,
          choices,
          ...(meldSide ? { meldSide } : {}),
          ...(targetCardInstanceId === undefined ? {} : { targetCardInstanceId }),
        },
      };
      return undefined;
    }
    const resolvedVariableCost = resolveVariablePlayCost(
      variableCost,
      runtime.makeCtx(state, seat, card, link, fromArsenal),
    );
    if (!isValidVariableX(declaredVariableX, resolvedVariableCost)) {
      return "invalid X declaration";
    }
    variableBaseCost = variableResourceCost(resolvedVariableCost, declaredVariableX);
  }
  const cost = costForBase(variableBaseCost);
  if (!canPayRequiredHandCardsForAdditionalCost(
    state,
    seat,
    card,
    [...pitchInstanceIds, ...(alternativeCostCardInstanceIds ?? [])],
  )) return "cannot pay the card's additional hand-card cost";
  const costErr = payCost(state, runtime, player, cost, pitchInstanceIds, card.instanceId, {
    beforePitch: () =>
      logPublic(state, `${nameOf(state, player.heroCardId)} plays ${logNameOf(state, card.cardId)} in response`),
  });
  if (costErr) return costErr;
  if (variableCost) (card.counters ??= {})[variableCost.counterKey] = declaredVariableX!;
  if (alternativeCostCardInstanceIds !== undefined) {
    const alternativeErr = payAlternativePlayCost(
      state, runtime,
      player,
      card,
      alternativeCostCardInstanceIds,
      link,
    );
    if (alternativeErr) return alternativeErr;
  }
  removeFromArray(source, card.instanceId);
  delete card.faceDown;
  const origin = fromZone ?? (fromArsenal ? "arsenal" : source === player.banish ? "banish" : "hand");
  script?.additionalCost?.(runtime.makeCtx(state, seat, card, link, fromArsenal));
  const pdCost = state.pendingDecision;
  if (pdCost?.chooseHook) {
    pdCost.resume = { kind: "finish-window-instant", seat, card, from: origin };
    state.resolving.push(card);
    return undefined;
  }
  finishWindowInstantPlay(state, runtime, seat, card, origin);
  return undefined;
}

export function finishWindowInstantPlay(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  origin: "hand" | "arsenal" | PlayableZone,
): void {
  cancelEndActionPass(state);
  const player = state.players[seat] as PlayerState;
  const { goAgain, layers: playedTriggers } = announceCardPlayed(state, runtime, seat, card, origin);
  // the instant becomes the top stack layer: its effect resolves only once
  // both players pass in succession (CR 5.3.2)
  pushCardLayer(state, seat, card, { fromHand: origin === "hand", goAgain });
  state.stack.unshift(...playedTriggers);
  if (state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume = { kind: "continue-stack", seat };
    return;
  }
  // the priority holder keeps priority and may play more instants;
  // priority only passes when they pass
  holdPriorityWindow(state, seat, priorityWindow(runtime));
}

/** Shared play-event announcement. All card-play paths use this exact order so
 * actions played as instants receive the same penalties, observers, go-again
 * grants, and triggered abilities as ordinary action-phase plays. */
export function announceCardPlayed(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  origin: "hand" | "arsenal" | PlayableZone,
): { goAgain: boolean; layers: StackLayer[] } {
  const player = state.players[seat] as PlayerState;
  // The played object is already public but has not reached the stack yet.
  // Keep it in the resolving zone while announcement queries its declared Meld
  // side, so an instant half is not treated as the card's combined action and
  // instant object.
  const alreadyResolving = state.resolving.some(
    (resolving) => resolving.instanceId === card.instanceId,
  );
  if (!alreadyResolving) state.resolving.push(card);
  try {
    const playEventNextId = state.nextInstanceId;
    const layers = [
      ...noteCardPlayed(state, player, card),
      ...collectCardPlayedTriggerLayers(state, runtime, seat, card, playEventNextId, origin),
    ];
    if (
      cardHasType(state, card, "action") &&
      Number(player.hero.counters?.loseLifeOnActionUntilTurn ?? 0) >= state.turn
    ) {
      layers.push({
        sourceInstanceId: Number(player.hero.counters?.loseLifeOnActionSource ?? player.hero.instanceId),
        seat,
        triggerIndex: -2,
        label: "Lose 1 life for playing an action card",
        optional: false,
        engineEffect: { kind: "lose-life", amount: 1 },
      });
      logPublic(state, `${nameOf(state, player.heroCardId)}'s delayed effect triggers: lose 1 life`);
    }
    runtime.events.fireOnFriendlyPlay(state, seat, card, origin);
    return {
      goAgain: cardLayerGoAgain(state, player, card),
      layers,
    };
  } finally {
    if (!alreadyResolving) removeFromArray(state.resolving, card.instanceId);
  }
}

function runTriggerEffect(state: GameStateInternal,
  runtime: EngineRuntime, layer: StackLayer): void {
  const found = findCardAnywhere(state, layer.sourceInstanceId);
  const definitionSource = layer.triggerSource ?? found?.card;
  const contextSource = found?.card ?? definitionSource;
  if (!definitionSource || !contextSource) {
    logPublic(state, "A triggered ability fizzles (its source is gone)");
    return;
  }
  const script: CardScript | undefined = scriptOf(
    state,
    definitionSource.cardId,
    definitionSource,
  );
  const def = script?.triggers?.[layer.triggerIndex];
  def?.effect?.(
    runtime.makeCtx(state, layer.seat, contextSource, currentLink(state)),
    layer.triggerEventCard,
  );
}

/** Consume one occurrence from the top counted trigger layer. */
function consumeTopTriggerOccurrence(state: GameStateInternal, layer: StackLayer): void {
  const count = layer.triggerCount ?? 1;
  if (count <= 1) {
    state.stack.shift();
    return;
  }
  // Keep the final occurrence marked as counted. If resolution pauses on a
  // scripted choice, continueStack can resume this same atomic batch without
  // reopening priority for it.
  layer.triggerCount = count - 1;
  layer.triggerBatchStarted = true;
  // A counted optional layer asks independently for every occurrence.
  delete layer.accepted;
}

/**
 * Resolve a non-attack activated-ability layer. Returns true when resolution
 * paused on a scripted choice — answerChoice then finishes it via the
 * stack-card resume.
 */
export function resolveAbilityLayer(state: GameStateInternal,
  runtime: EngineRuntime, layer: StackLayer): boolean {
  const found = findCardAnywhere(state, layer.sourceInstanceId);
  if (!found) {
    logPublic(state, "An activated ability fizzles (its source is gone)");
    return false;
  }
  const ability = effectiveAbilityList(state, layer.seat, found.card)[layer.abilityIndex ?? 0];
  const link = currentLink(state);
  ability?.onActivate?.(runtime.makeCtx(state, layer.seat, found.card, link));
  if (
    link &&
    (ability?.timing === "attack-reaction" || ability?.timing === "defense-reaction")
  ) {
    layer.resolvedReactionAbility = true;
  }
  const pd = state.pendingDecision;
  if (pd?.chooseHook) {
    // Resolution paused on a choice. The source may be a permanent created by
    // the ability (for example, a newly created cog offering Crank).
    pd.resume = { kind: "stack-card", seat: layer.seat, card: found.card };
    state.resolving.push(found.card);
    return true;
  }
  return false;
}

/** Ask the controller whether an optional trigger fires (trigger resolution). */
function askTriggerChoice(state: GameStateInternal, layer: StackLayer): void {
  const found = findCardAnywhere(state, layer.sourceInstanceId);
  const name = found ? nameOf(state, found.card.cardId) : "Triggered ability";
  state.pendingDecision = {
    player: layer.seat,
    kind: "optional-effect",
    prompt: `${name}: ${layer.label}`,
    options: ["yes", "no"],
    sourceInstanceId: layer.sourceInstanceId,
    chooseHook: "trigger-choice",
    ...(layer.defaultOption ? { defaultOption: layer.defaultOption } : {}),
  };
}

/** Both players passed (or nobody could respond): resolve the top layer. */
function advanceStack(state: GameStateInternal, runtime: EngineRuntime): void {
  const layer = state.stack[0];
  if (!layer) {
    finishStack(state, runtime);
    return;
  }
  if (layer.card) {
    resolveTopStackCard(state, runtime);
    return;
  }
  if (layer.ability) {
    if (!resolveAbilityLayer(state, runtime, layer)) finishStackCardResolution(state, runtime, layer.seat);
    return;
  }
  if (layer.engineEffect?.kind === "gain-action-points") {
    if (layer.seat === state.activePlayer) {
      (state.players[layer.seat] as PlayerState).actionPoints += layer.engineEffect.amount;
      logPublic(
        state,
        `${nameOf(state, (state.players[layer.seat] as PlayerState).heroCardId)} gains ${layer.engineEffect.amount} action point(s)`,
      );
    }
    state.stack.shift();
    continueStack(state, runtime, layer.seat);
    return;
  }
  if (layer.engineEffect?.kind === "lose-life") {
    const player = state.players[layer.seat] as PlayerState;
    player.life = Math.max(0, player.life - layer.engineEffect.amount);
    player.flags.lostLifeThisTurn = true;
    logPublic(state, `${nameOf(state, player.heroCardId)} loses ${layer.engineEffect.amount} life`);
    state.stack.shift();
    continueStack(state, runtime, layer.seat);
    return;
  }
  if (layer.engineEffect?.kind === "delayed-trigger") {
    state.stack.shift();
    const { source, hook } = layer.engineEffect;
    scriptOf(state, source.cardId, source)?.onDelayedTrigger?.(
      runtime.makeCtx(state, layer.seat, source, currentLink(state)),
      hook,
    );
    if (state.pendingDecision?.chooseHook) {
      state.pendingDecision.resume = { kind: "continue-stack", seat: layer.seat };
      return;
    }
    continueStack(state, runtime, layer.seat);
    return;
  }
  if (layer.engineEffect?.kind === "phantasm-destroy") {
    state.stack.shift();
    const destroyed = runtime.dispatchFlow("resolvePhantasmLayer", state, layer.sourceInstanceId);
    if (destroyed) {
      state.stackResume = null;
      if (state.pendingDecision?.chooseHook) {
        if (state.stack.length > 0) {
          state.pendingDecision.resume = { kind: "continue-stack", seat: layer.seat };
        }
        return;
      }
      if (state.stack.length > 0) continueStack(state, runtime, layer.seat);
      return;
    }
    continueStack(state, runtime, layer.seat);
    return;
  }
  if (layer.engineEffect?.kind === "spectra-destroy") {
    state.stack.shift();
    const clearedAttack = runtime.dispatchFlow("resolveSpectraLayer", state, layer.sourceInstanceId);
    if (clearedAttack) {
      state.stackResume = null;
      if (state.pendingDecision?.chooseHook) {
        if (state.stack.length > 0) {
          state.pendingDecision.resume = { kind: "continue-stack", seat: layer.seat };
        }
        return;
      }
      if (state.stack.length > 0) continueStack(state, runtime, layer.seat);
      return;
    }
    continueStack(state, runtime, layer.seat);
    return;
  }
  if (layer.engineEffect?.kind === "watery-grave") {
    state.stack.shift();
    const owner = state.players[layer.seat] as PlayerState;
    const card = owner.graveyard.find(
      (candidate) => candidate.instanceId === layer.sourceInstanceId,
    );
    if (card && !card.faceDown) {
      const name = nameOf(state, card.cardId);
      card.faceDown = true;
      logPublic(state, `${name} is turned face down in its graveyard (Watery Grave)`);
    } else {
      logPublic(state, "Watery Grave resolves without effect (its source left the graveyard)");
    }
    continueStack(state, runtime, layer.seat);
    return;
  }
  if (
    layer.engineEffect?.kind === "on-hit-hook" ||
    layer.engineEffect?.kind === "on-hit-modifier" ||
    layer.engineEffect?.kind === "on-effect-hit-hook" ||
    layer.engineEffect?.kind === "on-friendly-effect-hit-hook"
  ) {
    state.stack.shift();
    if (layer.engineEffect.kind === "on-effect-hit-hook") {
      const { source, targetSeat } = layer.engineEffect;
      scriptOf(state, source.cardId, source)?.onEffectHit?.(
        runtime.makeCtx(state, layer.seat, source, currentLink(state)),
        targetSeat,
      );
    } else if (layer.engineEffect.kind === "on-friendly-effect-hit-hook") {
      const { source, hitSource, targetSeat, targetWasMarked } = layer.engineEffect;
      scriptOf(state, source.cardId, source)?.onFriendlyEffectHit?.(
        runtime.makeCtx(state, layer.seat, source, currentLink(state)),
        hitSource,
        targetSeat,
        targetWasMarked,
      );
    } else {
      runtime.dispatchFlow("resolveOnHitLayer", state, layer);
    }
    if (state.pendingDecision?.chooseHook) {
      state.pendingDecision.resume = { kind: "continue-stack", seat: layer.seat };
      return;
    }
    continueStack(state, runtime, layer.seat);
    return;
  }
  if (
    layer.engineEffect?.kind === "on-defend-hook" ||
    layer.engineEffect?.kind === "on-friendly-defended-hook" ||
    layer.engineEffect?.kind === "on-defended-modifier" ||
    layer.engineEffect?.kind === "fragment" ||
    layer.engineEffect?.kind === "on-fragment-hook"
  ) {
    runtime.dispatchFlow("resolveDefendEventLayer", state, layer);
    state.stack.shift();
    if (state.pendingDecision?.chooseHook) {
      state.pendingDecision.resume = { kind: "continue-stack", seat: layer.seat };
      return;
    }
    continueStack(state, runtime, layer.seat);
    return;
  }
  if (layer.engineEffect?.kind === "wager-result") {
    state.stack.shift();
    runtime.dispatchFlow("resolveWagerLayer", state, layer);
    if (state.pendingDecision?.chooseHook) {
      state.pendingDecision.resume ??= { kind: "continue-stack", seat: layer.seat };
      return;
    }
    continueStack(state, runtime, layer.seat);
    return;
  }
  if (layer.optional && !layer.accepted) {
    askTriggerChoice(state, layer);
    return;
  }
  runTriggerEffect(state, runtime, layer);
  consumeTopTriggerOccurrence(state, layer);
  // a scripted choice queued by the trigger effect (Bloodrot Pox's "unless
  // you pay") pauses the stack machine — continue once it is answered
  if (state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume = { kind: "continue-stack", seat: layer.seat };
    return;
  }
  // the resolved trigger's controller regains priority (pass or play on)
  continueStack(state, runtime, layer.seat);
}

/**
 * Resolve the top layer when it is a played card (non-attack action, instant,
 * attack / defense reaction). A defense reaction resolves as a defending card
 * on the active chain link (8.1.3b) and fails to resolve when a rule prevents
 * it from becoming one (CR 7.4.2c/d — e.g. Dominate once the link was already
 * defended from hand); a failed layer is cleared to the graveyard when it
 * leaves the stack. An action/instant that enters the arena (aura/item/ally)
 * settles as a permanent; anything else goes to its owner's graveyard after
 * its resolution abilities and choices are complete.
 */
export function resolveTopStackCard(state: GameStateInternal, runtime: EngineRuntime): void {
  const layer = state.stack[0];
  const card = layer?.card;
  if (!layer || !card) return;
  const seat = layer.seat;
  const link = currentLink(state);
  // A melded split card resolves its layer twice (right half, priority, left
  // half): stage 1 runs the right half and keeps the layer — and the card —
  // on the stack; zone placement happens only when the layer actually leaves
  // at the end of stage 2.
  if (card.meldSide === "both" && layer.meldStage === undefined) {
    layer.meldStage = 1;
    card.meldSide = "right";
  }
  const isDefReact = dataOf(state, card.cardId).cardType === "defense-reaction";
  if (layer.meldStage !== 1 && link && isDefReact) {
    if (layer.fromHand && attackHasDominate(state, link) && link.flags.defendedFromHand === true) {
      logPublic(state, `${nameOf(state, card.cardId)} fails to resolve (Dominate)`);
      finishStackCardResolution(state, runtime, seat, false);
      return;
    }
    // scripted defend legality ("this can only defend an attack with 3 or
    // less base {p}") also gates a defense reaction resolving into a defender
    const canDefend = scriptOf(state, card.cardId, card)?.canDefend;
    if (canDefend && !canDefend(runtime.makeCtx(state, seat, card, link))) {
      logPublic(state, `${nameOf(state, card.cardId)} fails to resolve (it cannot defend this attack)`);
      finishStackCardResolution(state, runtime, seat, false);
      return;
    }
    if (!runtime.dispatchFlow("attackAllowsDefender", state, link, card, layer.fromHand === true)) {
      logPublic(state, `${nameOf(state, card.cardId)} fails to resolve (it cannot defend this attack)`);
      finishStackCardResolution(state, runtime, seat, false);
      return;
    }
  }
  runtime.events.runHook(state, seat, card, "onPlay", link, !layer.fromHand);
  const pd = state.pendingDecision;
  if (pd?.chooseHook) {
    // An item created or moved into the arena by this effect can offer Crank,
    // but that decision opens only after the originating card leaves the stack.
    if (pd.chooseHook === "engine-crank") {
      finishStackCardResolution(state, runtime, seat);
      return;
    }
    // Resolution paused on a choice. The source may be a permanent created by
    // this card rather than the resolving card itself.
    pd.resume = { kind: "stack-card", seat, card };
    state.resolving.push(card);
    return;
  }
  finishStackCardResolution(state, runtime, seat);
}

/**
 * The resolved card's layer leaves the stack, any queued intimidate resolves,
 * and play continues per the current step: reaction-step windows reopen for
 * the attacker (the turn player regains priority after each layer resolves),
 * the layer step runs its stack machine.
 */
export function finishStackCardResolution(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  resolvedSuccessfully = true,
): void {
  const layer = state.stack[0];
  // A melded layer's first (right-half) resolution is done: players get
  // priority again, then the same layer resolves its left half — it leaves
  // the stack only after that second resolution.
  if (layer?.meldStage === 1 && layer.card) {
    layer.meldStage = 2;
    layer.card.meldSide = "left";
    continueStack(state, runtime, state.activePlayer);
    return;
  }
  if (layer?.card && scriptOf(state, layer.card.cardId, layer.card)?.meld) {
    // The declared side(s) apply only to this stack object's existence. Once
    // it leaves, the new split-card object again has both sides (CR 9.2.2).
    delete layer.card.meldSide;
  }
  // A non-attack action card or ability with go again refunds its action point
  // only now that its layer resolves.
  const gainedGoAgain = layer?.goAgain === true && layer.seat === state.activePlayer &&
    !goAgainSuppressed(state, layer.seat);
  if (gainedGoAgain) {
    (state.players[layer.seat] as PlayerState).actionPoints += 1;
  }
  if (layer?.resolvedReactionAbility && layer.abilityCard) {
    const link = currentLink(state);
    const abilityCard = layer.abilityCard;
    if (
      link &&
      !link.resolvedReactionAbilitySources?.some(
        (source) => source.instanceId === abilityCard.instanceId,
      )
    ) {
      (link.resolvedReactionAbilitySources ??= []).push(abilityCard);
    }
  }
  // A card-layer changes zones only after its resolution abilities and go
  // again have finished (CR 5.3.4-5.3.7). Cards displayed on a combat-chain
  // link remain there until the chain closes. A script that explicitly moved
  // its own source has already cleared layer.card, so it is not moved again.
  const resolvedCard = layer?.card;
  if (resolvedCard) {
    const link = currentLink(state);
    const cardType = dataOf(state, resolvedCard.cardId).cardType;
    if (resolvedSuccessfully && link && cardType === "defense-reaction") {
      // CR 5.3.6b: only after its layer effects and go again are complete does
      // a defense reaction leave the stack and become a defending card.
      link.defendingCards.push(resolvedCard);
      applyOneShotDefenseModifiers(state, link, [resolvedCard]);
      const fragmentTriggered = noteAttackDefendedBy(state, runtime, link, resolvedCard);
      if (layer.fromHand) {
        link.flags.defendedFromHand = true;
        link.flags[`defendedFromHand:${resolvedCard.instanceId}`] = true;
        link.flags.defendedFromHandCount = Number(link.flags.defendedFromHandCount ?? 0) + 1;
      }
      runtime.dispatchFlow(
        "queueDefendEventLayersAfterCurrent",
        state,
        link,
        [{ card: resolvedCard, fragmentTriggered }],
        layer.fromHand === true,
      );
    } else if (resolvedSuccessfully && link && cardType === "attack-reaction") {
      // Attack reactions are retained with the chain link for presentation and
      // chain-close settlement, but not until their stack effects are complete.
      link.reactions.push(resolvedCard);
    }
    const remainsOnChain = state.chain.some((link) =>
      link.attackingCard.instanceId === resolvedCard.instanceId ||
      link.defendingCards.some((card) => card.instanceId === resolvedCard.instanceId) ||
      link.defendingEquipment.some((card) => card.instanceId === resolvedCard.instanceId) ||
      link.reactions.some((card) => card.instanceId === resolvedCard.instanceId)
    );
    if (settlesInArena(state, resolvedCard)) {
      settlePlayedCard(state, runtime, state.players[layer.seat] as PlayerState, resolvedCard);
    } else if (!remainsOnChain) {
      moveToGraveyard(state, runtime, resolvedCard, "stack");
    }
  }
  // Zone-entry hooks can queue new layers. Remove this exact resolved layer,
  // rather than blindly shifting the current top after those hooks run. The
  // layer remains present during arena entry so an effect-driven ally attack
  // is correctly deferred until this resolution is fully complete.
  const resolvedLayerIndex = layer ? state.stack.indexOf(layer) : -1;
  if (resolvedLayerIndex >= 0) state.stack.splice(resolvedLayerIndex, 1);
  runtime.dispatchFlow("consumeQueuedIntimidate", state, seat);
  if (gainedGoAgain) {
    runtime.events.notifyPlayerGainedGoAgain(state, layer.seat);
  }
  if (resolvedSuccessfully && resolvedCard) {
    runtime.events.runHook(state, seat, resolvedCard, "onResolved", currentLink(state), !layer?.fromHand);
  }
  // Entering the arena can open an on-enter or Crank choice. The card layer
  // has left the stack; resume the remaining stack machine after it is answered.
  if (state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume = { kind: "continue-stack", seat };
    return;
  }
  if (currentLink(state) && (state.phase === "reaction" || layer?.resolvedReactionAbility)) {
    // Effects resolved during the reaction step can generate triggers. Put
    // those layers on the stack before reopening priority; otherwise both
    // players can pass the reaction window and advance to damage while the
    // trigger is still deferred (for example, Check-Raise after Prized Galea
    // gives the attacking weapon wager).
    continueStack(state, runtime, state.activePlayer);
    return;
  }
  // CR 1.11.3 / 5.3.7: after a layer resolves, the turn player gains priority.
  continueStack(state, runtime, state.activePlayer);
}

export function answerTriggerChoice(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pd = state.pendingDecision;
  if (!pd || pd.chooseHook !== "trigger-choice" || pd.player !== seat) {
    return "not your decision";
  }
  if (pd.options && !pd.options.includes(optionId)) return "invalid option";
  const layer = state.stack[0];
  if (!layer || layer.sourceInstanceId !== pd.sourceInstanceId) return "no trigger to answer";
  state.pendingDecision = null;
  if (optionId === "yes") {
    // Both players have already passed over this optional trigger. Resolve
    // its accepted effect now without opening a second response window.
    layer.accepted = true;
    const found = findCardAnywhere(state, layer.sourceInstanceId);
    const definitionSource = layer.triggerSource ?? found?.card;
    const contextSource = found?.card ?? definitionSource;
    const def = definitionSource
      ? scriptOf(state, definitionSource.cardId, definitionSource)?.triggers?.[layer.triggerIndex]
      : undefined;
    if (contextSource && def?.onAccept) {
      def.onAccept(runtime.makeCtx(state, layer.seat, contextSource, currentLink(state)));
    }
    if (contextSource && def?.effect) {
      def.effect(
        runtime.makeCtx(state, layer.seat, contextSource, currentLink(state)),
        layer.triggerEventCard,
      );
    }
    consumeTopTriggerOccurrence(state, layer);
    const chained = state.pendingDecision as GameStateInternal["pendingDecision"];
    if (chained?.chooseHook) {
      chained.resume = { kind: "continue-stack", seat: layer.seat };
      return undefined;
    }
  } else {
    const found = findCardAnywhere(state, layer.sourceInstanceId);
    const hero = state.players[layer.seat] as PlayerState;
    const source = found?.card ?? layer.triggerSource;
    const secretName = source?.faceDown
      ? "a face-down trigger"
      : source
        ? nameOf(state, source.cardId)
        : "the trigger";
    logPublic(state, `${nameOf(state, hero.heroCardId)} declines ${secretName}`);
    consumeTopTriggerOccurrence(state, layer);
  }
  continueStack(state, runtime, layer.seat);
  return undefined;
}

/** Continue after a layer resolved or a window closed: next layer, window, or resume.
 *  `prioritySeat` — who gets priority if a window opens (the resolved layer's
 *  owner after a resolution; defaults to the turn player). */
export function continueStack(state: GameStateInternal,
  runtime: EngineRuntime, prioritySeat?: number): void {
  // A script may have opened a resumable payment/target choice while a card
  // was being played (friendly-play triggers such as Magmatic Carapace).
  // Never replace that decision with a priority window.
  if (state.pendingDecision?.chooseHook) return;
  const pendingTriggerGroups = takePendingTriggerGroups(state);
  if (pendingTriggerGroups.length > 0) {
    const baseStack = state.stack.splice(0);
    placeTriggers(state, runtime, pendingTriggerGroups, baseStack);
    return;
  }
  if (
    currentLink(state) &&
    (
      state.phase === "reaction" ||
      (state.phase === "layer" && state.stack.length === 0 && state.stackResume === null)
    )
  ) {
    runtime.dispatchFlow("reopenReactionWindow", state);
    return;
  }
  const top = state.stack[0];
  if (!top && !currentLink(state)) {
    const seat = prioritySeat ?? state.activePlayer;
    if (runtime.dispatchFlow("startNextQueuedPermanentAttack", state, seat)) return;
  }
  // Once the last layer resolves, play normally returns to the pending
  // continuation instead of holding an empty-stack window. Combat steps are
  // different: the turn player regains priority after a layer resolves, and
  // may now have a newly legal instant-speed action before the step ends (CR
  // 5.3.7, 7.5.3-7.5.4). The unresolved attack-layer also remains open until
  // it resolves into the Attack Step.
  const priorityAllowed = phaseAllowsPriority(state);
  const hasWindowAction = priorityAllowed && anyWindowAction(state, runtime);
  const combatStepContinuation = state.stackResume === "finish-link-resolution";
  // Played cards and activated abilities always create layers on the stack
  // (CR 5.1 / 5.2). Keep those layers pending for a real priority pass even
  // when neither player currently has a response.
  const announcedLayerPriority = top?.card !== undefined || top?.ability === true;
  // Callers explicitly supply the next priority holder after an action-phase
  // layer resolves (CR 1.11.3 / 5.3.7). Preserve that priority point for the
  // next layer even when it is a trigger with no currently playable response;
  // the client preference decides whether to auto-pass or pause there.
  const explicitLayerPriority =
    top !== undefined &&
    prioritySeat !== undefined &&
    priorityAllowed;
  // Once a counted interchangeable layer has started resolving, its remaining
  // occurrences are one simplified batch. Pending triggers were flushed above
  // and scripted choices return before this point, so only the redundant
  // priority round for the same layer is skipped.
  const continuingCountedLayer = top?.triggerBatchStarted === true;
  const unresolvedAttackLayer = state.stackResume === "start-attack-step";
  if (
    priorityAllowed &&
    (
      hasWindowAction ||
      (combatStepContinuation && !!top) ||
      announcedLayerPriority ||
      explicitLayerPriority
    ) &&
    !continuingCountedLayer &&
    (top || unresolvedAttackLayer || state.stackResume === "continue-attack" || combatStepContinuation)
  ) {
    // With no remaining layer, this is the Damage Step's empty-stack
    // priority point. Record it here so finishDamageStep does not open the
    // same priority point again after both players pass.
    if (!top && combatStepContinuation) {
      const link = currentLink(state);
      if (link) link.flags.damageStepPriorityOpened = true;
    }
    openWindow(state, prioritySeat);
    return;
  }
  advanceStack(state, runtime);
}

function finishStack(state: GameStateInternal, runtime: EngineRuntime): void {
  const resume: StackResume = state.stackResume ?? "begin-action";
  state.stackResume = null;
  state.pendingDecision = null;
  if (resume === "start-attack-step") {
    runtime.dispatchFlow("beginAttackStep", state);
    return;
  }
  if (resume === "continue-attack") {
    runtime.dispatchFlow("proceedWithAttack", state);
    return;
  }
  if (resume === "start-reaction-step") {
    runtime.dispatchFlow("beginReactionStep", state);
    return;
  }
  if (resume === "finish-link-resolution") {
    const link = currentLink(state);
    if (link) {
      if (link.flags.resolutionStepBegan === true) runtime.dispatchFlow("finishLinkResolution", state, link);
      else finishDamageStep(state, runtime);
    }
    return;
  }
  if (resume === "end-phase") {
    runtime.dispatchFlow("continueEndPhase", state);
    return;
  }
  if (resume === "end-action-phase") {
    runtime.dispatchFlow("endTurn", state);
    return;
  }
  if (resume === "begin-action-phase") {
    // The event occurs and its layers are created before the turn action point
    // is assigned. Then the action phase becomes interactive with 1 AP and the
    // already-created layers waiting on the stack (CR 4.3.1–4.3.3).
    const groups = collectEventTriggerLayers(
      state, runtime,
      "begin-action-phase",
      state.activePlayer,
    );
    (state.players[state.activePlayer] as PlayerState).actionPoints = 1;
    state.phase = "action";
    state.priorityPlayer = state.activePlayer;
    queueTriggeredLayers(
      state, runtime,
      groups,
      "grant-turn-action",
    );
    return;
  }
  // `grant-turn-action` is retained as a persisted continuation value and as
  // the projection marker for beginning-of-action-phase triggers. The action
  // point was assigned before those layers received priority; do not reset it
  // here because responses may have modified it.
  state.phase = "action";
  state.priorityPlayer = state.activePlayer;
}

/** Hold the Layer Step over an unresolved attack-layer. Once it resolves, the
 * Attack Step begins and attack-declared effects are generated. */
export function enterAttackLayerWindow(state: GameStateInternal, runtime: EngineRuntime): void {
  state.phase = "layer";
  state.stackResume = "start-attack-step";
  continueStack(state, runtime, currentLink(state)?.attacker ?? state.activePlayer);
}

/** Identity of a simultaneous trigger's effect — used to detect mechanically
 *  interchangeable layers that do not need an ordering prompt. */
function layerKey(state: GameStateInternal, layer: StackLayer): string {
  const found = findCardAnywhere(state, layer.sourceInstanceId);
  const triggerSource = found?.card ?? layer.triggerSource;
  const simultaneousKey = triggerSource && layer.triggerIndex >= 0
    ? scriptOf(state, triggerSource.cardId, triggerSource)?.triggers?.[layer.triggerIndex]?.simultaneousKey
    : undefined;
  if (simultaneousKey) return `simultaneous:${simultaneousKey}`;
  const source = triggerSource ?? (
    layer.engineEffect && "source" in layer.engineEffect
      ? layer.engineEffect.source
      : undefined
  );
  const d = source ? dataOf(state, source.cardId) : undefined;
  const effect = layer.engineEffect?.kind ?? `trigger:${layer.triggerIndex}`;
  return d ? `${d.name.toLowerCase()}|${d.pitch ?? 0}|${effect}` : `?|${layer.sourceInstanceId}|${effect}`;
}

/** Replace mechanically interchangeable simultaneous triggers with one
 * counted layer. The representative layer supplies the shared script effect;
 * counted resolution preserves one-at-a-time rules semantics. */
function coalesceInterchangeableLayers(
  state: GameStateInternal,
  layers: StackLayer[],
): StackLayer[] {
  const compacted: StackLayer[] = [];
  const byKey = new Map<string, StackLayer>();
  for (const layer of layers) {
    const key = layerKey(state, layer);
    if (!key.startsWith("simultaneous:")) {
      compacted.push(layer);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      const first = { ...layer };
      compacted.push(first);
      byKey.set(key, first);
      continue;
    }
    existing.triggerCount =
      (existing.triggerCount ?? 1) + (layer.triggerCount ?? 1);
  }
  return compacted;
}

/**
 * Place collected simultaneous trigger layers onto the stack, one seat's group
 * at a time. When a seat has multiple DISTINCT triggers, that player picks the
 * order; identical triggers (e.g. two Runechants) are pushed without asking.
 * The submitted list is resolution order (first item resolves first).
 */
function placeTriggers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  groups: { seat: number; layers: StackLayer[] }[],
  baseStack: StackLayer[] = [],
): void {
  const [head, ...rest] = groups;
  if (!head) {
    state.stack.push(...baseStack);
    // Adding triggered layers during an interactive phase is not an implicit
    // pass over the first one. Start- and end-phase layers still use the stack,
    // but resolve as if all players continuously pass priority (CR 4.2.1–4.2.2
    // and 4.4.1–4.4.3). Ordering simultaneous layers does not make an automatic
    // phase interactive.
    if (state.stack.length > 0 && phaseAllowsPriority(state)) openWindow(state);
    else continueStack(state, runtime);
    return;
  }
  const layers = coalesceInterchangeableLayers(state, head.layers);
  const distinct = new Set(layers.map((layer) => layerKey(state, layer)));
  if (layers.length <= 1 || distinct.size <= 1) {
    state.stack.push(...layers);
    placeTriggers(state, runtime, rest, baseStack);
    return;
  }
  const optionCounts = layers.map((layer) => layer.triggerCount ?? null);
  state.pendingDecision = {
    player: head.seat,
    kind: "order-triggers",
    prompt: "Order your triggered abilities",
    options: layers.map((layer) => `${layer.sourceInstanceId}:${layer.triggerIndex}`),
    optionLabels: layers.map((layer) => layer.label),
    ...(optionCounts.some((count) => count !== null) ? { optionCounts } : {}),
    cardOptions: layers.map((layer) => layer.sourceInstanceId),
    chooseHook: "trigger-order",
    triggerOrder: {
      remaining: layers,
      later: rest,
      ...(baseStack.length > 0 ? { baseStack } : {}),
    },
  };
}

/** Take layers created during a cost or resolving effect, grouped in turn
 * order so their controller can order distinct simultaneous triggers. */
function takePendingTriggerGroups(
  state: GameStateInternal,
): { seat: number; layers: StackLayer[] }[] {
  const pending = state.pendingTriggeredLayers;
  if (!pending || pending.length === 0) return [];
  state.pendingTriggeredLayers = [];
  return [state.activePlayer, opponent(state.activePlayer)].flatMap((seat) => {
    const layers = pending.filter((layer) => layer.seat === seat);
    return layers.length > 0 ? [{ seat, layers }] : [];
  });
}

/** Place triggers generated while announcing a card or ability above its new
 * stack layer before the announcement's first priority point. */
export function flushPendingTriggersAboveStack(state: GameStateInternal, runtime: EngineRuntime): boolean {
  const groups = takePendingTriggerGroups(state);
  if (groups.length === 0) return false;
  const baseStack = state.stack.splice(0);
  placeTriggers(state, runtime, groups, baseStack);
  return true;
}

/** Queue already-generated triggered layers. Combat uses this for the hit
 * event because legacy card scripts expose onHit as a direct hook rather than
 * through CardScript.triggers. The ordinary simultaneous-trigger ordering and
 * stack priority protocol still apply. */
export function queueTriggeredLayers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  groups: { seat: number; layers: StackLayer[] }[],
  resume: StackResume,
): void {
  state.stackResume = resume;
  const pending = takePendingTriggerGroups(state);
  if (pending.length === 0) {
    placeTriggers(state, runtime, groups);
    return;
  }
  const combined = [state.activePlayer, opponent(state.activePlayer)].flatMap((seat) => {
    const layers = [...pending, ...groups]
      .filter((group) => group.seat === seat)
      .flatMap((group) => group.layers);
    return layers.length > 0 ? [{ seat, layers }] : [];
  });
  const baseStack = state.stack.splice(0);
  placeTriggers(state, runtime, combined, baseStack);
}

/** Answer a "trigger-order" decision: push the picked layer, keep ordering. */
export function answerTriggerOrder(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pd = state.pendingDecision;
  if (!pd || pd.chooseHook !== "trigger-order" || pd.player !== seat || !pd.triggerOrder) {
    return "not your decision";
  }
  const { remaining, later, baseStack = [] } = pd.triggerOrder;
  const idx = remaining.findIndex((l) => `${l.sourceInstanceId}:${l.triggerIndex}` === optionId);
  if (idx < 0) return "invalid option";
  const [chosen] = remaining.splice(idx, 1);
  state.stack.push(chosen!);
  state.pendingDecision = null;
  placeTriggers(state, runtime, [{ seat, layers: remaining }, ...later], baseStack);
  return undefined;
}

/** Commit a controller's complete simultaneous-trigger resolution order. */
export function answerTriggerOrderList(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionIds: string[],
): string | undefined {
  const pd = state.pendingDecision;
  if (!pd || pd.chooseHook !== "trigger-order" || pd.player !== seat || !pd.triggerOrder) {
    return "not your decision";
  }
  const { remaining, later, baseStack = [] } = pd.triggerOrder;
  if (optionIds.length !== remaining.length) return "invalid trigger order";
  const pool = [...remaining];
  const ordered: StackLayer[] = [];
  for (const optionId of optionIds) {
    const idx = pool.findIndex((layer) =>
      `${layer.sourceInstanceId}:${layer.triggerIndex}` === optionId);
    if (idx < 0) return "invalid trigger order";
    ordered.push(pool.splice(idx, 1)[0]!);
  }
  state.stack.push(...ordered);
  state.pendingDecision = null;
  placeTriggers(state, runtime, later, baseStack);
  return undefined;
}

/**
 * Entry point: queue every trigger matching `event` for the subject player
 * (and the opponent, for "any"-scoped triggers), then run the stack machine.
 * Simultaneous triggers all go on the stack before any resolves; owners order
 * their own distinct triggers (placeTriggers).
 */
export function collectEventTriggerLayers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  event: TriggerEvent,
  subject: number,
  maxSourceId?: number,
  eventCard?: CardInstance,
  eventContext?: TriggerEventContext,
): { seat: number; layers: StackLayer[] }[] {
  const groups = runtime.events.collectCardEventTriggerLayers(
    state,
    event,
    subject,
    maxSourceId,
    eventCard,
    eventContext,
  ) as { seat: number; layers: StackLayer[] }[];
  const dueDelayed = state.delayedTriggers.filter(
    (delayed) =>
      delayed.event === event &&
      delayed.turn === state.turn &&
      delayed.subjectSeat === subject,
  );
  if (dueDelayed.length > 0) {
    const due = new Set(dueDelayed);
    state.delayedTriggers = state.delayedTriggers.filter((delayed) => !due.has(delayed));
    for (const delayed of dueDelayed) {
      let group = groups.find((candidate) => candidate.seat === delayed.seat);
      if (!group) {
        group = { seat: delayed.seat, layers: [] };
        groups.push(group);
      }
      group.layers.push({
        sourceInstanceId: delayed.source.instanceId,
        seat: delayed.seat,
        triggerIndex: -3,
        label: delayed.label,
        optional: false,
        engineEffect: {
          kind: "delayed-trigger",
          source: delayed.source,
          hook: delayed.hook,
        },
      });
      logPublic(state, `${nameOf(state, delayed.source.cardId)} triggers: ${delayed.label}`);
    }
    const seatOrder = [subject, opponent(subject)];
    groups.sort((a, b) => seatOrder.indexOf(a.seat) - seatOrder.indexOf(b.seat));
  }
  return groups;
}

/** Card-played triggers join the played card's pending layers. They are
 * returned flat because the existing play pipeline inserts all such layers
 * above the played card before its priority window opens. */
function collectCardPlayedTriggerLayers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  subject: number,
  card: CardInstance,
  maxSourceId: number,
  from: string,
): StackLayer[] {
  const layers = collectEventTriggerLayers(
    state, runtime,
    "card-played",
    subject,
    maxSourceId,
    card,
    { causedBySeat: subject, from },
  ).flatMap((group) => group.layers);
  const selfTriggers = scriptOf(state, card.cardId, card)?.triggers;
  selfTriggers?.forEach((trigger, triggerIndex) => {
    if (trigger.event !== "card-played" || trigger.sourceZone !== "self") return;
    const ctx = runtime.makeCtx(state, subject, card, currentLink(state));
    const eventContext: TriggerEventContext = { causedBySeat: subject, from };
    if (trigger.condition && !trigger.condition(ctx, card, eventContext)) return;
    trigger.onTrigger?.(ctx, card, eventContext);
    layers.push({
      sourceInstanceId: card.instanceId,
      seat: subject,
      triggerIndex,
      triggerSource: snapshotSerializable(card),
      triggerEventCard: snapshotSerializable(card),
      label: trigger.label,
      optional: trigger.optional ?? false,
      ...(trigger.defaultOption ? { defaultOption: trigger.defaultOption } : {}),
    });
    logPublic(state, `${nameOf(state, card.cardId)} triggers: ${trigger.label}`);
  });
  return layers;
}

export function queueEventTriggers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  event: TriggerEvent,
  subject: number,
  resume: StackResume,
  maxSourceId?: number,
  eventCard?: CardInstance,
): void {
  queueTriggeredLayers(
    state, runtime,
    collectEventTriggerLayers(state, runtime, event, subject, maxSourceId, eventCard),
    resume,
  );
}

/** Generate an event's triggers now but defer placing them on the stack until
 * the current announcement is complete. Attack activations use this so their
 * play/activation triggers share the next ordering decision without being
 * mistaken for the later event where the attack becomes attacking. */
export function deferEventTriggers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  event: TriggerEvent,
  subject: number,
  maxSourceId?: number,
  eventCard?: CardInstance,
): void {
  const layers = collectEventTriggerLayers(
    state, runtime,
    event,
    subject,
    maxSourceId,
    eventCard,
  ).flatMap((group) => group.layers);
  if (layers.length > 0) (state.pendingTriggeredLayers ??= []).push(...layers);
}

/** Defer already-generated trigger layers until the announcement's next
 * priority point, where the normal simultaneous-trigger ordering applies. */
export function deferTriggerLayers(
  state: GameStateInternal,
  layers: StackLayer[],
): void {
  if (layers.length > 0) (state.pendingTriggeredLayers ??= []).push(...layers);
}

/** Queue triggers caused by an attack-reaction play or activation above the
 * reaction layer that caused them. Every currently registered source has the
 * same optional add-as-defender effect, so deterministic arena order is
 * equivalent while still allowing each source to be accepted separately. */
export function queueReactionEventTriggers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  subject: number,
): void {
  const layers = (runtime.events.collectCardEventTriggerLayers(
    state,
    "attack-reaction",
    subject,
  ) as { seat: number; layers: StackLayer[] }[])
    .flatMap((group) => group.layers);
  state.stack.unshift(...layers);
}

/** Resolve any kind of top stack layer from a reaction priority window. */
export function resolveTopStackLayer(state: GameStateInternal, runtime: EngineRuntime): void {
  advanceStack(state, runtime);
}

/** During the Attack Step, queue attack-declared triggers (only from
 * permanents that existed when the attack became attacking). Once they
 * resolve, play moves to the Defend Step. */
export function enterAttackWindow(state: GameStateInternal, runtime: EngineRuntime): void {
  const link = currentLink(state);
  queueEventTriggers(
    state, runtime,
    "attack-declared",
    link?.attacker ?? state.activePlayer,
    "continue-attack",
    link?.declaredAtNextId,
    link?.attackingCard,
  );
}
