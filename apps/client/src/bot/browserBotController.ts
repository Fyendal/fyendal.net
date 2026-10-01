import { isAdvertisedBotIntent } from "@fyendal/bot/intents";
import { decodeBotWorkerResponse } from "@fyendal/protocol";
import type {
  BotFailureReason, BotSubmission, ClientBotTask, GameIntent, ServerMessage,
} from "@fyendal/shared";

const LOADING_TIMEOUT_MS = 10_000;
const DECISION_TIMEOUT_MS = 5_000;
const RESYNC_TIMEOUT_MS = 10_000;
const MAX_FAILURES = 3;

type Task = ClientBotTask | Extract<ServerMessage, { type: "bot-fallback-needed" }>;
export interface BotWorkerPort {
  postMessage(value: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: ErrorEvent) => void) | null;
  onmessageerror: (() => void) | null;
}
interface Deps {
  runtimeId: string;
  createWorker(): BotWorkerPort;
  send(message: BotSubmission | { type: "bot-ready"; runtimeId: string }): boolean;
  resync(): void;
  status(value: "fallback" | "refresh-required" | null): void;
}

/** Private connection-scoped runtime; never contains UI/replay/persisted state. */
export class BrowserBotController {
  private worker: BotWorkerPort | null = null;
  private ready = false;
  private active: Task | null = null;
  private command: BotSubmission | null = null;
  private taskStartedAt = 0;
  private loadingDeadline = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pacing: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private busy = false;
  private code: string | null = null;
  private compatible = false;
  private latestVersion = -1;

