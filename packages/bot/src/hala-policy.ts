import type { GameState } from "@fyendal/engine";
import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  defaultCardRoles,
  hasCardRole,
  type CardRoleTag,
  type CardRoles,
} from "./card-roles.js";
import {
  attackIntentVariantKey,
  allyLethalThreshold,
  chooseScoredIntent,
  committedEffectAmount,
  currentLink,
  effectIsCommitted,
  enforceSpectraPolicy,
  functionalKey as key,
  hasSmallerLethalAllyFollowup,
  incomingAttackDamage,
  intentCard,
  isAttack,
  isOpeningTurn,
  isOpeningTurnDefense,
  opponentDamageEffectOnStack,
  optionCard,
  opponentAllies,
  ownCards,
  pitchIds,
  preferredPitchIntents,
  remainingPitchValue,
  resourcePaymentPitchIds,
  resourcesAfterCost,
  responseEvaluation,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  targetableAttackIntent,
  visibleOpponentDamageAmount,
  type BotPolicyInput,
  type TargetableAttackIntent,
} from "./policy.js";
import { adjustValueBreakdown } from "./value.js";
import {
  evaluateOpponentResponse,
  evaluateTurnFuture,
  planTurn,
  responseWeightedDamage,
  type TurnPlan,
  type TurnPlannerRoot,
} from "./turn-planner.js";

const CHUM = "chum, friendly first mate|2";
const SAWBONES = "sawbones, dock hand|2";

function weaponAttacksThisTurn(input: BotPolicyInput): number {
  const projected = input.view.turnFacts?.players[input.seat].weaponAttacks;
  if (projected !== undefined) return projected;
  return input.view.chain.filter((link) =>
    link.attackingCard.owner === input.seat &&
    input.cards[link.attackingCard.cardId]?.cardType === "weapon"
  ).length;
}

function zenithBlade(input: BotPolicyInput): CardView | undefined {
  return input.view.players[input.seat].weapons.find((card) =>
    key(input.cards[card.cardId]) === "zenith blade|0"
  );
}

function sharpenCount(input: BotPolicyInput): number {
  return Number(zenithBlade(input)?.counters?.power ?? 0);
}

function sharpenedThisTurn(input: BotPolicyInput): boolean {
  return Number(zenithBlade(input)?.counters?.sharpenedTurn ?? 0) === input.view.turn;
}

function hasPathIntoYellowEdict(input: BotPolicyInput): boolean {
  const cards = [
    ...input.view.players[input.seat].hand,
    ...input.view.players[input.seat].arsenal,
  ];
  const hasPath = cards.some((card) =>
    key(input.cards[card.cardId]).startsWith("swordmaster's path|")
  ) || input.view.ongoing.some((effect) =>
    effect.seat === input.seat &&
    key(input.cards[effect.cardId]).startsWith("swordmaster's path|")
  );
  return hasPath && cards.some((card) => key(input.cards[card.cardId]) === "edict of steel|2");
}

function hasFlurry(input: BotPolicyInput): boolean {
  return input.view.players[input.seat].board.some((card) =>
    key(input.cards[card.cardId]) === "flurry|0"
  );
}

function createsFlurry(data: CardData | undefined): boolean {
  return /\bcreates? (?:a )?flurry token\b/i.test(data?.text ?? "");
}

