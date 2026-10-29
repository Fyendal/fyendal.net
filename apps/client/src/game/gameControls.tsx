/** Icons and helpers shared by the rail and the HUD. */
export function ControlIcon({ kind }: { kind: "undo" | "bug" | "note" | "settings" | "fullscreen" | "exit-fullscreen" }) {
  const content = kind === "undo" ? (
    <>
      <path d="M9 7H5V3" />
      <path d="M5 7a9 9 0 1 1-1 8" />
    </>
  ) : kind === "bug" ? (
    <>
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
      <path d="M8 4 6.5 2.5M16 4l1.5-1.5" />
      <rect x="6" y="7" width="12" height="14" rx="6" />
      <path d="M12 11v10M6 11H3M18 11h3M6 16H3M18 16h3" />
    </>
  ) : kind === "note" ? (
    <>
      <path d="M6 3h12v18l-6-4-6 4V3Z" />
      <path d="M9 8h6M12 5v6" />
    </>
  ) : kind === "fullscreen" ? (
    <>
      <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />
    </>
  ) : kind === "exit-fullscreen" ? (
    <>
      <path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" />
    </>
  ) : (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
    </>
  );
  return (
    <svg
      className="game-control-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-control-icon={kind}
    >
      {content}
    </svg>
  );
}

/** Undo should not retain button focus: Space belongs to the board's pass
 * shortcut after the action has been restored. */
export function undoWithoutFocus(
  button: Pick<HTMLButtonElement, "blur">,
  undo: () => void,
): void {
  undo();
  button.blur();
}
