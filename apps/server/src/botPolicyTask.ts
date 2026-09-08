import { performance } from "node:perf_hooks";
import {
  botDecisionFromTrace,
  botDefinition,
  createFaiProductionSession,
  faiStrategyFromInput,
  type BotDecision,
  type BotDefinition,
  type BotPolicyInput,
  type FaiProductionSession,
  type FaiPolicyStateV1,
  type FaiStrategy,
} from "@fyendal/bot";
import { cardData, scripts } from "@fyendal/cards";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { decodePersistedState } from "./persistedState.js";
import type { DecodedBotPolicyTask } from "./botPolicyWorkerProtocol.js";

export const MAX_BOT_POLICY_SESSIONS = 128;

interface CachedFaiSession {
  seat: 0 | 1;
  strategy: FaiStrategy;
  lastVersion: number;
  lastTurn: number;
  session: FaiProductionSession;
}

/** Worker-local Fai memory is an optimization/strategy aid, never the source
 * of legal state. Forward version gaps are normal when a human responds
 * between bot decisions, so the session observes the newer authoritative
 * state instead of forgetting its turn plan. Undo/regression explicitly resets
 * it; a worker/server restart starts cold and infers the durable strategy from
 * the equipped weapon. */
export class BotPolicySessionCache {
  private readonly fai = new Map<string, CachedFaiSession>();

  constructor(
    private readonly createFaiSession: (
      input: BotPolicyInput,
      state?: FaiPolicyStateV1,
    ) => FaiProductionSession =
      createFaiProductionSession,
  ) {}

  clear(): void {
    this.fai.clear();
  }

  decide(
    task: DecodedBotPolicyTask,
    definition: BotDefinition,
    input: BotPolicyInput,
  ): { decision: BotDecision; nextPolicyState: FaiPolicyStateV1 | null } {
    if (definition.id !== "fai") {
      return { decision: definition.chooseDecision(input), nextPolicyState: null };
    }
    const strategy = faiStrategyFromInput(input);
    const cached = this.fai.get(task.code);
    const reset = task.resetSession || !cached || cached.seat !== task.seat ||
      cached.strategy !== strategy || task.version <= cached.lastVersion ||
      input.view.turn < cached.lastTurn;
    const session = task.policyState
      ? this.createFaiSession(input, task.policyState)
      : reset ? this.createFaiSession(input) : cached.session;
    this.fai.delete(task.code);
    while (this.fai.size >= MAX_BOT_POLICY_SESSIONS) {
      const oldest = this.fai.keys().next().value as string | undefined;
      if (!oldest) break;
      this.fai.delete(oldest);
    }
    this.fai.set(task.code, {
      seat: task.seat,
      strategy,
      lastVersion: task.version,
      lastTurn: input.view.turn,
      session,
    });
    const decision = botDecisionFromTrace(session.chooseWithTrace(input));
    return { decision, nextPolicyState: session.snapshot() };
  }
}

const workerSessions = new BotPolicySessionCache();

export function executeBotPolicyTask(
  task: DecodedBotPolicyTask,
  sessions: BotPolicySessionCache = workerSessions,
): { decision: BotDecision; nextPolicyState: FaiPolicyStateV1 | null; computeMs: number } {
  const startedAt = performance.now();
  const state = decodePersistedState(
    task.state,
    task.code,
    cardData,
    scripts,
    task.rulesetVersion,
  );
  const definition = botDefinition(task.botId);
  if (!definition) throw new Error(`unsupported bot ${task.botId}`);
  const input: BotPolicyInput = {
    seat: task.seat,
    view: projectStateFor(state, task.seat, task.code),
    legal: legalIntents(state, task.seat),
    cards: cardData,
    state,
  };
  const result = sessions.decide(task, definition, input);
  return { ...result, computeMs: performance.now() - startedAt };
}
