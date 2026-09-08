import {
  botDefinition,
  createFaiProductionSession,
  initialFaiAggroPolicyState,
  type BotDecision,
  type BotPolicyInput,
  type FaiPolicyStateV1,
  type FaiProductionSession,
} from "@fyendal/bot";
import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import {
  applyIntent,
  createGame,
  legalIntents,
  projectStateFor,
  type GameState,
} from "@fyendal/engine";
import type { BotOpponent, Decklist } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { BotPolicySessionCache, executeBotPolicyTask } from "../botPolicyTask.js";
import { decodeBotPolicyTask } from "../botPolicyWorkerProtocol.js";
import { encodePersistedState } from "../persistedState.js";

function botDeck(id: BotOpponent): Decklist {
  const definition = botDefinition(id)!;
  const pool = precon(definition.deckId)!.pool;
  return {
    heroId: pool.heroId,
    ...definition.presentationFor(decklists.dorinthea, "second"),
  };
}

function decisionFor(id: BotOpponent): {
  task: NonNullable<ReturnType<typeof decodeBotPolicyTask>>;
  direct: BotDecision;
} {
  const definition = botDefinition(id)!;
  const state = createGame({
    decklists: [botDeck(id), decklists.dorinthea],
    cards: cardData,
    scripts,
    seed: 700 + id.length,
    startPlayer: 0,
  });
  state.turn = 2;
  const input: BotPolicyInput = {
    seat: 0,
    view: projectStateFor(state, 0, "ABC123"),
    legal: legalIntents(state, 0),
    cards: cardData,
    state,
  };
  const direct = definition.chooseDecision(input);
  const encoded = encodePersistedState(state, "worker-rules");
  expect(JSON.stringify(encoded)).not.toContain("cardsRef");
  expect(JSON.stringify(encoded)).not.toContain("scriptsRef");
  const task = decodeBotPolicyTask({
    taskId: 1,
    code: "ABC123",
    version: 9,
    rulesetVersion: "worker-rules",
    botId: id,
    seat: 0,
    resetSession: false,
    policyState: null,
    state: encoded,
  });
  if (!task) throw new Error("expected valid worker task");
  return { task, direct };
}

function registeredPoolDeck(id: BotOpponent): Decklist {
  const definition = botDefinition(id)!;
  const pool = precon(definition.deckId)!.pool;
  return {
    heroId: pool.heroId,
    weaponIds: [...pool.weaponIds],
    equipment: {},
    deck: [...pool.deck, ...(pool.sideboard ?? [])],
  };
}

function matchDeck(
  id: BotOpponent,
  opponent: Decklist,
  turnOrder: "first" | "second",
): Decklist {
  const definition = botDefinition(id)!;
  return {
    heroId: precon(definition.deckId)!.pool.heroId,
    ...definition.presentationFor(opponent, turnOrder),
  };
}

function applyBotIntent(state: GameState, seat: 0 | 1, intent: BotDecision["intent"]): GameState {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(`${JSON.stringify(intent)}: ${result.error}`);
  return result.state;
}

