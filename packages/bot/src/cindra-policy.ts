import type { CardData, CardView, EquipmentSlot, GameIntent } from "@fyendal/shared";
import {
  attackIntentVariantKey,
  allyLethalThreshold,
  chooseScoredIntent,
  currentLink,
  enforceSpectraPolicy,
  functionalKey as key,
  intentCard,
  isAttack,
  optionCard,
  opponentAllies,
  ownCards,
  pitchIds,
  preferredPitchIntents,
  remainingPitchValue,
  resourcesAfterCost,
  responseEvaluation,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  shouldPreserveOpeningHand,
  spendsOpeningArsenalReserve,
  targetableAttackIntent,
  type BotPolicyInput,
  type TargetableAttackIntent,
} from "./policy.js";
import {
  chooseTacticalIntentWithTrace,
  type TacticalIntentConfig,
  type TacticalTurnPlan,
} from "./tactical-turn-planner.js";

const CARD = {
  ancestralEmpowerment: "ancestral empowerment|1",
  artOfTheDragonBlood: "art of the dragon: blood|1",
  bloodRunsDeep: "blood runs deep|1",
  bloodSplatteredVest: "blood splattered vest|0",
  brandWithCinderclaw: "brand with cinderclaw|1",
  chum: "chum, friendly first mate|2",
  dracoFire: "draco fire|1",
  dragonscalerFlightPath: "dragonscaler flight path|0",
  enflameTheFirebrand: "enflame the firebrand|1",
  fealty: "fealty|0",
  fireTenetStrikeFirst: "fire tenet: strike first|1",
  flickKnives: "flick knives|0",
  kunaiOfRetribution: "kunai of retribution|0",
  lavaBurst: "lava burst|1",
  ravenousRabble: "ravenous rabble|1",
  snatch: "snatch|1",
  throwDagger: "throw dagger|3",
} as const;

type CardPlayIntent = Extract<GameIntent,
  { kind: "play-card" | "play-from-arsenal" | "play-from-zone" }>;

function isCardPlayIntent(intent: GameIntent): intent is CardPlayIntent {
  return intent.kind === "play-card" || intent.kind === "play-from-arsenal" ||
    intent.kind === "play-from-zone";
}

function equipmentHasKey(
  input: BotPolicyInput,
  slot: EquipmentSlot,
  functional: string,
): boolean {
  const equipment = input.view.players[input.seat].equipment[slot];
  return key(input.cards[equipment?.cardId ?? ""]) === functional;
}

function handAfterPitch(
  intent: GameIntent,
  input: BotPolicyInput,
): CardView[] {
  const pitched = new Set(pitchIds(intent));
  return input.view.players[input.seat].hand.filter((card) => !pitched.has(card.instanceId));
}

function cardForPlayIntent(
  intent: GameIntent,
  input: BotPolicyInput,
  cards: readonly CardView[] = playableCards(input),
): CardView | undefined {
  if (!isCardPlayIntent(intent)) return undefined;
  return cards.find((card) => card.instanceId === intent.instanceId);
}

function ourChainLinks(input: BotPolicyInput): number {
  return input.view.chain.filter((link) => link.attackingCard.owner === input.seat).length;
}

function consecutiveHits(input: BotPolicyInput): number {
  let hits = 0;
  for (const link of [...input.view.chain].reverse()) {
    if (link.attackingCard.owner !== input.seat || !link.resolved || link.hit !== true) break;
    hits++;
  }
  return hits;
}

function isDagger(data: CardData | undefined): boolean {
  return data?.cardType === "weapon" && data.subtypes?.includes("dagger") === true;
}

function isDraconicCard(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  return [
    ...(data?.subtypes ?? []),
    ...(card.grantedTypes ?? []),
  ].some((type) => type.toLowerCase() === "draconic");
}

function isDraconicAttack(card: CardView, input: BotPolicyInput): boolean {
  return isAttack(input.cards[card.cardId]) && isDraconicCard(card, input);
}

function draconicChainLinks(input: BotPolicyInput): number {
  return input.view.chain.filter((link) =>
    link.attackingCard.owner === input.seat && isDraconicCard(link.attackingCard, input)
  ).length;
}

function naturalDraconicAttacksInHand(input: BotPolicyInput): number {
  return input.view.players[input.seat].hand.filter((card) => isDraconicAttack(card, input)).length;
}

function projectedNaturalDraconicLinks(input: BotPolicyInput): number {
  return draconicChainLinks(input) + naturalDraconicAttacksInHand(input);
}

function draconicCostReductionAvailable(
  input: BotPolicyInput,
  kind: "play" | "activation",
): boolean {
  return draconicCostReduction(input, kind) > 0;
}

function draconicCostReduction(input: BotPolicyInput, kind: "play" | "activation"): number {
  return input.view.ongoing.reduce((total, effect) => {
    if (effect.seat !== input.seat ||
      !["ignite|1", CARD.artOfTheDragonBlood].includes(key(input.cards[effect.cardId]))) {
      return total;
    }
    const match = effect.label.match(new RegExp(`${kind} costs (\\d+) less`));
    return total + Number(match?.[1] ?? 0);
  }, 0);
}

function dracoFireDiscountAvailable(input: BotPolicyInput): boolean {
  return input.view.ongoing.some((effect) =>
    effect.seat === input.seat &&
    key(input.cards[effect.cardId]) === CARD.dracoFire &&
    /attack costs [1-9]\d* less/i.test(effect.label)
  );
}

function estimatedPlayCost(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  let cost = Math.max(0, data?.cost ?? 0);
  if (key(data) === CARD.bloodRunsDeep) cost -= draconicChainLinks(input);
  if (isDraconicCard(card, input)) cost -= draconicCostReduction(input, "play");
  return Math.max(0, cost);
}

function hasPendingFealty(input: BotPolicyInput): boolean {
  return input.view.ongoing.some((effect) =>
    effect.seat === input.seat && key(input.cards[effect.cardId]) === CARD.fealty
  );
}

function nextAttackBecomesDraconic(input: BotPolicyInput): boolean {
  return hasPendingFealty(input) || input.view.ongoing.some((effect) =>
    effect.seat === input.seat && key(input.cards[effect.cardId]) === CARD.brandWithCinderclaw
  );
}

function isCindraTurn(input: BotPolicyInput): boolean {
  return input.view.activePlayer === input.seat;
}

function isProactiveInstant(intent: GameIntent, data: CardData): boolean {
  return data.cardType === "instant" ||
    (intent.kind === "activate-ability" && /\binstant\s*[-—:]/i.test(data.text ?? ""));
}

function hasFealtyToken(input: BotPolicyInput): boolean {
  return input.view.players[input.seat].board.some((card) => key(input.cards[card.cardId]) === CARD.fealty);
}

function hasNonDraconicAttackInHand(input: BotPolicyInput): boolean {
  return input.view.players[input.seat].hand.some((card) =>
    isAttack(input.cards[card.cardId]) && !isDraconicAttack(card, input)
  );
}

function projectedDraconicLinks(input: BotPolicyInput): number {
  const fealtyCanAddLink = (hasPendingFealty(input) || hasFealtyToken(input)) &&
    hasNonDraconicAttackInHand(input);
  return projectedNaturalDraconicLinks(input) + (fealtyCanAddLink ? 1 : 0);
}

function cindraRecoveryCost(
  input: BotPolicyInput,
  links: number = draconicChainLinks(input),
): number {
  return Math.max(0, 3 - links - draconicCostReduction(input, "activation"));
}

function attackFundingMargin(
  card: CardView,
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): number {
  const me = input.view.players[input.seat];
  const unavailableIds = new Set(excludedIds).add(card.instanceId);
  const pitch = remainingPitchValue(input, unavailableIds);
  const cost = estimatedAttackCost(card, input);
  return me.resources + pitch - cost;
}

function estimatedAttackCost(
  card: CardView,
  input: BotPolicyInput,
  includeDracoFire = true,
): number {
  const data = input.cards[card.cardId];
  let cost = isDagger(data)
    ? Math.max(0, 1 - (isDraconicCard(card, input) ? draconicCostReduction(input, "activation") : 0))
    : estimatedPlayCost(card, input);
  if (includeDracoFire && isDraconicCard(card, input) && dracoFireDiscountAvailable(input)) {
    cost -= 1;
  }
  return Math.max(0, cost);
}

function canFundAttack(
  card: CardView,
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): boolean {
  return attackFundingMargin(card, input, excludedIds) >= 0;
}

function strandedHandAttacks(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): CardView[] {
  return input.view.players[input.seat].hand.filter((card) => {
    if (excludedIds.has(card.instanceId)) return false;
    const data = input.cards[card.cardId];
    return isAttack(data) && !likelyGoAgain(card, input) &&
      canFundAttack(card, input, excludedIds);
  });
}

function consecutiveHitsBeforeCurrent(input: BotPolicyInput): number {
  const link = currentLink(input);
  if (!link) return consecutiveHits(input);
  const index = input.view.chain.findIndex((candidate) =>
    candidate.attackingCard.instanceId === link.attackingCard.instanceId
  );
  let hits = 0;
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const previous = input.view.chain[cursor]!;
    if (previous.attackingCard.owner !== input.seat || !previous.resolved || previous.hit !== true) break;
    hits++;
  }
  return hits;
}

