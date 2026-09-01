import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { AdditionalPlayCostSelection, CardData, GameIntent, MeldSide, PlayableZone } from "@fyendal/shared";
import type { CardInstance, PlayerState } from "./state.js";
import {
  activatedAbilitiesSuppressed,
  cardHasType,
  dataOf,
  hasKeyword,
  instanceDataOf,
  isArrowData,
  isChiCard,
  meldSideHasType,
  scriptOf,
} from "./cardProperties.js";
import { currentLink, findCardAnywhere, heroSoulCards } from "./zoneQueries.js";
import { enumeratePitchSequences } from "./pitchSequences.js";
import {
  attackablePermanents,
  attackActivationCost,
  isAuraAttacker,
  mandatoryAttackTargets,
} from "./attacks.js";
import { attackAllowsDefender, legalDefenderCards } from "./defense.js";
import { defenseReactionRestriction } from "./reactions.js";
import {
  attackHasDominate,
  attackHasOverpower,
  attackMaxNonBlockDefenders,
  grantsAuraAttackMarker,
} from "./combatValues.js";
import { abilityList } from "./scripts.js";
import type { ActivatedAbility } from "./scripts.js";
import { windowInstantPlays } from "./triggers.js";
import { runechantSkipStep } from "./runechantSkip.js";
import { controlledPermanents } from "./sourceQueries.js";
import { abilitiesAsInstantForCard, abilityResourceCost, actionAbilityRestrictedByModifier, activatedAbilityAvailable, activatedEffectCardCostOptions, canPayActivatedEffectCardCosts, discardCostOptions, effectiveAbilityList } from "./abilityRules.js";
import { alternativePlayCostOptions, canPlayAsInstant, canRuneGate, cardPlayCost, cardPlayReductionForSeat, cardPlayRestrictedByModifier, cardsPlayableFromArsenal, cardsPlayableFromZone, playFromZoneRequiresInstant, playTargetOptions } from "./playRules.js";
import { canPayRequiredHandCardsForAdditionalCost, pitchProhibitedByEffect, pitchValueOfInstance } from "./resources.js";
import { heroAbilitiesDisabled } from "./stateQueries.js";
import { actionLimitReached, controlsBow, firstAttackExtraCost, isFrozen, opposingInstantsProhibited } from "./ruleQueries.js";
import { nonAttackActionCardLimitReached, opposingActionsProhibited, ownedCardActionProhibited } from "./restrictions.js";
import { attackActionPlayRestricted, defendingHeroCannotRespondBelowPower, weaponAttacksProhibited } from "./combatRestrictions.js";

function filterOwnedCardActions(
  state: GameStateInternal,
  seat: number,
  intents: GameIntent[],
): GameIntent[] {
  return intents.filter((intent) => {
    const instanceId = intent.kind === "activate-ability"
      ? intent.sourceInstanceId
      : intent.kind === "play-card" || intent.kind === "play-from-arsenal" || intent.kind === "play-from-zone"
        ? intent.instanceId
        : undefined;
    if (instanceId === undefined) return true;
    const found = findCardAnywhere(state, instanceId);
    return !found || !ownedCardActionProhibited(state, seat, found.card);
  });
}

/** Legal attack targets, with the opposing hero (the absent legacy wire
 * field) last so intent tie-breaking continues to prefer attacking the hero. */
function attackTargets(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
): Array<number | undefined> {
  const permanents = attackablePermanents(state, player.seat === 0 ? 1 : 0);
  const mandatory = mandatoryAttackTargets(state, runtime, player.seat);
  if (mandatory.length > 0) return mandatory.map((card) => card.instanceId);
  return [...permanents.map((card) => card.instanceId), undefined];
}

function announceAttackTarget(intents: GameIntent[], targetAllyId?: number): GameIntent[] {
  return targetAllyId === undefined
    ? intents
    : intents.map((intent) => ({ ...intent, targetAllyId }) as GameIntent);
}

function pitchRequirement(player: PlayerState, cost: number, chiCost = 0): number {
  return Math.max(
    0,
    cost + chiCost - player.resources - player.chi,
    chiCost - player.chi,
  );
}

/** Whether the player's floating pool and eligible hand cards can satisfy the
 * chi portion of a payment. Candidate enumeration may forgive an ordinary
 * resource shortage, but never a chi shortage. */
function canCoverChiRequirement(
  state: GameStateInternal,
  player: PlayerState,
  chiCost: number,
  excludeInstanceIds: readonly number[],
): boolean {
  if (player.chi >= chiCost) return true;
  const availableChi = player.hand.reduce((total, card) => {
    if (
      excludeInstanceIds.includes(card.instanceId) ||
      !isChiCard(state, card) ||
      pitchProhibitedByEffect(state, player, card)
    ) return total;
    return total + pitchValueOfInstance(state, card);
  }, player.chi);
  return availableChi >= chiCost;
}

/**
 * Enumerate reasonable ordered pitch sequences from hand that cover `cost` together with
 * the floating pools (resources + chi). Prefers small, tight subsets and
 * returns [] as the sole option when the cost is already covered. With `chiCost` (a {c}
 * cost) only chi-subtype cards may be pitched, and the chi pool must cover
 * the chi part. Pitch order is significant because the sequence must stop as
 * soon as the running pool covers the payment.
 */
function pitchOptions(
  state: GameStateInternal,
  player: PlayerState,
  cost: number,
  excludeInstanceIds: readonly number[] = [],
  chiCost = 0,
  includeUnaffordable = false,
): number[][] {
  const pool = player.resources + player.chi;
  if (pool >= cost + chiCost && player.chi >= chiCost) return [[]];
  const candidates = player.hand.filter(
    (c) =>
      !excludeInstanceIds.includes(c.instanceId) &&
      pitchValueOfInstance(state, c) > 0 &&
      !pitchProhibitedByEffect(state, player, c) &&
      (chiCost === 0 || isChiCard(state, c)),
  );
  // both constraints at once: combined pool covers cost+chiCost, chi pool covers chiCost
  const need = pitchRequirement(player, cost, chiCost);
  const options = enumeratePitchSequences(
    candidates.map((card) => ({
      instanceId: card.instanceId,
      value: pitchValueOfInstance(state, card),
    })),
    0,
    need,
    48,
  );
  // Action candidates are a discovery projection, not executable legal
  // intents. Keep a structurally valid variant visible when ordinary
  // resources are the only missing part; applyIntent validates the exact
  // pitch sequence eventually submitted by the client.
  return options.length === 0 && includeUnaffordable &&
      canCoverChiRequirement(state, player, chiCost, excludeInstanceIds)
    ? [[]]
    : options;
}

/** Resource-payment options that leave enough eligible hand cards to pay an
 * activated ability's separate discard cost. */
