import { useSyncExternalStore } from "react";
import { setSocialAnchor } from "./socialAnchor.js";

const WIDE_QUERY = "(min-width: 701px)";

function subscribeWide(listener: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function isWide() {
  return window.matchMedia(WIDE_QUERY).matches;
}

/** Header slot that hosts the friends control. `wideOnly` leaves phones to
 * the screen's own More menu, which opens the friends sheet instead. */
export function TopbarSocialSlot({ wideOnly = false }: { wideOnly?: boolean }) {
  const wide = useSyncExternalStore(subscribeWide, isWide, () => true);
  if (wideOnly && !wide) return null;
  return <span ref={setSocialAnchor} className="topbar-social-slot" data-social-slot="topbar" />;
}