function grantsDirectSwordAttack(data: CardData | undefined): boolean {
  const text = data?.text ?? "";
  return /\battack with target (?:attacking )?sword\b/i.test(text) ||
    /\battack with it(?: an additional time\b|[."])/i.test(text);
}

function extendsSwordTurn(data: CardData | undefined): boolean {
  return createsFlurry(data) || grantsDirectSwordAttack(data);
}

function doublesNextSharpen(data: CardData | undefined): boolean {
  return /next time you would sharpen[^.]*sharpen it an additional time/i.test(data?.text ?? "");
}

function hasPotentialAdditionalSwordAttack(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): boolean {
  if (hasFlurry(input)) return true;
  const me = input.view.players[input.seat];
  if ([...me.hand, ...me.arsenal].some((card) =>
    !excludedIds.has(card.instanceId) && extendsSwordTurn(input.cards[card.cardId])
  )) return true;
  if (input.view.ongoing.some((effect) =>
    effect.seat === input.seat && extendsSwordTurn(input.cards[effect.cardId])
  )) return true;
  if (input.view.stack.some((layer) =>
    layer.seat === input.seat && layer.card && !excludedIds.has(layer.card.instanceId) &&
    extendsSwordTurn(input.cards[layer.card.cardId])
  )) return true;
  return (currentLink(input)?.reactions ?? []).some((card) =>
    card.owner === input.seat && !excludedIds.has(card.instanceId) &&
    extendsSwordTurn(input.cards[card.cardId])
  );
}

/** Flurry's strategic value is the second Zenith attack it unlocks. Before
 * the token exists, reserve that conversion whenever a visible or committed
 * effect can still supply the additional attack. */
function plannedZenithSwings(
  input: BotPolicyInput,
  excludedIds: ReadonlySet<number> = new Set(),
): 1 | 2 {
  return hasPotentialAdditionalSwordAttack(input, excludedIds) ? 2 : 1;
}

function zenithCanAttackAgain(input: BotPolicyInput): boolean {
  const weapon = zenithBlade(input);
  const link = currentLink(input);
  const returnsActionPoint = link?.goAgain === true ||
    Number(link?.attackingCard.counters?.sharpenedTurn ?? 0) === input.view.turn;
  return weaponAttacksThisTurn(input) === 1 &&
    weapon !== undefined &&
    !weapon.usedAbilityIndexes?.includes(0) &&
    link?.attackingCard.instanceId === weapon.instanceId &&
    returnsActionPoint;
}

function currentAttackIsOurWeapon(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  return !!link && link.attackingCard.owner === input.seat &&
    input.cards[link.attackingCard.cardId]?.cardType === "weapon";
}

function currentAttackHits(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  return !!link && link.attackValue > link.defenseValue;
}

function rippleAwayIsCommitted(input: BotPolicyInput): boolean {
  return effectIsCommitted(input, "ripple away|3");
}

function handConvertsAfterRipple(input: BotPolicyInput, rippleId: number): boolean {
  const me = input.view.players[input.seat];
  const hasPitch = me.hand.some((card) =>
    card.instanceId !== rippleId && Number(input.cards[card.cardId]?.pitch ?? 0) > 0
  );
  const hasVigor = me.board.some((card) => key(input.cards[card.cardId]) === "vigor|0");
  return zenithBlade(input) !== undefined && (hasPitch || hasVigor);
}

function hasDeterministicTokenCreation(text: string): boolean {
  return text.split(/[.\n]/).some((sentence) => {
    const normalized = sentence.trim().toLowerCase();
    return /\bcreate\b.*\btoken/.test(normalized) &&
      !/\b(if|when|whenever|may|unless|wager|winner|hit|clash)\b/.test(normalized);
  });
}

/** Only trade Ripple for a known opponent action-card token effect. Wagers
 * are deliberately excluded, even when their source is an action card. */
function shouldActivateRippleAway(input: BotPolicyInput, rippleId: number): boolean {
  if (rippleAwayIsCommitted(input) || !handConvertsAfterRipple(input, rippleId)) return false;
  if (input.view.stack.some((layer) => layer.label.toLowerCase().startsWith("resolve wager:"))) {
    return false;
  }
  const layer = input.view.stack[0];
  if (!layer?.card || layer.seat === input.seat) return false;
  const source = input.cards[layer.card.cardId];
  return source?.cardType === "action" && hasDeterministicTokenCreation(source.text);
}

function toeTheLinePreventionCommitted(input: BotPolicyInput): number {
  return committedEffectAmount(
    input,
    "toe the line|1",
    2,
    (label) => Number(/prevent next (\d+) damage/i.exec(label)?.[1] ?? 2),
  );
}

function shouldPlayToeTheLine(input: BotPolicyInput): boolean {
  const committed = toeTheLinePreventionCommitted(input);
  const link = currentLink(input);
  if (link && link.attackingCard.owner !== input.seat) {
    return input.view.pendingDecision?.kind === "defense-reaction" &&
      incomingAttackDamage(input) > committed;
  }
  if (!opponentDamageEffectOnStack(input)) return false;
  if (committed === 0) return true;
  const damage = visibleOpponentDamageAmount(input);
  return damage !== undefined && damage > committed;
}

function resourcesAfter(
  intent: GameIntent,
  data: CardData,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const functional = key(data);
  const cost = intent.kind === "activate-ability"
    ? data.cardType === "weapon"
      ? 1
      : functional === "hala, bladesaint of the vow|0" || functional === "hala|0"
      ? 3
      : 0
    : (data.cost ?? 0);
  return resourcesAfterCost(intent, cost, input, own);
}

function canFundZenithAfterPlay(
  intent: GameIntent,
  card: CardView,
  data: CardData,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  if (zenithBlade(input) === undefined) return false;
  if (resourcesAfter(intent, data, input, own) >= 1) return true;
  const spent = new Set([card.instanceId, ...pitchIds(intent)]);
  return input.view.players[input.seat].hand.some((candidate) =>
    !spent.has(candidate.instanceId) && Number(input.cards[candidate.cardId]?.pitch ?? 0) > 0
  );
}

function canSequenceHalaBeforeDrawn(
  intent: GameIntent,
  data: CardData,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  if (
    sharpenCount(input) > 0 ||
    hasPathIntoYellowEdict(input) ||
    !hasCard(input, new Set(["drawn to the blade|2"]))
  ) return false;
  const drawnInHand = input.view.players[input.seat].hand.find((candidate) =>
    key(input.cards[candidate.cardId]) === "drawn to the blade|2"
  );
  const excluded = new Set([
    ...pitchIds(intent),
    ...(drawnInHand ? [drawnInHand.instanceId] : []),
  ]);
  const available = resourcesAfter(intent, data, input, own) + remainingPitchValue(input, excluded);
  return available >= plannedZenithSwings(input, excluded);
}

function canSequenceHalaBeforeEdict(
  intent: GameIntent,
  data: CardData,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  if (hasPathIntoYellowEdict(input)) return false;
  const edict = [...input.view.players[input.seat].hand, ...input.view.players[input.seat].arsenal]
    .find((candidate) => key(input.cards[candidate.cardId]).startsWith("edict of steel|"));
  if (!edict || pitchIds(intent).includes(edict.instanceId)) return false;
  const edictData = input.cards[edict.cardId];
  if (!edictData) return false;
  const threshold = Number(edictData.pitch ?? 1);
  const edictAlreadyMakesFlurry = sharpenCount(input) + 1 >= threshold;
  if (edictAlreadyMakesFlurry && !hasFlurry(input)) return false;
  if (edictAlreadyMakesFlurry) {
    // With Flurry already present, retain the established Vigor line: Hala
    // first only when it leaves the weapon's first activation floating.
    return resourcesAfter(intent, data, input, own) >= 1;
  }
  const excluded = new Set([...pitchIds(intent), edict.instanceId]);
  const available = resourcesAfter(intent, data, input, own) + remainingPitchValue(input, excluded);
  const rerebrace = Object.values(input.view.players[input.seat].equipment).some((card) =>
    key(input.cards[card?.cardId ?? ""]) === "reverent rerebrace|0"
  );
  const countersWithoutRerebrace = sharpenCount(input) + 2;
  // Hala and Edict each sharpen once. Rerebrace is necessary only when its
  // one additional counter is what crosses Edict's threshold.
  const rerebraceExtra = rerebrace && countersWithoutRerebrace < threshold &&
    countersWithoutRerebrace + 1 >= threshold
    ? 1
    : 0;
  const countersAfterEdict = countersWithoutRerebrace + rerebraceExtra;
  const createsFlurry = countersAfterEdict >= threshold;
  const swings = hasFlurry(input) || createsFlurry ? 2 : 1;
  return available >= rerebraceExtra + swings;
}

function canSequenceHalaBeforeAndAgain(
  intent: GameIntent,
  data: CardData,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  if (sharpenedThisTurn(input) || zenithBlade(input) === undefined) return false;
  const andAgain = [...input.view.players[input.seat].hand, ...input.view.players[input.seat].arsenal]
    .find((candidate) => key(input.cards[candidate.cardId]) === "and again...|3");
  if (!andAgain || pitchIds(intent).includes(andAgain.instanceId)) return false;
  const excluded = new Set([...pitchIds(intent), andAgain.instanceId]);
  const available = resourcesAfter(intent, data, input, own) + remainingPitchValue(input, excluded);
  // One resource activates Zenith; one plays And Again after the sharpened
  // first attack returns the action point. A blue can fund both costs.
  return available >= 2;
}

function worthwhileTwoCostAttack(input: BotPolicyInput): CardView | undefined {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal].find((card) => {
    const data = input.cards[card.cardId];
    return isAttack(data) && Number(data?.cost ?? 0) === 2 && Number(data?.attack ?? 0) >= 5;
  });
}

function twoCostAttackFloatingReserve(input: BotPolicyInput): number {
  const attack = worthwhileTwoCostAttack(input);
  if (!attack) return 0;
  const pitch = remainingPitchValue(input, new Set([attack.instanceId]));
  return Math.max(0, Number(input.cards[attack.cardId]?.cost ?? 0) - pitch);
}

/** With a meaningful two-cost attack available, establish sword go again
 * with a red or yellow sharpen before committing resources to either attack. */
function setupForSwordThenTwoCostAttackIntent(input: BotPolicyInput): GameIntent | undefined {
  if (sharpenedThisTurn(input) || weaponAttacksThisTurn(input) > 0 || zenithBlade(input) === undefined) {
    return undefined;
  }
  const attack = worthwhileTwoCostAttack(input);
  if (!attack) return undefined;
  const own = ownCards(input);
  const candidates = preferredPitchIntents(input.legal.filter((intent) => {
    if (intent.kind !== "play-card" && intent.kind !== "play-from-arsenal") return false;
    const card = intentCard(intent, own);
    const data = card ? input.cards[card.cardId] : undefined;
    if (!card || !data || isAttack(data) || Number(data.pitch ?? 0) > 2 ||
      !/\bsharpen target sword\b/i.test(data.text) ||
      !/\bgo again\b/i.test(data.text) ||
      pitchIds(intent).includes(attack.instanceId)) return false;
    const excluded = new Set([card.instanceId, attack.instanceId, ...pitchIds(intent)]);
    return resourcesAfter(intent, data, input, own) + remainingPitchValue(input, excluded) >= 3;
  }), input, own);
  const ordered = candidates.sort((left, right) => {
    const leftCard = intentCard(left, own)!;
    const rightCard = intentCard(right, own)!;
    const leftData = input.cards[leftCard.cardId]!;
    const rightData = input.cards[rightCard.cardId]!;
    return setupScore(key(rightData), rightData, input) - pitchRoleCost(right, input) -
      (setupScore(key(leftData), leftData, input) - pitchRoleCost(left, input));
  });
  return ordered.find((intent) => {
    const card = intentCard(intent, own);
    return key(input.cards[card?.cardId ?? ""]) === "brimming blade|1";
  }) ?? ordered[0];
}

function drawnAfterBrimmingIntent(input: BotPolicyInput): GameIntent | undefined {
  if (sharpenCount(input) < 2 || weaponAttacksThisTurn(input) > 0 ||
    worthwhileTwoCostAttack(input) === undefined) return undefined;
  const own = ownCards(input);
  return input.legal.find((intent) => {
    if (intent.kind !== "play-card" && intent.kind !== "play-from-arsenal") return false;
    const card = intentCard(intent, own);
    return key(input.cards[card?.cardId ?? ""]) === "drawn to the blade|2" &&
      pitchIds(intent).length === 0;
  });
}

function drawnOnHitReady(input: BotPolicyInput): boolean {
  return input.view.ongoing.some((effect) =>
    effect.seat === input.seat && key(input.cards[effect.cardId]) === "drawn to the blade|2" &&
    /\bdraw\b/i.test(effect.label)
  );
}

/** A sharpened first Zenith attack has go again. Preserve enough visible
 * resources to follow it with the held two-cost attack. */
function swordBeforeTwoCostAttackIntent(input: BotPolicyInput): GameIntent | undefined {
  if (!sharpenedThisTurn(input) || weaponAttacksThisTurn(input) > 0) return undefined;
  const attack = worthwhileTwoCostAttack(input);
  const blade = zenithBlade(input);
  if (!attack || !blade) return undefined;
  const data = input.cards[blade.cardId];
  const own = ownCards(input);
  const candidates = preferredPitchIntents(input.legal.filter((intent) => {
    if (intent.kind !== "activate-ability" || intent.sourceInstanceId !== blade.instanceId ||
      pitchIds(intent).includes(attack.instanceId)) return false;
    const excluded = new Set([attack.instanceId, ...pitchIds(intent)]);
    const expectedDrawResource = drawnOnHitReady(input) ? 1 : 0;
    return resourcesAfter(intent, data!, input, own) + remainingPitchValue(input, excluded) +
      expectedDrawResource >= 2;
  }), input, own);
  return candidates.reduce<GameIntent | undefined>((best, intent) =>
    !best || pitchRoleCost(intent, input) < pitchRoleCost(best, input) ? intent : best, undefined);
}

/** Once the first Zenith attack returns its action point, cash in the held
 * two-cost attack before spending its payment on another sharpen effect. */
function twoCostAttackAfterSwordIntent(input: BotPolicyInput): GameIntent | undefined {
  if (weaponAttacksThisTurn(input) < 1 || input.view.players[input.seat].actionPoints < 1) {
    return undefined;
  }
  const attack = worthwhileTwoCostAttack(input);
  if (!attack) return undefined;
  const own = ownCards(input);
  const candidates = preferredPitchIntents(input.legal.filter((intent) =>
    (intent.kind === "play-card" || intent.kind === "play-from-arsenal") &&
    intent.instanceId === attack.instanceId
  ), input, own);
  return candidates.reduce<GameIntent | undefined>((best, intent) =>
    !best || pitchRoleCost(intent, input) < pitchRoleCost(best, input) ? intent : best, undefined);
}

function isPreferredPreSwordSharpener(data: CardData | undefined): boolean {
  return data?.cardType === "action" && !isAttack(data) && Number(data.pitch ?? 0) <= 2 &&
    /\bsharpen target sword\b/i.test(data.text) && /\bgo again\b/i.test(data.text);
}

function isHalaAbilityIntent(intent: GameIntent, input: BotPolicyInput): boolean {
  if (intent.kind !== "activate-ability") return false;
  const source = intentCard(intent, ownCards(input));
  const functional = source ? key(input.cards[source.cardId]) : "";
  return functional === "hala, bladesaint of the vow|0" || functional === "hala|0";
}

function halaBeforeThresholdSetupIntent(input: BotPolicyInput): GameIntent | undefined {
  if (weaponAttacksThisTurn(input) > 0) return undefined;
  const visible = [
    ...input.view.players[input.seat].hand,
    ...input.view.players[input.seat].arsenal,
  ];
  if (!visible.some((card) => isPreferredPreSwordSharpener(input.cards[card.cardId]))) {
    return undefined;
  }
  const own = ownCards(input);
  const candidates = input.legal.filter((intent) => {
    if (!isHalaAbilityIntent(intent, input)) return false;
    const source = intentCard(intent, own);
    const data = source ? input.cards[source.cardId] : undefined;
    return !!data && (
      canSequenceHalaBeforeDrawn(intent, data, input, own) ||
      (!hasFlurry(input) && canSequenceHalaBeforeEdict(intent, data, input, own))
    );
  });
  return preferredPitchIntents(candidates, input, own)[0];
}

/** Red and yellow sharpen actions are a pre-combat package. When the whole
 * package and the first Zenith activation are fundable, play every card in
 * that package before exposing the first weapon attack to the planner. Blue
 * sharpen cards remain available as pitch. */
function preFirstSwordSharpenIntent(input: BotPolicyInput): GameIntent | undefined {
  const me = input.view.players[input.seat];
  if (weaponAttacksThisTurn(input) > 0 || me.actionPoints < 1 || zenithBlade(input) === undefined) {
    return undefined;
  }
  const sharpeners = [...me.hand, ...me.arsenal].filter((card) =>
    isPreferredPreSwordSharpener(input.cards[card.cardId])
  );
  if (sharpeners.length === 0) return undefined;

  const sharpenerIds = new Set(sharpeners.map((card) => card.instanceId));
  const own = ownCards(input);
  const candidates = preferredPitchIntents(input.legal.filter((intent) => {
    if (intent.kind !== "play-card" && intent.kind !== "play-from-arsenal") return false;
    const card = intentCard(intent, own);
    if (!card || !sharpenerIds.has(card.instanceId) ||
      pitchIds(intent).some((id) => sharpenerIds.has(id))) return false;
    const data = input.cards[card.cardId]!;
    const remainingSetupCost = sharpeners.reduce((total, sharpener) =>
      total + (sharpener.instanceId === card.instanceId
        ? 0
        : Number(input.cards[sharpener.cardId]?.cost ?? 0)), 0);
    const excluded = new Set([...sharpenerIds, ...pitchIds(intent)]);
    const available = resourcesAfter(intent, data, input, own) +
      remainingPitchValue(input, excluded);
    return available >= remainingSetupCost + 1;
  }), input, own);
  return candidates.sort((left, right) => {
    const leftCard = intentCard(left, own)!;
    const rightCard = intentCard(right, own)!;
    const leftData = input.cards[leftCard.cardId]!;
    const rightData = input.cards[rightCard.cardId]!;
    const leftBrimming = key(leftData) === "brimming blade|1" ? 1 : 0;
    const rightBrimming = key(rightData) === "brimming blade|1" ? 1 : 0;
    return rightBrimming - leftBrimming ||
      setupScore(key(rightData), rightData, input) - setupScore(key(leftData), leftData, input) ||
      pitchRoleCost(left, input) - pitchRoleCost(right, input);
  })[0];
}

/** Priority allies justify interrupting the turn plan. An ordinary ally only
 * gets this shortcut when an exact or one-over Zenith swing clears the whole
 * opposing board; otherwise let the planner build Hala's damage line first. */
function lethalAllySwordIntent(input: BotPolicyInput): GameIntent | undefined {
  const me = input.view.players[input.seat];
  const blade = zenithBlade(input);
  if (!blade || me.actionPoints < 1) return undefined;
  const damage = projectedAttackDamage(blade, input);
  const allTargets = halaAllyTargets(input);
  const targets = allTargets.filter((target) =>
    damage >= target.life && (
      target.functional === CHUM || target.functional === SAWBONES ||
      (allTargets.length === 1 && damage - target.life <= 1)
    )
  );
  if (targets.length === 0) return undefined;
  const targetById = new Map(targets.map((target) => [target.instanceId, target]));
  const candidates = preferredPitchIntents(input.legal.filter((intent) =>
    intent.kind === "activate-ability" && intent.sourceInstanceId === blade.instanceId &&
    intent.targetAllyId !== undefined && targetById.has(intent.targetAllyId)
  ), input, ownCards(input));
  return candidates.sort((left, right) => {
    const leftTarget = left.kind === "activate-ability" && left.targetAllyId !== undefined
      ? targetById.get(left.targetAllyId)
      : undefined;
    const rightTarget = right.kind === "activate-ability" && right.targetAllyId !== undefined
      ? targetById.get(right.targetAllyId)
      : undefined;
    return allyKillValue(rightTarget!) - allyKillValue(leftTarget!) ||
      pitchRoleCost(left, input) - pitchRoleCost(right, input);
  })[0];
}

function canSequencePathBeforeYellowEdict(
  intent: GameIntent,
  data: CardData,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  if (!key(data).startsWith("swordmaster's path|") || !hasPathIntoYellowEdict(input)) return false;
  const path = intentCard(intent, own);
  const edict = [...input.view.players[input.seat].hand, ...input.view.players[input.seat].arsenal]
    .find((card) => key(input.cards[card.cardId]) === "edict of steel|2");
  if (!path || !edict || pitchIds(intent).includes(edict.instanceId)) return false;
  const excluded = new Set([...pitchIds(intent), path.instanceId, edict.instanceId]);
  const available = resourcesAfter(intent, data, input, own) + remainingPitchValue(input, excluded);
  // Path already makes Edict sharpen twice, satisfying yellow Edict without
  // destroying Rerebrace. Keep the remaining resources for two Zenith swings.
  return available >= 2;
}

function hasCard(input: BotPolicyInput, functionalKeys: ReadonlySet<string>): boolean {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal].some((card) =>
    functionalKeys.has(key(input.cards[card.cardId]))
  );
}

