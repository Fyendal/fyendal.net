import { useLayoutEffect, useRef, useState } from "react";
import type { MotionPreference } from "../storage.js";
import { CardFace } from "./Card.js";
import { useMotionPreference } from "./motion/useMotionPreference.js";
import { measureMotionAnchors } from "./motion/motionGeometry.js";
import type { PitchFocusSource } from "./pitchFocusSource.js";

export function PitchFocus({ source, motionPreference }: {
  source: PitchFocusSource;
  motionPreference: MotionPreference;
}) {
  const focusRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useMotionPreference(motionPreference);
  const [connector, setConnector] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const { instanceId } = source.card;
  const { fromHand } = source;

  useLayoutEffect(() => {
    const focus = focusRef.current;
    const board = focus?.closest<HTMLElement>(".board");
    if (!focus || !board) return;
    const table = board.closest<HTMLElement>(".table") ?? board;
    const anchors = measureMotionAnchors(table);
    const sourceElement = table.querySelector<HTMLElement>(`[data-card-stack-id="${instanceId}"]`)
      ?? [...anchors.cardElements].find(([key, element]) =>
        !key.includes(":opaque") && key.endsWith(`:${instanceId}`) &&
        element.dataset.cardid === source.card.cardId,
      )?.[1];
    if (!sourceElement) return;
    const start = sourceElement.getBoundingClientRect();
    const end = focus.getBoundingClientRect();
    const wasInert = sourceElement.inert;
    let animation: Animation | undefined;
    if (fromHand) {
      sourceElement.classList.add("pitch-focus-source-hidden");
      sourceElement.inert = true;
      if (!reducedMotion && start.width > 0 && start.height > 0 && end.width > 0 &&
        end.height > 0 && typeof focus.animate === "function") {
        animation = focus.animate([
          { transform: `translate(${start.left - end.left}px, ${start.top - end.top}px) scale(${start.width / end.width}, ${start.height / end.height})` },
          { transform: "translate(0, 0) scale(1)" },
        ], { duration: 360, easing: "cubic-bezier(.2, .82, .2, 1)" });
      }
      return () => {
        animation?.cancel();
        sourceElement.classList.remove("pitch-focus-source-hidden");
        sourceElement.inert = wasInert;
      };
    }
    const updateConnector = () => {
      const origin = board.getBoundingClientRect();
      const startRect = sourceElement.getBoundingClientRect();
      const endRect = focus.getBoundingClientRect();
      setConnector({
        x1: startRect.left + startRect.width / 2 - origin.left,
        y1: startRect.top + startRect.height / 2 - origin.top,
        x2: endRect.left + endRect.width / 2 - origin.left,
        y2: endRect.top + endRect.height / 2 - origin.top,
      });
    };
    updateConnector();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateConnector);
    observer?.observe(board);
    observer?.observe(sourceElement);
    observer?.observe(focus);
    window.addEventListener("resize", updateConnector);
    window.addEventListener("scroll", updateConnector, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateConnector);
      window.removeEventListener("scroll", updateConnector, true);
    };
  }, [instanceId, source.card.cardId, fromHand, reducedMotion]);

  return (
    <div className="pitch-focus">
      {!fromHand && connector ? (
        <svg className="pitch-focus-connector" aria-hidden="true">
          <line {...connector} />
          <circle cx={connector.x1} cy={connector.y1} r="4" />
        </svg>
      ) : null}
      <div className="pitch-focus-position" data-motion-focus-source={instanceId}>
        <div className="pitch-focus-card" ref={focusRef}>
          <CardFace card={source.card} size="preview" showOverlays={false} showTapped={false} />
        </div>
      </div>
    </div>
  );
}
