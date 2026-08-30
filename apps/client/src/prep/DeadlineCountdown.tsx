import { useEffect, useState } from "react";

export function DeadlineCountdown({ deadlineAt }: { deadlineAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  return <>{Math.max(0, Math.ceil((deadlineAt - now) / 1_000))}s</>;
}
