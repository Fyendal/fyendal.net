import type { GameState } from "@fyendal/engine";
import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  chooseScoredIntent,
  currentAttackIsOurs,
  currentLink,
  enforceAllyTargetPolicy,
  enforceSpectraPolicy,
  functionalKey as key,
  intentCard,
  isAttack,
  optionCard,
  ownCards,
  pitchIds,
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
  evaluateOpponentResponse,
  evaluateTurnFuture,
  planTurn,
  responseWeightedDamage,
  type TurnPlan,
  type TurnPlannerRoot,
} from "./turn-planner.js";

function attacksThisTurn(input: BotPolicyInput): number {
  const projected = input.view.turnFacts?.players[input.seat].attacks;
  if (projected !== undefined) return projected;
  const stats = input.view.gameStats?.turns.find((turn) => turn.turn === input.view.turn);
  if (stats) return stats.attacks[input.seat];
  return input.view.chain.filter((link) => link.attackingCard.owner === input.seat).length;
}

function previousAttackKey(input: BotPolicyInput): string {
  const previous = [...input.view.chain]
    .reverse()
    .find((link) => link.resolved && link.attackingCard.owner === input.seat);
  return previous ? key(input.cards[previous.attackingCard.cardId]) : "";
}

function currentAttackHasOrWillGetGoAgain(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  if (!link) return false;
  if (link.goAgain === true) return true;
  if (link.defenseValue >= link.attackValue) return false;
  return link.onHitEffects?.some((effect) => /\bgo again\b/i.test(effect.text)) === true;
}

function likelyGoAgain(functional: string, data: CardData, previous: string, input: BotPolicyInput): boolean {
  if (data.cardType === "weapon") return functional === "edge of autumn|0";
  if (data.keywords?.includes("Go again")) return true;
  if (functional.startsWith("scar for a scar|")) {
    return input.view.players[input.seat].life < input.view.players[1 - input.seat]!.life;
  }
  if (functional.startsWith("soulbead strike|") || functional.startsWith("torrent of tempo|")) {
    return true;
  }
  if (functional.startsWith("seek vengeance|") || functional === "vengeance never rests|3") {
    return previous === "edge of autumn|0";
  }
  return false;
}

function remainingAttackAfter(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  const used = intentCard(intent, own);
  const consumed = new Set([used?.instanceId, ...pitchIds(intent)]);
  return input.legal.some((candidate) => {
    if (
      candidate.kind !== "play-card" && candidate.kind !== "play-from-arsenal" &&
      candidate.kind !== "play-from-zone" && candidate.kind !== "activate-ability"
    ) return false;
    const card = intentCard(candidate, own);
    if (!card || consumed.has(card.instanceId)) return false;
    const data = input.cards[card.cardId];
    return isAttack(data) || data?.cardType === "weapon";
  });
}

function attackInReserve(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  const used = intentCard(intent, own);
  const consumed = new Set([used?.instanceId, ...pitchIds(intent)]);
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal, ...me.banish].some((card) =>
    !consumed.has(card.instanceId) && isAttack(input.cards[card.cardId])
  );
}

function cardOpportunity(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!data) return 0;
  const functional = key(data);
  if (data.cardType === "defense-reaction") return 5;
  if (data.cardType === "attack-reaction") {
    return functional.startsWith("razor reflex|") ? 7 : 5;
  }
  if (isAttack(data)) {
    let value = data.attack ?? 0;
    if (likelyGoAgain(functional, data, "edge of autumn|0", input)) value += 3;
    if (functional === "whirling mist blossom|2") value += 3;
    if (functional === "enact vengeance|1") value += 2;
    return value;
  }
  if (functional === "energy potion|3") return 2;
  return Math.max(1, data.pitch ?? 0);
}

/**
 * Small projection-only search used to value the offensive cards lost while
 * blocking. It assumes conditional on-hit go again succeeds, but models Ira's
 * second-attack buff, Edge combo links, Flying Kick, Bittering Thorns, and the
 * two attack reactions in the precon.
 */
