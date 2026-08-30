import {
  botObservationKey,
  botDefinitionForDeckId,
  isCleanActionDecision,
  type BotDecision,
  type BotDefinition,
  type BotPolicyInput,
  type TurnPlanCheckpoint,
} from "@fyendal/bot";
import { cardData } from "@fyendal/cards";
import type { GameIntent } from "@fyendal/shared";
import type { ErrorLogger } from "./logging.js";
import {
  BotPolicyExecutionError,
  type BotPolicyExecutionResult,
  type BotPolicyExecutor,
} from "./botPolicyExecutor.js";
import { dehydrateState, stateMessage, type PgRoomStore } from "./store.js";

interface BotRunnerDeps {
  rooms: PgRoomStore;
  afterCommit(code: string, version: number, replayFinalizationId?: string): Promise<void>;
  delayMs?: number;
  logError?: ErrorLogger;
  claim?(code: string): Promise<boolean>;
  policyExecutor?: BotPolicyExecutor;
  /** Test seam only. Production always supplies `policyExecutor`. */
  chooseIntent?(definition: BotDefinition, input: BotPolicyInput): GameIntent;
  definitionForDeckId?(deckId: string | undefined): BotDefinition | undefined;
  now?(): number;
}

export const DEFAULT_BOT_ACTION_DELAY_MS = 1_000;
export const BOT_STANDBY_RETRY_MS = 5_000;
export const SLOW_BOT_DECISION_MS = 250;
export const SLOW_BOT_TURN_MS = 2_000;
export const BOT_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
export const MAX_CACHED_BOT_CONTINUATIONS = 128;

interface CachedBotContinuation {
  turn: number;
  steps: readonly TurnPlanCheckpoint[];
}

interface BotTurnTiming {
  turn: number;
  computeMs: number;
  warned: boolean;
}

