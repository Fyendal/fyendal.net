import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { MeldSide, PlayableZone } from "@fyendal/shared";
import { activateFromHandAbility } from "./activation.js";
import {
  activatedAbilitiesSuppressed,
  dataOf,
  instanceDataOf,
  meldSideHasType,
  scriptOf,
} from "./cardProperties.js";

import { activeModifiers } from "./combatModifiers.js";
import { attackHasDominate } from "./combatValues.js";

import {
  isValidVariableX,
  payCost,
  resolveVariablePlayCost,
  variableResourceChoices,
  variableResourceCost,
} from "./costs.js";
import { logNameOf, logPublic, nameOf } from "./gameLog.js";
import { abilityList } from "./scripts.js";
import {
  DEFAULT_CHOOSE_X_PROMPT,
  scriptPromptParts,
  soulBanishCostPrompt,
} from "./scriptPresentation.js";
import type { CardInstance, ChainLinkState, PlayerState } from "./state.js";

import {
  currentLink,
  findCard,
  heroSoulCards,
  isPermanentSource,
  removeFromArray,
} from "./zoneQueries.js";
import { abilitiesAsInstantForCard, abilityResourceCost, actionAbilityRestrictedByModifier, payActivatedAbilityCost, prepareActivatedDiscardCost, prepareActivatedEffectCardCosts } from "./abilityRules.js";
import { consumeNextActionGoAgain, noteActionPlayedOrActivated } from "./cardLifecycle.js";
import { canPlayAsInstant, cardPlayCost, cardPlayReductionForSeat, cardPlayRestrictedByModifier, mayPlayFromArsenal, mayPlayFromZone, payAlternativePlayCost, preparePlayTarget } from "./playRules.js";
import { canPayRequiredHandCardsForAdditionalCost } from "./resources.js";
import { heroAbilitiesDisabled } from "./stateQueries.js";
import { actionLimitReached, isFrozen, opposingInstantsProhibited } from "./ruleQueries.js";
import { defendingHeroCannotRespondBelowPower } from "./combatRestrictions.js";
import { pushAbilityLayer } from "./stackCore.js";

import {
  holdPriorityWindow,
  passPriorityWindow,
  type PriorityWindow,
} from "./priority.js";

/** Defense-reaction restrictions on the link: "defense reactions can't be
 *  played to this chain link" (link flag noDefenseReactions) and "defense
 *  reactions can't be played from arsenal this chain link" (a modifier riding
 *  the link). Consulted in enumeration AND validation. */
export function defenseReactionRestriction(
  state: GameStateInternal,
  link: ChainLinkState,
): { all: boolean; fromArsenal: boolean; fromHand: boolean } {
  return {
    all:
      link.flags.noDefenseReactions === true ||
      (state.players[link.attacker] as PlayerState).flags.noDefenseReactionsThisTurn === true,
    fromArsenal: activeModifiers(state, link, ["chain-link"]).some(
      (m) => m.noDefenseReactionsFromArsenal === true,
    ),
    fromHand: activeModifiers(state, link, ["chain-link"]).some(
      (m) => m.noDefenseReactionsFromHand === true,
    ),
  };
}

/** Enter the reaction step: attacker holds priority first. */
export function beginReactionStep(state: GameStateInternal): void {
  const link = currentLink(state);
  if (!link) return;
  state.phase = "reaction";
  state.priorityPlayer = link.attacker;
  state.reactionPasses = 0;
  state.pendingDecision = {
    player: link.attacker,
    kind: "attack-reaction",
    prompt: "Attack reaction window — play a reaction or pass",
    promptMessage: { id: "engine.decision.reaction.attack" },
  };
}