function estimateIraDamage(cards: readonly CardView[], input: BotPolicyInput): number {
  const unique = [...new Map(cards.map((card) => [card.instanceId, card])).values()];
  const attacks = unique.filter((card) => {
    const data = input.cards[card.cardId];
    return isAttack(data) || data?.cardType === "weapon";
  });
  const reactionDamage = unique.reduce((sum, card) => {
    const functional = key(input.cards[card.cardId]);
    if (functional.startsWith("razor reflex|")) return sum + 3;
    if (functional === "legacy of ikaru|3") return sum + 1;
    return sum;
  }, 0);
  const alreadyAttacked = attacksThisTurn(input);

  function search(
    remaining: readonly CardView[],
    previous: string,
    sequence: number,
    bitteringBuff: boolean,
  ): number {
    let best = 0;
    for (let index = 0; index < remaining.length; index++) {
      const card = remaining[index]!;
      const data = input.cards[card.cardId];
      if (!data) continue;
      const functional = key(data);
      const attackNumber = alreadyAttacked + sequence + 1;
      let damage = data.attack ?? 0;
      if (attackNumber === 2) damage += 1;
      if (functional.startsWith("flying kick|") && attackNumber >= 3) damage += 2;
      if (bitteringBuff) damage += 1;
      const after = remaining.filter((_, candidate) => candidate !== index);
      const rest = likelyGoAgain(functional, data, previous, input)
        ? search(after, functional, sequence + 1, functional.startsWith("bittering thorns|"))
        : 0;
      best = Math.max(best, damage + rest);
    }
    return best;
  }

  return reactionDamage + search(attacks, previousAttackKey(input), 0, false);
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
    evaluateResponse: (cards, policyInput) => responseEvaluation({
      damageThreatened: estimateIraDamage(cards, policyInput),
    }),
    cardOpportunity,
  });
}

function nextTurnArsenalValue(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  const functional = key(data);
  if (data?.cardType === "defense-reaction") return 90;
  if (data?.cardType === "attack-reaction") return 80;
  if (functional === "whirling mist blossom|2") return 75;
  if (isAttack(data) && (data?.cost ?? 0) === 0) return 60 + (data?.attack ?? 0);
  return 25 + cardOpportunity(card, input);
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  if (decision.options?.length && decision.options.every((option) => /^pay \d+$/.test(option))) {
    return Number(/^pay (\d+)$/.exec(intent.optionId)?.[1] ?? -1) * 20;
  }
  const card = optionCard(intent, input);
  const data = card ? input.cards[card.cardId] : undefined;
  const functional = key(data);

  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, nextTurnArsenalValue, -10);
  }

  if (/sink below|bottom of your deck/i.test(decision.prompt)) {
    if (intent.optionId === "pass") return 1;
    return scoreSpendCardChoice(intent, input, cardOpportunity, 20, 0);
  }
  if (/whirling mist blossom/i.test(decision.prompt) && functional === "whirling mist blossom|2") {
    return 100;
  }
  if (/graveyard on top of your deck/i.test(decision.prompt)) {
    if (intent.optionId === "pass") return -5;
    return card ? 10 + cardOpportunity(card, input) : 0;
  }
  if (/equip an edge of autumn/i.test(decision.prompt)) {
    return intent.optionId === "pass" ? -20 : 100;
  }
  if (/discard/i.test(decision.prompt)) {
    return scoreSpendCardChoice(intent, input, cardOpportunity, 20, -5);
  }
  const binary = scoreBinaryChoice(intent.optionId, 10, -2);
  if (binary !== undefined) return binary;
  return card ? 10 + cardOpportunity(card, input) : 1;
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
  const me = input.view.players[input.seat];
  const previous = previousAttackKey(input);
  const furtherAttack = remainingAttackAfter(intent, input, own);
  const reservedAttack = attackInReserve(intent, input, own);
  let score = 0;

  if (intent.kind === "activate-ability") {
    if (data.cardType === "weapon") {
      score = furtherAttack ? 30 : 7;
      if (attacksThisTurn(input) === 0) score += 8;
    } else if (functional === "snapdragon scalers|0") {
      score = currentAttackIsOurs(input) && !currentAttackHasOrWillGetGoAgain(input) && reservedAttack
        ? 28
        : -100;
    } else if (functional === "okana scar wraps|0") {
      const link = currentLink(input);
      const attackName = key(input.cards[link?.attackingCard.cardId ?? ""]);
      score = currentAttackIsOurs(input) && attackName.includes("vengeance") &&
          !!link && link.attackValue >= link.defenseValue
        ? 22
        : -40;
    } else if (functional === "iris of the blossom|0") {
      const alreadyHasBlossom = [...me.hand, ...me.arsenal, ...me.banish].some((candidate) =>
        key(input.cards[candidate.cardId]) === "whirling mist blossom|2"
      );
      score = alreadyHasBlossom ? -20 : 12;
    } else if (functional === "energy potion|3") {
      score = me.resources < 2 ? 18 : -5;
    } else {
      score = 3;
    }
  } else if (isAttack(data)) {
    const attackNumber = attacksThisTurn(input) + 1;
    score = data.attack ?? 0;
    if (attackNumber === 2) score += 3;
    if (functional.startsWith("flying kick|") && attackNumber >= 3) score += 5;

    const goAgain = likelyGoAgain(functional, data, previous, input);
    if (goAgain && furtherAttack) score += 16;
    else if (!goAgain && furtherAttack) score -= 6;

    if (previous === "edge of autumn|0") {
      if (functional.startsWith("seek vengeance|")) score += 24;
      if (functional === "vengeance never rests|3") score += 22;
      if (functional === "enact vengeance|1") {
        score += 10 + input.view.players[1 - input.seat]!.arsenalCount * 8;
      }
    }
    if (functional.startsWith("bittering thorns|")) score += furtherAttack ? 7 : 0;
    if (functional === "whirling mist blossom|2") {
      const priorHit = [...input.view.chain].reverse().find((link) => link.resolved)?.hit === true;
      if (priorHit) score += 10;
    }
    if (functional.startsWith("snatch|")) score += 4;
    if (intent.kind === "play-from-arsenal") score += 2;
  } else if (data.cardType === "attack-reaction") {
    if (!currentAttackIsOurs(input) || input.view.pendingDecision?.kind !== "attack-reaction") {
      score = -100;
    } else if (functional.startsWith("razor reflex|")) {
      score = 32 + (currentLink(input)?.goAgain === true || !reservedAttack ? 0 : 6);
    } else if (functional === "legacy of ikaru|3") {
      score = previous === "edge of autumn|0" ? 18 : 10;
    } else {
      score = 8;
    }
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input);
  } else if (functional === "energy potion|3") {
    score = furtherAttack ? -15 : 3;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= 2 + cardOpportunity(pitched, input);
  }
  return score;
}

