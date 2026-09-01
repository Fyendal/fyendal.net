import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardData, MeldSide, PlayableZone } from "@fyendal/shared";
import type { CardInstance, PlayerState } from "./state.js";
import type { TokenCreationContext } from "./eventTypes.js";
import { activateFromHandAbility } from "./activation.js";
import {
  activatedAbilitiesSuppressed,
  cardHasType,
  cardTypesOf,
  dataOf,
  hasKeyword,
  instanceDataOf,
  isArrowData,
  meldSideHasType,
  scriptOf,
} from "./cardProperties.js";
import { answerClashDecision } from "./clash.js";
import { logNameOf, logPublic, nameOf } from "./gameLog.js";
import {
  activateAuraAttack,
  attackActivationCost,
  attackTargetIsLegal,
  attackWithPermanent,
  declareAttack,
} from "./attacks.js";
import {
  currentLink,
  findCard,
  findCardAnywhere,
  heroSoulCards,
  isPermanentSource,
  removeFromArray,
} from "./zoneQueries.js";
import { closeChain } from "./combatChain.js";
import { finishReactionPlay } from "./reactions.js";
import { answerWagerLossReplacementOrder } from "./wagers.js";
import {
  isValidVariableX,
  payCost,
  resolveVariablePlayCost,
  variableResourceChoices,
  variableResourceCost,
} from "./costs.js";
import { abilityList } from "./scripts.js";
import {
  announceCardPlayed,
  continueStack,
  deferEventTriggers,
  deferTriggerLayers,
  finishStackCardResolution,
  finishWindowInstantPlay,
} from "./triggers.js";
import {
  answerTokenCreationReplacement,
  answerTokenReplacementOrder,
  answerTokenReplacementPlayerOrder,
  resumePendingTokenCreations,
} from "./tokens.js";
import { answerDeckBottomOrder, enterBanish } from "./zoneMoves.js";
import { lingeringModifierSources } from "./sourceQueries.js";

import { abilityResourceCost, actionAbilityRestrictedByModifier, payActivatedAbilityCost, prepareActivatedDiscardCost, prepareActivatedEffectCardCosts } from "./abilityRules.js";
import { consumeNextActionGoAgain, noteActionPlayedOrActivated } from "./cardLifecycle.js";
import { answerArcaneBarrier } from "./damageResolution.js";
import { answerDieRollReplacement } from "./dieRoll.js";
import { cardPlayRestrictedByModifier, cardPlayCost, cardPlayReductionForSeat, payAlternativePlayCost, preparePlayTarget, canPlayAsInstant, canRuneGate, consumeAttackCostReductions, mayPlayFromArsenal, mayPlayFromZone, playFromZoneRequiresInstant } from "./playRules.js";
import { canPayRequiredHandCardsForAdditionalCost, scriptedPaymentOptions } from "./resources.js";
import { heroAbilitiesDisabled } from "./stateQueries.js";
import { actionLimitReached, controlsBow, firstAttackExtraCost, consumeFirstAttackExtraCost, isFrozen } from "./ruleQueries.js";
import { nonAttackActionCardLimitReached } from "./restrictions.js";
import { attackActionPlayRestricted, weaponAttacksProhibited } from "./combatRestrictions.js";
import { pushAbilityLayer, pushCardLayer } from "./stackCore.js";

function isAttackCard(data: CardData): boolean {
  return data.cardType === "action" && (data.subtypes ?? []).includes("attack");
}

