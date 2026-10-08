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
import { planTacticalTurn, type TacticalTurnPlan } from "./tactical-turn-planner.js";
import {
  chooseLeviaMacro,
  leviaMacroIntentBonus,
  leviaMacroPositionBonus,
  type LeviaMacroChoice,
} from "./levia-macros.js";

function name(data: CardData | undefined): string {
  return data?.name.toLowerCase() ?? "";
}

function ownBloodDebt(input: BotPolicyInput): number {
  return input.view.players[input.seat].banish.filter((card) =>
    !card.faceDown && input.cards[card.cardId]?.keywords?.includes("Blood Debt")
  ).length;
}

function hasGate(input: BotPolicyInput): boolean {
  return input.view.players[input.seat].board.some((card) =>
    name(input.cards[card.cardId]) === "gate to i'arathael"
  );
}

function bloodDebtAction(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  return !card.faceDown && data?.cardType === "action" &&
    data.keywords?.includes("Blood Debt") === true;
}

function playableBanishAttacks(input: BotPolicyInput, spent: ReadonlySet<number>): CardView[] {
  const me = input.view.players[input.seat];
  const permitted = me.banish.filter((card) =>
    !card.faceDown && !spent.has(card.instanceId) && card.playableFromSourceCardId !== undefined &&
    isAttack(input.cards[card.cardId])
  );
  const permittedIds = new Set(permitted.map((card) => card.instanceId));
  const gateUses = me.board.filter((card) =>
    name(input.cards[card.cardId]) === "gate to i'arathael"
  ).length;
  const blasmophetUses = me.board.some((card) =>
    name(input.cards[card.cardId]) === "blasmophet, the insatiable hunger"
  ) ? 1 : 0;
  const potentialUses = gateUses + blasmophetUses;
  if (potentialUses === 0) return permitted;
  const potential = me.banish.filter((card) =>
    !spent.has(card.instanceId) && !permittedIds.has(card.instanceId) &&
    bloodDebtAction(card, input) && isAttack(input.cards[card.cardId])
  ).sort((left, right) =>
    (input.cards[right.cardId]?.attack ?? 0) - (input.cards[left.cardId]?.attack ?? 0)
  ).slice(0, potentialUses);
  return [...permitted, ...potential];
}

function attackReserve(input: BotPolicyInput, spent: ReadonlySet<number>): CardView[] {
  const me = input.view.players[input.seat];
  return [
    ...[...me.hand, ...me.arsenal].filter((card) =>
      !spent.has(card.instanceId) && isAttack(input.cards[card.cardId])
    ),
    ...playableBanishAttacks(input, spent),
  ];
}

function gateTargetValue(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  if (intent.kind !== "activate-ability" || intent.targetCardInstanceId === undefined) return -500;
  const me = input.view.players[input.seat];
  if (input.view.activePlayer !== input.seat || me.actionPoints < 1) return -500;
  const target = me.banish.find((card) => card.instanceId === intent.targetCardInstanceId);
  if (!target || !bloodDebtAction(target, input)) return -500;
  const targetData = input.cards[target.cardId];
  if (!targetData) return -500;
  if (name(targetData) === "consuming lash" && !me.board.some((card) =>
    name(input.cards[card.cardId]) === "blasmophet, the insatiable hunger"
  )) return -500;
  const pitched = new Set(pitchIds(intent));
  const pitchedResources = [...pitched].reduce((total, id) =>
    total + (input.cards[own.get(id)?.cardId ?? ""]?.pitch ?? 0), 0
  );
  const pitchRequired = intent.pitchRequired ?? 0;
  const costToActivate = pitchRequired > 0
    ? me.resources + pitchRequired
    : 1;
  const afterActivation = Math.max(0, me.resources + pitchedResources - costToActivate);
  const remainingPitch = me.hand.filter((card) => !pitched.has(card.instanceId)).reduce((total, card) =>
    total + (input.cards[card.cardId]?.pitch ?? 0), 0
  );
  if ((targetData.cost ?? 0) > afterActivation + remainingPitch) return -500;
  return 54 + Math.min(30, cardOpportunity(target, input) * 3);
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
  const included = new Set(cards.map((card) => card.instanceId));
  const attacks = [...cards, ...playableBanishAttacks(input, included)].filter((card) =>
    isAttack(input.cards[card.cardId])
  );
  const pitch = cards.filter((card) => (input.cards[card.cardId]?.pitch ?? 0) >= 2).length;
  const bloodrush = cards.some((card) => name(input.cards[card.cardId]) === "bloodrush bellow");
  const best = attacks.reduce((value, card) => Math.max(value, input.cards[card.cardId]?.attack ?? 0), 0);
  const second = attacks.length > 1 && pitch > 0 ? Math.min(6, attacks.length * 2) : 0;
  return best + second + (bloodrush && attacks.length > 0 ? 4 : 0);
}

