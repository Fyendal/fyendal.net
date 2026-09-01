import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  chooseScoredIntent,
  currentAttackIsOurs,
  currentLink,
  enforceSpectraPolicy,
  functionalKey as key,
  intentCard,
  isAttack,
  optionCard,
  ownCards,
  pitchIds,
  resourcesAfterCost,
  responseEvaluation,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  shouldPreserveOpeningHand,
  spendsOpeningArsenalReserve,
  type BotPolicyInput,
} from "./policy.js";
import {
  chooseTacticalIntentWithTrace,
  type TacticalTurnPlan,
} from "./tactical-turn-planner.js";

function attackCost(data: CardData): number {
  return data.cardType === "weapon" ? 3 : Math.max(0, data.cost ?? 0);
}

function attackValue(data: CardData, input: BotPolicyInput): number {
  let value = data.attack ?? 0;
  const text = data.text.toLowerCase();
  if (text.includes("put a card from their hand on top")) value += 5;
  else if (text.includes("put a card from their arsenal")) value += 4;
  else if (text.includes("put a -1") && text.includes("equipment")) value += 3;
  else if (text.includes("costs an additional")) value += 3;
  else if (text.includes("can't gain") || text.includes("gets -2")) value += 3;
  if (data.keywords?.includes("Dominate")) value += 2;
  if (key(data) === "fault line|1" && input.view.players[input.seat].arsenalCount > 0) value += 1;
  return value;
}

function cardOpportunity(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!data) return 0;
  const functional = key(data);
  if (functional === "staunch response|1") return 10;
  if (functional === "pummel|1") return 9;
  if (functional === "oasis respite|1") return 8;
  if (functional === "arcane polarity|1") {
    return input.view.turnFacts?.players[input.seat].arcaneDamageTaken ? 8 : 2;
  }
  if (isAttack(data)) return attackValue(data, input);
  if (data.cardType === "block") return Math.max(2, data.defense ?? 0);
  return Math.max(1, data.pitch ?? 0, data.defense ?? 0);
}

/** Best attack that can be funded by one other held card. This is the two-card
 * line Bravo protects while committing the rest of its hand to defense. */
function estimateBravoDamage(cards: readonly CardView[], input: BotPolicyInput): number {
  const unique = [...new Map(cards.map((card) => [card.instanceId, card])).values()];
  const resources = input.view.players[input.seat].resources;
  let best = 0;
  for (const attack of unique) {
    const data = input.cards[attack.cardId];
    if (!data || !(isAttack(data) || data.cardType === "weapon")) continue;
    const cost = attackCost(data);
    const canPay = cost <= resources || unique.some((pitch) =>
      pitch.instanceId !== attack.instanceId &&
      resources + Number(input.cards[pitch.cardId]?.pitch ?? 0) >= cost
    );
    if (canPay) best = Math.max(best, attackValue(data, input));
  }
  return best;
}

function offensiveCards(input: BotPolicyInput): readonly CardView[] {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal, ...me.weapons];
}

/** Static Shock asks Bravo to spend a card either now for three physical
 * defense or later as Arcane Barrier pitch for only one prevention. When its
 * Lightning Flow on-hit is represented and a three-block is available, take
 * the efficient use of the card during defense. */
function shouldBlockStaticShockWithThree(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  const attack = input.cards[link?.attackingCard.cardId ?? ""];
  if (attack?.name.trim().toLowerCase() !== "static shock") return false;
  if (!link?.onHitEffects?.some((effect) => /arcane damage/i.test(effect.text))) return false;

  const me = input.view.players[input.seat];
  const hand = new Map(me.hand.map((card) => [card.instanceId, card]));
  return input.legal.some((intent) =>
    intent.kind === "stage-defenders" && intent.instanceIds.some((id) => {
      const card = hand.get(id);
      return card !== undefined && (card.defense ?? input.cards[card.cardId]?.defense ?? 0) >= 3;
    })
  );
}

function scoreDefend(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return scoreDefenseIntent(intent, input, own, {
    offensiveCards,
    evaluateResponse: (cards, policyInput) => responseEvaluation({
      damageThreatened: estimateBravoDamage(cards, policyInput),
    }),
    cardOpportunity,
    defensePermission: (candidate) => {
      if (!shouldBlockStaticShockWithThree(candidate.input)) return "allow";
      const handIds = new Set(candidate.input.view.players[candidate.input.seat].hand.map(
        (card) => card.instanceId,
      ));
      return candidate.chosen.some((card) =>
          handIds.has(card.instanceId) &&
          (card.defense ?? candidate.input.cards[card.cardId]?.defense ?? 0) >= 3
        )
        ? "require"
        : "allow";
    },
  });
}

