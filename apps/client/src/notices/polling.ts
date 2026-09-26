import { apiGlobalNotice } from "../auth/auth.js";
import type { GlobalNotice } from "@fyendal/shared";

/** One app-wide poller; notices also reach guests who have no WebSocket. */
export function startNoticePolling(update: (notice: GlobalNotice | null) => void): () => void {
  let stopped = false;
  let pending: AbortController | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let current: GlobalNotice | null = null;
  const expire = () => {
    clearTimeout(expiry);
    if (current?.expiresAt === null || !current) return;
    const remaining = current.expiresAt - Date.now();
    if (remaining <= 0) {
      current = null;
      update(null);
    } else {
      expiry = setTimeout(expire, Math.min(remaining, 2_147_483_647));
    }
  };
  const refresh = async () => {
    if (stopped || pending || document.visibilityState === "hidden") return;
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const result = await apiGlobalNotice(controller.signal);
      if (stopped || controller.signal.aborted || !result.ok) return;
      current = result.notice;
      update(current);
      expire();
    } finally {
      clearTimeout(timeout);
      pending = null;
    }
  };
  const wake = () => { void refresh(); };
  wake();
  const interval = setInterval(wake, 30_000);
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  return () => {
    stopped = true;
    pending?.abort();
    clearInterval(interval);
    clearTimeout(expiry);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("online", wake);
  };
}
