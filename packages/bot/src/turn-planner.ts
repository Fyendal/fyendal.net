import { applyIntent, legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { CardView, GameIntent } from "@fyendal/shared";
import { strategicPitchIntents, type BotPolicyInput } from "./policy.js";

export const DEFAULT_MAX_SEARCH_NODES = 64;
export const DEFAULT_MAX_SEARCH_TRANSITIONS = 512;
export const MAX_ROOT_CANDIDATES = 48;
const DEFAULT_MAX_ACTION_DEPTH = 12;
const DEFAULT_MAX_FORCED_STEPS = 160;

export interface TurnEvaluation {
  score: number;
  complete: boolean;
}

export interface TurnPlan<Evaluation extends TurnEvaluation = TurnEvaluation> {
  intent: GameIntent;
  line: readonly GameIntent[];
  checkpoints: readonly TurnPlanCheckpoint[];
  nodes: number;
  transitions: number;
  evaluation: Evaluation;
  candidateTrace: TurnPlannerCandidateTrace;
}

export interface TurnPlanCheckpoint {
  observationKey: string;
  intent: GameIntent;
}

export interface TurnPlannerCandidateTrace {
  decisions: number;
  generated: number;
  strategic: number;
  prepared: number;
  rootGenerated: number;
  rootStrategic: number;
  rootPrepared: number;
}

export interface TurnPlannerRoot {
  seat: 0 | 1;
  turn: number;
  life: number;
  opponentLife: number;
  opponentHandCount: number;
  opponentEquipmentDefense: number;
  threatenedAtRoot: number;
  equipmentIds: ReadonlySet<number>;
  deckIds: ReadonlySet<number>;
  expectedDrawValue: number;
  cards: BotPolicyInput["cards"];
}

export interface OpponentResponseEvaluation {
  rawDamage: number;
  attackThreat: number;
  expectedPrevention: number;
  expectedDamage: number;
  hitRate: number;
}

/** Preserve observed conversion as the primary signal while charging a
 * meaningful expected-defense tax. This avoids treating uncertain hidden
 * blocks as guaranteed and keeps combo sequencing from collapsing into only
 * the first attack. */
export function responseWeightedDamage(response: OpponentResponseEvaluation): number {
  return response.rawDamage * 0.75 + response.expectedDamage * 0.25;
}

function threatenedThisTurn(input: BotPolicyInput, seat: 0 | 1): number {
  const turns = input.view.gameStats?.turns ?? [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]!;
    if (turn.turn === input.view.turn && turn.activePlayer === input.view.activePlayer) {
      return turn.threatened[seat];
    }
  }
  return 0;
}

/** Public-information defense model for planning. Engine rollout intentionally
 * declines hidden hand blocks; this converts its goldfish result into a
 * weighted no-block / efficient-block / maximum-pressure expectation using
 * only public hand count, life, and face-up equipment defense. */
export function evaluateOpponentResponse(
  input: BotPolicyInput,
  root: TurnPlannerRoot,
): OpponentResponseEvaluation {
  const rawDamage = Math.max(0, root.opponentLife - input.view.players[1 - root.seat]!.life);
  const attackThreat = Math.min(
    rawDamage,
    Math.max(0, threatenedThisTurn(input, root.seat) - root.threatenedAtRoot),
  );
  if (attackThreat === 0) {
    return {
      rawDamage,
      attackThreat: 0,
      expectedPrevention: 0,
      expectedDamage: rawDamage,
      hitRate: 1,
    };
  }

  const lethalPressure = rawDamage >= root.opponentLife;
  const lowLife = root.opponentLife <= 10;
  const reserveCards = lethalPressure || lowLife ? 0 : 1;
  const efficientCapacity = Math.max(0, root.opponentHandCount - reserveCards) * 3;
  const maximumCapacity = root.opponentHandCount * 3 + root.opponentEquipmentDefense;
  const efficientPrevention = Math.min(attackThreat, efficientCapacity);
  const maximumPrevention = Math.min(attackThreat, maximumCapacity);
  const efficientWeight = lethalPressure ? 0.3 : root.turn === 1 ? 0.2 : 0.55;
  const maximumWeight = lethalPressure ? 0.6 : root.turn === 1 ? 0.7 : 0.25;
  const expectedPrevention = efficientPrevention * efficientWeight +
    maximumPrevention * maximumWeight;
  const expectedAttackDamage = Math.max(0, attackThreat - expectedPrevention);
  const directDamage = rawDamage - attackThreat;
  return {
    rawDamage,
    attackThreat,
    expectedPrevention,
    expectedDamage: directDamage + expectedAttackDamage,
    hitRate: expectedAttackDamage / attackThreat,
  };
}

