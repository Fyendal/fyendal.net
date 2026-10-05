import type { PerMessageDeflateOptions } from "ws";

/** Transport-only optimization; clients that do not offer it keep plain JSON.
 * Read once at gateway creation so changing the environment requires a restart. */
export function configuredWebSocketCompression(
  value = process.env.WS_COMPRESSION,
): PerMessageDeflateOptions | false {
  if (value === "false") return false;
  if (value !== undefined && value !== "true") {
    throw new Error("WS_COMPRESSION must be true or false");
  }
  return {
    zlibDeflateOptions: { level: 3, memLevel: 7 },
    // Bound retained history and keep credentials/control frames from becoming
    // compression context for later state, chat, or bot-task messages.
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
    concurrencyLimit: 4,
    threshold: 1024,
  };
}
