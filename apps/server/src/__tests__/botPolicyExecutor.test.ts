import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import { botDefinition } from "@fyendal/bot";
import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { createGame } from "@fyendal/engine";
import type { Decklist } from "@fyendal/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BotPolicyExecutionError,
  WorkerBotPolicyExecutor,
  botPolicyWorkerUrl,
  type BotPolicyRequest,
} from "../botPolicyExecutor.js";
import { encodePersistedState } from "../persistedState.js";

function request(version = 1): BotPolicyRequest {
  return {
    code: "ABC123",
    version,
    rulesetVersion: "worker-test",
    botId: "ira",
    seat: 0,
    state: encodePersistedState(createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 91,
      startPlayer: 0,
    }), "worker-test"),
  };
}

function halaReplayRequest(allyCardId?: string): BotPolicyRequest {
  const definition = botDefinition("hala")!;
  const gravyPool = precon("precon-sgb")!.pool;
  const opponent: Decklist = {
    heroId: gravyPool.heroId,
    weaponIds: gravyPool.weaponIds,
    equipment: {
      head: "SGB003",
      chest: "SGB004",
      arms: "SGB007",
      legs: "SGB008",
    },
    deck: gravyPool.deck,
  };
  const halaPool = precon(definition.deckId)!.pool;
  const state = createGame({
    decklists: [
      opponent,
      {
        heroId: halaPool.heroId,
        ...definition.presentationFor(opponent, "second"),
      },
    ],
    cards: cardData,
    scripts,
    seed: 91,
    startPlayer: 1,
  });
  state.turn = 2;
  state.players[1]!.hand = ["MPW030", "MPW104", "HVY209", "OMN238"].map((cardId) => ({
    instanceId: state.nextInstanceId++,
    cardId,
    owner: 1,
  }));
  if (allyCardId) {
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: allyCardId,
      owner: 0,
      life: cardData[allyCardId]!.life,
    });
  }
  return {
    code: "ABC123",
    version: 1,
    rulesetVersion: "worker-test",
    botId: "hala",
    seat: 1,
    state: encodePersistedState(state, "worker-test"),
  };
}

class FakeWorker extends EventEmitter {
  readonly posted: unknown[] = [];
  readonly terminate = vi.fn(async () => 0);

  postMessage(value: unknown): void {
    this.posted.push(value);
  }

  respond(value: unknown): void {
    this.emit("message", value);
  }
}