export interface TurnFutureValue {
  score: number;
  intelligencePenalty: number;
  nextHandValue: number;
  arsenalValue: number;
  arsenalCardInstanceId?: number;
}

export interface TurnFutureConfig {
  cardOpportunity(card: CardView, input: BotPolicyInput): number;
  nextTurnArsenal(card: CardView, input: BotPolicyInput): number;
  handWeight?: number;
  arsenalWeight?: number;
  retainedCardPenalty?: number;
  /** Extra tempo value for turning the final hand card into a new arsenal,
   * preserving a five-card turn instead of spending the card for marginal
   * damage. Hero evaluators should disable this in closing range. */
  emptyArsenalBonus?: number | ((card: CardView, input: BotPolicyInput) => number);
}

/** Values the best legal end-of-turn arsenal choice without advancing cleanup
 * or exposing a simulated private draw. */
export function evaluateTurnFuture(
  input: BotPolicyInput,
  root: TurnPlannerRoot,
  config: TurnFutureConfig,
): TurnFutureValue {
  const me = input.view.players[root.seat];
  const intellect = root.cards[me.heroCardId]?.intellect ?? 4;
  const opportunity = (card: CardView): number =>
    root.deckIds.has(card.instanceId)
      ? root.expectedDrawValue
      : config.cardOpportunity(card, input);
  const existingArsenalValue = me.arsenal.reduce(
    (total, card) => total + config.nextTurnArsenal(card, input),
    0,
  );
  const arsenalCandidates: Array<CardView | undefined> = me.arsenal.length === 0
    ? [undefined, ...me.hand]
    : [undefined];
  let best: TurnFutureValue | undefined;
  for (const arsenalCard of arsenalCandidates) {
    const remaining = arsenalCard
      ? me.hand.filter((card) => card.instanceId !== arsenalCard.instanceId)
      : me.hand;
    const carry = remaining.reduce((total, card) => total + opportunity(card), 0);
    const drawSlots = Math.max(0, intellect - remaining.length);
    const nextHandValue = carry + drawSlots * root.expectedDrawValue;
    const arsenalValue = existingArsenalValue + (
      arsenalCard ? config.nextTurnArsenal(arsenalCard, input) : 0
    );
    const intelligencePenalty = remaining.length;
    const emptyArsenalBonus = arsenalCard && me.arsenal.length === 0 && me.hand.length === 1
      ? typeof config.emptyArsenalBonus === "function"
        ? config.emptyArsenalBonus(arsenalCard, input)
        : (config.emptyArsenalBonus ?? 0)
      : 0;
    const score = nextHandValue * (config.handWeight ?? 3)
      + arsenalValue * (config.arsenalWeight ?? 2)
      + emptyArsenalBonus
      - intelligencePenalty * (config.retainedCardPenalty ?? 2);
    if (!best || score > best.score) {
      best = {
        score,
        intelligencePenalty,
        nextHandValue,
        arsenalValue,
        ...(arsenalCard ? { arsenalCardInstanceId: arsenalCard.instanceId } : {}),
      };
    }
  }
  return best ?? {
    score: 0,
    intelligencePenalty: 0,
    nextHandValue: 0,
    arsenalValue: existingArsenalValue,
  };
}

