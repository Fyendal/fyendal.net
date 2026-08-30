import {
  botDefinition,
  type BotDecision,
  type BotPolicyInput,
} from "@fyendal/bot";
import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { BotOpponent, Decklist } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { executeBotPolicyTask } from "../botPolicyTask.js";
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
    state: encoded,
  });
  if (!task) throw new Error("expected valid worker task");
  return { task, direct };
}

describe("bot policy worker task", () => {
  it.each(["bravo", "hala", "cindra"] as const)(
    "matches direct %s policy execution after persisted-state hydration",
    (id) => {
      const { task, direct } = decisionFor(id);
      const result = executeBotPolicyTask(task);
      expect(result.decision).toEqual(direct);
      expect(result.computeMs).toBeGreaterThanOrEqual(0);
      if (id !== "hala") expect(result.decision.planning).toBeDefined();
    },
    10_000,
  );

  it("rejects unexpected task fields before policy execution", () => {
    const { task } = decisionFor("bravo");
    expect(decodeBotPolicyTask({ ...task, unexpected: true })).toBeNull();
  });

  it("accepts the server's full uppercase alphanumeric room-code format", () => {
    const { task } = decisionFor("bravo");
    expect(decodeBotPolicyTask({ ...task, code: "ROOM42" }))
      .toMatchObject({ code: "ROOM42", botId: "bravo" });
    expect(decodeBotPolicyTask({ ...task, code: "room42" })).toBeNull();
  });

  it("exhaustively rejects corrupt persisted state", () => {
    const { task } = decisionFor("bravo");
    expect(() => executeBotPolicyTask({
      ...task,
      state: { ...task.state as Record<string, unknown>, unexpected: true },
    })).toThrow();
  });
});
