import type { GameState } from "@fyendal/engine";
import type { CardView, GameIntent } from "@fyendal/shared";
import type { BotPolicyInput } from "./policy.js";
import {
  evaluateOpponentResponse,
  planTurn,
  evaluateTurnFuture,
  responseWeightedDamage,
  type TurnPlan,
  type TurnPlannerRoot,
} from "./turn-planner.js";

export interface BriarTurnEvaluation {
  score: number;
  damage: number;
  healing: number;
  intelligencePenalty: number;
  nextHandValue: number;
  arsenalValue: number;
  equipmentSpent: number;
  unusedSetups: number;
  runechantsCreated: number;
  firstCycleBurnsPitched: number;
  starFallAttacks: number;
  evergreenPreservedForArsenal: boolean;
  evergreenPlayedFromArsenal: number;
  complete: boolean;
}

export type BriarTurnPlan = TurnPlan<BriarTurnEvaluation>;

// Briar's reactive scorer already identifies the few credible opening plays.
// Rank with it and spend the rollout budget deeply on those lines instead of
// dividing the shared planner default across every legal root action.
const BRIAR_MAX_SEARCH_NODES = 42;
const BRIAR_MAX_TRANSITIONS = 124;
const BRIAR_MAX_ROOT_CANDIDATES = 2;

interface PlannerConfig {
  chooseForced(input: BotPolicyInput): GameIntent;
  cardOpportunity(card: CardView, input: BotPolicyInput): number;
  nextTurnArsenal(card: CardView, input: BotPolicyInput): number;
  estimateRemaining(cards: readonly CardView[], input: BotPolicyInput): number;
  comparePitchOrder(left: GameIntent, right: GameIntent, input: BotPolicyInput): number;
  scoreIntent(intent: GameIntent, input: BotPolicyInput): number;
  rankCandidate(intent: GameIntent, input: BotPolicyInput): number;
  prepareCandidates?(
    candidates: readonly GameIntent[],
    input: BotPolicyInput,
  ): readonly GameIntent[];
  fatiguePlan: boolean;
}

function evaluateBriarTurn(
  state: GameState,
  input: BotPolicyInput,
  root: TurnPlannerRoot,
  rootRunechants: number,
  rootWeaponAttacks: number,
  firstCycleBurnIds: ReadonlySet<number>,
  handEvergreenIds: ReadonlySet<number>,
  arsenalEvergreenIds: ReadonlySet<number>,
  rootArsenalEmpty: boolean,
  config: PlannerConfig,
  complete: boolean,
): BriarTurnEvaluation {
  const me = input.view.players[root.seat];
  const opponent = input.view.players[1 - root.seat]!;
  const damage = Math.max(0, root.opponentLife - opponent.life);
  const opponentResponse = evaluateOpponentResponse(input, root);
  const healing = Math.max(0, me.life - root.life);
  const future = evaluateTurnFuture(input, root, config);

  const currentEquipmentIds = new Set(
    Object.values(me.equipment).flatMap((card) => card ? [card.instanceId] : []),
  );
  const equipmentSpent = [...root.equipmentIds].filter((id) => !currentEquipmentIds.has(id)).length;
  const unusedSetups = input.view.ongoing.filter((effect) =>
    effect.seat === root.seat && effect.label.includes("next attack")
  ).length;
  const runechants = me.board.filter((card) =>
    root.cards[card.cardId]?.name.trim().toLowerCase() === "runechant"
  ).length;
  const runechantsCreated = Math.max(0, runechants - rootRunechants);
  const firstCycleBurnsPitched = me.pitch.filter((card) =>
    firstCycleBurnIds.has(card.instanceId)
  ).length;
  const weaponAttacks = input.view.turnFacts?.players[root.seat].weaponAttacks ?? 0;
  const starFallAttacks = Math.max(0, weaponAttacks - rootWeaponAttacks);
  const visibleOwnIds = new Set([
    ...me.hand,
    ...me.arsenal,
    ...me.pitch,
    ...me.graveyard,
    ...me.banish,
  ].map((card) => card.instanceId));
  const evergreenPlayedFromArsenal = [...arsenalEvergreenIds].filter((id) =>
    !visibleOwnIds.has(id)
  ).length;
  const evergreenArsenalChoice = future.arsenalCardInstanceId !== undefined &&
    handEvergreenIds.has(future.arsenalCardInstanceId);
  const evergreenPreservedForArsenal = handEvergreenIds.size === 0 ||
    !rootArsenalEmpty || evergreenArsenalChoice;
  const winnerScore = state.winner === root.seat
    ? 1_000_000
    : state.winner === 1 - root.seat
    ? -1_000_000
    : 0;
  const score = winnerScore
    + responseWeightedDamage(opponentResponse) * 100
    + healing * 25
    + future.score
    - equipmentSpent * 12
    - unusedSetups * 15
    + runechantsCreated * 30
    - (!evergreenPreservedForArsenal && state.winner !== root.seat ? 900 : 0);

  return {
    score,
    damage,
    healing,
    intelligencePenalty: future.intelligencePenalty,
    nextHandValue: future.nextHandValue,
    arsenalValue: future.arsenalValue,
    equipmentSpent,
    unusedSetups,
    runechantsCreated,
    firstCycleBurnsPitched,
    starFallAttacks,
    evergreenPreservedForArsenal,
    evergreenPlayedFromArsenal,
    complete,
  };
}