export interface TurnPlannerConfig<Evaluation extends TurnEvaluation> {
  chooseForced(input: BotPolicyInput): GameIntent;
  cardOpportunity(card: CardView, input: BotPolicyInput): number;
  evaluateEnd(
    state: GameState,
    input: BotPolicyInput,
    root: TurnPlannerRoot,
    complete: boolean,
  ): Evaluation;
  evaluateHorizon?(
    state: GameState,
    input: BotPolicyInput,
    root: TurnPlannerRoot,
  ): Evaluation;
  comparePitchOrder?(
    left: GameIntent,
    right: GameIntent,
    input: BotPolicyInput,
  ): number;
  /** Rank and optionally collapse projection-equivalent clean-action intents.
   * Returned intents must come from `candidates`; the engine simulation remains
   * authoritative for every retained line. */
  prepareCandidates?(
    candidates: readonly GameIntent[],
    input: BotPolicyInput,
    context: { root: TurnPlannerRoot; depth: number },
  ): readonly GameIntent[];
  scoreIntent?(intent: GameIntent, input: BotPolicyInput): number;
  /** Root ordering before the strict candidate cap. Higher values are searched
   * first; omitted policies use a generic public card/action priority. */
  rankCandidate?(intent: GameIntent, input: BotPolicyInput): number;
  maxSearchNodes?: number;
  /** Deterministic cap covering every simulated `applyIntent`, including
   * forced priority, reaction, defense, and resolution steps. */
  maxTransitions?: number;
  /** Emit exact visible-state/legal-intent checkpoints for a caller that can
   * safely reuse speculative continuation steps. Disabled by default because
   * serializing legal arrays is unnecessary for ordinary planning. */
  recordCheckpoints?: boolean;
  maxRootCandidates?: number;
  maxActionDepth?: number;
  maxForcedSteps?: number;
}

interface SearchResult<Evaluation extends TurnEvaluation> {
  score: number;
  line: GameIntent[];
  checkpoints: TurnPlanCheckpoint[];
  evaluation: Evaluation;
}

interface SearchContext<Evaluation extends TurnEvaluation> {
  root: TurnPlannerRoot;
  config: TurnPlannerConfig<Evaluation>;
  nodes: number;
  nodeLimit: number;
  transitions: number;
  transitionLimit: number;
  publicGameId: string;
  memo: Map<string, SearchResult<Evaluation>>;
  candidateTrace: TurnPlannerCandidateTrace;
}

export function boundedRootCandidates<T>(
  candidates: readonly T[],
  maxSearchNodes = DEFAULT_MAX_SEARCH_NODES,
): T[] {
  return candidates.slice(0, Math.min(
    MAX_ROOT_CANDIDATES,
    Math.max(1, maxSearchNodes),
  ));
}

type AdvancedState =
  | { kind: "decision"; state: GameState }
  | { kind: "terminal"; state: GameState; complete: boolean };

function cloneForSimulation(state: GameState, publicGameId: string): GameState {
  const { cardsRef, scriptsRef, ...serializable } = state;
  const copy = JSON.parse(JSON.stringify(serializable)) as GameState;
  copy.cardsRef = cardsRef;
  copy.scriptsRef = scriptsRef;

  // The planner may use authoritative state for simulation but must not learn
  // either real deck order. Rank by public game id and stable card identity.
  const rank = (cardId: string, instanceId: number): number => {
    const text = `${publicGameId}|${cardId}|${instanceId}`;
    let hash = 2_166_136_261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0;
  };
  for (const player of copy.players) {
    player.deck.sort((left, right) =>
      rank(left.cardId, left.instanceId) - rank(right.cardId, right.instanceId)
    );
  }
  return copy;
}

