import { useEffect, useState } from "react";
import type { GlobalNotice } from "@fyendal/shared";
import { apiGlobalNotice } from "../auth/auth.js";
import { NoticeBanner } from "./NoticeBanner.js";

let dismissedNoticeId: string | null = null;

/** Expire an already fetched notice without making another request. */
export function scheduleNoticeExpiry(expiresAt: number, onExpire: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expire = () => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) onExpire();
    else timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
  };
  expire();
  return () => clearTimeout(timer);
}

export function GlobalNoticeBanner() {
  const [notice, setNotice] = useState<GlobalNotice | null>(null);
  const [dismissedId, setDismissedId] = useState(dismissedNoticeId);
  const visible = notice !== null && notice.id !== dismissedId;
  useEffect(() => {
    const controller = new AbortController();
    void apiGlobalNotice(controller.signal).then((result) => {
      if (!controller.signal.aborted && result.ok) setNotice(result.notice);
    }).catch(() => {
      // Try again the next time Home opens.
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const expiresAt = notice?.expiresAt;
    if (expiresAt === null || expiresAt === undefined) return;
    return scheduleNoticeExpiry(expiresAt, () => setNotice(null));
  }, [notice]);
  if (!visible) return null;
  return (
    <div className="global-notice-container">
      <NoticeBanner notice={notice} onDismiss={() => {
        dismissedNoticeId = notice.id;
        setDismissedId(notice.id);
      }} />
    </div>
  );
}
