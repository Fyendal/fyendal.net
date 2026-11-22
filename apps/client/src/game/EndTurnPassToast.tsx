import { FormattedMessage } from "react-intl";

export function EndTurnPassToast({
  placement = "divider",
  passer = "opponent",
}: {
  placement?: "divider" | "mobile-hand";
  /** Self-play only: "you" when your own seat passed and the opposing seat now acts. */
  passer?: "opponent" | "you";
}) {
  return (
    <div
      className={`end-turn-pass-toast end-turn-pass-toast-${placement}${passer === "you" ? " end-turn-pass-toast-opposing" : ""}`}
      role="status"
      aria-live="polite"
    >
      <FormattedMessage id={passer === "you" ? "game.turn.endPassPendingYours" : "game.turn.endPassPending"} />
    </div>
  );
}