function hasAttackAction(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal].some((card) => isAttack(input.cards[card.cardId]));
}

function canUseExtraActionPoint(input: BotPolicyInput): boolean {
  return hasFlurry(input) || hasAttackAction(input) || hasCard(input, new Set([
    "and again...|3",
    "backside of the blade|3",
    "beckon steel|3",
    "gleam of the blade|1",
    "olé|3",
    "polished blade|1",
  ]));
}

function canRefreshValiantDynamo(input: BotPolicyInput): boolean {
  return hasPotentialAdditionalSwordAttack(input) || hasCard(input, new Set([
    "and again...|3",
    "backside of the blade|3",
    "beckon steel|3",
    "gleam of the blade|1",
    "olé|3",
    "polished blade|1",
  ]));
}

function cardOpportunity(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!data) return 0;
  const functional = key(data);
  if (functional === "ripple away|3") {
    const drawnReady = hasCard(input, new Set(["drawn to the blade|2"]));
    return drawnReady && input.view.players[input.seat].heroTapped !== true ? 18 : 10;
  }
  if (functional === "toe the line|1") return 15;
  if (functional === "shelter from the storm|1") return 18;
  if (functional.startsWith("edict of steel|")) return 14 - (data.pitch ?? 1);
  if (functional === "beckon steel|3" || functional === "drawn to the blade|2") return 15;
  if (functional === "and again...|3" || functional === "olé|3") return 13;
  if (functional === "swordmaster's shine|1" || functional === "polished blade|1") return 12;
  if (functional.startsWith("showdown|") || functional.startsWith("big blinder|")) return 12;
  if (functional === "brimming blade|1" || functional.startsWith("swordmaster's path|")) return 11;
  if (data.cardType === "defense-reaction") return Math.max(8, data.defense ?? 0);
  if (data.cardType === "attack-reaction") return 7 + Math.max(0, 3 - (data.pitch ?? 0));
  if (isAttack(data)) return (data.attack ?? 0) + (/discard|arsenal/i.test(data.text) ? 3 : 0);
  return Math.max(1, data.pitch ?? 0);
}

const HALA_SETUP_ROLE: CardRoleTag = "hero:hala-setup";

/** Hala's role profile distinguishes ordinary blue block/pitch cards from
 * blue setup cards whose text converts directly into Zenith attacks. */
function halaCardRoles(card: CardView, input: BotPolicyInput): CardRoles {
  const base = defaultCardRoles(card, input);
  const data = input.cards[card.cardId];
  const functional = key(data);
  const tags = [...base.tags];
  const setup = /\bsharpen\b/i.test(data?.text ?? "") || extendsSwordTurn(data);
  const redundantSetup = setup && [
    ...input.view.players[input.seat].hand,
    ...input.view.players[input.seat].arsenal,
  ].filter((candidate) => key(input.cards[candidate.cardId]) === functional).length > 1;
  if (setup) tags.push("setup", HALA_SETUP_ROLE);

  if (functional === "ripple away|3") {
    return {
      playValue: 4,
      pitchCost: 1,
      blockCost: 2,
      retainValue: 4,
      arsenalValue: 4,
      tags,
    };
  }
  if (functional.startsWith("sharp incline|")) {
    const value = 22 + (hasFlurry(input) ? 8 : 0);
    return {
      playValue: value,
      pitchCost: value,
      blockCost: value - 2,
      retainValue: value,
      arsenalValue: value + 2,
      tags,
    };
  }
  if (setup) {
    return {
      ...base,
      playValue: Math.max(base.playValue, 18),
      pitchCost: Math.max(base.pitchCost, 16),
      // Once one copy survives, a duplicate setup is ordinary blocking value.
      blockCost: redundantSetup ? base.blockCost : Math.max(base.blockCost, 14),
      retainValue: Math.max(base.retainValue, 18),
      arsenalValue: Math.max(base.arsenalValue, 20),
      tags,
    };
  }
  if (hasCardRole(base, "defense-reaction") || hasCardRole(base, "prevention")) {
    return {
      ...base,
      pitchCost: base.pitchCost + 8,
      blockCost: base.blockCost + 8,
      retainValue: base.retainValue + 8,
      arsenalValue: base.arsenalValue + 8,
      tags,
    };
  }
  return { ...base, tags };
}

function pitchRoleCost(intent: GameIntent, input: BotPolicyInput): number {
  const own = ownCards(input);
  return pitchIds(intent).reduce((total, id) => {
    const card = own.get(id);
    return total + (card ? halaCardRoles(card, input).pitchCost : 0);
  }, 0);
}

function pitchValue(intent: GameIntent, input: BotPolicyInput): number {
  const own = ownCards(input);
  return pitchIds(intent).reduce((total, id) => {
    const card = own.get(id);
    return total + Number(input.cards[card?.cardId ?? ""]?.pitch ?? 0);
  }, 0);
}

function actionWithoutPitch(intent: GameIntent): GameIntent {
  if (
    intent.kind === "play-card" || intent.kind === "play-from-arsenal" ||
    intent.kind === "play-from-zone" || intent.kind === "activate-ability"
  ) {
    return { ...intent, pitchInstanceIds: [] };
  }
  if (intent.kind === "defend") return { ...intent, pitchInstanceIds: [] };
  return intent;
}

function halaPaymentClass(intent: GameIntent, input: BotPolicyInput): string {
  return JSON.stringify({
    action: actionWithoutPitch(intent),
    pitchValue: pitchValue(intent, input),
  });
}

interface ZenithConversion {
  damage: number;
  resourcesRequired: number;
}

/** Public-state proof for the common Flurry/Vigor turn. This intentionally
 * models only an immediately legal Sharp Incline line; more elaborate setup
 * remains in the bounded simulator. */
function immediateSharpZenithConversion(
  candidates: readonly GameIntent[],
  input: BotPolicyInput,
): ZenithConversion | undefined {
  const me = input.view.players[input.seat];
  const blade = zenithBlade(input);
  if (
    !blade || blade.usedAbilityIndexes?.includes(0) || weaponAttacksThisTurn(input) > 0 ||
    !hasFlurry(input) || me.actionPoints < 1
  ) return undefined;
  const own = ownCards(input);
  const sharp = candidates.find((intent) => {
    if (intent.kind !== "play-card" && intent.kind !== "play-from-arsenal") return false;
    const card = intentCard(intent, own);
    const data = card ? input.cards[card.cardId] : undefined;
    const threshold = Number(/if it has (\d+) or more/i.exec(data?.text ?? "")?.[1] ?? 0);
    return key(data).startsWith("sharp incline|") &&
      sharpenCount(input) + 1 >= threshold && pitchIds(intent).length === 0;
  });
  if (!sharp) return undefined;
  const resourcesRequired = 1;
  if (me.resources < resourcesRequired) return undefined;
  return {
    damage: 2 * (3 + sharpenCount(input) + 1),
    resourcesRequired,
  };
}

function sourceCardForIntent(intent: GameIntent, input: BotPolicyInput): CardView | undefined {
  return intentCard(intent, ownCards(input));
}

function halaCandidatePriority(intent: GameIntent, input: BotPolicyInput): number {
  if (intent.kind === "pass") return -10;
  const card = sourceCardForIntent(intent, input);
  const data = card ? input.cards[card.cardId] : undefined;
  const functional = key(data);
  let score = halaCardRoles(card ?? { instanceId: -1, cardId: "", owner: input.seat }, input).playValue;
  if (functional.startsWith("sharp incline|")) score += 400;
  else if (functional === "hala, bladesaint of the vow|0" || functional === "hala|0") score += 360;
  else if (functional === "zenith blade|0") score += 320;
  else if (card && hasCardRole(halaCardRoles(card, input), HALA_SETUP_ROLE)) score += 240;
  if (functional === "ripple away|3" && isAttack(data)) score -= 80;
  return score - pitchRoleCost(intent, input);
}

/** Collapse payments with the same action and total pitch value. Fewer cards
 * win first (for example, one blue over yellow + red), then Hala's role cost
 * chooses among equivalent cards. Payments that leave a different amount of
 * floating resource remain searchable. */
function prepareHalaCandidates(
  candidates: readonly GameIntent[],
  input: BotPolicyInput,
): GameIntent[] {
  const bestByClass = new Map<string, GameIntent>();
  for (const intent of candidates) {
    const paymentClass = halaPaymentClass(intent, input);
    const current = bestByClass.get(paymentClass);
    const cardCount = pitchIds(intent).length;
    const currentCardCount = current ? pitchIds(current).length : Number.POSITIVE_INFINITY;
    const cost = pitchRoleCost(intent, input);
    const currentCost = current ? pitchRoleCost(current, input) : Number.POSITIVE_INFINITY;
    if (
      !current || cardCount < currentCardCount ||
      (cardCount === currentCardCount && cost < currentCost) ||
      (cardCount === currentCardCount && cost === currentCost &&
        JSON.stringify(intent) < JSON.stringify(current))
    ) bestByClass.set(paymentClass, intent);
  }

  let prepared = [...bestByClass.values()];
  if (weaponAttacksThisTurn(input) > 0) {
    // Turn setup belongs before Zenith's first activation. Removing these
    // roots prevents dead post-swing sharpens and makes Flurry lines search
    // only the second weapon activation itself.
    prepared = prepared.filter((intent) => {
      if (isHalaAbilityIntent(intent, input)) return false;
      const card = sourceCardForIntent(intent, input);
      const data = card ? input.cards[card.cardId] : undefined;
      return !data || !/\bsharpen target sword\b/i.test(data.text);
    });
  }
  const conversion = immediateSharpZenithConversion(prepared, input);
  if (conversion) {
    const opponentLife = input.view.players[1 - input.seat]!.life;
    prepared = prepared.filter((intent) => {
      if (intent.kind !== "play-card" || intent.targetAllyId !== undefined) return true;
      const card = sourceCardForIntent(intent, input);
      const data = card ? input.cards[card.cardId] : undefined;
      return key(data) !== "ripple away|3" ||
        opponentLife <= Number(data?.attack ?? 0) ||
        conversion.damage <= Number(data?.attack ?? 0);
    });
  }
  return prepared.sort((left, right) =>
    halaCandidatePriority(right, input) - halaCandidatePriority(left, input)
  );
}

