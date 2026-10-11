import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { applyIntent, legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import {
  arsenalCardValue,
  equipmentValue,
  heldCardOffense,
  heldCardValue,
  type HeroRulesFactory,
} from "./hand-value.js";
import { strategicPitchIntents, type BotPolicyInput } from "./policy.js";

export const DEFAULT_MAX_SEARCH_NODES = 64;
export const DEFAULT_MAX_SEARCH_TRANSITIONS = 512;
export const MAX_ROOT_CANDIDATES = 48;
export const BOT_OBSERVATION_KEY_LENGTH = 64;
/** Score points per damage equivalent. Every planner term uses this scale. */
export const POINTS_PER_DAMAGE = 100;
/** Unexplored damage at a search horizon is worth slightly less than damage
 * the rollout actually reached. */
export const HORIZON_DAMAGE_POINTS = 85;
export const MAX_BOT_CONTINUATION_STEPS = 32;
const DEFAULT_MAX_ACTION_DEPTH = 12;
const DEFAULT_MAX_FORCED_STEPS = 160;

/** Score at a search horizon. The unplayed hand is either played out this
 * turn or kept for later, never both, so it counts as the better of its held
 * value and its remaining damage, priced like reached damage (see
 * `horizonDamage`). */
export function horizonScore(
  input: BotPolicyInput,
  root: TurnPlannerRoot,
  score: number,
  futureScore: number,
  remainingDamage: number,
): number {
  return score - futureScore +
    Math.max(futureScore, horizonDamage(input, root, remainingDamage) * HORIZON_DAMAGE_POINTS);
}

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
  /** Blocking value given up when each root equipment piece is spent. */
  equipmentValues: ReadonlyMap<number, number>;
  deckIds: ReadonlySet<number>;
  cards: BotPolicyInput["cards"];
  decklists: BotPolicyInput["decklists"];
}

/** Damage-equivalent blocking value of root equipment spent by this line. */
export function spentEquipmentValue(input: BotPolicyInput, root: TurnPlannerRoot): number {
  const equipped = new Set(
    Object.values(input.view.players[root.seat].equipment).flatMap((card) => card ? [card.instanceId] : []),
  );
  let spent = 0;
  for (const [id, value] of root.equipmentValues) if (!equipped.has(id)) spent += value;
  return spent;
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
  return opponentResponseTo(root, root.opponentLife, rawDamage, attackThreat, root.turn === 1);
}

