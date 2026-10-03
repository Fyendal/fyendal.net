import { useEffect, useRef, useState } from "react";
import { ACTIVE_ACHIEVEMENT_IDS, type AchievementId } from "@fyendal/protocol";
import { apiAchievements } from "../auth/auth.js";
import type { ViewUpdate } from "../store/types.js";

const TOAST_DISPLAY_MS = 5_000;
const TOAST_EXIT_MS = 220;

export function useMatchAchievements({
  token, roomCode, gameOver, live, viewUpdate,
}: {
  token: string | null;
  roomCode: string | null;
  gameOver: boolean;
  live: boolean;
  viewUpdate: ViewUpdate;
}): { toast: AchievementId[]; toastPercent: number | null; toastExiting: boolean } {
  const [toast, setToast] = useState<AchievementId[]>([]);
  const [toastPercent, setToastPercent] = useState<number | null>(null);
  const [toastExiting, setToastExiting] = useState(false);
  const previous = useRef({ token, roomCode, gameOver, live });
  const source = viewUpdate.source;

  // Depend on the update source, not its sequence: ordinary live refreshes
  // must not cancel the lookup for a finished match.
  useEffect(() => {
    const prior = previous.current;
    previous.current = { token, roomCode, gameOver, live };
    if (prior.token !== token || prior.roomCode !== roomCode || !gameOver || !live) {
      setToast([]);
      setToastPercent(null);
      setToastExiting(false);
    }
    const witnessedFinish = prior.token === token && prior.roomCode === roomCode
      && prior.live && !prior.gameOver && source === "live";
    if (!token || !roomCode || !gameOver || !live || !witnessedFinish) return;
    const controller = new AbortController();
    void apiAchievements(token, controller.signal).then((result) => {
      if (controller.signal.aborted || !result.ok) return;
      const ids = result.unlocks
        .filter((item) => item.roomCode === roomCode && ACTIVE_ACHIEVEMENT_IDS.includes(item.id))
        .map((item) => item.id)
        .sort((a, b) => ACTIVE_ACHIEVEMENT_IDS.indexOf(a) - ACTIVE_ACHIEVEMENT_IDS.indexOf(b));
      if (ids.length > 0) {
        setToastExiting(false);
        setToastPercent(result.percentages.find((item) => item.id === ids[0])?.percent ?? null);
        setToast(ids);
      }
    });
    return () => controller.abort();
  }, [token, roomCode, gameOver, live, source]);

  useEffect(() => {
    if (toast.length === 0 || toastExiting) return;
    const timer = window.setTimeout(() => setToastExiting(true), TOAST_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [toast, toastExiting]);

  useEffect(() => {
    if (!toastExiting) return;
    const timer = window.setTimeout(() => {
      setToast([]);
      setToastPercent(null);
      setToastExiting(false);
    }, TOAST_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [toastExiting]);

  return { toast, toastPercent, toastExiting };
}
