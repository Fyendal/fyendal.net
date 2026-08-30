import { parentPort } from "node:worker_threads";
import { executeBotPolicyTask } from "./botPolicyTask.js";
import {
  decodeBotPolicyTask,
  type BotPolicyWorkerFailure,
  type BotPolicyWorkerSuccess,
} from "./botPolicyWorkerProtocol.js";

const port = parentPort;
if (!port) throw new Error("bot policy worker requires a parent port");

port.on("message", (value: unknown) => {
  const task = decodeBotPolicyTask(value);
  if (!task) {
    const failure: BotPolicyWorkerFailure = {
      kind: "error",
      taskId: 0,
      error: "invalid bot policy task",
    };
    port.postMessage(failure);
    return;
  }
  try {
    const result = executeBotPolicyTask(task);
    const response: BotPolicyWorkerSuccess = {
      kind: "result",
      taskId: task.taskId,
      ...result,
    };
    port.postMessage(response);
  } catch (error) {
    const response: BotPolicyWorkerFailure = {
      kind: "error",
      taskId: task.taskId,
      error: error instanceof Error ? error.message.slice(0, 4_096) : "unknown bot policy error",
    };
    port.postMessage(response);
  }
});
