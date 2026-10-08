import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  chooseScoredIntent,
  enforceAllyTargetPolicy,
  enforceSpectraPolicy,
  intentCard,
  isAttack,
  optionCard,
  ownCards,
  pitchIds,
  resourcePaymentPitchIds,
  responseEvaluation,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  type BotPolicyInput,
} from "./policy.js";
import { chooseTacticalIntentWithTrace, type TacticalTurnPlan } from "./tactical-turn-planner.js";

function name(data: CardData | undefined): string {
  return data?.name.toLowerCase() ?? "";
}

function ownBanishedSix(input: BotPolicyInput): number {
  return input.view.players[input.seat].banish.filter((card) =>
    (input.cards[card.cardId]?.attack ?? 0) >= 6
  ).length;
}

function ownBloodDebt(input: BotPolicyInput): number {
  return input.view.players[input.seat].banish.filter((card) =>
    input.cards[card.cardId]?.keywords?.includes("Blood Debt")
  ).length;
}

function hasGate(input: BotPolicyInput): boolean {
  return input.view.players[input.seat].board.some((card) =>
    name(input.cards[card.cardId]) === "gate to i'arathael"
  );
}

function attackReserve(input: BotPolicyInput, spent: ReadonlySet<number>): CardView[] {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal, ...me.banish].filter((card) =>
    !spent.has(card.instanceId) && isAttack(input.cards[card.cardId])
  );
}

function cardOpportunity(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!data) return 0;
  const named = name(data);
  if (named === "bloodrush bellow") return 9;
  if (named === "cleave the heavens") return 8;
  if (named === "feeding frenzy" || named === "shadowrealm horror") return 8;
  if (named === "call to the grave") return 5;
  if (isAttack(data)) return (data.attack ?? 0) + (data.pitch === 3 ? 1 : 0);
  return Math.max(1, data.pitch ?? 0);
}

function nextTurnArsenal(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  const named = name(data);
  if (named === "bloodrush bellow") return 70;
  if (named === "goremass summoning" || named === "call to the grave") return 48;
  if (named === "shadowrealm horror" || named === "feeding frenzy") return 42;
  if (named === "cleave the heavens" || named === "blood harvest") return 38;
  return isAttack(data) ? (data?.attack ?? 0) * 4 : data?.pitch ?? 0;
}

/** Projection-only hand value for blocks and the bounded next-action rollout. */
function estimateDamage(cards: readonly CardView[], input: BotPolicyInput): number {
  const attacks = cards.filter((card) => isAttack(input.cards[card.cardId]));
  const pitch = cards.filter((card) => (input.cards[card.cardId]?.pitch ?? 0) >= 2).length;
  const gate = hasGate(input) ? 2 : 0;
  const bloodrush = cards.some((card) => name(input.cards[card.cardId]) === "bloodrush bellow");
  const best = attacks.reduce((value, card) => Math.max(value, input.cards[card.cardId]?.attack ?? 0), 0);
  const second = attacks.length > 1 && pitch > 0 ? Math.min(6, attacks.length * 2) : 0;
  return best + second + gate + (bloodrush && attacks.length > 0 ? 4 : 0);
}