function activatedAbilityPitchOptions(
  state: GameStateInternal,
  player: PlayerState,
  ability: ActivatedAbility,
  resourceCost: number,
  excludeInstanceIds: readonly number[] = [],
  includeUnaffordable = false,
): number[][] {
  const options = pitchOptions(
    state,
    player,
    resourceCost,
    excludeInstanceIds,
    ability.chiCost,
    includeUnaffordable,
  ).filter((pitches) => {
    if (!ability.discardCost) return true;
    const unavailable = new Set([...excludeInstanceIds, ...pitches]);
    return discardCostOptions(state, player, ability)
      .filter((card) => !unavailable.has(card.instanceId)).length >= ability.discardCost.count;
  });
  if (options.length > 0 || !includeUnaffordable) return options;
  if (!canCoverChiRequirement(state, player, ability.chiCost ?? 0, excludeInstanceIds)) return [];
  if (!ability.discardCost) return [[]];
  const unavailable = new Set(excludeInstanceIds);
  return discardCostOptions(state, player, ability)
      .filter((card) => !unavailable.has(card.instanceId)).length >= ability.discardCost.count
    ? [[]]
    : [];
}

/** Play intents for one card with each enumerated pitch sequence (up to `maxPitches`). */
function playIntentsWithPitches(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
  from: "hand" | "arsenal" | PlayableZone,
  maxPitches: number,
  cost?: number,
  meldSide?: MeldSide,
  boost?: boolean,
  boostCount?: number,
  alternativeCostCardInstanceIds?: number[],
  targetCardInstanceId?: number,
  includeUnaffordable = false,
): GameIntent[] {
  const excluded = [card.instanceId];
  if (alternativeCostCardInstanceIds !== undefined) {
    excluded.push(...alternativeCostCardInstanceIds);
  }
  const effectiveCost = cost ?? dataOf(state, card.cardId).cost ?? 0;
  const pitchRequired = pitchRequirement(player, effectiveCost);
  const declaredCost = scriptOf(state, card.cardId, card)?.alternativePlayCost;
  const additionalCostSelection: AdditionalPlayCostSelection | undefined =
    alternativeCostCardInstanceIds !== undefined &&
      declaredCost?.kind === "destroy-controlled-and-or-discard-hand-subtype"
      ? {
          kind: "destroy-controlled-and-or-discard-hand",
          cardLabel: declaredCost.cardLabel,
          maximumDestroyed: declaredCost.maximumDestroyed,
          maximumDiscarded: declaredCost.maximumDiscarded,
        }
      : undefined;
  return pitchOptions(state, player, effectiveCost, excluded, 0, includeUnaffordable)
    .filter((pitches) => canPayRequiredHandCardsForAdditionalCost(
      state,
      player.seat,
      card,
      [...pitches, ...(alternativeCostCardInstanceIds ?? [])],
    ))
    .slice(0, maxPitches)
    .map((pitches) =>
      from === "hand" || from === "arsenal"
        ? ({
            kind: from === "arsenal" ? "play-from-arsenal" : "play-card",
            instanceId: card.instanceId,
            pitchInstanceIds: pitches,
            pitchRequired,
            ...(meldSide ? { meldSide } : {}),
            ...(boost ? { boost: true } : {}),
            ...(boostCount !== undefined && boostCount > 1 ? { boostCount } : {}),
            ...(targetCardInstanceId !== undefined ? { targetCardInstanceId } : {}),
            ...(alternativeCostCardInstanceIds !== undefined
              ? { alternativeCostCardInstanceIds }
              : {}),
            ...(additionalCostSelection ? { additionalCostSelection } : {}),
          } as GameIntent)
        : ({
            kind: "play-from-zone",
            zone: from,
            instanceId: card.instanceId,
            pitchInstanceIds: pitches,
            pitchRequired,
            ...(meldSide ? { meldSide } : {}),
            ...(boost ? { boost: true } : {}),
            ...(boostCount !== undefined && boostCount > 1 ? { boostCount } : {}),
            ...(targetCardInstanceId !== undefined ? { targetCardInstanceId } : {}),
            ...(alternativeCostCardInstanceIds !== undefined
              ? { alternativeCostCardInstanceIds }
              : {}),
            ...(additionalCostSelection ? { additionalCostSelection } : {}),
          } as GameIntent),
    );
}

function markInstantPlayMethod(
  candidates: GameIntent[],
  enabled: boolean,
): GameIntent[] {
  if (!enabled) return candidates;
  return candidates.map((candidate) => (
    candidate.kind === "play-card"
    || candidate.kind === "play-from-arsenal"
    || candidate.kind === "play-from-zone"
      ? { ...candidate, asInstant: true }
      : candidate
  ));
}

