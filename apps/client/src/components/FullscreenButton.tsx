import { useIntl } from "react-intl";
import { useFullscreen } from "./useFullscreen.js";

export function FullscreenButton({
  placement,
  onToggle,
}: {
  placement: "header" | "menu";
  onToggle?: () => void;
}) {
  const intl = useIntl();
  const { supported, active, toggle } = useFullscreen();
  if (!supported) return null;

  const label = intl.formatMessage({
    id: active ? "common.fullscreen.exit" : "common.fullscreen.enter",
  });
  return (
    <button
      type="button"
      className={placement === "header" ? "topbar-icon-link topbar-fullscreen-button" : undefined}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={(event) => {
        toggle();
        onToggle?.();
        event.currentTarget.blur();
      }}
    >
      {placement === "menu" ? label : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          {active ? (
            <path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" />
          ) : (
            <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />
          )}
        </svg>
      )}
    </button>
  );
}
