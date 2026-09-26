import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  handDragLocation,
  handDragScrollSpeed,
  handDragStarted,
  moveVisibleHandCard,
  reconcileHandOrder,
} from "./handOrder.js";

interface HandDrag {
  pointerId: number;
  instanceId: number;
  element: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  grabOffset: number;
  grabOffsetY: number;
  handTop: number;
  started: boolean;
  originalOrder: readonly number[];
  frame: number;
  lastFrameTime: number;
}

/** Pointer movement is cosmetic; an eligible arena release starts a play. */
export function useHandReorder(
  handRef: RefObject<HTMLDivElement>,
  instanceIds: readonly number[],
  enabled: boolean,
  playDrop?: {
    canPlay: (instanceId: number) => boolean;
    onPlay: (instanceId: number) => void;
    onDragStart?: () => void;
  },
) {
  const [preferredOrder, setPreferredOrder] = useState<readonly number[]>([]);
  const order = reconcileHandOrder(instanceIds, preferredOrder);
  const orderRef = useRef(order);
  const dragRef = useRef<HandDrag | null>(null);
  const floatingCardRef = useRef<HTMLDivElement>(null);
  const playDropRef = useRef(playDrop);
  playDropRef.current = playDrop;
  const [floatingCard, setFloatingCard] = useState<{
    instanceId: number;
    width: number;
    height: number;
  } | null>(null);
  const [playOnRelease, setPlayOnRelease] = useState(false);
  const suppressClickUntilRef = useRef(0);
  // Membership changes cancel a gesture; presentation-order changes do not.
  const idsKey = [...instanceIds].sort((left, right) => left - right).join(":");
  const previousIdsKeyRef = useRef(idsKey);

  const finishDrag = (cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    cancelAnimationFrame(drag.frame);
    drag.element.classList.remove("hand-card-dragging");
    setFloatingCard(null);
    setPlayOnRelease(false);
    const hand = handRef.current;
    // A cancelled drag keeps the hand's capture until native pointer-up. Its
    // trailing click then stays on the hand and cannot dismiss another choice.
    if (!cancelled || !drag.started) {
      if (hand?.hasPointerCapture(drag.pointerId)) hand.releasePointerCapture(drag.pointerId);
      if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    }
    if (drag.started) {
      suppressClickUntilRef.current = Date.now() + 750;
      if (cancelled) setPreferredOrder(reconcileHandOrder(orderRef.current, drag.originalOrder));
    }
  };
  const finishDragRef = useRef(finishDrag);
  finishDragRef.current = finishDrag;

  const dragLocation = (drag: HandDrag) => {
    const hand = handRef.current;
    const arena = hand?.closest<HTMLElement>(".board");
    if (!hand || !arena) return "outside";
    const bounds = hand.getBoundingClientRect();
    return handDragLocation(drag.x, drag.y, {
      left: bounds.left,
      right: bounds.right,
      top: drag.handTop,
      bottom: bounds.bottom,
    }, arena.getBoundingClientRect());
  };

  const canReleaseToPlay = (drag: HandDrag) => {
    if (dragLocation(drag) !== "arena" || !playDropRef.current?.canPlay(drag.instanceId)) return false;
    const target = document.elementFromPoint(drag.x, drag.y);
    return target?.closest(".board") === handRef.current?.closest(".board") &&
      !target?.closest(".overlay, .decision-float, .hand-scroll-button, .mobile-hand-toggle");
  };

  const positionDraggedCard = () => {
    const drag = dragRef.current;
    if (!drag?.started) return;
    drag.element.classList.add("hand-card-dragging");
    const floating = floatingCardRef.current;
    if (floating) {
      floating.style.transform = `translate(${drag.x - drag.grabOffset}px, ${drag.y - drag.grabOffsetY}px)`;
    }
    setPlayOnRelease(canReleaseToPlay(drag));
  };

  useLayoutEffect(() => {
    orderRef.current = order;
    if (!enabled) finishDragRef.current(true);
    if (previousIdsKeyRef.current !== idsKey) {
      finishDragRef.current(true);
    }
    previousIdsKeyRef.current = idsKey;
    positionDraggedCard();
  });

  useEffect(() => {
    // Drop departed ids so a card returning later is treated as a new arrival.
    setPreferredOrder((current) => current.length === 0
      ? current
      : reconcileHandOrder(orderRef.current, current));
  }, [idsKey]);

  useEffect(() => {
    const cancel = () => finishDragRef.current(true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      const drag = dragRef.current;
      if (drag) {
        cancelAnimationFrame(drag.frame);
        drag.element.classList.remove("hand-card-dragging");
      }
    };
  }, []);

  const cardElement = (target: EventTarget) => target instanceof Element
    ? target.closest<HTMLElement>("[data-hand-instance-id]")
    : null;

  const tick = (time: number) => {
    const drag = dragRef.current;
    const hand = handRef.current;
    if (!drag?.started || !hand) return;
    if (!drag.element.isConnected) {
      finishDrag(true);
      return;
    }
    const bounds = hand.getBoundingClientRect();
    const elapsed = drag.lastFrameTime === 0 ? 0 : Math.min(32, time - drag.lastFrameTime);
    drag.lastFrameTime = time;
    if (dragLocation(drag) !== "hand") {
      positionDraggedCard();
      drag.frame = requestAnimationFrame(tick);
      return;
    }
    hand.scrollLeft += handDragScrollSpeed(drag.x, bounds.left, bounds.right) * elapsed / 1000;
    // Read all slot geometry before moving the dragged card.
    const center = drag.x - drag.grabOffset + drag.element.offsetWidth / 2;
    const others = [...hand.querySelectorAll<HTMLElement>("[data-hand-instance-id]")]
      .filter((element) => element !== drag.element);
    const targetIndex = others.filter((element) => {
      const rect = element.getBoundingClientRect();
      return center > rect.left + rect.width / 2;
    }).length;
    const visibleOrder = [...hand.querySelectorAll<HTMLElement>("[data-hand-instance-id]")]
      .map((element) => Number(element.dataset.handInstanceId));
    const currentIndex = visibleOrder.indexOf(drag.instanceId);
    if (currentIndex !== targetIndex) {
      // Staged/hidden hand cards retain their slots in the full local order.
      const next = moveVisibleHandCard(orderRef.current, visibleOrder, drag.instanceId, targetIndex);
      setPreferredOrder(next);
    }
    positionDraggedCard();
    drag.frame = requestAnimationFrame(tick);
  };

  return {
    order,
    floatingCard,
    floatingCardRef,
    playOnRelease,
    handlers: {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        if (!enabled || !event.isPrimary || event.button !== 0 || dragRef.current) return;
        const element = cardElement(event.target);
        if (!element || (event.target instanceof Element && event.target.closest(".c-ovl"))) return;
        const instanceId = Number(element.dataset.handInstanceId);
        if (!orderRef.current.includes(instanceId)) return;
        suppressClickUntilRef.current = 0;
        const rect = element.getBoundingClientRect();
        // Capture on the card, so an ordinary click still reaches its action
        // while a drag continues outside the hand or across reordered siblings.
        element.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          instanceId,
          element,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          grabOffset: event.clientX - rect.left,
          grabOffsetY: event.clientY - rect.top,
          handTop: Math.max(event.currentTarget.getBoundingClientRect().top, Math.min(
            ...[...event.currentTarget.querySelectorAll<HTMLElement>("[data-hand-instance-id]")]
              .map((card) => card.getBoundingClientRect().top),
          )),
          started: false,
          originalOrder: orderRef.current,
          frame: 0,
          lastFrameTime: 0,
        };
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (!drag.started) {
          if (!handDragStarted(drag.startX, drag.startY, event.clientX, event.clientY)) return;
          drag.started = true;
          playDropRef.current?.onDragStart?.();
          // The stable hand container keeps capture when React moves a card's
          // DOM node into its new slot. Changing capture releases the card's
          // initial click capture, which is not a gesture cancellation.
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.element.classList.add("hand-card-dragging");
          const rect = drag.element.getBoundingClientRect();
          setFloatingCard({ instanceId: drag.instanceId, width: rect.width, height: rect.height });
        }
        event.preventDefault();
        // Apply the pointer position immediately: a quick flick can finish
        // before the browser's next animation frame.
        cancelAnimationFrame(drag.frame);
        tick(performance.now());
      },
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.x = event.clientX;
        drag.y = event.clientY;
        const play = drag.started && canReleaseToPlay(drag);
        const inHand = dragLocation(drag) === "hand";
        const instanceId = drag.instanceId;
        // An arena drag is not a hand reorder; restore its starting slot.
        finishDrag(!inHand);
        if (play) playDropRef.current?.onPlay(instanceId);
      },
      onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId === event.pointerId) finishDrag(true);
      },
      onLostPointerCapture: (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (drag?.pointerId === event.pointerId &&
          (!drag.started || event.target === event.currentTarget)) finishDrag(true);
      },
      onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
        if (Date.now() >= suppressClickUntilRef.current || event.detail === 0) return;
        suppressClickUntilRef.current = 0;
        event.preventDefault();
        event.stopPropagation();
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape" && dragRef.current) {
          event.preventDefault();
          event.stopPropagation();
          finishDrag(true);
          return;
        }
        if (!enabled || !event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        const element = cardElement(event.target);
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        const id = Number(element.dataset.handInstanceId);
        const visibleOrder = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-hand-instance-id]")]
          .map((card) => Number(card.dataset.handInstanceId));
        const targetIndex = visibleOrder.indexOf(id) + (event.key === "ArrowLeft" ? -1 : 1);
        if (visibleOrder[targetIndex] === undefined) return;
        setPreferredOrder(moveVisibleHandCard(orderRef.current, visibleOrder, id, targetIndex));
        requestAnimationFrame(() => element.scrollIntoView({ block: "nearest", inline: "nearest" }));
      },
    },
  };
}
