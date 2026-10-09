import { useEffect, useState } from "react";
import type { PrepView } from "@fyendal/shared";
import { canChooseFirst } from "./firstPlayerStatus.js";

/** How long a preparation step may sit untouched before its control glows. */
export const PREP_NUDGE_DELAY_MS = 10_000;

export type PrepStep = "first-player" | "arena" | "ready";

/**
 * The single action that advances preparation for this player, or null when
 * the player is waiting on someone else. Steps are checked in flow order so
 * at most one control is ever highlighted.
 */
export function nextPrepStep(prep: PrepView | null): PrepStep | null {
  if (!prep || prep.phase === "accept") return null;
  const me = prep.seats[prep.yourSeat];
  const opponent = prep.seats[1 - prep.yourSeat];
  if (!me || !opponent) return null;
  if (prep.die && prep.startPlayer === null && canChooseFirst({
    botGame: prep.botGame === true,
    dieWinner: prep.die.winner,
    yourSeat: prep.yourSeat,
  })) return "first-player";
  if (prep.phase === "select-arena" && !me.arenaLocked) return "arena";
  if (prep.phase === "select-deck" && !me.ready) return "ready";
  return null;
}

/**
 * True once `stepKey` has stayed current for `delayMs`. A new key restarts the
 * delay, so each step gets its own grace period before being highlighted.
 */
export function useStepNudge(stepKey: string | null, delayMs = PREP_NUDGE_DELAY_MS): boolean {
  const [nudgedKey, setNudgedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!stepKey) return;
    const timer = window.setTimeout(() => setNudgedKey(stepKey), delayMs);
    return () => window.clearTimeout(timer);
  }, [stepKey, delayMs]);
  return stepKey !== null && nudgedKey === stepKey;
}