/** Protect Edict and Swordmaster's Shine whenever the visible resources
 * convert them into Hala + Flurry, two Zenith attacks, and the discounted +5
 * reaction. Include Rerebrace's paid extra sharpen when it is what makes a
 * blue Edict reach its threshold. If the complete line is not fundable, still
 * lead on a free Edict when it creates Flurry and leaves both weapon attacks.
 */
function edictShinePowerTurnIntent(input: BotPolicyInput): GameIntent | undefined {
  const me = input.view.players[input.seat];
  if (me.actionPoints < 1 || zenithBlade(input) === undefined) return undefined;
  const own = ownCards(input);
  const edict = [...me.hand, ...me.arsenal].find((card) =>
    key(input.cards[card.cardId]).startsWith("edict of steel|")
  );
  const shine = [...me.hand, ...me.arsenal].find((card) =>
    key(input.cards[card.cardId]) === "swordmaster's shine|1"
  );
  if (!edict || !shine) return undefined;

  const protectedIds = new Set([edict.instanceId, shine.instanceId]);
  const counters = sharpenCount(input);
  const threshold = Number(input.cards[edict.cardId]?.pitch ?? 1);
  const hasRerebrace = Object.values(me.equipment).some((card) =>
    key(input.cards[card?.cardId ?? ""]) === "reverent rerebrace|0"
  );

  if (counters === 0 && me.heroTapped !== true) {
    const countersAfterHeroAndEdict = counters + 2;
    const needsRerebrace = countersAfterHeroAndEdict < threshold;
    const finalCounters = countersAfterHeroAndEdict + (needsRerebrace ? 1 : 0);
    const reachesThreshold = finalCounters >= threshold && (!needsRerebrace || hasRerebrace);
    const shineCost = Math.max(0, Number(input.cards[shine.cardId]?.cost ?? 0) - finalCounters);
    const continuationCost = (needsRerebrace ? 1 : 0) + 2 + shineCost;
    const heroIntents = input.legal.filter((intent) => {
      if (
        intent.kind !== "activate-ability" ||
        pitchIds(intent).some((id) => protectedIds.has(id))
      ) return false;
      const card = intentCard(intent, own);
      const functional = card ? key(input.cards[card.cardId]) : "";
      if (functional !== "hala, bladesaint of the vow|0" && functional !== "hala|0") return false;
      const excluded = new Set([...protectedIds, ...pitchIds(intent)]);
      return reachesThreshold &&
        resourcesAfter(intent, input.cards[card!.cardId]!, input, own) +
          remainingPitchValue(input, excluded) >= continuationCost;
    });
    const hero = preferredPitchIntents(heroIntents, input)[0];
    if (hero) return hero;
  }

  const remainingResources = me.resources + remainingPitchValue(input, protectedIds);
  const countersAfterEdict = counters + 1;
  const edictCreatesFlurry = !hasFlurry(input) && countersAfterEdict >= threshold;
  const shineCostAfterEdict = Math.max(
    0,
    Number(input.cards[shine.cardId]?.cost ?? 0) - countersAfterEdict,
  );
  const fullLineCostAfterEdict = 2 + shineCostAfterEdict;
  if (counters >= 1 && edictCreatesFlurry && remainingResources >= fullLineCostAfterEdict) {
    const edictIntent = input.legal.find((intent) => {
      if (
        intent.kind !== "play-card" && intent.kind !== "play-from-arsenal" &&
        intent.kind !== "play-from-zone"
      ) return false;
      return intentCard(intent, own)?.instanceId === edict.instanceId && pitchIds(intent).length === 0;
    });
    if (edictIntent) return edictIntent;
  }

  const resourcesAfterEdict = me.resources + remainingPitchValue(input, protectedIds);
  if (edictCreatesFlurry && resourcesAfterEdict >= 2) {
    return input.legal.find((intent) => {
      if (
        intent.kind !== "play-card" && intent.kind !== "play-from-arsenal" &&
        intent.kind !== "play-from-zone"
      ) return false;
      return intentCard(intent, own)?.instanceId === edict.instanceId && pitchIds(intent).length === 0;
    });
  }
  return undefined;
}

/** Never spend Zenith's first activation unsharpened when the visible hand can
 * instead sharpen it and convert the resulting go again into a direct sword
 * attack. This is a semantic conversion rule, not a printing-specific
 * sequence. */
function sharpenBeforeAdditionalSwingIntent(input: BotPolicyInput): GameIntent | undefined {
  const me = input.view.players[input.seat];
  if (
    me.actionPoints < 1 || me.heroTapped === true || sharpenedThisTurn(input) ||
    zenithBlade(input) === undefined
  ) return undefined;
  const visible = [...me.hand, ...me.arsenal];
  const extenders = visible.filter((card) => grantsDirectSwordAttack(input.cards[card.cardId]));
  if (extenders.length === 0) return undefined;
  const reservedIds = new Set(visible.filter((card) =>
    extendsSwordTurn(input.cards[card.cardId])
  ).map((card) => card.instanceId));
  const own = ownCards(input);
  const heroIntents = input.legal.filter((intent) => {
    if (intent.kind !== "activate-ability" || pitchIds(intent).some((id) => reservedIds.has(id))) {
      return false;
    }
    const source = intentCard(intent, own);
    const functional = source ? key(input.cards[source.cardId]) : "";
    if (functional !== "hala, bladesaint of the vow|0" && functional !== "hala|0") return false;
    return extenders.some((extender) => {
      const extenderData = input.cards[extender.cardId];
      const threshold = sharpenThreshold(extenderData);
      const reachesThreshold = threshold === undefined || sharpenCount(input) + 2 >= threshold;
      if (!reachesThreshold) return false;
      const excluded = new Set([...pitchIds(intent), extender.instanceId]);
      const resources = resourcesAfter(intent, input.cards[source!.cardId]!, input, own) +
        remainingPitchValue(input, excluded);
      return resources >= 1 + Number(extenderData?.cost ?? 0);
    });
  });
  return preferredPitchIntents(heroIntents, input)[0];
}

/** Lead a sharpen multiplier when a visible go-again sharpener converts it
 * into a fundable high-value Zenith attack. This protects the conversion from
 * bounded-search context such as a small ally that the unsharpened weapon can
 * already destroy. */
function sharpenMultiplierSwordTurnIntent(input: BotPolicyInput): GameIntent | undefined {
  const me = input.view.players[input.seat];
  const blade = zenithBlade(input);
  if (
    me.actionPoints < 1 || !blade || blade.usedAbilityIndexes?.includes(0)
  ) return undefined;

  const visible = [...me.hand, ...me.arsenal];
  const sharpeners = visible.filter((card) => {
    const data = input.cards[card.cardId];
    return data?.cardType === "action" &&
      /\bsharpen target (?:attacking )?sword\b/i.test(data.text) &&
      /\bgo again\b/i.test(data.text);
  });
  if (sharpeners.length === 0) return undefined;

  const own = ownCards(input);
  const candidates = input.legal.filter((intent) => {
    if (intent.kind !== "play-card" && intent.kind !== "play-from-arsenal") return false;
    const multiplier = intentCard(intent, own);
    const multiplierData = multiplier ? input.cards[multiplier.cardId] : undefined;
    if (!multiplier || !doublesNextSharpen(multiplierData)) return false;
    const nextSwordBonus = Number(
      /your next sword attack[^.]*gets \+(\d+)\{p\}/i.exec(multiplierData?.text ?? "")?.[1] ?? 0,
    );
    if (nextSwordBonus + 1 < 3) return false;

    return sharpeners.some((sharpener) => {
      if (pitchIds(intent).includes(sharpener.instanceId)) return false;
      const sharpenerData = input.cards[sharpener.cardId];
      const countersAfterSharpen = sharpenCount(input) + 2;
      const threshold = sharpenThreshold(sharpenerData);
      const reducesActivation = /\bnext attack with it[^.]*costs \{r\} less to activate/i
        .test(sharpenerData?.text ?? "") &&
        (threshold === undefined || countersAfterSharpen >= threshold);
      const continuationCost = Number(sharpenerData?.cost ?? 0) + (reducesActivation ? 0 : 1);
      const excluded = new Set([
        ...pitchIds(intent),
        multiplier.instanceId,
        sharpener.instanceId,
      ]);
      const available = resourcesAfter(intent, multiplierData!, input, own) +
        remainingPitchValue(input, excluded);
      return available >= continuationCost;
    });
  });
  return preferredPitchIntents(candidates, input)[0];
}

/** Preserve a sharpen multiplier when it is what converts a visible threshold
 * setup into Flurry, while leaving unrelated setup order to the planner. */
function sharpenMultiplierPowerTurnIntent(input: BotPolicyInput): GameIntent | undefined {
  const me = input.view.players[input.seat];
  if (me.actionPoints < 1 || hasFlurry(input)) return undefined;
  const visible = [...me.hand, ...me.arsenal];
  const payoff = visible.find((card) => {
    const data = input.cards[card.cardId];
    const threshold = sharpenThreshold(data);
    return createsFlurry(data) && threshold !== undefined &&
      sharpenCount(input) + 1 < threshold && sharpenCount(input) + 2 >= threshold;
  });
  if (!payoff) return undefined;
  if (input.view.ongoing.some((effect) =>
    effect.seat === input.seat && doublesNextSharpen(input.cards[effect.cardId])
  )) return undefined;

  const own = ownCards(input);
  const candidates = input.legal.filter((intent) => {
    if (intent.kind !== "play-card" && intent.kind !== "play-from-arsenal") return false;
    const source = intentCard(intent, own);
    const data = source ? input.cards[source.cardId] : undefined;
    if (!source || !doublesNextSharpen(data) || pitchIds(intent).includes(payoff.instanceId)) {
      return false;
    }
    const excluded = new Set([...pitchIds(intent), source.instanceId, payoff.instanceId]);
    const available = resourcesAfter(intent, data!, input, own) + remainingPitchValue(input, excluded);
    return available >= Number(input.cards[payoff.cardId]?.cost ?? 0) + 2;
  });
  return preferredPitchIntents(candidates, input)[0];
}

interface HalaAllyTarget {
  instanceId: number;
  functional: string;
  life: number;
}

function halaAllyTargets(input: BotPolicyInput): HalaAllyTarget[] {
  return opponentAllies(input).map((ally) => ({
    instanceId: ally.instanceId,
    functional: key(input.cards[ally.cardId]),
    life: allyLethalThreshold(ally, input),
  }));
}

function allyKillValue(target: HalaAllyTarget): number {
  // Chum's forced-target ability can invalidate an entire weapon turn, so its
  // removal outweighs ordinary hero damage. Sawbones is the next priority;
  // ordinary allies are worth an exact or one-point-over lethal attack.
  if (target.functional === CHUM) return 2_000;
  if (target.functional === SAWBONES) return 350;
  return target.life * 100 + 125;
}

