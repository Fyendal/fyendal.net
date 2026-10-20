import { useEffect, useMemo, useState } from "react";
import type { GameView } from "@fyendal/shared";
import type { StandingOrders, StandingOrderUpdate } from "../storage.js";
import {
  currentStandingOrderQuestion,
  standingOrderCardModels,
  type ObservedStandingOrderQuestion,
  type StandingOrderCardModel,
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

/** Remembers each question asked so a card keeps its chip row; the server
 * answers them (`apps/server/src/standingOrders.ts`). */
export function useStandingOrders({
  view,
  viewerSeat,
  orders,
  updateStandingOrder,
}: {
  /** Authoritative live view, never an optimistic projection. */
  view: GameView | null;
  viewerSeat: number | null;
  orders: StandingOrders;
  updateStandingOrder: (key: string, update: StandingOrderUpdate) => void;
}): StandingOrderBoard {
  const [observed, setObserved] = useState<ObservedQuestions>(NO_QUESTIONS);

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

  const cards = useMemo(
    () => view && viewerSeat !== null
      ? standingOrderCardModels(view, viewerSeat, orders, observed.gameId === gameId ? observed.questions : new Map())
      : new Map<string, StandingOrderCardModel>(),
    [gameId, observed, orders, view, viewerSeat],
  );

  return { cards, onSetOrder: updateStandingOrder };
}