function opponentResponseTo(
  root: TurnPlannerRoot,
  opponentLife: number,
  rawDamage: number,
  attackThreat: number,
  firstTurn: boolean,
): OpponentResponseEvaluation {
  if (attackThreat === 0) {
    return {
      rawDamage,
      attackThreat: 0,
      expectedPrevention: 0,
      expectedDamage: rawDamage,
      hitRate: 1,
    };
  }

  const lethalPressure = rawDamage >= opponentLife;
  const lowLife = opponentLife <= 10;
  const reserveCards = lethalPressure || lowLife ? 0 : 1;
  const efficientCapacity = Math.max(0, root.opponentHandCount - reserveCards) * 3;
  const maximumCapacity = root.opponentHandCount * 3 + root.opponentEquipmentDefense;
  const efficientPrevention = Math.min(attackThreat, efficientCapacity);
  const maximumPrevention = Math.min(attackThreat, maximumCapacity);
  const efficientWeight = lethalPressure ? 0.3 : firstTurn ? 0.2 : 0.55;
  const maximumWeight = lethalPressure ? 0.6 : firstTurn ? 0.7 : 0.25;
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

/** Damage equivalents of attack damage a horizon line has not dealt yet: its
 * margin on top of this turn's attacks under the same response weighting as
 * reached damage, so stopping a search early never outscores the rollout. */
export function horizonDamage(
  input: BotPolicyInput,
  root: TurnPlannerRoot,
  remainingDamage: number,
): number {
  if (remainingDamage <= 0) return 0;
  const reached = evaluateOpponentResponse(input, root);
  const extended = opponentResponseTo(
    root,
    root.opponentLife,
    reached.rawDamage + remainingDamage,
    reached.attackThreat + remainingDamage,
    root.turn === 1,
  );
  return responseWeightedDamage(extended) - responseWeightedDamage(reached);
}

/** Share of a later turn's attack threat the planner credits: the same
 * response weighting `responseWeightedDamage` applies to damage dealt this
 * turn, against the opponent's hand at the root (they refill before the bot's
 * next turn) and their life after this line. */
function futureOffenseRate(
  input: BotPolicyInput,
  root: TurnPlannerRoot,
  attackThreat: number,
): number {
  if (attackThreat <= 0) return 1;
  const opponentLife = input.view.players[1 - root.seat]!.life;
  const response = opponentResponseTo(root, opponentLife, attackThreat, attackThreat, false);
  return responseWeightedDamage(response) / attackThreat;
}

export interface TurnFutureValue {
  /** Points: POINTS_PER_DAMAGE × (held value + arsenal value). */
  score: number;
  heldValue: number;
  arsenalValue: number;
  /** Hand cards still held after the arsenal choice (each displaces a draw). */
  cardsHeld: number;
  arsenalCardInstanceId?: number;
}

/**
 * Damage-equivalent value the turn carries forward: each card left in hand is
 * worth its margin over the draw it displaces, the arsenal card its arsenal
 * value, and with an empty arsenal the best leftover goes there when that
 * beats holding it. Evaluated without advancing cleanup or exposing a draw.
 * Held offense still has to get past the opponent's blocks, so it is priced
 * with the same response weighting as damage dealt this turn; otherwise
 * holding attacks and pumps always outscores spending them into a full hand.
 */
export function evaluateTurnFuture(
  input: BotPolicyInput,
  root: TurnPlannerRoot,
  rules: HeroRulesFactory,
): TurnFutureValue {
  const me = input.view.players[root.seat];
  const threat = [...me.hand, ...me.arsenal].reduce((total, card) =>
    total + heldCardOffense(card, input, rules), 0);
  const rate = futureOffenseRate(input, root, threat);
  const arsenalValue = me.arsenal.reduce((total, card) => total + arsenalCardValue(card, input, rules, rate), 0);
  let heldValue = 0;
  let bestGain = 0;
  let arsenalCardInstanceId: number | undefined;
  for (const card of me.hand) {
    const held = heldCardValue(card, input, rules, rate);
    heldValue += held;
    const gain = me.arsenal.length === 0 ? arsenalCardValue(card, input, rules, rate) - held : 0;
    if (gain > bestGain) {
      bestGain = gain;
      arsenalCardInstanceId = card.instanceId;
    }
  }
  return {
    score: (heldValue + arsenalValue + bestGain) * POINTS_PER_DAMAGE,
    heldValue,
    arsenalValue: arsenalValue + bestGain,
    cardsHeld: me.hand.length - (arsenalCardInstanceId !== undefined ? 1 : 0),
    ...(arsenalCardInstanceId !== undefined ? { arsenalCardInstanceId } : {}),
  };
}

export interface TurnPlannerConfig<Evaluation extends TurnEvaluation> {
  chooseForced(input: BotPolicyInput): GameIntent;
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
  /** Optional larger node slice for the highest-ranked root. */
  firstRootNodeBudget?: number;
  /** Optional larger slice for the highest-ranked root while retaining the
   * same total transition cap across every candidate. */
  firstRootTransitionBudget?: number;
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

function compactSimulationHistory(state: GameState): void {
  state.log.length = 0;
  if (state.gameStats.turns.length > 1) {
    state.gameStats.turns.splice(0, state.gameStats.turns.length - 1);
  }
}

/** Clone only rules-relevant state for speculative planning. Historical logs
 * and completed-turn statistics are presentation data; engine and bot policy
 * decisions use flags plus the latest turn-stat row. */
export function cloneStateForBotSimulation(state: GameState, publicGameId: string): GameState {
  const {
    cardsRef,
    scriptsRef,
    log: _log,
    gameStats,
    ...serializable
  } = state;
  const currentTurnStats = gameStats.turns.at(-1);
  const copy = JSON.parse(JSON.stringify({
    ...serializable,
    gameStats: { turns: currentTurnStats ? [currentTurnStats] : [] },
    log: [],
  })) as GameState;
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
      || left.instanceId - right.instanceId
    );
  }
  return copy;
}

function applySimulationIntent(
  state: GameState,
  seat: number,
  intent: GameIntent,
): ReturnType<typeof applyIntent> {
  const applied = applyIntent(state, seat, intent);
  if (applied.ok) compactSimulationHistory(applied.state);
  return applied;
}

function observation(state: GameState, root: TurnPlannerRoot, publicGameId: string): BotPolicyInput {
  return {
    seat: root.seat,
    view: projectStateFor(state, root.seat, publicGameId),
    legal: legalIntents(state, root.seat),
    cards: root.cards,
    ...(root.decklists ? { decklists: root.decklists } : {}),
  };
}

/** Deterministic policy-relevant projection-and-legality fingerprint used for
 * speculative continuation validation. Presentation logs and completed-turn
 * statistics are deliberately excluded so growing histories cannot invalidate
 * an otherwise identical decision. */
export function botObservationKey(input: Pick<BotPolicyInput, "view" | "legal">): string {
  const {
    log: _log,
    logEntries: _logEntries,
    gameStats,
    ...policyVisible
  } = input.view;
  const currentTurnStats = gameStats?.turns.at(-1);
  const serialized = JSON.stringify({
    view: {
      ...policyVisible,
      ...(gameStats
        ? { gameStats: { turns: currentTurnStats ? [currentTurnStats] : [] } }
        : {}),
    },
    legal: input.legal,
  });
  return bytesToHex(sha256(utf8ToBytes(serialized)));
}

