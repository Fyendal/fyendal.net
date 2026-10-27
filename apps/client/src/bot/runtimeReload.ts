const BOT_RUNTIME_RELOAD_STORAGE_KEY = "fyendal-bot-runtime-reload";

/** Reload once per runtime mismatch. A repeat after reloading means the host
 * still serves the stale bundle, so the refresh notice stays instead. */
export function reloadForBotRuntime(
  storage: Pick<Storage, "getItem" | "setItem">,
  localRuntimeId: string,
  serverRuntimeId: string,
  reload: () => void,
): void {
  const attempt = `${localRuntimeId}:${serverRuntimeId}`;
  try {
    if (storage.getItem(BOT_RUNTIME_RELOAD_STORAGE_KEY) === attempt) return;
    storage.setItem(BOT_RUNTIME_RELOAD_STORAGE_KEY, attempt);
  } catch {
    // Without a durable marker a reload could loop.
    return;
  }
  reload();
}