function observation(
  state: GameState,
  seat: 0 | 1,
  cards: BotPolicyInput["cards"],
  publicGameId: string,
): BotPolicyInput {
  return {
    seat,
    view: projectStateFor(state, seat, publicGameId),
    legal: legalIntents(state, seat),
    cards,
  };
}

/** Exact projection-and-legality identity used both by planner memoization and
 * speculative continuation validation. Logs are deliberately excluded so a
 * growing presentation-only history cannot invalidate an otherwise identical
 * decision. */
export function botObservationKey(input: Pick<BotPolicyInput, "view" | "legal">): string {
  const { log: _log, ...policyVisible } = input.view;
  return JSON.stringify({ view: policyVisible, legal: input.legal });
}

export function isCleanActionDecision(state: GameState, seat: 0 | 1): boolean {
  return state.winner === null &&
    state.phase === "action" &&
    state.activePlayer === seat &&
    state.priorityPlayer === seat &&
    state.pendingDecision === null &&
    state.stack.length === 0;
}

function isEndTurnPassPending(state: GameState, seat: 0 | 1): boolean {
  return state.activePlayer === seat &&
    state.phase === "layer" &&
    state.stackResume === "end-action-phase" &&
    state.stackPasses === 1;
}

function opponentRolloutIntent(state: GameState): GameIntent | undefined {
  const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
  const legal = legalIntents(state, actor).filter((intent) => intent.kind !== "concede");
  if (legal.length === 0) return undefined;
  if (state.pendingDecision?.kind === "defend") {
    const noBlock = legal.find((intent) => intent.kind === "defend" && intent.instanceIds.length === 0);
    if (noBlock) return noBlock;
  }
  const payNothing = legal.find((intent) => intent.kind === "choose" && intent.optionId === "pay 0");
  if (payNothing) return payNothing;
  const decline = legal.find((intent) => intent.kind === "choose" &&
    (intent.optionId === "no" || intent.optionId === "decline" || intent.optionId === "pass"));
  if (decline) return decline;
  const pass = legal.find((intent) => intent.kind === "pass");
  if (pass) return pass;
  const close = legal.find((intent) => intent.kind === "close-chain");
  if (close) return close;
  const order = legal.find((intent) => intent.kind === "order-triggers");
  if (order) return order;
  return legal.find((intent) => intent.kind === "skip-runechant");
}

function advanceForced<Evaluation extends TurnEvaluation>(
  state: GameState,
  context: SearchContext<Evaluation>,
): AdvancedState {
  let current = state;
  const { root, config } = context;
  for (let step = 0; step < (config.maxForcedSteps ?? DEFAULT_MAX_FORCED_STEPS); step++) {
    if (current.winner !== null || current.turn !== root.turn) {
      return { kind: "terminal", state: current, complete: true };
    }
    if (isEndTurnPassPending(current, root.seat)) {
      return { kind: "terminal", state: current, complete: true };
    }
    if (current.pendingDecision?.kind === "arsenal" && current.pendingDecision.player === root.seat) {
      return { kind: "terminal", state: current, complete: true };
    }
    if (isCleanActionDecision(current, root.seat)) return { kind: "decision", state: current };

    if (context.transitions >= context.transitionLimit) {
      return { kind: "terminal", state: current, complete: false };
    }
    const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
    const intent = actor === root.seat
      ? config.chooseForced(observation(current, root.seat, root.cards, context.publicGameId))
      : opponentRolloutIntent(current);
    if (!intent) return { kind: "terminal", state: current, complete: false };
    context.transitions++;
    const applied = applyIntent(current, actor, intent);
    if (!applied.ok) return { kind: "terminal", state: current, complete: false };
    current = applied.state;
    if (current.players[root.seat].hand.some((card) => root.deckIds.has(card.instanceId))) {
      // Stop before a simulated private draw can influence another action.
      return { kind: "terminal", state: current, complete: false };
    }
  }
  return { kind: "terminal", state: current, complete: false };
}

function stateKey(input: BotPolicyInput, depth: number): string {
  const { log: _log, ...policyVisible } = input.view;
  return JSON.stringify({ depth, view: policyVisible });
}

