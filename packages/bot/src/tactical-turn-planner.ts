import type { GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { handDamage, type HeroRulesFactory } from "./hand-value.js";
import { currentLink, isOpeningTurn, type BotPolicyInput } from "./policy.js";
import {
  evaluateOpponentResponse,
  evaluateTurnFuture,
  horizonScore,
  planTurn,
  POINTS_PER_DAMAGE,
  responseWeightedDamage,
  spentEquipmentValue,
  type TurnPlan,
  type TurnPlannerConfig,
  type TurnPlannerRoot,
} from "./turn-planner.js";

export interface TacticalTurnEvaluation {
  score: number;
  damage: number;
  expectedDamage: number;
  futureValue: number;
  /** Damage-equivalent blocking value of equipment this line spent. */
  equipmentSpent: number;
  /** Hero-defined self-inflicted cost of the line's end state (see
   * `TacticalTurnConfig.risk`); recorded for the policy, not scored here. */
  risk: number;
  complete: boolean;
}

export interface TacticalTurnConfig {
  chooseForced(input: BotPolicyInput): GameIntent;
  /** Hero hand-value rules: future hand, arsenal and horizon estimates. */
  rules: HeroRulesFactory;
  rankCandidate?(intent: GameIntent, input: BotPolicyInput): number;
  scoreIntent?(intent: GameIntent, input: BotPolicyInput): number;
  positionBonus?(input: BotPolicyInput, complete: boolean, root: TurnPlannerRoot): number;
  /** Life-unit cost the hero's own line inflicts (life lost, debt exposed),
   * so a policy can tell lines that save life from lines that merely deal
   * more. The position bonus still prices it into the score. */
  risk?(input: BotPolicyInput, complete: boolean): number;
  prepareCandidates?: TurnPlannerConfig<TacticalTurnEvaluation>["prepareCandidates"];
  /** Order continuation candidates by `rankCandidate` too (see planner). */
  rankContinuations?: boolean;
  /** Use a smaller win bonus when speculative opponent no-blocks are uncertain. */
  simulatedWinBonus?: number;
  maxSearchNodes?: number;
  maxTransitions?: number;
  recordCheckpoints?: boolean;
  maxRootCandidates?: number;
  maxActionDepth?: number;
  maxForcedSteps?: number;
  firstRootNodeBudget?: number;
  firstRootTransitionBudget?: number;
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
  const opponentResponse = evaluateOpponentResponse(input, root);
  const future = evaluateTurnFuture(input, root, config.rules);
  const equipmentSpent = spentEquipmentValue(input, root);
  const winnerScore = state.winner === root.seat
    ? (config.simulatedWinBonus ?? 1_000_000)
    : state.winner === 1 - root.seat
    ? -1_000_000
    : 0;
  return {
    score: winnerScore
      + responseWeightedDamage(opponentResponse) * POINTS_PER_DAMAGE
      + future.score
      + (config.positionBonus?.(input, complete, root) ?? 0)
      - equipmentSpent * POINTS_PER_DAMAGE,
    damage: opponentResponse.rawDamage,
    expectedDamage: opponentResponse.expectedDamage,
    futureValue: future.score,
    equipmentSpent,
    risk: config.risk?.(input, complete) ?? 0,
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
    rankCandidate: config.rankCandidate,
    scoreIntent: config.scoreIntent,
    prepareCandidates: config.prepareCandidates,
    rankContinuations: config.rankContinuations,
    maxSearchNodes: config.maxSearchNodes ?? DEFAULT_TACTICAL_MAX_SEARCH_NODES,
    maxTransitions: config.maxTransitions ?? DEFAULT_TACTICAL_MAX_TRANSITIONS,
    recordCheckpoints: config.recordCheckpoints,
    maxRootCandidates: config.maxRootCandidates ?? DEFAULT_TACTICAL_MAX_ROOT_CANDIDATES,
    maxActionDepth: config.maxActionDepth,
    maxForcedSteps: config.maxForcedSteps,
    firstRootNodeBudget: config.firstRootNodeBudget,
    firstRootTransitionBudget: config.firstRootTransitionBudget,
    evaluateEnd: (state, observed, root, complete) =>
      evaluateTacticalTurn(state, observed, root, config, complete),
    evaluateHorizon(state, observed, root) {
      const base = evaluateTacticalTurn(state, observed, root, config, false);
      const me = observed.view.players[root.seat];
      const remaining = handDamage([...me.hand, ...me.arsenal], observed, config.rules);
      // A line cut short mid-attack, such as by a draw, still has that attack's damage to land.
      const link = currentLink(observed);
      const pending = link && link.attackingCard.owner === root.seat && link.hit === undefined
        ? Math.max(0, link.attackValue - link.defenseValue)
        : 0;
      return {
        ...base,
        score: horizonScore(observed, root, base.score, base.futureValue, remaining, pending),
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
