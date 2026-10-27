import type { CSSProperties } from "react";

/** Interface icons stored as SVG files in `public/icons/ui/`. */
export type UiIconName =
  | "attack-queue"
  | "bot"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "chevron-up"
  | "close"
  | "download"
  | "edit"
  | "effect-chain"
  | "effect-game"
  | "effect-later"
  | "effect-once"
  | "effect-recurring"
  | "effect-turn"
  | "external-link"
  | "flag"
  | "flag-filled"
  | "grip"
  | "image"
  | "invite-game"
  | "lock"
  | "message"
  | "minus"
  | "more"
  | "nav-decks"
  | "nav-history"
  | "nav-home"
  | "nav-rooms"
  | "note"
  | "play"
  | "plus"
  | "search"
  | "share"
  | "skip-forward"
  | "star"
  | "star-outline"
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
