import { ClientBotPolicy } from "@fyendal/bot/client-task";
import { decodeBotTask, decodeGameView } from "@fyendal/protocol";
import type { BotWorkerResponse } from "@fyendal/shared";

const policy = new ClientBotPolicy();
const respond = (message: BotWorkerResponse): void => postMessage(message);
addEventListener("message", (event: MessageEvent<unknown>) => {
  const task = decodeBotTask(event.data);
  if (!task) {
    if (import.meta.env.DEV) {
      const payload = event.data && typeof event.data === "object" && !Array.isArray(event.data)
        ? event.data : null;
      const view = payload && "view" in payload ? payload.view : undefined;
      const legal = payload && "legal" in payload ? payload.legal : undefined;
      console.warn("[bot] worker rejected task", {
        fields: payload ? Object.keys(payload) : [],
        viewValid: decodeGameView(view) !== null,
        legalCount: Array.isArray(legal) ? legal.length : undefined,
        hasSimulation: payload ? "simulation" in payload : false,
      });
    }
    return; // The main-thread watchdog treats malformed/unanswered tasks as failures.
  }
  try {
    const started = performance.now();
    const intent = policy.decide(task);
    respond({
      type: "decision", code: task.code, version: task.version,
      intent, computeMs: performance.now() - started,
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error("[bot] worker decision failed", {
        botId: task.botId,
        version: task.version,
        decision: task.view.pendingDecision?.kind ?? task.view.phase,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { name: typeof error },
      });
    }
    policy.clear();
    respond({ type: "failed", code: task.code, version: task.version });
  }
});
respond({ type: "ready" });
