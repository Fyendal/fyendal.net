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
import type { MotionPreference } from "../../storage.js";
import { classifyViewUpdate } from "./classifyViewUpdate.js";
import { detectGameMotionEvents } from "./detectMotionEvents.js";
import {
  completeMotionBatch,
  EMPTY_MOTION_BATCH_QUEUE,
  enqueueMotionBatch,
  type MotionBatchQueue,
} from "./motionBatchQueue.js";
import {
  measureMotionAnchors,
  reducedMotionBatch,
  resolveMotionBatch,
  type GameMotionBatch,
  type MotionAnchorSnapshot,
} from "./motionGeometry.js";
import { useMotionPreference } from "./useMotionPreference.js";

const EMPTY_ANCHORS: MotionAnchorSnapshot = {
  cards: new Map(),
  zones: new Map(),
};

type MaskedElementsByBatch = Map<number, Map<string, HTMLElement>>;

function elementIsMasked(
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

export function useGameMotion({
  rootRef,
  view,
  viewUpdate,
  motionPreference,
}: {
  rootRef: RefObject<HTMLElement | null>;
  view: GameView | null;
  viewUpdate: ViewUpdate;
  motionPreference: MotionPreference;
}): {
  batch: GameMotionBatch | null;
  arriveFlight: (batchId: number, destinationPresentationKey?: string) => void;
  completeBatch: (batchId: number) => void;
} {
  const reduceMotion = useMotionPreference(motionPreference);
  const [batch, setBatch] = useState<GameMotionBatch | null>(null);
  const previousViewRef = useRef<GameView | null>(null);
  const previousAnchorsRef = useRef<MotionAnchorSnapshot>(EMPTY_ANCHORS);
  const processedSequenceRef = useRef<number | null>(null);
  const reduceMotionRef = useRef(reduceMotion);
  const batchQueueRef = useRef<MotionBatchQueue>(EMPTY_MOTION_BATCH_QUEUE);
  const maskedElementsRef = useRef<MaskedElementsByBatch>(new Map());

  const releaseBatchMasks = useCallback((batchId: number) => {
    const batchMasks = maskedElementsRef.current.get(batchId);
    if (!batchMasks) return;
    maskedElementsRef.current.delete(batchId);
    for (const element of batchMasks.values()) {
      if (!elementIsMasked(maskedElementsRef.current, element)) {
        element.classList.remove("game-motion-destination-hidden");
      }
    }
  }, []);

  const clearMaskedElements = useCallback(() => {
    const elements = new Set<HTMLElement>();
    for (const batchMasks of maskedElementsRef.current.values()) {
      for (const element of batchMasks.values()) elements.add(element);
    }
    maskedElementsRef.current.clear();
    for (const element of elements) {
      element.classList.remove("game-motion-destination-hidden");
    }
  }, []);

  const cancelMotionQueue = useCallback(() => {
    batchQueueRef.current = EMPTY_MOTION_BATCH_QUEUE;
    clearMaskedElements();
    setBatch(null);
  }, [clearMaskedElements]);

  const completeBatch = useCallback((batchId: number) => {
    if (batchQueueRef.current.active?.id !== batchId) return;
    releaseBatchMasks(batchId);
    const nextQueue = completeMotionBatch(batchQueueRef.current, batchId);
    batchQueueRef.current = nextQueue;
    setBatch(nextQueue.active);
  }, [releaseBatchMasks]);

  const arriveFlight = useCallback((
    batchId: number,
    destinationPresentationKey?: string,
  ) => {
    if (
      batchQueueRef.current.active?.id !== batchId
      || destinationPresentationKey === undefined
    ) return;
    const batchMasks = maskedElementsRef.current.get(batchId);
    if (!batchMasks) return;
    const element = batchMasks.get(destinationPresentationKey);
    if (!element) return;
    batchMasks.delete(destinationPresentationKey);
    if (batchMasks.size === 0) maskedElementsRef.current.delete(batchId);
    // Hand off from the overlay to the real destination on this flight's own
    // arrival. Waiting for a later staggered card is what caused the visible
    // empty-frame blink in pitch and combat-chain batches.
    if (!elementIsMasked(maskedElementsRef.current, element)) {
      element.classList.remove("game-motion-destination-hidden");
    }
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
      cancelMotionQueue();
      return;
    }

    // Read every current rect first. Class writes happen only after the batch
    // has been completely resolved, avoiding read/write layout interleaving.
    const measured = measureMotionAnchors(root);
    if (reduceMotionRef.current !== reduceMotion) {
      reduceMotionRef.current = reduceMotion;
      cancelMotionQueue();
    }
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
      if (nextBatch && reduceMotion) {
        nextBatch = reducedMotionBatch(nextBatch, measured.snapshot);
      }
    }

    if (!previousView || classification.kind !== "animate") {
      cancelMotionQueue();
    }
    if (nextBatch && nextBatch.flights.length > 0) {
      const batchMasks = new Map<string, HTMLElement>();
      for (const flight of nextBatch.flights) {
        const key = flight.destinationPresentationKey;
        if (!key) continue;
        const element = measured.cardElements.get(key);
        if (!element) continue;
        element.classList.add("game-motion-destination-hidden");
        batchMasks.set(key, element);
      }
      if (batchMasks.size > 0) maskedElementsRef.current.set(nextBatch.id, batchMasks);
    }
    if (nextBatch) {
      const previousActive = batchQueueRef.current.active;
      const enqueueResult = enqueueMotionBatch(batchQueueRef.current, nextBatch);
      for (const discardedBatchId of enqueueResult.discardedBatchIds) {
        releaseBatchMasks(discardedBatchId);
      }
      batchQueueRef.current = enqueueResult.queue;
      if (enqueueResult.queue.active !== previousActive) {
        setBatch(enqueueResult.queue.active);
      }
    }
    previousViewRef.current = view;
    previousAnchorsRef.current = measured.snapshot;
    processedSequenceRef.current = viewUpdate.sequence;
  });

  useEffect(() => {
    const settleAfterResize = () => {
      cancelMotionQueue();
      const root = rootRef.current;
      if (root) previousAnchorsRef.current = measureMotionAnchors(root).snapshot;
    };
    window.addEventListener("resize", settleAfterResize);
    return () => {
      window.removeEventListener("resize", settleAfterResize);
    };
  }, [cancelMotionQueue, rootRef]);

  return { batch, arriveFlight, completeBatch };
}
