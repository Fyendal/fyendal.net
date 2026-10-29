import { useCallback, useEffect, useRef } from "react";
import { isTouchBoardViewport } from "./board/viewportQueries.js";

export const CARD_LONG_PRESS_MS = 425;
export const CARD_LONG_PRESS_MOVE_PX = 10;
const CARD_CLICK_SUPPRESSION_MS = 750;

type ActiveCardLongPress = {
  timer: number;
  pointerId: number;
  startX: number;
  startY: number;
};

export function cardLongPressMoved(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): boolean {
  return Math.abs(currentX - startX) > CARD_LONG_PRESS_MOVE_PX
    || Math.abs(currentY - startY) > CARD_LONG_PRESS_MOVE_PX;
}

/** Find the card represented by a mobile inspection gesture. Overlay content
 * owns its own interactions, while both actionable and inert cards remain
 * inspectable by long press. */
export function mobileCardLongPressCardId(target: HTMLElement): string | null {
  if (target.closest(".overlay, .modal-surface-backdrop")) return null;
  // Holding a hand card picks it up for dragging instead.
  if (target.closest("#player-hand")) return null;
  return target.closest<HTMLElement>("[data-cardid]")?.dataset.cardid ?? null;
}

/** Mobile browsers snap a tap that lands near a card onto it; a card only
 * takes a tap whose touch began on it. */
export function snappedCardTap(clickTarget: Element, pressTarget: Element | null): boolean {
  const card = clickTarget.closest(".card");
  return card !== null && pressTarget?.isConnected === true && !card.contains(pressTarget);
}

/** Delegated mobile card inspection gesture shared by every card surface. */
export function useMobileCardLongPress(
  onLongPress: (cardId: string, target: HTMLElement) => void,
) {
  const onLongPressRef = useRef(onLongPress);
  const activeRef = useRef<ActiveCardLongPress | null>(null);
  const suppressClickUntilRef = useRef(0);
  const touchPressTargetRef = useRef<Element | null>(null);

  useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (active) window.clearTimeout(active.timer);
    activeRef.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  // Capture sees the raw touch target even when a card surface stops the event.
  const onPointerDownCapture = useCallback((event: React.PointerEvent) => {
    touchPressTargetRef.current = event.pointerType === "touch" && event.target instanceof Element
      ? event.target
      : null;
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (
      event.pointerType !== "touch"
      || !event.isPrimary
      || !isTouchBoardViewport()
    ) return;
    const target = event.target as HTMLElement;
    const cardId = mobileCardLongPressCardId(target);
    if (!cardId) return;

    cancel();
    const pointerId = event.pointerId;
    const timer = window.setTimeout(() => {
      const active = activeRef.current;
      if (!active || active.pointerId !== pointerId) return;
      activeRef.current = null;
      suppressClickUntilRef.current = Date.now() + CARD_CLICK_SUPPRESSION_MS;
      onLongPressRef.current(cardId, target);
    }, CARD_LONG_PRESS_MS);
    activeRef.current = {
      timer,
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }, [cancel]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (cardLongPressMoved(active.startX, active.startY, event.clientX, event.clientY)) {
      cancel();
    }
  }, [cancel]);

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    const pressTarget = touchPressTargetRef.current;
    touchPressTargetRef.current = null;
    // Keyboard activation (detail 0) has no touch behind it.
    const snapped = event.detail > 0 && event.target instanceof Element
      && snappedCardTap(event.target, pressTarget);
    if (!snapped) {
      if (Date.now() >= suppressClickUntilRef.current) return;
      suppressClickUntilRef.current = 0;
    }
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    if (
      isTouchBoardViewport()
      && (event.target as HTMLElement).closest("[data-cardid]")
    ) event.preventDefault();
  }, []);

  return {
    onPointerDownCapture,
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture,
    onContextMenu,
  };
}
