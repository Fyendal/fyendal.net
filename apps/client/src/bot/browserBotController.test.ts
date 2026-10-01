import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotSubmission, ClientBotTask, GameView, PlayerView } from "@fyendal/shared";
import { BrowserBotController, type BotWorkerPort } from "./browserBotController.js";

const runtimeId = "a".repeat(64);
function player(seat: 0 | 1): PlayerView {
  return { seat, heroCardId: "HERO", heroInstanceId: seat + 1, heroName: "Hero", life: 40, actionPoints: 1, resources: 0, hand: [], handCount: 0, deckCount: 20, arsenal: [], arsenalCount: 0, pitch: [], pitchCount: 0, graveyard: [], banish: [], soul: [], equipment: {}, weapons: [], board: [] };
}
const view: GameView = { gameId: "ABC123", turn: 2, phase: "action", activePlayer: 1, priorityPlayer: 1, players: [player(0), player(1)], chain: [], stack: [], ongoing: [], pendingDecision: null, winner: null, log: [] };
function task(version = 1): ClientBotTask { return { type: "bot-task", code: "ABC123", version, runtimeId, botId: "bravo", seat: 1, view, legal: [{ kind: "pass" }], delayMs: 1_000 }; }

function fixture() {
  const messages: BotSubmission[] = [];
  const workers: BotWorkerPort[] = [];
  const status = vi.fn();
  const resync = vi.fn();
  const controller = new BrowserBotController({
    runtimeId, status, resync,
    send: (message) => { if (message.type === "bot-intent") messages.push(message); return true; },
    createWorker: () => {
      const worker: BotWorkerPort = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null };
      workers.push(worker); return worker;
    },
  });
  controller.offer("ABC123", runtimeId);
  return { controller, workers, messages, status, resync };
}
function ready(worker: BotWorkerPort): void { worker.onmessage?.({ data: { type: "ready" } }); }
function decide(worker: BotWorkerPort, version = 1): void { worker.onmessage?.({ data: { type: "decision", code: "ABC123", version, intent: { kind: "pass" }, computeMs: 20 } }); }

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("BrowserBotController", () => {
  it("accepts a defender selection that retains a previously staged card", () => {
    const { controller, workers, messages, status } = fixture();
    const stagedCard = { instanceId: 11, cardId: "ASR006", owner: 1 as const };
    const nextCard = { instanceId: 12, cardId: "ASR011", owner: 1 as const };
    controller.receive({
      ...task(),
      view: {
        ...view,
        pendingDecision: {
          player: 1, kind: "defend", prompt: "Choose defenders", stagedCards: [stagedCard],
        },
        players: [player(0), { ...player(1), hand: [nextCard], equipment: { legs: stagedCard } }],
      },
      legal: [{ kind: "stage-defenders", instanceIds: [nextCard.instanceId] }],
    });
    ready(workers[0]!);
    workers[0]!.onmessage?.({
      data: {
        type: "decision", code: "ABC123", version: 1,
        intent: { kind: "stage-defenders", instanceIds: [stagedCard.instanceId, nextCard.instanceId] },
        computeMs: 20,
      },
    });
    vi.advanceTimersByTime(1_000);
    expect(messages[0]).toMatchObject({
      intent: { kind: "stage-defenders", instanceIds: [stagedCard.instanceId, nextCard.instanceId] },
    });
    expect(status).not.toHaveBeenCalledWith("fallback");
  });

  it("loads lazily, deduplicates tasks, and keeps one-second pacing", () => {
    const { controller, workers, messages } = fixture();
    expect(workers).toHaveLength(0);
    controller.receive(task()); controller.receive(task());
    expect(workers).toHaveLength(1);
    ready(workers[0]!); decide(workers[0]!);
    vi.advanceTimersByTime(999); expect(messages).toEqual([]);
    vi.advanceTimersByTime(1); expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ intent: { kind: "pass" }, expectedVersion: 1, computeMs: 20 });
  });

  it.each(["loading", "timeout", "crash", "invalid-result"])("falls back on %s and terminates the failed worker", (failure) => {
    const { controller, workers, messages } = fixture();
    controller.receive(task());
    const worker = workers[0]!;
    if (failure === "loading") vi.advanceTimersByTime(10_000);
    else {
      ready(worker);
      if (failure === "timeout") vi.advanceTimersByTime(5_000);
      if (failure === "crash") worker.onerror?.();
      if (failure === "invalid-result") worker.onmessage?.({ data: { type: "decision", code: "ABC123", version: 1, intent: { kind: "unknown" }, computeMs: 0 } });
    }
    vi.advanceTimersByTime(1_000);
    expect(messages[0]).toMatchObject({ failure, expectedVersion: 1 });
    expect(worker.terminate).toHaveBeenCalledOnce();
    decide(worker); vi.advanceTimersByTime(1_000); expect(messages).toHaveLength(1);
  });

  it("discards work and callbacks after undo, newer state, disconnect, and room change", () => {
    const { controller, workers, messages } = fixture();
    controller.receive(task()); ready(workers[0]!);
    controller.observe("ABC123", 2, true, false);
    decide(workers[0]!); vi.advanceTimersByTime(1_000); expect(messages).toEqual([]);
    controller.receive(task(2)); ready(workers[1]!); decide(workers[1]!, 2);
    controller.observe("ABC123", 3, false, false);
    vi.advanceTimersByTime(1_000); expect(messages).toEqual([]);
    controller.receive(task(3)); controller.reset();
    controller.offer("XYZ789", runtimeId);
    controller.receive(task(4)); vi.advanceTimersByTime(10_000);
    expect(messages).toEqual([]);
  });

  it("reuses a worker still loading when its initial task is superseded", () => {
    const { controller, workers } = fixture();
    controller.receive(task());
    controller.observe("ABC123", 2, false, false);
    controller.receive(task(2));
    expect(workers).toHaveLength(1);
    ready(workers[0]!);
    expect(workers[0]!.postMessage).toHaveBeenCalledWith(task(2));
  });

  it("keeps the initial loading deadline across superseded tasks", () => {
    const { controller, workers, messages } = fixture();
    controller.receive(task());
    vi.advanceTimersByTime(7_000);
    controller.observe("ABC123", 2, false, false);
    controller.receive(task(2));
    vi.advanceTimersByTime(3_000);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(messages[0]).toMatchObject({ failure: "loading", expectedVersion: 2 });
  });

  it("preserves an observation received before runtime negotiation", () => {
    const { controller, workers } = fixture();
    controller.reset();
    controller.observe("ABC123", 2, false, false);
    controller.offer("ABC123", runtimeId);
    controller.receive(task(1));
    expect(workers).toHaveLength(0);
  });

  it.each(["computing", "pacing"])("cancels %s work immediately on a runtime mismatch", (phase) => {
    const { controller, workers, messages, status } = fixture();
    controller.receive(task()); ready(workers[0]!);
    if (phase === "pacing") decide(workers[0]!);
    controller.offer("ABC123", "b".repeat(64));
    decide(workers[0]!);
    controller.receive(task(2));
    vi.advanceTimersByTime(10_000);
    expect(messages).toEqual([]);
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith("refresh-required");
  });

  it("replaces an idle worker that crashes after a completed decision", () => {
    const { controller, workers, messages } = fixture();
    controller.receive(task()); ready(workers[0]!); decide(workers[0]!);
    vi.advanceTimersByTime(1_000);
    controller.observe("ABC123", 2, false, false);
    workers[0]!.onerror?.();
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    controller.receive(task(2));
    expect(workers).toHaveLength(2);
    expect(messages).toHaveLength(1);
  });

  it("keeps a validated decision when its worker crashes during pacing", () => {
    const { controller, workers, messages } = fixture();
    controller.receive(task()); ready(workers[0]!); decide(workers[0]!);
    workers[0]!.onerror?.();
    vi.advanceTimersByTime(1_000);
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(messages[0]).toMatchObject({ intent: { kind: "pass" } });
  });

  it("falls back before sending a well-formed but unadvertised worker intent", () => {
    const { controller, workers, messages } = fixture();
    controller.receive(task()); ready(workers[0]!);
    workers[0]!.onmessage?.({ data: {
      type: "decision", code: "ABC123", version: 1,
      intent: { kind: "choose", optionId: "unadvertised" }, computeMs: 1,
    } });
    vi.advanceTimersByTime(1_000);
    expect(messages[0]).toMatchObject({ failure: "invalid-result" });
  });

  it("opens the circuit after three failures and resets it on retry/reconnect", () => {
    const { controller, workers, messages, resync } = fixture();
    for (let version = 1; version <= 3; version++) {
      controller.observe("ABC123", version, false, false);
      controller.receive(task(version)); workers.at(-1)!.onerror?.(); vi.advanceTimersByTime(1_000);
    }
    controller.observe("ABC123", 4, false, false); controller.receive(task(4)); vi.advanceTimersByTime(1_000);
    expect(workers).toHaveLength(3);
    expect(messages.at(-1)).toMatchObject({ failure: "circuit-open" });
    controller.retry(); expect(resync).toHaveBeenCalledOnce();
    controller.receive(task(4)); expect(workers).toHaveLength(4);
    controller.reset(); controller.offer("ABC123", runtimeId); controller.receive(task(5));
    expect(workers).toHaveLength(5);
  });

  it("uses a fresh command for rejection fallback and repairs missing acknowledgements", () => {
    const { controller, workers, messages, resync } = fixture();
    controller.receive(task()); ready(workers[0]!); decide(workers[0]!); vi.advanceTimersByTime(1_000);
    const original = messages[0]!;
    controller.result({ type: "bot-result", code: "ABC123", commandId: original.commandId, version: 1, status: "rejected" });
    vi.advanceTimersByTime(0);
    expect(messages[1]).toMatchObject({ failure: "rejected" });
    expect(messages[1]!.commandId).not.toBe(original.commandId);
    vi.advanceTimersByTime(10_000); expect(resync).toHaveBeenCalledOnce();
  });

  it("opens the circuit after three rejected decisions", () => {
    const { controller, workers, messages } = fixture();
    for (let version = 1; version <= 3; version++) {
      controller.observe("ABC123", version, false, false);
      controller.receive(task(version));
      ready(workers.at(-1)!); decide(workers.at(-1)!, version);
      vi.advanceTimersByTime(1_000);
      controller.result({ type: "bot-result", code: "ABC123", commandId: messages.at(-1)!.commandId, version, status: "rejected" });
      vi.advanceTimersByTime(0);
    }
    controller.observe("ABC123", 4, false, false);
    controller.receive(task(4)); vi.advanceTimersByTime(1_000);
    expect(workers).toHaveLength(3);
    expect(messages.at(-1)).toMatchObject({ failure: "circuit-open" });
  });

  it("requires refresh for incompatible runtimes and skips computation for oversized tasks", () => {
    const { controller, workers, messages, status } = fixture();
    controller.reset(); controller.offer("ABC123", "b".repeat(64)); controller.receive({ ...task(), runtimeId: "b".repeat(64) });
    expect(status).toHaveBeenLastCalledWith("refresh-required"); expect(workers).toEqual([]);
    controller.offer("ABC123", runtimeId);
    expect(status).toHaveBeenLastCalledWith(null);
    controller.receive({ type: "bot-fallback-needed", code: "ABC123", version: 2, runtimeId, delayMs: 0 });
    vi.advanceTimersByTime(0);
    expect(messages[0]).toMatchObject({ failure: "oversized" }); expect(workers).toEqual([]);
  });
});