  constructor(private readonly deps: Deps) {}

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.pacing) clearTimeout(this.pacing);
    this.timer = this.pacing = null;
  }

  private terminate(): void {
    const worker = this.worker;
    this.worker = null;
    this.ready = this.busy = false;
    this.loadingDeadline = 0;
    worker?.terminate();
  }

  reset(): void {
    this.clearTimers();
    this.terminate();
    this.active = this.command = null;
    this.code = null;
    this.compatible = false;
    this.latestVersion = -1;
    this.failures = 0;
    this.deps.status(null);
  }

  offer(code: string, runtimeId: string): void {
    if (this.code !== code) this.reset();
    this.code = code;
    const wasCompatible = this.compatible;
    this.compatible = runtimeId === this.deps.runtimeId;
    if (!this.compatible) {
      this.clearTimers();
      this.terminate();
      this.active = this.command = null;
      this.deps.status("refresh-required");
      return;
    }
    if (!wasCompatible) this.deps.status(null);
    this.deps.send({ type: "bot-ready", runtimeId });
  }

  observe(code: string, version: number, replace: boolean, ended: boolean): void {
    if (ended) { this.reset(); return; }
    if (this.code !== null && this.code !== code) this.reset();
    this.code = code;
    if (version < this.latestVersion) return;
    this.latestVersion = version;
    if (replace) this.terminate();
    if (this.active && (replace || version > this.active.version)) {
      this.clearTimers();
      if (this.busy) this.terminate();
      this.active = this.command = null;
    }
  }

  receive(task: Task): void {
    if (!this.compatible || task.code !== this.code || task.runtimeId !== this.deps.runtimeId
      || task.version < this.latestVersion) return;
    if (this.active?.code === task.code && this.active.version === task.version) return;
    this.clearTimers();
    if (this.busy) this.terminate();
    this.active = task;
    this.command = null;
    this.taskStartedAt = Date.now();
    if (task.type === "bot-fallback-needed") { this.fail("oversized", "server-task-limit"); return; }
    if (this.failures >= MAX_FAILURES) { this.fail("circuit-open", "repeated-failures"); return; }
    this.start(task);
  }

  private start(task: ClientBotTask): void {
    if (this.worker && this.ready) { this.compute(task); return; }
    if (!this.worker) {
      try {
        const worker = this.deps.createWorker();
        this.worker = worker;
        this.loadingDeadline = Date.now() + LOADING_TIMEOUT_MS;
        worker.onmessage = ({ data }) => {
          if (this.worker !== worker) return;
          const message = decodeBotWorkerResponse(data);
          if (!message) { this.fail("invalid-result", "worker-response-decode"); return; }
          if (message.type === "ready") {
            if (this.ready) return;
            this.ready = true;
            if (this.active?.type === "bot-task" && !this.command) this.compute(this.active);
            return;
          }
          if (!this.active || message.code !== this.active.code
            || message.version !== this.active.version || this.command) return;
          this.busy = false;
          if (message.type === "failed") { this.fail("crash", "worker-decision-exception"); return; }
          if (this.active.type !== "bot-task" || !isAdvertisedBotIntent(
            message.intent,
            this.active.legal,
            this.active.view.pendingDecision?.kind === "defend"
              ? this.active.view.pendingDecision.stagedCards?.map((card) => card.instanceId) ?? []
              : [],
          )) {
            this.fail("invalid-result", "unadvertised-intent");
            return;
          }
          this.submit({ intent: message.intent }, message.computeMs);
        };
        worker.onerror = (event) => {
          if (this.worker !== worker) return;
          if (import.meta.env.DEV) {
            console.error("[bot] worker error event", {
              message: event?.message,
              filename: event?.filename,
              line: event?.lineno,
              column: event?.colno,
              error: event?.error instanceof Error
                ? { name: event.error.name, message: event.error.message, stack: event.error.stack }
                : undefined,
            });
          }
          this.fail(this.ready ? "crash" : "loading", "worker-error");
        };
        worker.onmessageerror = () => { if (this.worker === worker) this.fail("invalid-result", "worker-message-error"); };
      } catch { this.fail("loading", "worker-creation"); return; }
    }
    this.timer = setTimeout(() => this.fail("loading", "worker-loading-timeout"), Math.max(0, this.loadingDeadline - Date.now()));
  }

  private compute(task: ClientBotTask): void {
    if (this.timer) clearTimeout(this.timer);
    this.busy = true;
    this.timer = setTimeout(() => this.fail("timeout", "worker-decision-timeout"), DECISION_TIMEOUT_MS);
    try { this.worker?.postMessage(task); } catch { this.fail("crash", "worker-post-message"); }
  }

  private fail(failure: BotFailureReason, detail: string): void {
    this.terminate();
    if (!this.active || this.command) return;
    if (import.meta.env.DEV) {
      console.warn("[bot] browser computation fell back", {
        reason: failure,
        detail,
        botId: this.active.type === "bot-task" ? this.active.botId : undefined,
        version: this.active.version,
        decision: this.active.type === "bot-task"
          ? this.active.view.pendingDecision?.kind ?? this.active.view.phase
          : undefined,
        elapsedMs: Date.now() - this.taskStartedAt,
        consecutiveFailures: this.failures + (failure === "circuit-open" || failure === "oversized" ? 0 : 1),
      });
    }
    if (failure !== "circuit-open" && failure !== "oversized") this.failures++;
    this.deps.status("fallback");
    this.submit({ failure });
  }

  private submit(result: { intent: GameIntent } | { failure: BotFailureReason }, computeMs?: number): void {
    const task = this.active;
    if (!task) return;
    this.clearTimers();
    const command: BotSubmission = {
      type: "bot-intent", runtimeId: this.deps.runtimeId,
      commandId: crypto.randomUUID(), expectedVersion: task.version,
      elapsedMs: Math.min(60_000, Math.max(0, Date.now() - this.taskStartedAt)),
      ...(computeMs === undefined ? {} : { computeMs: Math.min(60_000, computeMs) }),
      ...result,
    };
    this.command = command;
    this.pacing = setTimeout(() => {
      if (this.command !== command || this.active !== task) return;
      if (!this.deps.send(command)) { this.deps.resync(); return; }
      this.timer = setTimeout(() => this.deps.resync(), RESYNC_TIMEOUT_MS);
    }, Math.max(0, task.delayMs - (Date.now() - this.taskStartedAt)));
  }

  result(message: Extract<ServerMessage, { type: "bot-result" }>): void {
    if (message.code !== this.active?.code || message.commandId !== this.command?.commandId) return;
    this.clearTimers();
    if (message.status === "rejected") {
      if ("failure" in this.command) { this.deps.resync(); return; }
      this.command = null;
      this.fail("rejected", "server-rejected-intent");
    } else {
      if ("intent" in this.command) {
        this.failures = 0;
        this.deps.status(null);
      }
      // Resync also repairs a lost post-commit broadcast or a lost stale-task refresh.
      this.timer = setTimeout(() => this.deps.resync(), RESYNC_TIMEOUT_MS);
    }
  }

  retry(): void {
    this.clearTimers();
    this.terminate();
    this.active = this.command = null;
    this.failures = 0;
    this.deps.status(null);
    this.deps.resync();
  }
}
