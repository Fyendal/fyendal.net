import {
  botDefinition,
  type BotDecision,
  type TurnPlanCheckpoint,
  type TurnPlannerCandidateTrace,
} from "@fyendal/bot";
import { isGameIntent } from "@fyendal/protocol";
import type { BotOpponent } from "@fyendal/shared";
import type { PersistedStateV1 } from "./persistedState.js";

const TASK_KEYS = [
  "taskId",
  "code",
  "version",
  "rulesetVersion",
  "botId",
  "seat",
  "state",
] as const;
const TRACE_KEYS = [
  "decisions",
  "generated",
  "strategic",
  "prepared",
  "rootGenerated",
  "rootStrategic",
  "rootPrepared",
] as const satisfies readonly (keyof TurnPlannerCandidateTrace)[];

export interface BotPolicyTask {
  taskId: number;
  code: string;
  version: number;
  rulesetVersion: string;
  botId: BotOpponent;
  seat: 0 | 1;
  state: PersistedStateV1;
}

export interface DecodedBotPolicyTask extends Omit<BotPolicyTask, "state"> {
  state: unknown;
}

export interface BotPolicyWorkerSuccess {
  kind: "result";
  taskId: number;
  decision: BotDecision;
  computeMs: number;
}

export interface BotPolicyWorkerFailure {
  kind: "error";
  taskId: number;
  error: string;
}

export type BotPolicyWorkerResponse = BotPolicyWorkerSuccess | BotPolicyWorkerFailure;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) &&
    keys.every((key) => Object.hasOwn(value, key));
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function decodeCheckpoint(value: unknown): TurnPlanCheckpoint | null {
  const candidate = record(value);
  if (!candidate || !exact(candidate, ["observationKey", "intent"])) return null;
  if (typeof candidate.observationKey !== "string" || candidate.observationKey.length > 100_000) {
    return null;
  }
  return isGameIntent(candidate.intent)
    ? { observationKey: candidate.observationKey, intent: candidate.intent }
    : null;
}

function decodeTrace(value: unknown): TurnPlannerCandidateTrace | null {
  const candidate = record(value);
  if (!candidate || !exact(candidate, TRACE_KEYS)) return null;
  if (!safeInteger(candidate.decisions) || !safeInteger(candidate.generated) ||
    !safeInteger(candidate.strategic) || !safeInteger(candidate.prepared) ||
    !safeInteger(candidate.rootGenerated) || !safeInteger(candidate.rootStrategic) ||
    !safeInteger(candidate.rootPrepared)) return null;
  return {
    decisions: candidate.decisions,
    generated: candidate.generated,
    strategic: candidate.strategic,
    prepared: candidate.prepared,
    rootGenerated: candidate.rootGenerated,
    rootStrategic: candidate.rootStrategic,
    rootPrepared: candidate.rootPrepared,
  };
}

function decodeDecision(value: unknown): BotDecision | null {
  const candidate = record(value);
  if (!candidate) return null;
  const allowed = new Set(["intent", "continuation", "planning"]);
  if (!Object.keys(candidate).every((key) => allowed.has(key)) || !Object.hasOwn(candidate, "intent")) {
    return null;
  }
  if (!isGameIntent(candidate.intent)) return null;
  let continuation: readonly TurnPlanCheckpoint[] | undefined;
  if (candidate.continuation !== undefined) {
    if (!Array.isArray(candidate.continuation) || candidate.continuation.length > 160) return null;
    const decoded: TurnPlanCheckpoint[] = [];
    for (const value of candidate.continuation) {
      const checkpoint = decodeCheckpoint(value);
      if (!checkpoint) return null;
      decoded.push(checkpoint);
    }
    continuation = decoded;
  }
  let planning: BotDecision["planning"];
  if (candidate.planning !== undefined) {
    const value = record(candidate.planning);
    if (!value || !exact(value, ["nodes", "transitions", "candidateTrace"]) ||
      !safeInteger(value.nodes) || !safeInteger(value.transitions)) return null;
    const candidateTrace = decodeTrace(value.candidateTrace);
    if (!candidateTrace) return null;
    planning = { nodes: value.nodes, transitions: value.transitions, candidateTrace };
  }
  return {
    intent: candidate.intent,
    ...(continuation ? { continuation } : {}),
    ...(planning ? { planning } : {}),
  };
}

export function decodeBotPolicyTask(value: unknown): DecodedBotPolicyTask | null {
  const candidate = record(value);
  if (!candidate || !exact(candidate, TASK_KEYS)) return null;
  if (!safeInteger(candidate.taskId) || !safeInteger(candidate.version)) return null;
  if (typeof candidate.code !== "string" || !/^[A-Z0-9]{6}$/.test(candidate.code)) return null;
  if (typeof candidate.rulesetVersion !== "string" || candidate.rulesetVersion.length === 0 ||
    candidate.rulesetVersion.length > 256) return null;
  const definition = typeof candidate.botId === "string"
    ? botDefinition(candidate.botId)
    : undefined;
  if (!definition) return null;
  if (!(candidate.seat === 0 || candidate.seat === 1)) return null;
  if (!record(candidate.state)) return null;
  return {
    taskId: candidate.taskId,
    code: candidate.code,
    version: candidate.version,
    rulesetVersion: candidate.rulesetVersion,
    botId: definition.id,
    seat: candidate.seat,
    state: candidate.state,
  };
}

export function decodeBotPolicyWorkerResponse(value: unknown): BotPolicyWorkerResponse | null {
  const candidate = record(value);
  if (!candidate || !safeInteger(candidate.taskId)) return null;
  if (candidate.kind === "error") {
    return exact(candidate, ["kind", "taskId", "error"]) &&
      typeof candidate.error === "string" && candidate.error.length <= 4_096
      ? { kind: "error", taskId: candidate.taskId, error: candidate.error }
      : null;
  }
  if (candidate.kind !== "result" || !exact(candidate, ["kind", "taskId", "decision", "computeMs"]) ||
    !finiteNonnegative(candidate.computeMs)) return null;
  const decision = decodeDecision(candidate.decision);
  return decision
    ? { kind: "result", taskId: candidate.taskId, decision, computeMs: candidate.computeMs }
    : null;
}
