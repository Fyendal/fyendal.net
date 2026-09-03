import { useIntl } from "react-intl";

export type BackgroundMatchSearchPlacement = "rail" | "menu";

export function BackgroundMatchSearch({
  placement,
  onStop,
}: {
  placement: BackgroundMatchSearchPlacement;
  onStop: () => void;
}) {
  const intl = useIntl();
  return (
    <aside
      className={`background-match-search background-match-${placement}`}
      role="status"
      aria-live="polite"
    >
      <span className="background-match-search-label">
        <span className="background-match-search-dot" aria-hidden="true" />
        <span>{intl.formatMessage({ id: "matchmaking.background.searching" })}</span>
      </span>
      <button type="button" onClick={onStop}>
        {intl.formatMessage({
          id: placement === "menu"
            ? "matchmaking.background.stopShort"
            : "matchmaking.background.stop",
        })}
      </button>
    </aside>
  );
}
