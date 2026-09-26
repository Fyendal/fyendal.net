import { ClientBotPolicy } from "@fyendal/bot/client-task";
import { decodeBotTask } from "@fyendal/protocol";
import type { BotWorkerResponse } from "@fyendal/shared";

const policy = new ClientBotPolicy();
const respond = (message: BotWorkerResponse): void => postMessage(message);
addEventListener("message", (event: MessageEvent<unknown>) => {
  const task = decodeBotTask(event.data);
  if (!task) return; // The main-thread watchdog treats malformed/unanswered tasks as failures.
  try {
    const started = performance.now();
    const intent = policy.decide(task);
    respond({
      type: "decision", code: task.code, version: task.version,
      intent, computeMs: performance.now() - started,
    });
  } catch {
    policy.clear();
    respond({ type: "failed", code: task.code, version: task.version });
  }
});
respond({ type: "ready" });
