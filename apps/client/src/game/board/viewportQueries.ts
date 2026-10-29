/** Phone held upright: hand tray, bottom bar, and bounded sheets. */
export const MOBILE_FLOAT_QUERY = "(max-width: 700px) and (orientation: portrait)";
/** Phone held sideways, or any landscape window too short for the desktop board. */
export const PHONE_LANDSCAPE_QUERY =
  "(orientation: landscape) and (max-height: 520px), (orientation: landscape) and (max-width: 700px)";
/** Landscape touch devices start with the log collapsed. */
export const TOUCH_LANDSCAPE_QUERY =
  "(min-width: 701px) and (orientation: landscape) and (pointer: coarse)";

const matches = (query: string) =>
  typeof window !== "undefined" && window.matchMedia(query).matches;

/** Layouts without hover: cards are inspected by tap and long press. */
export function isTouchBoardViewport(): boolean {
  return matches(MOBILE_FLOAT_QUERY)
    || (matches(PHONE_LANDSCAPE_QUERY) && matches("(pointer: coarse)"));
}
