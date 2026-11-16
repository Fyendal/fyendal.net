import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import { damageWorthOasis, lifeGainAlternative, scoreOasisChoice } from "./bravo-policy.js";
import { BLOCK_USE_RATE, TYPICAL_INCOMING } from "./card-ev.js";
import {
  chooseScoredIntent,
  continuationResources,
  currentAttackIsOurs,
  currentLink,
  enforceAllyTargetPolicy,
  enforceSpectraPolicy,
  functionalKey as key,
  intentCard,
  isAttack,
  isOpeningTurn,
  optionCard,
  ownCards,
  pendingDefenseReactionValue,
  pitchIds,
  reactionDefense,
  remainingPitchValue,
  resourcePaymentPitchIds,
  responseEvaluation,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  scoreTacticalRoot,
  type BotPolicyInput,
  type HeroCycleModel,
  type ResponseModel,
} from "./policy.js";
import { weaponCost as printedWeaponCost } from "./card-model.js";
import { dorintheaSolverRules, printedPump } from "./dorinthea-rules.js";
import {
  arsenalValuer,
  defenseReactionStopsEnough,
  defenseReactionWorthSpending,
  opportunityValuer,
  solveHand,
} from "./hand-value.js";
import { chooseTacticalIntentWithTrace, type TacticalTurnPlan } from "./tactical-turn-planner.js";
import { hasType } from "@fyendal/shared";

const HALVE_DEFENSE_PROMPT = "card.dtd.defender.defense.halve";
const BOLTERS_PROMPT = "card.wtr.bolters.destroy";
const WEAPON_SETUP = new Set(["felling swing", "sharpen steel", "hit and run"]);

const named = (data: CardData | undefined): string => data?.name.trim().toLowerCase() ?? "";

const cardOpportunity = opportunityValuer(dorintheaSolverRules);

function weapon(input: BotPolicyInput): CardView | undefined {
  return input.view.players[input.seat].weapons[0];
}

function weaponCost(input: BotPolicyInput): number {
  const data = input.cards[weapon(input)?.cardId ?? ""];
  return data ? printedWeaponCost(data) : 0;
}

