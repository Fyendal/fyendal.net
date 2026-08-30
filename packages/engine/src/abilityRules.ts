import type { EngineRuntime } from "./runtimePorts.js";
import { cardColorOf, cardHasName, cardHasType, cardTypesOf, dataOf, scriptOf } from "./cardProperties.js";
import { payCost } from "./costs.js";
import { controlledPermanents } from "./sourceQueries.js";

import { logPublic, nameOf } from "./gameLog.js";
import type { GameStateInternal } from "./runtimeState.js";

import { abilityList, activatedFlagKey } from "./scripts.js";
import type { ActivatedAbility, ActivatedEffectCardCost, ScriptCtx } from "./scripts.js";
import type { CardInstance, ChainLinkState, PlayerState } from "./state.js";
import { banishHeroSoulCard, destroyPermanent, putCardOnDeckBottom } from "./zoneMoves.js";
import { currentLink, findCardAnywhere, heroSoulCards } from "./zoneQueries.js";
import { tapPermanent } from "./cardLifecycle.js";
import { MAX_ALTERNATIVE_COST_OPTIONS, consumeMatchingActivationCostReductions, costModifierScopeApplies, exactCardCombinations, modifierMatchesPlayedCard, opposingStaticCostIncrease, payDiscardCost, validateDiscardCost } from "./playRules.js";

/** Printed abilities plus temporary abilities granted to this owned card.
 * The returned functions are process definitions only; they are never stored
 * in serializable game state. */
export function effectiveAbilityList(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
): ActivatedAbility[] {
  const printed = abilityList(scriptOf(state, card.cardId, card));
  const prevention = Number(
    (state.players[seat] as PlayerState | undefined)?.flags.ownedInstantDiscardPrevention ?? 0,
  );
  if (
    prevention <= 0 ||
    card.owner !== seat ||
    !cardHasType(state, card, "instant")
  ) return printed;
  return [
    ...printed,
    {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      label: `Discard: prevent the next ${prevention} damage`,
      onActivate(ctx) {
        ctx.preventNextDamage(ctx.seat, prevention);
      },
    },
  ];
}

/** Generic reduction for activating a matching card. Effects such as Ignite
 * share one modifier between play and activation costs, so whichever event
 * happens first consumes the same one-shot rules object. */
export function activationCostReductionForCard(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
): number {
  return state.modifiers.reduce((total, modifier) => {
    if (
      modifier.seat !== seat ||
      modifier.consumed ||
      !costModifierScopeApplies(modifier) ||
      !modifier.activationCostReduction ||
      !modifierMatchesPlayedCard(state, modifier, card)
    ) return total;
    return total + modifier.activationCostReduction;
  }, 0);
}

/** Hand cards that may be discarded for an ability's discardCost. */
export function discardCostOptions(
  state: GameStateInternal,
  player: PlayerState,
  ability: { discardCost?: { count: number; classes?: string[]; cardTypes?: string[]; types?: string[] } },
): CardInstance[] {
  const dc = ability.discardCost;
  if (!dc) return [];
  return player.hand.filter((c) => {
    const data = dataOf(state, c.cardId);
    if (dc.classes && !(data.classes ?? []).some((cl) => dc.classes!.includes(cl.toLowerCase()))) {
      return false;
    }
    if (dc.cardTypes && !dc.cardTypes.includes(data.cardType.toLowerCase())) return false;
    if (dc.types && !cardTypesOf(state, c).some((type) => dc.types!.includes(type))) return false;
    return true;
  });
}

/** Open the private hand-card choices required to declare an activated
 * ability's discard effect-cost. Resource pitches and other announced card
 * costs are unavailable for this payment. */
