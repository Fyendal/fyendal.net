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
      <span>{intl.formatMessage({ id: "matchmaking.background.searching" })}</span>
      <button type="button" onClick={onStop}>
        {intl.formatMessage({ id: "matchmaking.background.stop" })}
      </button>
    </aside>
  );
}
