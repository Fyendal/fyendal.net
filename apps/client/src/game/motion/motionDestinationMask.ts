export const MOTION_DESTINATION_HIDDEN_ATTRIBUTE = "data-game-motion-destination-hidden";

export type MaskedElementsByBatch = Map<string, Map<string, HTMLElement>>;

interface MotionDestinationArrival {
  destinationPresentationKey?: string;
  mode?: string;
  maskDestinationWhilePending?: true;
}

export function concealMotionDestination(element: HTMLElement): void {
  // Keep this outside React's className so ordinary card rerenders cannot
  // accidentally expose an authoritative destination before its flight lands.
  element.setAttribute(MOTION_DESTINATION_HIDDEN_ATTRIBUTE, "");
}

export function revealMotionDestination(element: HTMLElement): void {
  element.removeAttribute(MOTION_DESTINATION_HIDDEN_ATTRIBUTE);
}

/** Add destination masks for the supplied arrivals. Callers may pass only true
 * arrivals while a batch is pending, then add its reflows when it activates. */
export function activateMotionDestinationMasks(
  batchId: string,
  arrivals: readonly MotionDestinationArrival[],
  currentElements: ReadonlyMap<string, HTMLElement>,
  maskedElements: MaskedElementsByBatch,
): void {
  const batchMasks = new Map(maskedElements.get(batchId) ?? []);
  for (const arrival of arrivals) {
    const key = arrival.destinationPresentationKey;
    if (!key) continue;
    const element = currentElements.get(key);
    if (!element) continue;
    concealMotionDestination(element);
    batchMasks.set(key, element);
  }
  if (batchMasks.size > 0) maskedElements.set(batchId, batchMasks);
}

/** True arrivals exist only in the authoritative destination DOM and must be
 * concealed as soon as they are queued. Reflows represent cards that already
 * exist in hand, so masking those before their overlay mounts creates a gap. */
export function motionDestinationsRequiringEarlyMask(
  arrivals: readonly MotionDestinationArrival[],
): MotionDestinationArrival[] {
  return arrivals.filter((arrival) => (
    arrival.mode !== "reflow" || arrival.maskDestinationWhilePending === true
  ));
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
