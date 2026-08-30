import { useEffect, useState } from "react";

export function useIdleVictoryPrompt() {
  const [now, setNow] = useState(() => Date.now());
  const [dismissedFor, setDismissedFor] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  return { now, dismissedFor, dismiss: setDismissedFor };
}