export function prepareActivatedDiscardCost(
  state: GameStateInternal,
  mode: "action" | "window",
  seat: number,
  card: CardInstance,
  ability: ActivatedAbility,
  abilityIndex: number,
  pitchInstanceIds: number[],
  targetAllyId: number | undefined,
  selectedIds: number[],
  effectCostInstanceIds: number[],
  alternativeCostCardInstanceIds?: number[],
  declaredVariableX?: number,
): string | "pending" | undefined {
  const cost = ability.discardCost;
  if (!cost) return undefined;
  const player = state.players[seat] as PlayerState;
  const selectionErr = validateDiscardCost(state, player, {
    discardCost: { ...cost, count: selectedIds.length },
  }, selectedIds);
  if (selectionErr) return selectionErr;
  if (selectedIds.length === cost.count) {
    return validateDiscardCost(state, player, ability, selectedIds);
  }
  if (selectedIds.length > cost.count) return `must discard exactly ${cost.count} card(s)`;
  const unavailable = new Set([
    card.instanceId,
    ...pitchInstanceIds,
    ...selectedIds,
    ...effectCostInstanceIds,
    ...(alternativeCostCardInstanceIds ?? []),
  ]);
  if (selectedIds.includes(card.instanceId)) return "the source cannot pay its additional discard cost";
  const options = discardCostOptions(state, player, ability)
    .filter((candidate) => !unavailable.has(candidate.instanceId));
  if (options.length < cost.count - selectedIds.length) return "cannot pay discard cost";
  state.pendingDecision = {
    player: seat,
    kind: "choose-target",
    prompt: `Choose a card to discard for ${nameOf(state, card.cardId)}`,
    options: options.map((candidate) => String(candidate.instanceId)),
    cardOptions: options.map((candidate) => candidate.instanceId),
    sourceInstanceId: card.instanceId,
    chooseHook: "engine-activation-discard",
    activationCost: {
      mode,
      seat,
      sourceInstanceId: card.instanceId,
      abilityIndex,
      pitchInstanceIds,
      ...(targetAllyId !== undefined ? { targetAllyId } : {}),
      discardInstanceIds: selectedIds,
      ...(effectCostInstanceIds.length ? { effectCostInstanceIds } : {}),
      ...(alternativeCostCardInstanceIds !== undefined
        ? { alternativeCostCardInstanceIds }
        : {}),
      ...(declaredVariableX === undefined ? {} : { declaredVariableX }),
    },
  };
  return "pending";
}

/** The resource cost of an activated ability after its script's dynamic
 *  adjustment ("this ability costs {r} less for each …" — modifyCost).
 *  Consulted in enumeration AND validation; the hook must be pure. */
export function abilityResourceCost(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  ability: { cost: number; modifyCost?: (ctx: ScriptCtx, baseCost: number) => number },
  link?: ChainLinkState,
): number {
  let cost = ability.modifyCost
    ? ability.modifyCost(runtime.makeCtx(state, seat, card, link), ability.cost)
    : ability.cost;
  for (const source of controlledPermanents(state, seat, { faceDownEquipment: false })) {
    const replacement = scriptOf(state, source.cardId, source)?.modifyActivatedAbilityCost?.(
      runtime.makeCtx(state, seat, source, link),
      card,
      cost,
    );
    if (replacement !== undefined) cost = Math.max(0, replacement);
  }
  cost -= activationCostReductionForCard(state, seat, card);
  const staticIncrease = controlledPermanents(state, seat, { faceDownEquipment: false })
    .reduce((sum, source) => sum + Number(scriptOf(state, source.cardId, source)?.additionalCostToController || 0), 0);
  const turnIncrease = Number((state.players[seat] as PlayerState).flags.costMoreThisTurn || 0);
  const nextReduction = Number((state.players[seat] as PlayerState).flags.nextAbilityCostReduction || 0);
  const staffReduction = cardTypesOf(state, card).includes("staff")
    ? Number((state.players[seat] as PlayerState).flags.nextStaffAbilityCostReduction || 0)
    : 0;
  return Math.max(0, cost - nextReduction - staffReduction) + staticIncrease +
    opposingStaticCostIncrease(state, seat) + turnIncrease;
}

function activationCountKey(instanceId: number, abilityIndex: number): string {
  return `activationCount:${instanceId}:${abilityIndex}`;
}

function attackActivationCountKey(instanceId: number): string {
  return `attackActivationCount:${instanceId}`;
}

export function setAttackActivationLimitKey(instanceId: number): string {
  return `setAttackActivationLimit:${instanceId}`;
}

function activationCount(player: PlayerState, instanceId: number, abilityIndex: number): number {
  const recorded = player.flags[activationCountKey(instanceId, abilityIndex)];
  if (typeof recorded === "number") return Math.max(0, Math.floor(recorded));
  return player.flags[activatedFlagKey(instanceId, abilityIndex)] === true ? 1 : 0;
}