function sameIntent(left: GameIntent, right: GameIntent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Complete defender staging may combine individually advertised cards. Every
 * other policy result must be one of the exact authoritative legal intents. */
export function isAdvertisedBotIntent(
  intent: GameIntent,
  legal: readonly GameIntent[],
): boolean {
  if (legal.some((candidate) => sameIntent(candidate, intent))) return true;
  if (intent.kind !== "stage-defenders") return false;
  const advertised = new Set(legal.flatMap((candidate) =>
    candidate.kind === "stage-defenders" ? candidate.instanceIds : []
  ));
  return intent.instanceIds.length > 0 && intent.instanceIds.every((id) => advertised.has(id));
}

/** Conservative progress fallback for a failed policy. Selection stays within
 * the authoritative observation and never reads a hidden zone. */
export function fallbackBotIntent(input: BotPolicyInput): GameIntent | undefined {
  if (input.view.pendingDecision?.kind === "defend") {
    const stagedIds = input.view.pendingDecision.stagedCards?.map((card) => card.instanceId) ?? [];
    const commit = input.legal.find((intent) =>
      intent.kind === "defend" && intent.instanceIds.length > 0
    );
    const me = input.view.players[input.seat];
    const visible = new Map([
      ...me.hand,
      ...me.arsenal,
      ...Object.values(me.equipment).flatMap((card) => card ? [card] : []),
    ].map((card) => [card.instanceId, card]));
    const handIds = new Set(me.hand.map((card) => card.instanceId));
    const equipmentIds = new Set(
      Object.values(me.equipment).flatMap((card) => card ? [card.instanceId] : []),
    );
    const link = [...input.view.chain].reverse().find((candidate) => !candidate.resolved);
    const incoming = link ? Math.max(0, link.attackValue - link.defenseValue) : 0;
    if (commit && (input.view.pendingDecision.stagedDefense ?? 0) >= incoming) return commit;
    const candidates = input.legal.flatMap((intent) =>
      intent.kind === "stage-defenders" ? intent.instanceIds : []
    ).filter((id) => !stagedIds.includes(id));
    const allowed = (id: number): boolean => {
      const ids = [...stagedIds, id];
      if (link?.dominate && ids.filter((candidate) => handIds.has(candidate)).length > 1) return false;
      if (link?.overpower) {
        const actions = ids.filter((candidate) =>
          !equipmentIds.has(candidate) &&
          input.cards[visible.get(candidate)?.cardId ?? ""]?.cardType === "action"
        ).length;
        if (actions > 1) return false;
      }
      return true;
    };
    const next = candidates
      .filter(allowed)
      .map((id, index) => ({
        id,
        index,
        defense: visible.get(id)?.defense ?? input.cards[visible.get(id)?.cardId ?? ""]?.defense ?? 0,
      }))
      .sort((left, right) => right.defense - left.defense || left.index - right.index)[0];
    if (next) return { kind: "stage-defenders", instanceIds: [...stagedIds, next.id] };
    if (commit) return commit;
    const noBlock = input.legal.find((intent) =>
      intent.kind === "defend" && intent.instanceIds.length === 0
    );
    if (noBlock) return noBlock;
  }
  const defaultOption = input.view.pendingDecision?.defaultOption;
  if (defaultOption !== undefined) {
    const choice = input.legal.find((intent) =>
      intent.kind === "choose" && intent.optionId === defaultOption
    );
    if (choice) return choice;
  }
  return input.legal.find((intent) => intent.kind === "pass")
    ?? input.legal.find((intent) => intent.kind !== "concede");
}

/**
 * Lease-owned, post-commit bot driver. It retains only pending timers;
 * ownership and game state remain durable in Postgres. Each tick reloads the
 * authoritative version, chooses from the bot's projected view (with state
 * supplied to projection-safe bounded planners), and commits exactly one
 * intent before broadcasting.
 */
export class BotRunner {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly continuations = new Map<string, CachedBotContinuation>();
  private readonly turnTimings = new Map<string, BotTurnTiming>();
  private stopped = false;

  constructor(private readonly deps: BotRunnerDeps) {}

  schedule(code: string, delayMs = this.deps.delayMs ?? DEFAULT_BOT_ACTION_DELAY_MS): void {
    const upper = code.toUpperCase();
    if (this.stopped || this.timers.has(upper)) return;
    const timer = setTimeout(() => {
      this.timers.delete(upper);
      void this.tick(upper).catch((error: unknown) => {
        this.deps.logError?.(`Bot failed in room ${upper}`, error);
        this.scheduleRetry(upper);
      });
    }, delayMs);
    this.timers.set(upper, timer);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.retryAttempts.clear();
    this.continuations.clear();
    this.turnTimings.clear();
    this.deps.policyExecutor?.stop();
  }

  private resetRetry(code: string): void {
    this.retryAttempts.delete(code);
  }

  private scheduleRetry(code: string): void {
    const attempt = this.retryAttempts.get(code) ?? 0;
    const delay = BOT_RETRY_DELAYS_MS[Math.min(attempt, BOT_RETRY_DELAYS_MS.length - 1)]!;
    this.retryAttempts.set(code, attempt + 1);
    this.schedule(code, delay);
  }

  private clearContinuation(code: string): void {
    this.continuations.delete(code);
  }

  private recordWorkerTiming(
    code: string,
    turn: number,
    definition: BotDefinition,
    timing: BotPolicyExecutionResult,
  ): void {
    const current = this.turnTimings.get(code);
    const next = current?.turn === turn
      ? { ...current, computeMs: current.computeMs + timing.computeMs }
      : { turn, computeMs: timing.computeMs, warned: false };
    if (!next.warned && next.computeMs >= SLOW_BOT_TURN_MS) {
      next.warned = true;
      this.deps.logError?.(
        `Slow bot turn in room ${code}: bot=${definition.id} turn=${turn} workerComputeMs=${Math.round(next.computeMs)}`,
      );
    }
    this.turnTimings.set(code, next);
  }

  private setContinuation(code: string, turn: number, steps: readonly TurnPlanCheckpoint[]): void {
    if (steps.length === 0) {
      this.clearContinuation(code);
      return;
    }
    this.continuations.delete(code);
    while (this.continuations.size >= MAX_CACHED_BOT_CONTINUATIONS) {
      const oldest = this.continuations.keys().next().value as string | undefined;
      if (!oldest) break;
      this.continuations.delete(oldest);
    }
    this.continuations.set(code, { turn, steps });
  }

  private continuationIntent(
    code: string,
    definition: BotDefinition,
    input: BotPolicyInput,
  ): GameIntent | undefined {
    const cached = this.continuations.get(code);
    if (!cached || !definition.chooseContinuationIntent) return undefined;
    if (cached.turn !== input.view.turn) {
      this.clearContinuation(code);
      return undefined;
    }
    const [step, ...remaining] = cached.steps;
    if (!step || step.observationKey !== botObservationKey(input) ||
      !isAdvertisedBotIntent(step.intent, input.legal)) {
      this.clearContinuation(code);
      return undefined;
    }
    const guarded = definition.chooseContinuationIntent(input, step.intent);
    if (!sameIntent(guarded, step.intent)) {
      this.clearContinuation(code);
      return undefined;
    }
    this.setContinuation(code, cached.turn, remaining);
    return guarded;
  }

  private rememberDecision(code: string, turn: number, decision: BotDecision): void {
    // Reactive priority, choice, and reaction decisions do not produce a new
    // clean-action trace. Keep the existing speculative line across those
    // forced steps; its next exact checkpoint will invalidate any divergence.
    if (!decision.continuation) return;
    const [root, ...remaining] = decision.continuation;
    if (!root || !sameIntent(root.intent, decision.intent)) {
      this.clearContinuation(code);
      return;
    }
    this.setContinuation(code, turn, remaining);
  }

  private async applyFallback(
    code: string,
    version: number,
    input: BotPolicyInput,
    rejected?: GameIntent,
  ) {
    const fallback = fallbackBotIntent(input);
    if (!fallback || (rejected && sameIntent(fallback, rejected))) return undefined;
    return this.deps.rooms.applyBotIntent(code, version, fallback);
  }

  private async tick(code: string): Promise<void> {
    if (this.stopped) return;
    const room = await this.deps.rooms.getRoom(code);
    if (!room?.state || room.state.winner !== null) {
      this.clearContinuation(code);
      this.turnTimings.delete(code);
      this.resetRetry(code);
      return;
    }
    const seat = room.seats.findIndex((candidate) => candidate?.controller === "bot");
    if (!(seat === 0 || seat === 1)) {
      this.clearContinuation(code);
      this.resetRetry(code);
      return;
    }
    const actor = room.state.pendingDecision?.player ?? room.state.priorityPlayer;
    if (actor !== seat) {
      this.resetRetry(code);
      return;
    }
    if (this.deps.claim && !(await this.deps.claim(code))) {
      // Only contend for a standby lease while this observation still requires
      // bot work. Human-priority rooms wake naturally on their next commit.
      this.schedule(code, BOT_STANDBY_RETRY_MS);
      return;
    }
    const message = stateMessage(room, seat);
    if (!message || message.type !== "state") return;
    const definition = (this.deps.definitionForDeckId ?? botDefinitionForDeckId)(
      room.seats[seat]?.deckId,
    );
    if (!definition) {
      this.clearContinuation(code);
      this.deps.logError?.(`Unsupported bot deck ${room.seats[seat]?.deckId ?? "unknown"} in room ${code}`);
      this.scheduleRetry(code);
      return;
    }
    const input: BotPolicyInput = {
      seat,
      view: message.view,
      legal: message.legal,
      cards: cardData,
      state: room.state,
    };
    const now = this.deps.now ?? Date.now;
    const startedAt = now();
    let intent: GameIntent | undefined;
    let decision: BotDecision | undefined;
    let workerTiming: BotPolicyExecutionResult | undefined;
    let cacheHit = false;
    try {
      if (!this.deps.chooseIntent && isCleanActionDecision(room.state, seat)) {
        intent = this.continuationIntent(code, definition, input);
        cacheHit = intent !== undefined;
      }
      if (!intent) {
        if (this.deps.chooseIntent) {
          intent = this.deps.chooseIntent(definition, input);
        } else if (this.deps.policyExecutor) {
          workerTiming = await this.deps.policyExecutor.decide({
            code,
            version: room.version,
            rulesetVersion: room.rulesetVersion,
            botId: definition.id,
            seat,
            state: dehydrateState(room.state, room.rulesetVersion),
          });
          if (this.stopped) return;
          decision = workerTiming.decision;
          intent = decision.intent;
          this.recordWorkerTiming(code, input.view.turn, definition, workerTiming);
        } else {
          decision = definition.chooseDecision(input);
          intent = decision.intent;
        }
      }
    } catch (error) {
      if (this.stopped) return;
      this.clearContinuation(code);
      const classification = error instanceof BotPolicyExecutionError ? error.reason : "inline";
      const telemetry = error instanceof BotPolicyExecutionError ? error.telemetry : undefined;
      this.deps.logError?.(
        `Bot policy ${definition.id} failed in room ${code}: version=${room.version} classification=${classification}` +
          (telemetry
            ? ` queueMs=${telemetry.queueMs} totalMs=${telemetry.totalMs} queueDepth=${telemetry.queueDepth} generation=${telemetry.generation}`
            : ""),
        error,
      );
      intent = fallbackBotIntent(input);
    }
    if (intent && !isAdvertisedBotIntent(intent, input.legal)) {
      this.clearContinuation(code);
      this.deps.logError?.(`Bot policy ${definition.id} returned an unadvertised intent in room ${code}`);
      intent = fallbackBotIntent(input);
    }
    const elapsedMs = now() - startedAt;
    if (intent && elapsedMs >= SLOW_BOT_DECISION_MS) {
      const planning = decision?.planning;
      this.deps.logError?.(
        `Slow bot decision in room ${code}: bot=${definition.id} policy=${definition.chooseIntent.name || "anonymous"} elapsedMs=${elapsedMs} intent=${intent.kind} cache=${cacheHit ? "hit" : "miss"}` +
          (workerTiming
            ? ` execution=worker version=${room.version} queueMs=${workerTiming.queueMs} computeMs=${workerTiming.computeMs} totalMs=${workerTiming.totalMs} queueDepth=${workerTiming.queueDepth} generation=${workerTiming.generation}`
            : " execution=inline") +
          (planning ? ` nodes=${planning.nodes} transitions=${planning.transitions}` : ""),
      );
    }
    if (!intent) {
      this.deps.logError?.(`Bot policy ${definition.id} had no safe legal intent in room ${code}`);
      this.scheduleRetry(code);
      return;
    }

    let applied = await this.deps.rooms.applyBotIntent(code, room.version, intent);
    if (!applied.ok) {
      this.clearContinuation(code);
      if (applied.error === "stale bot observation" || applied.error === "bot does not have priority") {
        this.schedule(code);
        return;
      }
      this.deps.logError?.(`Bot action rejected in room ${code}: ${applied.error}`);
      const fallback = await this.applyFallback(code, room.version, input, intent);
      if (!fallback?.ok) {
        if (fallback && (
          fallback.error === "stale bot observation" || fallback.error === "bot does not have priority"
        )) {
          this.schedule(code);
        } else {
          if (fallback) this.deps.logError?.(`Bot fallback rejected in room ${code}: ${fallback.error}`);
          this.scheduleRetry(code);
        }
        return;
      }
      applied = fallback;
      decision = undefined;
    }
    if (decision && sameIntent(decision.intent, intent)) {
      this.rememberDecision(code, input.view.turn, decision);
    }
    await this.deps.afterCommit(code, applied.version, applied.replayFinalizationId);
    this.resetRetry(code);
    this.schedule(code);
  }
}