function currentAttackHasOnHitDraw(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  if (!link || link.attackValue <= link.defenseValue) return false;
  const text = input.cards[link.attackingCard.cardId]?.text.toLowerCase() ?? "";
  return /when (?:this )?(?:attack )?hits?, draw/.test(text);
}

function isAttackAction(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  return data?.cardType === "action" && isAttack(data);
}

function maskCanStillTrigger(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  const head = me.equipment.head;
  const maskWasUsed = head && input.view.turnFacts?.players[input.seat]
    .usedOncePerTurnEffectSourceIds.includes(head.instanceId) === true;
  return equipmentHasKey(input, "head", "mask of momentum|0") &&
    me.deckCount > 0 && !maskWasUsed;
}

function currentAttackThreatensMaskDraw(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  return !!link && maskCanStillTrigger(input) &&
    isAttackAction(link.attackingCard, input) && link.attackValue > link.defenseValue &&
    consecutiveHitsBeforeCurrent(input) >= 2;
}

function flightPathActivationCost(input: BotPolicyInput): number {
  return Math.max(
    0,
    3 - draconicChainLinks(input) - draconicCostReduction(input, "activation"),
  );
}

function flightPathHasPayoff(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): boolean {
  const link = currentLink(input);
  if (!link || link.attackingCard.owner !== input.seat || link.goAgain === true ||
    !isDraconicCard(link.attackingCard, input)) return false;
  const remainingHand = input.view.players[input.seat].hand.filter((card) =>
    !excludedIds.has(card.instanceId)
  );
  const hasFundableHandAttack = remainingHand.some((card) =>
    isAttack(input.cards[card.cardId]) && canFundAttack(card, input, excludedIds)
  );
  const convertsHand = hasFundableHandAttack &&
    (remainingHand.length >= 2 || flightPathActivationCost(input) === 0);
  return convertsHand || currentAttackHasOnHitDraw(input) ||
    currentAttackThreatensMaskDraw(input);
}

function shouldUseFlightPath(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): boolean {
  return input.view.pendingDecision?.kind === "attack-reaction" &&
    flightPathHasPayoff(input, excludedIds);
}

function attackNeedsTwoDraconicLinksForGoAgain(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  return isAttack(data) && cardNeedsTwoDraconicLinksForGoAgain(data);
}

function cardNeedsTwoDraconicLinksForGoAgain(data: CardData | undefined): boolean {
  return /if you control 2 or more draconic chain links, this gets go again/i.test(data?.text ?? "");
}

function daggerEnablesTwoLinkBloodRunsDeepLine(
  intent: Extract<GameIntent, { kind: "activate-ability" }>,
  input: BotPolicyInput,
): boolean {
  const remaining = handAfterPitch(intent, input);
  const hasBloodRunsDeep = remaining.some((card) =>
    key(input.cards[card.cardId]) === CARD.bloodRunsDeep
  );
  const hasFreeSecondLink = remaining.some((card) =>
    attackNeedsTwoDraconicLinksForGoAgain(card, input) && estimatedPlayCost(card, input) === 0
  );
  return hasBloodRunsDeep && hasFreeSecondLink;
}

function daggerConvertsReactionHand(
  intent: Extract<GameIntent, { kind: "activate-ability" }>,
  input: BotPolicyInput,
): boolean {
  const spentIds = new Set(pitchIds(intent));
  const remaining = handAfterPitch(intent, input);
  const preservesAttackReaction = remaining.some((card) =>
    input.cards[card.cardId]?.cardType === "attack-reaction"
  );
  const hasNaturalContinuingAttack = remaining.some((card) => {
    const data = input.cards[card.cardId];
    return isAttack(data) && likelyGoAgain(card, input);
  });
  return preservesAttackReaction && !hasNaturalContinuingAttack &&
    strandedHandAttacks(input, spentIds).length >= 2;
}

function shouldAttackWithDagger(
  intent: Extract<GameIntent, { kind: "activate-ability" }>,
  card: CardView,
  input: BotPolicyInput,
): boolean {
  const spentIds = new Set(pitchIds(intent));
  const pitchlessDraconicAttack = spentIds.size === 0 && isDraconicCard(card, input);
  const freeFromIgniteOrArt = pitchlessDraconicAttack &&
    draconicCostReductionAvailable(input, "activation");
  if (freeFromIgniteOrArt) return true;
  if (pitchlessDraconicAttack &&
    dracoFireDiscountAvailable(input) && shouldSpendDracoFireOnDagger(input)) return true;
  if (ourChainLinks(input) !== 0) {
    const hand = input.view.players[input.seat].hand;
    // Spend the paid dagger only after every naturally continuing card has
    // been played. It then bridges the terminal half of the hand, using a
    // non-Draconic card as pitch while preserving a Draconic finisher for
    // Flight Path and the chain-link discounts.
    if (hand.some((candidate) =>
      isAttack(input.cards[candidate.cardId]) && likelyGoAgain(candidate, input)
    )) return false;
    const own = ownCards(input);
    const pitched = pitchIds(intent).flatMap((id) => {
      const candidate = own.get(id);
      return candidate ? [candidate] : [];
    });
    const preservesDraconicAttacks = pitched.every((candidate) =>
      !isDraconicAttack(candidate, input)
    );
    const hasNonDraconicPitch = pitched.some((candidate) =>
      !isDraconicCard(candidate, input)
    );
    const terminalFollowup = handAfterPitch(intent, input).some((candidate) =>
      isAttack(input.cards[candidate.cardId]) && !likelyGoAgain(candidate, input)
    );
    return hasNonDraconicPitch && preservesDraconicAttacks && terminalFollowup;
  }
  if (daggerEnablesTwoLinkBloodRunsDeepLine(intent, input)) return true;
  if (daggerConvertsReactionHand(intent, input)) return true;

  const handAttacks = handAfterPitch(intent, input).filter((candidate) =>
    isAttack(input.cards[candidate.cardId])
  );
  // A paid Kunai is worthwhile when it turns a held conditional attack into
  // the continuing second link. Other terminal attacks can then finish the
  // chain; they should not make Cindra decline the whole turn. Prefer a
  // naturally continuing opener when the original hand already contains one.
  return handAttacks.some((candidate) =>
    attackNeedsTwoDraconicLinksForGoAgain(candidate, input)
  ) && !input.view.players[input.seat].hand.some((candidate) =>
    isAttack(input.cards[candidate.cardId]) && likelyGoAgain(candidate, input)
  );
}

function fundableAttacks(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): CardView[] {
  const me = input.view.players[input.seat];
  const currentAttackerId = currentLink(input)?.attackingCard.instanceId;
  const actionAttacks = playableCards(input).filter((card) =>
    !excludedIds.has(card.instanceId) &&
    isAttack(input.cards[card.cardId]) &&
    canFundAttack(card, input, excludedIds)
  );
  const daggerAttacks = me.weapons.filter((weapon) =>
    !excludedIds.has(weapon.instanceId) &&
    weapon.instanceId !== currentAttackerId &&
    !weapon.usedAbilityIndexes?.includes(0) &&
    isDagger(input.cards[weapon.cardId]) &&
    canFundAttack(weapon, input, excludedIds)
  );
  return [...actionAttacks, ...daggerAttacks];
}

function hasFundableAttack(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): boolean {
  return fundableAttacks(input, excludedIds).length > 0;
}

function hasFundableContinuingAttack(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): boolean {
  return fundableAttacks(input, excludedIds).some((card) => {
    const data = input.cards[card.cardId];
    return isAttack(data) && likelyGoAgain(card, input);
  });
}

function attackSequenceCanContinue(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  const me = input.view.players[input.seat];
  if (link && link.attackingCard.owner !== input.seat) return false;
  const latestOwnLink = [...input.view.chain].reverse().find((candidate) =>
    candidate.attackingCard.owner === input.seat
  );
  const flightPathCanGrantGoAgain = input.legal.some((intent) => {
    if (intent.kind !== "activate-ability") return false;
    const source = Object.values(me.equipment).find((card) => card?.instanceId === intent.sourceInstanceId);
    return key(input.cards[source?.cardId ?? ""]) === CARD.dragonscalerFlightPath;
  });
  // A resolved go-again attack leaves an action point but no currentLink().
  // Keep forecasting the hand in priority windows so Cindra does not buy the
  // daggers by pitching the attack that should consume a pending Fealty.
  if (link?.goAgain !== true && latestOwnLink?.goAgain !== true &&
    me.actionPoints <= 0 && !flightPathCanGrantGoAgain) return false;

  return true;
}

function futureAttackCouldBePlayed(input: BotPolicyInput): boolean {
  if (!attackSequenceCanContinue(input)) return false;

  return hasFundableAttack(input);
}

function hasCleanActionPriority(input: BotPolicyInput): boolean {
  const decision = input.view.pendingDecision;
  const ordinaryActionWindow = input.view.phase === "action" && decision === null;
  const emptyStackPriorityWindow = decision?.kind === "priority-window";
  return input.view.stack.length === 0 && currentLink(input) === undefined &&
    (ordinaryActionWindow || emptyStackPriorityWindow);
}