export function activatedAbilityLimit(
  player: PlayerState,
  instanceId: number,
  ability: ActivatedAbility,
): number | undefined {
  const setAttackLimit = ability.isAttack
    ? Number(player.flags[setAttackActivationLimitKey(instanceId)] ?? 0)
    : 0;
  if (setAttackLimit > 0) return Math.floor(setAttackLimit);
  const printed = Number(ability.activationsPerTurn ?? (ability.oncePerTurn === true ? 1 : 0));
  return printed > 0 ? Math.floor(printed) : undefined;
}

function activationsAgainstLimit(
  player: PlayerState,
  instanceId: number,
  abilityIndex: number,
  ability: ActivatedAbility,
): number {
  if (ability.isAttack && Number(player.flags[setAttackActivationLimitKey(instanceId)] ?? 0) > 0) {
    const shared = player.flags[attackActivationCountKey(instanceId)];
    if (typeof shared === "number") return Math.max(0, Math.floor(shared));
  }
  return activationCount(player, instanceId, abilityIndex);
}

export function activatedAbilityAvailable(
  player: PlayerState,
  instanceId: number,
  abilityIndex: number,
  ability: ActivatedAbility,
): boolean {
  const limit = activatedAbilityLimit(player, instanceId, ability);
  if (limit === undefined) return true;
  const used = activationsAgainstLimit(player, instanceId, abilityIndex, ability);
  const extra = Number(player.flags[`additionalActivations:${instanceId}:${abilityIndex}`] || 0);
  return used < limit || extra > 0;
}

export function abilitiesAsInstantForCard(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
): boolean {
  const data = dataOf(state, card.cardId);
  return [...(data.classes ?? []), ...(data.subtypes ?? [])].some(
    (type) => player.flags[`abilitiesAsInstant:${type.toLowerCase()}`] === true,
  );
}

function effectCardCostCandidates(
  state: GameStateInternal,
  player: PlayerState,
  cost: NonNullable<ActivatedAbility["effectCardCosts"]>[number],
): CardInstance[] {
  const cards = cost.zone === "hand"
    ? player.hand
    : cost.zone === "graveyard" ? player.graveyard
    : cost.zone === "arsenal" ? player.arsenal
    : controlledPermanents(state, player.seat, { faceDownEquipment: false })
        .filter((card) => card.instanceId !== player.hero.instanceId && !card.faceDown);
  return cards.filter((card) => {
    const data = dataOf(state, card.cardId);
    return (cost.move !== "tap" || !card.tapped) &&
      (cost.move !== "turn-face-up" || card.faceDown === true) &&
      (cost.move !== "remove-counter" || (
        !!cost.counter && (card.counters?.[cost.counter.key] ?? 0) >= cost.counter.amount
      )) &&
      (cost.pitch === undefined || cardColorOf(state, card) === cost.pitch) &&
      (cost.class === undefined || (data.classes ?? []).some(
        (cardClass) => cardClass.toLowerCase() === cost.class!.toLowerCase(),
      )) &&
      (cost.subtype === undefined || (data.subtypes ?? []).some(
        (subtype) => subtype.toLowerCase() === cost.subtype!.toLowerCase(),
      )) &&
      (cost.keyword === undefined || (data.keywords ?? []).some(
        (keyword) => keyword.toLowerCase() === cost.keyword!.toLowerCase(),
      )) &&
      (cost.types === undefined || cost.types.every((wanted) =>
        [...(data.classes ?? []), ...(data.subtypes ?? [])]
          .some((type) => type.toLowerCase() === wanted.toLowerCase()),
      )) &&
      (cost.withoutCounter === undefined || (card.counters?.[cost.withoutCounter] ?? 0) === 0) &&
      (cost.name === undefined || cardHasName(state, card, cost.name));
  });
}

/** Exact distinct card sets that can pay an activated effect-card cost. Used
 * for alternative activation payments, whose choices are announced directly
 * in legal intents instead of through a post-activation picker. */
export function activatedEffectCardCostOptions(
  state: GameStateInternal,
  player: PlayerState,
  costs: readonly ActivatedEffectCardCost[],
): number[][] {
  if (costs.length === 0) return [];
  let options: number[][] = [[]];
  for (const cost of costs) {
    const combinations = exactCardCombinations(
      effectCardCostCandidates(state, player, cost),
      cost.count,
    );
    const next: number[][] = [];
    for (const existing of options) {
      const used = new Set(existing);
      for (const combination of combinations) {
        if (combination.some((id) => used.has(id))) continue;
        next.push([...existing, ...combination]);
        if (next.length >= MAX_ALTERNATIVE_COST_OPTIONS) break;
      }
      if (next.length >= MAX_ALTERNATIVE_COST_OPTIONS) break;
    }
    options = next;
    if (options.length === 0) break;
  }
  return options;
}

