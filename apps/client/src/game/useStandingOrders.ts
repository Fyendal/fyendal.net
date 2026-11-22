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
  seats,
  orders,
  updateStandingOrder,
}: {
  /** Authoritative live view, never an optimistic projection. */
  view: GameView | null;
  /** Seats whose permanents take orders; solo controls both. */
  seats: readonly number[];
  orders: StandingOrders;
  updateStandingOrder: (key: string, update: StandingOrderUpdate) => void;
}): StandingOrderBoard {
  const seatsKey = seats.join(",");
  const cards = useMemo(() => {
    const models = new Map<string, StandingOrderCardModel>();
    if (!view) return models;
    for (const seat of seatsKey === "" ? [] : seatsKey.split(",").map(Number)) {
      for (const [key, model] of standingOrderCardModels(view, seat, orders)) {
        if (!models.has(key)) models.set(key, model);
      }
    }
    return models;
  }, [orders, view, seatsKey]);
  return { cards, onSetOrder: updateStandingOrder };
}