/** Deterministic, projection-only Ira policy. Equal scores retain engine order. */
function chooseIraReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: nextTurnArsenalValue,
  });
}

export interface IraTurnEvaluation {
  score: number;
  damage: number;
  attacks: number;
  futureValue: number;
  equipmentSpent: number;
  complete: boolean;
}

export type IraTurnPlan = TurnPlan<IraTurnEvaluation>;

function evaluateIraTurn(
  state: GameState,
  input: BotPolicyInput,
  root: TurnPlannerRoot,
  complete: boolean,
): IraTurnEvaluation {
  const me = input.view.players[root.seat];
  const opponent = input.view.players[1 - root.seat]!;
  const damage = Math.max(0, root.opponentLife - opponent.life);
  const opponentResponse = evaluateOpponentResponse(input, root);
  const attacks = input.view.turnFacts?.players[root.seat].attacks ?? attacksThisTurn(input);
  const future = evaluateTurnFuture(input, root, {
    cardOpportunity,
    nextTurnArsenal: nextTurnArsenalValue,
  });
  const currentEquipmentIds = new Set(
    Object.values(me.equipment).flatMap((card) => card ? [card.instanceId] : []),
  );
  const equipmentSpent = [...root.equipmentIds].filter((id) => !currentEquipmentIds.has(id)).length;
  const winnerScore = state.winner === root.seat
    ? 1_000_000
    : state.winner === 1 - root.seat
    ? -1_000_000
    : 0;
  const score = winnerScore
    + responseWeightedDamage(opponentResponse) * 100
    + future.score
    + attacks * 3
    - equipmentSpent * 14
    - (complete ? me.resources * 3 : 0);
  return {
    score,
    damage,
    attacks,
    futureValue: future.score,
    equipmentSpent,
    complete,
  };
}

export interface IraIntentDecision {
  intent: GameIntent;
  plan?: IraTurnPlan;
}

const IRA_MAX_SEARCH_NODES = 4;
const IRA_MAX_TRANSITIONS = 8;
const IRA_MAX_ROOT_CANDIDATES = 1;

export function chooseIraIntentWithTrace(input: BotPolicyInput): IraIntentDecision {
  if (shouldPreserveOpeningHand(input)) {
    return {
      intent: enforceAllyTargetPolicy(
        input,
        enforceSpectraPolicy(input, chooseIraReactiveIntent(input)),
      ),
    };
  }
  const plan = planTurn(input, {
    maxSearchNodes: IRA_MAX_SEARCH_NODES,
    maxTransitions: IRA_MAX_TRANSITIONS,
    maxRootCandidates: IRA_MAX_ROOT_CANDIDATES,
    chooseForced: (forced) => chooseIraReactiveIntent({ ...forced, state: undefined }),
    cardOpportunity,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    evaluateEnd: evaluateIraTurn,
    evaluateHorizon(state, observed, root) {
      const base = evaluateIraTurn(state, observed, root, false);
      const me = observed.view.players[root.seat];
      const remaining = estimateIraDamage([...me.hand, ...me.arsenal, ...me.weapons], observed);
      return { ...base, score: base.score + remaining * 80, complete: false };
    },
  });
  const intent = enforceAllyTargetPolicy(
    input,
    enforceSpectraPolicy(input, plan?.intent ?? chooseIraReactiveIntent(input)),
  );
  return plan ? { intent, plan } : { intent };
}

/** Deterministic Ira policy with bounded whole-turn planning at clean action decisions. */
export function chooseIraIntent(input: BotPolicyInput): GameIntent {
  return chooseIraIntentWithTrace(input).intent;
}