/** Whether distinct eligible cards exist for every effect-card cost group. */
export function canPayActivatedEffectCardCosts(
  state: GameStateInternal,
  player: PlayerState,
  ability: ActivatedAbility,
): boolean {
  const slots = (ability.effectCardCosts ?? []).flatMap((cost) =>
    Array.from({ length: cost.count }, () => effectCardCostCandidates(state, player, cost)));
  const used = new Set<number>();
  const assign = (index: number): boolean => {
    if (index >= slots.length) return true;
    for (const card of slots[index] ?? []) {
      if (used.has(card.instanceId)) continue;
      used.add(card.instanceId);
      if (assign(index + 1)) return true;
      used.delete(card.instanceId);
    }
    return false;
  };
  return assign(0);
}

function validateEffectCardCostSelections(
  state: GameStateInternal,
  player: PlayerState,
  ability: ActivatedAbility,
  selectedIds: number[],
  complete: boolean,
): string | undefined {
  if (new Set(selectedIds).size !== selectedIds.length) return "effect cost cards must be distinct";
  let offset = 0;
  for (const cost of ability.effectCardCosts ?? []) {
    if (!Number.isSafeInteger(cost.count) || cost.count <= 0) return "invalid effect card cost";
    const group = selectedIds.slice(offset, offset + cost.count);
    const candidates = new Set(
      effectCardCostCandidates(state, player, cost).map((card) => card.instanceId),
    );
    if (group.some((id) => !candidates.has(id))) return "effect cost card not found";
    if (complete && group.length !== cost.count) return "wrong number of effect cost cards";
    offset += cost.count;
  }
  if (selectedIds.length > offset || (complete && selectedIds.length !== offset)) {
    return "wrong number of effect cost cards";
  }
  return undefined;
}

/** Open the next public card-selection decision required to pay an activated
 * ability's effect-cost. Returns "pending" when a decision was opened. */
export function prepareActivatedEffectCardCosts(
  state: GameStateInternal,
  mode: "action" | "window",
  seat: number,
  card: CardInstance,
  ability: ActivatedAbility,
  abilityIndex: number,
  pitchInstanceIds: number[],
  targetAllyId: number | undefined,
  selectedIds: number[],
  discardInstanceIds: number[] = [],
  alternativeCostCardInstanceIds?: number[],
  declaredVariableX?: number,
): string | "pending" | undefined {
  const costs = ability.effectCardCosts;
  if (!costs?.length) return undefined;
  const player = state.players[seat] as PlayerState;
  const selectionErr = validateEffectCardCostSelections(
    state,
    player,
    ability,
    selectedIds,
    false,
  );
  if (selectionErr) return selectionErr;
  let offset = 0;
  for (const cost of costs) {
    const selectedInGroup = Math.min(cost.count, Math.max(0, selectedIds.length - offset));
    if (selectedInGroup < cost.count) {
      const selected = new Set([
        ...selectedIds,
        ...pitchInstanceIds,
        ...discardInstanceIds,
      ]);
      const options = effectCardCostCandidates(state, player, cost)
        .filter((candidate) => !selected.has(candidate.instanceId));
      const remaining = cost.count - selectedInGroup;
      if (options.length < remaining) return "cannot pay effect card cost";
      state.pendingDecision = {
        player: seat,
        kind: "choose-target",
        prompt: cost.prompt,
        options: options.map((candidate) => String(candidate.instanceId)),
        cardOptions: options.map((candidate) => candidate.instanceId),
        sourceInstanceId: card.instanceId,
        chooseHook: ability.effectCardCostChoiceHook ?? "engine-activation-effect-cost",
        activationCost: {
          mode,
          seat,
          sourceInstanceId: card.instanceId,
          abilityIndex,
          pitchInstanceIds,
          ...(targetAllyId !== undefined ? { targetAllyId } : {}),
          ...(discardInstanceIds.length ? { discardInstanceIds } : {}),
          effectCostInstanceIds: selectedIds,
          ...(alternativeCostCardInstanceIds !== undefined
            ? { alternativeCostCardInstanceIds }
            : {}),
          ...(declaredVariableX === undefined ? {} : { declaredVariableX }),
        },
      };
      return "pending";
    }
    offset += cost.count;
  }
  return validateEffectCardCostSelections(state, player, ability, selectedIds, true);
}

