import { Worker } from "node:worker_threads";
import type { BotDecision } from "@fyendal/bot";
import type { BotOpponent } from "@fyendal/shared";
import type { PersistedStateV1 } from "./persistedState.js";
import {
  decodeBotPolicyWorkerResponse,
  type BotPolicyTask,
} from "./botPolicyWorkerProtocol.js";

/** One wall-clock budget for every bot task, including queueing, worker
 * startup, state hydration, legal-intent generation, and policy execution. */
export const BOT_POLICY_DECISION_TIMEOUT_MS = 5_000;
export const MAX_BOT_POLICY_QUEUE = 128;

export type BotPolicyExecutionFailure = "timeout" | "overflow" | "crash" | "policy" | "stopped";

export interface BotPolicyExecutionTelemetry {
  queueMs: number;
  totalMs: number;
  queueDepth: number;
  generation: number;
}

export class BotPolicyExecutionError extends Error {
  constructor(
    readonly reason: BotPolicyExecutionFailure,
    message: string,
    readonly telemetry?: BotPolicyExecutionTelemetry,
  ) {
    super(message);
    this.name = "BotPolicyExecutionError";
  }
}

export interface BotPolicyRequest {
  code: string;
  version: number;
  rulesetVersion: string;
  botId: BotOpponent;
  seat: 0 | 1;
  state: PersistedStateV1;
}

export interface BotPolicyExecutionResult {
  decision: BotDecision;
  queueMs: number;
  computeMs: number;
  totalMs: number;
  queueDepth: number;
  generation: number;
}

export interface BotPolicyExecutor {
  decide(request: BotPolicyRequest): Promise<BotPolicyExecutionResult>;
  stop(): void;
}

