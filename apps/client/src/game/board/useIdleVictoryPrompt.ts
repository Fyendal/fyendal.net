import { IDLE_VICTORY_MS } from "@fyendal/shared";
import { useEffect, useState } from "react";

export function useIdleVictoryPrompt() {
  const [now, setNow] = useState(() => Date.now());
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  // A dismissal only snoozes: a still-idle opponent is offered again later.
  const snooze = () => {
    const at = Date.now();
    setNow(at);
    setSnoozedUntil(at + IDLE_VICTORY_MS);
  };

  return { now, snoozedUntil, snooze };
}