function nextTurnArsenalValue(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!data) return 0;
  if (isAttack(data) && data.keywords?.includes("Crush")) {
    return 100 + attackValue(data, input) + (data.pitch === 1 ? 8 : 0);
  }
  if (key(data) === "pummel|1") return 85;
  if (key(data) === "staunch response|1") return 75;
  return 20 + cardOpportunity(card, input);
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  if (decision.options?.length && decision.options.every((option) => /^pay \d+$/.test(option))) {
    return Number(/^pay (\d+)$/.exec(intent.optionId)?.[1] ?? -1) * 10;
  }
  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, nextTurnArsenalValue, -10);
  }
  const card = optionCard(intent, input);
  if (/reveal|clash/i.test(decision.prompt) && card) {
    return 20 + Math.max(card.attack ?? input.cards[card.cardId]?.attack ?? 0, 0);
  }
  if (/discard|bottom of your deck|put a card from your hand on top/i.test(decision.prompt)) {
    return scoreSpendCardChoice(intent, input, cardOpportunity, 20, -5);
  }
  const binary = scoreBinaryChoice(intent.optionId, 10, -2);
  if (binary !== undefined) return binary;
  return card ? 10 + cardOpportunity(card, input) : 1;
}

function remainingSingleCardPitch(
  intent: GameIntent,
  input: BotPolicyInput,
): number {
  const spent = new Set(pitchIds(intent));
  return input.view.players[input.seat].hand.reduce((best, card) =>
    spent.has(card.instanceId)
      ? best
      : Math.max(best, Number(input.cards[card.cardId]?.pitch ?? 0)),
  0);
}

function heroArsenalAttack(input: BotPolicyInput): CardView | undefined {
  return input.view.players[input.seat].arsenal.find((card) => {
    const data = input.cards[card.cardId];
    return card.faceDown !== false && isAttack(data) && data?.keywords?.includes("Crush");
  });
}

function scorePlay(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || !data) return -20;
  if (shouldPreserveOpeningHand(input)) return -100;
  if (spendsOpeningArsenalReserve(intent, input, own)) return -100;

  const functional = key(data);
  let score = 0;
  if (intent.kind === "activate-ability") {
    if (functional === "bravo, flattering showman|0") {
      const attack = heroArsenalAttack(input);
      const attackData = attack ? input.cards[attack.cardId] : undefined;
      const floating = resourcesAfterCost(intent, 2, input, own);
      const canAttack = attackData !== undefined &&
        floating + remainingSingleCardPitch(intent, input) >= attackCost(attackData);
      score = canAttack ? 40 + attackValue(attackData, input) : -100;
    } else if (data.cardType === "weapon") {
      score = 8 + (data.attack ?? 0);
    } else {
      score = 2;
    }
  } else if (isAttack(data)) {
    score = 20 + attackValue(data, input);
    if (intent.kind === "play-from-arsenal") score += 3;
  } else if (data.cardType === "attack-reaction") {
    const link = currentLink(input);
    if (!currentAttackIsOurs(input) || input.view.pendingDecision?.kind !== "attack-reaction") {
      score = -100;
    } else if (functional === "pummel|1" && link) {
      const damageAfterPummel = link.attackValue + 4 - link.defenseValue;
      score = damageAfterPummel >= 4 ? 48 : damageAfterPummel > 0 ? 34 : -20;
    } else {
      score = 8;
    }
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input);
  } else if (functional === "oasis respite|1") {
    const link = currentLink(input);
    const remaining = link && link.attackingCard.owner !== input.seat
      ? Math.max(0, link.attackValue - link.defenseValue - (link.damageToPrevent ?? 0))
      : 0;
    score = remaining > 0 ? 24 + Math.min(remaining, 4) * 3 : -100;
  } else if (functional === "arcane polarity|1") {
    score = input.view.turnFacts?.players[input.seat].arcaneDamageTaken ? 28 : -100;
  } else if (functional === "edge of their seats|3") {
    score = -20;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= 2 + cardOpportunity(pitched, input) * 0.5;
  }
  score -= Math.max(0, pitchIds(intent).length - 1) * 10;
  return score;
}

function chooseBravoReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: nextTurnArsenalValue,
  });
}

/** Deterministic Bravo policy: retain one large attack plus its best pitch,
 * block with the remainder, and validate its ranked clean-turn opening. */
export interface BravoIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
}

export function chooseBravoIntentWithTrace(input: BotPolicyInput): BravoIntentDecision {
  const reactive = chooseBravoReactiveIntent(input);
  const decision = chooseTacticalIntentWithTrace(input, reactive, {
    chooseForced: (forced) => chooseBravoReactiveIntent({ ...forced, state: undefined }),
    cardOpportunity,
    nextTurnArsenal: nextTurnArsenalValue,
    estimateRemaining: estimateBravoDamage,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    rootScore: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
  });
  const intent = enforceSpectraPolicy(input, decision.intent);
  return decision.plan ? { intent, plan: decision.plan } : { intent };
}

export function chooseBravoIntent(input: BotPolicyInput): GameIntent {
  return chooseBravoIntentWithTrace(input).intent;
}
