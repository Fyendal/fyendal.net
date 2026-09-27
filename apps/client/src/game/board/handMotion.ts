export const HAND_REORDER_DURATION_MS = 220;
export const HAND_MOTION_EASING = "cubic-bezier(0.22, 0.8, 0.25, 1)";

/** Layout slots stay authoritative while their presentations animate. */
export function handCardSlotLeft(
  hand: HTMLElement,
  card: HTMLElement,
  handLeft = hand.getBoundingClientRect().left,
): number {
  return handLeft + card.offsetLeft - hand.scrollLeft;
}

/** The full raised hand area stays fixed through hover and selection. */
export function handCardSlotTop(hand: HTMLElement, card: HTMLElement): number {
  return hand.getBoundingClientRect().top + card.offsetTop - hand.scrollTop;
}

export function captureHandPositions(hand: HTMLElement): ReadonlyMap<number, number> {
  return new Map([...hand.querySelectorAll<HTMLElement>("[data-hand-instance-id]")]
    .map((card) => [Number(card.dataset.handInstanceId), card.getBoundingClientRect().left]));
}

export function cancelHandReorderAnimations(animations: Map<HTMLElement, Animation>): void {
  for (const animation of animations.values()) animation.cancel();
  animations.clear();
}

/** Animate from the previous visual position to the new layout slot. Retarget
 * from the current presentation when another reorder interrupts a slide. */
export function animateHandReorder(
  hand: HTMLElement,
  previous: ReadonlyMap<number, number>,
  animations: Map<HTMLElement, Animation>,
  draggedInstanceId: number | null,
  reducedMotion: boolean,
): void {
  cancelHandReorderAnimations(animations);
  if (reducedMotion) return;
  const handLeft = hand.getBoundingClientRect().left - hand.scrollLeft;
  const moves = [...hand.querySelectorAll<HTMLElement>("[data-hand-instance-id]")].map((card) => {
    const id = Number(card.dataset.handInstanceId);
    const previousLeft = previous.get(id);
    return {
      card,
      id,
      delta: previousLeft === undefined ? 0 : previousLeft - (handLeft + card.offsetLeft),
    };
  });
  for (const { card, id, delta } of moves) {
    if (id === draggedInstanceId || Math.abs(delta) < 1 || typeof card.animate !== "function") continue;
    // Individual translate composes with the existing hover/selection transform.
    animations.set(card, card.animate([
      { translate: `${delta}px 0px` },
      { translate: "0px 0px" },
    ], { duration: HAND_REORDER_DURATION_MS, easing: HAND_MOTION_EASING }));
  }
}

export function handReturnDuration(distance: number): number {
  return Math.min(260, Math.max(160, 130 + distance * 0.3));
}

/** A small velocity tilt settles naturally when the pointer stops. */
export function handDragTilt(current: number, deltaX: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return current;
  const target = Math.max(-4, Math.min(4, deltaX / elapsedMs * 3));
  return current + (target - current) * (1 - Math.exp(-elapsedMs / 55));
}