function destroyedAllyValue(
  targets: readonly HalaAllyTarget[],
  input: BotPolicyInput,
): number {
  const surviving = new Set(opponentAllies(input).map((ally) => ally.instanceId));
  return targets.reduce((total, target) =>
    total + (surviving.has(target.instanceId) ? 0 : allyKillValue(target)), 0);
}

function projectedAttackDamage(
  card: CardView,
  input: BotPolicyInput,
  includeNextAttackEffects = true,
): number {
  let damage = Math.max(0, card.attack ?? input.cards[card.cardId]?.attack ?? 0);
  const subtypes = new Set((input.cards[card.cardId]?.subtypes ?? []).map((subtype) =>
    subtype.toLowerCase()
  ));
  for (const effect of input.view.ongoing) {
    if (!includeNextAttackEffects) continue;
    if (effect.seat !== input.seat || !effect.label.toLowerCase().includes("next attack")) continue;
    const source = input.cards[effect.cardId];
    if (key(source).startsWith("swordmaster's path|") && !subtypes.has("sword")) continue;
    damage += Number(/\+(\d+) attack/i.exec(effect.label)?.[1] ?? 0);
  }
  return damage;
}

function projectedAttackDamageWithHeldShine(
  input: BotPolicyInput,
  selected: TargetableAttackIntent,
  card: CardView,
): number {
  const damage = projectedAttackDamage(card, input);
  const me = input.view.players[input.seat];
  const shine = [...me.hand, ...me.arsenal].find((candidate) =>
    key(input.cards[candidate.cardId]) === "swordmaster's shine|1" &&
    !pitchIds(selected).includes(candidate.instanceId)
  );
  if (!shine) return damage;
  return damage + reactionPower(input.cards[shine.cardId]!, input);
}

function projectedZenithFollowupDamage(
  input: BotPolicyInput,
  selected: TargetableAttackIntent,
  card: CardView,
  own: ReadonlyMap<number, CardView>,
): number | undefined {
  const data = input.cards[card.cardId];
  if (
    key(data) !== "zenith blade|0" || !hasFlurry(input) ||
    weaponAttacksThisTurn(input) !== 0 || !sharpenedThisTurn(input)
  ) return undefined;
  const excluded = new Set(pitchIds(selected));
  const available = resourcesAfter(selected, data!, input, own) + remainingPitchValue(input, excluded);
  if (available < 1) return undefined;
  return projectedAttackDamage(card, input, false);
}

function hasSmallerZenithFollowupForAllies(
  input: BotPolicyInput,
  selected: TargetableAttackIntent,
  card: CardView,
  currentDamage: number,
  allies: readonly CardView[],
  own: ReadonlyMap<number, CardView>,
): boolean {
  const followupDamage = projectedZenithFollowupDamage(input, selected, card, own);
  if (followupDamage === undefined) return false;
  return hasSmallerLethalAllyFollowup(
    currentDamage,
    [followupDamage],
    allies.map((ally) => allyLethalThreshold(ally, input)),
  );
}

function affordableHeldAttackDamages(
  input: BotPolicyInput,
  selected: TargetableAttackIntent,
  card: CardView,
  own: ReadonlyMap<number, CardView>,
): number[] {
  const data = input.cards[card.cardId];
  if (key(data) !== "zenith blade|0" || weaponAttacksThisTurn(input) !== 0 ||
    !sharpenedThisTurn(input)) return [];
  const resources = resourcesAfter(selected, data!, input, own);
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal].flatMap((held) => {
    const heldData = input.cards[held.cardId];
    if (!isAttack(heldData) || pitchIds(selected).includes(held.instanceId)) return [];
    const excluded = new Set([held.instanceId, ...pitchIds(selected)]);
    const available = resources + remainingPitchValue(input, excluded);
    return available >= Number(heldData?.cost ?? 0)
      ? [projectedAttackDamage(held, input, false)]
      : [];
  });
}

/** Chum receives damage only when the visible remainder of the turn can
 * finish it. Prefer saving an independently lethal follow-up (such as CnC)
 * for Chum instead of wasting the first, smaller sword swing on it. */
function shouldAttackChum(
  input: BotPolicyInput,
  selected: TargetableAttackIntent,
  card: CardView,
  chum: CardView,
  damage: number,
  own: ReadonlyMap<number, CardView>,
): boolean {
  const life = allyLethalThreshold(chum, input);
  if (damage >= life) return true;
  const followups = affordableHeldAttackDamages(input, selected, card, own);
  const zenithFollowup = projectedZenithFollowupDamage(input, selected, card, own);
  if (zenithFollowup !== undefined) followups.push(zenithFollowup);
  if (followups.some((followup) => followup >= life)) return false;
  return damage + Math.max(0, ...followups) >= life;
}

function matchingAttackTarget(
  input: BotPolicyInput,
  selected: TargetableAttackIntent,
  targetAllyId: number | undefined,
): TargetableAttackIntent | undefined {
  const variant = attackIntentVariantKey(selected);
  return input.legal.find((candidate): candidate is TargetableAttackIntent =>
    targetableAttackIntent(candidate) && candidate.targetAllyId === targetAllyId &&
    attackIntentVariantKey(candidate) === variant
  );
}

function enforceHalaAllyPolicy(input: BotPolicyInput, selected: GameIntent): GameIntent {
  if (!targetableAttackIntent(selected)) return selected;
  const own = ownCards(input);
  const card = intentCard(selected, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || (!isAttack(data) && data?.cardType !== "weapon")) return selected;

  const allies = opponentAllies(input);
  if (allies.length === 0) return selected;
  const damage = projectedAttackDamage(card, input);
  const committedDamage = projectedAttackDamageWithHeldShine(input, selected, card);
  const hero = matchingAttackTarget(input, selected, undefined);

  const chums = allies.filter((ally) => key(input.cards[ally.cardId]) === CHUM);
  if (chums.length > 0) {
    const matching = chums
      .sort((left, right) =>
        allyLethalThreshold(left, input) - allyLethalThreshold(right, input)
      )
      .filter((ally) => shouldAttackChum(input, selected, card, ally, committedDamage, own))
      .map((ally) => matchingAttackTarget(input, selected, ally.instanceId))
      .find((intent) => intent !== undefined);
    return matching ?? hero ?? selected;
  }

  if (hero && hasSmallerZenithFollowupForAllies(
    input,
    selected,
    card,
    committedDamage,
    allies,
    own,
  )) {
    return hero;
  }

  const sawbones = allies.filter((ally) => key(input.cards[ally.cardId]) === SAWBONES);
  const sawbonesTarget = sawbones
    .filter((ally) => damage >= allyLethalThreshold(ally, input))
    .sort((left, right) =>
      allyLethalThreshold(right, input) - allyLethalThreshold(left, input)
    )[0];
  const sawbonesIntent = sawbonesTarget
    ? matchingAttackTarget(input, selected, sawbonesTarget.instanceId)
    : undefined;
  if (sawbonesIntent) return sawbonesIntent;
  if (selected.targetAllyId !== undefined && sawbones.some((ally) =>
    ally.instanceId === selected.targetAllyId
  )) return hero ?? selected;

  const ordinary = allies.filter((ally) => key(input.cards[ally.cardId]) !== SAWBONES);
  const finishingAdditionalSwing = key(data) === "zenith blade|0" &&
    sharpenedThisTurn(input) && weaponAttacksThisTurn(input) > 0;
  const efficient = ordinary
    .filter((ally) => damage >= allyLethalThreshold(ally, input) &&
      (damage - allyLethalThreshold(ally, input) <= 1 || finishingAdditionalSwing))
    .sort((left, right) => {
      const excess = damage - allyLethalThreshold(left, input);
      const otherExcess = damage - allyLethalThreshold(right, input);
      return excess - otherExcess ||
        allyLethalThreshold(left, input) - allyLethalThreshold(right, input);
    });
  const matching = efficient
    .map((ally) => matchingAttackTarget(input, selected, ally.instanceId))
    .find((intent) => intent !== undefined);
  if (matching) return matching;
  const selectedIsAlly = selected.targetAllyId !== undefined && allies.some((ally) =>
    ally.instanceId === selected.targetAllyId
  );
  return selectedIsAlly ? (hero ?? selected) : selected;
}

interface HalaConversionEstimate {
  damage: number;
  swordAttacks: number;
  swordDamage: number;
  reactionDamage: number;
}

/** Projection-only conversion estimate used at search horizons and to price
 * offense lost to blocking. Flurry is represented by the additional Zenith
 * attack it enables; direct extenders such as And Again and Beckon Steel add
 * their own sword attacks. Conditional hit and wager effects assume they
 * connect, matching the planner's public no-block rollout. */
