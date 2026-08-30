import {
  botObservationKey,
  isCleanActionDecision,
  type BotDefinition,
  type BotPolicyInput,
} from "@fyendal/bot";
import { precon, silverAgePrecon } from "@fyendal/cards";
import { applyIntent, legalIntents } from "@fyendal/engine";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  BOT_RETRY_DELAYS_MS,
  BOT_STANDBY_RETRY_MS,
  BotRunner,
  DEFAULT_BOT_ACTION_DELAY_MS,
  fallbackBotIntent,
} from "../botRunner.js";
import {
  BotPolicyExecutionError,
  type BotPolicyExecutionResult,
  type BotPolicyExecutor,
} from "../botPolicyExecutor.js";
import { PgRoomStore, stateMessage, type RoomRow } from "../store.js";
import { freshDb } from "./testdb.js";

let runnerRoom: RoomRow;

beforeAll(async () => {
  const db = await freshDb();
  const store = new PgRoomStore(db, "bot-runner-unit-test");
  const user = await db.query(
    `INSERT INTO users (username, username_lc, pass_hash, created_at)
     VALUES ('RunnerUnit','runnerunit','hash',1) RETURNING id`,
  );
  const userId = Number(user.rows[0]!.id);
  const created = await store.createBotRoom("silver-age", {
    deckId: "precon-svi",
    username: "RunnerUnit",
    userId,
  });
  const pool = silverAgePrecon("precon-svi")!.pool;
  await store.chooseFirst(created.code, { token: created.token, userId }, false);
  await store.presentDeck(created.code, { token: created.token, userId }, {
    weaponIds: pool.weaponIds.slice(0, 1),
    equipment: {},
    deck: pool.deck.slice(0, 40),
  });
  let room = await store.getRoom(created.code);
  if (!room?.state) {
    await store.chooseFirst(created.code, { token: created.token, userId }, false);
    room = await store.getRoom(created.code);
  }
  if (!room?.state) throw new Error("unit bot room did not start");
  runnerRoom = room;
  await (db as unknown as { end(): Promise<void> }).end();
});

function clonedRunnerRoom(botHasPriority = true): RoomRow {
  const state = runnerRoom.state!;
  const { cardsRef, scriptsRef, ...serializableState } = state;
  const room = structuredClone({ ...runnerRoom, state: null });
  const clonedState = JSON.parse(JSON.stringify(serializableState)) as typeof state;
  clonedState.cardsRef = cardsRef;
  clonedState.scriptsRef = scriptsRef;
  if (!botHasPriority) {
    clonedState.pendingDecision = null;
    clonedState.priorityPlayer = 0;
  }
  return { ...room, state: clonedState };
}

