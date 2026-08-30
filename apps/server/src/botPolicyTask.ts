import { performance } from "node:perf_hooks";
import { botDefinition, type BotDecision, type BotPolicyInput } from "@fyendal/bot";
import { cardData, scripts } from "@fyendal/cards";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { decodePersistedState } from "./persistedState.js";
import type { DecodedBotPolicyTask } from "./botPolicyWorkerProtocol.js";

export function executeBotPolicyTask(
  task: DecodedBotPolicyTask,
): { decision: BotDecision; computeMs: number } {
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
  const decision = definition.chooseDecision(input);
  return { decision, computeMs: performance.now() - startedAt };
}