function availableKunaiCount(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): number {
  const activeAttackerId = currentLink(input)?.attackingCard.instanceId;
  return input.view.players[input.seat].weapons.filter((weapon) =>
    !excludedIds.has(weapon.instanceId) &&
    weapon.instanceId !== activeAttackerId &&
    !weapon.usedAbilityIndexes?.includes(0) &&
    key(input.cards[weapon.cardId]) === CARD.kunaiOfRetribution
  ).length;
}

function availableKunai(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): boolean {
  return availableKunaiCount(input, excludedIds) > 0;
}

function oneCostDraconicAttacks(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): CardView[] {
  return playableCards(input).filter((card) =>
    !excludedIds.has(card.instanceId) &&
    isDraconicAttack(card, input) &&
    input.cards[card.cardId]?.cost === 1
  );
}

function hasZeroCostAttack(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): boolean {
  return playableCards(input).some((card) =>
    !excludedIds.has(card.instanceId) &&
    isAttack(input.cards[card.cardId]) &&
    estimatedPlayCost(card, input) === 0
  );
}

function hasZeroCostContinuingAttack(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): boolean {
  return playableCards(input).some((card) =>
    !excludedIds.has(card.instanceId) &&
    isAttack(input.cards[card.cardId]) &&
    estimatedPlayCost(card, input) === 0 &&
    likelyGoAgain(card, input)
  );
}

function shouldSpendDracoFireOnDagger(input: BotPolicyInput): boolean {
  const oneCostAttacks = oneCostDraconicAttacks(input);
  return oneCostAttacks.length === 0 || oneCostAttacks.some((card) =>
    canFundAttack(card, input) ||
    (attackFundingMargin(card, input) === -1 && canBankVestResourceWithFlick(input))
  );
}

interface DracoFireTarget {
  card: CardView;
  convertedDamage: number;
  resourceSaved: number;
}

function dracoFireTargets(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number>,
): DracoFireTarget[] {
  const me = input.view.players[input.seat];
  const candidates = [
    ...playableCards(input).filter((card) => isAttack(input.cards[card.cardId])),
    ...me.weapons.filter((card) =>
      !card.usedAbilityIndexes?.includes(0) &&
      isDagger(input.cards[card.cardId]) &&
      /\bgo again\b/i.test(input.cards[card.cardId]?.text ?? "")
    ),
  ];
  return candidates.flatMap((card) => {
    if (excludedIds.has(card.instanceId) || !isDraconicCard(card, input)) return [];
    const available = me.resources + remainingPitchValue(
      input,
      new Set([...excludedIds, card.instanceId]),
    );
    const originalCost = estimatedAttackCost(card, input, false);
    const discountedCost = Math.max(0, originalCost - 1);
    return available >= discountedCost
      ? [{
          card,
          convertedDamage: guaranteedAttackDamage(card, input, false) + 2,
          resourceSaved: originalCost - discountedCost,
        }]
      : [];
  });
}

function dracoFireConversionValue(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number>,
): number | undefined {
  if (!hasCleanActionPriority(input) || !attackSequenceCanContinue(input)) return undefined;
  // Consume the pending Draco Fire before playing another copy. With two
  // available Kunai this produces Draco, dagger, Draco, dagger instead of
  // stacking both buffs onto the first attack.
  if (dracoFireDiscountAvailable(input)) return undefined;
  // Draco is an instant, so take every free continuing link first and preserve
  // its +2 power / one-resource discount for the next Draconic attack. If the
  // remaining zero-cost attack is terminal, cash Draco into a Draconic link
  // (a Kunai is naturally a free 3-power attack) before playing that finisher.
  if (hasZeroCostContinuingAttack(input, excludedIds)) return undefined;
  const targets = dracoFireTargets(input, excludedIds);
  if (hasZeroCostAttack(input, excludedIds)) {
    const continuing = targets.filter((target) => attackCanContinueAfter(target.card, input));
    if (continuing.length === 0) return undefined;
    return Math.max(...continuing.map((target) =>
      target.convertedDamage + target.resourceSaved * 2
    ));
  }
  if (targets.length === 0) return undefined;
  return Math.max(...targets.map((target) => target.convertedDamage + target.resourceSaved * 2));
}

function legalAttackCouldBePlayed(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  const cards = playableCards(input);
  return input.legal.some((intent) => {
    const card = cardForPlayIntent(intent, input, cards);
    if (card) return isAttack(input.cards[card.cardId]);
    if (intent.kind !== "activate-ability") return false;
    const weapon = me.weapons.find((candidate) => candidate.instanceId === intent.sourceInstanceId);
    return !!weapon && isDagger(input.cards[weapon.cardId]);
  });
}

function attackCouldStillBePlayed(input: BotPolicyInput): boolean {
  if (legalAttackCouldBePlayed(input) || futureAttackCouldBePlayed(input)) return true;
  const stackedAttack = input.view.stack.find((layer) =>
    layer.seat === input.seat && layer.card && isAttack(input.cards[layer.card.cardId])
  );
  return !!stackedAttack;
}

function daggersExpectedToRemain(input: BotPolicyInput): number {
  const kunaiCommittedToChainClose = new Set(input.view.chain.flatMap((link) =>
    link.attackingCard.owner === input.seat &&
      key(input.cards[link.attackingCard.cardId]) === CARD.kunaiOfRetribution
      ? [link.attackingCard.instanceId]
      : []
  ));
  return input.view.players[input.seat].weapons.filter((weapon) => {
    if (!isDagger(input.cards[weapon.cardId])) return false;
    return !kunaiCommittedToChainClose.has(weapon.instanceId);
  }).length;
}

function hasRecoverableDagger(input: BotPolicyInput): boolean {
  return input.view.players[input.seat].graveyard.some((card) => {
    const data = input.cards[card.cardId];
    return isDagger(data) && data?.subtypes?.some((type) => type.toLowerCase() === "draconic") === true;
  });
}

function isCutThrough(data: CardData | undefined): boolean {
  return key(data).startsWith("cut through|");
}

function daggerAttackHasHit(input: BotPolicyInput): boolean {
  return input.view.chain.some((link) =>
    link.attackingCard.owner === input.seat &&
    link.hit === true &&
    isDagger(input.cards[link.attackingCard.cardId])
  );
}

function flickKnivesWasUsed(input: BotPolicyInput): boolean {
  const arms = input.view.players[input.seat].equipment.arms;
  return equipmentHasKey(input, "arms", CARD.flickKnives) &&
    arms?.usedAbilityIndexes?.includes(0) === true &&
    hasRecoverableDagger(input);
}

function cutThroughLikelyHasGoAgain(input: BotPolicyInput): boolean {
  return daggerAttackHasHit(input) || flickKnivesWasUsed(input);
}

function benefitsFromBecomingDraconic(card: CardView, input: BotPolicyInput): boolean {
  const text = input.cards[card.cardId]?.text.toLowerCase() ?? "";
  return /if (?:it|this(?: attack)?) is draconic/.test(text);
}

function fealtyEnablesRecovery(card: CardView, input: BotPolicyInput): boolean {
  if (!hasRecoverableDagger(input)) return false;
  // Forecast the Draconic attacks still held instead of looking only at the
  // current chain. Preserve Fealty when the natural cards already reach three;
  // otherwise it supplies one of the links that reduces Cindra's activation.
  return projectedNaturalDraconicLinks(input) < 3 &&
    isAttack(input.cards[card.cardId]) && !isDraconicAttack(card, input);
}

function fealtyEnablesTwoLinkAttack(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  if (ourChainLinks(input) !== 0 || !isAttack(data) || isDraconicAttack(card, input) ||
    !likelyGoAgain(card, input)) return false;
  return input.view.players[input.seat].hand.some((candidate) =>
    candidate.instanceId !== card.instanceId &&
    attackNeedsTwoDraconicLinksForGoAgain(candidate, input)
  );
}

function shouldSpendFealtyOn(card: CardView, input: BotPolicyInput): boolean {
  return isAttack(input.cards[card.cardId]) && !isDraconicAttack(card, input) &&
    (benefitsFromBecomingDraconic(card, input) || fealtyEnablesRecovery(card, input) ||
      fealtyEnablesTwoLinkAttack(card, input));
}

function playableCards(input: BotPolicyInput): CardView[] {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal, ...me.banish.filter((card) => card.playableFromSourceCardId)];
}

function legalFealtyTargets(input: BotPolicyInput): CardView[] {
  const cards = playableCards(input);
  return input.legal.flatMap((intent) => {
    const card = cardForPlayIntent(intent, input, cards);
    return card && shouldSpendFealtyOn(card, input) ? [card] : [];
  });
}

function legalContinuingDraconicCardCouldBePlayed(input: BotPolicyInput): boolean {
  const cards = playableCards(input);
  return input.legal.some((intent) => {
    const card = cardForPlayIntent(intent, input, cards);
    return !!card && isDraconicAttack(card, input) && likelyGoAgain(card, input);
  });
}

function shouldActivateFealty(input: BotPolicyInput): boolean {
  if (input.view.phase !== "action" ||
    input.view.stack.length !== 0 || input.view.pendingDecision !== null || hasPendingFealty(input)) return false;
  const targets = legalFealtyTargets(input);
  if (targets.length === 0) return false;
  const printedPayoff = targets.some((card) => benefitsFromBecomingDraconic(card, input));
  const sequencePayoff = targets.some((card) => fealtyEnablesTwoLinkAttack(card, input));
  return printedPayoff || sequencePayoff || !legalContinuingDraconicCardCouldBePlayed(input);
}