function playIntentsForCard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  card: CardInstance,
  from: "hand" | "arsenal" | PlayableZone,
  includeUnaffordable = false,
): GameIntent[] {
  if (player.flags.playsRestrictedToArsenal === true && from !== "arsenal") return [];
  if (card.faceDown && from !== "arsenal") return [];
  if (isFrozen(state, card)) return [];
  const data = instanceDataOf(state, card);
  const playableEquipment =
    data.cardType === "equipment" && scriptOf(state, card.cardId, card)?.playableEquipment === true;
  if (data.cardType !== "action" && data.cardType !== "instant" && !playableEquipment) return [];
  if (player.actionPoints < 1 && !canPlayAsInstant(state, runtime, player.seat, card, undefined, from)) return [];
  if (attackActionPlayRestricted(state, runtime, player, card)) return [];
  if (nonAttackActionCardLimitReached(state, player, card)) return [];
  if (cardPlayRestrictedByModifier(state, player.seat, card)) return [];
  // CR 8.2.6a: arrows only from the arsenal, and only while controlling a bow
  if (isArrowData(data) && (from !== "arsenal" || !controlsBow(state, player))) return [];
  const script = scriptOf(state, card.cardId, card);
  if (
    script?.canPlay &&
    !script.canPlay(runtime.makeCtx(state, player.seat, card, undefined, from === "arsenal"))
  ) return [];
  // mirror playCard's effective cost so the offered pitches match what
  // applyIntent will accept (extra cost from Debilitate, reduction from
  // Heartened Cross Strap, ...); Meld "both" doubles the base cost first
  const isAttackAction = data.cardType === "action" && (data.subtypes ?? []).includes("attack");
  const withPlayMethods = (intents: GameIntent[]): GameIntent[] => {
    // A variable declaration or scripted additional cost can pause before the
    // card becomes a stack layer. The hint is deliberately conservative:
    // synchronous additional costs merely skip an optimistic animation.
    const presented = script?.variablePlayCost || script?.additionalCost
      ? intents.map((intent) => ({ ...intent, deferPlayPresentation: true as const }))
      : intents;
    if (data.cardType === "instant") return presented;
    if (!canPlayAsInstant(state, runtime, player.seat, card, undefined, from)) return presented;
    const instantIntents = presented.flatMap((intent): GameIntent[] => {
      if (
        intent.kind !== "play-card" &&
        intent.kind !== "play-from-arsenal" &&
        intent.kind !== "play-from-zone"
      ) return [];
      return [{ ...intent, asInstant: true }];
    });
    if (
      from !== "hand"
      && from !== "arsenal"
      && playFromZoneRequiresInstant(state, runtime, card, from, player.seat)
    ) return instantIntents;
    return player.actionPoints > 0 ? [...presented, ...instantIntents] : instantIntents;
  };
  const deferVariablePayment = (intents: GameIntent[]): GameIntent[] => {
    if (!script?.variablePlayCost) return intents;
    const first = intents[0];
    if (!first || (
      first.kind !== "play-card" &&
      first.kind !== "play-from-arsenal" &&
      first.kind !== "play-from-zone"
    )) return [];
    return [{ ...first, pitchInstanceIds: [], pitchRequired: undefined }];
  };
  const extraCost =
    Number(player.flags.nextActionExtraCost || 0) +
    (isAttackAction ? firstAttackExtraCost(state, player) : 0);
  const reduction =
    (isAttackAction ? Number(player.flags.nextActionCostReduction || 0) : 0) +
    (isAttackAction && (data.classes ?? []).some((c) => c.toLowerCase() === "guardian")
      ? Number(player.flags.nextGuardianAttackCostReduction || 0)
      : 0);
  const sides: MeldSide[] = (script?.meld ? ["left", "right", "both"] as MeldSide[] : [])
    .filter((side) => player.actionPoints > 0 || !meldSideHasType(state, card, side, "action"));
  const alternativeCosts = alternativePlayCostOptions(state, player, card);
  const cardTargets: Array<number | undefined> = script?.playTargetOptions
    ? playTargetOptions(state, runtime, player.seat, card, undefined, from === "arsenal")
    : [undefined];
  const targets = isAttackAction ? attackTargets(state, runtime, player) : [undefined];
  if (cardTargets.length === 0) return [];
  if (sides.length === 0) {
    const intents: GameIntent[] = [];
    for (const targetAllyId of targets) for (const targetCardInstanceId of cardTargets) {
      const effectiveCost = cardPlayCost(state, runtime, player.seat, card, undefined, {
        ...(script?.variablePlayCost ? { baseCostOverride: script.variablePlayCost.base +
          (script.variablePlayCost.minimum ?? 0) * (script.variablePlayCost.resourcesPerX ?? 1) } : {}),
        extraCost,
        reduction,
        perCardReduction: cardPlayReductionForSeat(card, player.seat),
        runeGate: from === "banish" && canRuneGate(state, card),
        targetCardInstanceId,
        targetAllyId,
      });
      intents.push(...announceAttackTarget(deferVariablePayment(playIntentsWithPitches(
        state,
        player,
        card,
        from,
        6,
        effectiveCost,
        undefined,
        undefined,
        undefined,
        undefined,
        targetCardInstanceId,
        includeUnaffordable,
      )), targetAllyId));
      if (
        isAttackAction &&
        hasKeyword(state, card, "boost") &&
        player.deck.length > 0
      ) {
        const maximumBoosts = Math.min(
          player.deck.length,
          Math.max(1, Math.floor(scriptOf(state, card.cardId, card)?.boostCount ?? 1)),
        );
        for (let boostCount = 1; boostCount <= maximumBoosts; boostCount++) {
          intents.push(...announceAttackTarget(playIntentsWithPitches(
            state,
            player,
            card,
            from,
            6,
            effectiveCost,
            undefined,
            true,
            boostCount,
            undefined,
            targetCardInstanceId,
            includeUnaffordable,
          ), targetAllyId));
        }
      }
      for (const alternativeCostCardInstanceIds of alternativeCosts) {
        const alternativeCost = cardPlayCost(state, runtime, player.seat, card, undefined, {
          extraCost,
          reduction,
          perCardReduction: cardPlayReductionForSeat(card, player.seat),
          alternativeCost: true,
          targetCardInstanceId,
          targetAllyId,
        });
        intents.push(...announceAttackTarget(playIntentsWithPitches(
          state,
          player,
          card,
          from,
          6,
          alternativeCost,
          undefined,
          undefined,
          undefined,
          alternativeCostCardInstanceIds,
          targetCardInstanceId,
          includeUnaffordable,
        ), targetAllyId));
        if (
          isAttackAction &&
          hasKeyword(state, card, "boost") &&
          player.deck.length > 0
        ) {
          const maximumBoosts = Math.min(
            player.deck.length,
            Math.max(1, Math.floor(scriptOf(state, card.cardId, card)?.boostCount ?? 1)),
          );
          for (let boostCount = 1; boostCount <= maximumBoosts; boostCount++) {
            intents.push(...announceAttackTarget(playIntentsWithPitches(
              state,
              player,
              card,
              from,
              6,
              alternativeCost,
              undefined,
              true,
              boostCount,
              alternativeCostCardInstanceIds,
              targetCardInstanceId,
              includeUnaffordable,
            ), targetAllyId));
          }
        }
      }
    }
    return withPlayMethods(intents);
  }
  // Meld split cards: one set of intents per announced side
  const intents = sides.flatMap((side) => targets.flatMap((targetAllyId) => cardTargets.flatMap((targetCardInstanceId) => {
    const effectiveCost = cardPlayCost(state, runtime, player.seat, card, undefined, {
      meldSide: side,
      extraCost,
      reduction,
      perCardReduction: cardPlayReductionForSeat(card, player.seat),
      targetCardInstanceId,
      targetAllyId,
    });
    const sideIntents = announceAttackTarget(playIntentsWithPitches(
      state,
      player,
      card,
      from,
      6,
      effectiveCost,
      side,
      undefined,
      undefined,
      undefined,
      targetCardInstanceId,
      includeUnaffordable,
    ), targetAllyId);
    for (const alternativeCostCardInstanceIds of alternativeCosts) {
      const alternativeCost = cardPlayCost(state, runtime, player.seat, card, undefined, {
        meldSide: side,
        extraCost,
        reduction,
        perCardReduction: cardPlayReductionForSeat(card, player.seat),
        alternativeCost: true,
        targetCardInstanceId,
        targetAllyId,
      });
      sideIntents.push(...announceAttackTarget(playIntentsWithPitches(
        state,
        player,
        card,
        from,
        6,
        alternativeCost,
        side,
        undefined,
        undefined,
        alternativeCostCardInstanceIds,
        targetCardInstanceId,
        includeUnaffordable,
      ), targetAllyId));
    }
    return sideIntents;
  })));
  return withPlayMethods(intents);
}

/**
 * "Instant" (any priority window) and "Attack Reaction" (reaction step only)
 * abilities of permanents — equipment, board cards, the weapon slots (off-hand
 * equipment like Compass of Sunken Depths lives there), and the attacking
 * attack cards, which remain face up on the combat chain until it closes.
 */