function scorePlay(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const card = intentCard(intent, own);
  const data = card && input.cards[card.cardId];
  if (!card || !data) return -100;
  const named = name(data);
  const me = input.view.players[input.seat];
  let followupCount: number | undefined;
  const followups = (): number => followupCount ??= attackReserve(
    input, new Set([card.instanceId, ...pitchIds(intent)]),
  ).length;
  let score: number;

  if (named === "gate to i'arathael") {
    score = gateTargetValue(intent, input, own);
  } else if (named === "cleave the heavens" && intent.kind === "activate-ability") {
    score = !hasGate(input) ? 96 : 53;
  } else if (named === "blood harvest" && intent.kind === "activate-ability") {
    score = me.resources < 3 && followups() > 0 ? 84 : -35;
  } else if (named === "bloodrush bellow") {
    score = followups() > 0 ? 72 + Math.min(followups(), 2) * 8 : -60;
  } else if (named === "call to the grave") {
    score = me.graveyard.length < 6 ? 58 : 38;
  } else if (named === "pull from beyond") {
    score = !hasGate(input) ? 60 : 42;
  } else if (named === "goremass summoning") {
    score = input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn === true ? 52 : -20;
  } else if (named === "levia, shadowborn abomination" && intent.kind === "activate-ability") {
    score = me.life <= 8 || (ownBloodDebt(input) >= me.life &&
      input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn !== true) ? 180 : -120;
  } else if (named === "doomsday") {
    score = 75;
  } else if (named === "scabskin leathers") {
    score = followups() > 1 && me.life > 5 ? 53 : -55;
  } else if (named === "fyendal's spring tunic") {
    score = followups() > 0 ? 32 : -30;
  } else if (named === "hex gauntlet" || named === "embraforged gauntlet") {
    score = followups() > 0 ? 35 : -35;
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input);
  } else if (isAttack(data) || data.cardType === "weapon") {
    score = 22 + (data.attack ?? 0) * 2;
    if (["feeding frenzy", "dread screamer", "shadowrealm horror"].includes(named) && followups() > 0) {
      score += 20;
    }
    if (named === "hexagore, the death hydra") {
      const selfDamage = Math.max(0, 6 - ownBloodDebt(input));
      score -= selfDamage * (me.life <= 9 ? 15 : 5);
      if (selfDamage >= me.life) score -= 1_000;
      else if ((data.attack ?? 0) >= input.view.players[1 - input.seat]!.life) score += 120;
    }
    if (named === "ravenous meataxe" && followups() > 0) score -= 12;
  } else {
    score = -30;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= cardOpportunity(pitched, input) * 0.7 + 1;
  }
  return score;
}