function flickKnivesNeedsRecoveredDagger(input: BotPolicyInput): boolean {
  const arms = input.view.players[input.seat].equipment.arms;
  return !!arms && equipmentHasKey(input, "arms", CARD.flickKnives) &&
    !arms.usedAbilityIndexes?.includes(0) && shouldFlickKnives(input) &&
    daggersExpectedToRemain(input) === 0;
}

function pendingDaggerSpendCouldBePlayed(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  return input.legal.some((intent) => {
    if (intent.kind === "activate-ability") {
      const source = Object.values(me.equipment).find((card) => card?.instanceId === intent.sourceInstanceId);
      return key(input.cards[source?.cardId ?? ""]) === CARD.flickKnives && shouldFlickKnives(input);
    }
    if (intent.kind !== "play-card") return false;
    const card = me.hand.find((candidate) => candidate.instanceId === intent.instanceId);
    return key(input.cards[card?.cardId ?? ""]) === CARD.throwDagger;
  });
}

function dracoKunaiLineNeedsRecovery(input: BotPolicyInput): boolean {
  if (!hasCleanActionPriority(input) || !attackSequenceCanContinue(input) || availableKunai(input)) return false;
  const me = input.view.players[input.seat];
  const dracoFire = me.hand.find((card) => key(input.cards[card.cardId]) === CARD.dracoFire);
  if (!dracoFire || !me.graveyard.some((card) =>
    key(input.cards[card.cardId]) === CARD.kunaiOfRetribution
  )) return false;
  const excludedIds = new Set([dracoFire.instanceId]);
  const recoveryCost = cindraRecoveryCost(input);
  if (daggersExpectedToRemain(input) > 0 && recoveryCost > 0) return false;
  return oneCostDraconicAttacks(input, excludedIds).some((card) =>
    attackFundingMargin(card, input, excludedIds) >= recoveryCost
  );
}

function shouldBuyDaggersNow(input: BotPolicyInput): boolean {
  if (!hasRecoverableDagger(input)) return false;
  const remainingDaggers = daggersExpectedToRemain(input);
  const recoveryIsFree = cindraRecoveryCost(input) === 0;
  // One equipped dagger is enough to keep attacking. Never spend cards or
  // floating resources merely to restore the second; recover it only when the
  // chain has made Cindra free. Paid recovery is reserved for losing both.
  if (remainingDaggers > 0 && !recoveryIsFree) return false;
  if (dracoKunaiLineNeedsRecovery(input)) return true;
  if (flickKnivesNeedsRecoveredDagger(input)) return true;
  if (attackCouldStillBePlayed(input) || pendingDaggerSpendCouldBePlayed(input)) return false;
  // Delay either recovery until the last safe window so one activation can
  // equip every dagger spent during the turn.
  return remainingDaggers === 0 || recoveryIsFree;
}

function currentAttackFullyBlocked(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  return !!link && link.attackingCard.owner === input.seat &&
    link.defenseValue >= link.attackValue;
}

function legalAncestralEmpowermentMakesCurrentAttackHit(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  if (!link || link.attackingCard.owner !== input.seat ||
    link.attackValue > link.defenseValue || link.attackValue + 1 <= link.defenseValue) return false;
  const cards = playableCards(input);
  return input.legal.some((intent) => {
    const card = cardForPlayIntent(intent, input, cards);
    return key(input.cards[card?.cardId ?? ""]) === CARD.ancestralEmpowerment;
  });
}

function ancestralEmpowermentAlreadyMadeCurrentAttackHit(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  return !!link && link.attackingCard.owner === input.seat &&
    link.attackValue > link.defenseValue && link.attackValue - 1 <= link.defenseValue &&
    link.reactions.some((reaction) =>
      key(input.cards[reaction.cardId]) === CARD.ancestralEmpowerment
    );
}

function ancestralEmpowermentIsPending(input: BotPolicyInput): boolean {
  return input.view.stack.some((layer) =>
    layer.seat === input.seat && layer.card !== null &&
    key(input.cards[layer.card.cardId]) === CARD.ancestralEmpowerment
  );
}

function visibleWardCards(input: BotPolicyInput): CardView[] {
  const opponent = input.view.players[1 - input.seat]!;
  const visibleCards = [
    ...opponent.board,
    ...opponent.weapons,
    ...Object.values(opponent.equipment).filter((card): card is CardView => card !== undefined),
  ];
  return visibleCards.filter((card) => {
    const data = input.cards[card.cardId];
    return /\bward\s+(?:[1-9]\d*|x)\b/i.test(data?.text ?? "") ||
      data?.keywords?.some((keyword) => /^ward\s+(?:[1-9]\d*|x)$/i.test(keyword)) === true;
  });
}

function opponentHasVisibleWard(input: BotPolicyInput): boolean {
  return visibleWardCards(input).length > 0;
}

function knownVisibleWardValue(card: CardView, input: BotPolicyInput): number | undefined {
  const data = input.cards[card.cardId];
  for (const keyword of data?.keywords ?? []) {
    const numeric = /^ward\s+([1-9]\d*)$/i.exec(keyword);
    if (numeric) return Number(numeric[1]);
  }
  const holoWard = /x is (\d+) if this has a holo counter[\s\S]*otherwise,?\s*x is (\d+)/i
    .exec(data?.text ?? "");
  if (!holoWard) return undefined;
  return (card.counters?.holo ?? 0) > 0 ? Number(holoWard[1]) : Number(holoWard[2]);
}

function clearingWardMakesChainLinkHit(input: BotPolicyInput): boolean {
  const wards = visibleWardCards(input);
  if (wards.length !== 1) return false;
  const ward = knownVisibleWardValue(wards[0]!, input);
  const link = currentLink(input);
  const unblockedDamage = link ? Math.max(0, link.attackValue - link.defenseValue) : 0;
  return ward !== undefined && unblockedDamage > 0 && ward >= unblockedDamage;
}

function clearingWardEnablesMaskDraw(input: BotPolicyInput): boolean {
  return currentAttackThreatensMaskDraw(input) && clearingWardMakesChainLinkHit(input);
}

function canBankVestResourceWithFlick(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  const flick = me.equipment.arms;
  return equipmentHasKey(input, "chest", CARD.bloodSplatteredVest) &&
    equipmentHasKey(input, "arms", CARD.flickKnives) &&
    !flick?.usedAbilityIndexes?.includes(0) &&
    availableKunaiCount(input) >= 2 &&
    !opponentHasVisibleWard(input);
}

function vestResourceIsNeededAfterCurrentLink(input: BotPolicyInput): boolean {
  if (!vestResourceFundsHandCard(input)) return false;
  if (hasZeroCostAttack(input)) return false;
  const dracoFireHeld = input.view.players[input.seat].hand.some((card) =>
    key(input.cards[card.cardId]) === CARD.dracoFire
  );
  return !dracoFireHeld || availableKunaiCount(input) < 2;
}

function legalThrowDaggerCouldBePlayed(input: BotPolicyInput): boolean {
  const cards = playableCards(input);
  return input.legal.some((intent) => {
    if (intent.kind !== "play-card" && intent.kind !== "play-from-arsenal") return false;
    const card = cardForPlayIntent(intent, input, cards);
    return key(input.cards[card?.cardId ?? ""]) === CARD.throwDagger;
  });
}

function flickEnablesCutThrough(input: BotPolicyInput): boolean {
  if (cutThroughLikelyHasGoAgain(input) || !futureAttackCouldBePlayed(input)) return false;
  const attacks = input.view.players[input.seat].hand.filter((card) =>
    isAttack(input.cards[card.cardId])
  );
  return attacks.some((card) => isCutThrough(input.cards[card.cardId])) &&
    attacks.filter((card) => !likelyGoAgain(card, input)).length >= 2;
}

function legalCindraRecoveryCouldBePlayed(input: BotPolicyInput): boolean {
  const heroInstanceId = input.view.players[input.seat].heroInstanceId;
  return input.legal.some((intent) =>
    intent.kind === "activate-ability" && intent.sourceInstanceId === heroInstanceId
  );
}

function legalFlickKnivesCouldBePlayed(input: BotPolicyInput): boolean {
  const armsInstanceId = input.view.players[input.seat].equipment.arms?.instanceId;
  return armsInstanceId !== undefined && input.legal.some((intent) =>
    intent.kind === "activate-ability" && intent.sourceInstanceId === armsInstanceId
  );
}