/** The weapon can still attack this turn if its cost is paid. */
function weaponReady(input: BotPolicyInput): boolean {
  const axe = weapon(input);
  return !!axe && input.view.activePlayer === input.seat &&
    input.view.turnFacts?.players[input.seat].weaponAttacksProhibited !== true &&
    (!axe.usedAbilityIndexes?.includes(0) || input.legal.some((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === axe.instanceId
    ));
}

function weaponAttacksThisTurn(input: BotPolicyInput): number {
  return input.view.turnFacts?.players[input.seat].weaponAttacks ?? 0;
}

function currentAttackIsOurWeapon(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  return !!link && link.attackingCard.owner === input.seat &&
    hasType(input.cards[link.attackingCard.cardId], "weapon");
}

/** Reprise: the defending hero defended this link with a card from hand. */
function reprise(input: BotPolicyInput): boolean {
  return currentLink(input)?.defendingCards.some((card) =>
    !hasType(input.cards[card.cardId], "equipment")
  ) === true;
}

function reactionPower(data: CardData, input: BotPolicyInput): number {
  const pump = printedPump(data);
  switch (named(data)) {
    case "overpower": return pump + (reprise(input) ? 2 : 0);
    case "ironsong response": return reprise(input) ? pump : 0;
    default: return pump;
  }
}

function scoreAttackReaction(data: CardData, input: BotPolicyInput): number {
  const link = currentLink(input);
  if (!link || !currentAttackIsOurs(input) || input.view.pendingDecision?.kind !== "attack-reaction") return -100;
  if (named(data) !== "fatal engagement" && !currentAttackIsOurWeapon(input)) return -100;
  const power = reactionPower(data, input);
  const margin = link.attackValue - link.defenseValue;
  const added = Math.min(power, power + margin);
  if (added <= 0) return -100;
  const opponent = input.view.players[1 - input.seat]!;
  const lethal = Math.max(0, margin) + added >= opponent.life;
  // Turning a blocked swing into a hit also earns Dorinthea's second attack.
  const breaksThrough = margin <= 0 && weaponAttacksThisTurn(input) <= 1;
  return 8 + added * 7 + (lethal ? 100 : 0) + (breaksThrough ? 5 : 0);
}

/** Go again on the weapon pays only if the action point can be spent:
 * `budget` is every resource and unspent hand pitch left after the swing. */
function canUseExtraActionPoint(input: BotPolicyInput, spent: ReadonlySet<number>, budget: number): boolean {
  const me = input.view.players[input.seat];
  if (me.heroAbilitiesLost !== true && weaponAttacksThisTurn(input) <= 1 && budget >= weaponCost(input)) return true;
  const affordable = (card: CardView, ownPitch: number): boolean => {
    const data = input.cards[card.cardId];
    return !spent.has(card.instanceId) && isAttack(data) && budget - ownPitch >= (data?.cost ?? 0);
  };
  return me.hand.some((card) => affordable(card, Number(input.cards[card.cardId]?.pitch ?? 0))) ||
    me.arsenal.some((card) => affordable(card, 0));
}

function scoreSetup(
  intent: GameIntent,
  card: CardView,
  data: CardData,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const cost = Math.max(0, data.cost ?? 0);
  const afterSwing = continuationResources(intent, cost, input, own, [card.instanceId]) - weaponCost(input);
  if (!weaponReady(input) || afterSwing < 0) return -100;
  if (named(data) === "felling swing" && !input.cards[weapon(input)!.cardId]?.subtypes?.includes("axe")) return -100;
  if (named(data) !== "hit and run") return 40 + printedPump(data);
  return canUseExtraActionPoint(input, new Set([card.instanceId, ...pitchIds(intent)]), afterSwing) ? 38 : -100;
}

function scorePlay(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const card = intentCard(intent, own);
  const data = card && input.cards[card.cardId];
  if (!card || !data) return -100;
  const me = input.view.players[input.seat];
  const mine = input.view.activePlayer === input.seat;
  const functional = key(data);
  const spent = new Set([card.instanceId, ...pitchIds(intent)]);
  // Opening hands refill, so swing freely but keep one card for arsenal.
  if (isOpeningTurn(input) && me.arsenal.length === 0 && me.hand.every((held) => spent.has(held.instanceId))) {
    return -100;
  }

  let score: number;
  if (intent.kind === "activate-ability") {
    if (hasType(data, "weapon")) {
      score = mine ? 30 + (card.attack ?? data.attack ?? 0) : -100;
    } else if (named(data) === "gold") {
      // Cash floating resources only; never pitch a card for the draw.
      score = mine && pitchIds(intent).length === 0 && !weaponReady(input) ? 6 : -100;
    } else {
      score = -100;
    }
  } else if (hasType(data, "attack-reaction")) {
    score = scoreAttackReaction(data, input);
  } else if (hasType(data, "defense-reaction")) {
    score = scoreDefenseReactionPlay(card, data, intent, input);
  } else if (functional === "oasis respite|1") {
    const damage = damageWorthOasis(input);
    score = damage > 0 ? 60 + Math.min(damage, 4) * 10 : -100;
  } else if (functional === "arcane polarity|1") {
    score = input.view.turnFacts?.players[input.seat].arcaneDamageTaken ? 28 : -100;
  } else if (WEAPON_SETUP.has(named(data))) {
    score = mine ? scoreSetup(intent, card, data, input, own) : -100;
  } else if (isAttack(data)) {
    // Attack action cards are blocks first; they attack only with an action
    // point the Axe cannot use.
    score = mine ? 12 + (card.attack ?? data.attack ?? 0) : -100;
  } else {
    score = -100;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (!pitched) continue;
    score -= 2 + cardOpportunity(pitched, input) * 0.5;
    // A defense reaction pitched on the opponent's turn is a block thrown away.
    if (!mine && hasType(input.cards[pitched.cardId], "defense-reaction")) score -= 20;
  }
  return score - Math.max(0, pitchIds(intent).length - 1) * 10;
}

/** Play style: the base swing counts in full, but everything a kept card
 * adds on top is worth half the damage it could block instead. */
const PUMP_RESPONSE_WEIGHT = 0.5;

const dorintheaResponse: ResponseModel = {
  offensiveCards: (input) => [
    ...input.view.players[input.seat].hand, ...input.view.players[input.seat].arsenal,
  ],
  evaluateResponse(cards, input) {
    const result = solveHand(cards, input, dorintheaSolverRules);
    const axe = weapon(input);
    const swings = result.line.some((step) => step.kind === "weapon");
    const swing = swings ? Math.max(0, axe?.attack ?? input.cards[axe?.cardId ?? ""]?.attack ?? 0) : 0;
    const extra = result.damage + result.onHit - result.consumedValue - swing;
    return responseEvaluation({
      damageThreatened: swing + extra * PUMP_RESPONSE_WEIGHT,
      futureHandValue: result.leftoverValue * PUMP_RESPONSE_WEIGHT,
    });
  },
};

/** The hand left after spending `spent` still pitches for next turn's swing. */
function keepsWeaponFunded(input: BotPolicyInput, spent: ReadonlySet<number>): boolean {
  return remainingPitchValue(input, spent) >= weaponCost(input);
}

const dorintheaDefense: HeroCycleModel = { cardOpportunity, ...dorintheaResponse };

/** Block-first: stop damage even after the shared scorer, which declines
 * once the blocks already survive, would hold the reaction. */
function scoreDefenseReactionPlay(card: CardView, data: CardData, intent: GameIntent, input: BotPolicyInput): number {
  if (!defenseReactionWorthIt(card, intent, input)) return -100;
  // Paying with the swing's pitch costs the swing, at the scorer's 4 per damage.
  const unfunds = keepsWeaponFunded(input, new Set()) &&
    !keepsWeaponFunded(input, new Set([card.instanceId, ...pitchIds(intent)]));
  const swingLost = unfunds ? 4 * Math.max(0, input.cards[weapon(input)?.cardId ?? ""]?.attack ?? 0) : 0;
  const shared = scoreDefenseReaction(data, input, card);
  const link = currentLink(input);
  if (shared > -100 || !link || input.view.pendingDecision?.kind !== "defense-reaction") return shared - swingLost;
  const incoming = Math.max(0, link.damage - pendingDefenseReactionValue(input));
  const defense = reactionDefense(card, input);
  if (incoming === 0) return -100;
  return 20 + Math.min(incoming, defense) * 4 - Math.max(0, defense - incoming) * 1.5 - swingLost;
}

/** A defense reaction is free to spend while the swing stays funded. */
function defenseReactionWorthIt(card: CardView, intent: GameIntent, input: BotPolicyInput): boolean {
  const pitched = pitchIds(intent);
  if (defenseReactionWorthSpending(card, input, dorintheaSolverRules, pitched)) return true;
  const defense = Math.max(0, card.defense ?? input.cards[card.cardId]?.defense ?? 0);
  return defenseReactionStopsEnough(input, defense) &&
    keepsWeaponFunded(input, new Set([card.instanceId, ...pitched]));
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  const oasis = scoreOasisChoice(intent, input);
  if (oasis !== undefined) return oasis;
  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, arsenalValuer(dorintheaSolverRules));
  }
  const card = optionCard(intent, input);
  if (decision.promptMessage?.id === HALVE_DEFENSE_PROMPT) {
    // Halving rounds up, so the card loses the floor of half its defense.
    return card ? Math.floor(Math.max(0, card.defense ?? input.cards[card.cardId]?.defense ?? 0) / 2) : 0;
  }
  if (decision.promptMessage?.id === BOLTERS_PROMPT) {
    const budget = input.view.players[input.seat].resources + remainingPitchValue(input, new Set());
    const useful = canUseExtraActionPoint(input, new Set(), budget);
    return intent.optionId === "yes" ? (useful ? 50 : -50) : 0;
  }
  const payment = resourcePaymentPitchIds(intent, input);
  if (payment !== undefined) {
    const own = ownCards(input);
    const pitchCost = payment.reduce((sum, id) => {
      const pitched = own.get(id);
      return sum + (pitched ? cardOpportunity(pitched, input) : 0);
    }, 0);
    const link = currentLink(input);
    const lethal = link?.attackingCard.owner === input.seat &&
      link.attackValue >= input.view.players[1 - input.seat]!.life;
    return (lethal ? 100 : 5) - payment.length * 10 - pitchCost * 2;
  }
  const binary = scoreBinaryChoice(intent.optionId, 4, 0);
  if (binary !== undefined) return binary;
  if (/discard|pitch/i.test(decision.prompt)) return scoreSpendCardChoice(intent, input, cardOpportunity);
  return card ? cardOpportunity(card, input) : 0;
}

