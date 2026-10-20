import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameIntent, GameView } from "@fyendal/shared";
import type { StandingOrders, StandingOrderUpdate } from "../storage.js";
import {
  currentStandingOrderQuestion,
  fenceStandingOrderAnswer,
  INITIAL_STANDING_ORDER_FENCE,
  standingOrderAnswer,
  standingOrderCardModels,
  suspendStandingOrder,
  type ObservedStandingOrderQuestion,
  type StandingOrderCardModel,
  type StandingOrderKind,
} from "./standingOrders.js";

export type { StandingOrderUpdate } from "../storage.js";

export interface StandingOrderBoard {
  cards: ReadonlyMap<string, StandingOrderCardModel>;
  onSetOrder: (key: string, update: StandingOrderUpdate) => void;
}

interface ObservedQuestions {
  gameId: string | null;
  questions: Map<string, ObservedStandingOrderQuestion[]>;
}

const NO_QUESTIONS: ObservedQuestions = { gameId: null, questions: new Map() };

/** Answers the viewer's repeating questions from their standing orders and
 * tracks what the chips must show. Sending is fenced per room version and
 * only against a live, connected, non-spectating, non-replay view. */
export function useStandingOrders({
  view,
  roomVersion,
  viewerSeat,
  enabled,
  orders,
  legal,
  sendIntent,
  updateStandingOrder,
}: {
  /** Authoritative live view, never an optimistic projection. */
  view: GameView | null;
  roomVersion: number | null;
  viewerSeat: number | null;
  /** Live, connected, seated, not replaying, no bot fallback, no command pending. */
  enabled: boolean;
  orders: StandingOrders;
  legal: readonly GameIntent[];
  sendIntent: (intent: GameIntent) => boolean;
  updateStandingOrder: (key: string, update: StandingOrderUpdate) => void;
}): StandingOrderBoard & {
  /** The top stack layer was passed by a standing order and still waits. */
  autoPassedTopLayer: boolean;
  /** Hold the latest automatic answer after an undo so the viewer can act. */
  onUndo: () => void;
} {
  const fenceRef = useRef(INITIAL_STANDING_ORDER_FENCE);
  const lastFiredRef = useRef<{ key: string; kind: StandingOrderKind } | null>(null);
  const [observed, setObserved] = useState<ObservedQuestions>(NO_QUESTIONS);
  const [autoPassed, setAutoPassed] = useState<{ instanceId: number } | null>(null);

  const question = useMemo(
    () => view && viewerSeat !== null ? currentStandingOrderQuestion(view, viewerSeat) : null,
    [view, viewerSeat],
  );
  const gameId = view?.gameId ?? null;

  // Remember each question this game so its card keeps a chip row between
  // occurrences; a set order keeps the row in later games through settings.
  useEffect(() => {
    if (!question) return;
    setObserved((current) => {
      const questions: Map<string, ObservedStandingOrderQuestion[]> = current.gameId === gameId
        ? current.questions
        : new Map();
      const seen = questions.get(question.key) ?? [];
      if (seen.some((entry) => entry.kind === question.kind)) {
        return current.gameId === gameId ? current : { gameId, questions };
      }
      const next = new Map(questions);
      next.set(question.key, [
        ...seen,
        { kind: question.kind, label: question.label, fallback: question.fallback },
      ]);
      return { gameId, questions: next };
    });
  }, [gameId, question]);

  useEffect(() => {
    if (!view || viewerSeat === null) return;
    const answer = enabled ? standingOrderAnswer(view, viewerSeat, orders, legal) : null;
    const result = fenceStandingOrderAnswer(fenceRef.current, {
      question,
      answer,
      roomVersion,
      enabled,
    });
    fenceRef.current = result.state;
    if (!result.send) return;
    if (!sendIntent(result.send.intent)) {
      // The socket was not open; a later version may retry.
      fenceRef.current = { ...result.state, sentVersion: null };
      return;
    }
    const { key, kind, card } = result.send.question;
    lastFiredRef.current = { key, kind };
    if (kind === "priority-window") setAutoPassed({ instanceId: card.instanceId });
  }, [enabled, legal, orders, question, roomVersion, sendIntent, view, viewerSeat]);

  const topInstanceId = view?.stack[0]?.card?.instanceId ?? null;
  useEffect(() => {
    if (autoPassed && topInstanceId !== autoPassed.instanceId) setAutoPassed(null);
  }, [autoPassed, topInstanceId]);

  const cards = useMemo(
    () => view && viewerSeat !== null
      ? standingOrderCardModels(view, viewerSeat, orders, observed.gameId === gameId ? observed.questions : new Map())
      : new Map<string, StandingOrderCardModel>(),
    [gameId, observed, orders, view, viewerSeat],
  );

  const onUndo = useCallback(() => {
    fenceRef.current = suspendStandingOrder(fenceRef.current, lastFiredRef.current);
  }, []);

  return {
    cards,
    onSetOrder: updateStandingOrder,
    autoPassedTopLayer: autoPassed !== null && topInstanceId === autoPassed.instanceId,
    onUndo,
  };
}