function shouldFlickKnives(input: BotPolicyInput): boolean {
  const decision = input.view.pendingDecision;
  const link = currentLink(input);
  if (decision?.kind !== "attack-reaction" || link?.attackingCard.owner !== input.seat) return false;
  // Clearing Ward converts the active attack from a miss into a hit. Always
  // take that payoff before applying the normal last-dagger and Throw Dagger
  // conservation rules.
  if (clearingWardMakesChainLinkHit(input)) return true;
  if (opponentHasVisibleWard(input)) return false;
  if (legalAncestralEmpowermentMakesCurrentAttackHit(input) ||
    ancestralEmpowermentIsPending(input) ||
    ancestralEmpowermentAlreadyMadeCurrentAttackHit(input)) return false;
  const hand = input.view.players[input.seat].hand;
  const heldDracoFireNeedsKunai = hand.some((card) =>
    key(input.cards[card.cardId]) === CARD.dracoFire
  ) && !hand.some((card) =>
    isDraconicAttack(card, input) && input.cards[card.cardId]?.cost === 1
  ) && availableKunai(input);
  if (heldDracoFireNeedsKunai) return false;
  // When recovery is already legal, spend Flick first so Cindra's single
  // activation can buy back both the graveyard dagger and the dagger Flick
  // is about to destroy. Otherwise retain the normal last-dagger guard.
  const flickBeforeRecoveryAvailable = legalFlickKnivesCouldBePlayed(input) &&
    legalCindraRecoveryCouldBePlayed(input);
  if (daggersExpectedToRemain(input) <= 1 && !flickBeforeRecoveryAvailable) {
    const opponentLife = input.view.players[1 - input.seat]!.life;
    const priorHits = consecutiveHitsBeforeCurrent(input);
    if (opponentLife >= 10 || priorHits < 1 || priorHits > 2) return false;
  }
  // Throw Dagger creates the same hit/Vest payoff without consuming Flick's
  // once-per-game equipment slot, so preserve Flick when that reaction is live.
  if (legalThrowDaggerCouldBePlayed(input)) return false;
  const vestEquipped = equipmentHasKey(input, "chest", CARD.bloodSplatteredVest);
  const flickFundsOneCostCard = vestEquipped &&
    vestResourceIsNeededAfterCurrentLink(input);
  const flickFundsFlightPath = vestEquipped &&
    vestResourceFundsFlightPath(input);
  const futureAttack = futureAttackCouldBePlayed(input);
  return currentAttackFullyBlocked(input) || flickFundsOneCostCard || flickFundsFlightPath ||
    flickEnablesCutThrough(input) || !futureAttack;
}

function likelyGoAgain(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  if (!data) return false;
  const functional = key(data);
  const links = ourChainLinks(input);
  const draconicLinks = draconicChainLinks(input);
  if (functional === CARD.artOfTheDragonBlood) {
    return isDraconicCard(card, input) || nextAttackBecomesDraconic(input);
  }
  if (functional === CARD.bloodRunsDeep) return true;
  if (functional === "blaze headlong|1") return links > 0;
  if (cardNeedsTwoDraconicLinksForGoAgain(data)) return draconicLinks >= 1;
  if (isCutThrough(data)) return cutThroughLikelyHasGoAgain(input);
  return data.keywords?.some((keyword) => keyword.toLowerCase() === "go again") === true;
}

function lavaBurstCanRupture(card: CardView, input: BotPolicyInput): boolean {
  if (key(input.cards[card.cardId]) !== CARD.lavaBurst) return false;
  const linksNeededBeforeLava = Math.max(0, 3 - ourChainLinks(input));
  if (linksNeededBeforeLava === 0) return true;
  return fundableAttacks(input, new Set([card.instanceId])).length >= linksNeededBeforeLava;
}

function cardOpportunity(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!data) return 0;
  const functional = key(data);
  if (data.cardType === "defense-reaction") return 14;
  if (functional === CARD.throwDagger) return 15;
  if (functional === CARD.ancestralEmpowerment) return 14;
  if (functional === CARD.lavaBurst && lavaBurstCanRupture(card, input)) return 40;
  if (isAttack(data)) return (data.attack ?? 0) + (likelyGoAgain(card, input) ? 6 : 2);
  if (data.cardType === "weapon") return 6;
  if (functional === CARD.dracoFire) return 7;
  return Math.max(1, data.pitch ?? 0);
}

function estimatedSequenceGoAgain(
  card: CardView,
  input: BotPolicyInput,
  linksBefore: number,
  draconicLinksBefore: number,
  daggerHasHit: boolean,
): boolean {
  const data = input.cards[card.cardId];
  if (!data) return false;
  const functional = key(data);
  if (functional === CARD.artOfTheDragonBlood) return isDraconicCard(card, input);
  if (functional === CARD.bloodRunsDeep) return true;
  if (functional === CARD.kunaiOfRetribution) return true;
  if (functional === "blaze headlong|1") return linksBefore > 0;
  if (cardNeedsTwoDraconicLinksForGoAgain(data)) return draconicLinksBefore >= 1;
  if (isCutThrough(data)) return daggerHasHit;
  return data.keywords?.some((keyword) => keyword.toLowerCase() === "go again") === true;
}

function estimatedSequenceAttack(
  card: CardView,
  input: BotPolicyInput,
  linksBefore: number,
  draconicLinksBefore: number,
  daggerHasHit: boolean,
): number {
  const data = input.cards[card.cardId];
  const functional = key(data);
  let damage = Math.max(0, card.attack ?? data?.attack ?? 0);
  if (functional === CARD.lavaBurst && linksBefore >= 3) damage += 3;
  if (functional === CARD.enflameTheFirebrand && draconicLinksBefore >= 3) damage += 2;
  if (isCutThrough(data) && daggerHasHit) damage += 1;
  return damage;
}

/** Projection-only subset search for the best sequence Cindra can actually
 * spend. With at most a hand, arsenal, and two weapons this has no more than
 * 2^8 attack subsets; terminal attacks stop the branch instead of all being
 * counted as usable damage. */
function estimateCindraDamage(cards: readonly CardView[], input: BotPolicyInput): number {
  const unique = [...new Map(cards.map((card) => [card.instanceId, card])).values()];
  const dracoFires = unique.filter((card) =>
    key(input.cards[card.cardId]) === CARD.dracoFire
  ).length;
  const attacks = unique.filter((card) => {
    const data = input.cards[card.cardId];
    return isAttack(data) || isDagger(data);
  });
  const memo = new Map<string, number>();

  function search(
    remainingMask: number,
    links: number,
    draconicLinks: number,
    daggerHasHit: boolean,
    availableDracoFires: number,
  ): number {
    const memoKey = `${remainingMask}:${links}:${draconicLinks}:${daggerHasHit ? 1 : 0}:${availableDracoFires}`;
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;
    let best = 0;
    for (let index = 0; index < attacks.length; index++) {
      if ((remainingMask & (1 << index)) === 0) continue;
      const card = attacks[index]!;
      const data = input.cards[card.cardId];
      const draconic = isDraconicCard(card, input);
      const damage = estimatedSequenceAttack(
        card,
        input,
        links,
        draconicLinks,
        daggerHasHit,
      ) + (draconic ? availableDracoFires * 2 : 0);
      const goAgain = estimatedSequenceGoAgain(
        card,
        input,
        links,
        draconicLinks,
        daggerHasHit,
      );
      const rest = goAgain
        ? search(
          remainingMask & ~(1 << index),
          links + 1,
          draconicLinks + (draconic ? 1 : 0),
          daggerHasHit || isDagger(data),
          draconic ? 0 : availableDracoFires,
        )
        : 0;
      best = Math.max(best, damage + rest);
    }
    memo.set(memoKey, best);
    return best;
  }

  const base = attacks.length === 0
    ? 0
    : search((1 << attacks.length) - 1, 0, 0, false, dracoFires);
  const reactions = unique.reduce((total, card) => {
    const functional = key(input.cards[card.cardId]);
    return total + (functional === CARD.ancestralEmpowerment ? 2 : functional === CARD.throwDagger ? 2 : 0);
  }, 0);
  return base > 0 ? base + reactions : 0;
}

function flightPathWillBeConsumedNextTurn(input: BotPolicyInput): boolean {
  if (isCindraTurn(input) ||
    !equipmentHasKey(input, "legs", CARD.dragonscalerFlightPath)) return false;
  const attacks = input.view.players[input.seat].hand.filter((card) =>
    isAttack(input.cards[card.cardId])
  );
  if (attacks.length < 4) return false;
  const draconicAttacks = attacks.filter((card) => isDraconicAttack(card, input));
  // Three natural Draconic links make Flight Path free on a terminal third
  // link, and the fourth held attack is the concrete follow-up it unlocks.
  return draconicAttacks.length >= 3 && draconicAttacks.some((card) =>
    !likelyGoAgain(card, input)
  );
}