/** The shared chooser pays with the highest color; on defense the reds go
 * first so the blue that funds the swing stays in hand. */
function chooseDefenseReaction(input: BotPolicyInput): GameIntent | undefined {
  if (input.view.pendingDecision?.kind !== "defense-reaction") return undefined;
  const own = ownCards(input);
  let best: { intent: GameIntent; score: number } | undefined;
  for (const intent of input.legal) {
    const card = intentCard(intent, own);
    if (!card || !hasType(input.cards[card.cardId], "defense-reaction")) continue;
    const score = scorePlay(intent, input, own);
    if (score > (best?.score ?? 0)) best = { intent, score };
  }
  return best?.intent;
}

/** Until the opponent's end phase another attack may come (most arcane
 * damage arrives with or before one), so a held card can still block. */
function opponentCanStillAttack(input: BotPolicyInput): boolean {
  return input.view.activePlayer !== input.seat && input.view.phase !== "end";
}

/** Arcane Barrier pricing: a pitched card also gives up its Arcane Polarity
 * life and, while attacks are still coming, the block it would have made. */
const dorintheaBarrierResponse: ResponseModel = {
  offensiveCards: dorintheaResponse.offensiveCards,
  evaluateResponse(cards, input) {
    const response = dorintheaResponse.evaluateResponse(cards, input);
    const handIds = new Set(input.view.players[input.seat].hand.map((card) => card.instanceId));
    const blocking = opponentCanStillAttack(input);
    const kept = cards.filter((card) => handIds.has(card.instanceId)).reduce((total, card) => {
      const data = input.cards[card.cardId];
      const block = blocking
        ? Math.min(Math.max(0, card.defense ?? data?.defense ?? 0), TYPICAL_INCOMING) * BLOCK_USE_RATE
        : 0;
      return total + block + (data ? lifeGainAlternative(data, input, true) : 0);
    }, 0);
    return responseEvaluation({ ...response, boardValue: response.boardValue + kept });
  },
};

