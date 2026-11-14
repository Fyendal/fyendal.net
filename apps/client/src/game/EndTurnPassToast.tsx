import { FormattedMessage } from "react-intl";

export function EndTurnPassToast({
  placement = "divider",
  passedHeroName,
}: {
  placement?: "divider" | "mobile-hand";
  /** Solo: the hero who passed, named instead of "opponent". */
  passedHeroName?: string;
}) {
  return (
    <div
      className={`end-turn-pass-toast end-turn-pass-toast-${placement}`}
      role="status"
      aria-live="polite"
    >
      {passedHeroName === undefined
        ? <FormattedMessage id="game.turn.endPassPending" />
        : <FormattedMessage id="game.turn.endPassPending.solo" values={{ hero: passedHeroName }} />}
    </div>
  );
}