describe("bot policy worker task", () => {
  it.each(["bravo", "hala", "cindra", "fai"] as const)(
    "matches direct %s policy execution after persisted-state hydration",
    (id) => {
      const { task, direct } = decisionFor(id);
      const result = executeBotPolicyTask(task);
      expect(result.decision).toEqual(direct);
      expect(result.nextPolicyState === null).toBe(id !== "fai");
      expect(result.computeMs).toBeGreaterThanOrEqual(0);
      if (id !== "hala" && id !== "fai") {
        expect(result.decision.planning).toBeDefined();
      }
    },
    10_000,
  );

  it("rejects unexpected task fields before policy execution", () => {
    const { task } = decisionFor("bravo");
    expect(decodeBotPolicyTask({ ...task, unexpected: true })).toBeNull();
    const { resetSession: _resetSession, ...missingReset } = task;
    expect(decodeBotPolicyTask(missingReset)).toBeNull();
    expect(decodeBotPolicyTask({ ...task, resetSession: "yes" })).toBeNull();
    const { policyState: _policyState, ...missingPolicyState } = task;
    expect(decodeBotPolicyTask(missingPolicyState)).toBeNull();
    expect(decodeBotPolicyTask({
      ...task,
      policyState: initialFaiAggroPolicyState(),
    })).toBeNull();

    const { task: faiTask } = decisionFor("fai");
    expect(decodeBotPolicyTask({
      ...faiTask,
      policyState: { ...initialFaiAggroPolicyState(), unexpected: true },
    })).toBeNull();
  });

  it("accepts the server's full uppercase alphanumeric room-code format", () => {
    const { task } = decisionFor("bravo");
    expect(decodeBotPolicyTask({ ...task, code: "ROOM42" }))
      .toMatchObject({ code: "ROOM42", botId: "bravo" });
    expect(decodeBotPolicyTask({ ...task, code: "room42" })).toBeNull();
  });

  it("reuses Fai sessions across forward gaps and resets after regression or Undo", () => {
    const { task } = decisionFor("fai");
    let creations = 0;
    const sessions = new BotPolicySessionCache((input) => {
      creations++;
      return createFaiProductionSession(input);
    });
    executeBotPolicyTask(task, sessions);
    executeBotPolicyTask({ ...task, taskId: 2, version: task.version + 1 }, sessions);
    expect(creations).toBe(1);

    executeBotPolicyTask({ ...task, taskId: 3, version: task.version + 3 }, sessions);
    expect(creations).toBe(1);
    executeBotPolicyTask({ ...task, taskId: 4, version: task.version + 2 }, sessions);
    expect(creations).toBe(2);
    executeBotPolicyTask({
      ...task,
      taskId: 5,
      version: task.version + 4,
      resetSession: true,
    }, sessions);
    expect(creations).toBe(3);
  }, 10_000);

  it("restores decoded Fai state after the worker-local cache is replaced", () => {
    const { task } = decisionFor("fai");
    const first = executeBotPolicyTask(task, new BotPolicySessionCache());
    expect(first.nextPolicyState).not.toBeNull();
    const persisted = JSON.parse(JSON.stringify(first.nextPolicyState)) as unknown;
    const resumed = decodeBotPolicyTask({
      ...task,
      taskId: 2,
      version: task.version + 1,
      policyState: persisted,
    });
    if (!resumed) throw new Error("expected a valid resumed Fai worker task");
    const result = executeBotPolicyTask(resumed, new BotPolicySessionCache());
    expect(result.nextPolicyState).not.toBeNull();
    expect(result.nextPolicyState?.strategy).toBe(first.nextPolicyState?.strategy);
  }, 10_000);

  it.each([
    { opponentId: "briar", faiSeat: 0, startPlayer: 0, expectedStrategy: "aggro", seed: 26_090_701 },
    { opponentId: "briar", faiSeat: 1, startPlayer: 0, expectedStrategy: "aggro", seed: 26_090_702 },
    { opponentId: "bravo", faiSeat: 0, startPlayer: 0, expectedStrategy: "midrange", seed: 26_090_703 },
    { opponentId: "bravo", faiSeat: 1, startPlayer: 0, expectedStrategy: "midrange", seed: 26_090_704 },
  ] as const)(
    "keeps local and freshly restored website Fai identical: $expectedStrategy, seat $faiSeat",
    ({ opponentId, faiSeat, startPlayer, expectedStrategy, seed }) => {
      const opponentSeat = (1 - faiSeat) as 0 | 1;
      const faiOrder = faiSeat === startPlayer ? "first" : "second";
      const opponentOrder = opponentSeat === startPlayer ? "first" : "second";
      const opponentDeck = matchDeck(opponentId, registeredPoolDeck("fai"), opponentOrder);
      const faiDeck = matchDeck("fai", opponentDeck, faiOrder);
      const decks: [Decklist, Decklist] = faiSeat === 0
        ? [faiDeck, opponentDeck]
        : [opponentDeck, faiDeck];
      let state: GameState = createGame({
        decklists: decks,
        cards: cardData,
        scripts,
        seed,
        startPlayer,
      });
      const opponent = botDefinition(opponentId)!;
      let localSession: FaiProductionSession | undefined;
      let websiteState: FaiPolicyStateV1 | null = null;
      let faiDecisions = 0;

      for (let step = 0; step < 500 && state.winner === null && faiDecisions < 12; step++) {
        const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
        const input: BotPolicyInput = {
          seat: actor,
          view: projectStateFor(state, actor, "ABC123"),
          legal: legalIntents(state, actor),
          cards: cardData,
          state,
        };
        if (actor !== faiSeat) {
          state = applyBotIntent(state, actor, opponent.chooseIntent(input));
          continue;
        }

        localSession ??= createFaiProductionSession(input);
        expect(localSession.strategy).toBe(expectedStrategy);
        const local = localSession.chooseWithTrace(input).intent;
        const decoded = decodeBotPolicyTask({
          taskId: step + 1,
          code: "ABC123",
          version: step + 1,
          rulesetVersion: "equivalence-rules",
          botId: "fai",
          seat: faiSeat,
          resetSession: false,
          policyState: websiteState,
          state: encodePersistedState(state, "equivalence-rules"),
        });
        if (!decoded) throw new Error("expected valid website task");
        const website = executeBotPolicyTask(decoded, new BotPolicySessionCache());
        expect(website.decision.intent, `different intent at step ${step + 1}`).toEqual(local);
        expect(website.nextPolicyState, `different state at step ${step + 1}`).toEqual(
          localSession.snapshot(),
        );
        websiteState = JSON.parse(JSON.stringify(website.nextPolicyState)) as FaiPolicyStateV1;
        state = applyBotIntent(state, actor, local);
        faiDecisions++;
      }

      expect(faiDecisions).toBe(12);
    },
    120_000,
  );

  it("exhaustively rejects corrupt persisted state", () => {
    const { task } = decisionFor("bravo");
    expect(() => executeBotPolicyTask({
      ...task,
      state: { ...task.state as Record<string, unknown>, unexpected: true },
    })).toThrow();
  });
});