function scoreDefend(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return scoreDefenseIntent(intent, input, own, {
    offensiveCards(policyInput) {
      const me = policyInput.view.players[policyInput.seat];
      return [...me.hand, ...me.arsenal, ...me.weapons];
    },
    evaluateResponse: (cards, policyInput) => responseEvaluation({
      damageThreatened: estimateCindraDamage(cards, policyInput),
    }),
    cardOpportunity,
    responseLossWeight: 2,
    equipmentUseIsFree(card, policyInput) {
      return key(policyInput.cards[card.cardId]) === CARD.dragonscalerFlightPath &&
        flightPathWillBeConsumedNextTurn(policyInput);
    },
    defensePermission(candidate) {
      if (candidate.lethal) return candidate.survives ? "require" : "forbid";
      if (candidate.chosen.length === 0) return "allow";
      if (candidate.chosen.every((card) => candidate.stagedIds.has(card.instanceId))) {
        return "allow";
      }
      const usesOnlyFlightPath = candidate.chosen.length === 1 &&
        key(candidate.input.cards[candidate.chosen[0]!.cardId]) === CARD.dragonscalerFlightPath &&
        flightPathWillBeConsumedNextTurn(candidate.input);
      if (usesOnlyFlightPath) return "allow";
      const me = candidate.input.view.players[candidate.input.seat];
      const handIds = new Set(me.hand.map((card) => card.instanceId));
      const usesOnlyHandCards = candidate.chosen.every((card) => handIds.has(card.instanceId));
      if (usesOnlyHandCards) {
        const offense = [...me.hand, ...me.arsenal, ...me.weapons];
        const spentIds = new Set(candidate.chosen.map((card) => card.instanceId));
        const remaining = offense.filter((card) => !spentIds.has(card.instanceId));
        if (estimateCindraDamage(remaining, candidate.input) >=
          estimateCindraDamage(offense, candidate.input)) return "allow";
      }
      if (candidate.onHit.value >= 6) return "allow";
      if (candidate.onHit.handCardsLost >= 2) return "allow";
      if (candidate.onHit.destroysOccupiedArsenal) return "allow";
      return "forbid";
    },
  });
}

function nextTurnArsenalValue(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  const functional = key(data);
  if (data?.cardType === "defense-reaction") return 220;
  if (functional === CARD.ancestralEmpowerment) return 200;
  if (functional === CARD.throwDagger) return 190;
  if (functional === CARD.lavaBurst && lavaBurstCanRupture(card, input)) return 170;
  if (isAttack(data) && likelyGoAgain(card, input)) return 130 + (data?.attack ?? 0);
  if (isAttack(data)) return 90 + (data?.attack ?? 0);
  return 20 + cardOpportunity(card, input);
}

function vestResourceFundsHandCard(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  if (!me.hand.some((card) => {
    const data = input.cards[card.cardId];
    const cost = estimatedPlayCost(card, input);
    return data?.cardType === "action" && cost > me.resources &&
      (cost <= me.resources + 1 || key(data) === CARD.bloodRunsDeep);
  })) return false;
  const link = currentLink(input);
  return link
    ? link.attackingCard.owner === input.seat && (link.goAgain === true || me.actionPoints > 0)
    : me.actionPoints > 0;
}

function vestResourceFundsDaggerRecovery(input: BotPolicyInput): boolean {
  if (!hasRecoverableDagger(input) || daggersExpectedToRemain(input) > 0) {
    return false;
  }
  // The Vest decision often occurs before the remaining attacks are played,
  // while Cindra deliberately waits until the last safe window to recover.
  // Bank the resource now when the whole hand (including a possible Fealty
  // conversion) still leaves the eventual activation underfunded.
  const recoveryCost = cindraRecoveryCost(input, projectedDraconicLinks(input));
  return recoveryCost > input.view.players[input.seat].resources;
}

function vestResourceFundsFlightPath(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  if (!equipmentHasKey(input, "legs", CARD.dragonscalerFlightPath) ||
    !flightPathHasPayoff(input)) return false;
  const cost = flightPathActivationCost(input);
  return cost > me.resources && cost <= me.resources + 1;
}

function shouldUseBloodSplatteredVest(input: BotPolicyInput): boolean {
  return vestResourceFundsHandCard(input) || vestResourceFundsDaggerRecovery(input) ||
    vestResourceFundsFlightPath(input);
}

function choiceCard(
  intent: Extract<GameIntent, { kind: "choose" }>,
  input: BotPolicyInput,
): CardView | null {
  const instanceId = Number(intent.optionId);
  return optionCard(intent, input) ??
    (Number.isFinite(instanceId) ? ownCards(input).get(instanceId) ?? null : null);
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  const card = choiceCard(intent, input);
  const data = card ? input.cards[card.cardId] : undefined;
  const prompt = decision.prompt.toLowerCase();

  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, nextTurnArsenalValue, -20);
  }
  if (prompt.includes("equip") && prompt.includes("dagger")) {
    return intent.optionId === "pass" ? -500 : isDagger(data) ? 500 : 0;
  }
  if (prompt.includes("flick knives") || prompt.includes("choose a dagger")) {
    if (!card) return -100;
    return key(data) === "claw of vynserakai|0" ? 550 : isDagger(data) ? 500 : 0;
  }
  if (prompt.includes("rising resentment")) {
    if (!card) return -100;
    // Enflame is the sequencing bridge: Rising supplies the first Draconic
    // link, then Enflame counts itself as the second and keeps the turn going.
    return key(data) === "enflame the firebrand|1" ? 800 : 100 + cardOpportunity(card, input);
  }
  if (/sink below|bottom of your deck/i.test(decision.prompt)) {
    return scoreSpendCardChoice(intent, input, cardOpportunity, 40, 0);
  }
  if (prompt.includes("banish 2 draco fire")) {
    return scoreBinaryChoice(intent.optionId, 100, -20) ?? 0;
  }
  if (prompt.includes("blood splattered vest")) {
    return scoreBinaryChoice(intent.optionId, shouldUseBloodSplatteredVest(input) ? 200 : -200, 0) ?? 0;
  }
  if (prompt.includes("discard")) {
    return scoreSpendCardChoice(intent, input, cardOpportunity, 40, -10);
  }
  const binary = scoreBinaryChoice(intent.optionId, 20, -5);
  if (binary !== undefined) return binary;
  return card ? 20 + cardOpportunity(card, input) : 1;
}

interface PlayScoreContext {
  card: CardView;
  data: CardData;
  functional: string;
  excludedIds: ReadonlySet<number>;
  hasFollowup: boolean;
  hasContinuingFollowup: boolean;
  hits: number;
  links: number;
  draconicLinks: number;
}

function scoreActivation(
  intent: Extract<GameIntent, { kind: "activate-ability" }>,
  input: BotPolicyInput,
  context: PlayScoreContext,
): number {
  const { card, data, excludedIds, functional, hasFollowup, hits, links } = context;
  if (functional === CARD.flickKnives) {
    // Flick to rescue a Mask streak, spend the final useful reaction window,
    // or turn a guaranteed dagger hit into the Vest resource that converts a
    // stranded one-cost action. Visible Ward makes none of those hits safe.
    return shouldFlickKnives(input) ? 1_200 + Math.min(links, 3) * 100 : -10_000;
  }
  if (functional === "cindra, dracai of retribution|0" || functional === "cindra|0") {
    // Recover only on Cindra's turn and after every attack and dagger-spending
    // reaction, so the once-per-turn activation can equip the whole graveyard
    // together. Recover earlier only for a concrete Flick or Draco/Kunai line.
    if (dracoKunaiLineNeedsRecovery(input)) {
      // Wait until the chain makes recovery free. Pitching either half of the
      // Draco/one-cost-attack line defeats the reason to recover the Kunai.
      return pitchIds(intent).length === 0 ? 1_700 : -10_000;
    }
    return shouldBuyDaggersNow(input) ? 950 + links * 20 : -10_000;
  }
  if (functional === CARD.fealty) {
    // Fealty is a one-shot resource, so only spend it when a legal
    // non-Draconic attack has a concrete payoff or completes the Draconic
    // link count needed to recover a dagger.
    return shouldActivateFealty(input) ? 1_300 : -10_000;
  }
  if (functional === CARD.dragonscalerFlightPath) {
    // Preserve Flight Path for hands that cannot simply arsenal one stranded
    // attack. Spend it to convert two followups, or to continue after a
    // Snatch/Mask draw. Pitchless activations outrank Flick; when one resource
    // short, Flick plus Blood Splattered Vest prepares that activation first.
    if (!shouldUseFlightPath(input, excludedIds)) return -10_000;
    return pitchIds(intent).length === 0 ? 1_600 : 1_000;
  }
  if (!isDagger(data)) return 10;
  if (!shouldAttackWithDagger(intent, card, input)) return -10_000;
  if (dracoFireDiscountAvailable(input) && shouldSpendDracoFireOnDagger(input)) {
    // When another resource can pay the held one-cost attack, cash Draco's
    // discount into a free 3-power Kunai first instead of spending it on that
    // attack. The held attack remains the followup rather than competing with
    // the empowered dagger for priority.
    return 1_300;
  }
  const conditionalFollowups = handAfterPitch(intent, input).filter((candidate) =>
    attackNeedsTwoDraconicLinksForGoAgain(candidate, input)
  ).length;
  const preservesConditionalChain = links === 0 && conditionalFollowups >= 2 &&
    !input.view.players[input.seat].hand.some((candidate) =>
      isAttack(input.cards[candidate.cardId]) && likelyGoAgain(candidate, input)
    );
  // Once Kunai is the bridge, retain multiple conditional links instead of
  // pitching one of them for the activation. This preserves sequences such as
  // Kunai, Burning Blade Dance, Burning Blade Dance, Lava Burst.
  return 180 + (hits === 1 ? 180 : hits >= 2 ? 320 : 0) +
    (hasFollowup ? 80 : 0) + (preservesConditionalChain ? 20 : 0);
}

function attackSequenceScore(
  goAgain: boolean,
  context: PlayScoreContext,
): number {
  const { data, hasContinuingFollowup, hasFollowup, hits, links } = context;
  let score = (data.attack ?? 0) * 10;
  if (hits === 1) score += 250;
  if (hits >= 2) score += 500;
  if (goAgain && hasFollowup) score += 180;
  if (!goAgain && (hasContinuingFollowup || (links === 0 && hasFollowup))) {
    score -= hits >= 2 ? 20 : 100;
  }
  return score;
}

