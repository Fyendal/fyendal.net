import { useEffect, useRef, useState } from "react";
import { ACHIEVEMENT_IDS, type AchievementId } from "@fyendal/protocol";
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
}): { earned: AchievementId[]; toast: AchievementId[]; toastExiting: boolean; dismissToast: () => void } {
  const [earned, setEarned] = useState<AchievementId[]>([]);
  const [toast, setToast] = useState<AchievementId[]>([]);
  const [toastExiting, setToastExiting] = useState(false);
  const previous = useRef({ token, roomCode, gameOver, live });
  const source = viewUpdate.source;

  // Depend on the update source, not its sequence: ordinary live refreshes
  // must not cancel the lookup for a finished match.
  useEffect(() => {
    const prior = previous.current;
    previous.current = { token, roomCode, gameOver, live };
    if (prior.token !== token || prior.roomCode !== roomCode || !gameOver || !live) {
      setEarned([]);
      setToast([]);
      setToastExiting(false);
    }
    if (!token || !roomCode || !gameOver || !live) return;
    const witnessedFinish = prior.token === token && prior.roomCode === roomCode
      && prior.live && !prior.gameOver && source === "live";
    const controller = new AbortController();
    void apiAchievements(token, controller.signal).then((result) => {
      if (controller.signal.aborted || !result.ok) return;
      const ids = result.unlocks.filter((item) => item.roomCode === roomCode).map((item) => item.id)
        .sort((a, b) => ACHIEVEMENT_IDS.indexOf(a) - ACHIEVEMENT_IDS.indexOf(b));
      setEarned(ids);
      if (witnessedFinish && ids.length > 0) {
        setToastExiting(false);
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
      setToastExiting(false);
    }, TOAST_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [toastExiting]);

  return { earned, toast, toastExiting, dismissToast: () => setToastExiting(true) };
}
