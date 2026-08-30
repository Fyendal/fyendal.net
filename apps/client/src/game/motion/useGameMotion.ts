import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { GameView } from "@fyendal/shared";
import type { ViewUpdate } from "../../store/types.js";
import { classifyViewUpdate } from "./classifyViewUpdate.js";
import { detectGameMotionEvents } from "./detectMotionEvents.js";
import {
  measureMotionAnchors,
  reducedMotionBatch,
  resolveMotionBatch,
  type GameMotionBatch,
  type MotionAnchorSnapshot,
} from "./motionGeometry.js";

const EMPTY_ANCHORS: MotionAnchorSnapshot = {
  cards: new Map(),
  zones: new Map(),
};

function systemPrefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useGameMotion({
  rootRef,
  view,
  viewUpdate,
}: {
  rootRef: RefObject<HTMLElement | null>;
  view: GameView | null;
  viewUpdate: ViewUpdate;
}): {
  batch: GameMotionBatch | null;
  arriveFlight: (batchId: number, destinationPresentationKey?: string) => void;
  completeBatch: (batchId: number) => void;
} {
  const [batch, setBatch] = useState<GameMotionBatch | null>(null);
  const previousViewRef = useRef<GameView | null>(null);
  const previousAnchorsRef = useRef<MotionAnchorSnapshot>(EMPTY_ANCHORS);
  const processedSequenceRef = useRef<number | null>(null);
  const activeBatchIdRef = useRef<number | null>(null);
  const maskedElementsRef = useRef(new Map<string, HTMLElement>());

  const clearMaskedElements = useCallback(() => {
    for (const element of maskedElementsRef.current.values()) {
      element.classList.remove("game-motion-destination-hidden");
    }
    maskedElementsRef.current.clear();
  }, []);

  const cancelActiveBatch = useCallback(() => {
    activeBatchIdRef.current = null;
    clearMaskedElements();
    setBatch(null);
  }, [clearMaskedElements]);

  const completeBatch = useCallback((batchId: number) => {
    if (activeBatchIdRef.current !== batchId) return;
    cancelActiveBatch();
  }, [cancelActiveBatch]);

  const arriveFlight = useCallback((
    batchId: number,
    destinationPresentationKey?: string,
  ) => {
    if (
      activeBatchIdRef.current !== batchId
      || destinationPresentationKey === undefined
    ) return;
    const element = maskedElementsRef.current.get(destinationPresentationKey);
    if (!element) return;
    // Hand off from the overlay to the real destination on this flight's own
    // arrival. Waiting for a later staggered card is what caused the visible
    // empty-frame blink in pitch and combat-chain batches.
    element.classList.remove("game-motion-destination-hidden");
    maskedElementsRef.current.delete(destinationPresentationKey);
  }, []);

  // Run after every commit: view-independent layout changes (hand collapse,
  // float dragging, rail collapse) must refresh the baseline for the next
  // authoritative update without becoming motion events themselves.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !view) {
      previousViewRef.current = view;
      previousAnchorsRef.current = EMPTY_ANCHORS;
      processedSequenceRef.current = viewUpdate.sequence;
      cancelActiveBatch();
      return;
    }

    // Read every current rect first. Class writes happen only after the batch
    // has been completely resolved, avoiding read/write layout interleaving.
    const measured = measureMotionAnchors(root);
    if (processedSequenceRef.current === viewUpdate.sequence) {
      previousViewRef.current = view;
      previousAnchorsRef.current = measured.snapshot;
      return;
    }

    const previousView = previousViewRef.current;
    const classification = classifyViewUpdate(previousView, view, viewUpdate);
    let nextBatch: GameMotionBatch | null = null;
    if (previousView && classification.kind === "animate") {
      const events = detectGameMotionEvents(previousView, view);
      nextBatch = resolveMotionBatch(
        events,
        previousAnchorsRef.current,
        measured.snapshot,
        viewUpdate.sequence,
      );
      if (nextBatch && systemPrefersReducedMotion()) {
        nextBatch = reducedMotionBatch(nextBatch, measured.snapshot);
      }
    }

    clearMaskedElements();
    activeBatchIdRef.current = nextBatch?.id ?? null;
    if (nextBatch && nextBatch.flights.length > 0) {
      for (const flight of nextBatch.flights) {
        const key = flight.destinationPresentationKey;
        if (!key) continue;
        const element = measured.cardElements.get(key);
        if (!element) continue;
        element.classList.add("game-motion-destination-hidden");
        maskedElementsRef.current.set(key, element);
      }
    }
    setBatch(nextBatch);
    previousViewRef.current = view;
    previousAnchorsRef.current = measured.snapshot;
    processedSequenceRef.current = viewUpdate.sequence;
  });

  useEffect(() => {
    const settleAfterResize = () => {
      cancelActiveBatch();
      const root = rootRef.current;
      if (root) previousAnchorsRef.current = measureMotionAnchors(root).snapshot;
    };
    window.addEventListener("resize", settleAfterResize);
    return () => {
      window.removeEventListener("resize", settleAfterResize);
    };
  }, [cancelActiveBatch, rootRef]);

  return { batch, arriveFlight, completeBatch };
}