function windowAbilityIntents(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  attackReactionWindow: boolean,
  includeUnaffordable = false,
): GameIntent[] {
  const link = currentLink(state);
  const intents: GameIntent[] = [];
  const isAttacker = !!link && link.attacker === player.seat;
  const windowKind = state.pendingDecision?.kind;
  const chainAttackers = isAttacker
    ? state.chain
        .filter((candidate) =>
          candidate.attacker === player.seat && candidate.flags.attackGone !== true
        )
        .map((candidate) => candidate.attackingCard)
    : [];
  const sources: CardInstance[] = [
    player.hero,
    ...(Object.values(player.equipment).filter((c): c is CardInstance => !!c)),
    ...player.weapons,
    ...player.board,
    ...chainAttackers,
    ...player.graveyard.filter((card) =>
      abilityList(scriptOf(state, card.cardId, card)).some((ability) => ability.fromGraveyard === true)
    ),
    ...player.banish.filter((card) =>
      abilityList(scriptOf(state, card.cardId, card)).some((ability) => ability.fromBanish === true)
    ),
    ...player.arsenal.filter((card) =>
      abilityList(scriptOf(state, card.cardId, card)).some((ability) => ability.fromArsenal === true)
    ),
  ];
  for (const card of sources) {
    if (activatedAbilitiesSuppressed(state, card)) continue;
    const fromGraveyard = player.graveyard.some((candidate) => candidate.instanceId === card.instanceId);
    const fromBanish = player.banish.some((candidate) => candidate.instanceId === card.instanceId);
    const fromArsenal = player.arsenal.some((candidate) => candidate.instanceId === card.instanceId);
    if (card.instanceId === player.hero.instanceId && heroAbilitiesDisabled(state, player.seat)) {
      continue;
    }
    const abilities = effectiveAbilityList(state, player.seat, card);
    for (let ai = 0; ai < abilities.length; ai++) {
      const ability = abilities[ai]!;
      if (ability.isAttack && player.flags[`cannotAttackInstance:${card.instanceId}`] === true) continue;
      if (ability.isAttack || ability.fromHand) continue;
      if ((ability.fromGraveyard === true) !== fromGraveyard) continue;
      if ((ability.fromBanish === true) !== fromBanish) continue;
      if ((ability.fromArsenal === true) !== fromArsenal) continue;
      if (isFrozen(state, card)) continue;
      // Cloaked: only flip-up cost abilities function while face-down
      if (card.faceDown && !ability.turnsFaceUp && !ability.usableWhileFaceDown) continue;
      const timing = ability.timing ?? "action";
      if (timing === "action" && actionAbilityRestrictedByModifier(
        state,
        runtime,
        player.seat,
        card,
        ability.isAttack,
      )) continue;
      if (opposingInstantsProhibited(state, player.seat) && (timing === "instant" || abilitiesAsInstantForCard(state, player, card))) continue;
      if (timing === "action" && actionLimitReached(state, player)) continue;
      if (timing === "attack-reaction") {
        if (!attackReactionWindow || !isAttacker || windowKind !== "attack-reaction") continue;
      } else if (timing === "defense-reaction") {
        if (!attackReactionWindow || isAttacker || windowKind !== "defense-reaction") continue;
      } else if (timing !== "instant" && !abilitiesAsInstantForCard(state, player, card)) {
        continue;
      }
      if (!activatedAbilityAvailable(player, card.instanceId, ai, ability)) continue;
      if (ability.tap && card.tapped) continue;
      if (ability.tapHeroCost && player.hero.tapped) continue;
      if (ability.destroySubcardCost && (card.subcards?.length ?? 0) === 0) continue;
      if (
        ability.removeCounterCost &&
        (card.counters?.[ability.removeCounterCost.key] ?? 0) < ability.removeCounterCost.amount
      ) continue;
      if (ability.banishSoulCost && heroSoulCards(player).length < ability.banishSoulCost) continue;
      if (!canPayActivatedEffectCardCosts(state, player, ability)) continue;
      if (ability.canActivate && !ability.canActivate(runtime.makeCtx(state, player.seat, card, link))) {
        continue;
      }
      const resourceCost = abilityResourceCost(state, runtime, player.seat, card, ability, link);
      const pitchRequired = pitchRequirement(player, resourceCost, ability.chiCost);
      const variableBaseCost = ability.variableCost
        ? abilityResourceCost(state, runtime, player.seat, card, { ...ability, cost: ability.variableCost.base }, link)
        : resourceCost;
      const pitchVariants = activatedAbilityPitchOptions(
        state,
        player,
        ability,
        variableBaseCost,
        [],
        includeUnaffordable,
      ).slice(0, 4);
      for (const pitches of ability.variableCost ? pitchVariants.slice(0, 1).map(() => [] as number[]) : pitchVariants) {
        intents.push({
          kind: "activate-ability",
          sourceInstanceId: card.instanceId,
          pitchInstanceIds: pitches,
          pitchRequired: ability.variableCost ? undefined : pitchRequired,
          ...(ai > 0 ? { abilityIndex: ai } : {}),
        });
      }
      for (const alternativeCostCardInstanceIds of activatedEffectCardCostOptions(
        state,
        player,
        ability.alternativeEffectCardCosts ?? [],
      )) {
        const alternativeAbility = { ...ability, cost: 0 };
        const alternativeCost = abilityResourceCost(
          state, runtime,
          player.seat,
          card,
          alternativeAbility,
          link,
        );
        for (const pitches of activatedAbilityPitchOptions(
          state,
          player,
          ability,
          alternativeCost,
          alternativeCostCardInstanceIds,
          includeUnaffordable,
        ).slice(0, 4)) {
          intents.push({
            kind: "activate-ability",
            sourceInstanceId: card.instanceId,
            pitchInstanceIds: pitches,
            pitchRequired: pitchRequirement(player, alternativeCost, ability.chiCost),
            alternativeCostCardInstanceIds,
            ...(ai > 0 ? { abilityIndex: ai } : {}),
          });
        }
      }
    }
  }
  // From-hand activated abilities: the card itself is discarded, while static
  // taxes such as Frostbite may still require pitches from other cards.
  for (const card of player.hand) {
    if (card.faceDown) continue;
    const abilities = effectiveAbilityList(state, player.seat, card);
    for (let ai = 0; ai < abilities.length; ai++) {
      const ability = abilities[ai]!;
      if (!ability.fromHand || ability.isAttack) continue;
      const timing = ability.timing ?? "action";
      const usableNow = timing === "instant"
        ? !opposingInstantsProhibited(state, player.seat)
        : timing === "attack-reaction" &&
          attackReactionWindow &&
          isAttacker &&
          windowKind === "attack-reaction";
      if (!usableNow) continue;
      if (!activatedAbilityAvailable(player, card.instanceId, ai, ability)) continue;
      if (ability.canActivate && !ability.canActivate(runtime.makeCtx(state, player.seat, card, link))) {
        continue;
      }
      if (
        ability.discardCost &&
        discardCostOptions(state, player, ability)
          .filter((candidate) => candidate.instanceId !== card.instanceId).length < ability.discardCost.count
      ) continue;
      if (!canPayActivatedEffectCardCosts(state, player, ability)) continue;
      const resourceCost = abilityResourceCost(state, runtime, player.seat, card, ability, link);
      for (const pitches of pitchOptions(
        state,
        player,
        resourceCost,
        [card.instanceId],
        0,
        includeUnaffordable,
      ).slice(0, 4)) {
        intents.push({
          kind: "activate-ability",
          sourceInstanceId: card.instanceId,
          pitchInstanceIds: pitches,
          pitchRequired: pitchRequirement(player, resourceCost),
          ...(ai > 0 ? { abilityIndex: ai } : {}),
        });
      }
    }
  }
  return intents;
}

