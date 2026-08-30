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