function success(taskId: number) {
  return {
    kind: "result",
    taskId,
    decision: { intent: { kind: "pass" } },
    computeMs: 5,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("bot policy worker executor", () => {
  it("resolves TypeScript workers in development and JavaScript workers after bundling", () => {
    expect(botPolicyWorkerUrl("file:///srv/src/botPolicyExecutor.ts").href)
      .toBe("file:///srv/src/botPolicyWorker.ts");
    expect(botPolicyWorkerUrl("file:///srv/dist/botPolicyExecutor.js").href)
      .toBe("file:///srv/dist/botPolicyWorker.js");
  });

  it("runs one FIFO task at a time and correlates responses", async () => {
    const worker = new FakeWorker();
    const executor = new WorkerBotPolicyExecutor({
      workerFactory: () => worker,
    });
    try {
      const first = executor.decide(request(1));
      const second = executor.decide(request(2));
      expect(worker.posted).toHaveLength(1);
      expect(worker.posted[0]).toMatchObject({ taskId: 1, version: 1 });

      worker.respond(success(1));
      await expect(first).resolves.toMatchObject({
        decision: { intent: { kind: "pass" } },
        queueDepth: 1,
        generation: 1,
      });
      expect(worker.posted).toHaveLength(2);
      expect(worker.posted[1]).toMatchObject({ taskId: 2, version: 2 });
      worker.respond(success(2));
      await expect(second).resolves.toMatchObject({ queueDepth: 2, generation: 1 });
    } finally {
      executor.stop();
    }
  });

  it("keeps the worker alive after a caught policy failure", async () => {
    const worker = new FakeWorker();
    const executor = new WorkerBotPolicyExecutor({ workerFactory: () => worker });
    try {
      const first = executor.decide(request(1));
      const second = executor.decide(request(2));
      worker.respond({ kind: "error", taskId: 1, error: "policy exploded" });
      await expect(first).rejects.toMatchObject({ reason: "policy" });
      expect(worker.terminate).not.toHaveBeenCalled();
      expect(worker.posted).toHaveLength(2);
      worker.respond(success(2));
      await expect(second).resolves.toMatchObject({ generation: 1 });
    } finally {
      executor.stop();
    }
  });

  it("times out the active and queued tasks, then lazily creates a replacement", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const executor = new WorkerBotPolicyExecutor({
      timeoutMs: 1_000,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = executor.decide(request(1));
    const second = executor.decide(request(2));
    const firstFailure = expect(first).rejects.toMatchObject({ reason: "timeout" });
    const secondFailure = expect(second).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(1_000);
    await firstFailure;
    await secondFailure;
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();

    const third = executor.decide(request(3));
    expect(workers).toHaveLength(2);
    workers[1]!.respond(success(3));
    await expect(third).resolves.toMatchObject({ generation: 2 });
    executor.stop();
  });

  it("uses the same five-second wall clock for warm and replacement workers", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const executor = new WorkerBotPolicyExecutor({
      workerUrl: new URL("file:///srv/dist/botPolicyWorker.js"),
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });

    const first = executor.decide(request(1));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(workers[0]!.terminate).not.toHaveBeenCalled();
    workers[0]!.respond(success(1));
    await expect(first).resolves.toMatchObject({ generation: 1 });

    const warm = executor.decide(request(2));
    const warmFailure = expect(warm).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(workers[0]!.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await warmFailure;
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();

    const replacement = executor.decide(request(3));
    expect(workers).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(workers[1]!.terminate).not.toHaveBeenCalled();
    workers[1]!.respond(success(3));
    await expect(replacement).resolves.toMatchObject({ generation: 2 });
    executor.stop();
  });

  it("rejects overflow without disturbing the active worker", async () => {
    const worker = new FakeWorker();
    const executor = new WorkerBotPolicyExecutor({
      maxQueue: 1,
      workerFactory: () => worker,
    });
    try {
      const active = executor.decide(request(1));
      const queued = executor.decide(request(2));
      await expect(executor.decide(request(3))).rejects.toEqual(
        expect.objectContaining<Partial<BotPolicyExecutionError>>({ reason: "overflow" }),
      );
      expect(worker.terminate).not.toHaveBeenCalled();
      worker.respond(success(1));
      await active;
      worker.respond(success(2));
      await queued;
    } finally {
      executor.stop();
    }
  });

  it("classifies a worker crash, rejects all outstanding tasks, and recreates lazily", async () => {
    const workers: FakeWorker[] = [];
    const executor = new WorkerBotPolicyExecutor({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const active = executor.decide(request(1));
    const queued = executor.decide(request(2));
    const activeFailure = expect(active).rejects.toMatchObject({
      reason: "crash",
      telemetry: { queueDepth: 1, generation: 1 },
    });
    const queuedFailure = expect(queued).rejects.toMatchObject({
      reason: "crash",
      telemetry: { queueDepth: 2, generation: 1 },
    });
    workers[0]!.emit("error", new Error("worker crashed"));
    await activeFailure;
    await queuedFailure;
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();

    const replacement = executor.decide(request(3));
    expect(workers).toHaveLength(2);
    workers[1]!.respond(success(3));
    await expect(replacement).resolves.toMatchObject({ generation: 2 });
    executor.stop();
  });

  it("rejects queued work when worker creation fails", async () => {
    const executor = new WorkerBotPolicyExecutor({
      workerFactory: () => {
        throw new Error("spawn failed");
      },
    });
    await expect(executor.decide(request())).rejects.toMatchObject({
      reason: "crash",
      telemetry: { queueDepth: 1 },
    });
    executor.stop();
  });

  it("rejects outstanding work and ignores late results after shutdown", async () => {
    const worker = new FakeWorker();
    const executor = new WorkerBotPolicyExecutor({ workerFactory: () => worker });
    const active = executor.decide(request());
    const failure = expect(active).rejects.toMatchObject({ reason: "stopped" });
    executor.stop();
    await failure;
    worker.respond(success(1));
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(executor.decide(request())).rejects.toMatchObject({ reason: "stopped" });
  });

  it("keeps the main event loop responsive while a real worker is CPU-bound", async () => {
    const source = `
      const { parentPort } = require("node:worker_threads");
      parentPort.on("message", (task) => {
        const until = Date.now() + 100;
        while (Date.now() < until) {}
        parentPort.postMessage({
          kind: "result",
          taskId: task.taskId,
          decision: { intent: { kind: "pass" } },
          computeMs: 100,
        });
      });
    `;
    const executor = new WorkerBotPolicyExecutor({
      workerFactory: () => new Worker(source, { eval: true }),
    });
    try {
      let settled = false;
      const decision = executor.decide(request()).finally(() => {
        settled = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);
      await expect(decision).resolves.toMatchObject({ decision: { intent: { kind: "pass" } } });
    } finally {
      executor.stop();
    }
  });

  it("executes Hala's ally-aware replay turn after the worker is warm", async () => {
    const executor = new WorkerBotPolicyExecutor();
    try {
      await executor.decide(request());
      const result = await executor.decide(halaReplayRequest("SEA051"));
      expect(result).toMatchObject({
        generation: 1,
        decision: { intent: expect.objectContaining({ kind: expect.any(String) }) },
      });
      expect(result.decision.intent).toMatchObject({ kind: "activate-ability" });
    } finally {
      executor.stop();
    }
  }, 10_000);
});
