import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  handDragLocation,
  handDragScrollSpeed,
  handDragStarted,
  handPlayDropTargetAllowed,
  moveVisibleHandCard,
  reconcileHandOrder,
  rememberHandOrder,
} from "./handOrder.js";
import {
  animateHandReorder,
  cancelHandReorderAnimations,
  captureHandPositions,
  handCardSlotLeft,
  handCardSlotTop,
  handDragTilt,
  HAND_MOTION_EASING,
  handReturnDuration,
} from "./handMotion.js";

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
  previousX: number;
  tilt: number;
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
  reducedMotion = false,
) {
  const [preferredOrder, setPreferredOrder] = useState<readonly number[]>(() => [...instanceIds]);
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
    returning: boolean;
  } | null>(null);
  const positionsBeforeReorderRef = useRef<ReadonlyMap<number, number> | null>(null);
  const reorderAnimationsRef = useRef(new Map<HTMLElement, Animation>());
  const returningRef = useRef<{ drag: HandDrag; animation: Animation | null } | null>(null);
  const [playOnRelease, setPlayOnRelease] = useState(false);
  const suppressClickUntilRef = useRef(0);
  // Membership changes cancel a gesture; presentation-order changes do not.
  const idsKey = [...instanceIds].sort((left, right) => left - right).join(":");
  const previousIdsKeyRef = useRef(idsKey);

  const reorderHand = (next: readonly number[]) => {
    const hand = handRef.current;
    if (hand) positionsBeforeReorderRef.current = captureHandPositions(hand);
    setPreferredOrder((current) => rememberHandOrder(next, current));
  };

  const finishReturn = () => {
    const returning = returningRef.current;
    if (!returning) return;
    returningRef.current = null;
    returning.animation?.cancel();
    returning.drag.element.classList.remove("hand-card-dragging");
    setFloatingCard(null);
  };
  const finishReturnRef = useRef(finishReturn);
  finishReturnRef.current = finishReturn;

  const finishDrag = (cancelled: boolean, animateReturn = false) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    cancelAnimationFrame(drag.frame);
    const returning = animateReturn && drag.started && !reducedMotion
      && drag.element.isConnected && floatingCardRef.current !== null;
    if (returning) {
      returningRef.current = { drag, animation: null };
      setFloatingCard((current) => current ? { ...current, returning: true } : null);
    } else {
      drag.element.classList.remove("hand-card-dragging");
      setFloatingCard(null);
    }
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
      if (cancelled) {
        reorderHand(reconcileHandOrder(orderRef.current, drag.originalOrder));
      }
    }
  };
  const finishDragRef = useRef(finishDrag);
  finishDragRef.current = finishDrag;

  const startReturn = () => {
    const returning = returningRef.current;
    if (!returning) return;
    const floating = floatingCardRef.current;
    if (reducedMotion || !floating || typeof floating.animate !== "function" ||
      !returning.drag.element.isConnected) {
      finishReturn();
      return;
    }
    if (returning.animation) return;
    const rect = returning.drag.element.getBoundingClientRect();
    const fromX = returning.drag.x - returning.drag.grabOffset;
    const fromY = returning.drag.y - returning.drag.grabOffsetY;
    floating.style.setProperty("--hand-drag-tilt", "0deg");
    const animation = floating.animate([
      { transform: `translate(${fromX}px, ${fromY}px)` },
      { transform: `translate(${rect.left}px, ${rect.top}px)` },
    ], {
      duration: handReturnDuration(Math.hypot(rect.left - fromX, rect.top - fromY)),
      easing: HAND_MOTION_EASING,
      fill: "forwards",
    });
    returning.animation = animation;
    const completeReturn = () => {
      if (returningRef.current === returning) finishReturnRef.current();
    };
    void animation.finished.then(completeReturn, completeReturn);
  };

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
    const arena = handRef.current?.closest(".board");
    if (!arena) return false;
    const target = document.elementFromPoint(drag.x, drag.y);
    return handPlayDropTargetAllowed(target, arena);
  };

  const positionDraggedCard = () => {
    const drag = dragRef.current;
    if (!drag?.started) return;
    drag.element.classList.add("hand-card-dragging");
    const floating = floatingCardRef.current;
    if (floating) {
      floating.style.transform = `translate(${drag.x - drag.grabOffset}px, ${drag.y - drag.grabOffsetY}px)`;
      floating.style.setProperty("--hand-drag-tilt", `${reducedMotion ? 0 : drag.tilt}deg`);
    }
    setPlayOnRelease(canReleaseToPlay(drag));
  };

  useLayoutEffect(() => {
    orderRef.current = order;
    if (!enabled || previousIdsKeyRef.current !== idsKey) {
      finishDragRef.current(true);
    }
    previousIdsKeyRef.current = idsKey;
    const positions = positionsBeforeReorderRef.current;
    const hand = handRef.current;
    if (positions && hand) {
      positionsBeforeReorderRef.current = null;
      animateHandReorder(hand, positions, reorderAnimationsRef.current,
        dragRef.current?.instanceId ?? returningRef.current?.drag.instanceId ?? null, reducedMotion);
    } else if (reducedMotion) {
      cancelHandReorderAnimations(reorderAnimationsRef.current);
    }
    positionDraggedCard();
    startReturn();
  });

  useEffect(() => {
    // Keep departed slots for undo; the rendered order filters absent cards.
    setPreferredOrder((current) => rememberHandOrder(orderRef.current, current));
  }, [idsKey]);

  useEffect(() => {
    const reorderAnimations = reorderAnimationsRef.current;
    const cancel = () => finishDragRef.current(true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      const drag = dragRef.current;
      if (drag) {
        cancelAnimationFrame(drag.frame);
        drag.element.classList.remove("hand-card-dragging");
      }
      const returning = returningRef.current;
      returningRef.current = null;
      returning?.animation?.cancel();
      returning?.drag.element.classList.remove("hand-card-dragging");
      cancelHandReorderAnimations(reorderAnimations);
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
    drag.tilt = handDragTilt(drag.tilt, drag.x - drag.previousX, elapsed);
    drag.previousX = drag.x;
    if (dragLocation(drag) !== "hand") {
      positionDraggedCard();
      drag.frame = requestAnimationFrame(tick);
      return;
    }
    hand.scrollLeft += handDragScrollSpeed(drag.x, bounds.left, bounds.right) * elapsed / 1000;
    // Read all slot geometry before moving the dragged card.
    const center = drag.x - drag.grabOffset + drag.element.offsetWidth / 2;
    const cards = [...hand.querySelectorAll<HTMLElement>("[data-hand-instance-id]")];
    const others = cards.filter((element) => element !== drag.element);
    const targetIndex = others.filter((element) => {
      return center > handCardSlotLeft(hand, element, bounds.left) + element.offsetWidth / 2;
    }).length;
    const visibleOrder = cards.map((element) => Number(element.dataset.handInstanceId));
    const currentIndex = visibleOrder.indexOf(drag.instanceId);
    if (currentIndex !== targetIndex) {
      // Staged/hidden hand cards retain their slots in the full local order.
      const next = moveVisibleHandCard(orderRef.current, visibleOrder, drag.instanceId, targetIndex);
      reorderHand(next);
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
        finishReturn();
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
          handTop: Math.max(
            event.currentTarget.getBoundingClientRect().top,
            handCardSlotTop(event.currentTarget, element),
          ),
          started: false,
          originalOrder: orderRef.current,
          frame: 0,
          lastFrameTime: 0,
          previousX: event.clientX,
          tilt: 0,
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
          reorderAnimationsRef.current.get(drag.element)?.cancel();
          reorderAnimationsRef.current.delete(drag.element);
          const rect = drag.element.getBoundingClientRect();
          setFloatingCard({ instanceId: drag.instanceId, width: rect.width, height: rect.height, returning: false });
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
        finishDrag(!inHand, !play);
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
          finishDrag(true, true);
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
        finishReturn();
        reorderHand(moveVisibleHandCard(orderRef.current, visibleOrder, id, targetIndex));
        requestAnimationFrame(() => element.scrollIntoView({ block: "nearest", inline: "nearest" }));
      },
    },
  };
}