export function playCard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  instanceId: number,
  pitchInstanceIds: number[],
  from: "hand" | "arsenal" | PlayableZone,
  meldSide?: MeldSide,
  targetAllyId?: number,
  boost = false,
  boostCount?: number,
  asInstant?: boolean,
  alternativeCostCardInstanceIds?: number[],
  targetCardInstanceId?: number,
  declaredVariableX?: number,
): string | undefined {
  const earlyPd = state.pendingDecision;
  if (state.phase !== "action" || earlyPd) return "cannot play a card right now";
  if (seat !== state.activePlayer || seat !== state.priorityPlayer) return "not your turn";
  const player = state.players[seat] as PlayerState;
  const source =
    from === "arsenal" ? ((state.players as PlayerState[]).find((owner) =>
      owner.arsenal.some((candidate) => candidate.instanceId === instanceId)
    )?.arsenal ?? player.arsenal)
    : from === "hand" ? player.hand
    : ((state.players as PlayerState[]).find((owner) =>
        owner[from].some((candidate) => candidate.instanceId === instanceId)
      )?.[from] ?? player[from]);
  const card = source.find((c) => c.instanceId === instanceId);
  if (!card) return `card not in ${from}`;
  if (player.flags.playsRestrictedToArsenal === true && from !== "arsenal") {
    return "cards can only be played from arsenal this turn";
  }
  if (from === "arsenal" && !mayPlayFromArsenal(state, card, seat)) {
    return `${nameOf(state, card.cardId)} may not be played from arsenal`;
  }
  if (from === "deck" && source[0]?.instanceId !== card.instanceId) {
    return "only the top card of the deck can be played";
  }
  if (from !== "hand" && from !== "arsenal" && !mayPlayFromZone(state, runtime, card, from, seat)) {
    return `${nameOf(state, card.cardId)} may not be played from ${from}`;
  }
  const data = instanceDataOf(state, card);
  if (isFrozen(state, card)) return `${nameOf(state, card.cardId)} is frozen`;
  const playableEquipment =
    data.cardType === "equipment" && scriptOf(state, card.cardId, card)?.playableEquipment === true;
  if (data.cardType !== "action" && data.cardType !== "instant" && !playableEquipment) {
    return "only action and instant cards can be played in the action phase";
  }
  const script = scriptOf(state, card.cardId, card);
  // A selected action half (including a melded card with both halves) uses
  // the action method. The instant half alone remains AP-free.
  if (script?.meld && !meldSide) return "choose a meld side";
  if (!script?.meld && meldSide) return `${nameOf(state, card.cardId)} does not have meld`;
  if (meldSide) card.meldSide = meldSide;
  const selectedMeldAction = !!script?.meld && !!meldSide &&
    meldSideHasType(state, card, meldSide, "action");
  // CR 8.2.6a: an arrow can only be played from the player's arsenal and only
  // if they control a bow
  if (isArrowData(data)) {
    if (from !== "arsenal") return "arrow cards can only be played from your arsenal";
    if (!controlsBow(state, player)) return "arrow cards can only be played while you control a bow";
  }
  const instantPermission = canPlayAsInstant(state, runtime, seat, card, undefined, from);
  if (asInstant === true && (selectedMeldAction || (data.cardType !== "instant" && !instantPermission))) {
    return `${nameOf(state, card.cardId)} cannot be played as an instant`;
  }
  if (
    from !== "hand"
    && from !== "arsenal"
    && playFromZoneRequiresInstant(state, runtime, card, from, seat)
    && asInstant !== true
  ) {
    return `${nameOf(state, card.cardId)} must be played as an instant`;
  }
  // The method is announced explicitly. An absent method remains compatible
  // with old recordings by choosing the instant method only when the ordinary
  // action method is impossible because the player has no action point.
  const isInstant =
    !selectedMeldAction && (
      data.cardType === "instant" ||
      asInstant === true ||
      (asInstant === undefined && player.actionPoints < 1 && instantPermission)
    );
  if (!isInstant && player.actionPoints < 1) return "not enough action points"; // instants are free of AP
  if (attackActionPlayRestricted(state, runtime, player, card)) {
    return `${nameOf(state, card.cardId)} cannot be played during this action phase`;
  }
  if (nonAttackActionCardLimitReached(state, player, card)) {
    return "cannot play another non-attack action card this turn";
  }
  if (cardPlayRestrictedByModifier(state, seat, card)) {
    return `${nameOf(state, card.cardId)} cannot be played due to a card-type restriction`;
  }
  if (alternativeCostCardInstanceIds !== undefined && !script?.alternativePlayCost) {
    return `${nameOf(state, card.cardId)} has no alternative play cost`;
  }
  if (
    alternativeCostCardInstanceIds?.some((id) => pitchInstanceIds.includes(id))
  ) {
    return "cannot pitch an alternative-cost card";
  }
  const canBoost = isAttackCard(data) && hasKeyword(state, card, "boost");
  if (boost && !canBoost) return `${nameOf(state, card.cardId)} cannot boost`;
  if (!boost && boostCount !== undefined) return "cannot declare a Boost count without boosting";
  const declaredBoostCount = boost ? (boostCount ?? 1) : 0;
  const maximumBoosts = canBoost
    ? Math.max(1, Math.floor(script?.boostCount ?? 1))
    : 0;
  if (
    !Number.isSafeInteger(declaredBoostCount) ||
    declaredBoostCount < 0 ||
    declaredBoostCount > maximumBoosts
  ) return `${nameOf(state, card.cardId)} cannot boost ${declaredBoostCount} times`;
  if (player.deck.length < declaredBoostCount) {
    return `cannot boost ${declaredBoostCount} times with only ${player.deck.length} card(s) in deck`;
  }
  if (script?.canPlay && !script.canPlay(runtime.makeCtx(state, seat, card, undefined, from === "arsenal"))) {
    return `${nameOf(state, card.cardId)} cannot be played now`;
  }
  // Meld (CR 8.3.38): "both" sets the asset-cost to twice the base cost
  // before increases and decreases. The side announcement was validated and
  // stamped above so it could also determine the play method and AP cost.
  const isAttackAction = data.cardType === "action" && (data.subtypes ?? []).includes("attack");
  if (targetAllyId !== undefined && !isAttackAction) return "only attacks can target an ally";
  if (isAttackAction && !attackTargetIsLegal(state, runtime, seat, targetAllyId)) return "not a legal attack target";
  const targetErr = preparePlayTarget(
    state, runtime,
    seat,
    card,
    targetCardInstanceId,
    undefined,
    from === "arsenal",
  );
  if (targetErr) return targetErr;
  const nextActionExtraCost = Number(player.flags.nextActionExtraCost || 0);
  const attackExtraCost = isAttackAction ? firstAttackExtraCost(state, player) : 0;
  const extraCost = nextActionExtraCost + attackExtraCost;
  const genericAttackReduction = isAttackAction
    ? Number(player.flags.nextActionCostReduction || 0)
    : 0;
  const guardianAttackReduction =
    isAttackAction && (data.classes ?? []).some((c) => c.toLowerCase() === "guardian")
      ? Number(player.flags.nextGuardianAttackCostReduction || 0)
      : 0;
  const reduction = genericAttackReduction + guardianAttackReduction;
  const perCardReduction = cardPlayReductionForSeat(card, seat);
  const runeGated = from === "banish" && canRuneGate(state, card);
  const variableCost = alternativeCostCardInstanceIds === undefined
    ? script?.variablePlayCost
    : undefined;
  const costForBase = (baseCostOverride?: number): number => cardPlayCost(state, runtime, seat, card, undefined, {
    ...(baseCostOverride === undefined ? {} : { baseCostOverride }),
    meldSide,
    extraCost,
    reduction,
    perCardReduction,
    runeGate: runeGated,
    alternativeCost: alternativeCostCardInstanceIds !== undefined,
    targetCardInstanceId,
    targetAllyId,
  });
  let variableBaseCost: number | undefined;
  if (variableCost) {
    if (declaredVariableX === undefined) {
      if (pitchInstanceIds.length > 0) return "declare X before pitching for this card";
      const resolvedVariableCost = resolveVariablePlayCost(
        variableCost,
        runtime.makeCtx(state, seat, card, undefined, from === "arsenal"),
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
      state.pendingDecision = {
        player: seat,
        kind: "choose-target",
        prompt: resolvedVariableCost.prompt ?? "Choose X",
        options,
        sourceInstanceId: card.instanceId,
        chooseHook: "engine-variable-play-x",
        variablePlayCost: {
          mode: "action",
          seat,
          instanceId,
          from,
          choices,
          ...(meldSide ? { meldSide } : {}),
          ...(targetAllyId === undefined ? {} : { targetAllyId }),
          ...(targetCardInstanceId === undefined ? {} : { targetCardInstanceId }),
          ...(boost ? { boost } : {}),
          ...(boostCount === undefined ? {} : { boostCount }),
          ...(asInstant ? { asInstant } : {}),
        },
      };
      return undefined;
    }
    const resolvedVariableCost = resolveVariablePlayCost(
      variableCost,
      runtime.makeCtx(state, seat, card, undefined, from === "arsenal"),
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
  const costErr = payCost(state, runtime, player, effectiveCost, pitchInstanceIds, instanceId, {
    beforePitch: () =>
      logPublic(state, `${nameOf(state, player.heroCardId)} plays ${logNameOf(state, card.cardId)}`),
  });
  if (costErr) return costErr;
  if (variableCost) {
    (card.counters ??= {})[variableCost.counterKey] = declaredVariableX!;
  }
  if (isAttackAction) consumeAttackCostReductions(state, seat, card, targetAllyId);
  if (alternativeCostCardInstanceIds !== undefined) {
    const alternativeErr = payAlternativePlayCost(
      state, runtime,
      player,
      card,
      alternativeCostCardInstanceIds,
    );
    if (alternativeErr) return alternativeErr;
  }
  if (script?.onPlayCostPaid) {
    const paidCards = pitchInstanceIds
      .map((id) => player.pitch.find((candidate) => candidate.instanceId === id))
      .filter((candidate): candidate is CardInstance => candidate !== undefined);
    script.onPlayCostPaid(runtime.makeCtx(state, seat, card), paidCards);
  }
  if (nextActionExtraCost > 0) player.flags.nextActionExtraCost = 0;
  if (attackExtraCost > 0) consumeFirstAttackExtraCost(state, player);
  if (genericAttackReduction > 0) player.flags.nextActionCostReduction = 0;
  if (guardianAttackReduction > 0) player.flags.nextGuardianAttackCostReduction = 0;
  // the card leaves its zone before additional costs are paid, so a random
  // discard (Wrecker Romp, Alpha Rampage) can never hit the card being played
  removeFromArray(source, instanceId);
  delete card.faceDown;
  if (runeGated) (card.counters ??= {}).runeGated = 1;
  // additional costs (discard random, reveal, ...) run as part of playing the card
  (card.counters ??= {}).payingAdditionalCost = 1;
  state.resolving.push(card);
  script?.additionalCost?.(runtime.makeCtx(state, seat, card));
  const pdCost = state.pendingDecision;
  if (pdCost?.chooseHook) {
    // the additional cost paused the play on a scripted choice (e.g. Fusion's
    // reveal); finishPlayCard continues once the choice is answered
    pdCost.resume = { kind: "finish-play", seat, card, from, targetAllyId, boost, boostCount, asInstant };
    return undefined;
  }
  removeFromArray(state.resolving, card.instanceId);
  finishPlayCard(state, runtime, seat, card, from, targetAllyId, boost, boostCount, asInstant);
  return undefined;
}

/** The tail of playCard: AP, played-card flags, friendly-play hooks, then the
 *  attack / instant / non-attack resolution paths. Split out so a scripted
 *  choice in additionalCost (Fusion) can pause and resume the play. */
export function finishPlayCard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  from: "hand" | "arsenal" | PlayableZone,
  targetAllyId?: number,
  boost = false,
  boostCount?: number,
  asInstant?: boolean,
): void {
  const player = state.players[seat] as PlayerState;
  const data = dataOf(state, card.cardId);
  delete card.counters?.payingAdditionalCost;
  if (from === "banish") player.flags.playedFromBanishThisTurn = true;
  // Snapshot method/timing before noteCardPlayed consumes one-shot permissions.
  const instantPermission = canPlayAsInstant(state, runtime, seat, card, undefined, from);
  const selectedMeldAction = card.meldSide !== undefined &&
    scriptOf(state, card.cardId, card)?.meld !== undefined &&
    meldSideHasType(state, card, card.meldSide, "action");
  const isInstant =
    !selectedMeldAction && (
      data.cardType === "instant" ||
      asInstant === true ||
      (asInstant === undefined && player.actionPoints < 1 && instantPermission)
    );
  if (!isInstant) player.actionPoints -= 1;
  const playEventNextId = state.nextInstanceId;
  const { goAgain, layers: playedTriggers } = announceCardPlayed(state, runtime, seat, card, from);

  if (isAttackCard(data)) {
    let boosted = false;
    let boostSucceeded = false;
    if (boost) {
      const declaredBoostCount = boostCount ?? 1;
      for (let boostIndex = 0; boostIndex < declaredBoostCount; boostIndex++) {
        const banished = player.deck.shift();
        if (!banished) break;
        const boostEventNextId = state.nextInstanceId;
        state.resolving.push(banished);
        const activeBoostSources = [player.hero, ...player.weapons, ...Object.values(player.equipment), ...player.board]
          .filter((source): source is CardInstance => source !== undefined && !source.faceDown);
        const boostSources = [
          ...activeBoostSources,
          ...lingeringModifierSources(state, seat).filter(
            (candidate) => !activeBoostSources.some((source) => source.instanceId === candidate.instanceId),
          ),
        ];
        const replaced = boostSources.some((source) =>
          scriptOf(state, source.cardId, source)?.replaceBoostBanish?.(
            runtime.makeCtx(state, seat, source), card, banished,
          ) === true,
        );
        if (!replaced) {
          removeFromArray(state.resolving, banished.instanceId);
          enterBanish(state, runtime, banished, "deck");
          deferEventTriggers(
            state, runtime,
            "card-banished-for-boost",
            seat,
            boostEventNextId,
            banished,
          );
          // Track the effective types actually banished for Boost. Card
          // scripts use these per-turn markers for conditions such as "if an
          // Evo has been banished from boosting this turn"; replacement
          // effects deliberately do not create the marker.
          for (const type of cardTypesOf(state, banished)) {
            player.flags[`boostedSubtype:${type}`] = true;
          }
        }
        boosted = true;
        boostSucceeded = boostSucceeded ||
          (dataOf(state, banished.cardId).classes ?? []).some(
            (c) => c.toLowerCase() === "mechanologist",
          );
        player.flags.boostedThisTurn = true;
        player.flags.boostCountThisTurn = (Number(player.flags.boostCountThisTurn) || 0) + 1;
        player.flags.lastBoostedCardInstanceId = banished.instanceId;
        const boostMods = state.modifiers.filter(
          (m) =>
            (m.scope === "until-end-of-turn" || m.scope === "combat-chain") &&
            m.seat === seat &&
            !m.consumed &&
            (m.onBoostAttack !== undefined || m.onBoostDominate === true),
        );
        for (const boostMod of boostMods) {
          if (boostMod.onBoostAttack !== undefined) {
            card.tempPower = (card.tempPower ?? 0) + Number(boostMod.onBoostAttack);
          }
          if (boostMod.onBoostDominate === true) {
            (card.grantedKeywords ??= []).push("dominate");
          }
          boostMod.consumed = true;
        }
        if (!replaced) scriptOf(state, banished.cardId, banished)?.onBanishedForBoost?.(
          runtime.makeCtx(state, seat, banished),
          card,
        );
        for (const src of boostSources) {
          scriptOf(state, src.cardId, src)?.onBoosted?.(runtime.makeCtx(state, seat, src), card, banished);
        }
        logPublic(state, `${logNameOf(state, card.cardId)} boosts`);
      }
    }
    deferTriggerLayers(state, playedTriggers);
    declareAttack(
      state, runtime,
      seat,
      card,
      "action",
      boostSucceeded,
      targetAllyId,
      from === "arsenal",
      boosted,
      playEventNextId,
      from === "banish",
      from !== "hand" && from !== "arsenal",
    );
    return;
  }
  // Playing a non-attack action closes the combat chain; an instant leaves it
  // open and lets the priority holder continue adding layers.
  if (!isInstant) closeChain(state, runtime);
  // go again is announced when the card is played (keyword / granted "the next
  // non-attack action card you play gets go again"); the action point itself
  // is refunded only when the card resolves (finishStackCardResolution)
  // Both instants and non-attack actions ride the stack and resolve only once
  // both players pass in succession (CR 5.3.2).
  pushCardLayer(state, seat, card, { fromHand: from === "hand", goAgain });
  state.stack.unshift(...playedTriggers);
  state.stackResume = "begin-action";
  if (state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume = { kind: "continue-stack", seat };
    return;
  }
  continueStack(state, runtime, seat);
}

export function activateAbility(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  sourceInstanceId: number,
  pitchInstanceIds: number[],
  abilityIndex = 0,
  targetAllyId?: number,
  soulInstanceIds: number[] = [],
  resumingActivationCost = false,
  effectCostInstanceIds: number[] = [],
  alternativeCostCardInstanceIds?: number[],
  discardInstanceIds: number[] = [],
  declaredVariableX?: number,
): string | undefined {
  if (state.phase !== "action" || (state.pendingDecision && !resumingActivationCost)) {
    return "cannot activate an ability now";
  }
  if (seat !== state.activePlayer || seat !== state.priorityPlayer) return "not your turn";
  const player = state.players[seat] as PlayerState;
  const permanent =
    findCard(player, sourceInstanceId) ??
    (player.hero.instanceId === sourceInstanceId ? player.hero : undefined);
  const isBanishSource = !!permanent && player.banish.some(
    (candidate) => candidate.instanceId === permanent.instanceId,
  );
  if (!permanent || (!isPermanentSource(player, permanent.instanceId) && !isBanishSource)) {
    const result = activateFromHandAbility(state, runtime, {
      mode: "action",
      seat,
      sourceInstanceId,
      abilityIndex,
      pitchInstanceIds,
      soulInstanceIds,
      effectCostInstanceIds,
      alternativeCostCardInstanceIds,
      discardInstanceIds,
      declaredVariableX,
    });
    if (result.status === "error") return result.error;
    if (result.status === "pending") return undefined;
    state.stackResume = "begin-action";
    if (state.pendingDecision?.chooseHook) {
      state.pendingDecision.resume = { kind: "continue-stack", seat };
      return undefined;
    }
    continueStack(state, runtime, seat);
    return undefined;
  }
  const card = permanent;
  if (activatedAbilitiesSuppressed(state, card)) return "activated abilities are suppressed";
  if (card.instanceId === player.hero.instanceId && heroAbilitiesDisabled(state, seat)) {
    return "hero abilities are disabled";
  }
  if (isFrozen(state, card)) return `${nameOf(state, card.cardId)} is frozen`;
  const script = scriptOf(state, card.cardId, card);
  const ability = abilityList(script)[abilityIndex];
  if (!ability) {
    // granted aura attacks (Cosmo): a ready board card with Ward and no
    // ability of its own at this index attacks via another permanent's marker
    return activateAuraAttack(state, runtime, seat, player, card, pitchInstanceIds, targetAllyId, abilityIndex);
  }
  if (ability.isAttack && player.flags[`cannotAttackInstance:${card.instanceId}`] === true) {
    return `${nameOf(state, card.cardId)} cannot attack again this turn`;
  }
  if (ability.isAttack && cardHasType(state, card, "weapon") && weaponAttacksProhibited(player)) {
    return "cannot attack with weapons this turn";
  }
  if ((ability.fromBanish === true) !== isBanishSource || ability.fromGraveyard) {
    return "ability is not usable from this zone";
  }
  // Cloaked: a face-down permanent's abilities are non-functional EXCEPT
  // abilities that turn it face up as part of their cost (CR 8.3.36)
  if (card.faceDown && !ability.turnsFaceUp && !ability.usableWhileFaceDown) {
    return `${nameOf(state, card.cardId)} has no such activated ability`;
  }
  const timing = ability.timing ?? "action";
  if (timing === "attack-reaction") return "only usable as an attack reaction";
  if (timing === "defense-reaction") return "only usable as a defense reaction";
  const costsAP = timing === "action";
  if (costsAP && actionAbilityRestrictedByModifier(state, seat, card, ability.isAttack)) {
    return "action ability is prohibited by a turn restriction";
  }
  if (costsAP && actionLimitReached(state, player)) {
    return "cannot play or activate another action this turn";
  }
  if (costsAP && player.actionPoints < 1) return "not enough action points";
  const ctx = runtime.makeCtx(state, seat, card);
  if (ability.canActivate && !ability.canActivate(ctx)) return "cannot activate now";
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
  const extraCost = Number(player.flags.nextActionExtraCost || 0);
  const resourceCostForBase = (base: number): number => ability.isAttack
    ? attackActivationCost(state, runtime, player, card, base + extraCost, targetAllyId)
    : abilityResourceCost(state, runtime, seat, card, { ...ability, cost: base }) + extraCost;
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
    state.pendingDecision = {
      player: seat,
      kind: "choose-target",
      prompt: resolvedVariableCost.prompt ?? "Choose X",
      options,
      sourceInstanceId: card.instanceId,
      chooseHook: "engine-variable-activation-x",
      variableActivationCost: {
        mode: "action",
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
    "action",
    seat,
    card,
    costAbility,
    abilityIndex,
    pitchInstanceIds,
    targetAllyId,
    discardInstanceIds,
    selectedEffectCostIds,
    alternativeCostCardInstanceIds,
    declaredVariableX,
  );
  if (discardCostPrep === "pending") return undefined;
  if (discardCostPrep) return discardCostPrep;
  const effectCostPrep = prepareActivatedEffectCardCosts(
    state,
    "action",
    seat,
    card,
    costAbility,
    abilityIndex,
    pitchInstanceIds,
    targetAllyId,
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
    state.pendingDecision = {
      player: seat,
      kind: "choose-target",
      prompt: `${nameOf(state, card.cardId)}: choose soul card ${selectedSoulIds.length + 1} of ${ability.banishSoulCost} to banish as a cost`,
      options: remaining.map((candidate) => String(candidate.instanceId)),
      cardOptions: remaining.map((candidate) => candidate.instanceId),
      chooseHook: "engine-activation-soul",
      activationCost: {
        mode: "action",
        seat,
        sourceInstanceId,
        abilityIndex,
        pitchInstanceIds,
        ...(targetAllyId !== undefined ? { targetAllyId } : {}),
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
  const resourceCost = ability.isAttack
    ? attackActivationCost(state, runtime, player, card, costAbility.cost + extraCost, targetAllyId)
    : abilityResourceCost(state, runtime, seat, card, costAbility) + extraCost;
  const nextActionGoAgain = costsAP && consumeNextActionGoAgain(player);
  const prepErr = payActivatedAbilityCost(state, runtime, seat, card, costAbility, abilityIndex, pitchInstanceIds, resourceCost, {
    chiCost: ability.chiCost,
    extraCost,
    soulInstanceIds: selectedSoulIds,
    effectCostInstanceIds: selectedEffectCostIds,
    discardInstanceIds,
  });
  if (prepErr) return prepErr;
  if (variableCost) (card.counters ??= {})[variableCost.counterKey] = declaredVariableX!;
  if (ability.isAttack) consumeAttackCostReductions(state, seat, card, targetAllyId);
  if (costsAP) player.actionPoints -= 1;
  if (costsAP) noteActionPlayedOrActivated(player);
  if (ability.isAttack) {
    if (!attackTargetIsLegal(state, runtime, seat, targetAllyId)) {
      return "not a legal attack target";
    }
    // allies on the board attack with their tap ability; the attack rides the
    // chain like a weapon attack (the ally stays in play when the chain closes)
    const isAlly = cardTypesOf(state, card).includes("ally");
    consumeFirstAttackExtraCost(state, player);
    if (cardHasType(state, card, "weapon")) {
      deferEventTriggers(state, runtime, "weapon-attack-activated", seat, state.nextInstanceId, card);
    }
    declareAttack(
      state, runtime,
      seat,
      card,
      isAlly ? "ally" : "weapon",
      ability.goAgain || nextActionGoAgain,
      targetAllyId,
    );
    return undefined;
  }
  if (targetAllyId !== undefined) return "only attacks can target an ally";
  // Like playing a non-attack action card, activating a non-attack action
  // ability ends the current combat chain before its layer is added. Instant
  // abilities use this same path but do not close the chain.
  if (costsAP) closeChain(state, runtime);
  pushAbilityLayer(state, seat, card, nameOf(state, card.cardId), {
    abilityIndex,
    goAgain: ability.goAgain || nextActionGoAgain,
  });
  state.stackResume = "begin-action";
  // Paying an activation cost can make a permanent leave the arena and open
  // a scripted choice. Preserve it, then continue with the new ability layer.
  if (state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume = { kind: "continue-stack", seat };
    return undefined;
  }
  continueStack(state, runtime, seat);
  return undefined;
}

/**
 * Answer a scripted choice ("choose" intent) for choose-target / optional-effect
 * decisions. Caller (index.ts) handles any resume continuation afterwards.
 * Handles the "stack-card" resume (finishing a paused stack-card resolution)
 * itself.
 */
function resolveScriptChoice(
  state: GameStateInternal,
  runtime: EngineRuntime,
  sourceInstanceId: number | undefined,
  hook: string | undefined,
  result: string,
  tokenCreationCause?: TokenCreationContext,
): void {
  if (sourceInstanceId === undefined || !hook) return;
  const owner = findCardAnywhere(state, sourceInstanceId);
  if (!owner) return;
  const ctx = runtime.makeCtx(
    state,
    owner.seat,
    owner.card,
    currentLink(state),
    undefined,
    undefined,
    undefined,
    tokenCreationCause,
  );
  const script = scriptOf(state, owner.card.cardId, owner.card);
  script?.onChoose?.(ctx, hook, result);
  const inheritedIds = [
    ...(owner.card.grantedBaseAbilitiesCardId ? [owner.card.grantedBaseAbilitiesCardId] : []),
    ...(owner.card.grantedBaseAbilitiesCardIds ?? []),
  ];
  for (const inheritedId of inheritedIds) {
    state.scriptsRef[inheritedId]?.onChoose?.(ctx, hook, result);
  }
}

export function answerChoice(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pd = state.pendingDecision;
  if (!pd || pd.player !== seat) return "not your decision";
  if (
    pd.kind !== "choose-target" &&
    pd.kind !== "choose-name" &&
    pd.kind !== "optional-effect"
  ) return "not a choice decision";
  if (pd.options && !pd.options.includes(optionId)) return "invalid option";
  let resolvedOption = optionId;
  if (pd.kind === "choose-name") {
    const normalized = optionId.trim().toLowerCase();
    const registered = Object.values(state.cardsRef).find(
      (card) => card.name.trim().toLowerCase() === normalized,
    );
    if (!registered) return "not a registered card name";
    resolvedOption = registered.name;
  }
  const srcId = pd.sourceInstanceId;
  const hook = pd.chooseHook;
  const resume = pd.resume;
  const tokenCreationCause = pd.tokenCreationCause;
  if (hook === "combat-damage-equipment-replacement" || hook === "arcane-barrier" || hook === "arcane-barrier-pitch" || hook === "spellvoid" || hook === "ward" || hook === "quell" || hook === "quell-pitch" || hook === "optional-damage-prevention" || hook === "discard-damage-prevention" || hook === "soul-damage-prevention") {
    // engine-owned decision (Ward / Spellvoid / Arcane Barrier prevention):
    // the damage-prevention machine in util.ts manages the pending decision itself
    const err = answerArcaneBarrier(state, runtime, seat, optionId);
    if (err) return err;
  } else if (hook === "engine-deck-bottom-order") {
    const err = answerDeckBottomOrder(state, runtime, seat, optionId);
    if (err) return err;
  } else if (hook === "engine-die-roll-replacement") {
    const err = answerDieRollReplacement(state, runtime, seat, optionId);
    if (err) return err;
  } else if (hook === "engine-token-creation-replacement") {
    const err = answerTokenCreationReplacement(state, runtime, seat, optionId);
    if (err) return err;
  } else if (hook === "engine-token-replacement-player-order") {
    const err = answerTokenReplacementPlayerOrder(state, runtime, seat, optionId);
    if (err) return err;
  } else if (hook === "engine-token-replacement-order") {
    const err = answerTokenReplacementOrder(state, runtime, seat, optionId);
    if (err) return err;
  } else if (hook === "engine-wager-loss-replacement-order") {
    const err = answerWagerLossReplacementOrder(state, runtime, seat, optionId);
    if (err) return err;
  } else if (hook === "engine-effect-attack-target") {
    if (srcId === undefined) return "effect-driven attack has no source";
    const targetAllyId = optionId === "opposing hero" ? undefined : Number(optionId);
    if (optionId !== "opposing hero" && !Number.isSafeInteger(targetAllyId)) {
      return "invalid attack target";
    }
    state.pendingDecision = null;
    if (!attackWithPermanent(state, runtime, seat, srcId, targetAllyId, true)) {
      return "effect-driven attack is no longer legal";
    }
  } else if (hook === "engine-look") {
    // look-at acknowledgment: the look already happened (and was logged);
    // "pass" simply dismisses the floated cards
    state.pendingDecision = null;
  } else if (pd.clash) {
    const err = answerClashDecision(state, runtime, seat, optionId);
    if (err) return err;
  } else if (hook === "engine-crank") {
    state.pendingDecision = null;
    const found = srcId === undefined ? undefined : findCardAnywhere(state, srcId);
    if (optionId === "yes" && found) {
      const steam = found?.card.counters?.steam ?? 0;
      if (found && steam > 0) {
        if (steam === 1) delete found.card.counters?.steam;
        else (found.card.counters ??= {}).steam = steam - 1;
        logPublic(state, `${nameOf(state, found.card.cardId)} is cranked: remove a steam counter`);
        (state.players[found.seat] as PlayerState).flags.crankedThisTurn = true;
        runtime.makeCtx(state, found.seat, found.card).gainActionPoint();
        runtime.events.fireOnFriendlyCrank(state, found.seat, found.card);
      }
    }
    if (found) runtime.events.fireFriendlyEnterArena(state, found.seat, found.card);
  } else if (pd.xPayment) {
    const declared = pd.xPayment.choices[optionId];
    if (!declared) return "invalid X declaration";
    const paying = state.players[seat] as PlayerState;
    const pitchOptions = scriptedPaymentOptions(
      state,
      paying,
      declared.cost,
      declared.result,
    );
    const options = Object.keys(pitchOptions);
    if (options.length === 0) return "declared X cannot be paid";
    const noPitch = options.length === 1 ? pitchOptions[options[0]!] : undefined;
    if (noPitch?.pitchIds.length === 0) {
      const err = payCost(state, runtime, paying, noPitch.cost, []);
      if (err) return err;
      state.pendingDecision = null;
      resolveScriptChoice(state, runtime, srcId, hook, noPitch.result, tokenCreationCause);
    } else {
      state.pendingDecision = {
        player: seat,
        kind: "choose-target",
        prompt: `Pay ${declared.cost} resources`,
        options,
        sourceInstanceId: srcId,
        chooseHook: hook,
        ...(tokenCreationCause ? { tokenCreationCause } : {}),
        payment: { pitchOptions },
        resourcePayment: {
          cost: declared.cost,
          options: Object.entries(pitchOptions).map(([paymentOptionId, payment]) => ({
            optionId: paymentOptionId,
            pitchInstanceIds: payment.pitchIds,
          })),
        },
      };
    }
  } else if (pd.payment) {
    const payment = pd.payment;
    const picked = payment.pitchOptions[optionId];
    if (optionId !== "no" && !picked) return "invalid payment option";
    if (picked) {
      const err = payCost(state, runtime, state.players[seat] as PlayerState, picked.cost, picked.pitchIds);
      if (err) return err;
    }
    state.pendingDecision = null;
    resolveScriptChoice(
      state,
      runtime,
      srcId,
      hook,
      picked ? picked.result : "declined",
      tokenCreationCause,
    );
  } else {
    state.pendingDecision = null;
    resolveScriptChoice(state, runtime, srcId, hook, resolvedOption, tokenCreationCause);
  }
  // Token commands later in the suspended effect are queued behind the first
  // replacement decision. Drain them before the original effect resumes.
  resumePendingTokenCreations(state, runtime);

  // onChoose may chain a follow-up scripted choice (Stroke of Foresight: pick
  // a hand card, then top/bottom; Katsu: discard, then search). The original
  // resume continuation runs only once the follow-up has been answered.
  const chained = state.pendingDecision as GameStateInternal["pendingDecision"];
  // A choice sourced by a different card (for example, an aura's enter-arena
  // ability or Crank) belongs to an object created or moved by this effect.
  // The originating card must leave the stack before that new choice opens.
  // Follow-up choices sourced by the resolving card itself remain part of its
  // effect and keep the original stack-card continuation.
  const choiceWaitsForResolvedLayer =
    resume?.kind === "stack-card" &&
    chained?.chooseHook !== undefined &&
    (
      chained.chooseHook === "engine-crank" ||
      (
        chained.sourceInstanceId !== undefined &&
        chained.sourceInstanceId !== resume.card.instanceId
      )
    );
  if (resume && chained?.chooseHook && !choiceWaitsForResolvedLayer) {
    // Ordering a wager-loss replacement may open that replacement's own
    // scripted choice with a narrower continuation over the remaining effects.
    // Other chained choices keep inheriting the originating continuation.
    if (hook === "engine-wager-loss-replacement-order") chained.resume ??= resume;
    else chained.resume = resume;
    return undefined;
  }
  if (resume?.kind === "stack-card") {
    const idx = state.resolving.findIndex((c) => c.instanceId === resume.card.instanceId);
    const card = (idx >= 0 ? state.resolving[idx] : resume.card) as CardInstance;
    if (idx >= 0) state.resolving.splice(idx, 1);
    const layer = state.stack.find(
      (candidate) => candidate.card?.instanceId === card.instanceId,
    );
    if (layer) layer.card = card;
    finishStackCardResolution(state, runtime, resume.seat);
  }
  if (resume?.kind === "finish-play") {
    const idx = state.resolving.findIndex((c) => c.instanceId === resume.card.instanceId);
    // the resolving copy is authoritative: onChoose may have written counters
    // onto it (Fusion's "fused"), and cloneState's JSON round-trip does not
    // preserve object identity between resume.card and the resolving entry
    const card = (idx >= 0 ? state.resolving[idx] : resume.card) as CardInstance;
    if (idx >= 0) state.resolving.splice(idx, 1);
    finishPlayCard(
      state, runtime,
      resume.seat,
      card,
      resume.from,
      resume.targetAllyId,
      resume.boost ?? false,
      resume.boostCount,
      resume.asInstant,
    );
  }
  if (resume?.kind === "finish-reaction") {
    const idx = state.resolving.findIndex((c) => c.instanceId === resume.card.instanceId);
    const card = (idx >= 0 ? state.resolving[idx] : resume.card) as CardInstance;
    if (idx >= 0) state.resolving.splice(idx, 1);
    finishReactionPlay(state, runtime, resume.seat, card, resume.from);
  }
  if (resume?.kind === "finish-window-instant") {
    const idx = state.resolving.findIndex((c) => c.instanceId === resume.card.instanceId);
    const card = (idx >= 0 ? state.resolving[idx] : resume.card) as CardInstance;
    if (idx >= 0) state.resolving.splice(idx, 1);
    finishWindowInstantPlay(state, runtime, resume.seat, card, resume.from);
  }
  return undefined;
}