function scorePlay(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const card = intentCard(intent, own);
  const data = card && input.cards[card.cardId];
  if (!card || !data) return -100;
  const named = name(data);
  const me = input.view.players[input.seat];
  const spent = new Set([card.instanceId, ...pitchIds(intent)]);
  const followup = attackReserve(input, spent);
  const banishedSix = ownBanishedSix(input);
  let score: number;

  if (named === "gate to i'arathael") {
    score = followup.length > 0 || me.resources > 0 ? 100 : 48;
  } else if (named === "cleave the heavens" && intent.kind === "activate-ability") {
    score = !hasGate(input) ? 96 : 53;
  } else if (named === "blood harvest" && intent.kind === "activate-ability") {
    score = me.resources < 3 && followup.length > 0 ? 84 : -35;
  } else if (named === "bloodrush bellow") {
    score = followup.length > 0 ? 72 + Math.min(followup.length, 2) * 8 : -60;
  } else if (named === "call to the grave") {
    score = me.graveyard.length < 6 ? 58 : 38;
  } else if (named === "pull from beyond") {
    score = !hasGate(input) ? 60 : 42;
  } else if (named === "goremass summoning") {
    // The projection does not expose when a six-power card was banished.
    // Treat this as a spare go-again setup play, never ahead of a real attack.
    score = banishedSix > 0 ? 24 : -20;
  } else if (named === "doomsday") {
    score = 75;
  } else if (named === "scabskin leathers") {
    score = followup.length > 1 && me.life > 5 ? 53 : -55;
  } else if (named === "fyendal's spring tunic") {
    score = followup.length > 0 ? 32 : -30;
  } else if (named === "hex gauntlet" || named === "embraforged gauntlet") {
    score = followup.length > 0 ? 35 : -35;
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input);
  } else if (isAttack(data) || data.cardType === "weapon") {
    score = 22 + (data.attack ?? 0) * 2;
    if (["feeding frenzy", "dread screamer", "shadowrealm horror"].includes(named) && followup.length > 0) {
      score += 20;
    }
    if (named === "hexagore, the death hydra") {
      const selfDamage = Math.max(0, 6 - ownBloodDebt(input));
      score -= selfDamage * (me.life <= 9 ? 15 : 5);
      if (selfDamage >= me.life) score -= 1_000;
      else if ((data.attack ?? 0) >= input.view.players[1 - input.seat]!.life) score += 120;
    }
    if (named === "ravenous meataxe" && followup.length > 0) score -= 12;
  } else {
    score = -30;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= cardOpportunity(pitched, input) * 0.7 + 1;
  }
  return score;
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  if (input.view.pendingDecision?.kind === "arsenal") return scoreArsenalChoice(intent, input, nextTurnArsenal);
  const payment = resourcePaymentPitchIds(intent, input);
  if (payment !== undefined) {
    const own = ownCards(input);
    return 10 - payment.reduce((sum, id) => {
      const card = own.get(id);
      return sum + (card ? cardOpportunity(card, input) : 0);
    }, 0);
  }
  const prompt = input.view.pendingDecision?.prompt.toLowerCase() ?? "";
  const card = optionCard(intent, input);
  if (prompt.includes("call to the grave") && name(input.cards[card?.cardId ?? ""]) === "beast within") return 90;
  if (/discard|pitch|banish.*hand/.test(prompt)) return scoreSpendCardChoice(intent, input, cardOpportunity);
  const binary = scoreBinaryChoice(intent.optionId, 12, 0);
  if (binary !== undefined) return binary;
  if (card) {
    const data = input.cards[card.cardId];
    return cardOpportunity(card, input) + (data?.keywords?.includes("Blood Debt") ? 3 : 0);
  }
  return 0;
}

function chooseReactive(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    play: scorePlay,
    choose: scoreChoice,
    nextTurnArsenal,
    defend: (intent, observed, own) => scoreDefenseIntent(intent, observed, own, {
      cardOpportunity,
      offensiveCards: (policy) => [
        ...policy.view.players[policy.seat].hand, ...policy.view.players[policy.seat].arsenal,
      ],
      evaluateResponse: (cards, policy) => responseEvaluation({
        damageThreatened: estimateDamage(cards, policy),
        strategicAdjustment: ownBloodDebt(policy) > 0 && cards.length === 0 ? -4 : 0,
      }),
      responseLossWeight: 1.1,
    }),
  });
}

export interface LeviaIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
}

export function chooseLeviaIntentWithTrace(input: BotPolicyInput): LeviaIntentDecision {
  const reactive = chooseReactive(input);
  const decision = chooseTacticalIntentWithTrace(input, reactive, {
    chooseForced: (forced) => chooseReactive({ ...forced, state: undefined }),
    cardOpportunity,
    nextTurnArsenal,
    estimateRemaining: estimateDamage,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    rootScore: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
  });
  const intent = enforceAllyTargetPolicy(input, enforceSpectraPolicy(input, decision.intent));
  return decision.plan ? { intent, plan: decision.plan } : { intent };
}

export function chooseLeviaIntent(input: BotPolicyInput): GameIntent {
  return chooseLeviaIntentWithTrace(input).intent;
}
