import { useCallback, useEffect, useRef, useState } from "react";
import type { GameIntent } from "@fyendal/shared";
import { loadPassUntilHintGames, savePassUntilHintGames } from "../storage.js";

export const PASS_HINT_PASSES = 3;
export const PASS_HINT_WINDOW_MS = 10_000;
export const PASS_HINT_OPEN_MS = 8_000;
export const PASS_HINT_MAX_GAMES = 3;

/** A pass, or a block with nothing. */
export function passesWindow(intent: GameIntent): boolean {
  return intent.kind === "pass" || (intent.kind === "defend" && intent.instanceIds.length === 0);
}

/** Pass times still inside the window, with `now` added. */
export function recentPasses(times: readonly number[], now: number): number[] {
  return [...times.filter((time) => now - time < PASS_HINT_WINDOW_MS), now];
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Opens the keep-passing hint after a quick run of passes: once per board,
 *  in a few games at most, and never again once a mode has been armed or the
 *  hint closed by hand. */
export function usePassUntilHint(available: boolean, armed: boolean) {
  const [open, setOpen] = useState(false);
  const times = useRef<number[]>([]);
  const shown = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef({ available, armed, open });
  live.current = { available, armed, open };

  const close = useCallback((retire = false) => {
    clearTimeout(timer.current);
    times.current = [];
    setOpen(false);
    if (!retire) return;
    const storage = browserStorage();
    if (storage) savePassUntilHintGames(storage, PASS_HINT_MAX_GAMES);
  }, []);

  const noteIntent = useCallback((intent: GameIntent) => {
    if (!passesWindow(intent)) {
      close();
      return;
    }
    times.current = recentPasses(times.current, Date.now());
    const state = live.current;
    if (!state.open) {
      if (shown.current || !state.available || state.armed || times.current.length < PASS_HINT_PASSES) return;
      const storage = browserStorage();
      const games = storage ? loadPassUntilHintGames(storage) : 0;
      if (games >= PASS_HINT_MAX_GAMES) return;
      shown.current = true;
      if (storage) savePassUntilHintGames(storage, games + 1);
      setOpen(true);
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => close(), PASS_HINT_OPEN_MS);
  }, [close]);

  useEffect(() => {
    if (armed) close(true);
  }, [armed, close]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return { open: open && available && !armed, noteIntent, close };
}