function attackIdentityScore(
  input: BotPolicyInput,
  context: PlayScoreContext,
  goAgain: boolean,
): number {
  const {
    card,
    data,
    draconicLinks,
    excludedIds,
    functional,
    hasContinuingFollowup,
    hasFollowup,
    hits,
    links,
  } = context;
  let score = 0;
  if (functional === CARD.artOfTheDragonBlood) score += links === 0 ? 180 : 80;
  if (functional === "fire tenet: strike first|1") score += links <= 1 ? 140 : 30;
  if (functional === "ignite|1") score += links <= 1 && hasFollowup ? 90 : 10;

  const unlocksFreeBloodRunsDeep = draconicLinks === 1 &&
    input.view.players[input.seat].hand.some((held) =>
      held.instanceId !== card.instanceId && key(input.cards[held.cardId]) === CARD.bloodRunsDeep
    );
  if (cardNeedsTwoDraconicLinksForGoAgain(data) && goAgain && hasFollowup &&
    (draconicLinks >= 2 || unlocksFreeBloodRunsDeep)) {
    // These cards lose their continuation value if a terminal attack is
    // played first. Cash them in while the Draconic link threshold is active.
    score += 300;
  }
  if (functional === CARD.bloodRunsDeep) {
    const daggers = input.view.players[input.seat].weapons.filter((weapon) =>
      isDagger(input.cards[weapon.cardId])
    ).length;
    // Blood Runs Deep is the bridge from the setup links into the rest of
    // the hand. Score from total links so a non-Draconic Fire Tenet does not
    // make Snatch jump ahead of it.
    score += links >= 2 ? daggers * 90 : -80;
  }
  if (functional === CARD.lavaBurst) score += links >= 3 ? 180 : 0;
  if (functional === CARD.snatch) score += hits >= 2 ? 120 : 20;
  if (!goAgain && !hasContinuingFollowup) {
    const terminalFollowups = playableCards(input).filter((candidate) =>
      !excludedIds.has(candidate.instanceId) && isAttack(input.cards[candidate.cardId]) &&
      !likelyGoAgain(candidate, input) && canFundAttack(candidate, input, excludedIds)
    );
    const draconic = isDraconicAttack(card, input);
    if (draconic && terminalFollowups.some((candidate) => !isDraconicAttack(candidate, input))) {
      // Flight Path only targets Draconic attacks, so lead the terminal half
      // with the Draconic card and leave the non-Draconic card as its payoff.
      score += 220;
    }
    if (!draconic && terminalFollowups.some((candidate) => isDraconicAttack(candidate, input))) {
      score -= 220;
    }
  }
  return score;
}

function attackResourceScore(
  intent: GameIntent,
  input: BotPolicyInput,
  context: PlayScoreContext,
): number {
  const { card, data, draconicLinks } = context;
  let score = 0;
  if (data.cost === 1 && pitchIds(intent).length === 0 && isDraconicCard(card, input) &&
    draconicCostReductionAvailable(input, "play")) score += 120;
  if (draconicLinks === 2 && hasRecoverableDagger(input) && isDraconicAttack(card, input)) score += 160;
  if (hasPendingFealty(input) && shouldSpendFealtyOn(card, input)) score += 900;
  if (intent.kind === "play-from-arsenal") score += 15;
  return score;
}

function scoreAttack(
  intent: GameIntent,
  input: BotPolicyInput,
  context: PlayScoreContext,
): number {
  const goAgain = likelyGoAgain(context.card, input);
  return attackSequenceScore(goAgain, context) +
    attackIdentityScore(input, context, goAgain) +
    attackResourceScore(intent, input, context);
}

function scoreNonAttackCard(
  input: BotPolicyInput,
  context: PlayScoreContext,
): number {
  const { data, excludedIds, functional, hasFollowup, hits, links } = context;
  if (data.cardType === "attack-reaction") {
    const link = currentLink(input);
    if (link?.attackingCard.owner !== input.seat || input.view.pendingDecision?.kind !== "attack-reaction") {
      return -1_000;
    }
    if (functional === CARD.throwDagger) {
      if (opponentHasVisibleWard(input) && !clearingWardEnablesMaskDraw(input)) return -10_000;
      return 900 + Math.min(links, 3) * 50;
    }
    if (functional === CARD.ancestralEmpowerment) return 500 + (hits >= 1 ? 80 : 0);
    return 100;
  }
  if (data.cardType === "defense-reaction") return 500 + scoreDefenseReaction(data, input);
  if (functional === CARD.dracoFire) {
    const conversion = dracoFireConversionValue(input, excludedIds);
    return conversion === undefined ? -10_000 : 1_200 + conversion * 40;
  }
  if (functional === "oath of loyalty|1") return hasFollowup ? 160 : -100;
  if (functional === "warmonger's diplomacy|3") return 120;
  return 0;
}

function pitchOpportunityCost(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return pitchIds(intent).reduce((cost, id) => {
    const pitched = own.get(id);
    return pitched ? cost + 3 + cardOpportunity(pitched, input) : cost;
  }, 0);
}

function scorePlay(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || !data) return -100;
  if (!isCindraTurn(input) && isProactiveInstant(intent, data)) return -10_000;
  const functional = key(data);
  if (shouldPreserveOpeningHand(input) && functional !== CARD.flickKnives) return -10_000;
  if (spendsOpeningArsenalReserve(intent, input, own)) return -10_000;
  const excludedIds = new Set([card.instanceId, ...pitchIds(intent)]);
  const context: PlayScoreContext = {
    card,
    data,
    functional,
    excludedIds,
    hasFollowup: hasFundableAttack(input, excludedIds),
    hasContinuingFollowup: hasFundableContinuingAttack(input, excludedIds),
    hits: consecutiveHits(input),
    links: ourChainLinks(input),
    draconicLinks: draconicChainLinks(input),
  };
  const score = intent.kind === "activate-ability"
    ? scoreActivation(intent, input, context)
    : isAttack(data)
      ? scoreAttack(intent, input, context)
      : scoreNonAttackCard(input, context);
  return score - pitchOpportunityCost(intent, input, own);
}

interface LethalAllyAttack {
  intent: TargetableAttackIntent;
  card: CardView;
  ally: CardView;
  damage: number;
  attackAction: boolean;
}

function priorityAllies(input: BotPolicyInput): CardView[] {
  const allies = opponentAllies(input);
  const chum = allies.filter((ally) => key(input.cards[ally.cardId]) === CARD.chum);
  return chum.length > 0 ? chum : allies;
}

function guaranteedAttackDamage(
  card: CardView,
  input: BotPolicyInput,
  includeDracoFire = true,
): number {
  const data = input.cards[card.cardId];
  const functional = key(data);
  let damage = Math.max(0, card.attack ?? data?.attack ?? 0);

  // Ravenous Rabble can reveal a blue, so only two of its printed five power
  // is guaranteed before the target is announced.
  if (functional === CARD.ravenousRabble) damage = Math.max(0, damage - 3);
  if (functional === CARD.lavaBurst && ourChainLinks(input) >= 3) damage += 3;
  if (functional === CARD.enflameTheFirebrand && draconicChainLinks(input) >= 3) damage += 2;
  if (isCutThrough(data) && cutThroughLikelyHasGoAgain(input)) damage += 1;

  const willBeDraconic = isDraconicCard(card, input) || nextAttackBecomesDraconic(input);
  if (willBeDraconic) {
    for (const effect of input.view.ongoing) {
      if (effect.seat !== input.seat) continue;
      const source = key(input.cards[effect.cardId]);
      if (includeDracoFire && source === CARD.dracoFire) damage += 2;
      if (source === CARD.fireTenetStrikeFirst) damage += 1;
    }
  }
  return damage;
}

function lethalAllyAttacks(
  input: BotPolicyInput,
  allies: readonly CardView[],
): LethalAllyAttack[] {
  const own = ownCards(input);
  const targets = new Map(allies.map((ally) => [ally.instanceId, ally]));
  return input.legal.flatMap((intent) => {
    if (!targetableAttackIntent(intent) || intent.targetAllyId === undefined) return [];
    const ally = targets.get(intent.targetAllyId);
    const card = intentCard(intent, own);
    if (!ally || !card) return [];
    const data = input.cards[card.cardId];
    const attackAction = isAttack(data);
    if (!attackAction && data?.cardType !== "weapon") return [];
    const damage = guaranteedAttackDamage(card, input);
    return damage >= allyLethalThreshold(ally, input)
      ? [{ intent, card, ally, damage, attackAction }]
      : [];
  });
}

function matchingHeroAttack(
  input: BotPolicyInput,
  intent: TargetableAttackIntent,
): TargetableAttackIntent | undefined {
  const variant = attackIntentVariantKey(intent);
  return input.legal.find((candidate): candidate is TargetableAttackIntent =>
    targetableAttackIntent(candidate) && candidate.targetAllyId === undefined &&
    attackIntentVariantKey(candidate) === variant
  );
}

