import { useEffect, useState } from "react";

export function EndTurnPassToast({
  placement = "divider",
}: {
  placement?: "divider" | "mobile-hand";
}) {
  return (
    <div
      className={`end-turn-pass-toast end-turn-pass-toast-${placement}`}
      role="status"
      aria-live="polite"
    >
      Opponent is trying to end their turn
    </div>
  );
}

function plainLogLine(line: string): string {
  return line.replace(/⟦[^⟧]+⟧/g, "");
}

/** Summarize the arsenal action from the turn immediately before the current
 * one. This remains useful when relevant-only priority skipped every window
 * on a quiet opening turn. */
export function previousOpponentTurnSummary(
  log: readonly string[],
  opponentHeroName: string,
): string | null {
  const boundaries = log.flatMap((line, index) =>
    /^— Turn \d+: /.test(plainLogLine(line)) ? [index] : []
  );
  if (boundaries.length < 2) return null;
  const previousStart = boundaries.at(-2)!;
  const currentStart = boundaries.at(-1)!;
  const previousTurn = log.slice(previousStart + 1, currentStart).map(plainLogLine);
  const faceUpSuffix = ` is put face up into ${opponentHeroName}'s arsenal`;
  const faceUp = previousTurn.find((line) => line.endsWith(faceUpSuffix));
  if (faceUp) {
    const cardName = faceUp.slice(0, -faceUpSuffix.length);
    return `Opponent put ${cardName} face up into arsenal.`;
  }
  if (previousTurn.includes(`${opponentHeroName} puts a card face down into arsenal`)) {
    return "Opponent ended the turn and put a card face down into arsenal.";
  }
  return null;
}

export function OpponentTurnSummaryToast({
  message,
  placement = "divider",
}: {
  message: string;
  placement?: "divider" | "mobile-hand";
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 5_000);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div
      className={`end-turn-pass-toast turn-summary-toast end-turn-pass-toast-${placement}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
