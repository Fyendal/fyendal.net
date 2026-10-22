import { useMemo } from "react";
import type { GameView } from "@fyendal/shared";
import type { StandingOrders, StandingOrderUpdate } from "../storage.js";
import { standingOrderCardModels, type StandingOrderCardModel } from "./standingOrders.js";

export type { StandingOrderUpdate } from "../storage.js";

export interface StandingOrderBoard {
  cards: ReadonlyMap<string, StandingOrderCardModel>;
  onSetOrder: (key: string, update: StandingOrderUpdate) => void;
}

/** Derived from the view alone: the server answers set orders before the client sees them. */
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
  const cards = useMemo(
    () => view && viewerSeat !== null
      ? standingOrderCardModels(view, viewerSeat, orders)
      : new Map<string, StandingOrderCardModel>(),
    [orders, view, viewerSeat],
  );
  return { cards, onSetOrder: updateStandingOrder };
}