describe("BotRunner reliability", () => {
  it.each(["timeout", "crash"] as const)(
    "applies exactly one fallback when worker planning reports %s",
    async (failure) => {
      vi.useFakeTimers();
      const room = clonedRunnerRoom(true);
      const applyBotIntent = vi.fn().mockResolvedValue({ ok: true, version: room.version + 1 });
      const logError = vi.fn();
      const policyExecutor = {
        decide: vi.fn().mockRejectedValue(
          new BotPolicyExecutionError(failure, `worker ${failure}`),
        ),
        stop: vi.fn(),
      } satisfies BotPolicyExecutor;
      const runner = new BotRunner({
        rooms: {
          getRoom: vi.fn().mockResolvedValue(room),
          applyBotIntent,
        } as unknown as PgRoomStore,
        afterCommit: vi.fn().mockResolvedValue(undefined),
        logError,
        policyExecutor,
      });
      try {
        runner.schedule(room.code, 0);
        await vi.advanceTimersByTimeAsync(0);
        expect(policyExecutor.decide).toHaveBeenCalledOnce();
        expect(applyBotIntent).toHaveBeenCalledOnce();
        expect(logError).toHaveBeenCalledWith(
          expect.stringContaining(`classification=${failure}`),
          expect.objectContaining({ reason: failure }),
        );
      } finally {
        runner.stop();
        expect(policyExecutor.stop).toHaveBeenCalledOnce();
        vi.useRealTimers();
      }
    },
  );

  it("does not commit a worker result that arrives after shutdown", async () => {
    vi.useFakeTimers();
    const room = clonedRunnerRoom(true);
    const message = stateMessage(room, 1);
    if (!message || message.type !== "state") throw new Error("expected state message");
    const pass = message.legal.find((intent) => intent.kind === "pass")!;
    let finish!: (value: BotPolicyExecutionResult) => void;
    const policyExecutor = {
      decide: vi.fn(() => new Promise<BotPolicyExecutionResult>((resolve) => {
        finish = resolve;
      })),
      stop: vi.fn(),
    } satisfies BotPolicyExecutor;
    const applyBotIntent = vi.fn();
    const runner = new BotRunner({
      rooms: {
        getRoom: vi.fn().mockResolvedValue(room),
        applyBotIntent,
      } as unknown as PgRoomStore,
      afterCommit: vi.fn(),
      policyExecutor,
    });
    runner.schedule(room.code, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(policyExecutor.decide).toHaveBeenCalledOnce();
    runner.stop();
    finish({
      decision: { intent: pass },
      queueMs: 0,
      computeMs: 1,
      totalMs: 1,
      queueDepth: 1,
      generation: 1,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(applyBotIntent).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stages the strongest visible defender before accepting fallback damage", () => {
    const inputView = {
      pendingDecision: {
        player: 1,
        kind: "defend" as const,
        prompt: "Choose defending cards",
      },
      chain: [{
        attackingCard: { instanceId: 99, cardId: "", owner: 0 },
        defendingCards: [],
        attackValue: 8,
        defenseValue: 0,
        damage: 8,
        resolved: false,
        reactions: [],
      }],
      players: [
        {} as BotPolicyInput["view"]["players"][0],
        {
          hand: [
            { instanceId: 1, cardId: "weak", owner: 1, defense: 1 },
            { instanceId: 2, cardId: "strong", owner: 1, defense: 3 },
          ],
          arsenal: [],
          equipment: {},
        } as unknown as BotPolicyInput["view"]["players"][1],
      ],
    } as unknown as BotPolicyInput["view"];
    expect(fallbackBotIntent({
      seat: 1,
      view: inputView,
      cards: {},
      legal: [
        { kind: "defend", instanceIds: [] },
        { kind: "stage-defenders", instanceIds: [1] },
        { kind: "stage-defenders", instanceIds: [2] },
      ],
    })).toEqual({ kind: "stage-defenders", instanceIds: [2] });
  });

  it("checks bot priority before claiming a lease", async () => {
    vi.useFakeTimers();
    const claim = vi.fn().mockResolvedValue(true);
    const getRoom = vi.fn().mockResolvedValue(clonedRunnerRoom(false));
    const runner = new BotRunner({
      rooms: { getRoom } as unknown as PgRoomStore,
      afterCommit: vi.fn(),
      claim,
    });
    try {
      runner.schedule("ABC123", 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(getRoom).toHaveBeenCalledOnce();
      expect(claim).not.toHaveBeenCalled();
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("handles lease loss with a five-second standby only while the bot still has priority", async () => {
    vi.useFakeTimers();
    const claim = vi.fn().mockResolvedValue(false);
    const getRoom = vi.fn()
      .mockResolvedValueOnce(clonedRunnerRoom(true))
      .mockResolvedValueOnce(clonedRunnerRoom(false));
    const runner = new BotRunner({
      rooms: { getRoom } as unknown as PgRoomStore,
      afterCommit: vi.fn(),
      claim,
    });
    try {
      runner.schedule("ABC123", 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(claim).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(BOT_STANDBY_RETRY_MS - 1);
      expect(getRoom).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(getRoom).toHaveBeenCalledTimes(2);
      expect(claim).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(BOT_STANDBY_RETRY_MS * 2);
      expect(getRoom).toHaveBeenCalledTimes(2);
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("backs transient failures off through the capped retry sequence", async () => {
    vi.useFakeTimers();
    const getRoom = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const runner = new BotRunner({
      rooms: { getRoom } as unknown as PgRoomStore,
      afterCommit: vi.fn(),
      logError: vi.fn(),
    });
    try {
      runner.schedule("ABC123", 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(getRoom).toHaveBeenCalledTimes(1);
      for (const [index, delay] of BOT_RETRY_DELAYS_MS.entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(getRoom).toHaveBeenCalledTimes(index + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(getRoom).toHaveBeenCalledTimes(index + 2);
      }
      await vi.advanceTimersByTimeAsync(BOT_RETRY_DELAYS_MS.at(-1)!);
      expect(getRoom).toHaveBeenCalledTimes(BOT_RETRY_DELAYS_MS.length + 2);
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("resets transient backoff when priority returns to the human", async () => {
    vi.useFakeTimers();
    const getRoom = vi.fn()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockResolvedValueOnce(clonedRunnerRoom(false))
      .mockRejectedValue(new Error("failure after reset"));
    const runner = new BotRunner({
      rooms: { getRoom } as unknown as PgRoomStore,
      afterCommit: vi.fn(),
      logError: vi.fn(),
    });
    try {
      runner.schedule("ABC123", 0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(BOT_RETRY_DELAYS_MS[0]);
      expect(getRoom).toHaveBeenCalledTimes(2);

      runner.schedule("ABC123", 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(getRoom).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(BOT_RETRY_DELAYS_MS[0] - 1);
      expect(getRoom).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(getRoom).toHaveBeenCalledTimes(4);
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("resets transient backoff after a successful action and post-commit", async () => {
    vi.useFakeTimers();
    const room = clonedRunnerRoom(true);
    const getRoom = vi.fn()
      .mockRejectedValueOnce(new Error("failure before success"))
      .mockResolvedValueOnce(room)
      .mockRejectedValue(new Error("failure after success"));
    const runner = new BotRunner({
      rooms: {
        getRoom,
        applyBotIntent: vi.fn().mockResolvedValue({ ok: true, version: room.version + 1 }),
      } as unknown as PgRoomStore,
      afterCommit: vi.fn().mockResolvedValue(undefined),
      chooseIntent: (_definition, input) => input.legal.find((intent) => intent.kind === "pass")!,
      logError: vi.fn(),
    });
    try {
      runner.schedule(room.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(BOT_RETRY_DELAYS_MS[0]);
      expect(getRoom).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(DEFAULT_BOT_ACTION_DELAY_MS);
      expect(getRoom).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(BOT_RETRY_DELAYS_MS[0] - 1);
      expect(getRoom).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(getRoom).toHaveBeenCalledTimes(4);
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it.each([
    ["policy exception", () => { throw new Error("policy failed"); }],
    ["unadvertised policy result", () => ({ kind: "choose", optionId: "not-legal" } as const)],
  ])("uses a conservative legal fallback after a %s", async (_label, chooseIntent) => {
    vi.useFakeTimers();
    const room = clonedRunnerRoom(true);
    const applyBotIntent = vi.fn().mockResolvedValue({ ok: true, version: room.version + 1 });
    const afterCommit = vi.fn().mockResolvedValue(undefined);
    const runner = new BotRunner({
      rooms: { getRoom: vi.fn().mockResolvedValue(room), applyBotIntent } as unknown as PgRoomStore,
      afterCommit,
      chooseIntent,
      logError: vi.fn(),
    });
    try {
      runner.schedule(room.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(applyBotIntent).toHaveBeenCalledOnce();
      expect(applyBotIntent.mock.calls[0]![2]).toEqual({ kind: "pass" });
      expect(afterCommit).toHaveBeenCalledOnce();
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("tries a fallback once when an advertised policy action is rejected", async () => {
    vi.useFakeTimers();
    const room = clonedRunnerRoom(true);
    const applyBotIntent = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "engine rejected intent" })
      .mockResolvedValueOnce({ ok: true, version: room.version + 1 });
    const afterCommit = vi.fn().mockResolvedValue(undefined);
    const runner = new BotRunner({
      rooms: { getRoom: vi.fn().mockResolvedValue(room), applyBotIntent } as unknown as PgRoomStore,
      afterCommit,
      chooseIntent: (_definition, input) => input.legal.find((intent) =>
        intent.kind !== "pass" && intent.kind !== "concede"
      )!,
      logError: vi.fn(),
    });
    try {
      runner.schedule(room.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(applyBotIntent).toHaveBeenCalledTimes(2);
      expect(applyBotIntent.mock.calls[1]![2]).toEqual({ kind: "pass" });
      expect(afterCommit).toHaveBeenCalledOnce();
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("retries when both the policy action and fallback are rejected", async () => {
    vi.useFakeTimers();
    const room = clonedRunnerRoom(true);
    const getRoom = vi.fn().mockResolvedValue(room);
    const applyBotIntent = vi.fn().mockResolvedValue({ ok: false, error: "engine rejected intent" });
    const runner = new BotRunner({
      rooms: { getRoom, applyBotIntent } as unknown as PgRoomStore,
      afterCommit: vi.fn(),
      chooseIntent: (_definition, input) => input.legal.find((intent) =>
        intent.kind !== "pass" && intent.kind !== "concede"
      )!,
      logError: vi.fn(),
    });
    try {
      runner.schedule(room.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(applyBotIntent).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(BOT_RETRY_DELAYS_MS[0]);
      expect(getRoom).toHaveBeenCalledTimes(2);
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("reloads after a stale commit without attempting a fallback", async () => {
    vi.useFakeTimers();
    const room = clonedRunnerRoom(true);
    const getRoom = vi.fn().mockResolvedValue(room);
    const applyBotIntent = vi.fn().mockResolvedValue({
      ok: false,
      error: "stale bot observation",
    });
    const runner = new BotRunner({
      rooms: { getRoom, applyBotIntent } as unknown as PgRoomStore,
      afterCommit: vi.fn(),
      chooseIntent: (_definition, input) => input.legal.find((intent) => intent.kind === "pass")!,
      logError: vi.fn(),
    });
    try {
      runner.schedule(room.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(applyBotIntent).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(DEFAULT_BOT_ACTION_DELAY_MS);
      expect(getRoom).toHaveBeenCalledTimes(2);
      expect(applyBotIntent).toHaveBeenCalledTimes(2);
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("retries after a post-commit notification failure", async () => {
    vi.useFakeTimers();
    const room = clonedRunnerRoom(true);
    const getRoom = vi.fn().mockResolvedValue(room);
    const runner = new BotRunner({
      rooms: {
        getRoom,
        applyBotIntent: vi.fn().mockResolvedValue({ ok: true, version: room.version + 1 }),
      } as unknown as PgRoomStore,
      afterCommit: vi.fn().mockRejectedValue(new Error("publish failed")),
      chooseIntent: (_definition, input) => input.legal.find((intent) => intent.kind === "pass")!,
      logError: vi.fn(),
    });
    try {
      runner.schedule(room.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(BOT_RETRY_DELAYS_MS[0]);
      expect(getRoom).toHaveBeenCalledTimes(2);
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("logs slow policy decisions without card identities", async () => {
    vi.useFakeTimers();
    const room = clonedRunnerRoom(true);
    const logError = vi.fn();
    const times = [1_000, 1_250];
    const runner = new BotRunner({
      rooms: {
        getRoom: vi.fn().mockResolvedValue(room),
        applyBotIntent: vi.fn().mockResolvedValue({ ok: true, version: room.version + 1 }),
      } as unknown as PgRoomStore,
      afterCommit: vi.fn().mockResolvedValue(undefined),
      chooseIntent: (_definition, input) => input.legal.find((intent) => intent.kind === "pass")!,
      now: () => times.shift()!,
      logError,
    });
    try {
      runner.schedule(room.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining("elapsedMs=250"));
      expect(logError.mock.calls[0]![0]).not.toContain("cardId");
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("warns once when cumulative worker compute exceeds two seconds in a turn", async () => {
    vi.useFakeTimers();
    const room = clonedRunnerRoom(true);
    const message = stateMessage(room, 1);
    if (!message || message.type !== "state") throw new Error("expected state message");
    const pass = message.legal.find((intent) => intent.kind === "pass")!;
    const logError = vi.fn();
    const policyExecutor = {
      decide: vi.fn().mockResolvedValue({
        decision: { intent: pass },
        queueMs: 0,
        computeMs: 1_000,
        totalMs: 1_000,
        queueDepth: 1,
        generation: 1,
      }),
      stop: vi.fn(),
    } satisfies BotPolicyExecutor;
    const runner = new BotRunner({
      rooms: {
        getRoom: vi.fn().mockResolvedValue(room),
        applyBotIntent: vi.fn().mockResolvedValue({ ok: true, version: room.version + 1 }),
      } as unknown as PgRoomStore,
      afterCommit: vi.fn().mockResolvedValue(undefined),
      logError,
      policyExecutor,
    });
    try {
      runner.schedule(room.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(DEFAULT_BOT_ACTION_DELAY_MS * 2);
      const turnWarnings = logError.mock.calls.filter(([message]) =>
        typeof message === "string" && message.startsWith("Slow bot turn")
      );
      expect(policyExecutor.decide).toHaveBeenCalledTimes(3);
      expect(turnWarnings).toHaveLength(1);
      expect(turnWarnings[0]![0]).toContain("workerComputeMs=2000");
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("reuses a Cindra worker continuation across forced bot priority steps", async () => {
    vi.useFakeTimers();
    const initialRoom = clonedRunnerRoom(true);
    const seat = 1 as const;
    const state = initialRoom.state!;
    state.turn = 2;
    state.phase = "action";
    state.activePlayer = seat;
    state.priorityPlayer = seat;
    state.pendingDecision = null;
    state.stack = [];
    state.chain = [];
    state.players[seat].actionPoints = 1;
    state.players[seat].resources = 0;
    state.players[seat].hand = [0, 1].map(() => ({
      instanceId: state.nextInstanceId++,
      cardId: "HNT070",
      owner: seat,
    }));
    state.players[0].board = [{
      instanceId: state.nextInstanceId++,
      cardId: "SEA051",
      owner: 0,
      life: 4,
    }];

    const rootIntent = legalIntents(state, seat).find((intent) =>
      intent.kind === "play-card" &&
      intent.instanceId === state.players[seat].hand[0]!.instanceId &&
      intent.targetAllyId === undefined
    );
    if (!rootIntent) throw new Error("expected a legal Ronin Renegade opener");

    const botRooms: RoomRow[] = [initialRoom];
    const forcedBotIntents: Array<ReturnType<typeof legalIntents>[number]> = [];
    const simulated = applyIntent(state, seat, rootIntent);
    if (!simulated.ok) throw new Error(simulated.error);
    let current = simulated.state;
    for (let step = 0; step < 80 && !isCleanActionDecision(current, seat); step++) {
      const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
      const legal = legalIntents(current, actor).filter((intent) => intent.kind !== "concede");
      const noResponse = current.pendingDecision?.kind === "defend"
        ? legal.find((intent) => intent.kind === "defend" && intent.instanceIds.length === 0)
        : legal.find((intent) => intent.kind === "choose" && intent.optionId === "pay 0")
          ?? legal.find((intent) => intent.kind === "choose" &&
            ["no", "decline", "pass"].includes(intent.optionId))
          ?? legal.find((intent) => intent.kind === "pass")
          ?? legal.find((intent) => intent.kind === "close-chain")
          ?? legal.find((intent) => intent.kind === "order-triggers")
          ?? legal.find((intent) => intent.kind === "skip-runechant");
      if (!noResponse) throw new Error(`no no-response intent at ${current.phase}`);
      if (actor === seat) {
        botRooms.push({
          ...initialRoom,
          version: initialRoom.version + botRooms.length,
          state: current,
        });
        forcedBotIntents.push(noResponse);
      }
      const applied = applyIntent(current, actor, noResponse);
      if (!applied.ok) throw new Error(applied.error);
      current = applied.state;
    }
    expect(isCleanActionDecision(current, seat)).toBe(true);
    expect(forcedBotIntents.length).toBeGreaterThan(0);

    const finalRoom: RoomRow = {
      ...initialRoom,
      version: initialRoom.version + botRooms.length,
      state: current,
    };
    botRooms.push(finalRoom);
    const finalMessage = stateMessage(finalRoom, seat);
    if (!finalMessage || finalMessage.type !== "state") throw new Error("expected final state message");
    const continuationIntent = finalMessage.legal.find((intent) =>
      intent.kind === "play-card" &&
      intent.instanceId === current.players[seat].hand[0]?.instanceId
    );
    if (!continuationIntent) throw new Error("expected a legal cached follow-up");

    const initialMessage = stateMessage(initialRoom, seat);
    if (!initialMessage || initialMessage.type !== "state") {
      throw new Error("expected initial state message");
    }
    let forcedIndex = 0;
    const workerDecisions = [
      {
        intent: rootIntent,
        continuation: [
          {
            observationKey: botObservationKey({
              view: initialMessage.view,
              legal: initialMessage.legal,
            }),
            intent: rootIntent,
          },
          {
            observationKey: botObservationKey({
              view: finalMessage.view,
              legal: finalMessage.legal,
            }),
            intent: continuationIntent,
          },
        ],
      },
      ...forcedBotIntents.map((intent) => ({ intent })),
    ];
    const policyExecutor = {
      decide: vi.fn(async () => ({
        decision: workerDecisions[forcedIndex++]!,
        queueMs: 1,
        computeMs: 10,
        totalMs: 11,
        queueDepth: 1,
        generation: 1,
      })),
      stop: vi.fn(),
    } satisfies BotPolicyExecutor;
    const chooseContinuationIntent = vi.fn((_input: BotPolicyInput, proposed) => proposed);
    const definition = {
      id: "cindra",
      format: "cc",
      deckId: "bot-cindra-head-jabs",
      username: "Cindra Bot",
      deckName: "Head Jabs",
      chooseIntent: vi.fn(),
      chooseDecision: vi.fn(),
      chooseContinuationIntent,
      presentationFor: vi.fn(),
    } as unknown as BotDefinition;
    const expectedIntents = [rootIntent, ...forcedBotIntents, continuationIntent];
    const applyBotIntent = vi.fn(async (_code, _version, intent) => {
      expect(intent).toEqual(expectedIntents[applyBotIntent.mock.calls.length - 1]);
      return { ok: true as const, version: initialRoom.version + applyBotIntent.mock.calls.length };
    });
    const runner = new BotRunner({
      rooms: {
        getRoom: vi.fn()
          .mockImplementation(() => Promise.resolve(botRooms.shift() ?? finalRoom)),
        applyBotIntent,
      } as unknown as PgRoomStore,
      delayMs: 1,
      afterCommit: vi.fn().mockResolvedValue(undefined),
      definitionForDeckId: () => definition,
      policyExecutor,
    });
    try {
      runner.schedule(initialRoom.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      for (let index = 1; index < expectedIntents.length; index++) {
        await vi.advanceTimersByTimeAsync(1);
      }
      expect(applyBotIntent).toHaveBeenCalledTimes(expectedIntents.length);
      expect(policyExecutor.decide).toHaveBeenCalledTimes(1 + forcedBotIntents.length);
      expect(chooseContinuationIntent).toHaveBeenCalledOnce();
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("reruns Cindra rollout when a continuation guard rejects the cached intent", async () => {
    vi.useFakeTimers();
    const room = clonedRunnerRoom(true);
    room.state!.phase = "action";
    room.state!.activePlayer = 1;
    room.state!.priorityPlayer = 1;
    room.state!.pendingDecision = null;
    room.state!.stack = [];
    room.state!.players[1].actionPoints = 1;
    const message = stateMessage(room, 1);
    if (!message || message.type !== "state") throw new Error("expected state message");
    const cached = message.legal.find((intent) => intent.kind === "pass");
    const replanned = message.legal.find((intent) => intent.kind === "play-card");
    if (!cached || !replanned) throw new Error("expected pass and play-card intents");
    const chooseDecision = vi.fn((input: BotPolicyInput) =>
      chooseDecision.mock.calls.length === 1
        ? {
            intent: cached,
            continuation: [
              { observationKey: botObservationKey(input), intent: cached },
              { observationKey: botObservationKey(input), intent: cached },
            ],
          }
        : { intent: replanned }
    );
    const chooseContinuationIntent = vi.fn(() => replanned);
    const definition = {
      id: "cindra",
      format: "cc",
      deckId: "bot-cindra-head-jabs",
      username: "Cindra Bot",
      deckName: "Head Jabs",
      chooseIntent: vi.fn(),
      chooseDecision,
      chooseContinuationIntent,
      presentationFor: vi.fn(),
    } as unknown as BotDefinition;
    const applyBotIntent = vi.fn().mockResolvedValue({ ok: true, version: room.version + 1 });
    const runner = new BotRunner({
      rooms: {
        getRoom: vi.fn().mockResolvedValue(room),
        applyBotIntent,
      } as unknown as PgRoomStore,
      afterCommit: vi.fn().mockResolvedValue(undefined),
      definitionForDeckId: () => definition,
    });
    try {
      runner.schedule(room.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(DEFAULT_BOT_ACTION_DELAY_MS);
      expect(applyBotIntent.mock.calls.map((call) => call[2])).toEqual([cached, replanned]);
      expect(chooseContinuationIntent).toHaveBeenCalledOnce();
      expect(chooseDecision).toHaveBeenCalledTimes(2);
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("invalidates a Cindra continuation when the visible state changes", async () => {
    vi.useFakeTimers();
    const firstRoom = clonedRunnerRoom(true);
    const secondRoom = clonedRunnerRoom(true);
    for (const room of [firstRoom, secondRoom]) {
      room.state!.phase = "action";
      room.state!.activePlayer = 1;
      room.state!.priorityPlayer = 1;
      room.state!.pendingDecision = null;
      room.state!.stack = [];
      room.state!.players[1].actionPoints = 1;
    }
    secondRoom.state!.players[1].resources++;
    const chooseDecision = vi.fn((input: BotPolicyInput) => {
      const intent = input.legal.find((candidate) => candidate.kind === "pass")!;
      const checkpoint = { observationKey: botObservationKey(input), intent };
      return { intent, continuation: [checkpoint, checkpoint] };
    });
    const chooseContinuationIntent = vi.fn((_input: BotPolicyInput, proposed) => proposed);
    const definition = {
      id: "cindra",
      format: "cc",
      deckId: "bot-cindra-head-jabs",
      username: "Cindra Bot",
      deckName: "Head Jabs",
      chooseIntent: vi.fn(),
      chooseDecision,
      chooseContinuationIntent,
      presentationFor: vi.fn(),
    } as unknown as BotDefinition;
    const runner = new BotRunner({
      rooms: {
        getRoom: vi.fn()
          .mockResolvedValueOnce(firstRoom)
          .mockResolvedValue(secondRoom),
        applyBotIntent: vi.fn().mockResolvedValue({ ok: true, version: firstRoom.version + 1 }),
      } as unknown as PgRoomStore,
      afterCommit: vi.fn().mockResolvedValue(undefined),
      definitionForDeckId: () => definition,
    });
    try {
      runner.schedule(firstRoom.code, 0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(DEFAULT_BOT_ACTION_DELAY_MS);
      expect(chooseDecision).toHaveBeenCalledTimes(2);
      expect(chooseContinuationIntent).not.toHaveBeenCalled();
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("clears pending retries on shutdown", async () => {
    vi.useFakeTimers();
    const getRoom = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const runner = new BotRunner({
      rooms: { getRoom } as unknown as PgRoomStore,
      afterCommit: vi.fn(),
      logError: vi.fn(),
    });
    try {
      runner.schedule("ABC123", 0);
      await vi.advanceTimersByTimeAsync(0);
      runner.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getRoom).toHaveBeenCalledOnce();
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });
});

describe("BotRunner", () => {
  it("waits one second before taking a default-scheduled action", async () => {
    vi.useFakeTimers();
    const getRoom = vi.fn().mockResolvedValue(null);
    const runner = new BotRunner({
      rooms: { getRoom } as unknown as PgRoomStore,
      afterCommit: vi.fn(),
    });
    try {
      runner.schedule("ABC123");
      await vi.advanceTimersByTimeAsync(DEFAULT_BOT_ACTION_DELAY_MS - 1);
      expect(getRoom).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(getRoom).toHaveBeenCalledOnce();
    } finally {
      runner.stop();
      vi.useRealTimers();
    }
  });

  it("reloads, chooses from Briar's projection, commits, and announces one action", async () => {
    const db = await freshDb();
    const store = new PgRoomStore(db, "bot-runner-test");
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('RunnerOwner','runnerowner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("silver-age", {
      deckId: "precon-svi",
      username: "RunnerOwner",
      userId,
    });
    const pool = silverAgePrecon("precon-svi")!.pool;
    await store.chooseFirst(created.code, { token: created.token, userId }, false);
    const ready = await store.presentDeck(created.code, { token: created.token, userId }, {
      weaponIds: pool.weaponIds.slice(0, 1),
      equipment: {},
      deck: pool.deck.slice(0, 40),
    });
    expect(ready.ok).toBe(true);
    let room = await store.getRoom(created.code);
    if (!room!.state) {
      const started = await store.chooseFirst(created.code, { token: created.token, userId }, false);
      expect(started).toMatchObject({ ok: true, started: true });
      room = await store.getRoom(created.code);
    }
    const before = room!.version;

    let announce!: (value: number) => void;
    const announced = new Promise<number>((resolve) => { announce = resolve; });
    const runner = new BotRunner({
      rooms: store,
      delayMs: 0,
      afterCommit: async (_code, version) => announce(version),
    });
    try {
      runner.schedule(created.code);
      const version = await Promise.race([
        announced,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("bot action timed out")), 1_000)
        ),
      ]);
      expect(version).toBeGreaterThan(before);
      expect((await store.getRoom(created.code))!.version).toBe(version);
    } finally {
      runner.stop();
      await (db as unknown as { end(): Promise<void> }).end();
    }
  });

  it("dispatches a Bravo room through the Bravo policy", async () => {
    const db = await freshDb();
    const store = new PgRoomStore(db, "bravo-runner-test");
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('BravoRunner','bravorunner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("silver-age", {
      deckId: "precon-sbz",
      username: "BravoRunner",
      userId,
    }, false, "bravo");
    const pool = silverAgePrecon("precon-sbz")!.pool;
    await store.chooseFirst(created.code, { token: created.token, userId }, false);
    const ready = await store.presentDeck(created.code, { token: created.token, userId }, {
      weaponIds: pool.weaponIds.slice(0, 1),
      equipment: {},
      deck: pool.deck.slice(0, 40),
    });
    expect(ready.ok).toBe(true);
    let room = await store.getRoom(created.code);
    if (!room!.state) {
      const started = await store.chooseFirst(created.code, { token: created.token, userId }, false);
      expect(started).toMatchObject({ ok: true, started: true });
      room = await store.getRoom(created.code);
    }
    expect(room!.state!.activePlayer).toBe(1);
    const before = room!.version;

    let announce!: (value: number) => void;
    const announced = new Promise<number>((resolve) => { announce = resolve; });
    const runner = new BotRunner({
      rooms: store,
      delayMs: 0,
      afterCommit: async (_code, version) => announce(version),
    });
    try {
      runner.schedule(created.code);
      const version = await Promise.race([
        announced,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("Bravo bot action timed out")), 1_000)
        ),
      ]);
      expect(version).toBeGreaterThan(before);
    } finally {
      runner.stop();
      await (db as unknown as { end(): Promise<void> }).end();
    }
  });

  it("dispatches a Cindra room through the Head Jabs policy", async () => {
    const db = await freshDb();
    const store = new PgRoomStore(db, "cindra-runner-test");
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('CindraRunner','cindrarunner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("cc", {
      deckId: "precon-asb",
      username: "CindraRunner",
      userId,
    }, false, "cindra");
    const pool = precon("precon-asb")!.pool;
    await store.chooseFirst(created.code, { token: created.token, userId }, false);
    const ready = await store.presentDeck(created.code, { token: created.token, userId }, {
      weaponIds: pool.weaponIds,
      equipment: {},
      deck: pool.deck,
    });
    expect(ready.ok).toBe(true);
    let room = await store.getRoom(created.code);
    if (!room!.state) {
      const started = await store.chooseFirst(created.code, { token: created.token, userId }, false);
      expect(started).toMatchObject({ ok: true, started: true });
      room = await store.getRoom(created.code);
    }
    expect(room!.state!.activePlayer).toBe(1);
    const before = room!.version;

    let announce!: (value: number) => void;
    const announced = new Promise<number>((resolve) => { announce = resolve; });
    const runner = new BotRunner({
      rooms: store,
      delayMs: 0,
      afterCommit: async (_code, version) => announce(version),
    });
    try {
      runner.schedule(created.code);
      const version = await Promise.race([
        announced,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("Cindra bot action timed out")), 1_000)
        ),
      ]);
      expect(version).toBeGreaterThan(before);
    } finally {
      runner.stop();
      await (db as unknown as { end(): Promise<void> }).end();
    }
  });

  it("dispatches a Jarl room through the defensive Jarl policy", async () => {
    const db = await freshDb();
    const store = new PgRoomStore(db, "jarl-runner-test");
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('JarlRunner','jarlrunner','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    const created = await store.createBotRoom("cc", {
      deckId: "precon-asb",
      username: "JarlRunner",
      userId,
    }, false, "jarl");
    const pool = precon("precon-asb")!.pool;
    await store.chooseFirst(created.code, { token: created.token, userId }, false);
    const ready = await store.presentDeck(created.code, { token: created.token, userId }, {
      weaponIds: pool.weaponIds,
      equipment: {},
      deck: pool.deck,
    });
    expect(ready.ok).toBe(true);
    let room = await store.getRoom(created.code);
    if (!room!.state) {
      const started = await store.chooseFirst(created.code, { token: created.token, userId }, false);
      expect(started).toMatchObject({ ok: true, started: true });
      room = await store.getRoom(created.code);
    }
    expect(room!.state!.activePlayer).toBe(1);
    const before = room!.version;

    let announce!: (value: number) => void;
    const announced = new Promise<number>((resolve) => { announce = resolve; });
    const runner = new BotRunner({
      rooms: store,
      delayMs: 0,
      afterCommit: async (_code, version) => announce(version),
    });
    try {
      runner.schedule(created.code);
      const version = await Promise.race([
        announced,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("Jarl bot action timed out")), 1_000)
        ),
      ]);
      expect(version).toBeGreaterThan(before);
    } finally {
      runner.stop();
      await (db as unknown as { end(): Promise<void> }).end();
    }
  });
});
