import type { GameState } from "@fyendal/engine";
import type { CardView, GameIntent } from "@fyendal/shared";
import { isOpeningTurn, type BotPolicyInput } from "./policy.js";
import {
  evaluateOpponentResponse,
  evaluateTurnFuture,
  planTurn,
  responseWeightedDamage,
  type TurnPlan,
  type TurnPlannerRoot,
} from "./turn-planner.js";

export interface TacticalTurnEvaluation {
  score: number;
  damage: number;
  expectedDamage: number;
  futureValue: number;
  equipmentSpent: number;
  complete: boolean;
}

export interface TacticalTurnConfig {
  chooseForced(input: BotPolicyInput): GameIntent;
  cardOpportunity(card: CardView, input: BotPolicyInput): number;
  nextTurnArsenal(card: CardView, input: BotPolicyInput): number;
  estimateRemaining(cards: readonly CardView[], input: BotPolicyInput): number;
  rankCandidate?(intent: GameIntent, input: BotPolicyInput): number;
  equipmentCost?: number;
  maxSearchNodes?: number;
  maxTransitions?: number;
  recordCheckpoints?: boolean;
  maxRootCandidates?: number;
  maxForcedSteps?: number;
}

export interface TacticalIntentConfig extends TacticalTurnConfig {
  rootScore(intent: GameIntent, input: BotPolicyInput): number;
}

export type TacticalTurnPlan = TurnPlan<TacticalTurnEvaluation>;

// Reactive policies already rank every legal root. The default performs one
// authoritative engine application before accepting that root; policies that
// need a speculative continuation, such as Cindra, provide larger overrides.
const DEFAULT_TACTICAL_MAX_SEARCH_NODES = 1;
const DEFAULT_TACTICAL_MAX_TRANSITIONS = 1;
const DEFAULT_TACTICAL_MAX_ROOT_CANDIDATES = 1;

function evaluateTacticalTurn(
  state: GameState,
  input: BotPolicyInput,
  root: TurnPlannerRoot,
  config: TacticalTurnConfig,
  complete: boolean,
): TacticalTurnEvaluation {
  const me = input.view.players[root.seat];
  const opponentResponse = evaluateOpponentResponse(input, root);
  const future = evaluateTurnFuture(input, root, {
    cardOpportunity: config.cardOpportunity,
    nextTurnArsenal: config.nextTurnArsenal,
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
  return {
    score: winnerScore
      + responseWeightedDamage(opponentResponse) * 100
      + future.score
      - equipmentSpent * (config.equipmentCost ?? 14)
      - (complete ? me.resources * 3 : 0),
    damage: opponentResponse.rawDamage,
    expectedDamage: opponentResponse.expectedDamage,
    futureValue: future.score,
    equipmentSpent,
    complete,
  };
}

/** Shared bounded validation for heroes whose reactive policy already supplies
 * card valuation, with optional deeper rollout through policy overrides. */
export function planTacticalTurn(
  input: BotPolicyInput,
  config: TacticalTurnConfig,
): TacticalTurnPlan | undefined {
  return planTurn(input, {
    chooseForced: config.chooseForced,
    cardOpportunity: config.cardOpportunity,
    rankCandidate: config.rankCandidate,
    maxSearchNodes: config.maxSearchNodes ?? DEFAULT_TACTICAL_MAX_SEARCH_NODES,
    maxTransitions: config.maxTransitions ?? DEFAULT_TACTICAL_MAX_TRANSITIONS,
    recordCheckpoints: config.recordCheckpoints,
    maxRootCandidates: config.maxRootCandidates ?? DEFAULT_TACTICAL_MAX_ROOT_CANDIDATES,
    maxForcedSteps: config.maxForcedSteps,
    evaluateEnd: (state, observed, root, complete) =>
      evaluateTacticalTurn(state, observed, root, config, complete),
    evaluateHorizon(state, observed, root) {
      const base = evaluateTacticalTurn(state, observed, root, config, false);
      const me = observed.view.players[root.seat];
      const remaining = config.estimateRemaining(
        [...me.hand, ...me.arsenal, ...me.weapons],
        observed,
      );
      return {
        ...base,
        score: base.score + remaining * 70,
        complete: false,
      };
    },
  });
}

/** Keep hero-specific tactical guardrails authoritative at the root while
 * allowing rollout to choose among equally sound openings and pitch lines. */
export function chooseTacticalIntent(
  input: BotPolicyInput,
  reactive: GameIntent,
  config: TacticalIntentConfig,
): GameIntent {
  return chooseTacticalIntentWithTrace(input, reactive, config).intent;
}

export interface TacticalIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
}

export function chooseTacticalIntentWithTrace(
  input: BotPolicyInput,
  reactive: GameIntent,
  config: TacticalIntentConfig,
): TacticalIntentDecision {
  if (isOpeningTurn(input)) return { intent: reactive };
  const plan = planTacticalTurn(input, config);
  const intent = plan && config.rootScore(plan.intent, input) >= config.rootScore(reactive, input)
    ? plan.intent
    : reactive;
  return plan ? { intent, plan } : { intent };
}