export function planBriarTurn(
  input: BotPolicyInput,
  config: PlannerConfig,
): BriarTurnPlan | undefined {
  const prepareCandidates = config.prepareCandidates;
  const rootRunechants = input.view.players[input.seat].board.filter((card) =>
    input.cards[card.cardId]?.name.trim().toLowerCase() === "runechant"
  ).length;
  const me = input.view.players[input.seat];
  const rootWeaponAttacks = input.view.turnFacts?.players[input.seat].weaponAttacks ?? 0;
  const firstCycleBurnIds = new Set(me.hand.flatMap((card) =>
    input.cards[card.cardId]?.name.trim().toLowerCase() === "burn up // shock" &&
      (card.pitchCount ?? 0) === 0
      ? [card.instanceId]
      : []
  ));
  const handEvergreenIds = new Set(me.hand.flatMap((card) =>
    input.cards[card.cardId]?.name.trim().toLowerCase() === "evergreen"
      ? [card.instanceId]
      : []
  ));
  const arsenalEvergreenIds = new Set(me.arsenal.flatMap((card) =>
    input.cards[card.cardId]?.name.trim().toLowerCase() === "evergreen"
      ? [card.instanceId]
      : []
  ));
  const rootArsenalEmpty = me.arsenal.length === 0;
  const evaluate = (
    state: GameState,
    observed: BotPolicyInput,
    root: TurnPlannerRoot,
    complete: boolean,
  ): BriarTurnEvaluation => evaluateBriarTurn(
    state,
    observed,
    root,
    rootRunechants,
    rootWeaponAttacks,
    firstCycleBurnIds,
    handEvergreenIds,
    arsenalEvergreenIds,
    rootArsenalEmpty,
    config,
    complete,
  );
  const plan = planTurn(input, {
    maxSearchNodes: BRIAR_MAX_SEARCH_NODES,
    maxTransitions: BRIAR_MAX_TRANSITIONS,
    maxRootCandidates: BRIAR_MAX_ROOT_CANDIDATES,
    chooseForced: config.chooseForced,
    cardOpportunity: config.cardOpportunity,
    comparePitchOrder: config.comparePitchOrder,
    scoreIntent: config.scoreIntent,
    rankCandidate: config.rankCandidate,
    prepareCandidates: prepareCandidates
      ? (candidates, observed) => prepareCandidates(candidates, observed)
      : undefined,
    evaluateEnd: evaluate,
    evaluateHorizon(state, observed, root) {
      const base = evaluate(state, observed, root, false);
      const me = observed.view.players[root.seat];
      const remaining = config.estimateRemaining([...me.hand, ...me.arsenal], observed);
      return { ...base, score: base.score + remaining * 80, complete: false };
    },
  });
  if (!plan) return undefined;

  const rootOwn = new Map([
    ...me.hand,
    ...me.arsenal,
    ...me.pitch,
    ...me.graveyard,
    ...me.banish,
    ...me.weapons,
    ...Object.values(me.equipment).filter((card): card is CardView => card !== undefined),
    ...me.board,
  ].map((card) => [card.instanceId, card]));
  const firstCycleBurnPitchIds = new Set<number>();
  let starFallAttacks = 0;
  let evergreenPlayedFromArsenal = 0;
  const spentIds = new Set<number>();
  for (const intent of plan.line) {
    if (
      intent.kind === "play-card" || intent.kind === "play-from-arsenal" ||
      intent.kind === "play-from-zone" || intent.kind === "activate-ability"
    ) {
      for (const id of intent.pitchInstanceIds) {
        spentIds.add(id);
        const card = rootOwn.get(id);
        if (
          config.fatiguePlan && card && (card.pitchCount ?? 0) === 0 &&
          input.cards[card.cardId]?.name.trim().toLowerCase() === "burn up // shock"
        ) firstCycleBurnPitchIds.add(id);
      }
    }
    if (intent.kind === "play-card") spentIds.add(intent.instanceId);
    if (intent.kind === "play-from-arsenal") {
      spentIds.add(intent.instanceId);
      if (arsenalEvergreenIds.has(intent.instanceId)) evergreenPlayedFromArsenal++;
    }
    if (intent.kind === "activate-ability") {
      const source = rootOwn.get(intent.sourceInstanceId);
      if (source && input.cards[source.cardId]?.name.trim().toLowerCase() === "star fall") {
        starFallAttacks++;
      }
    }
  }
  const evergreenPreservedForArsenal = [...handEvergreenIds].every((id) => !spentIds.has(id));
  const lineBonus = plan.line.reduce(
    (total, intent) => total + config.scoreIntent(intent, input),
    0,
  );
  return {
    ...plan,
    evaluation: {
      ...plan.evaluation,
      score: plan.evaluation.score + lineBonus,
      firstCycleBurnsPitched: firstCycleBurnPitchIds.size,
      starFallAttacks,
      evergreenPreservedForArsenal,
      evergreenPlayedFromArsenal,
    },
  };
}