function genericCandidatePriority(intent: GameIntent, input: BotPolicyInput): number {
  if (intent.kind === "concede") return Number.NEGATIVE_INFINITY;
  if (intent.kind === "pass") return -1_000;
  if (intent.kind === "close-chain") return -500;
  if (intent.kind === "choose" || intent.kind === "order-triggers" || intent.kind === "skip-runechant") {
    return 0;
  }
  if (intent.kind === "defend" || intent.kind === "stage-defenders") return -100;
  const me = input.view.players[input.seat];
  const sourceId = intent.kind === "activate-ability" ? intent.sourceInstanceId : intent.instanceId;
  const card = [
    ...me.hand,
    ...me.arsenal,
    ...me.banish,
    ...me.graveyard,
    ...me.weapons,
    ...me.board,
    ...Object.values(me.equipment).flatMap((candidate) => candidate ? [candidate] : []),
  ].find((candidate) => candidate.instanceId === sourceId);
  const data = card ? input.cards[card.cardId] : undefined;
  const attack = Math.max(0, card?.attack ?? data?.attack ?? 0);
  const continues = data?.keywords?.some((keyword) => keyword.toLowerCase() === "go again") === true ||
    /\bgo again\b/i.test(data?.text ?? "");
  const pitchCount = "pitchInstanceIds" in intent ? intent.pitchInstanceIds.length : 0;
  return attack * 10 + (continues ? 20 : 0) - pitchCount;
}

function evaluateEnd<Evaluation extends TurnEvaluation>(
  state: GameState,
  context: SearchContext<Evaluation>,
  complete: boolean,
): Evaluation {
  const input = observation(
    state,
    context.root.seat,
    context.root.cards,
    context.publicGameId,
  );
  return context.config.evaluateEnd(state, input, context.root, complete);
}

function evaluateHorizon<Evaluation extends TurnEvaluation>(
  state: GameState,
  context: SearchContext<Evaluation>,
): Evaluation {
  const input = observation(
    state,
    context.root.seat,
    context.root.cards,
    context.publicGameId,
  );
  return context.config.evaluateHorizon
    ? context.config.evaluateHorizon(state, input, context.root)
    : context.config.evaluateEnd(state, input, context.root, false);
}

