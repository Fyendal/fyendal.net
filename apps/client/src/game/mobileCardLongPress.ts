import { useCallback, useEffect, useRef } from "react";

export const MOBILE_CARD_INSPECT_QUERY = "(max-width: 700px) and (pointer: coarse)";
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

/** Delegated mobile card inspection gesture shared by every card surface. */
export function useMobileCardLongPress(
  onLongPress: (cardId: string, target: HTMLElement) => void,
) {
  const onLongPressRef = useRef(onLongPress);
  const activeRef = useRef<ActiveCardLongPress | null>(null);
  const suppressClickUntilRef = useRef(0);

  useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (active) window.clearTimeout(active.timer);
    activeRef.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (
      event.pointerType !== "touch"
      || !event.isPrimary
      || !window.matchMedia(MOBILE_CARD_INSPECT_QUERY).matches
    ) return;
    const target = event.target as HTMLElement;
    if (target.closest(".overlay")) return;
    const cardId = target.closest<HTMLElement>("[data-cardid]")?.dataset.cardid;
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
    if (Date.now() >= suppressClickUntilRef.current) return;
    suppressClickUntilRef.current = 0;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    if (
      window.matchMedia(MOBILE_CARD_INSPECT_QUERY).matches
      && (event.target as HTMLElement).closest("[data-cardid]")
    ) event.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture,
    onContextMenu,
  };
}