function reactionIntents(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  includeUnaffordable = false,
): GameIntent[] {
  if (
    opposingActionsProhibited(state, player.seat) ||
    defendingHeroCannotRespondBelowPower(state, runtime, player.seat)
  ) return [];
  const link = currentLink(state);
  if (!link) return [];
  const isAttacker = player.seat === link.attacker;
  const instantsProhibited = opposingInstantsProhibited(state, player.seat);
  // an attack targeting a non-hero object can't be answered with defense
  // reactions (CR 8.2.8d / 8.3.14a) — instants are still fine
  const wanted: CardData["cardType"][] = isAttacker
    ? ["attack-reaction", "instant"]
    : link.targetAllyId !== undefined
      ? ["instant"]
      : ["defense-reaction", "instant"];
  // Dominate (8.3.4b): no defense reactions from hand once defended from hand
  const blockHandDefReacts =
    !isAttacker && attackHasDominate(state, link) && link.flags.defendedFromHand === true;
  // "defense reactions can't be played (from arsenal) this chain link"
  const drRestriction = defenseReactionRestriction(state, link);
  const zones: { arr: CardInstance[]; fromArsenal: boolean; fromZone?: PlayableZone }[] = [
    { arr: player.hand, fromArsenal: false },
    { arr: cardsPlayableFromArsenal(state, player.seat), fromArsenal: true },
    // cards an effect made playable from the banished zone (a trap banished
    // face-down with "you may play it" — the permission beats the face-down lock)
    { arr: cardsPlayableFromZone(state, runtime, player.seat, "banish"), fromArsenal: false, fromZone: "banish" },
    { arr: cardsPlayableFromZone(state, runtime, player.seat, "graveyard"), fromArsenal: false, fromZone: "graveyard" },
    { arr: cardsPlayableFromZone(state, runtime, player.seat, "deck"), fromArsenal: false, fromZone: "deck" },
  ];
  const intents: GameIntent[] = [];
  // "while defending" abilities (e.g. Rally the Rearguard)
  if (!isAttacker) {
    for (const c of link.defendingCards) {
      if (c.owner !== player.seat) continue;
      const ability = scriptOf(state, c.cardId, c)?.defenseAbility;
      if (!ability) continue;
      if (ability.oncePerTurn && player.flags[`defAbility:${c.instanceId}`]) continue;
      if (ability.discard === 1) {
        for (const h of player.hand) {
          intents.push({
            kind: "activate-ability",
            sourceInstanceId: c.instanceId,
            pitchInstanceIds: [h.instanceId],
          });
        }
      }
    }
  }
  for (const { arr, fromArsenal, fromZone } of zones) {
    for (const card of arr) {
      const data = instanceDataOf(state, card);
      const script = scriptOf(state, card.cardId, card);
      const asInstant = canPlayAsInstant(state, runtime, player.seat, card, link, fromZone ?? (fromArsenal ? "arsenal" : "hand"));
      if (instantsProhibited && (data.cardType === "instant" || asInstant)) continue;
      // Arsenal is a private zone, but its owner may play cards from it (CR
      // 3.3.4 / 5.1.1a). Face-down cards in other zones remain inert unless an
      // explicit permission makes them playable (such as a banished trap).
      if (card.faceDown && fromZone !== "banish" && !fromArsenal) continue;
      if (isFrozen(state, card)) continue;
      if (cardPlayRestrictedByModifier(state, player.seat, card)) continue;
      if (!wanted.includes(data.cardType)) {
        // an action playable "as though it were an instant" counts as an instant here
        if (!asInstant) continue;
      }
      if (blockHandDefReacts && !fromArsenal && data.cardType === "defense-reaction") continue;
      // "defense reactions can't be played to this chain link" / "...from arsenal"
      if (!isAttacker && data.cardType === "defense-reaction") {
        if (
          drRestriction.all ||
          (fromArsenal && drRestriction.fromArsenal) ||
          (!fromArsenal && drRestriction.fromHand)
        ) continue;
      }
      if (
        script?.canPlay &&
        !script.canPlay(runtime.makeCtx(state, player.seat, card, link, fromArsenal))
      ) continue;
      // scripted defend legality ("only defend an attack with 3 or less base
      // {p}") also gates playing a defense reaction onto the link
      if (!isAttacker && data.cardType === "defense-reaction") {
        const canDefend = script?.canDefend;
        if (canDefend && !canDefend(runtime.makeCtx(state, player.seat, card, link))) continue;
        if (!attackAllowsDefender(state, runtime, link, card, !fromArsenal && !fromZone)) continue;
      }
      const meldSides: Array<MeldSide | undefined> = script?.meld
        ? (["left", "right", "both"] as MeldSide[]).filter(
            (side) => !meldSideHasType(state, card, side, "action"),
          )
        : [undefined];
      const alternativeCosts = alternativePlayCostOptions(state, player, card);
      const cardTargets: Array<number | undefined> = script?.playTargetOptions
        ? playTargetOptions(state, runtime, player.seat, card, link, fromArsenal)
        : [undefined];
      const markInstantMethod = (candidates: GameIntent[]): GameIntent[] =>
        markInstantPlayMethod(candidates, data.cardType === "action" && asInstant);
      for (const meldSide of meldSides) {
        for (const targetCardInstanceId of cardTargets) {
          const regularIntents = markInstantMethod(playIntentsWithPitches(
            state,
            player,
            card,
            fromZone ?? (fromArsenal ? "arsenal" : "hand"),
            4,
            cardPlayCost(state, runtime, player.seat, card, link, {
              ...(script?.variablePlayCost
                ? { baseCostOverride: script.variablePlayCost.base +
                    (script.variablePlayCost.minimum ?? 0) * (script.variablePlayCost.resourcesPerX ?? 1) }
                : {}),
              meldSide,
              targetCardInstanceId,
            }),
            meldSide,
            undefined,
            undefined,
            undefined,
            targetCardInstanceId,
            includeUnaffordable,
          ));
          if (script?.variablePlayCost) {
            const first = regularIntents[0];
            if (first && (
              first.kind === "play-card" ||
              first.kind === "play-from-arsenal" ||
              first.kind === "play-from-zone"
            )) intents.push({ ...first, pitchInstanceIds: [], pitchRequired: undefined });
          } else {
            intents.push(...regularIntents);
          }
          for (const alternativeCostCardInstanceIds of alternativeCosts) {
            intents.push(...markInstantMethod(playIntentsWithPitches(
              state,
              player,
              card,
              fromZone ?? (fromArsenal ? "arsenal" : "hand"),
              4,
              cardPlayCost(state, runtime, player.seat, card, link, {
                meldSide,
                alternativeCost: true,
                targetCardInstanceId,
              }),
              meldSide,
              undefined,
              undefined,
              alternativeCostCardInstanceIds,
              targetCardInstanceId,
              includeUnaffordable,
            )));
          }
        }
      }
    }
  }
  // "Attack Reaction" / "Instant" abilities of permanents (Breaking Scales,
  // Energy Potion, ...) and of the attacking card, usable in this window
  intents.push(...windowAbilityIntents(state, runtime, player, true, includeUnaffordable));
  return intents;
}

