import {
  botDefinitionForDeckId, botObservationKey, isCleanActionDecision, cloneStateForBotSimulation,
} from "@fyendal/bot";
import { MAX_BOT_TASK_BYTES } from "@fyendal/protocol";
import type { ClientBotTask, ServerMessage } from "@fyendal/shared";
import { encodePersistedState } from "./persistedState.js";
import { stateMessage, type RoomRow } from "./store.js";

export function clientBotTask(room: RoomRow, runtimeId: string, delayMs: number): ServerMessage | null {
  if (!room.state || room.state.winner !== null) return null;
  const seat = room.seats.findIndex((s) => s?.controller === "bot");
  if (!(seat === 0 || seat === 1)
    || (room.state.pendingDecision?.player ?? room.state.priorityPlayer) !== seat) return null;
  const bot = botDefinitionForDeckId(room.seats[seat]?.deckId);
  const message = stateMessage(room, seat);
  if (!bot || message?.type !== "state") return null;
  const view = {
    ...message.view, log: [], logEntries: [],
    gameStats: { turns: message.view.gameStats?.turns.slice(-1) ?? [] },
  };
  const task: ClientBotTask = {
    type: "bot-task", code: room.code, version: room.version, runtimeId,
    botId: bot.id, seat, view, legal: message.legal, delayMs,
  };
  if (isCleanActionDecision(room.state, seat)) {
    const simulation = cloneStateForBotSimulation(room.state, room.code);
    const seed = Number.parseInt(botObservationKey({ view, legal: message.legal }).slice(0, 8), 16) | 0;
    simulation.seed = seed;
    simulation.rngState = seed;
    task.simulation = encodePersistedState(simulation, room.rulesetVersion);
  }
  const bytes = Buffer.byteLength(JSON.stringify(task));
  console.log(JSON.stringify({
    severity: "INFO", event: "client_bot_task", botId: task.botId,
    taskBytes: bytes, simulation: task.simulation !== undefined,
  }));
  if (bytes > MAX_BOT_TASK_BYTES) {
    return { type: "bot-fallback-needed", code: room.code, version: room.version, runtimeId, delayMs };
  }
  return task;
}
