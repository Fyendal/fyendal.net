export function MobileHandToggle({
  expanded,
  cardCount,
  onToggle,
}: {
  expanded: boolean;
  cardCount: number;
  onToggle: () => void;
}) {
  const cardLabel = cardCount === 1 ? "card" : "cards";

  return (
    <button
      type="button"
      className="mobile-hand-toggle"
      aria-controls="player-hand"
      aria-expanded={expanded}
      aria-label={expanded ? "Hide hand" : `Show hand, ${cardCount} ${cardLabel}`}
      onClick={onToggle}
    >
      {expanded ? (
        <img className="mobile-hand-toggle-icon" src="/icons/hide-transparent.png" alt="" />
      ) : (
        <>
          <span>Show hand</span>
          <span className="mobile-hand-count" aria-hidden="true">{cardCount}</span>
        </>
      )}
    </button>
  );
}
