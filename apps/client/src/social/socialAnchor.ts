import { useSyncExternalStore } from "react";

let anchor: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** Ref callback for the in-game slot that hosts the friends control. */
export function setSocialAnchor(element: HTMLElement | null) {
  if (anchor === element) return;
  anchor = element;
  for (const listener of listeners) listener();
}

export function useSocialAnchor(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => anchor,
    () => null,
  );
}