function defendIntents(state: GameStateInternal,
  runtime: EngineRuntime, seat: number): GameIntent[] {
  const link = currentLink(state);
  if (!link) return [];
  const { hand, arsenal, equipment } = legalDefenderCards(state, runtime, seat);
  const nonEquipment = [...hand, ...arsenal];
  const dominate = attackHasDominate(state, link);
  const overpower = attackHasOverpower(state, link);
  const maxNonBlock = attackMaxNonBlockDefenders(state, link);
  const nonBlockCount = (ids: number[]) =>
    ids.filter((id) => {
      const c = [...nonEquipment, ...equipment].find((x) => x.instanceId === id);
      return c && dataOf(state, c.cardId).cardType !== "block";
    }).length;
  // Overpower (8.3.22): at most one ACTION card may defend (reactions, block
  // cards and equipment are unaffected)
  const actionDefenderCount = (ids: number[]) =>
    ids.filter((id) => {
      const c = nonEquipment.find((x) => x.instanceId === id);
      return c && dataOf(state, c.cardId).cardType === "action";
    }).length;
  const handDefenderCount = (ids: number[]) =>
    ids.filter((id) => hand.some((card) => card.instanceId === id)).length;
  // Defense selection is declarative: the client stages an exact set and the
  // engine validates that incoming set in stageDefenders/assignDefenders.
  // Advertising every hand × equipment subset is both redundant and
  // exponential (an off-hand shield creates a fifth equipment candidate).
  // Only advertise confirmation for the exact staged set; with no selection,
  // this is the ordinary "no block" intent.
  const stagedIds = state.pendingDecision?.kind === "defend"
    ? (state.pendingDecision.staged ?? [])
    : [];
  const stagedNonEquipment = stagedIds.filter((id) => nonEquipment.some((card) => card.instanceId === id));
  const stagedEquipment = stagedIds.filter((id) => equipment.some((card) => card.instanceId === id));
  if (new Set(stagedIds).size !== stagedIds.length) return [];
  if (stagedNonEquipment.length + stagedEquipment.length !== stagedIds.length) return [];
  const requiredEquip = link.flags.mustDefendWithEquipment === true && equipment.length > 0;
  const requiredEquipCount = Math.min(
    equipment.length,
    Number(link.flags.mustDefendWithEquipmentCount ?? (requiredEquip ? 1 : 0)),
  );
  if (stagedEquipment.length < requiredEquipCount) return [];
  if (dominate && handDefenderCount(stagedNonEquipment) > 1) return [];
  if (overpower && actionDefenderCount(stagedNonEquipment) > 1) return [];
  if (maxNonBlock !== undefined && nonBlockCount(stagedIds) > maxNonBlock) return [];

  // Optional "when this defends, you may pay" costs are paid only when that
  // triggered layer resolves. requestPayment/requestXPayment enumerate any
  // required pitch then, after opponents have had the chance to respond.
  return [{ kind: "defend", instanceIds: [...stagedIds] }];
}