/** The reaction step's priority window (see passPriorityWindow/holdPriorityWindow). */
function reactionWindow(runtime: EngineRuntime): PriorityWindow {
  return {
  phase: "reaction",
  passField: "reactionPasses",
  noWindowError: "not in a reaction window",
  buildDecision(state, player) {
    const defenderIsNext = player !== currentLink(state)?.attacker;
    const top = state.stack[0]?.card;
    const suffix = top ? ` (${nameOf(state, top.cardId)} on the stack)` : "";
    return {
      player,
      kind: defenderIsNext ? "defense-reaction" : "attack-reaction",
      prompt: defenderIsNext
        ? `Defense reaction window — play a reaction or pass${suffix}`
        : `Attack reaction window — play a reaction or pass${suffix}`,
      promptMessage: top
        ? {
            id: defenderIsNext
              ? "engine.decision.reaction.defense.card"
              : "engine.decision.reaction.attack.card",
            values: { card: { kind: "card", cardId: top.cardId } },
          }
        : {
            id: defenderIsNext
              ? "engine.decision.reaction.defense"
              : "engine.decision.reaction.attack",
          },
    };
  },
  onBothPass(state) {
    // the step ends only when the stack is empty and both players pass in
    // succession (CR 7.4.3); until then each double-pass resolves the top layer
    const top = state.stack[0];
    if (top?.card) {
      runtime.dispatchFlow("resolveTopStackCard", state);
      return;
    }
    if (top?.ability) {
      if (!runtime.dispatchFlow("resolveAbilityLayer", state, top)) runtime.dispatchFlow("finishStackCardResolution", state, top.seat);
      return;
    }
    if (top) {
      runtime.dispatchFlow("resolveTopStackLayer", state);
      return;
    }
    runtime.dispatchFlow("resolveLink", state);
  },
  };
}

/** After a stack layer resolves mid-reaction-step, the attacker (turn player)
 *  regains priority and the reaction window reopens. */
export function reopenReactionWindow(state: GameStateInternal, runtime: EngineRuntime): void {
  const link = currentLink(state);
  if (!link) return;
  state.phase = "reaction";
  state.reactionPasses = 0;
  state.priorityPlayer = link.attacker;
  state.pendingDecision = reactionWindow(runtime).buildDecision(state, link.attacker);
}

/** `seat` keeps priority in the reaction step (e.g. after an instant-speed
 *  ability's scripted choice has been answered). */
export function holdReactionWindow(state: GameStateInternal,
  runtime: EngineRuntime, seat: number): void {
  holdPriorityWindow(state, seat, reactionWindow(runtime));
}

export function passReaction(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
): string | undefined {
  const kind = state.pendingDecision?.kind;
  if (
    !currentLink(state) ||
    (kind !== "attack-reaction" && kind !== "defense-reaction")
  ) {
    return "not in a reaction window";
  }
  return passPriorityWindow(state, seat, reactionWindow(runtime));
}

/**
 * Activate an "Instant" or "Attack Reaction" ability of a permanent (Energy
 * Potion, Breaking Scales, ...) or of an attack card retained face up on the
 * combat chain — during a priority window (the reaction step
 * or a layer window). The ability resolves immediately; the priority holder
 * keeps priority afterwards (as when playing a reaction card).
 */