/** Take non-lethal arcane damage unprevented while a held Arcane Polarity
 * would gain more life than the barrier stops. */
function declineBarrierForPolarity(input: BotPolicyInput): GameIntent | undefined {
  const decision = input.view.pendingDecision;
  if (decision?.promptMessage?.id !== "engine.decision.damage.arcane.barrier") return undefined;
  const me = input.view.players[input.seat];
  const incoming = decision.promptMessage.values?.amount;
  if (typeof incoming !== "number" || incoming >= me.life) return undefined;
  if (input.view.turnFacts?.players[input.seat].arcaneDamageTaken) return undefined;
  const polarity = me.hand.map((card) => input.cards[card.cardId]).find((data) => named(data) === "arcane polarity");
  if (!polarity) return undefined;
  // Damage the barrier cannot fully stop turns Arcane Polarity on anyway.
  const stoppable = Math.max(0, ...input.legal.map((intent) =>
    intent.kind === "choose" ? Number(/^pay (\d+)$/.exec(intent.optionId)?.[1] ?? 0) : 0
  ));
  const extraLife = lifeGainAlternative(polarity, input, true) - lifeGainAlternative(polarity, input, false);
  if (stoppable < incoming || extraLife < incoming) return undefined;
  return input.legal.find((intent) => intent.kind === "choose" && intent.optionId === "pay 0");
}

function chooseReactive(input: BotPolicyInput): GameIntent {
  const forced = declineBarrierForPolarity(input) ?? chooseDefenseReaction(input);
  if (forced) return forced;
  return chooseScoredIntent(input, {
    play: scorePlay,
    // The response model already prices the arsenal card a block gives up.
    nextTurnArsenal: input.view.pendingDecision?.kind === "defend" ? () => 0 : arsenalValuer(dorintheaSolverRules),
    response: dorintheaBarrierResponse,
    defend: (intent, observed, own) => scoreDefenseIntent(intent, observed, own, dorintheaDefense),
    choose: scoreChoice,
  });
}

export interface DorintheaIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
}

/** Deterministic Dorinthea policy: block with everything the Axe does not
 * need, then set up and swing Decimator Great Axe every turn. */
export function chooseDorintheaIntentWithTrace(input: BotPolicyInput): DorintheaIntentDecision {
  const reactive = chooseReactive(input);
  const decision = chooseTacticalIntentWithTrace(input, reactive, {
    chooseForced: (forced) => chooseReactive({ ...forced, state: undefined }),
    rules: dorintheaSolverRules,
    rankCandidate: (intent, observed) => scoreTacticalRoot(intent, observed, scorePlay),
    rootScore: (intent, observed) => scoreTacticalRoot(intent, observed, scorePlay),
  });
  const intent = enforceAllyTargetPolicy(input, enforceSpectraPolicy(input, decision.intent));
  return decision.plan ? { intent, plan: decision.plan } : { intent };
}

export function chooseDorintheaIntent(input: BotPolicyInput): GameIntent {
  return chooseDorintheaIntentWithTrace(input).intent;
}
