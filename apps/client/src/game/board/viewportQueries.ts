/** Phone held upright: hand tray, bottom bar, and bounded sheets. */
export const MOBILE_FLOAT_QUERY = "(max-width: 700px) and (orientation: portrait)";
/** Phone held sideways, or any landscape window too short for the desktop board. */
export const PHONE_LANDSCAPE_QUERY =
  "(orientation: landscape) and (max-height: 520px), (orientation: landscape) and (max-width: 700px)";
/** Landscape touch devices start with the log collapsed. */
export const TOUCH_LANDSCAPE_QUERY =
  "(min-width: 701px) and (orientation: landscape) and (pointer: coarse)";

/** A device whose main pointer can hover, so cards preview without a tap. */
export const FINE_HOVER_QUERY = "(hover: hover) and (pointer: fine)";

const matches = (query: string) =>
  typeof window !== "undefined" && window.matchMedia(query).matches;

/** Layouts without hover: cards are inspected by tap and long press. */
export function isTouchBoardViewport(): boolean {
  return matches(MOBILE_FLOAT_QUERY)
    || (matches(PHONE_LANDSCAPE_QUERY) && matches("(pointer: coarse)"));
}

/** Without hover a tap inspects inert cards, even on layouts too large for phones. */
export function tapInspectsCards(): boolean {
  return isTouchBoardViewport() || !matches(FINE_HOVER_QUERY);
}
