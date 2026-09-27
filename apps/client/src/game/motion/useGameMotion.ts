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
import { transitionMotionEvents } from "./transitionMotionEvents.js";
import { extractGamePresentations } from "./extractPresentations.js";
import { focusHandReflows } from "./handReflow.js";
import {
  completeMotionBatch,
  EMPTY_MOTION_BATCH_QUEUE,
  enqueueMotionBatch,
  motionQueueBlocksTurnStartUi,
  type MotionBatchQueue,
} from "./motionBatchQueue.js";
import {
  measureMotionAnchors,
  reducedMotionBatch,
  resolveMotionBatches,
  type GameMotionBatch,
  type MotionAnchorSnapshot,
  type MotionRect,
} from "./motionGeometry.js";
import { useMotionPreference } from "./useMotionPreference.js";
import { rememberStackFocusOrigins } from "../pitchFocusMotion.js";
import {
  activateMotionDestinationMasks,
  motionDestinationsRequiringEarlyMask,
  motionDestinationIsMasked,
  refreshMotionDestinationMasks,
  revealMotionDestination,
  type MaskedElementsByBatch,
} from "./motionDestinationMask.js";

const EMPTY_ANCHORS: MotionAnchorSnapshot = {
  cards: new Map(),
  zones: new Map(),
};