export function isBotObservationKey(value: unknown): value is string {
  return typeof value === "string" &&
    value.length === BOT_OBSERVATION_KEY_LENGTH &&
    /^[0-9a-f]+$/.test(value);
}

export function isCleanActionDecision(state: GameState, seat: 0 | 1): boolean {
  return state.phase !== "game-over" &&
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
  const legal = legalIntents(state, actor).filter((intent) => intent.kind !== "concede" && !intent.kind.endsWith("-draw"));
  if (legal.length === 0) return undefined;
  if (state.pendingDecision?.kind === "defend") {
    const noBlock = legal.find((intent) => intent.kind === "defend" && intent.instanceIds.length === 0);
    if (noBlock) return noBlock;
  }
  // Ward destruction is mandatory. Resolve a legal public source in stable
  // option order so rollouts can reach damage and subsequent attacks instead
  // of treating the prevention choice as the end of the turn.
  if (state.pendingDecision?.chooseHook === "ward") {
    return legal.find((intent) => intent.kind === "choose");
  }
  const payNothing = legal.find((intent) => intent.kind === "choose" && intent.optionId === "pay 0");
  if (payNothing) return payNothing;
  const decline = legal.find((intent) => intent.kind === "choose" &&
    (intent.optionId === "no" || intent.optionId === "decline" || intent.optionId === "pass"));
  if (decline) return decline;
  const chooseMany = legal.find((intent) => intent.kind === "choose-many");
  if (chooseMany) return chooseMany;
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
    if (current.phase === "game-over" || current.turn !== root.turn) {
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
      ? config.chooseForced(observation(current, root, context.publicGameId))
      : opponentRolloutIntent(current);
    if (!intent) return { kind: "terminal", state: current, complete: false };
    context.transitions++;
    const applied = applySimulationIntent(current, actor, intent);
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
  if (intent.kind === "offer-draw" || intent.kind === "accept-draw" || intent.kind === "decline-draw" || intent.kind === "withdraw-draw") return Number.NEGATIVE_INFINITY;
  if (intent.kind === "pass") return -1_000;
  if (intent.kind === "close-chain") return -500;
  if (
    intent.kind === "choose" || intent.kind === "choose-many" ||
    intent.kind === "order-triggers" || intent.kind === "skip-runechant"
  ) {
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
  const input = observation(state, context.root, context.publicGameId);
  return context.config.evaluateEnd(state, input, context.root, complete);
}

function evaluateHorizon<Evaluation extends TurnEvaluation>(
  state: GameState,
  context: SearchContext<Evaluation>,
): Evaluation {
  const input = observation(state, context.root, context.publicGameId);
  return context.config.evaluateHorizon
    ? context.config.evaluateHorizon(state, input, context.root)
    : context.config.evaluateEnd(state, input, context.root, false);
}

function plannerCandidates<Evaluation extends TurnEvaluation>(
  input: BotPolicyInput,
  context: SearchContext<Evaluation>,
  depth: number,
): GameIntent[] {
  // Bot tasks omit draw negotiation, but speculative observations regenerate
  // legal intents from the engine. Keep offer/withdraw loops out of every
  // search depth so they cannot consume the budget or become a continuation.
  const generated = input.legal.filter((intent) =>
    intent.kind !== "concede" && intent.kind !== "stage-defenders" &&
    !intent.kind.endsWith("-draw")
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
  const observed = observation(state, context.root, context.publicGameId);
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
    const applied = applySimulationIntent(state, context.root.seat, intent);
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
  const simulation = cloneStateForBotSimulation(input.state, input.view.gameId);
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
    equipmentValues: new Map(
      Object.values(me.equipment).flatMap((card) => card ? [[card.instanceId, equipmentValue(card, input)]] : []),
    ),
    deckIds: new Set(deck.map((card) => card.instanceId)),
    cards: input.cards,
    decklists: input.decklists,
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
    const rootBudget = index === 0 && config.firstRootNodeBudget !== undefined
      ? Math.max(1, Math.min(budgetRemaining, config.firstRootNodeBudget))
      : Math.max(1, Math.floor(budgetRemaining / rootsRemaining));
    context.nodeLimit = Math.min(totalBudget, context.nodes + rootBudget);
    const transitionsRemaining = totalTransitionBudget - context.transitions;
    const rootTransitionBudget = index === 0 && config.firstRootTransitionBudget !== undefined
      ? Math.max(1, Math.min(transitionsRemaining, config.firstRootTransitionBudget))
      : Math.max(1, Math.floor(transitionsRemaining / rootsRemaining));
    context.transitionLimit = Math.min(
      totalTransitionBudget,
      context.transitions + rootTransitionBudget,
    );
    context.memo = new Map();
    context.nodes++;
    context.transitions++;
    const applied = applySimulationIntent(simulation, input.seat, intent);
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
