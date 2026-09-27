import { useLayoutEffect, useRef } from "react";
import type { MotionPreference } from "../storage.js";
import { CardFace } from "./Card.js";
import { useMotionPreference } from "./motion/useMotionPreference.js";
import type { MotionRect } from "./motion/motionGeometry.js";
import { pitchFocusOrigin } from "./pitchFocusMotion.js";
import type { PitchFocusSource } from "./pitchFocusSource.js";

export function PitchFocus({ source, motionPreference, getStackFocusOrigin }: {
  source: PitchFocusSource;
  motionPreference: MotionPreference;
  getStackFocusOrigin: (instanceId: number) => MotionRect | undefined;
}) {
  const positionRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useMotionPreference(motionPreference);
  const { instanceId } = source.card;
  const { fromHand } = source;

  useLayoutEffect(() => {
    const focusPosition = positionRef.current;
    const table = focusPosition?.closest(".table");
    const decision = table?.querySelector<HTMLElement>(".decision-float-pitch");
    if (!focusPosition || !decision) return;
    const alignMobileFocus = () => {
      if (!window.matchMedia("(max-width: 700px)").matches) return;
      focusPosition.style.setProperty("--pitch-mobile-focus-top", `${decision.getBoundingClientRect().top + 12}px`);
    };
    alignMobileFocus();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(alignMobileFocus);
    observer?.observe(decision);
    const layoutObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(alignMobileFocus);
    if (table) layoutObserver?.observe(table, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", alignMobileFocus);
    return () => {
      observer?.disconnect();
      layoutObserver?.disconnect();
      window.removeEventListener("resize", alignMobileFocus);
      focusPosition.style.removeProperty("--pitch-mobile-focus-top");
    };
  }, [instanceId]);

  useLayoutEffect(() => {
    const focus = focusRef.current;
    const table = focus?.closest<HTMLElement>(".table");
    if (!focus || !table) return;
    // The enlarged copy has no motion key, so it cannot become its own origin.
    const candidates = [...table.querySelectorAll<HTMLElement>(
      `[data-card-instance-id="${instanceId}"][data-motion-card]`,
    )];
    const stackElement = candidates.find((element) => element.closest(".stack-float"));
    const sourceElement = (fromHand
      ? candidates.find((element) => element.closest("#player-hand"))
      : stackElement)
      ?? table.querySelector<HTMLElement>(`[data-card-stack-id="${instanceId}"]`)
      ?? candidates[0];
    const start = pitchFocusOrigin(
      fromHand,
      sourceElement?.getBoundingClientRect(),
      stackElement?.getBoundingClientRect(),
      getStackFocusOrigin(instanceId),
    );
    if (!start) return;
    const end = focus.getBoundingClientRect();
    const wasInert = sourceElement?.inert ?? false;
    let animation: Animation | undefined;
    if (fromHand && sourceElement) {
      sourceElement.classList.add("pitch-focus-source-hidden");
      sourceElement.inert = true;
    }
    if (!reducedMotion && start.width > 0 && start.height > 0 && end.width > 0 &&
      end.height > 0 && typeof focus.animate === "function") {
      animation = focus.animate([
        { transform: `translate(${start.left - end.left}px, ${start.top - end.top}px) scale(${start.width / end.width}, ${start.height / end.height})` },
        { transform: "translate(0, 0) scale(1)" },
      ], { duration: 360, easing: "cubic-bezier(.2, .82, .2, 1)" });
    }
    return () => {
      animation?.cancel();
      if (fromHand && sourceElement) {
        sourceElement.classList.remove("pitch-focus-source-hidden");
        sourceElement.inert = wasInert;
      }
    };
  }, [instanceId, source.card.cardId, fromHand, reducedMotion, getStackFocusOrigin]);

  return (
    <div className="pitch-focus">
      <div ref={positionRef} className="pitch-focus-position" data-motion-focus-source={instanceId}>
        <div className="pitch-focus-card" ref={focusRef}>
          <CardFace card={source.card} size="preview" showOverlays={false} showTapped={false} />
        </div>
      </div>
    </div>
  );
}