function estimateHalaConversion(
  cards: readonly CardView[],
  input: BotPolicyInput,
  options: { includeFlurry?: boolean } = {},
): HalaConversionEstimate {
  const unique = [...new Map(cards.map((card) => [card.instanceId, card])).values()]
    .filter((card) => input.cards[card.cardId]?.cardType !== "weapon");
  const handIds = new Set(input.view.players[input.seat].hand.map((card) => card.instanceId));
  const nextTurnVigor = input.view.players[input.seat].board.filter((card) =>
    key(input.cards[card.cardId]) === "vigor|0"
  ).length;
  const attacksMade = weaponAttacksThisTurn(input);
  const blade = zenithBlade(input);
  let best: HalaConversionEstimate = {
    damage: 0,
    swordAttacks: 0,
    swordDamage: 0,
    reactionDamage: 0,
  };

  // A Hala hand is small, so enumerate which visible cards are converted and
  // which hand cards become pitch. This prevents one reaction from being
  // counted both as resources and as damage on the second swing.
  const lineCount = 2 ** unique.length;
  for (let mask = 0; mask < lineCount; mask++) {
    const selected = unique.filter((_card, index) => (mask & (1 << index)) !== 0);
    const selectedIds = new Set(selected.map((card) => card.instanceId));
    let resources = input.view.players[input.seat].resources + nextTurnVigor;
    for (const card of unique) {
      if (handIds.has(card.instanceId) && !selectedIds.has(card.instanceId)) {
        resources += Number(input.cards[card.cardId]?.pitch ?? 0);
      }
    }

    let sharpens = 0;
    let reactionPower = 0;
    let flurry = options.includeFlurry !== false && hasFlurry(input);
    let attackAction = 0;
    let drawnToTheBlade = false;
    let nextSwordAttackPower = 0;
    let pointOfEscalation = false;
    let hasSharpenMultiplier = false;
    let fixedCosts = 0;
    const edictThresholds: number[] = [];
    const directAttackThresholds: Array<number | undefined> = [];

    for (const card of selected) {
      const data = input.cards[card.cardId];
      if (!data) continue;
      const functional = key(data);
      drawnToTheBlade ||= functional === "drawn to the blade|2";
      hasSharpenMultiplier ||= doublesNextSharpen(data);
      nextSwordAttackPower += Number(
        /your next sword attack[^.]*gets \+(\d+)\{p\}/i.exec(data.text)?.[1] ?? 0,
      );
      if (functional === "brimming blade|1") sharpens += 2;
      else if (/\bsharpen target sword|\bsharpen target attacking sword/i.test(data.text)) sharpens += 1;
      if (functional.startsWith("edict of steel|")) edictThresholds.push(Number(data.pitch ?? 1));
      if (options.includeFlurry !== false && createsFlurry(data) &&
        !functional.startsWith("edict of steel|")) flurry = true;
      if (grantsDirectSwordAttack(data)) directAttackThresholds.push(sharpenThreshold(data));
      if (functional === "swordmaster's shine|1") reactionPower += 5;
      else if (functional === "point of escalation|2") pointOfEscalation = true;
      else if (data.cardType === "attack-reaction") {
        reactionPower += Number(/\+(\d+)\{p\}/.exec(data.text)?.[1] ?? 0);
      }
      if (isAttack(data)) attackAction = Math.max(attackAction, data.attack ?? 0);
      if (functional !== "swordmaster's shine|1") fixedCosts += Number(data.cost ?? 0);
    }

    if (hasSharpenMultiplier && sharpens > 0) sharpens += 1;
    if (options.includeFlurry !== false && edictThresholds.some((threshold) =>
      sharpenCount(input) + sharpens >= threshold
    )) flurry = true;

    const desiredWeaponSwings = attacksMade > 0
      ? (blade && !blade.usedAbilityIndexes?.includes(0) ? 1 : 0)
      : flurry
      ? 2
      : 1;
    if (drawnToTheBlade && input.view.players[input.seat].heroTapped !== true &&
      resources - fixedCosts >= 3 + desiredWeaponSwings) {
      fixedCosts += 3;
      sharpens += 1;
      const rerebrace = input.view.players[input.seat].equipment.arms;
      if (key(input.cards[rerebrace?.cardId ?? ""]) === "reverent rerebrace|0" &&
        resources - fixedCosts >= 1 + desiredWeaponSwings) {
        fixedCosts += 1;
        sharpens += 1;
      }
    }
    const shineCost = selected.some((card) =>
      key(input.cards[card.cardId]) === "swordmaster's shine|1"
    ) ? Math.max(0, 3 - sharpenCount(input) - sharpens) : 0;
    resources -= fixedCosts + shineCost;
    if (resources < 0) continue;

    const weaponSwings = Math.min(desiredWeaponSwings, Math.floor(resources));
    const countersAfterSetup = sharpenCount(input) + sharpens;
    const directSwings = weaponSwings > 0
      ? directAttackThresholds.filter((threshold) =>
          threshold === undefined || countersAfterSetup + 1 >= threshold
        ).length
      : 0;
    const swings = weaponSwings + directSwings;
    if (pointOfEscalation) reactionPower += 2 * Math.max(1, attacksMade + swings);
    if (drawnToTheBlade && countersAfterSetup >= 2) reactionPower += 3;
    if (swings === 0) reactionPower = 0;
    const swordDamage = swings * (3 + countersAfterSetup) + (swings > 0 ? nextSwordAttackPower : 0);
    const swordLineDamage = swordDamage + reactionPower;
    const damage = Math.max(swordLineDamage, attackAction);
    const estimate = damage === swordLineDamage
      ? { damage, swordAttacks: swings, swordDamage, reactionDamage: reactionPower }
      : { damage, swordAttacks: 0, swordDamage: 0, reactionDamage: 0 };
    if (estimate.damage > best.damage ||
      (estimate.damage === best.damage && estimate.swordAttacks > best.swordAttacks)) best = estimate;
  }
  return best;
}

function estimateHalaDamage(cards: readonly CardView[], input: BotPolicyInput): number {
  return estimateHalaConversion(cards, input).damage;
}

/** Damage unlocked specifically by Flurry. Because both estimates retain the
 * same reactions, Point of Escalation and other later-swing payoffs increase
 * this marginal value automatically. */
function estimateFlurryAttackValue(
  cards: readonly CardView[],
  input: BotPolicyInput,
  withFlurry: HalaConversionEstimate = estimateHalaConversion(cards, input),
): number {
  const withoutFlurry = estimateHalaConversion(cards, input, { includeFlurry: false });
  return Math.max(0, withFlurry.damage - withoutFlurry.damage);
}

function openingHandCoversIncomingDamage(input: BotPolicyInput): boolean {
  if (!isOpeningTurnDefense(input)) return false;
  const link = currentLink(input);
  if (!link) return false;
  const incoming = Math.max(0, link.attackValue - link.defenseValue);
  const stageableIds = new Set(input.legal.flatMap((intent) =>
    intent.kind === "stage-defenders" ? intent.instanceIds : []
  ));
  const hand = input.view.players[input.seat].hand.filter((card) =>
    stageableIds.has(card.instanceId)
  );
  const defenseOf = (card: CardView): number => Math.max(0, card.defense ?? 0);
  if (link.dominate) {
    return hand.reduce((best, card) => Math.max(best, defenseOf(card)), 0) >= incoming;
  }
  if (link.overpower) {
    const actionDefense = hand.reduce((best, card) =>
      input.cards[card.cardId]?.cardType === "action"
        ? Math.max(best, defenseOf(card))
        : best,
    0);
    const otherDefense = hand.reduce((total, card) =>
      input.cards[card.cardId]?.cardType === "action" ? total : total + defenseOf(card),
    0);
    return actionDefense + otherDefense >= incoming;
  }
  return hand.reduce((total, card) => total + defenseOf(card), 0) >= incoming;
}

function scoreDefend(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return scoreDefenseIntent(intent, input, own, {
    offensiveCards: (policyInput) => {
      const me = policyInput.view.players[policyInput.seat];
      return [...me.hand, ...me.arsenal, ...me.weapons];
    },
    evaluateResponse: (cards, policyInput) => {
      const damageThreatened = estimateHalaDamage(cards, policyInput);
      const chum = halaAllyTargets(policyInput).find((target) => target.functional === CHUM);
      return responseEvaluation({
        damageThreatened,
        strategicAdjustment: !chum
          ? 0
          : damageThreatened >= chum.life
          ? 240
          : -(chum.life - damageThreatened) * 300,
      });
    },
    cardOpportunity: (card, policyInput) => halaCardRoles(card, policyInput).blockCost,
    plannedPrevention(policyInput, _defendIntent, spentIds, reactionPlan) {
      const link = currentLink(policyInput);
      if (!link) return reactionPlan;
      const me = policyInput.view.players[policyInput.seat];
      const toeIds = [...me.hand, ...me.arsenal].flatMap((card) =>
        key(policyInput.cards[card.cardId]) === "toe the line|1" ? [card.instanceId] : []
      );
      const availableToeIds = toeIds.filter((id) =>
        !spentIds.has(id) && !reactionPlan.consumedIds.includes(id)
      );
      if (toeIds.length > 0 && availableToeIds.length === 0 && toeTheLinePreventionCommitted(policyInput) === 0) {
        return null;
      }
      const incoming = Math.max(0, link.attackValue - link.defenseValue);
      const committed = toeTheLinePreventionCommitted(policyInput);
      const uncovered = Math.max(0, incoming - reactionPlan.amount - committed);
      const copies = Math.min(availableToeIds.length, Math.ceil(uncovered / 2));
      return {
        amount: reactionPlan.amount + committed + copies * 2,
        consumedIds: [...reactionPlan.consumedIds, ...availableToeIds.slice(0, copies)],
        resourceCost: reactionPlan.resourceCost,
        reactionIds: reactionPlan.reactionIds,
        pitchIds: reactionPlan.pitchIds,
        preventionIds: [...(reactionPlan.preventionIds ?? []), ...availableToeIds.slice(0, copies)],
      };
    },
    canUseDefender(card, policyInput) {
      // Dynamo has only 1 base defense and removes at most one counter each
      // end phase. Defending at 0 adds no value and can strand a second counter.
      return key(policyInput.cards[card.cardId]) !== "valiant dynamo|0" ||
        Number(card.defCounters ?? 0) === 0;
    },
    equipmentUseIsFree(card, policyInput) {
      const functional = key(policyInput.cards[card.cardId]);
      if (functional === "valiant dynamo|0") return canRefreshValiantDynamo(policyInput);
      return functional === "reverent rerebrace|0" &&
        Number(card.defCounters ?? 0) === 0 &&
        rerebraceWillBeSpentNextTurn(policyInput);
    },
    defensePermission(candidate) {
      const selectedDynamo = candidate.chosen.some((card) =>
        key(candidate.input.cards[card.cardId]) === "valiant dynamo|0"
      );
      return selectedDynamo && openingHandCoversIncomingDamage(candidate.input)
        ? "forbid"
        : "allow";
    },
    adjustCycleValue(value, candidate) {
      const selectedDynamo = candidate.chosen.some((card) =>
        key(candidate.input.cards[card.cardId]) === "valiant dynamo|0"
      );
      return selectedDynamo && canRefreshValiantDynamo(candidate.input)
        ? adjustValueBreakdown(value, {
          strategicAdjustment: value.strategicAdjustment + 6,
        })
        : value;
    },
  });
}

function nextTurnArsenalValue(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  const functional = key(data);
  const roles = halaCardRoles(card, input);
  if (functional === "toe the line|1") return 110;
  if (functional === "shelter from the storm|1") return 96;
  if (functional.startsWith("edict of steel|")) return 105 - (data?.pitch ?? 0);
  if (functional.startsWith("showdown|") || functional.startsWith("big blinder|")) return 98;
  if (functional === "olé|3" || functional === "and again...|3") return 94;
  if (functional === "beckon steel|3" || functional === "drawn to the blade|2") return 90;
  if (functional === "swordmaster's shine|1") return 87;
  if (functional === "command and conquer|1" || functional === "the weakest link|1") return 82;
  // An ordinary blue block-three is more useful in hand during the opponent's
  // turn than face-down in arsenal. Named setup/payoff cards above and cards
  // with a dedicated reaction or prevention role remain valid arsenal plans.
  if (
    hasCardRole(roles, "blue-block-3") &&
    !hasCardRole(roles, "setup") &&
    !hasCardRole(roles, "defense-reaction") &&
    !hasCardRole(roles, "attack-reaction") &&
    !hasCardRole(roles, "prevention")
  ) return -30;
  if (data?.cardType === "defense-reaction") return 78;
  if (data?.cardType === "attack-reaction") return 68 + Math.max(0, 3 - (data.pitch ?? 0));
  if (isAttack(data)) return 55 + (data?.attack ?? 0);
  return 30 + cardOpportunity(card, input);
}

function sharpenThreshold(data: CardData | undefined): number | undefined {
  const match = /if (?:it|the sword) has (\d+) or more \+1\{p\} counters/i.exec(data?.text ?? "");
  return match ? Number(match[1]) : undefined;
}

function rerebraceThresholdNeeded(input: BotPolicyInput): boolean {
  const counters = sharpenCount(input);
  const resolvingThreshold = [...input.view.stack].reverse().flatMap((layer) => {
    if (layer.seat !== input.seat || !layer.card) return [];
    const threshold = sharpenThreshold(input.cards[layer.card.cardId]);
    return threshold === undefined ? [] : [threshold];
  })[0] ?? [...(currentLink(input)?.reactions ?? [])].reverse().flatMap((card) => {
    const threshold = sharpenThreshold(input.cards[card.cardId]);
    return threshold === undefined ? [] : [threshold];
  })[0];
  if (resolvingThreshold !== undefined) {
    return counters < resolvingThreshold && counters + 1 >= resolvingThreshold;
  }
  // A held threshold card is not a secured payoff: paying Rerebrace can pitch
  // that same card away, leaving no Flurry. Only immediate thresholds qualify.
  return false;
}

function rerebraceExtraDamageIsLethal(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  if (!link || link.hit !== undefined || link.attackingCard.owner !== input.seat ||
    key(input.cards[link.attackingCard.cardId]) !== "zenith blade|0") return false;
  const damage = Math.max(0, link.attackValue - link.defenseValue);
  const opponentLife = input.view.players[1 - input.seat]!.life;
  return damage < opponentLife && damage + 1 >= opponentLife;
}

