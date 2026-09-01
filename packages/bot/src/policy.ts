import type { CardData, CardView, GameIntent, GameView } from "@fyendal/shared";
import type { GameState } from "@fyendal/engine";
import { requiredEquipmentStageIntent } from "./defense.js";
import {
  evaluateOnHit,
  lifeThresholdRisk,
  valueBreakdown,
  type LifeThreshold,
  type OnHitEvaluation,
  type ValueBreakdown,
} from "./value.js";

export interface BotPolicyInput {
  seat: 0 | 1;
  view: GameView;
  legal: readonly GameIntent[];
  cards: Readonly<Record<string, CardData>>;
  /** Authoritative state is used only by bounded, projection-safe rollout
   * adapters. Ordinary policy scoring must continue to read `view`. */
  state?: GameState;
}

export type DefendIntent = Extract<GameIntent, { kind: "defend" }>;
export type ChooseIntent = Extract<GameIntent, { kind: "choose" }>;

export interface BotPolicyScorers {
  defend(intent: DefendIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number;
  choose(intent: ChooseIntent, input: BotPolicyInput): number;
  play(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number;
  nextTurnArsenal(card: CardView, input: BotPolicyInput): number;
}

const NEXT_TURN_ARSENAL_OPPORTUNITY_WEIGHT = 0.1;
export const MAX_OPTIONAL_DEFENDERS = 10;

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  const wanted = new Set(left);
  return right.every((id) => wanted.has(id));
}

/**
 * Defender selection is a declarative two-step protocol: legal intents expose
 * each card that may be staged, then the client sends the complete selected
 * set and commits that exact set on the following observation. Build the
 * complete set here so bots evaluate real blocks rather than seeing only the
 * initially advertised no-block commit.
 */
function bestDefenderStageIntent(
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
  scorers: BotPolicyScorers,
): Extract<GameIntent, { kind: "stage-defenders" }> | undefined {
  const decision = input.view.pendingDecision;
  if (decision?.kind !== "defend") return undefined;

  const stageableIds = input.legal.flatMap((intent) =>
    intent.kind === "stage-defenders" ? intent.instanceIds : []
  );
  if (stageableIds.length === 0) return undefined;

  // Once staging has begun, retain those cards. This is required for attacks
  // that mandate equipment and also makes selection monotonic across ticks.
  const stagedIds = decision.stagedCards?.map((card) => card.instanceId) ?? [];
  const staged = new Set(stagedIds);
  let optionalIds = [...new Set(stageableIds)].filter((id) => !staged.has(id));
  const me = input.view.players[input.seat];
  const handIds = new Set(me.hand.map((card) => card.instanceId));
  const equipmentIds = new Set(
    Object.values(me.equipment)
      .filter((card): card is CardView => card !== undefined)
      .map((card) => card.instanceId),
  );
  const link = currentLink(input);

  const allowed = (ids: readonly number[]): boolean => {
    if (link?.dominate && ids.filter((id) => handIds.has(id)).length > 1) return false;
    if (link?.overpower) {
      const actionDefenders = ids.filter((id) => {
        if (equipmentIds.has(id)) return false;
        return input.cards[own.get(id)?.cardId ?? ""]?.cardType === "action";
      }).length;
      if (actionDefenders > 1) return false;
    }
    if (link?.maxNonBlockDefenders !== undefined) {
      const nonBlockDefenders = ids.filter((id) =>
        input.cards[own.get(id)?.cardId ?? ""]?.cardType !== "block"
      ).length;
      if (nonBlockDefenders > link.maxNonBlockDefenders) return false;
    }
    return true;
  };

  if (optionalIds.length > MAX_OPTIONAL_DEFENDERS) {
    optionalIds = optionalIds
      .map((id, index) => ({
        id,
        index,
        score: allowed([...stagedIds, id])
          ? scoreIntent({ kind: "defend", instanceIds: [...stagedIds, id] }, input, own, scorers)
          : Number.NEGATIVE_INFINITY,
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, MAX_OPTIONAL_DEFENDERS)
      .map(({ id }) => id);
  }

  let bestIds = [...stagedIds];
  let bestScore = allowed(bestIds)
    ? scoreIntent({ kind: "defend", instanceIds: bestIds }, input, own, scorers)
    : Number.NEGATIVE_INFINITY;
  const combinations = 2 ** optionalIds.length;
  for (let mask = 1; mask < combinations; mask++) {
    const ids = [
      ...stagedIds,
      ...optionalIds.filter((_, index) => (mask & (2 ** index)) !== 0),
    ];
    if (!allowed(ids)) continue;
    const candidateScore = scoreIntent({ kind: "defend", instanceIds: ids }, input, own, scorers);
    if (candidateScore > bestScore) {
      bestIds = ids;
      bestScore = candidateScore;
    }
  }

  return sameIds(bestIds, stagedIds)
    ? undefined
    : { kind: "stage-defenders", instanceIds: bestIds };
}

export function functionalKey(card: CardData | undefined): string {
  return card ? `${card.name.trim().toLowerCase().replace(/\s+/g, " ")}|${card.pitch ?? 0}` : "";
}

export function ownCards(input: BotPolicyInput): Map<number, CardView> {
  const player = input.view.players[input.seat];
  const cards = [
    {
      instanceId: player.heroInstanceId,
      cardId: player.heroCardId,
      owner: player.seat,
      ...(player.heroTapped ? { tapped: true } : {}),
      ...(player.heroCounters ? { counters: player.heroCounters } : {}),
    },
    ...player.hand,
    ...player.arsenal,
    ...player.pitch,
    ...player.graveyard,
    ...player.banish,
    ...player.soul,
    ...Object.values(player.equipment).filter((card): card is CardView => !!card),
    ...player.weapons,
    ...player.board,
  ];
  return new Map(cards.map((card) => [card.instanceId, card]));
}

export function intentCard(
  intent: GameIntent,
  own: ReadonlyMap<number, CardView>,
): CardView | undefined {
  if (
    intent.kind === "play-card" || intent.kind === "play-from-arsenal" ||
    intent.kind === "play-from-zone"
  ) return own.get(intent.instanceId);
  if (intent.kind === "activate-ability") return own.get(intent.sourceInstanceId);
  return undefined;
}

export function pitchIds(intent: GameIntent): readonly number[] {
  if (
    intent.kind === "play-card" || intent.kind === "play-from-arsenal" ||
    intent.kind === "play-from-zone" || intent.kind === "activate-ability"
  ) return intent.pitchInstanceIds;
  return intent.kind === "defend" ? (intent.pitchInstanceIds ?? []) : [];
}

export function pitchValue(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView> = ownCards(input),
): number {
  return pitchIds(intent).reduce((total, id) => {
    const card = own.get(id);
    return total + Number(input.cards[card?.cardId ?? ""]?.pitch ?? 0);
  }, 0);
}

export function resourcesAfterCost(
  intent: GameIntent,
  cost: number,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView> = ownCards(input),
): number {
  return Math.max(0, input.view.players[input.seat].resources + pitchValue(intent, input, own) - cost);
}

export function remainingPitchValue(
  input: BotPolicyInput,
  excluded: ReadonlySet<number>,
): number {
  return input.view.players[input.seat].hand.reduce((total, card) =>
    excluded.has(card.instanceId)
      ? total
      : total + Number(input.cards[card.cardId]?.pitch ?? 0),
  0);
}

export function continuationResources(
  intent: GameIntent,
  currentCost: number,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
  additionallyReservedIds: readonly number[] = [],
): number {
  const excluded = new Set([...pitchIds(intent), ...additionallyReservedIds]);
  return resourcesAfterCost(intent, currentCost, input, own) + remainingPitchValue(input, excluded);
}

export function resourcePaymentPitchIds(
  intent: ChooseIntent,
  input: BotPolicyInput,
): readonly number[] | undefined {
  return input.view.pendingDecision?.resourcePayment?.options.find(
    (option) => option.optionId === intent.optionId,
  )?.pitchInstanceIds;
}

function spentCardIds(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): Set<number> {
  const spent = new Set<number>();
  if (intent.kind === "defend") {
    for (const id of intent.instanceIds) spent.add(id);
    for (const id of intent.pitchInstanceIds ?? []) spent.add(id);
    return spent;
  }
  if (intent.kind === "choose") {
    for (const id of resourcePaymentPitchIds(intent, input) ?? []) spent.add(id);
    return spent;
  }
  if (
    intent.kind !== "play-card" && intent.kind !== "play-from-arsenal" &&
    intent.kind !== "play-from-zone" && intent.kind !== "activate-ability"
  ) return spent;

  for (const id of intent.pitchInstanceIds) spent.add(id);
  for (const id of intent.alternativeCostCardInstanceIds ?? []) spent.add(id);
  const card = intentCard(intent, own);
  if (card) {
    const me = input.view.players[input.seat];
    if ([...me.hand, ...me.arsenal].some((candidate) => candidate.instanceId === card.instanceId)) {
      spent.add(card.instanceId);
    }
  }
  return spent;
}

/**
 * Value lost from the single best card that could occupy arsenal next turn.
 * Spending an interchangeable card costs nothing here; spending the unique
 * best option costs only its margin over the best card that remains.
 */
export function nextTurnArsenalOpportunityCost(
  input: BotPolicyInput,
  spentIds: ReadonlySet<number>,
  value: BotPolicyScorers["nextTurnArsenal"],
): number {
  const me = input.view.players[input.seat];
  const bestHandValue = (excluded: ReadonlySet<number>): number => me.hand.reduce(
    (best, card) => excluded.has(card.instanceId) ? best : Math.max(best, value(card, input)),
    0,
  );
  const heldArsenal = me.arsenal[0];
  const before = heldArsenal ? value(heldArsenal, input) : bestHandValue(new Set());
  const after = heldArsenal && !spentIds.has(heldArsenal.instanceId)
    ? value(heldArsenal, input)
    : bestHandValue(spentIds);
  return before - after;
}

function pitchVariantKey(intent: GameIntent, input: BotPolicyInput): string {
  if (intent.kind === "choose" && resourcePaymentPitchIds(intent, input) !== undefined) {
    return JSON.stringify({ kind: "choose", resourcePayment: true });
  }
  if (
    intent.kind === "play-card" || intent.kind === "play-from-arsenal" ||
    intent.kind === "play-from-zone" || intent.kind === "activate-ability" ||
    intent.kind === "defend"
  ) {
    return JSON.stringify({ ...intent, pitchInstanceIds: [] });
  }
  return JSON.stringify(intent);
}

function pitchPattern(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number[] {
  const ids = intent.kind === "choose"
    ? (resourcePaymentPitchIds(intent, input) ?? [])
    : pitchIds(intent);
  return ids.map((id) => {
    const card = own.get(id);
    return Number(input.cards[card?.cardId ?? ""]?.pitch ?? 0);
  });
}

function comparePitchPatterns(left: readonly number[], right: readonly number[]): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index++) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  // A legal shorter sequence paid the cost without spending another card.
  return right.length - left.length;
}

function samePitchPattern(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((pitch, index) => pitch === right[index]);
}

/**
 * Keep every card choice matching the best pitch-color pattern for an action.
 * Hero policies can still preserve the most valuable blue (or yellow/red), but
 * they cannot choose a lower color while a higher-color payment is legal.
 */
export function preferredPitchIntents(
  intents: readonly GameIntent[],
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView> = ownCards(input),
): GameIntent[] {
  const bestPatterns = new Map<string, number[]>();
  for (const intent of intents) {
    const variant = pitchVariantKey(intent, input);
    const pattern = pitchPattern(intent, input, own);
    const best = bestPatterns.get(variant);
    if (!best || comparePitchPatterns(pattern, best) > 0) bestPatterns.set(variant, pattern);
  }
  return intents.filter((intent) =>
    samePitchPattern(pitchPattern(intent, input, own), bestPatterns.get(pitchVariantKey(intent, input)) ?? [])
  );
}

/** Planner candidate set that removes only exact pitch-order permutations.
 * Lower-color alternatives remain so the whole-turn evaluator can decide
 * whether floating resources are more valuable than preserving a blue. A
 * policy may choose the representative order because pitched cards retain
 * that order when they move to the bottom of the deck. */
export function strategicPitchIntents(
  intents: readonly GameIntent[],
  compareOrder?: (left: GameIntent, right: GameIntent) => number,
): GameIntent[] {
  const selected = new Map<string, GameIntent>();
  for (const intent of intents) {
    const normalized = intent.kind === "choose"
      ? intent
      : { ...intent, pitchInstanceIds: [...pitchIds(intent)].sort((a, b) => a - b) };
    const variant = JSON.stringify(normalized);
    const current = selected.get(variant);
    if (!current || (compareOrder?.(intent, current) ?? 0) > 0) {
      selected.set(variant, intent);
    }
  }
  return [...selected.values()];
}

export function isAttack(data: CardData | undefined): boolean {
  return data?.cardType === "action" && !!data.subtypes?.includes("attack");
}

export function isOpeningTurn(input: BotPolicyInput): boolean {
  return input.view.turn === 1 && input.view.activePlayer === input.seat;
}

export function isOpeningTurnDefense(input: BotPolicyInput): boolean {
  return input.view.turn === 1 && input.view.activePlayer !== input.seat;
}

export function currentLink(input: BotPolicyInput) {
  return [...input.view.chain].reverse().find((link) => !link.resolved);
}

export function currentAttackIsOurs(input: BotPolicyInput): boolean {
  return currentLink(input)?.attackingCard.owner === input.seat;
}

export function currentAttackIsOpponents(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  return !!link && link.attackingCard.owner !== input.seat;
}

export function incomingAttackDamage(input: BotPolicyInput): number {
  const link = currentLink(input);
  return link && link.attackingCard.owner !== input.seat
    ? Math.max(0, link.attackValue - link.defenseValue)
    : 0;
}

export function currentAttackIsOnStack(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  if (!link?.onStack) return false;
  return input.view.stack.some((layer) =>
    layer.card?.instanceId === link.attackingCard.instanceId
  );
}

/** A resolving opposing effect that threatens damage outside the ordinary
 * attack layer. This deliberately excludes an attack card waiting to resolve
 * so prevention can be coordinated with the later defense step. */
export function opponentDamageEffectOnStack(input: BotPolicyInput): boolean {
  const decision = input.view.pendingDecision;
  if (
    decision?.kind !== "priority-window" &&
    decision?.kind !== "attack-reaction" &&
    decision?.kind !== "defense-reaction"
  ) return false;
  const layer = input.view.stack[0];
  if (!layer || layer.seat === input.seat) return false;
  const link = currentLink(input);
  if (link?.onStack && layer.card?.instanceId === link.attackingCard.instanceId) return false;
  if (/\b(?:deal|deals|damage)\b/i.test(layer.label)) return true;
  const source = layer.card ? input.cards[layer.card.cardId] : undefined;
  return source !== undefined && /\bdeal(?:s)?\b[^.\n]{0,100}\bdamage\b/i.test(source.text);
}

export function visibleOpponentDamageAmount(input: BotPolicyInput): number | undefined {
  const layer = input.view.stack[0];
  if (!layer || layer.seat === input.seat) return undefined;
  const sourceText = layer.card ? input.cards[layer.card.cardId]?.text ?? "" : "";
  const match = /\b(\d+)\s+(?:arcane\s+|physical\s+)?damage\b/i.exec(`${layer.label}\n${sourceText}`);
  return match ? Number(match[1]) : undefined;
}

/** Sum public copies of one functional effect that are already resolving or
 * active. Ongoing labels may expose a remaining numeric pool; stack copies use
 * the card's full contribution. */
export function committedEffectAmount(
  input: BotPolicyInput,
  functional: string,
  amountPerStack: number,
  ongoingAmount: (label: string) => number = () => amountPerStack,
): number {
  const ongoing = input.view.ongoing.reduce((total, effect) =>
    effect.seat === input.seat && functionalKey(input.cards[effect.cardId]) === functional
      ? total + ongoingAmount(effect.label)
      : total,
  0);
  const stackCopies = input.view.stack.filter((layer) =>
    layer.seat === input.seat && functionalKey(input.cards[layer.card?.cardId ?? ""]) === functional
  ).length;
  return ongoing + stackCopies * amountPerStack;
}

export function effectIsCommitted(input: BotPolicyInput, functional: string): boolean {
  return committedEffectAmount(input, functional, 1) > 0;
}

export function optionCard(intent: ChooseIntent, input: BotPolicyInput): CardView | null {
  const decision = input.view.pendingDecision;
  const index = decision?.options?.indexOf(intent.optionId) ?? -1;
  return index >= 0 ? (decision?.optionCards?.[index] ?? null) : null;
}

export function scoreArsenalChoice(
  intent: ChooseIntent,
  input: BotPolicyInput,
  value: (card: CardView, input: BotPolicyInput) => number,
  passScore = -10,
): number {
  const card = optionCard(intent, input);
  return intent.optionId === "pass" || !card ? passScore : value(card, input);
}

export function scoreSpendCardChoice(
  intent: ChooseIntent,
  input: BotPolicyInput,
  opportunity: (card: CardView, input: BotPolicyInput) => number,
  base = 20,
  passScore = -5,
): number {
  const card = optionCard(intent, input);
  return card ? base - opportunity(card, input) : passScore;
}

export function scoreBinaryChoice(
  optionId: string,
  acceptScore = 10,
  declineScore = 0,
): number | undefined {
  if (optionId === "yes" || optionId === "accept") return acceptScore;
  if (optionId === "no" || optionId === "decline" || optionId === "pass") return declineScore;
  return undefined;
}

export interface PlannedPrevention {
  amount: number;
  consumedIds: readonly number[];
  resourceCost: number;
  reactionIds?: readonly number[];
  pitchIds?: readonly number[];
  preventionIds?: readonly number[];
}

function minimumPitchForCost(
  cost: number,
  resources: number,
  candidates: readonly CardView[],
  input: BotPolicyInput,
): readonly number[] | undefined {
  const needed = Math.max(0, cost - resources);
  if (needed === 0) return [];
  let best: { ids: number[]; overpay: number } | undefined;
  for (let mask = 1; mask < 2 ** candidates.length; mask++) {
    const selected = candidates.filter((_, index) => (mask & (2 ** index)) !== 0);
    const pitched = selected.reduce(
      (total, card) => total + Number(input.cards[card.cardId]?.pitch ?? 0),
      0,
    );
    if (pitched < needed) continue;
    const overpay = pitched - needed;
    if (!best || selected.length < best.ids.length ||
      (selected.length === best.ids.length && overpay < best.overpay)) {
      best = { ids: selected.map((card) => card.instanceId), overpay };
    }
  }
  return best?.ids;
}

/** Planned defense-reaction package, including the reaction cards and pitch
 * cards it consumes. This is an approximation of future legality, but unlike
 * the old value-only estimate it accounts for ordinary hand pitching. */
export function plannedDefenseReactionPlan(
  input: BotPolicyInput,
  intent: DefendIntent,
): PlannedPrevention {
  const link = currentLink(input);
  if (!link || link.targetAlly) {
    return {
      amount: 0,
      consumedIds: [],
      resourceCost: 0,
      reactionIds: [],
      pitchIds: [],
      preventionIds: [],
    };
  }
  const me = input.view.players[input.seat];
  const handIds = new Set(me.hand.map((card) => card.instanceId));
  const blockedFromHand = intent.instanceIds.some((id) => handIds.has(id));
  const spent = new Set([...intent.instanceIds, ...(intent.pitchInstanceIds ?? [])]);
  const candidates = [
    ...(link.dominate && blockedFromHand ? [] : me.hand),
    ...me.arsenal,
  ].filter((card) => !spent.has(card.instanceId) && input.cards[card.cardId]?.cardType === "defense-reaction");

  const options: PlannedPrevention[] = [{
    amount: 0,
    consumedIds: [],
    resourceCost: 0,
    reactionIds: [],
    pitchIds: [],
    preventionIds: [],
  }];
  for (let mask = 1; mask < 2 ** candidates.length; mask++) {
    const reactions = candidates.filter((_, index) => (mask & (2 ** index)) !== 0);
    const reactionIds = new Set(reactions.map((card) => card.instanceId));
    const cost = reactions.reduce(
      (total, card) => total + Math.max(0, input.cards[card.cardId]?.cost ?? 0),
      0,
    );
    const pitchCandidates = me.hand.filter((card) =>
      !spent.has(card.instanceId) && !reactionIds.has(card.instanceId) &&
      Number(input.cards[card.cardId]?.pitch ?? 0) > 0
    );
    const payment = minimumPitchForCost(cost, me.resources, pitchCandidates, input);
    if (!payment) continue;
    const defense = reactions.reduce(
      (total, card) => total + Math.max(0, card.defense ?? input.cards[card.cardId]?.defense ?? 0),
      0,
    );
    options.push({
      amount: defense,
      consumedIds: [...reactionIds, ...payment],
      resourceCost: cost,
      reactionIds: [...reactionIds],
      pitchIds: [...payment],
      preventionIds: [],
    });
  }
  const incoming = Math.max(0, link.attackValue - link.defenseValue);
  const target = incoming >= me.life ? incoming - me.life + 1 : incoming;
  const covering = options.filter((option) => option.amount >= target);
  const ranked = covering.length > 0 ? covering : options;
  return [...ranked].sort((left, right) => {
    if (covering.length > 0 && left.amount !== right.amount) return left.amount - right.amount;
    if (covering.length === 0 && left.amount !== right.amount) return right.amount - left.amount;
    return left.consumedIds.length - right.consumedIds.length;
  })[0]!;
}

export function plannedDefenseReactionValue(
  input: BotPolicyInput,
  intent: DefendIntent,
): number {
  return plannedDefenseReactionPlan(input, intent).amount;
}

/** Printed defense already committed by this bot's unresolved reaction cards. */
function pendingDefenseReactionValue(input: BotPolicyInput): number {
  return input.view.stack.reduce((total, layer) => {
    if (layer.seat !== input.seat || !layer.card) return total;
    const data = input.cards[layer.card.cardId];
    if (data?.cardType !== "defense-reaction") return total;
    return total + Math.max(0, layer.card.defense ?? data.defense ?? 0);
  }, 0);
}

export function scoreDefenseReaction(data: CardData, input: BotPolicyInput): number {
  const link = currentLink(input);
  const incoming = link
    ? Math.max(0, link.attackValue - link.defenseValue - pendingDefenseReactionValue(input))
    : 0;
  if (input.view.pendingDecision?.kind !== "defense-reaction" || incoming === 0) return -100;
  const defense = Math.max(0, data.defense ?? 0);
  const me = input.view.players[input.seat];
  if (link && link.attackValue >= me.life) {
    const minimumToSurvive = incoming - me.life + 1;
    if (minimumToSurvive <= 0) return -100;
    if (defense >= minimumToSurvive) {
      return 100 - (defense - minimumToSurvive) * 1.5;
    }
  }
  const prevented = Math.min(incoming, defense);
  const overblock = Math.max(0, defense - incoming);
  return 20 + prevented * 4 - overblock * 1.5;
}

const WAGER_TOKEN_VALUES: Readonly<Record<string, number>> = {
  "blade dance": 5,
  flurry: 8,
  agility: 5,
  gold: 5,
  vigor: 4,
  courage: 3,
  might: 3,
};

/** Strategic value of winning one projected Wager reward. Reward labels are
 * public, exhaustive descriptions supplied by the engine, so shared bot
 * policy can evaluate them without knowing the source card's identity. */
export function wagerRewardValue(reward: string): number {
  const normalized = reward.trim().toLowerCase();
  if (normalized.length === 0 || normalized === "no specified prize") return 0;

  const lifeLoss = /winner loses (\d+) life/.exec(normalized);
  if (lifeLoss) return -Number(lifeLoss[1]);
  if (/winner discards (?:a|\d+) card/.test(normalized)) return -6;
  if (/winner destroys .*arsenal/.test(normalized)) return -5;

  let value = 0;
  let recognized = false;
  if (normalized.includes("winner creates")) {
    for (const [name, tokenValue] of Object.entries(WAGER_TOKEN_VALUES)) {
      if (normalized.includes(name)) {
        value += tokenValue;
        recognized = true;
      }
    }
    if (!recognized) {
      value += 3;
      recognized = true;
    }
  }
  if (/winner draws (?:a|\d+) card/.test(normalized)) {
    value += 6;
    recognized = true;
  }
  if (/other hero discards (?:a|\d+) card/.test(normalized)) {
    value += 5;
    recognized = true;
  }
  if (normalized.includes("intellect")) {
    value += 6;
    recognized = true;
  }
  if (normalized.includes("searches their deck")) {
    value += 5;
    recognized = true;
  }
  if (normalized.includes("equip an equipment card from their graveyard")) {
    value += 4;
    recognized = true;
  }
  return recognized ? value : 2;
}

/** Stopping a Wager both earns its prize and denies that same prize to the
 * attacker, so the block comparison uses twice the winner-side value. */
function wagerDefenseSwing(rewards: readonly string[] | undefined): number {
  return 2 * (rewards ?? []).reduce(
    (total, reward) => total + wagerRewardValue(reward),
    0,
  );
}

/** Opportunity cost of one equipment block. Durable keywords lose counters
 * rather than the whole card, so price the defense actually worn away instead
 * of charging every armor piece as though it had Blade Break. */
function equipmentWearCost(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  const keywords = new Set((data?.keywords ?? []).map((keyword) => keyword.toLowerCase()));
  const defense = Math.max(0, card.defense ?? data?.defense ?? 0);
  if (keywords.has("battleworn")) return 1;
  if (keywords.has("temper")) return defense <= 1 ? 2 : 1.5;
  if (keywords.has("guardwell")) return Math.max(1, defense);
  if (keywords.has("blade break")) return Math.max(2, defense);
  return defense > 0 ? 2 : 0;
}

function equipmentKeywords(card: CardView, input: BotPolicyInput): ReadonlySet<string> {
  return new Set((input.cards[card.cardId]?.keywords ?? []).map((keyword) => keyword.toLowerCase()));
}

function isBladeBeckoner(card: CardView, input: BotPolicyInput): boolean {
  return input.cards[card.cardId]?.name.trim().toLowerCase().startsWith("blade beckoner ") === true;
}

function bladeBeckonerDefenseBonus(card: CardView, input: BotPolicyInput): number {
  const link = currentLink(input);
  return isBladeBeckoner(card, input) &&
      input.cards[link?.attackingCard.cardId ?? ""]?.cardType === "weapon"
    ? 1
    : 0;
}

function isMidgameDurableArmor(card: CardView, input: BotPolicyInput): boolean {
  if (input.view.players[input.seat].life > 20) return false;
  const data = input.cards[card.cardId];
  const keywords = equipmentKeywords(card, input);
  return Math.max(0, data?.defense ?? 0) >= 2 &&
    (keywords.has("battleworn") || keywords.has("temper"));
}

export type DefensePermission = "forbid" | "allow" | "require";

export interface ResponseEvaluation {
  damageThreatened: number;
  futureHandValue: number;
  arsenalValue: number;
  boardValue: number;
  strategicAdjustment: number;
  total: number;
}

export function responseEvaluation(
  value: Partial<Omit<ResponseEvaluation, "total">>,
): ResponseEvaluation {
  const response = {
    damageThreatened: value.damageThreatened ?? 0,
    futureHandValue: value.futureHandValue ?? 0,
    arsenalValue: value.arsenalValue ?? 0,
    boardValue: value.boardValue ?? 0,
    strategicAdjustment: value.strategicAdjustment ?? 0,
  };
  return {
    ...response,
    total: response.damageThreatened
      + response.futureHandValue
      + response.arsenalValue
      + response.boardValue
      + response.strategicAdjustment,
  };
}

export interface ContinuationProfile {
  stopProbability: number;
  representativeAttack: number;
}

export interface DefenseCandidateContext {
  input: BotPolicyInput;
  intent: DefendIntent;
  chosen: readonly CardView[];
  stagedIds: ReadonlySet<number>;
  consumedIds: ReadonlySet<number>;
  incoming: number;
  defense: number;
  plannedPrevention: PlannedPrevention;
  lethal: boolean;
  survives: boolean;
  stopsHit: boolean;
  onHit: OnHitEvaluation;
}

export interface HeroCycleModel {
  offensiveCards(input: BotPolicyInput): readonly CardView[];
  evaluateResponse(cards: readonly CardView[], input: BotPolicyInput): ResponseEvaluation;
  cardOpportunity(card: CardView, input: BotPolicyInput): number;
  /** Return the complete planned prevention package, or null when this defense
   * plan spends a card the hero policy must reserve. */
  plannedPrevention?(
    input: BotPolicyInput,
    intent: DefendIntent,
    spentIds: ReadonlySet<number>,
    reactionPlan: PlannedPrevention,
  ): PlannedPrevention | null;
  canUseDefender?(card: CardView, input: BotPolicyInput): boolean;
  /** Equipment whose defense is free to cash in now because the hero expects
   * to refresh it or consume it offensively on the following turn. */
  equipmentUseIsFree?(card: CardView, input: BotPolicyInput): boolean;
  lifeThresholds?: readonly LifeThreshold[];
  responseLossWeight?: number;
  defensePermission?(candidate: DefenseCandidateContext): DefensePermission;
  adjustCycleValue?(
    value: ValueBreakdown,
    candidate: DefenseCandidateContext,
  ): ValueBreakdown;
  continuationProfile?(
    input: BotPolicyInput,
    link: NonNullable<ReturnType<typeof currentLink>>,
  ): Partial<ContinuationProfile>;
}

export interface DefenseCycleTrace {
  score: number;
  value: ValueBreakdown;
  eligible: boolean;
  lethal: boolean;
  survives: boolean;
  stopsHit: boolean;
  permission: DefensePermission;
  onHit: OnHitEvaluation;
  stopProbability: number;
  representativeAttack: number;
  stopResponse: ResponseEvaluation;
  continueResponse: ResponseEvaluation;
  defenderIds: readonly number[];
  pitchIds: readonly number[];
  plannedPreventionIds: readonly number[];
  reactionIds: readonly number[];
  equipmentIds: readonly number[];
  consumedIds: readonly number[];
  continuationDefenderIds: readonly number[];
  futureDamagePrevented: number;
}

export type DefenseValueTrace = DefenseCycleTrace;

const EMPTY_RESPONSE = responseEvaluation({});
const EMPTY_ON_HIT: OnHitEvaluation = {
  value: 0,
  cardDraw: 0,
  delayedDamage: 0,
  handCardsLost: 0,
  destroysOccupiedArsenal: false,
  equipmentDamage: false,
  tokenCreation: false,
};

function traceDefaults(): Pick<DefenseCycleTrace,
  "permission" | "onHit" | "stopProbability" | "representativeAttack" |
  "stopResponse" | "continueResponse" | "defenderIds" | "pitchIds" |
  "plannedPreventionIds" | "reactionIds" | "equipmentIds" | "consumedIds" |
  "continuationDefenderIds" |
  "futureDamagePrevented"
> {
  return {
    permission: "allow",
    onHit: EMPTY_ON_HIT,
    stopProbability: 1,
    representativeAttack: 0,
    stopResponse: EMPTY_RESPONSE,
    continueResponse: EMPTY_RESPONSE,
    defenderIds: [],
    pitchIds: [],
    plannedPreventionIds: [],
    reactionIds: [],
    equipmentIds: [],
    consumedIds: [],
    continuationDefenderIds: [],
    futureDamagePrevented: 0,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function defaultContinuationProfile(
  input: BotPolicyInput,
  link: NonNullable<ReturnType<typeof currentLink>>,
): ContinuationProfile {
  const attacker = input.view.players[1 - input.seat]!;
  if (link.goAgain !== true && attacker.actionPoints <= 0) {
    return { stopProbability: 1, representativeAttack: 0 };
  }
  return {
    stopProbability: clamp(
      0.75 - 0.2 * Math.min(attacker.handCount, 3) - 0.15 * attacker.arsenalCount,
      0.15,
      0.75,
    ),
    representativeAttack: Math.min(6, 3 + attacker.handCount + attacker.arsenalCount),
  };
}

function weightedResponse(
  full: ResponseEvaluation,
  remaining: ResponseEvaluation,
  weight: number,
): ResponseEvaluation {
  const retain = (fullValue: number, remainingValue: number): number =>
    fullValue - Math.max(0, fullValue - remainingValue) * weight;
  return responseEvaluation({
    damageThreatened: retain(full.damageThreatened, remaining.damageThreatened),
    futureHandValue: retain(full.futureHandValue, remaining.futureHandValue),
    arsenalValue: retain(full.arsenalValue, remaining.arsenalValue),
    boardValue: retain(full.boardValue, remaining.boardValue),
    strategicAdjustment: retain(full.strategicAdjustment, remaining.strategicAdjustment),
  });
}

function blendResponse(
  stop: ResponseEvaluation,
  continued: ResponseEvaluation,
  stopProbability: number,
): ResponseEvaluation {
  const continuing = 1 - stopProbability;
  return responseEvaluation({
    damageThreatened: stop.damageThreatened * stopProbability
      + continued.damageThreatened * continuing,
    futureHandValue: stop.futureHandValue * stopProbability
      + continued.futureHandValue * continuing,
    arsenalValue: stop.arsenalValue * stopProbability
      + continued.arsenalValue * continuing,
    boardValue: stop.boardValue * stopProbability
      + continued.boardValue * continuing,
    strategicAdjustment: stop.strategicAdjustment * stopProbability
      + continued.strategicAdjustment * continuing,
  });
}

function projectedResponseInput(
  input: BotPolicyInput,
  plannedPrevention: PlannedPrevention,
): BotPolicyInput {
  const me = input.view.players[input.seat];
  const pitchedResources = (plannedPrevention.pitchIds ?? []).reduce((total, id) => {
    const card = me.hand.find((candidate) => candidate.instanceId === id);
    return total + Number(input.cards[card?.cardId ?? ""]?.pitch ?? 0);
  }, 0);
  const resources = Math.max(0, me.resources + pitchedResources - plannedPrevention.resourceCost);
  if (resources === me.resources) return input;
  const players: GameView["players"] = input.seat === 0
    ? [{ ...input.view.players[0], resources }, input.view.players[1]]
    : [input.view.players[0], { ...input.view.players[1], resources }];
  return {
    ...input,
    view: {
      ...input.view,
      players,
    },
  };
}

interface ContinuationEvaluation {
  response: ResponseEvaluation;
  defenderIds: readonly number[];
  prevention: number;
  overblock: number;
  opportunityCost: number;
}

function bestContinuationResponse(
  input: BotPolicyInput,
  responseInput: BotPolicyInput,
  model: HeroCycleModel,
  fullResponse: ResponseEvaluation,
  responseCards: readonly CardView[],
  consumedIds: ReadonlySet<number>,
  representativeAttack: number,
): ContinuationEvaluation {
  const weight = model.responseLossWeight ?? 1;
  const candidates = input.view.players[input.seat].hand.filter((card) => {
    if (consumedIds.has(card.instanceId)) return false;
    const data = input.cards[card.cardId];
    return data?.cardType !== "defense-reaction" && Math.max(0, card.defense ?? data?.defense ?? 0) > 0;
  });
  const evaluate = (defenders: readonly CardView[]): ContinuationEvaluation => {
    const defenderIds = defenders.map((card) => card.instanceId);
    const futureConsumed = new Set([...consumedIds, ...defenderIds]);
    const response = weightedResponse(
      fullResponse,
      model.evaluateResponse(
        responseCards.filter((card) => !futureConsumed.has(card.instanceId)),
        responseInput,
      ),
      weight,
    );
    const defense = defenders.reduce(
      (total, card) => total + Math.max(0, card.defense ?? input.cards[card.cardId]?.defense ?? 0),
      0,
    );
    return {
      response,
      defenderIds,
      prevention: Math.min(representativeAttack, defense),
      overblock: Math.max(0, defense - representativeAttack),
      opportunityCost: defenders.reduce(
        (total, card) => total + model.cardOpportunity(card, input) * 0.1,
        0,
      ),
    };
  };
  const score = (candidate: ContinuationEvaluation): number => candidate.response.total
    + candidate.prevention
    - candidate.overblock * 1.5
    - candidate.opportunityCost;

  let best = evaluate([]);
  for (let first = 0; first < candidates.length; first++) {
    const one = evaluate([candidates[first]!]);
    if (score(one) > score(best)) best = one;
    for (let second = first + 1; second < candidates.length; second++) {
      const two = evaluate([candidates[first]!, candidates[second]!]);
      if (score(two) > score(best)) best = two;
    }
  }
  return best;
}

/** Shared block valuation with hero-specific offense and prevention projections. */
export function scoreDefenseIntentWithTrace(
  intent: DefendIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
  model: HeroCycleModel,
): DefenseCycleTrace {
  const link = currentLink(input);
  if (!link) {
    const score = intent.instanceIds.length === 0 ? 1 : -100;
    return {
      score,
      value: valueBreakdown({ strategicAdjustment: score }),
      eligible: true,
      lethal: false,
      survives: true,
      stopsHit: false,
      ...traceDefaults(),
    };
  }
  const incoming = Math.max(0, link.attackValue - link.defenseValue);
  const me = input.view.players[input.seat];
  const chosen = intent.instanceIds.flatMap((id) => own.get(id) ?? []);
  if (model.canUseDefender && chosen.some((card) => !model.canUseDefender!(card, input))) {
    return {
      score: -1_000_000,
      value: valueBreakdown({ strategicAdjustment: -1_000_000 }),
      eligible: false,
      lethal: incoming >= me.life,
      survives: false,
      stopsHit: false,
      ...traceDefaults(),
    };
  }
  const spentIds = new Set([...intent.instanceIds, ...(intent.pitchInstanceIds ?? [])]);
  const reactionPlan = plannedDefenseReactionPlan(input, intent);
  const plannedPrevention = model.plannedPrevention
    ? model.plannedPrevention(input, intent, spentIds, reactionPlan)
    : reactionPlan;
  if (plannedPrevention === null) {
    return {
      score: -1_000,
      value: valueBreakdown({ strategicAdjustment: -1_000 }),
      eligible: false,
      lethal: incoming >= me.life,
      survives: false,
      stopsHit: false,
      ...traceDefaults(),
    };
  }

  const incomingAfterPlannedPrevention = Math.max(0, incoming - plannedPrevention.amount);
  const defense = chosen.reduce(
    (sum, card) => sum + (card.defense ?? 0) + bladeBeckonerDefenseBonus(card, input),
    0,
  );
  // Future reaction/prevention cards are reserved here so the staged block is
  // planned around them, but they have not resolved yet. Count only prevention
  // supplied by the current defender choice; otherwise merely holding a
  // reaction can dominate an established efficient block before it is played.
  const prevented = Math.min(incomingAfterPlannedPrevention, defense);
  const overblock = Math.max(0, defense - incomingAfterPlannedPrevention);
  const lethal = incoming >= me.life;
  const attackText = input.cards[link.attackingCard.cardId]?.text ?? "";
  const attacker = input.view.players[1 - input.seat]!;
  const onHit = evaluateOnHit({
    effects: link.onHitEffects ?? [],
    sourceText: attackText,
    attackerCanContinue: link.goAgain === true || attacker.actionPoints > 0,
    attackerCanArsenal: attacker.arsenalCount === 0,
    defenderHasHand: me.handCount > 0,
    defenderHasArsenal: me.arsenalCount > 0,
  });
  const meaningfulOnHit = onHit.value > 0;
  const stopsHit = incoming > 0 && defense + plannedPrevention.amount >= incoming;
  const stopHitValue = stopsHit
    ? onHit.value + (link.wagered ? wagerDefenseSwing(link.wagerRewards) : 0)
    : 0;
  const equipmentIds = new Set(
    Object.values(me.equipment).filter((card): card is CardView => !!card).map((card) => card.instanceId),
  );
  const selectedEquipment = chosen.filter((card) => equipmentIds.has(card.instanceId));
  const stagedIds = new Set(
    input.view.pendingDecision?.kind === "defend"
      ? input.view.pendingDecision.stagedCards?.map((card) => card.instanceId) ?? []
      : [],
  );
  const plannedSpentIds = new Set([...spentIds, ...plannedPrevention.consumedIds]);
  const survives = incoming - defense - plannedPrevention.amount < me.life;
  const candidate: DefenseCandidateContext = {
    input,
    intent,
    chosen,
    stagedIds,
    consumedIds: plannedSpentIds,
    incoming,
    defense,
    plannedPrevention,
    lethal,
    survives,
    stopsHit,
    onHit,
  };
  const permission = model.defensePermission?.(candidate) ?? "allow";
  if (permission === "forbid") {
    return {
      score: -1_000_000,
      value: valueBreakdown({ strategicAdjustment: -1_000_000 }),
      eligible: false,
      lethal,
      survives,
      stopsHit,
      ...traceDefaults(),
      permission,
      onHit,
    };
  }
  const attackIsWeapon = input.cards[link.attackingCard.cardId]?.cardType === "weapon";
  const protectedEquipment = selectedEquipment.filter((card) => {
    // Mandatory-defense attacks may already have forced this armor onto the
    // chain. At that point score how best to complete the block rather than
    // treating the sunk equipment selection as a new strategic choice.
    if (stagedIds.has(card.instanceId)) return false;
    if (lethal || isMidgameDurableArmor(card, input)) return false;
    if (model.equipmentUseIsFree?.(card, input)) return false;
    if (attackIsWeapon && isBladeBeckoner(card, input)) return false;
    // Early armor is justified by an on-hit or Wager only when the complete
    // defense actually stops that hit and therefore answers the effect.
    if (stopsHit && (meaningfulOnHit || link.wagered === true)) return false;
    return true;
  });
  if (protectedEquipment.length > 0) {
    return {
      score: -1_000_000,
      value: valueBreakdown({ strategicAdjustment: -1_000_000 }),
      eligible: false,
      lethal,
      survives,
      stopsHit,
      ...traceDefaults(),
      permission,
      onHit,
    };
  }
  const equipmentCost = selectedEquipment.reduce(
    (total, card) => total + (model.equipmentUseIsFree?.(card, input)
      ? 0
      : equipmentWearCost(card, input)),
    0,
  );
  // Damage projection captures cards essential to the next offensive line,
  // but interchangeable cards can otherwise look literally free to spend.
  // Retain a small tie-break value so durable armor replaces the least useful
  // hand card when both plans cover the same attack efficiently.
  const handOpportunityCost = chosen
    .filter((card) => !equipmentIds.has(card.instanceId))
    .reduce((total, card) => total + model.cardOpportunity(card, input) * 0.1, 0);
  const offensiveCards = model.offensiveCards(input);
  const fullResponse = model.evaluateResponse(offensiveCards, input);
  const responseInput = projectedResponseInput(input, plannedPrevention);
  const remainingRawResponse = model.evaluateResponse(
    offensiveCards.filter((card) => !plannedSpentIds.has(card.instanceId)),
    responseInput,
  );
  const responseWeight = model.responseLossWeight ?? 1;
  const stopResponse = weightedResponse(fullResponse, remainingRawResponse, responseWeight);
  const defaultContinuation = defaultContinuationProfile(input, link);
  const override = model.continuationProfile?.(input, link) ?? {};
  const stopProbability = clamp(
    override.stopProbability ?? defaultContinuation.stopProbability,
    0,
    1,
  );
  const representativeAttack = Math.max(
    0,
    override.representativeAttack ?? defaultContinuation.representativeAttack,
  );
  const continuation = representativeAttack > 0 && stopProbability < 1
    ? bestContinuationResponse(
      input,
      responseInput,
      model,
      fullResponse,
      offensiveCards,
      plannedSpentIds,
      representativeAttack,
    )
    : {
      response: stopResponse,
      defenderIds: [],
      prevention: 0,
      overblock: 0,
      opportunityCost: 0,
    };
  const blendedResponse = blendResponse(stopResponse, continuation.response, stopProbability);
  const plannedOpportunityCost = plannedPrevention.consumedIds.reduce(
    (total, id) => total + (own.get(id) ? model.cardOpportunity(own.get(id)!, input) : 0),
    0,
  );
  const unprevented = Math.max(0, incoming - defense - plannedPrevention.amount);
  const lifeAfterDamage = me.life - unprevented;
  const thresholdRisk = lifeThresholdRisk(lifeAfterDamage, model.lifeThresholds);
  const continueProbability = 1 - stopProbability;
  let value = valueBreakdown({
    damageThreatened: blendedResponse.damageThreatened,
    damagePrevented: prevented + continuation.prevention * continueProbability,
    onHitValue: stopHitValue,
    futureHandValue: blendedResponse.futureHandValue,
    arsenalValue: blendedResponse.arsenalValue,
    boardValue: blendedResponse.boardValue,
    strategicAdjustment: blendedResponse.strategicAdjustment,
    equipmentCost,
    cardOpportunityCost: handOpportunityCost
      + plannedOpportunityCost * 0.1
      + continuation.opportunityCost * continueProbability,
    overblockCost: overblock * 1.5 + continuation.overblock * 1.5 * continueProbability,
    lifeThresholdRisk: thresholdRisk,
  });
  if (model.adjustCycleValue) value = model.adjustCycleValue(value, candidate);
  const strategicDelta = value.total - valueBreakdown({
    damageThreatened: blendedResponse.damageThreatened,
    damagePrevented: prevented + continuation.prevention * continueProbability,
    onHitValue: stopHitValue,
    futureHandValue: blendedResponse.futureHandValue,
    arsenalValue: blendedResponse.arsenalValue,
    boardValue: blendedResponse.boardValue,
    strategicAdjustment: blendedResponse.strategicAdjustment,
    equipmentCost,
    cardOpportunityCost: handOpportunityCost
      + plannedOpportunityCost * 0.1
      + continuation.opportunityCost * continueProbability,
    overblockCost: overblock * 1.5 + continuation.overblock * 1.5 * continueProbability,
    lifeThresholdRisk: thresholdRisk,
  }).total;
  const cycleTrace = {
    permission,
    onHit,
    stopProbability,
    representativeAttack,
    stopResponse,
    continueResponse: continuation.response,
    defenderIds: [...intent.instanceIds],
    pitchIds: [...new Set([
      ...(intent.pitchInstanceIds ?? []),
      ...(plannedPrevention.pitchIds ?? []),
    ])],
    plannedPreventionIds: [...(plannedPrevention.preventionIds ?? [])],
    reactionIds: [...(plannedPrevention.reactionIds ?? [])],
    equipmentIds: selectedEquipment.map((card) => card.instanceId),
    consumedIds: [...plannedSpentIds],
    continuationDefenderIds: continuation.defenderIds,
    futureDamagePrevented: continuation.prevention * continueProbability,
  };

  if (lethal) {
    const handDefenseNeeded = Math.max(0, incomingAfterPlannedPrevention - me.life + 1);
    const survives = defense >= handDefenseNeeded;
    const preservationCost = chosen.reduce(
      (sum, card) => sum + model.cardOpportunity(card, input),
      0,
    ) + plannedOpportunityCost;
    if (!survives) {
      return {
        score: defense * 100 - equipmentCost - preservationCost,
        value,
        eligible: true,
        lethal,
        survives,
        stopsHit,
        ...cycleTrace,
      };
    }
    // Staying alive is mandatory. Of the surviving plans, maximize the
    // hero-specific next-turn damage projection first; only then prefer the
    // lower-opportunity block and avoid needless overblocking/equipment wear.
    const score = 100_000
      + stopResponse.total * 1_000
      + stopHitValue * 10
      - preservationCost * 10
      - overblock * 2
      - chosen.length
      - equipmentCost
      + strategicDelta;
    return { score, value, eligible: true, lethal, survives, stopsHit, ...cycleTrace };
  }

  // Both players draw back up after the first turn, so maximize prevention
  // when this bot was sent second and will receive a fresh hand afterward.
  if (isOpeningTurnDefense(input)) {
    const score = prevented * 100
      + stopHitValue
      - overblock * 1.5
      - equipmentCost
      - chosen.length * 0.01
      + strategicDelta;
    return { score, value, eligible: true, lethal, survives: true, stopsHit, ...cycleTrace };
  }

  const requiredBonus = permission === "require" ? 100_000 : 0;
  return {
    score: value.total + requiredBonus,
    value,
    eligible: true,
    lethal,
    survives: true,
    stopsHit,
    ...cycleTrace,
  };
}

/** Shared block valuation with hero-specific offense and prevention projections. */
export function scoreDefenseIntent(
  intent: DefendIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
  model: HeroCycleModel,
): number {
  return scoreDefenseIntentWithTrace(intent, input, own, model).score;
}

function scoreIntent(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
  scorers: BotPolicyScorers,
): number {
  let score: number;
  switch (intent.kind) {
    case "defend": score = scorers.defend(intent, input, own); break;
    case "choose": score = scorers.choose(intent, input); break;
    case "choose-many": score = 0; break;
    case "order-triggers": score = 0; break;
    case "skip-runechant": score = 0; break;
    case "play-card":
    case "play-from-arsenal":
    case "play-from-zone":
    case "activate-ability":
      score = scorers.play(intent, input, own);
      break;
    case "close-chain": score = 1; break;
    case "pass": score = 0; break;
    case "stage-defenders": score = -1_000; break;
    case "concede": score = -1_000_000; break;
  }
  return score - nextTurnArsenalOpportunityCost(
    input,
    spentCardIds(intent, input, own),
    scorers.nextTurnArsenal,
  ) * NEXT_TURN_ARSENAL_OPPORTUNITY_WEIGHT;
}

export type TargetableAttackIntent = Extract<GameIntent,
  { kind: "play-card" | "play-from-arsenal" | "play-from-zone" | "activate-ability" }>;

export function targetableAttackIntent(intent: GameIntent): intent is TargetableAttackIntent {
  return intent.kind === "play-card" || intent.kind === "play-from-arsenal" ||
    intent.kind === "play-from-zone" || intent.kind === "activate-ability";
}

function isSpectraCard(card: CardView | undefined, input: BotPolicyInput): boolean {
  return !!card && input.cards[card.cardId]?.keywords?.some((keyword) =>
    keyword.toLowerCase() === "spectra"
  ) === true;
}

export function attackIntentVariantKey(intent: TargetableAttackIntent): string {
  const { targetAllyId: _targetAllyId, ...variant } = intent;
  return JSON.stringify(variant);
}

/** True when the current attack can kill an ally, but a strictly smaller
 * follow-up can kill that same ally. In that case the current attack's excess
 * damage is better assigned to the opposing hero. */
export function hasSmallerLethalAllyFollowup(
  currentDamage: number,
  followupDamages: readonly number[],
  allyLives: readonly number[],
): boolean {
  return allyLives.some((life) =>
    currentDamage >= life && followupDamages.some((damage) =>
      damage < currentDamage && damage >= life
    )
  );
}

const CHUM_KEY = "chum, friendly first mate|2";
const SAWBONES_KEY = "sawbones, dock hand|2";

export function opponentAllies(input: BotPolicyInput): CardView[] {
  return input.view.players[1 - input.seat]!.board.filter((card) => {
    const data = input.cards[card.cardId];
    return card.life !== undefined && [
      ...(data?.subtypes ?? []),
      ...(card.grantedTypes ?? []),
    ].some((subtype) => subtype.toLowerCase() === "ally");
  });
}

/** Damage required to actually destroy an ally from public information.
 * Untapped Sawbones can prevent the next one damage dealt to itself, so its
 * two displayed life represents a three-damage attack threshold. */
export function allyLethalThreshold(ally: CardView, input: BotPolicyInput): number {
  const life = Math.max(1, ally.life ?? input.cards[ally.cardId]?.life ?? 1);
  const sawbonesPrevention = functionalKey(input.cards[ally.cardId]) === SAWBONES_KEY && (
    ally.tapped !== true || input.view.ongoing.some((effect) =>
      functionalKey(input.cards[effect.cardId]) === SAWBONES_KEY &&
      /prevent(?: the next)? 1 damage/i.test(effect.label)
    )
  );
  return sawbonesPrevention
    ? life + 1
    : life;
}

interface AllyTargetPolicyOptions {
  damage?(card: CardView, input: BotPolicyInput): number;
  preserveHeroTarget?(card: CardView, input: BotPolicyInput): boolean;
}

/** Baseline ally targeting for CC bots. Chum is the priority lethal target;
 * otherwise redirect only efficient lethal damage. Never spend damage on an
 * ally that survives the attack. Hero policies may perform deeper sequencing
 * before or after this target-only guardrail. */
export function enforceAllyTargetPolicy(
  input: BotPolicyInput,
  selected: GameIntent,
  options: AllyTargetPolicyOptions = {},
): GameIntent {
  if (!targetableAttackIntent(selected)) return selected;
  const own = ownCards(input);
  const card = intentCard(selected, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || (!isAttack(data) && data?.cardType !== "weapon")) return selected;

  const allies = opponentAllies(input);
  if (allies.length === 0) return selected;
  if (selected.targetAllyId !== undefined && !allies.some((ally) =>
    ally.instanceId === selected.targetAllyId
  )) return selected;

  const variant = attackIntentVariantKey(selected);
  const targetVariant = (targetAllyId: number | undefined): TargetableAttackIntent | undefined =>
    input.legal.find((intent): intent is TargetableAttackIntent =>
      targetableAttackIntent(intent) && intent.targetAllyId === targetAllyId &&
      attackIntentVariantKey(intent) === variant
    );
  const hero = targetVariant(undefined);
  const damage = Math.max(0, options.damage?.(card, input) ?? card.attack ?? data?.attack ?? 0);
  if (hero && damage >= input.view.players[1 - input.seat]!.life) return hero;
  const lethal = allies.filter((ally) => damage >= allyLethalThreshold(ally, input));

  if (selected.targetAllyId !== undefined) {
    const selectedAlly = allies.find((ally) => ally.instanceId === selected.targetAllyId);
    if (!selectedAlly || damage < allyLethalThreshold(selectedAlly, input)) {
      return hero ?? input.legal.find((intent) => intent.kind === "pass") ?? selected;
    }
  } else if (options.preserveHeroTarget?.(card, input)) {
    return selected;
  }

  const chum = lethal
    .filter((ally) => functionalKey(input.cards[ally.cardId]) === CHUM_KEY)
    .sort((left, right) => allyLethalThreshold(left, input) - allyLethalThreshold(right, input))[0];
  if (chum) return targetVariant(chum.instanceId) ?? selected;

  if (selected.targetAllyId !== undefined) return selected;
  const efficient = lethal
    .filter((ally) => damage - allyLethalThreshold(ally, input) <= 1)
    .sort((left, right) =>
      allyLethalThreshold(right, input) - allyLethalThreshold(left, input)
    )[0];
  return efficient ? (targetVariant(efficient.instanceId) ?? selected) : selected;
}

function attackSourceKey(intent: TargetableAttackIntent): string {
  if (intent.kind === "activate-ability") {
    return `activate:${intent.sourceInstanceId}:${intent.abilityIndex ?? 0}`;
  }
  return `${intent.kind}:${intent.instanceId}`;
}

function attackCouldContinueTurn(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  return data?.keywords?.some((keyword) => keyword.toLowerCase() === "go again") === true ||
    /\bgo again\b/i.test(data?.text ?? "");
}

interface SpectraAttackOption {
  target: TargetableAttackIntent;
  hero?: TargetableAttackIntent;
  card: CardView;
  source: string;
  attack: number;
  continues: boolean;
}

function spectraAttackOptions(
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): SpectraAttackOption[] {
  const opponentBoard = input.view.players[1 - input.seat]!.board;
  const spectraIds = new Set(
    opponentBoard.filter((card) => isSpectraCard(card, input)).map((card) => card.instanceId),
  );
  if (spectraIds.size === 0) return [];

  const targetIntents = input.legal.filter((intent): intent is TargetableAttackIntent =>
    targetableAttackIntent(intent) && intent.targetAllyId !== undefined && spectraIds.has(intent.targetAllyId)
  );
  return targetIntents.flatMap((target) => {
    const card = intentCard(target, own);
    if (!card) return [];
    const variant = attackIntentVariantKey(target);
    const hero = input.legal.find((intent): intent is TargetableAttackIntent =>
      targetableAttackIntent(intent) && intent.targetAllyId === undefined &&
      attackIntentVariantKey(intent) === variant
    );
    const data = input.cards[card.cardId];
    return [{
      target,
      ...(hero ? { hero } : {}),
      card,
      source: attackSourceKey(target),
      attack: Math.max(0, card.attack ?? data?.attack ?? 0),
      continues: attackCouldContinueTurn(card, input),
    }];
  });
}

function smallestSpectraAttack(
  options: readonly SpectraAttackOption[],
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): GameIntent | undefined {
  if (options.length === 0) return undefined;
  const minimum = Math.min(...options.map((option) => option.attack));
  const intents = options.filter((option) => option.attack === minimum).map((option) => option.target);
  return preferredPitchIntents(intents, input, own)[0] ?? intents[0];
}

function holdsAttackAfter(
  intent: TargetableAttackIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  const spentIds = spentCardIds(intent, input, own);
  const me = input.view.players[input.seat];
  const potentialFollowups = [
    ...me.hand,
    ...me.arsenal,
    ...me.banish.filter((card) => card.playableFromSourceCardId !== undefined),
  ];
  return potentialFollowups.some((card) =>
    !spentIds.has(card.instanceId) && isAttack(input.cards[card.cardId])
  );
}

/** Shared target discipline for every practice bot. Spectra clears the attack
 * immediately, so continuing attacks stay aimed at the hero until the bot's
 * terminal attack. The terminal clear spends the least attack power possible,
 * and no reactions are committed to an attack that Spectra will erase. */
export function enforceSpectraPolicy(input: BotPolicyInput, selected: GameIntent): GameIntent {
  const link = currentLink(input);
  if (input.view.pendingDecision?.kind === "attack-reaction" &&
    link?.attackingCard.owner === input.seat && isSpectraCard(link.targetAlly, input)) {
    return input.legal.find((intent) => intent.kind === "pass") ?? selected;
  }

  // Spectra is uncommon. Avoid rebuilding the bot's complete visible card map
  // on every ordinary decision just to discover that this rule is irrelevant.
  if (!input.view.players[1 - input.seat]!.board.some((card) => isSpectraCard(card, input))) {
    return selected;
  }

  const own = ownCards(input);
  const options = spectraAttackOptions(input, own);
  if (options.length === 0) return selected;
  // Target discipline may redirect an attack the bot chose, but must never
  // manufacture an attack when the hero policy deliberately chose to pass.
  if (selected.kind === "pass") return selected;
  if (!targetableAttackIntent(selected)) return selected;

  const selectedVariant = attackIntentVariantKey(selected);
  const selectedOption = options.find((option) => attackIntentVariantKey(option.target) === selectedVariant);
  if (!selectedOption) return selected;
  const sourceCount = new Set(options.map((option) => option.source)).size;
  if (selectedOption.continues &&
    (sourceCount > 1 || holdsAttackAfter(selectedOption.target, input, own))) {
    return selectedOption.hero ?? selected;
  }
  const terminal = options.filter((option) => !option.continues);
  return smallestSpectraAttack(terminal.length > 0 ? terminal : options, input, own) ?? selected;
}

/** Deterministic projection-only baseline. Equal scores retain engine order. */
export function chooseScoredIntent(input: BotPolicyInput, scorers: BotPolicyScorers): GameIntent {
  if (input.legal.length === 0) throw new Error("bot has no legal intents");
  const requiredEquipment = requiredEquipmentStageIntent(input);
  if (requiredEquipment) return requiredEquipment;
  const own = ownCards(input);
  const defenderStage = bestDefenderStageIntent(input, own, scorers);
  if (defenderStage) return defenderStage;
  const candidates = preferredPitchIntents(input.legal.filter((intent) =>
    intent.kind !== "concede" && intent.kind !== "stage-defenders"
  ), input, own);
  if (candidates.length === 0) return input.legal[0]!;

  let best = candidates[0]!;
  let bestScore = scoreIntent(best, input, own, scorers);
  for (const intent of candidates.slice(1)) {
    const score = scoreIntent(intent, input, own, scorers);
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }
  return best;
}