function plannerCandidates<Evaluation extends TurnEvaluation>(
  input: BotPolicyInput,
  context: SearchContext<Evaluation>,
  depth: number,
): GameIntent[] {
  const generated = input.legal.filter((intent) =>
    intent.kind !== "concede" && intent.kind !== "stage-defenders"
  );
  const strategic = strategicPitchIntents(
    generated,
    context.config.comparePitchOrder
      ? (left, right) => context.config.comparePitchOrder!(left, right, input)
      : undefined,
  );
  const requested = context.config.prepareCandidates?.(
    strategic,
    input,
    { root: context.root, depth },
  ) ?? strategic;
  const legalCandidates = new Set(strategic);
  const prepared = [...new Set(requested)].filter((intent) => legalCandidates.has(intent));
  const selectedBeforeRootLimit = prepared.length > 0 ? prepared : strategic;
  const rootLimit = Math.min(
    context.config.maxRootCandidates ?? MAX_ROOT_CANDIDATES,
    Math.max(1, context.config.maxSearchNodes ?? DEFAULT_MAX_SEARCH_NODES),
  );
  const ordered = depth === 0 && selectedBeforeRootLimit.length > rootLimit
    ? selectedBeforeRootLimit
      .map((intent, index) => ({
        intent,
        index,
        score: context.config.rankCandidate?.(intent, input) ??
          context.config.scoreIntent?.(intent, input) ??
          genericCandidatePriority(intent, input),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(({ intent }) => intent)
    : selectedBeforeRootLimit;
  const selected = depth === 0
    ? boundedRootCandidates(
      ordered,
      Math.min(
        context.config.maxSearchNodes ?? DEFAULT_MAX_SEARCH_NODES,
        context.config.maxRootCandidates ?? MAX_ROOT_CANDIDATES,
      ),
    )
    : ordered;
  context.candidateTrace.decisions++;
  context.candidateTrace.generated += generated.length;
  context.candidateTrace.strategic += strategic.length;
  context.candidateTrace.prepared += selected.length;
  if (depth === 0) {
    context.candidateTrace.rootGenerated = generated.length;
    context.candidateTrace.rootStrategic = strategic.length;
    context.candidateTrace.rootPrepared = selected.length;
  }
  return selected;
}

function search<Evaluation extends TurnEvaluation>(
  state: GameState,
  context: SearchContext<Evaluation>,
  depth: number,
): SearchResult<Evaluation> {
  const maxDepth = context.config.maxActionDepth ?? DEFAULT_MAX_ACTION_DEPTH;
  if (context.nodes >= context.nodeLimit ||
    context.transitions >= context.transitionLimit || depth >= maxDepth) {
    const evaluation = evaluateHorizon(state, context);
    return { score: evaluation.score, line: [], checkpoints: [], evaluation };
  }
  // Projection and legal-intent generation are among the planner's heavier
  // operations. Build the observation once and reuse it for both the memo key
  // and candidate preparation.
  const observed = observation(
    state,
    context.root.seat,
    context.root.cards,
    context.publicGameId,
  );
  const key = stateKey(observed, depth);
  const cached = context.memo.get(key);
  if (cached) return cached;
  const observedKey = context.config.recordCheckpoints
    ? botObservationKey(observed)
    : undefined;

  const candidates = plannerCandidates(observed, context, depth);
  let best: SearchResult<Evaluation> | undefined;
  for (const intent of candidates) {
    if (context.nodes >= context.nodeLimit || context.transitions >= context.transitionLimit) break;
    context.nodes++;
    context.transitions++;
    const applied = applyIntent(state, context.root.seat, intent);
    if (!applied.ok) continue;
    const intentScore = context.config.scoreIntent?.(intent, observed) ?? 0;
    const advanced = advanceForced(applied.state, context);
    const result = advanced.kind === "decision"
      ? (() => {
          const continuation = search(advanced.state, context, depth + 1);
          return {
            score: continuation.score + intentScore,
            line: [intent, ...continuation.line],
            checkpoints: observedKey
              ? [{ observationKey: observedKey, intent }, ...continuation.checkpoints]
              : continuation.checkpoints,
            evaluation: continuation.evaluation,
          };
        })()
      : (() => {
          const evaluation = evaluateEnd(advanced.state, context, advanced.complete);
          return {
            score: evaluation.score + intentScore,
            line: [intent],
            checkpoints: observedKey ? [{ observationKey: observedKey, intent }] : [],
            evaluation,
          };
        })();
    if (!best || result.score > best.score) best = result;
  }
  const result = best ?? (() => {
    const evaluation = evaluateHorizon(state, context);
    return { score: evaluation.score, line: [], checkpoints: [], evaluation };
  })();
  context.memo.set(key, result);
  return result;
}

export function planTurn<Evaluation extends TurnEvaluation>(
  input: BotPolicyInput,
  config: TurnPlannerConfig<Evaluation>,
): TurnPlan<Evaluation> | undefined {
  if (!input.state || !isCleanActionDecision(input.state, input.seat)) return undefined;
  const simulation = cloneForSimulation(input.state, input.view.gameId);
  const me = input.view.players[input.seat];
  const deck = simulation.players[input.seat].deck;
  const root: TurnPlannerRoot = {
    seat: input.seat,
    turn: simulation.turn,
    life: me.life,
    opponentLife: input.view.players[1 - input.seat]!.life,
    opponentHandCount: input.view.players[1 - input.seat]!.handCount,
    opponentEquipmentDefense: Object.values(input.view.players[1 - input.seat]!.equipment)
      .flatMap((card) => card ? [card] : [])
      .reduce((total, card) => total + Math.max(0, card.defense ?? input.cards[card.cardId]?.defense ?? 0), 0),
    threatenedAtRoot: threatenedThisTurn(input, input.seat),
    equipmentIds: new Set(
      Object.values(me.equipment).flatMap((card) => card ? [card.instanceId] : []),
    ),
    deckIds: new Set(deck.map((card) => card.instanceId)),
    expectedDrawValue: deck.length === 0
      ? 0
      : deck.reduce((total, card) => total + config.cardOpportunity(card, input), 0) / deck.length,
    cards: input.cards,
  };
  const context: SearchContext<Evaluation> = {
    root,
    config,
    nodes: 0,
    nodeLimit: config.maxSearchNodes ?? DEFAULT_MAX_SEARCH_NODES,
    transitions: 0,
    transitionLimit: config.maxTransitions ?? DEFAULT_MAX_SEARCH_TRANSITIONS,
    publicGameId: input.view.gameId,
    memo: new Map(),
    candidateTrace: {
      decisions: 0,
      generated: 0,
      strategic: 0,
      prepared: 0,
      rootGenerated: 0,
      rootStrategic: 0,
      rootPrepared: 0,
    },
  };
  const rootCandidates = plannerCandidates(input, context, 0);
  if (rootCandidates.length === 0) return undefined;
  const totalBudget = config.maxSearchNodes ?? DEFAULT_MAX_SEARCH_NODES;
  const totalTransitionBudget = config.maxTransitions ?? DEFAULT_MAX_SEARCH_TRANSITIONS;
  const rootObservationKey = config.recordCheckpoints ? botObservationKey(input) : undefined;
  let best: SearchResult<Evaluation> | undefined;
  for (const [index, intent] of rootCandidates.entries()) {
    if (context.nodes >= totalBudget || context.transitions >= totalTransitionBudget) break;
    const rootsRemaining = rootCandidates.length - index;
    const budgetRemaining = totalBudget - context.nodes;
    const rootBudget = Math.max(1, Math.floor(budgetRemaining / rootsRemaining));
    context.nodeLimit = Math.min(totalBudget, context.nodes + rootBudget);
    const transitionsRemaining = totalTransitionBudget - context.transitions;
    const rootTransitionBudget = Math.max(1, Math.floor(transitionsRemaining / rootsRemaining));
    context.transitionLimit = Math.min(
      totalTransitionBudget,
      context.transitions + rootTransitionBudget,
    );
    context.memo = new Map();
    context.nodes++;
    context.transitions++;
    const applied = applyIntent(simulation, input.seat, intent);
    if (!applied.ok) continue;
    const intentScore = config.scoreIntent?.(intent, input) ?? 0;
    const advanced = advanceForced(applied.state, context);
    const result = advanced.kind === "decision"
      ? (() => {
          const continuation = search(advanced.state, context, 1);
          return {
            score: continuation.score + intentScore,
            line: [intent, ...continuation.line],
            checkpoints: rootObservationKey
              ? [{ observationKey: rootObservationKey, intent }, ...continuation.checkpoints]
              : continuation.checkpoints,
            evaluation: continuation.evaluation,
          };
        })()
      : (() => {
          const evaluation = evaluateEnd(advanced.state, context, advanced.complete);
          return {
            score: evaluation.score + intentScore,
            line: [intent],
            checkpoints: rootObservationKey ? [{ observationKey: rootObservationKey, intent }] : [],
            evaluation,
          };
        })();
    if (!best || result.score > best.score) best = result;
  }
  const first = best?.line[0];
  return first && best
    ? {
        intent: first,
        line: best.line,
        checkpoints: best.checkpoints,
        nodes: context.nodes,
        transitions: context.transitions,
        evaluation: best.evaluation,
        candidateTrace: context.candidateTrace,
      }
    : undefined;
}