export function activateWindowAbility(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  sourceInstanceId: number,
  pitchInstanceIds: number[],
  abilityIndex = 0,
  soulInstanceIds: number[] = [],
  resumingActivationCost = false,
  effectCostInstanceIds: number[] = [],
  alternativeCostCardInstanceIds?: number[],
  discardInstanceIds: number[] = [],
  declaredVariableX?: number,
): string | undefined {
  const link = currentLink(state);
  const inReaction = state.phase === "reaction" && !!link;
  const inLayer =
    state.phase === "layer" &&
    (resumingActivationCost || state.pendingDecision?.kind === "priority-window");
  if (!inReaction && !inLayer) return "cannot activate an ability now";
  if (defendingHeroCannotRespondBelowPower(state, runtime, seat)) {
    return "defending hero cannot respond to this attack";
  }
  const pd = state.pendingDecision;
  if (
    inReaction && !resumingActivationCost &&
    pd?.kind !== "attack-reaction" &&
    pd?.kind !== "defense-reaction"
  ) {
    return "cannot activate an ability now";
  }
  if (!resumingActivationCost && pd?.player !== seat) return "not your priority";
  const player = state.players[seat] as PlayerState;
  // Sources are permanents plus face-up attack cards retained on this combat
  // chain. Earlier links can carry abilities that affect the current attack.
  const chainAttack = state.chain.find((candidate) =>
    candidate.attacker === seat &&
    candidate.attackingCard.instanceId === sourceInstanceId &&
    candidate.flags.attackGone !== true
  );
  const isChainAttackCard = chainAttack !== undefined;
  const card = chainAttack
    ? (chainAttack as ChainLinkState).attackingCard
    : (findCard(player, sourceInstanceId) ??
      (player.hero.instanceId === sourceInstanceId ? player.hero : undefined));
  const isGraveyardSource = !!card && player.graveyard.some(
    (candidate) => candidate.instanceId === card.instanceId,
  );
  const isBanishSource = !!card && player.banish.some(
    (candidate) => candidate.instanceId === card.instanceId,
  );
  const isArsenalSource = !!card && player.arsenal.some(
    (candidate) => candidate.instanceId === card.instanceId,
  );
  if (!card || (!isChainAttackCard && !isPermanentSource(player, card.instanceId) && !isGraveyardSource && !isBanishSource && !isArsenalSource)) {
    const result = activateFromHandAbility(state, runtime, {
      mode: "window",
      seat,
      sourceInstanceId,
      abilityIndex,
      pitchInstanceIds,
      soulInstanceIds,
      effectCostInstanceIds,
      alternativeCostCardInstanceIds,
      discardInstanceIds,
      declaredVariableX,
      link,
    });
    if (result.status === "error") return result.error;
    if (result.status === "pending") return undefined;
    if (state.pendingDecision?.chooseHook) {
      if (inReaction) state.pendingDecision.resume = { kind: "reopen-reaction", seat };
      else state.pendingDecision.resume = { kind: "continue-stack", seat };
      return undefined;
    }
    if (runtime.dispatchFlow("flushPendingTriggersAboveStack", state)) return undefined;
    if (inReaction) holdPriorityWindow(state, seat, reactionWindow(runtime));
    else {
      runtime.dispatchFlow("cancelEndActionPass", state);
      runtime.dispatchFlow("holdLayerWindow", state, seat);
    }
    return undefined;
  }
  if (card.instanceId === player.hero.instanceId && heroAbilitiesDisabled(state, seat)) {
    return "hero abilities are disabled";
  }
  if (activatedAbilitiesSuppressed(state, card)) return "activated abilities are suppressed";
  const ability = abilityList(scriptOf(state, card.cardId, card))[abilityIndex];
  if (!ability || ability.isAttack) return "no such ability";
  if ((ability.fromGraveyard === true) !== isGraveyardSource) {
    return "ability is not usable from this zone";
  }
  if ((ability.fromBanish === true) !== isBanishSource) {
    return "ability is not usable from this zone";
  }
  if ((ability.fromArsenal === true) !== isArsenalSource) {
    return "ability is not usable from this zone";
  }
  if (isFrozen(state, card)) return `${nameOf(state, card.cardId)} is frozen`;
  if (ability.fromHand) return "only usable from hand";
  // Cloaked: a face-down permanent's abilities are non-functional EXCEPT
  // abilities that turn it face up as part of their cost (CR 8.3.36)
  if (card.faceDown && !ability.turnsFaceUp && !ability.usableWhileFaceDown) return "no such ability";
  const timing = ability.timing ?? "action";
  if (timing === "action" && actionAbilityRestrictedByModifier(
    state,
    runtime,
    seat,
    card,
    ability.isAttack,
  )) return "action ability is prohibited by a turn restriction";
  if (timing === "instant" && opposingInstantsProhibited(state, seat)) {
    return "opposing effect prohibits instants";
  }
  if (timing === "action" && actionLimitReached(state, player)) {
    return "cannot play or activate another action this turn";
  }
  if (timing === "attack-reaction") {
    if (
      !inReaction ||
      (!resumingActivationCost && pd?.kind !== "attack-reaction") ||
      link?.attacker !== seat
    ) {
      return "only usable as an attack reaction";
    }
  } else if (timing === "defense-reaction") {
    if (
      !inReaction ||
      (!resumingActivationCost && pd?.kind !== "defense-reaction") ||
      link?.attacker === seat
    ) {
      return "only usable as a defense reaction";
    }
  } else if (timing !== "instant" && !abilitiesAsInstantForCard(state, player, card)) {
    return "only usable during your action phase";
  }
  if (ability.tap && card.tapped) return `${nameOf(state, card.cardId)} is already tapped`;
  if (ability.canActivate && !ability.canActivate(runtime.makeCtx(state, seat, card, link))) {
    return "cannot activate now";
  }
  if (alternativeCostCardInstanceIds !== undefined && !ability.alternativeEffectCardCosts) {
    return "ability has no alternative card cost";
  }
  const payingAlternative = alternativeCostCardInstanceIds !== undefined;
  let costAbility = payingAlternative
    ? { ...ability, cost: 0, effectCardCosts: ability.alternativeEffectCardCosts }
    : ability;
  const selectedEffectCostIds = alternativeCostCardInstanceIds ?? effectCostInstanceIds;
  const variableCost = payingAlternative ? undefined : ability.variableCost;
  const resolvedVariableCost = variableCost
    ? {
        ...variableCost,
        maximum: Math.max(0, Math.floor(variableCost.maximum ?? 127)),
      }
    : undefined;
  const resourceCostForBase = (base: number): number =>
    abilityResourceCost(state, runtime, seat, card, { ...ability, cost: base }, link);
  if (resolvedVariableCost && declaredVariableX === undefined) {
    if (pitchInstanceIds.length > 0) return "declare X before pitching for this ability";
    const choices = variableResourceChoices(
      state,
      player,
      card.instanceId,
      resolvedVariableCost,
      resourceCostForBase,
    );
    const options = Object.keys(choices);
    if (options.length === 0) return "not enough resources";
    const presentation = scriptPromptParts(
      resolvedVariableCost.prompt ?? DEFAULT_CHOOSE_X_PROMPT,
      options,
    );
    state.pendingDecision = {
      player: seat,
      kind: "choose-target",
      prompt: presentation.fallback,
      ...(presentation.promptMessage ? { promptMessage: presentation.promptMessage } : {}),
      ...(presentation.optionMessages ? { optionMessages: presentation.optionMessages } : {}),
      options,
      sourceInstanceId: card.instanceId,
      chooseHook: "engine-variable-activation-x",
      variableActivationCost: {
        mode: "window",
        seat,
        sourceInstanceId: card.instanceId,
        abilityIndex,
        choices,
      },
    };
    return undefined;
  }
  if (resolvedVariableCost && !isValidVariableX(declaredVariableX, resolvedVariableCost)) {
    return "invalid X declaration";
  }
  if (resolvedVariableCost) {
    costAbility = {
      ...costAbility,
      cost: variableResourceCost(resolvedVariableCost, declaredVariableX!),
    };
  }
  const discardCostPrep = prepareActivatedDiscardCost(
    state,
    "window",
    seat,
    card,
    costAbility,
    abilityIndex,
    pitchInstanceIds,
    undefined,
    discardInstanceIds,
    selectedEffectCostIds,
    alternativeCostCardInstanceIds,
    declaredVariableX,
  );
  if (discardCostPrep === "pending") return undefined;
  if (discardCostPrep) return discardCostPrep;
  const effectCostPrep = prepareActivatedEffectCardCosts(
    state,
    "window",
    seat,
    card,
    costAbility,
    abilityIndex,
    pitchInstanceIds,
    undefined,
    selectedEffectCostIds,
    discardInstanceIds,
    alternativeCostCardInstanceIds,
    declaredVariableX,
  );
  if (effectCostPrep === "pending") return undefined;
  if (effectCostPrep) return effectCostPrep;
  const selectedSoulIds = [...new Set(soulInstanceIds)];
  if (ability.banishSoulCost && selectedSoulIds.length < ability.banishSoulCost) {
    const soul = heroSoulCards(player);
    if (selectedSoulIds.some((id) => !soul.some((card) => card.instanceId === id))) {
      return "soul cost card not found";
    }
    const remaining = soul.filter((candidate) => !selectedSoulIds.includes(candidate.instanceId));
    if (remaining.length < ability.banishSoulCost - selectedSoulIds.length) return "not enough cards in soul";
    const presentation = scriptPromptParts(soulBanishCostPrompt(
      nameOf(state, card.cardId),
      card.cardId,
      selectedSoulIds.length + 1,
      ability.banishSoulCost,
    ));
    state.pendingDecision = {
      player: seat,
      kind: "choose-target",
      prompt: presentation.fallback,
      promptMessage: presentation.promptMessage,
      options: remaining.map((candidate) => String(candidate.instanceId)),
      cardOptions: remaining.map((candidate) => candidate.instanceId),
      chooseHook: "engine-activation-soul",
      activationCost: {
        mode: "window",
        seat,
        sourceInstanceId,
        abilityIndex,
        pitchInstanceIds,
        ...(selectedSoulIds.length ? { soulInstanceIds: selectedSoulIds } : {}),
        ...(discardInstanceIds.length ? { discardInstanceIds } : {}),
        ...(ability.effectCardCosts?.length ? { effectCostInstanceIds } : {}),
        ...(alternativeCostCardInstanceIds !== undefined
          ? { alternativeCostCardInstanceIds }
          : {}),
      },
    };
    return undefined;
  }
  const nextActionGoAgain = timing === "action" && consumeNextActionGoAgain(player);
  const prepErr = payActivatedAbilityCost(
    state, runtime,
    seat,
    card,
    costAbility,
    abilityIndex,
    pitchInstanceIds,
    abilityResourceCost(state, runtime, seat, card, costAbility, link),
    {
      chiCost: ability.chiCost,
      soulInstanceIds: selectedSoulIds,
      effectCostInstanceIds: selectedEffectCostIds,
      discardInstanceIds,
    },
  );
  if (prepErr) return prepErr;
  if (variableCost) (card.counters ??= {})[variableCost.counterKey] = declaredVariableX!;
  if (timing === "action") noteActionPlayedOrActivated(player);
  if (timing === "attack-reaction" && link) {
    link.flags.reactionPlayedOrActivated = true;
    link.flags[`reactionBySeat:${seat}`] = true;
    link.flags.reactionCount = Number(link.flags.reactionCount ?? 0) + 1;
  }
  // the ability rides the stack like an instant/reaction card: its effect
  // resolves only once both players pass in succession (CR 5.3.2)
  pushAbilityLayer(state, seat, card, nameOf(state, card.cardId), {
    abilityIndex,
    goAgain: ability.goAgain || nextActionGoAgain,
  });
  if (timing === "attack-reaction") runtime.dispatchFlow("queueReactionEventTriggers", state, seat);
  // A leave-arena trigger opened while paying this activation cost must be
  // answered before priority resumes; do not overwrite it with the window.
  if (state.pendingDecision?.chooseHook) {
    if (inReaction) state.pendingDecision.resume = { kind: "reopen-reaction", seat };
    else {
      runtime.dispatchFlow("cancelEndActionPass", state);
      state.pendingDecision.resume = { kind: "continue-stack", seat };
    }
    return undefined;
  }
  if (runtime.dispatchFlow("flushPendingTriggersAboveStack", state)) return undefined;
  // the priority holder keeps priority and may play more; priority only
  // passes when they pass
  if (inReaction) holdPriorityWindow(state, seat, reactionWindow(runtime));
  else {
    runtime.dispatchFlow("cancelEndActionPass", state);
    runtime.dispatchFlow("holdLayerWindow", state, seat);
  }
  return undefined;
}