function abilityIntents(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  includeUnaffordable = false,
): GameIntent[] {
  const intents: GameIntent[] = [];
  const sources = [
    ...controlledPermanents(state, player.seat),
    ...player.banish.filter((card) =>
      abilityList(scriptOf(state, card.cardId, card)).some((ability) => ability.fromBanish === true)
    ),
  ];
  for (const card of sources) {
    if (activatedAbilitiesSuppressed(state, card)) continue;
    if (isFrozen(state, card)) continue;
    const script = scriptOf(state, card.cardId, card);
    const abilities = abilityList(script);
    for (let ai = 0; ai < abilities.length; ai++) {
      const ability = abilities[ai]!;
      if (ability.isAttack && player.flags[`cannotAttackInstance:${card.instanceId}`] === true) continue;
      if (ability.isAttack && cardHasType(state, card, "weapon") && weaponAttacksProhibited(player)) continue;
      const fromBanish = player.banish.some((candidate) => candidate.instanceId === card.instanceId);
      if ((ability.fromBanish === true) !== fromBanish || ability.fromGraveyard) continue;
      // Cloaked: while face-down, only abilities that turn the card face up
      // as part of their cost function (CR 8.3.36)
      if (card.faceDown && !ability.turnsFaceUp && !ability.usableWhileFaceDown) continue;
      const timing = ability.timing ?? "action";
      if (timing === "action" && actionAbilityRestrictedByModifier(
        state,
        runtime,
        player.seat,
        card,
        ability.isAttack,
      )) continue;
      if (timing === "action" && actionLimitReached(state, player)) continue;
      if (timing === "attack-reaction" || timing === "defense-reaction") continue;
      if (!activatedAbilityAvailable(player, card.instanceId, ai, ability)) continue;
      if (ability.tap && card.tapped) continue;
      if (ability.tapHeroCost && player.hero.tapped) continue;
      if (ability.destroySubcardCost && (card.subcards?.length ?? 0) === 0) continue;
      if (
        ability.removeCounterCost &&
        (card.counters?.[ability.removeCounterCost.key] ?? 0) < ability.removeCounterCost.amount
      ) continue;
      if (timing === "action" && player.actionPoints < 1) continue; // instants are free of AP
      if (ability.banishSoulCost && heroSoulCards(player).length < ability.banishSoulCost) continue;
      if (!canPayActivatedEffectCardCosts(state, player, ability)) continue;
      if (ability.canActivate && !ability.canActivate(runtime.makeCtx(state, player.seat, card))) continue;
      // mirror activateAbility's effective cost so the offered pitches match
      // what applyIntent will accept (modifyAttackActivationCost / modifyCost
      // discounts)
      const targets = ability.isAttack ? attackTargets(state, runtime, player) : [undefined];
      for (const targetAllyId of targets) {
        const resourceCost = ability.isAttack
          ? attackActivationCost(state, runtime, player, card, ability.variableCost?.base ?? ability.cost, targetAllyId)
          : abilityResourceCost(state, runtime, player.seat, card, ability.variableCost
              ? { ...ability, cost: ability.variableCost.base }
              : ability);
        const variants = activatedAbilityPitchOptions(
          state,
          player,
          ability,
          resourceCost,
          [],
          includeUnaffordable,
        )
          .slice(0, 4)
          .map(
            (pitches) =>
              ({
                kind: "activate-ability",
                sourceInstanceId: card.instanceId,
                pitchInstanceIds: ability.variableCost ? [] : pitches,
                pitchRequired: ability.variableCost ? undefined : pitchRequirement(player, resourceCost, ability.chiCost),
                ...(ai > 0 ? { abilityIndex: ai } : {}),
                ...(targetAllyId !== undefined ? { targetAllyId } : {}),
              }) as GameIntent,
          );
        intents.push(...(ability.variableCost ? variants.slice(0, 1) : variants));
        for (const alternativeCostCardInstanceIds of activatedEffectCardCostOptions(
          state,
          player,
          ability.alternativeEffectCardCosts ?? [],
        )) {
          const alternativeCost = ability.isAttack
            ? attackActivationCost(state, runtime, player, card, 0, targetAllyId)
            : abilityResourceCost(state, runtime, player.seat, card, { ...ability, cost: 0 });
          for (const pitches of activatedAbilityPitchOptions(
            state,
            player,
            ability,
            alternativeCost,
            alternativeCostCardInstanceIds,
            includeUnaffordable,
          ).slice(0, 4)) {
            intents.push({
              kind: "activate-ability",
              sourceInstanceId: card.instanceId,
              pitchInstanceIds: pitches,
              pitchRequired: pitchRequirement(player, alternativeCost, ability.chiCost),
              alternativeCostCardInstanceIds,
              ...(ai > 0 ? { abilityIndex: ai } : {}),
              ...(targetAllyId !== undefined ? { targetAllyId } : {}),
            });
          }
        }
      }
    }
  }
  // From-hand instant abilities discard their own source; Frostbite-like
  // static taxes can still make them require another card to pitch.
  for (const card of player.hand) {
    if (card.faceDown) continue;
    const abilities = effectiveAbilityList(state, player.seat, card);
    for (let ai = 0; ai < abilities.length; ai++) {
      const ability = abilities[ai]!;
      if (!ability.fromHand || ability.isAttack || (ability.timing ?? "action") !== "instant") {
        continue;
      }
      if (!activatedAbilityAvailable(player, card.instanceId, ai, ability)) continue;
      if (ability.canActivate && !ability.canActivate(runtime.makeCtx(state, player.seat, card))) continue;
      if (
        ability.discardCost &&
        discardCostOptions(state, player, ability)
          .filter((candidate) => candidate.instanceId !== card.instanceId).length < ability.discardCost.count
      ) continue;
      if (!canPayActivatedEffectCardCosts(state, player, ability)) continue;
      const resourceCost = abilityResourceCost(state, runtime, player.seat, card, ability);
      for (const pitches of pitchOptions(
        state,
        player,
        resourceCost,
        [card.instanceId],
        0,
        includeUnaffordable,
      ).slice(0, 4)) {
        intents.push({
          kind: "activate-ability",
          sourceInstanceId: card.instanceId,
          pitchInstanceIds: pitches,
          pitchRequired: pitchRequirement(player, resourceCost),
          ...(ai > 0 ? { abilityIndex: ai } : {}),
        });
      }
    }
  }
  // granted aura attacks (Cosmo): ready board cards with a Ward keyword attack
  // as weapons, once per turn each, for 1 AP + the marker's {r} cost
  if (player.actionPoints >= 1 && !actionLimitReached(state, player)) {
    for (const card of player.board) {
      if (weaponAttacksProhibited(player)) continue;
      if (!isAuraAttacker(state, player, card)) continue;
      if (actionAbilityRestrictedByModifier(state, runtime, player.seat, card, true)) continue;
      const marker = grantsAuraAttackMarker(state, player, card)!;
      const abilityIndex = abilityList(scriptOf(state, card.cardId, card)).length;
      for (const targetAllyId of attackTargets(state, runtime, player)) {
        const cost = attackActivationCost(state, runtime, player, card, marker.cost, targetAllyId);
        const variants = pitchOptions(state, player, cost, [], 0, includeUnaffordable)
          .slice(0, 4)
          .map(
            (pitches) =>
              ({
                kind: "activate-ability",
                sourceInstanceId: card.instanceId,
                pitchInstanceIds: pitches,
                pitchRequired: pitchRequirement(player, cost),
                ...(abilityIndex > 0 ? { abilityIndex } : {}),
                ...(targetAllyId !== undefined ? { targetAllyId } : {}),
              }) as GameIntent,
          );
        intents.push(...variants);
      }
    }
  }
  return intents;
}

/** Shared structural enumeration. Candidate mode retains plays and abilities
 * whose only missing requirement is a complete ordinary pitch sequence. */
