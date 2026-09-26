import type { BotOpponent, GameIntent, GameView } from "./types.js";
import type { BotSimulationSnapshotV1 } from "./simulationState.js";

export type BotFailureReason = "loading" | "crash" | "timeout" | "invalid-result" | "rejected" | "circuit-open" | "oversized";
export interface ClientBotTask {
  type: "bot-task";
  code: string;
  version: number;
  runtimeId: string;
  botId: BotOpponent;
  seat: 0 | 1;
  view: GameView;
  legal: GameIntent[];
  simulation?: BotSimulationSnapshotV1;
  delayMs: number;
}
export type BotSubmission = {
  type: "bot-intent";
  runtimeId: string;
  commandId: string;
  expectedVersion: number;
  elapsedMs: number;
  computeMs?: number;
} & ({ intent: GameIntent } | { failure: BotFailureReason });
export interface BotSubmissionResult {
  type: "bot-result";
  code: string;
  commandId: string;
  version: number;
  status: "applied" | "stale" | "rejected";
}
export type BotWorkerResponse =
  | { type: "ready" }
  | { type: "decision"; code: string; version: number; intent: GameIntent; computeMs: number }
  | { type: "failed"; code: string; version: number };
