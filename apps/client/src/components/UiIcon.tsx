import type { CSSProperties } from "react";

/** Interface icons stored as SVG files in `public/icons/ui/`. */
export type UiIconName =
  | "attack-queue"
  | "check"
  | "close"
  | "edit"
  | "effect-chain"
  | "effect-game"
  | "effect-later"
  | "effect-once"
  | "effect-recurring"
  | "effect-turn"
  | "flag"
  | "flag-filled"
  | "invite-game"
  | "lock"
  | "message"
  | "star"
  | "trash"
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