function rerebraceShouldPay(input: BotPolicyInput): boolean {
  return rerebraceThresholdNeeded(input) ||
    heldEdictShineRerebraceTurn(input) ||
    rerebraceExtraDamageIsLethal(input);
}

function forcedRerebraceDecline(input: BotPolicyInput): GameIntent | undefined {
  if (
    !input.view.pendingDecision?.prompt.toLowerCase().includes("reverent rerebrace") ||
    rerebraceShouldPay(input)
  ) return undefined;
  return input.legal.find((intent) =>
    intent.kind === "choose" && ["no", "decline", "pass"].includes(intent.optionId)
  ) ?? input.legal.find((intent) =>
    intent.kind === "choose" && resourcePaymentPitchIds(intent, input) === undefined
  );
}

function rerebraceWillBeSpentNextTurn(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal].some((card) =>
    Number(sharpenThreshold(input.cards[card.cardId]) ?? 0) >= 2
  );
}

function rerebracePaymentPreservesAttacks(
  intent: Extract<GameIntent, { kind: "choose" }>,
  input: BotPolicyInput,
): boolean {
  const payment = input.view.pendingDecision?.resourcePayment;
  const option = payment?.options.find((candidate) => candidate.optionId === intent.optionId);
  // The engine omits resourcePayment when floating resources already cover
  // the cost. Treat that as an empty pitch payment instead of concluding that
  // Rerebrace cannot preserve the remaining sword activations.
  const paymentPitchIds = option?.pitchInstanceIds ?? [];
  const paymentCost = payment?.cost ?? 1;
  const excluded = new Set(paymentPitchIds);
  const drawnInHand = input.view.players[input.seat].hand.find((candidate) =>
    key(input.cards[candidate.cardId]) === "drawn to the blade|2"
  );
  if (drawnInHand) excluded.add(drawnInHand.instanceId);
  const pitched = paymentPitchIds.reduce((total, id) => {
    const card = input.view.players[input.seat].hand.find((candidate) => candidate.instanceId === id);
    return total + Number(input.cards[card?.cardId ?? ""]?.pitch ?? 0);
  }, 0);
  const floatingAfterPayment = Math.max(
    0,
    input.view.players[input.seat].resources + pitched - paymentCost,
  );
  return floatingAfterPayment + remainingPitchValue(input, excluded) >=
    plannedZenithSwings(input, excluded);
}

function rerebracePaymentPreservesEdictShineTurn(
  intent: Extract<GameIntent, { kind: "choose" }>,
  input: BotPolicyInput,
): boolean {
  const paymentPitchIds = resourcePaymentPitchIds(intent, input);
  if (paymentPitchIds === undefined) return false;
  const me = input.view.players[input.seat];
  const edict = [...me.hand, ...me.arsenal].find((card) =>
    key(input.cards[card.cardId]).startsWith("edict of steel|")
  );
  const shine = [...me.hand, ...me.arsenal].find((card) =>
    key(input.cards[card.cardId]) === "swordmaster's shine|1"
  );
  if (!edict || !shine) return false;
  const protectedIds = new Set([edict.instanceId, shine.instanceId]);
  if (paymentPitchIds.some((id) => protectedIds.has(id))) return false;

  const threshold = Number(input.cards[edict.cardId]?.pitch ?? 1);
  const counters = sharpenCount(input);
  const finalCounters = counters + 2;
  if (counters + 1 >= threshold || finalCounters < threshold) return false;

  const paymentCost = input.view.pendingDecision?.resourcePayment?.cost ?? 1;
  const pitched = paymentPitchIds.reduce((total, id) => {
    const card = me.hand.find((candidate) => candidate.instanceId === id);
    return total + Number(input.cards[card?.cardId ?? ""]?.pitch ?? 0);
  }, 0);
  const floatingAfterPayment = Math.max(0, me.resources + pitched - paymentCost);
  const excluded = new Set([...protectedIds, ...paymentPitchIds]);
  const remainingResources = floatingAfterPayment + remainingPitchValue(input, excluded);
  const shineCost = Math.max(0, Number(input.cards[shine.cardId]?.cost ?? 0) - finalCounters);
  return remainingResources >= 2 + shineCost;
}

function heldEdictShineRerebraceTurn(input: BotPolicyInput): boolean {
  if (!input.view.pendingDecision?.prompt.toLowerCase().includes("reverent rerebrace")) {
    return false;
  }
  return input.legal.some((intent) =>
    intent.kind === "choose" &&
    !["no", "decline", "pass"].includes(intent.optionId) &&
    rerebracePaymentPreservesEdictShineTurn(intent, input)
  );
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  const prompt = decision.prompt.toLowerCase();
  const card = optionCard(intent, input);

  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, nextTurnArsenalValue, -20);
  }
  if (prompt.includes("choose a sword") || prompt.includes("target sword")) {
    return card && key(input.cards[card.cardId]) === "zenith blade|0" ? 100 : 0;
  }
  if (prompt.includes("reverent rerebrace")) {
    const pay = !["no", "decline", "pass"].includes(intent.optionId);
    if (pay) {
      if (heldEdictShineRerebraceTurn(input)) {
        return rerebracePaymentPreservesEdictShineTurn(intent, input) ? 110 : -20;
      }
      return rerebraceShouldPay(input) && rerebracePaymentPreservesAttacks(intent, input)
        ? 100
        : -20;
    }
    return rerebraceShouldPay(input) ? 10 : 20;
  }
  if (prompt.includes("create vigor")) {
    const reserve = Math.max(
      zenithCanAttackAgain(input) ? 1 : 0,
      twoCostAttackFloatingReserve(input),
    );
    const canSpare = input.view.players[input.seat].resources > reserve;
    const pay = !["no", "decline", "pass"].includes(intent.optionId);
    return pay === canSpare ? 80 : 0;
  }
  if (prompt.includes("polished blade") && prompt.includes("counters")) {
    return Number(/remove (\d+)/.exec(intent.optionId)?.[1] ?? 0) * 20;
  }
  if (prompt.includes("polished blade") && prompt.includes("mode")) {
    if (intent.optionId === "additional attack") return 100;
    if (intent.optionId === "activation discount") return 80;
    if (intent.optionId === "go again") return currentLink(input)?.goAgain ? 40 : 90;
  }
  if (/sink below|bottom of your deck/i.test(decision.prompt)) {
    if (intent.optionId === "pass") return 1;
    return scoreSpendCardChoice(intent, input, cardOpportunity, 30, 0);
  }
  if (prompt.includes("remove a counter") || prompt.includes("anticipating gaze")) {
    return intent.optionId === "yes" ? 50 : 0;
  }
  if (prompt.includes("discard")) {
    return scoreSpendCardChoice(intent, input, cardOpportunity, 30, -5);
  }
  const binary = scoreBinaryChoice(intent.optionId, 20, 0);
  if (binary !== undefined) return binary;
  return card ? 10 + cardOpportunity(card, input) : 1;
}

function reactionPower(data: CardData, input: BotPolicyInput): number {
  const functional = key(data);
  if (functional === "swordmaster's shine|1") return 5;
  if (functional === "point of escalation|2") return 2 * Math.max(1, weaponAttacksThisTurn(input));
  return Number(/\+(\d+)\{p\}/.exec(data.text)?.[1] ?? 0);
}

function scoreAttackReaction(data: CardData, input: BotPolicyInput): number {
  if (!currentAttackIsOurWeapon(input) || input.view.pendingDecision?.kind !== "attack-reaction") return -100;
  const functional = key(data);
  const link = currentLink(input)!;
  const counters = Number(link.attackingCard.counters?.power ?? 0);
  const margin = Math.max(0, link.attackValue - link.defenseValue);
  const power = reactionPower(data, input);

  // Keep pure power reactions for the hero when the current weapon attack is
  // already enough to destroy its ally target. Spending the reaction here
  // cannot improve the kill and only takes damage away from the opponent.
  if (
    link.targetAlly && power > 0 &&
    margin >= allyLethalThreshold(link.targetAlly, input)
  ) return -100;

  if (functional === "beckon steel|3") {
    return counters >= 2 && currentAttackHits(input) ? 100 : counters >= 2 ? 35 : 10;
  }
  if (functional === "slice up|1") {
    return counters > 0 && currentAttackHits(input) && input.view.players[1 - input.seat]!.handCount > 0
      ? 58
      : -5;
  }
  if (functional === "olé|3") return counters > 0 ? 65 : -100;
  if (functional === "polished blade|1") return counters > 0 ? 72 : -100;
  if (functional === "backside of the blade|3") return link.goAgain ? 62 : 12;
  if (functional.startsWith("big blinder|")) return hasFlurry(input) ? 25 : 55;
  if (functional === "provoke|3") return 42;
  if (functional === "shove off|3") return link.defendingCards.length > 0 ? 48 : -10;
  if (functional === "deadly display|1" || functional === "deadly display|3") {
    return sharpenedThisTurn(input) && !hasFlurry(input) ? 55 : 25;
  }

  const lethalGap = input.view.players[1 - input.seat]!.life - margin;
  const lethalBonus = power >= lethalGap ? 100 : 0;
  return 8 + power * 7 + lethalBonus - Math.max(0, margin - 5) * 3;
}

function setupScore(functional: string, data: CardData, input: BotPolicyInput): number {
  const counters = sharpenCount(input);
  const alreadyFlurry = hasFlurry(input);
  if (functional === "brimming blade|1") return 58 + (alreadyFlurry ? 8 : 0);
  if (functional === "drawn to the blade|2") return 62 + (counters >= 1 ? 25 : 0);
  if (functional.startsWith("edict of steel|")) {
    const threshold = data.pitch ?? 1;
    const makesFlurry = counters + 1 >= threshold;
    return 46 + (makesFlurry && !alreadyFlurry ? 30 : 0) - (alreadyFlurry ? 12 : 0);
  }
  if (functional.startsWith("cut n' carve|")) return 48 + (counters + 1 >= (data.pitch ?? 1) ? 12 : 0);
  if (functional.startsWith("sharp incline|")) return 43 + (counters + 1 >= (data.pitch ?? 1) ? 12 : 0);
  if (functional.startsWith("swordmaster's path|")) return 52;
  if (functional.startsWith("showdown|")) return alreadyFlurry ? 32 : 52;
  if (functional === "indefensibly honed|3") return 35 + (counters >= 2 ? 20 : 0);
  if (functional === "shuck|3" || functional === "visit the dawnsmith|3") return alreadyFlurry ? -10 : 4;
  return 0;
}