export function playReaction(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  fromArsenal: boolean,
  pitchInstanceIds: number[],
  meldSide?: MeldSide,
  alternativeCostCardInstanceIds?: number[],
  targetCardInstanceId?: number,
  fromZone?: PlayableZone,
  declaredVariableX?: number,
): string | undefined {
  const link = currentLink(state);
  if (state.phase !== "reaction" || !link) return "no active reaction window";
  if (state.priorityPlayer !== seat) return "not your priority";
  const data = instanceDataOf(state, card);
  const playedAsInstant = data.cardType === "instant" ||
    (data.cardType !== "attack-reaction" && data.cardType !== "defense-reaction" &&
      canPlayAsInstant(state, runtime, seat, card, link, fromZone ?? (fromArsenal ? "arsenal" : "hand")));
  if (playedAsInstant && opposingInstantsProhibited(state, seat)) {
    return "opposing effect prohibits instants";
  }
  const isAttacker = seat === link.attacker;
  if (data.cardType === "attack-reaction" && !isAttacker)
    return "only the attacker can play attack reactions";
  if (data.cardType === "defense-reaction" && isAttacker)
    return "only the defender can play defense reactions";
  const player = state.players[seat] as PlayerState;
  const script = scriptOf(state, card.cardId, card);
  if (
    data.cardType !== "attack-reaction" &&
    data.cardType !== "defense-reaction" &&
    data.cardType !== "instant"
  ) {
    // an action playable "as though it were an instant" counts as an instant here
    const asInstant = canPlayAsInstant(state, runtime, seat, card, link, fromZone ?? (fromArsenal ? "arsenal" : "hand"));
    if (!asInstant) return "only reactions and instants can be played now";
  }
  const source = fromZone
    ? ((state.players as PlayerState[]).find((owner) =>
        owner[fromZone].some((candidate) => candidate.instanceId === card.instanceId)
      )?.[fromZone] ?? player[fromZone])
    : fromArsenal
    ? ((state.players as PlayerState[]).find((owner) =>
        owner.arsenal.some((candidate) => candidate.instanceId === card.instanceId)
      )?.arsenal ?? player.arsenal)
    : player.hand.some((c) => c.instanceId === card.instanceId)
      ? player.hand
      : mayPlayFromZone(state, runtime, card, "banish", seat)
        ? player.banish // a granted "you may play it" (e.g. a banished trap)
        : player.hand;
  if (!source.some((c) => c.instanceId === card.instanceId)) return "card not found in that zone";
  if (fromArsenal && !mayPlayFromArsenal(state, card, seat)) {
    return `${nameOf(state, card.cardId)} may not be played from arsenal`;
  }
  if (fromZone && !mayPlayFromZone(state, runtime, card, fromZone, seat)) {
    return `${nameOf(state, card.cardId)} may not be played from ${fromZone}`;
  }
  if (card.faceDown && !fromArsenal && fromZone !== "banish" && source !== player.banish) {
    return "face-down cards cannot be played";
  }
  if (isFrozen(state, card)) return `${nameOf(state, card.cardId)} is frozen`;
  if (cardPlayRestrictedByModifier(state, seat, card)) {
    return `${nameOf(state, card.cardId)} cannot be played due to a card-type restriction`;
  }
  const isDefReact = data.cardType === "defense-reaction";
  // "defense reactions can't be played (from arsenal) this chain link"
  const drRestriction = defenseReactionRestriction(state, link);
  if (isDefReact && drRestriction.all) {
    return "defense reactions can't be played to this chain link";
  }
  if (isDefReact && fromArsenal && drRestriction.fromArsenal) {
    return "defense reactions can't be played from arsenal this chain link";
  }
  if (isDefReact && !fromArsenal && drRestriction.fromHand) {
    return "defense reactions can't be played from hand this chain link";
  }
  // Dominate (8.3.4b / 7.4.2c): once the link is defended from hand, a defense
  // reaction from hand could not become a defending card, so it cannot be played
  if (
    isDefReact &&
    !fromArsenal &&
    attackHasDominate(state, link) &&
    link.flags.defendedFromHand === true
  ) {
    return "Dominate: cannot play defense reactions from hand against this attack";
  }
  // scripted defend legality also gates a defense reaction played onto the link
  if (isDefReact) {
    const canDefend = script?.canDefend;
    if (canDefend && !canDefend(runtime.makeCtx(state, seat, card, link))) {
      return `${nameOf(state, card.cardId)} cannot defend this attack`;
    }
    if (!runtime.dispatchFlow("attackAllowsDefender", state, link, card, !fromZone && source === player.hand)) {
      return `${nameOf(state, card.cardId)} cannot defend this attack`;
    }
  }
  if (script?.canPlay && !script.canPlay(runtime.makeCtx(state, seat, card, link, fromArsenal))) {
    return `${nameOf(state, card.cardId)} cannot be played now`;
  }
  if (alternativeCostCardInstanceIds !== undefined && !script?.alternativePlayCost) {
    return `${nameOf(state, card.cardId)} has no alternative play cost`;
  }
  if (
    alternativeCostCardInstanceIds?.some((id) => pitchInstanceIds.includes(id))
  ) {
    return "cannot pitch an alternative-cost card";
  }
  if (script?.meld && !meldSide) return "choose a meld side";
  if (!script?.meld && meldSide) return `${nameOf(state, card.cardId)} does not have meld`;
  if (meldSide && meldSideHasType(state, card, meldSide, "action")) {
    return "only instants can be played in a reaction window";
  }
  if (meldSide) card.meldSide = meldSide;
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
      const presentation = scriptPromptParts(
        resolvedVariableCost.prompt ?? DEFAULT_CHOOSE_X_PROMPT,
        options,
      );
      const origin = fromZone ?? (fromArsenal
        ? "arsenal"
        : source === player.banish ? "banish" : "hand");
      state.pendingDecision = {
        player: seat,
        kind: "choose-target",
        prompt: presentation.fallback,
        ...(presentation.promptMessage ? { promptMessage: presentation.promptMessage } : {}),
        ...(presentation.optionMessages ? { optionMessages: presentation.optionMessages } : {}),
        options,
        sourceInstanceId: card.instanceId,
        chooseHook: "engine-variable-play-x",
        variablePlayCost: {
          mode: "reaction",
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
  const effectiveCost = costForBase(variableBaseCost);
  if (!canPayRequiredHandCardsForAdditionalCost(
    state,
    seat,
    card,
    [...pitchInstanceIds, ...(alternativeCostCardInstanceIds ?? [])],
  )) return "cannot pay the card's additional hand-card cost";
  const costErr = payCost(
    state, runtime,
    player,
    effectiveCost,
    pitchInstanceIds,
    card.instanceId,
    {
      beforePitch: () =>
        logPublic(state, `${nameOf(state, player.heroCardId)} plays ${logNameOf(state, card.cardId)}`),
    },
  );
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
  if (isDefReact && Number(player.flags.nextDefenseReactionExtraCost || 0) > 0) {
    player.flags.nextDefenseReactionExtraCost = 0;
  }
  const removed = removeFromArray(source, card.instanceId) as CardInstance;
  delete removed.faceDown; // a card is played openly, even out of the banished zone
  const origin = fromZone ?? (fromArsenal ? "arsenal" : source === player.banish ? "banish" : "hand");
  script?.additionalCost?.(runtime.makeCtx(state, seat, removed, link, fromArsenal));
  const pdCost = state.pendingDecision;
  if (pdCost?.chooseHook) {
    pdCost.resume = { kind: "finish-reaction", seat, card: removed, from: origin };
    state.resolving.push(removed);
    return undefined;
  }
  finishReactionPlay(state, runtime, seat, removed, origin);
  return undefined;
}

export function finishReactionPlay(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  removed: CardInstance,
  origin: "hand" | "arsenal" | PlayableZone,
): void {
  const player = state.players[seat] as PlayerState;
  const link = currentLink(state);
  if (link && dataOf(state, removed.cardId).cardType === "attack-reaction") {
    link.flags.reactionPlayedOrActivated = true;
    link.flags[`reactionBySeat:${seat}`] = true;
    link.flags.reactionCount = Number(link.flags.reactionCount ?? 0) + 1;
  }
  const { goAgain, layers: playedTriggers } = runtime.dispatchFlow("announceCardPlayed", state, seat, removed, origin);
  // reactions/instants become the top stack layer: their effects resolve only
  // once both players pass in succession (CR 5.3.2); a defense reaction becomes
  // a defending card when it resolves (7.4.2d)
  state.stack.unshift({
    sourceInstanceId: removed.instanceId,
    seat,
    triggerIndex: -1,
    label: nameOf(state, removed.cardId),
    optional: false,
    card: removed,
    fromHand: origin === "hand",
    ...(goAgain ? { goAgain: true } : {}),
  });
  state.stack.unshift(...playedTriggers);
  if (dataOf(state, removed.cardId).cardType === "attack-reaction") {
    runtime.dispatchFlow("queueReactionEventTriggers", state, seat);
  }
  // the priority holder keeps priority and may play more reactions/instants;
  // priority only passes when they pass
  holdPriorityWindow(state, seat, reactionWindow(runtime));
}

/**
 * Activate a "while this is defending" ability (e.g. Rally the Rearguard):
 * cost is discarding cards from hand (passed via pitchInstanceIds).
 */
export function activateDefenseAbility(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  sourceInstanceId: number,
  discardInstanceIds: number[],
): string | undefined {
  const link = currentLink(state);
  if (!link) return "no active combat";
  if (state.phase !== "reaction" && state.phase !== "defend") return "cannot activate now";
  const card = link.defendingCards.find((c) => c.instanceId === sourceInstanceId);
  if (!card || card.owner !== seat) return "source is not defending for you";
  if (activatedAbilitiesSuppressed(state, card)) return "activated abilities are suppressed";
  const script = scriptOf(state, card.cardId, card);
  const ability = script?.defenseAbility;
  if (!ability) return "no such ability";
  const player = state.players[seat] as PlayerState;
  if (ability.oncePerTurn && player.flags[`defAbility:${card.instanceId}`]) {
    return "ability can only be used once per turn";
  }
  if (discardInstanceIds.length !== ability.discard) {
    return `must discard exactly ${ability.discard} card(s)`;
  }
  const ctx = runtime.makeCtx(state, seat, card, link);
  for (const id of discardInstanceIds) {
    const discarded = ctx.discardCard(seat, id);
    if (!discarded) return `card ${id} not in hand`;
  }
  player.flags[`defAbility:${card.instanceId}`] = true;
  script?.onDefendAbility?.(runtime.makeCtx(state, seat, card, link));
  runtime.dispatchFlow("flushPendingTriggersAboveStack", state);
  return undefined;
}