/** Validate and pay every part of an activated ability's cost,
 *  then set its once-per-turn flag, tap it, turn it face up if needed, and log.
 *  Returns an error string, or undefined on success. */
export function payActivatedAbilityCost(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  ability: ActivatedAbility,
  abilityIndex: number,
  pitchInstanceIds: number[],
  resourceCost: number,
  opts?: {
    chiCost?: number;
    extraCost?: number;
    soulInstanceIds?: number[];
    effectCostInstanceIds?: number[];
    discardInstanceIds?: number[];
  },
): string | undefined {
  const player = state.players[seat] as PlayerState;
  const flagKey = activatedFlagKey(card.instanceId, abilityIndex);
  const limit = activatedAbilityLimit(player, card.instanceId, ability);
  if (limit !== undefined && !activatedAbilityAvailable(player, card.instanceId, abilityIndex, ability)) {
    return limit === 1
      ? "ability can only be activated once per turn"
      : `ability can only be activated ${limit} times per turn`;
  }
  if (ability.tap && card.tapped) return `${nameOf(state, card.cardId)} is already tapped`;
  if (ability.tapHeroCost && player.hero.tapped) {
    return `${nameOf(state, player.hero.cardId)} is already tapped`;
  }
  if (ability.destroySubcardCost && (card.subcards?.length ?? 0) === 0) {
    return `${nameOf(state, card.cardId)} has no card under it`;
  }
  const counterCost = ability.removeCounterCost;
  if (counterCost && (card.counters?.[counterCost.key] ?? 0) < counterCost.amount) {
    return `${nameOf(state, card.cardId)} does not have enough ${counterCost.key} counters`;
  }
  const discardIds = opts?.discardInstanceIds ?? [];
  if (ability.discardCost) {
    const discardErr = validateDiscardCost(state, player, ability, discardIds);
    if (discardErr) return discardErr;
  } else if (discardIds.length) {
    return "ability has no discard cost";
  }
  const soulIds = [...new Set(opts?.soulInstanceIds ?? [])];
  if (ability.banishSoulCost) {
    if (soulIds.length !== ability.banishSoulCost) return "wrong number of soul cards";
    if (soulIds.some((id) => !heroSoulCards(player).some((card) => card.instanceId === id))) {
      return "soul cost card not found";
    }
  }
  const effectCostIds = opts?.effectCostInstanceIds ?? [];
  if (
    pitchInstanceIds.some((id) => effectCostIds.includes(id) || discardIds.includes(id)) ||
    discardIds.some((id) => effectCostIds.includes(id))
  ) {
    return "a card cannot pay more than one part of an activation cost";
  }
  const effectCostErr = validateEffectCardCostSelections(
    state,
    player,
    ability,
    effectCostIds,
    true,
  );
  if (effectCostErr) return effectCostErr;
  const paidCards = pitchInstanceIds
    .map((id) => player.hand.find((candidate) => candidate.instanceId === id))
    .filter((candidate): candidate is CardInstance => !!candidate);
  for (const id of discardIds) {
    const paid = player.hand.find((candidate) => candidate.instanceId === id);
    if (paid) paidCards.push(paid);
  }
  for (const id of effectCostIds) {
    const paid = findCardAnywhere(state, id)?.card;
    if (paid) paidCards.push(paid);
  }
  const costErr = payCost(state, runtime, player, resourceCost, pitchInstanceIds, undefined, {
    chiCost: opts?.chiCost,
  });
  if (costErr) return costErr;
  consumeMatchingActivationCostReductions(state, seat, card);
  if (Number(player.flags.nextAbilityCostReduction || 0) > 0) {
    player.flags.nextAbilityCostReduction = 0;
  }
  if (cardTypesOf(state, card).includes("staff") && Number(player.flags.nextStaffAbilityCostReduction || 0) > 0) {
    player.flags.nextStaffAbilityCostReduction = 0;
  }
  player.flags.activatedAbilityThisTurn = true;
  if (ability.discardCost) payDiscardCost(state, runtime, player, discardIds);
  for (const id of soulIds) banishHeroSoulCard(state, runtime, player, id);
  let effectOffset = 0;
  for (const cost of ability.effectCardCosts ?? []) {
    for (const id of effectCostIds.slice(effectOffset, effectOffset + cost.count)) {
      if (cost.move === "banish") runtime.makeCtx(state, seat, card).banish(id);
      else if (cost.move === "discard") runtime.makeCtx(state, seat, card).discardCard(seat, id);
      else if (cost.move === "destroy") runtime.makeCtx(state, seat, card).destroyPermanent(id);
      else if (cost.move === "put-on-deck-bottom") putCardOnDeckBottom(state, runtime, id, true);
      else if (cost.move === "tap") runtime.makeCtx(state, seat, card).tap(id);
      else if (cost.move === "turn-face-up") runtime.makeCtx(state, seat, card).turnArsenalFaceUp(id);
      else {
        const target = findCardAnywhere(state, id)?.card;
        const counter = cost.counter;
        if (target && counter) {
          const counters = (target.counters ??= {});
          counters[counter.key] = Math.max(0, (counters[counter.key] ?? 0) - counter.amount);
        }
      }
    }
    effectOffset += cost.count;
  }
  if (counterCost) {
    const counters = (card.counters ??= {});
    const remaining = (counters[counterCost.key] ?? 0) - counterCost.amount;
    if (remaining > 0) counters[counterCost.key] = remaining;
    else delete counters[counterCost.key];
  }
  const extraCost = opts?.extraCost ?? 0;
  if (extraCost > 0) player.flags.nextActionExtraCost = 0;
  const usedAgainstLimit = activationsAgainstLimit(player, card.instanceId, abilityIndex, ability);
  const usedActivations = activationCount(player, card.instanceId, abilityIndex);
  player.flags[activationCountKey(card.instanceId, abilityIndex)] = usedActivations + 1;
  if (ability.isAttack) {
    const attackCountKey = attackActivationCountKey(card.instanceId);
    player.flags[attackCountKey] = Number(player.flags[attackCountKey] || 0) + 1;
  }
  if (limit !== undefined) {
    const extraKey = `additionalActivations:${card.instanceId}:${abilityIndex}`;
    if (usedAgainstLimit >= limit) {
      player.flags[extraKey] = Math.max(0, Number(player.flags[extraKey] || 0) - 1);
    }
    player.flags[flagKey] = true;
  }
  if (ability.tap) card.tapped = true;
  if (ability.tapHeroCost) tapPermanent(state, runtime, player.hero.instanceId, true);
  if (ability.destroySelfCost) destroyPermanent(state, runtime, seat, card);
  else if (ability.banishSelfCost) runtime.makeCtx(state, seat, card).banish(card.instanceId);
  else if (ability.putSelfOnDeckBottomCost) putCardOnDeckBottom(state, runtime, card.instanceId, true);
  else if (ability.returnSelfToHandCost) runtime.makeCtx(state, seat, card).moveToHand(card.instanceId);
  if (ability.destroySubcardCost) runtime.makeCtx(state, seat, card).destroySubcard(card.instanceId);
  if (card.faceDown && ability.turnsFaceUp) {
    card.faceDown = false;
    logPublic(state, `${nameOf(state, player.heroCardId)} turns ${nameOf(state, card.cardId)} face up`);
  }
  logPublic(state, `${nameOf(state, player.heroCardId)} activates ${nameOf(state, card.cardId)}`);
  runtime.events.fireOnFriendlyActivate(state, seat, card, ability.timing ?? "action");
  ability.onCostPaid?.(runtime.makeCtx(state, seat, card, currentLink(state)), paidCards);
  return undefined;
}

/** Whether a temporal restriction prohibits activating this action ability.
 * Weapon identity belongs to the source; attack identity belongs to the
 * ability. Callers invoke this only for action-timing abilities. */
export function actionAbilityRestrictedByModifier(
  state: GameStateInternal,
  seat: number,
  source: CardInstance,
  isAttack: boolean,
): boolean {
  const isWeapon = cardHasType(state, source, "weapon");
  return state.modifiers.some((modifier) =>
    modifier.seat === seat &&
    !modifier.consumed &&
    (
      (modifier.restrictActionsToWeaponOrAttack === true && !isWeapon && !isAttack) ||
      (modifier.restrictActionsToNonWeaponNonAttack === true && (isWeapon || isAttack))
    )
  );
}
