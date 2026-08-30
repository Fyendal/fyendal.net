export function replayResult(
  winner: 0 | 1 | null,
  yourSeat: 0 | 1,
): {
  label: "Victory" | "Defeat" | "Ended";
  className: "replay-win" | "replay-loss" | "replay-ended";
} {
  if (winner === null) return { label: "Ended", className: "replay-ended" };
  return winner === yourSeat
    ? { label: "Victory", className: "replay-win" }
    : { label: "Defeat", className: "replay-loss" };
}