function preferredLethalAllyAttack(
  input: BotPolicyInput,
  options: readonly LethalAllyAttack[],
  selected: TargetableAttackIntent,
  preferSelected = true,
): GameIntent | undefined {
  if (preferSelected) {
    const selectedVariant = attackIntentVariantKey(selected);
    const matching = options.find((option) =>
      attackIntentVariantKey(option.intent) === selectedVariant
    );
    if (matching) return matching.intent;
  }

  const minimumDamage = Math.min(...options.map((option) => option.damage));
  const smallest = options.filter((option) => option.damage === minimumDamage);
  return preferredPitchIntents(smallest.map((option) => option.intent), input)[0];
}

function attackCanContinueAfter(
  card: CardView,
  input: BotPolicyInput,
): boolean {
  const data = input.cards[card.cardId];
  return input.view.players[input.seat].actionPoints > 1 || isDagger(data) ||
    likelyGoAgain(card, input);
}

function hasLethalAllyFollowup(
  intent: TargetableAttackIntent,
  card: CardView,
  input: BotPolicyInput,
  allies: readonly CardView[],
): boolean {
  if (!attackCanContinueAfter(card, input)) return false;
  const excludedIds = new Set(pitchIds(intent));
  excludedIds.add(card.instanceId);
  return fundableAttacks(input, excludedIds).some((followup) =>
    allies.some((ally) =>
      guaranteedAttackDamage(followup, input) >= allyLethalThreshold(ally, input)
    )
  );
}

function cumulativeLethalAllyAttacks(
  input: BotPolicyInput,
  allies: readonly CardView[],
): LethalAllyAttack[] {
  const own = ownCards(input);
  const targets = new Map(allies.map((ally) => [ally.instanceId, ally]));
  return input.legal.flatMap((intent) => {
    if (!targetableAttackIntent(intent) || intent.targetAllyId === undefined) return [];
    const ally = targets.get(intent.targetAllyId);
    const card = intentCard(intent, own);
    if (!ally || !card) return [];
    const data = input.cards[card.cardId];
    const attackAction = isAttack(data);
    if (!attackAction && data?.cardType !== "weapon") return [];
    const damage = guaranteedAttackDamage(card, input);
    if (damage >= allyLethalThreshold(ally, input)) {
      return [{ intent, card, ally, damage, attackAction }];
    }
    if (!attackCanContinueAfter(card, input)) return [];
    const excludedIds = new Set([...pitchIds(intent), card.instanceId]);
    const resources = resourcesAfterCost(
      intent,
      estimatedAttackCost(card, input),
      input,
      own,
    );
    const dracoFireWasConsumed = dracoFireDiscountAvailable(input) && isDraconicCard(card, input);
    const followupDamage = fundableAttacks(input, excludedIds).reduce(
      (best, followup) => {
        const followupExcludedIds = new Set([...excludedIds, followup.instanceId]);
        const available = resources + remainingPitchValue(input, followupExcludedIds);
        const cost = estimatedAttackCost(followup, input, !dracoFireWasConsumed);
        return available < cost
          ? best
          : Math.max(best, guaranteedAttackDamage(followup, input, !dracoFireWasConsumed));
      },
      0,
    );
    return damage + followupDamage >= allyLethalThreshold(ally, input)
      ? [{ intent, card, ally, damage, attackAction }]
      : [];
  });
}

function enforceCindraAllyPolicy(input: BotPolicyInput, selected: GameIntent): GameIntent {
  const allies = priorityAllies(input);
  if (allies.length === 0 || !targetableAttackIntent(selected)) return selected;

  const own = ownCards(input);
  const selectedCard = intentCard(selected, own);
  if (!selectedCard) return selected;
  const selectedData = input.cards[selectedCard.cardId];
  if (!isAttack(selectedData) && selectedData?.cardType !== "weapon") return selected;

  const lethal = lethalAllyAttacks(input, allies);
  const heroAttack = matchingHeroAttack(input, selected);
  const chumIsPresent = allies.some((ally) => key(input.cards[ally.cardId]) === CARD.chum);
  if (chumIsPresent) {
    const cumulativeLethal = cumulativeLethalAllyAttacks(input, allies);
    if (cumulativeLethal.length > 0) {
      return preferredLethalAllyAttack(input, cumulativeLethal, selected) ?? selected;
    }
    return heroAttack ?? input.legal.find((intent) => intent.kind === "pass") ?? selected;
  }
  if (lethal.length === 0) {
    // Chip damage disappears in the end phase. Keep the attack on the hero, or
    // decline it when a mandatory ally target makes a lethal attack impossible.
    return heroAttack ?? input.legal.find((intent) => intent.kind === "pass") ?? selected;
  }

  const maskWindow = maskCanStillTrigger(input) && consecutiveHits(input) >= 2;
  if (maskWindow) {
    const actionAttacks = lethal.filter((option) => option.attackAction);
    if (actionAttacks.length > 0) {
      return preferredLethalAllyAttack(input, actionAttacks, selected, false) ?? selected;
    }
  }

  if (hasLethalAllyFollowup(selected, selectedCard, input, allies)) {
    return heroAttack ?? selected;
  }

  return preferredLethalAllyAttack(input, lethal, selected, false) ?? selected;
}

function chooseCindraReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: nextTurnArsenalValue,
  });
}

function recoveryBeforeClosingChain(
  input: BotPolicyInput,
  selected: GameIntent,
): GameIntent | undefined {
  if ((selected.kind !== "close-chain" && selected.kind !== "pass") ||
    !isCindraTurn(input) || input.view.phase !== "action" ||
    input.view.stack.length !== 0 || input.view.pendingDecision !== null ||
    input.view.chain.length === 0 || currentLink(input) !== undefined ||
    daggersExpectedToRemain(input) !== 1 || !hasRecoverableDagger(input) ||
    cindraRecoveryCost(input) !== 0) {
    return undefined;
  }
  // A merely legal extra attack can make the ordinary recovery score wait,
  // even when the policy has decided that attack is not worth taking. Once
  // the selected intent would end the chain, take a free second dagger before
  // the Draconic discounts disappear. Never override damage or spend a card
  // merely to restore the second dagger.
  const recoveries = preferredPitchIntents(input.legal.filter((intent): intent is Extract<
    GameIntent,
    { kind: "activate-ability" }
  > => intent.kind === "activate-ability" &&
    intent.sourceInstanceId === input.view.players[input.seat].heroInstanceId), input);
  const own = ownCards(input);
  return recoveries.reduce<(typeof recoveries)[number] | undefined>((best, candidate) =>
    !best || pitchOpportunityCost(candidate, input, own) < pitchOpportunityCost(best, input, own)
      ? candidate
      : best, undefined);
}

const CINDRA_MAX_SEARCH_NODES = 6;
const CINDRA_MAX_ROOT_CANDIDATES = 6;
const CINDRA_MAX_TRANSITIONS = 24;
const CINDRA_MAX_FORCED_STEPS = 48;

function cindraTacticalConfig(): TacticalIntentConfig {
  return {
    chooseForced: (forced) => chooseCindraReactiveIntent({ ...forced, state: undefined }),
    cardOpportunity,
    nextTurnArsenal: nextTurnArsenalValue,
    estimateRemaining: estimateCindraDamage,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    rootScore: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    maxSearchNodes: CINDRA_MAX_SEARCH_NODES,
    maxRootCandidates: CINDRA_MAX_ROOT_CANDIDATES,
    maxTransitions: CINDRA_MAX_TRANSITIONS,
    maxForcedSteps: CINDRA_MAX_FORCED_STEPS,
    recordCheckpoints: true,
  };
}

function finalizeCindraIntent(input: BotPolicyInput, selected: GameIntent): GameIntent {
  const recovery = recoveryBeforeClosingChain(input, selected);
  return enforceCindraAllyPolicy(input, enforceSpectraPolicy(input, recovery ?? selected));
}

export interface CindraIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
}

/** Full Cindra decision with a speculative no-response continuation trace for
 * the server's local, exactly validated cache. */
export function chooseCindraIntentWithTrace(input: BotPolicyInput): CindraIntentDecision {
  const reactive = chooseCindraReactiveIntent(input);
  const decision = chooseTacticalIntentWithTrace(input, reactive, cindraTacticalConfig());
  const intent = finalizeCindraIntent(input, decision.intent);
  return decision.plan ? { intent, plan: decision.plan } : { intent };
}

/** Reapply the cheap root guardrails before accepting a cached planner step.
 * This intentionally skips rollout but never bypasses Cindra's tactical,
 * Spectra, or ally-target discipline. */
export function chooseCindraContinuationIntent(
  input: BotPolicyInput,
  proposed: GameIntent,
): GameIntent {
  const reactive = chooseCindraReactiveIntent(input);
  const config = cindraTacticalConfig();
  const selected = config.rootScore(proposed, input) >= config.rootScore(reactive, input)
    ? proposed
    : reactive;
  return finalizeCindraIntent(input, selected);
}

/**
 * Deterministic Head Jabs policy: protect the offensive hand, build three
 * consecutive hits for Mask, reserve Flick Knives for a blocked Mask link or
 * the turn's final attack window, and use bounded rollout on clean turns.
 */
export function chooseCindraIntent(input: BotPolicyInput): GameIntent {
  return chooseCindraIntentWithTrace(input).intent;
}
