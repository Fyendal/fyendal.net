import type { CSSProperties } from "react";

/** Interface icons stored as SVG files in `public/icons/ui/`. */
export type UiIconName =
  | "check"
  | "close"
  | "flag"
  | "flag-filled"
  | "invite-game"
  | "message"
  | "user-add"
  | "user-pending";

export function UiIcon({ name, className }: { name: UiIconName; className?: string }) {
  return (
    <span
      className={`ui-icon${className ? ` ${className}` : ""}`}
      style={{ "--ui-icon": `url("/icons/ui/${name}.svg")` } as CSSProperties}
      aria-hidden="true"
    />
  );
}