interface WorkerPort {
  postMessage(value: unknown): void;
  on(event: "message", listener: (value: unknown) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

type WorkerFactory = (url: URL) => WorkerPort;

interface QueuedTask {
  task: BotPolicyTask;
  enqueuedAt: number;
  queueDepth: number;
  generation: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve(value: BotPolicyExecutionResult): void;
  reject(error: BotPolicyExecutionError): void;
  startedAt?: number;
}

interface BotPolicyExecutorOptions {
  timeoutMs?: number;
  maxQueue?: number;
  now?: () => number;
  workerUrl?: URL;
  workerFactory?: WorkerFactory;
}

export function botPolicyWorkerUrl(moduleUrl = import.meta.url): URL {
  const extension = moduleUrl.endsWith(".ts") ? "ts" : "js";
  return new URL(`./botPolicyWorker.${extension}`, moduleUrl);
}

export class WorkerBotPolicyExecutor implements BotPolicyExecutor {
  private readonly timeoutMs: number;
  private readonly maxQueue: number;
  private readonly now: () => number;
  private readonly url: URL;
  private readonly factory: WorkerFactory;
  private readonly queue: QueuedTask[] = [];
  private worker: WorkerPort | null = null;
  private active: QueuedTask | null = null;
  private nextTaskId = 1;
  private generation = 0;
  private stopped = false;

  constructor(options: BotPolicyExecutorOptions = {}) {
    this.url = options.workerUrl ?? botPolicyWorkerUrl();
    this.timeoutMs = options.timeoutMs ?? BOT_POLICY_DECISION_TIMEOUT_MS;
    this.maxQueue = options.maxQueue ?? MAX_BOT_POLICY_QUEUE;
    this.now = options.now ?? Date.now;
    this.factory = options.workerFactory ?? ((url) => {
      if (url.pathname.endsWith(".ts")) {
        const source = `import("tsx/esm/api").then(({ register }) => { register(); return import(${JSON.stringify(url.href)}); });`;
        return new Worker(source, {
          name: "fyendal-bot-policy",
          eval: true,
          execArgv: [],
        });
      }
      return new Worker(url, {
        name: "fyendal-bot-policy",
        execArgv: process.execArgv,
      });
    });
  }

  decide(request: BotPolicyRequest): Promise<BotPolicyExecutionResult> {
    if (this.stopped) {
      return Promise.reject(new BotPolicyExecutionError("stopped", "bot policy executor stopped"));
    }
    const outstanding = this.queue.length + (this.active ? 1 : 0);
    if (this.active && this.queue.length >= this.maxQueue) {
      return Promise.reject(new BotPolicyExecutionError(
        "overflow",
        "bot policy queue is full",
        {
          queueMs: 0,
          totalMs: 0,
          queueDepth: outstanding + 1,
          generation: this.generation,
        },
      ));
    }
    const task: BotPolicyTask = {
      taskId: this.nextTaskId++,
      ...request,
    };
    const enqueuedAt = this.now();
    return new Promise<BotPolicyExecutionResult>((resolve, reject) => {
      const queued = {
        task,
        enqueuedAt,
        queueDepth: outstanding + 1,
        generation: 0,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.abortAll(new BotPolicyExecutionError(
            "timeout",
            `bot policy task ${task.taskId} exceeded ${this.timeoutMs}ms`,
          ));
        }, this.timeoutMs),
      } satisfies QueuedTask;
      this.queue.push(queued);
      this.pump();
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.abortAll(new BotPolicyExecutionError("stopped", "bot policy executor stopped"));
  }

  private spawn(): WorkerPort {
    const worker = this.factory(this.url);
    this.worker = worker;
    this.generation++;
    worker.on("message", (value) => this.onMessage(worker, value));
    worker.on("error", (error) => {
      if (this.worker !== worker) return;
      this.abortAll(new BotPolicyExecutionError("crash", `bot policy worker failed: ${error.message}`));
    });
    worker.on("exit", (code) => {
      if (this.worker !== worker) return;
      this.abortAll(new BotPolicyExecutionError("crash", `bot policy worker exited with code ${code}`));
    });
    return worker;
  }

  private pump(): void {
    if (this.stopped || this.active || this.queue.length === 0) return;
    let worker: WorkerPort;
    try {
      worker = this.worker ?? this.spawn();
    } catch (error) {
      this.abortAll(new BotPolicyExecutionError(
        "crash",
        `bot policy worker spawn failed: ${error instanceof Error ? error.message : "unknown error"}`,
      ));
      return;
    }
    const task = this.queue.shift()!;
    task.startedAt = this.now();
    task.generation = this.generation;
    this.active = task;
    try {
      worker.postMessage(task.task);
    } catch (error) {
      this.abortAll(new BotPolicyExecutionError(
        "crash",
        `bot policy worker post failed: ${error instanceof Error ? error.message : "unknown error"}`,
      ));
    }
  }

  private onMessage(worker: WorkerPort, value: unknown): void {
    if (this.worker !== worker) return;
    const response = decodeBotPolicyWorkerResponse(value);
    const active = this.active;
    if (!response || !active || response.taskId !== active.task.taskId) {
      this.abortAll(new BotPolicyExecutionError("crash", "invalid bot policy worker response"));
      return;
    }
    clearTimeout(active.timeout);
    this.active = null;
    if (response.kind === "error") {
      active.reject(new BotPolicyExecutionError(
        "policy",
        response.error,
        this.telemetry(active, this.now()),
      ));
    } else {
      const finishedAt = this.now();
      active.resolve({
        decision: response.decision,
        queueMs: Math.max(0, (active.startedAt ?? finishedAt) - active.enqueuedAt),
        computeMs: response.computeMs,
        totalMs: Math.max(0, finishedAt - active.enqueuedAt),
        queueDepth: active.queueDepth,
        generation: active.generation,
      });
    }
    this.pump();
  }

  private abortAll(error: BotPolicyExecutionError): void {
    const worker = this.worker;
    this.worker = null;
    const tasks = [...(this.active ? [this.active] : []), ...this.queue];
    this.active = null;
    this.queue.length = 0;
    const failedAt = this.now();
    for (const task of tasks) {
      clearTimeout(task.timeout);
      task.reject(new BotPolicyExecutionError(
        error.reason,
        error.message,
        this.telemetry(task, failedAt),
      ));
    }
    if (worker) void worker.terminate().catch(() => undefined);
  }

  private telemetry(task: QueuedTask, at: number): BotPolicyExecutionTelemetry {
    return {
      queueMs: Math.max(0, (task.startedAt ?? at) - task.enqueuedAt),
      totalMs: Math.max(0, at - task.enqueuedAt),
      queueDepth: task.queueDepth,
      generation: task.generation || this.generation,
    };
  }
}