function scorePullOptChoice(
  intent: Extract<GameIntent, { kind: "choose" }>,
  input: BotPolicyInput,
): number | undefined {
  const decision = input.view.pendingDecision;
  const source = decision?.promptMessage?.values?.card;
  if ((decision?.promptMessage?.id !== "card.common.opt" &&
      decision?.promptMessage?.id !== "card.common.opt.remaining") ||
    !source || typeof source !== "object" || source.kind !== "card" ||
    name(input.cards[source.cardId]) !== "pull from beyond") return undefined;
  const requiredPitch = input.cards[source.cardId]?.pitch;
  if (requiredPitch === undefined || !decision.optionCards) return undefined;

  // Bottom every visible nonmatch before finishing the opt. The next card
  // banished will then have Pull's color whenever one was among the two seen.
  const nonmatching = decision.optionCards.some((card) =>
    card !== null && input.cards[card.cardId]?.pitch !== requiredPitch
  );
  if (!nonmatching) return intent.optionId === "pass" ? 100 : -100;
  const selected = optionCard(intent, input);
  return intent.optionId.startsWith("bottom:") && selected &&
    input.cards[selected.cardId]?.pitch !== requiredPitch ? 100 : -100;
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  if (input.view.pendingDecision?.kind === "arsenal") return scoreArsenalChoice(intent, input, nextTurnArsenal);
  const pullOpt = scorePullOptChoice(intent, input);
  if (pullOpt !== undefined) return pullOpt;
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

function scoreDefense(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return scoreDefenseIntent(intent, input, own, {
    cardOpportunity,
    offensiveCards: (policy) => [
      ...policy.view.players[policy.seat].hand, ...policy.view.players[policy.seat].arsenal,
    ],
    evaluateResponse: (cards, policy) => responseEvaluation({
      damageThreatened: estimateDamage(cards, policy),
      strategicAdjustment: ownBloodDebt(policy) > 0 && cards.length === 0 ? -4 : 0,
    }),
    responseLossWeight: 1.1,
  });
}

function chooseReactive(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    play: scorePlay,
    choose: scoreChoice,
    nextTurnArsenal,
    defend: scoreDefense,
  });
}

function scoreCandidate(intent: GameIntent, input: BotPolicyInput, macro: LeviaMacroChoice): number {
  let score: number;
  switch (intent.kind) {
    case "pass": score = 0; break;
    case "close-chain": score = 1; break;
    case "choose": score = scoreChoice(intent, input); break;
    case "defend": score = scoreDefense(intent, input, ownCards(input)); break;
    case "play-card":
    case "play-from-arsenal":
    case "play-from-zone":
    case "activate-ability":
      score = scorePlay(intent, input, ownCards(input));
      break;
    default: score = 0;
  }
  return score + leviaMacroIntentBonus(macro, intent, input);
}

export interface LeviaIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
  macro: LeviaMacroChoice;
}

export function chooseLeviaIntentWithTrace(input: BotPolicyInput): LeviaIntentDecision {
  const macro = chooseLeviaMacro(input);
  // Levia's instants set up her own attacks. Keep the hand for blocks throughout
  // the opponent's turn, including priority windows before an attack is declared.
  if (input.view.activePlayer !== input.seat &&
    (input.view.pendingDecision === null || input.view.pendingDecision.kind === "priority-window")) {
    const pass = input.legal.find((intent) => intent.kind === "pass");
    if (pass) return { intent: pass, macro };
  }
  const reactive = chooseReactive(input);
  const plan = planTacticalTurn(input, {
    chooseForced: (forced) => chooseReactive({ ...forced, state: undefined }),
    cardOpportunity,
    nextTurnArsenal,
    estimateRemaining: estimateDamage,
    rankCandidate: (intent, observed) => scoreCandidate(intent, observed, macro),
    scoreIntent: (intent, observed) => leviaMacroIntentBonus(macro, intent, observed),
    positionBonus: (observed, complete) => leviaMacroPositionBonus(macro, input, observed, complete),
    maxSearchNodes: 12,
    maxTransitions: 72,
    maxRootCandidates: 4,
    maxForcedSteps: 48,
    simulatedWinBonus: 0,
  });
  const rootScore = (intent: GameIntent) => scoreCandidate(intent, input, macro);
  const selected = plan && rootScore(plan.intent) >= rootScore(reactive) ? plan.intent : reactive;
  const intent = enforceAllyTargetPolicy(input, enforceSpectraPolicy(input, selected));
  return plan ? { intent, plan, macro } : { intent, macro };
}

export function chooseLeviaIntent(input: BotPolicyInput): GameIntent {
  return chooseLeviaIntentWithTrace(input).intent;
}