export function useGameMotion({
  rootRef,
  view,
  viewUpdate,
  motionPreference,
  presentationKey = "authoritative",
  predictsSemanticTransition = false,
}: {
  rootRef: RefObject<HTMLElement | null>;
  view: GameView | null;
  viewUpdate: ViewUpdate;
  motionPreference: MotionPreference;
  presentationKey?: string;
  predictsSemanticTransition?: boolean;
}): {
  batch: GameMotionBatch | null;
  turnStartUiReady: boolean;
  arriveFlight: (batchId: string, destinationPresentationKey?: string) => void;
  completeBatch: (batchId: string) => void;
  getStackFocusOrigin: (instanceId: number) => MotionRect | undefined;
} {
  const reduceMotion = useMotionPreference(motionPreference);
  const [batch, setBatch] = useState<GameMotionBatch | null>(null);
  const [turnStartUiReady, setTurnStartUiReady] = useState(true);
  const previousViewRef = useRef<GameView | null>(null);
  const layoutMotionSequenceRef = useRef(0);
  const previousAnchorsRef = useRef<MotionAnchorSnapshot>(EMPTY_ANCHORS);
  const stackFocusOriginsRef = useRef<ReadonlyMap<number, MotionRect>>(new Map());
  const processedUpdateKeyRef = useRef<string | null>(null);
  const previousViewUpdateSequenceRef = useRef<number | null>(null);
  const previousViewPredictedSemanticTransitionRef = useRef(false);
  const reduceMotionRef = useRef(reduceMotion);
  const batchQueueRef = useRef<MotionBatchQueue>(EMPTY_MOTION_BATCH_QUEUE);
  const maskedElementsRef = useRef<MaskedElementsByBatch>(new Map());
  const gameId = view?.gameId;
  const getStackFocusOrigin = useCallback((instanceId: number) => {
    if (previousViewRef.current?.gameId !== gameId) return undefined;
    return stackFocusOriginsRef.current.get(instanceId);
  }, [gameId]);
  const refreshStackFocusOrigins = useCallback((currentView: GameView, anchors: MotionAnchorSnapshot) => {
    stackFocusOriginsRef.current = rememberStackFocusOrigins(
      previousViewRef.current?.gameId === currentView.gameId ? stackFocusOriginsRef.current : new Map(),
      anchors,
      currentView.stack.flatMap((layer) => layer.card ? [layer.card.instanceId] : []),
      currentView.pendingDecision?.resourcePayment?.sourceInstanceId,
    );
  }, []);

  const activateBatchMasks = useCallback((
    candidate: GameMotionBatch | null,
    measuredElements?: ReadonlyMap<string, HTMLElement>,
  ) => {
    if (!candidate) return;
    const arrivals = [...candidate.flights, ...candidate.connectors];
    if (!arrivals.some((arrival) => arrival.destinationPresentationKey !== undefined)) return;
    const elements = measuredElements
      ?? (rootRef.current ? measureMotionAnchors(rootRef.current).cardElements : null);
    if (!elements) return;
    activateMotionDestinationMasks(
      candidate.id,
      arrivals,
      elements,
      maskedElementsRef.current,
    );
  }, [rootRef]);

  const releaseBatchMasks = useCallback((batchId: string) => {
    const batchMasks = maskedElementsRef.current.get(batchId);
    if (!batchMasks) return;
    maskedElementsRef.current.delete(batchId);
    for (const element of batchMasks.values()) {
      if (!motionDestinationIsMasked(maskedElementsRef.current, element)) {
        revealMotionDestination(element);
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
      revealMotionDestination(element);
    }
  }, []);

  const cancelMotionQueue = useCallback(() => {
    batchQueueRef.current = EMPTY_MOTION_BATCH_QUEUE;
    clearMaskedElements();
    setTurnStartUiReady(true);
    setBatch(null);
  }, [clearMaskedElements]);

  const completeBatch = useCallback((batchId: string) => {
    if (batchQueueRef.current.active?.id !== batchId) return;
    releaseBatchMasks(batchId);
    const nextQueue = completeMotionBatch(batchQueueRef.current, batchId);
    batchQueueRef.current = nextQueue;
    activateBatchMasks(nextQueue.active);
    setTurnStartUiReady(!motionQueueBlocksTurnStartUi(nextQueue));
    setBatch(nextQueue.active);
  }, [activateBatchMasks, releaseBatchMasks]);

  const arriveFlight = useCallback((
    batchId: string,
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
    if (!motionDestinationIsMasked(maskedElementsRef.current, element)) {
      revealMotionDestination(element);
    }
  }, []);

  // Run after every commit: view-independent layout changes (hand collapse,
  // float dragging, rail collapse) refresh the next authoritative baseline.
  // Entering/leaving pitch focus also closes/opens a visible hand slot.
  useLayoutEffect(() => {
    const updateKey = `${viewUpdate.sequence}:${presentationKey}`;
    const root = rootRef.current;
    if (!root || !view) {
      previousViewRef.current = view;
      previousAnchorsRef.current = EMPTY_ANCHORS;
      stackFocusOriginsRef.current = new Map();
      processedUpdateKeyRef.current = updateKey;
      previousViewUpdateSequenceRef.current = viewUpdate.sequence;
      previousViewPredictedSemanticTransitionRef.current = predictsSemanticTransition;
      cancelMotionQueue();
      return;
    }

    // Read every current rect first. Class writes happen only after the batch
    // has been completely resolved, avoiding read/write layout interleaving.
    const measured = measureMotionAnchors(root);
    refreshStackFocusOrigins(view, measured.snapshot);
    refreshMotionDestinationMasks(maskedElementsRef.current, measured.cardElements);
    if (reduceMotionRef.current !== reduceMotion) {
      reduceMotionRef.current = reduceMotion;
      cancelMotionQueue();
    }
    const previousView = previousViewRef.current;
    const previousFocusIds = [...(previousAnchorsRef.current.focusSources?.keys() ?? [])];
    const currentFocusIds = [...(measured.snapshot.focusSources?.keys() ?? [])];
    const focusChanged = previousFocusIds.length !== currentFocusIds.length ||
      previousFocusIds.some((id) => !currentFocusIds.includes(id));
    const focusReflows = previousView && focusChanged ? focusHandReflows(
      extractGamePresentations(previousView), extractGamePresentations(view),
      previousFocusIds, currentFocusIds,
    ) : [];
    const isFocusLayoutUpdate = processedUpdateKeyRef.current === updateKey && focusReflows.length > 0;
    if (processedUpdateKeyRef.current === updateKey && !isFocusLayoutUpdate) {
      previousViewRef.current = view;
      previousAnchorsRef.current = measured.snapshot;
      return;
    }

    const isLocalPresentationUpdate =
      previousViewUpdateSequenceRef.current === viewUpdate.sequence;
    const motionUpdate: ViewUpdate = isLocalPresentationUpdate
      ? { ...viewUpdate, transition: "forward", gameTransition: undefined }
      : viewUpdate;
    const classification = classifyViewUpdate(previousView, view, motionUpdate);
    let nextBatches: GameMotionBatch[] = [];
    if (previousView && classification.kind === "animate") {
      const events = motionUpdate.gameTransition
        ? transitionMotionEvents(
            previousView,
            view,
            motionUpdate.gameTransition,
            classification.direction,
            {
              sourceIncludesPredictedTransition:
                previousViewPredictedSemanticTransitionRef.current,
            },
          )
        : detectGameMotionEvents(previousView, view);
      const eventKeys = new Set(events.filter((event) => event.kind === "reflow")
        .map((event) => event.destinationPresentationKey));
      events.push(...focusReflows.filter((event) => !eventKeys.has(event.destinationPresentationKey)));
      nextBatches = resolveMotionBatches(
        events,
        previousAnchorsRef.current,
        measured.snapshot,
        isFocusLayoutUpdate ? `${updateKey}:layout:${++layoutMotionSequenceRef.current}` : updateKey,
      );
      if (reduceMotion) {
        nextBatches = nextBatches.flatMap((candidate) => {
          const reduced = reducedMotionBatch(candidate);
          return reduced ? [reduced] : [];
        });
      }
    }

    if (!previousView || classification.kind !== "animate") {
      cancelMotionQueue();
    }
    for (const nextBatch of nextBatches) {
      activateMotionDestinationMasks(
        nextBatch.id,
        motionDestinationsRequiringEarlyMask([
          ...nextBatch.flights,
          ...nextBatch.connectors,
        ]),
        measured.cardElements,
        maskedElementsRef.current,
      );
    }
    if (nextBatches.length > 0) {
      const previousActive = batchQueueRef.current.active;
      let nextQueue = batchQueueRef.current;
      for (const nextBatch of nextBatches) {
        const enqueueResult = enqueueMotionBatch(nextQueue, nextBatch);
        nextQueue = enqueueResult.queue;
        for (const discardedBatchId of enqueueResult.discardedBatchIds) {
          releaseBatchMasks(discardedBatchId);
        }
      }
      batchQueueRef.current = nextQueue;
      setTurnStartUiReady(!motionQueueBlocksTurnStartUi(nextQueue));
      if (nextQueue.active !== previousActive) {
        activateBatchMasks(nextQueue.active, measured.cardElements);
        setBatch(nextQueue.active);
      }
    }
    previousViewRef.current = view;
    previousAnchorsRef.current = measured.snapshot;
    processedUpdateKeyRef.current = updateKey;
    previousViewUpdateSequenceRef.current = viewUpdate.sequence;
    previousViewPredictedSemanticTransitionRef.current = predictsSemanticTransition;
  });

  useEffect(() => {
    const settleAfterResize = () => {
      cancelMotionQueue();
      const root = rootRef.current;
      if (root) {
        const anchors = measureMotionAnchors(root).snapshot;
        previousAnchorsRef.current = anchors;
        if (previousViewRef.current) refreshStackFocusOrigins(previousViewRef.current, anchors);
      }
    };
    window.addEventListener("resize", settleAfterResize);
    return () => {
      window.removeEventListener("resize", settleAfterResize);
    };
  }, [cancelMotionQueue, rootRef, refreshStackFocusOrigins]);

  return {
    batch,
    turnStartUiReady,
    arriveFlight,
    completeBatch,
    getStackFocusOrigin,
  };
}
