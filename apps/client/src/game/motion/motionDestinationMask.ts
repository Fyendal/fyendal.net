export const MOTION_DESTINATION_HIDDEN_ATTRIBUTE = "data-game-motion-destination-hidden";

export type MaskedElementsByBatch = Map<string, Map<string, HTMLElement>>;

export function concealMotionDestination(element: HTMLElement): void {
  // Keep this outside React's className so ordinary card rerenders cannot
  // accidentally expose an authoritative destination before its flight lands.
  element.setAttribute(MOTION_DESTINATION_HIDDEN_ATTRIBUTE, "");
}

export function revealMotionDestination(element: HTMLElement): void {
  element.removeAttribute(MOTION_DESTINATION_HIDDEN_ATTRIBUTE);
}

export function motionDestinationIsMasked(
  maskedElements: MaskedElementsByBatch,
  target: HTMLElement,
): boolean {
  for (const batchMasks of maskedElements.values()) {
    for (const element of batchMasks.values()) {
      if (element === target) return true;
    }
  }
  return false;
}

/** Reassert masks after every commit and transfer them when React replaces a
 * keyed presentation node. This closes the pre-animation frame caused by
 * hand legality/scroll rerenders changing a card's controlled className. */
export function refreshMotionDestinationMasks(
  maskedElements: MaskedElementsByBatch,
  currentElements: ReadonlyMap<string, HTMLElement>,
): void {
  for (const batchMasks of maskedElements.values()) {
    for (const [presentationKey, previousElement] of batchMasks) {
      const currentElement = currentElements.get(presentationKey) ?? previousElement;
      if (currentElement !== previousElement) {
        batchMasks.set(presentationKey, currentElement);
      }
      concealMotionDestination(currentElement);
      if (
        currentElement !== previousElement
        && !motionDestinationIsMasked(maskedElements, previousElement)
      ) {
        revealMotionDestination(previousElement);
      }
    }
  }
}