function scorePlay(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || !data) return -20;
  if (isOpeningTurn(input)) return -100;

  const functional = key(data);
  const me = input.view.players[input.seat];
  let score: number;

  if (intent.kind === "activate-ability") {
    if (data.cardType === "weapon") {
      const attackNumber = weaponAttacksThisTurn(input) + 1;
      score = 34 + (data.attack ?? card.attack ?? 0) + sharpenCount(input) * 3;
      if (attackNumber === 1 && sharpenedThisTurn(input)) score += 18;
      if (attackNumber === 1 && hasFlurry(input)) score += 25;
      if (attackNumber >= 2) score += 20;
      const futureCost = attackNumber === 1 && hasFlurry(input) ? 1 : 0;
      score += Math.min(futureCost, resourcesAfter(intent, data, input, own)) * 12;
    } else if (functional === "hala, bladesaint of the vow|0" || functional === "hala|0") {
      const hasSetupSequence = canSequenceHalaBeforeDrawn(intent, data, input, own) ||
        canSequenceHalaBeforeEdict(intent, data, input, own) ||
        canSequenceHalaBeforeAndAgain(intent, data, input, own);
      score = hasSetupSequence
        ? 110
        : canUseExtraActionPoint(input)
        ? 56
        : 22;
      const futureCost = hasFlurry(input) ? 2 : 1;
      score += Math.min(futureCost, resourcesAfter(intent, data, input, own)) * 12;
    } else if (functional === "gleam of the blade|1") {
      score = hasFlurry(input) ? -20 : 58;
    } else if (functional === "shelter from the storm|1") {
      score = opponentDamageEffectOnStack(input) ? 80 : -100;
    } else if (functional === "paragon plate|0") {
      score = canUseExtraActionPoint(input) && me.resources === 0 ? 28 : -20;
    } else if (functional === "ripple away|3") {
      score = shouldActivateRippleAway(input, card.instanceId) ? 80 : -100;
    } else {
      score = 2;
    }
  } else if (data.cardType === "attack-reaction") {
    score = scoreAttackReaction(data, input);
    if (zenithCanAttackAgain(input)) {
      const effectiveCost = functional === "swordmaster's shine|1"
        ? Math.max(0, Number(data.cost ?? 0) - sharpenCount(input))
        : Number(data.cost ?? 0);
      const excluded = new Set([card.instanceId, ...pitchIds(intent)]);
      const continuationResources = resourcesAfterCost(intent, effectiveCost, input, own) +
        remainingPitchValue(input, excluded);
      if (continuationResources < 1) score = -100;
    }
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input);
  } else if (functional === "toe the line|1") {
    score = shouldPlayToeTheLine(input) ? (hasFlurry(input) ? 35 : 60) : -100;
  } else if (isAttack(data)) {
    score = (data.attack ?? 0) * 5;
    if (weaponAttacksThisTurn(input) > 0) score += 28;
    if (/discard|arsenal/i.test(data.text)) score += 18;
    if (functional === "overcrowded|3") score += me.board.length * 2;
  } else {
    score = setupScore(functional, data, input);
    if (canSequencePathBeforeYellowEdict(intent, data, input, own)) {
      score = Math.max(score, 110);
    }
    if (functional === "drawn to the blade|2" && !canFundZenithAfterPlay(intent, card, data, input, own)) {
      score = -30;
    }
    if (functional.startsWith("edict of steel|")) {
      score = canFundZenithAfterPlay(intent, card, data, input, own)
        ? Math.max(score, 90)
        : -30;
    }
  }

  const after = resourcesAfter(intent, data, input, own);
  if (data.cardType === "action" && !isAttack(data) && hasFlurry(input)) {
    score += Math.min(2, after) * 5;
  }
  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= cardOpportunity(pitched, input);
  }
  return score;
}

/** Deterministic Hala policy. */
function chooseHalaReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: nextTurnArsenalValue,
  });
}

export interface HalaTurnEvaluation {
  score: number;
  damage: number;
  allyValue: number;
  sharpenCounters: number;
  flurry: boolean;
  projectedDamage: number;
  projectedSwordAttacks: number;
  flurryAttackValue: number;
  vigor: number;
  futureValue: number;
  unusedSetups: number;
  complete: boolean;
}

export type HalaTurnPlan = TurnPlan<HalaTurnEvaluation>;

function evaluateHalaTurn(
  state: GameState,
  input: BotPolicyInput,
  root: TurnPlannerRoot,
  complete: boolean,
  allyTargets: readonly HalaAllyTarget[] = [],
): HalaTurnEvaluation {
  const me = input.view.players[root.seat];
  const opponent = input.view.players[1 - root.seat]!;
  const damage = Math.max(0, root.opponentLife - opponent.life);
  const opponentResponse = evaluateOpponentResponse(input, root);
  const future = evaluateTurnFuture(input, root, {
    cardOpportunity,
    nextTurnArsenal: nextTurnArsenalValue,
  });
  const blade = me.weapons.find((card) => key(root.cards[card.cardId]) === "zenith blade|0");
  const sharpenCounters = Number(blade?.counters?.power ?? 0);
  const flurry = me.board.some((card) => key(root.cards[card.cardId]) === "flurry|0");
  const remainingCards = [...me.hand, ...me.arsenal, ...me.weapons];
  const conversion = complete
    ? { damage: 0, swordAttacks: 0, swordDamage: 0, reactionDamage: 0 }
    : estimateHalaConversion(remainingCards, input);
  const flurryAttackValue = complete
    ? 0
    : estimateFlurryAttackValue(remainingCards, input, conversion);
  const vigor = me.board.filter((card) => key(root.cards[card.cardId]) === "vigor|0").length;
  const unusedSetups = input.view.ongoing.filter((effect) =>
    effect.seat === root.seat && effect.label.includes("next attack")
  ).length;
  const winnerScore = state.winner === root.seat
    ? 1_000_000
    : state.winner === 1 - root.seat
    ? -1_000_000
    : 0;
  const allyValue = destroyedAllyValue(allyTargets, input);
  const score = winnerScore
    + responseWeightedDamage(opponentResponse) * 100
    + allyValue
    + future.score
    + vigor * 8
    - unusedSetups * 18
    - (complete ? me.resources * 4 : 0);
  return {
    score,
    damage,
    allyValue,
    sharpenCounters,
    flurry,
    projectedDamage: conversion.damage,
    projectedSwordAttacks: conversion.swordAttacks,
    flurryAttackValue,
    vigor,
    futureValue: future.score,
    unusedSetups,
    complete,
  };
}

export interface HalaIntentDecision {
  intent: GameIntent;
  plan?: HalaTurnPlan;
}

// Hala's candidate preparation removes equivalent pitch payments and orders
// the tactical roots. Keep both deterministic budgets comfortably below the
// server worker deadline: post-chain hands can make each simulated transition
// expensive even after equivalent payments are collapsed. An unresolved
// high-threshold Flurry conversion retains extra depth to prove both swings.
const HALA_MAX_SEARCH_NODES = 48;
const HALA_MAX_TRANSITIONS = 128;
const HALA_DEEP_MAX_SEARCH_NODES = 72;
const HALA_DEEP_MAX_TRANSITIONS = 192;
const HALA_MAX_ROOT_CANDIDATES = 5;

function needsDeepHalaSearch(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  const visible = [...me.hand, ...me.arsenal];
  const counters = sharpenCount(input);
  const unresolvedThreshold = visible.some((card) => {
    const data = input.cards[card.cardId];
    const threshold = sharpenThreshold(data);
    return createsFlurry(data) && threshold !== undefined &&
      counters + 1 < threshold;
  });
  if (!unresolvedThreshold) return false;
  const multiplierVisible = visible.some((card) => doublesNextSharpen(input.cards[card.cardId]));
  const multiplierActive = input.view.ongoing.some((effect) =>
    effect.seat === input.seat && doublesNextSharpen(input.cards[effect.cardId])
  );
  return !multiplierVisible && !multiplierActive;
}

/** Clean action phases use the shared bounded whole-turn planner. Reaction,
 * prevention, and choice windows stay on the deterministic reactive policy. */
function chooseUnfinalizedHalaIntentWithTrace(input: BotPolicyInput): HalaIntentDecision {
  // This is a rules-aware constraint, not a tunable preference. Once the
  // resolving threshold is met, the turn planner must not trade away armor
  // and a resource for one nonlethal damage.
  const rerebraceDecline = forcedRerebraceDecline(input);
  if (rerebraceDecline) return { intent: rerebraceDecline };
  if (isOpeningTurn(input)) return { intent: chooseHalaReactiveIntent(input) };
  const powerTurn = edictShinePowerTurnIntent(input);
  if (powerTurn) return { intent: powerTurn };
  const multiplierSwordTurn = sharpenMultiplierSwordTurnIntent(input);
  if (multiplierSwordTurn) return { intent: multiplierSwordTurn };
  const multiplierTurn = sharpenMultiplierPowerTurnIntent(input);
  if (multiplierTurn) return { intent: multiplierTurn };
  const conversionGuardrail = sharpenBeforeAdditionalSwingIntent(input);
  if (conversionGuardrail) return { intent: conversionGuardrail };
  const attackSetup = setupForSwordThenTwoCostAttackIntent(input);
  if (attackSetup) return { intent: attackSetup };
  const drawnAfterBrimming = drawnAfterBrimmingIntent(input);
  if (drawnAfterBrimming) return { intent: drawnAfterBrimming };
  const halaBeforeSetup = halaBeforeThresholdSetupIntent(input);
  if (halaBeforeSetup) return { intent: halaBeforeSetup };
  const preSwordSharpen = preFirstSwordSharpenIntent(input);
  if (preSwordSharpen) return { intent: preSwordSharpen };
  const swordBeforeAttack = swordBeforeTwoCostAttackIntent(input);
  if (swordBeforeAttack) return { intent: swordBeforeAttack };
  const allyKill = lethalAllySwordIntent(input);
  if (allyKill) return { intent: allyKill };
  const attackAfterSword = twoCostAttackAfterSwordIntent(input);
  if (attackAfterSword) return { intent: attackAfterSword };
  // Reactive scoring can inspect every payment variant. Defer it until the
  // deterministic tactical guardrails have had a chance to answer.
  const reactive = chooseHalaReactiveIntent(input);
  const allyTargets = halaAllyTargets(input);
  const deepSearch = needsDeepHalaSearch(input);
  const plan = planTurn(input, {
    maxSearchNodes: deepSearch ? HALA_DEEP_MAX_SEARCH_NODES : HALA_MAX_SEARCH_NODES,
    maxTransitions: deepSearch ? HALA_DEEP_MAX_TRANSITIONS : HALA_MAX_TRANSITIONS,
    maxRootCandidates: HALA_MAX_ROOT_CANDIDATES,
    chooseForced: (forced) => chooseHalaReactiveIntent({ ...forced, state: undefined }),
    cardOpportunity,
    prepareCandidates: (candidates, observed) => prepareHalaCandidates(candidates, observed),
    scoreIntent(intent, observed) {
      const card = intentCard(intent, ownCards(observed));
      const wastesToe = card !== undefined &&
        key(observed.cards[card.cardId]) === "toe the line|1" &&
        !shouldPlayToeTheLine(observed);
      return wastesToe ? Number.NEGATIVE_INFINITY : 0;
    },
    evaluateEnd: (state, observed, root, complete) =>
      evaluateHalaTurn(state, observed, root, complete, allyTargets),
    evaluateHorizon(state, observed, root) {
      const base = evaluateHalaTurn(state, observed, root, false, allyTargets);
      return {
        ...base,
        score: base.score + base.projectedDamage * 80,
        complete: false,
      };
    },
  });
  return plan ? { intent: plan.intent, plan } : { intent: reactive };
}

export function chooseHalaIntentWithTrace(input: BotPolicyInput): HalaIntentDecision {
  const decision = chooseUnfinalizedHalaIntentWithTrace(input);
  const intent = enforceHalaAllyPolicy(
    input,
    enforceSpectraPolicy(input, decision.intent),
  );
  return decision.plan ? { intent, plan: decision.plan } : { intent };
}

export function chooseHalaIntent(input: BotPolicyInput): GameIntent {
  return chooseHalaIntentWithTrace(input).intent;
}
