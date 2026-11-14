import { FormattedMessage } from "react-intl";

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
      <FormattedMessage id="game.turn.endPassPending" />
    </div>
  );
}
