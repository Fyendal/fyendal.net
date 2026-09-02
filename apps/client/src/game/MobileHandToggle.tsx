import { useIntl } from "react-intl";

export function MobileHandToggle({
  expanded,
  cardCount,
  onToggle,
}: {
  expanded: boolean;
  cardCount: number;
  onToggle: () => void;
}) {
  const intl = useIntl();

  return (
    <button
      type="button"
      className="mobile-hand-toggle"
      aria-controls="player-hand"
      aria-expanded={expanded}
      aria-label={intl.formatMessage(
        { id: expanded ? "game.hand.hide" : "game.hand.showCount" },
        { count: cardCount },
      )}
      onClick={onToggle}
    >
      {expanded ? (
        <img className="mobile-hand-toggle-icon" src="/icons/hide-transparent.png" alt="" />
      ) : (
        <>
          <span>{intl.formatMessage({ id: "game.hand.show" })}</span>
          <span className="mobile-hand-count" aria-hidden="true">{cardCount}</span>
        </>
      )}
    </button>
  );
}