function enumerateIntents(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  includeUnaffordable: boolean,
): GameIntent[] {
  if (state.winner !== null) return [{ kind: "concede" }];
  const pd = state.pendingDecision;
  const intents: GameIntent[] = [{ kind: "concede" }];

  if (pd) {
    if (pd.player !== seat) return intents;
    if (runechantSkipStep(state, seat) !== null) intents.unshift({ kind: "skip-runechant" });
    switch (pd.kind) {
      case "defend": {
        const { hand, arsenal, equipment } = legalDefenderCards(state, runtime, seat);
        return [
          ...defendIntents(state, runtime, seat),
          // staging (uncommitted defender selection) is declarative: one
          // single-card intent per stageable card advertises the candidates
          ...[...hand, ...arsenal, ...equipment].map(
            (c): GameIntent => ({ kind: "stage-defenders", instanceIds: [c.instanceId] }),
          ),
          ...intents,
        ];
      }
      case "arsenal":
        return [
          ...(pd.options ?? []).map((o) => ({ kind: "choose", optionId: o }) as GameIntent),
          { kind: "pass" },
          ...intents,
        ];
      case "choose-target":
        return [
          ...(pd.options ?? []).map((o) => ({ kind: "choose", optionId: o }) as GameIntent),
          ...intents,
        ];
      case "order-triggers":
        return [
          { kind: "order-triggers", optionIds: [...(pd.options ?? [])] },
          ...intents,
        ];
      case "choose-name":
        // The client submits a validated free-form registered card name.
        return intents;
      case "optional-effect":
        return [
          ...(pd.options ?? []).map((o) => ({ kind: "choose", optionId: o }) as GameIntent),
          { kind: "pass" },
          ...intents,
        ];
      case "attack-reaction":
      case "defense-reaction": {
        const player = state.players[seat] as PlayerState;
        return filterOwnedCardActions(state, seat, [
          ...reactionIntents(state, runtime, player, includeUnaffordable),
          { kind: "pass" },
          ...intents,
        ]);
      }
      case "priority-window": {
        const intentsOut: GameIntent[] = [];
        const player = state.players[seat] as PlayerState;
        for (const { card, fromArsenal, fromZone } of windowInstantPlays(
          state, runtime,
          seat,
          includeUnaffordable,
        )) {
          const script = scriptOf(state, card.cardId, card);
          const markInstantMethod = (candidates: GameIntent[]): GameIntent[] =>
            markInstantPlayMethod(
              candidates,
              instanceDataOf(state, card).cardType === "action",
            );
          const meldSides: Array<MeldSide | undefined> = script?.meld
            ? (["left", "right", "both"] as MeldSide[]).filter(
                (side) => !meldSideHasType(state, card, side, "action"),
              )
            : [undefined];
          const alternativeCosts = alternativePlayCostOptions(state, player, card);
          const cardTargets: Array<number | undefined> = script?.playTargetOptions
            ? playTargetOptions(state, runtime, seat, card, currentLink(state), fromArsenal)
            : [undefined];
          for (const meldSide of meldSides) {
            for (const targetCardInstanceId of cardTargets) {
              const regularIntents = markInstantMethod(playIntentsWithPitches(
                state,
                player,
                card,
                fromZone ?? (fromArsenal ? "arsenal" : "hand"),
                4,
                cardPlayCost(state, runtime, seat, card, currentLink(state), {
                  ...(script?.variablePlayCost
                    ? { baseCostOverride: script.variablePlayCost.base +
                        (script.variablePlayCost.minimum ?? 0) * (script.variablePlayCost.resourcesPerX ?? 1) }
                    : {}),
                  meldSide,
                  targetCardInstanceId,
                  perCardReduction: cardPlayReductionForSeat(card, seat),
                }),
                meldSide,
                undefined,
                undefined,
                undefined,
                targetCardInstanceId,
                includeUnaffordable,
              ));
              if (script?.variablePlayCost) {
                const first = regularIntents[0];
                if (first && (
                  first.kind === "play-card" ||
                  first.kind === "play-from-arsenal" ||
                  first.kind === "play-from-zone"
                )) intentsOut.push({ ...first, pitchInstanceIds: [], pitchRequired: undefined });
              } else {
                intentsOut.push(...regularIntents);
              }
              for (const alternativeCostCardInstanceIds of alternativeCosts) {
                intentsOut.push(...markInstantMethod(playIntentsWithPitches(
                  state,
                  player,
                  card,
                  fromZone ?? (fromArsenal ? "arsenal" : "hand"),
                  4,
                  cardPlayCost(state, runtime, seat, card, currentLink(state), {
                    meldSide,
                    alternativeCost: true,
                    targetCardInstanceId,
                    perCardReduction: cardPlayReductionForSeat(card, seat),
                  }),
                  meldSide,
                  undefined,
                  undefined,
                  alternativeCostCardInstanceIds,
                  targetCardInstanceId,
                  includeUnaffordable,
                )));
              }
            }
          }
        }
        if (!opposingActionsProhibited(state, seat)) {
          intentsOut.push(...windowAbilityIntents(state, runtime, player, false, includeUnaffordable));
        }
        return filterOwnedCardActions(state, seat, [
          ...intentsOut,
          { kind: "pass" },
          ...intents,
        ]);
      }
    }
  }

  if (state.phase === "action" && seat === state.priorityPlayer && seat === state.activePlayer) {
    const player = state.players[seat] as PlayerState;
    for (const card of player.hand) {
      intents.push(...playIntentsForCard(state, runtime, player, card, "hand", includeUnaffordable));
    }
    for (const card of cardsPlayableFromArsenal(state, player.seat)) {
      intents.push(...playIntentsForCard(state, runtime, player, card, "arsenal", includeUnaffordable));
    }
    // cards an effect made playable from another zone this turn (Katsu's
    // search banishes face up with "you may play it this turn", ...)
    for (const zone of ["banish", "graveyard"] as const) {
      for (const card of cardsPlayableFromZone(state, runtime, player.seat, zone)) {
        intents.push(...playIntentsForCard(state, runtime, player, card, zone, includeUnaffordable));
      }
    }
    for (const top of cardsPlayableFromZone(state, runtime, player.seat, "deck")) {
      intents.push(...playIntentsForCard(state, runtime, player, top, "deck", includeUnaffordable));
    }
    intents.push(...abilityIntents(state, runtime, player, includeUnaffordable));
    if (!currentLink(state)) intents.push({ kind: "pass" });
    // the chain is still open (links present, last resolved, no new attack
    // declared): the active player may close it manually
    if (!currentLink(state) && state.chain.length > 0) {
      intents.push({ kind: "close-chain" });
    }
  }
  return filterOwnedCardActions(state, seat, intents);
}

/** Enumerate legal intents for execution. applyIntent is the authoritative
 * validator and also accepts valid pitch/defend combinations not enumerated
 * here. Every returned intent applies unchanged. */
export function legalIntents(state: GameStateInternal,
  runtime: EngineRuntime, seat: number): GameIntent[] {
  return enumerateIntents(state, runtime, seat, false);
}

type PaidIntent = Extract<
  GameIntent,
  { kind: "play-card" | "play-from-arsenal" | "play-from-zone" | "activate-ability" }
>;

function isPaidIntent(intent: GameIntent): intent is PaidIntent {
  return intent.kind === "play-card" || intent.kind === "play-from-arsenal" ||
    intent.kind === "play-from-zone" || intent.kind === "activate-ability";
}

/** Structurally available plays and activations for UI discovery. These are
 * intentionally separate from legalIntents: an action can be presented when
 * ordinary resources are unaffordable, but a chi cost must be payable from
 * floating chi and eligible chi cards in hand. */
export function actionCandidates(state: GameStateInternal,
  runtime: EngineRuntime, seat: number): GameIntent[] {
  const candidates = new Map<string, PaidIntent>();
  for (const intent of enumerateIntents(state, runtime, seat, true)) {
    if (!isPaidIntent(intent)) continue;
    const candidate: PaidIntent = { ...intent, pitchInstanceIds: [] };
    const key = JSON.stringify(candidate);
    if (!candidates.has(key)) candidates.set(key, candidate);
  }
  return [...candidates.values()];
}
