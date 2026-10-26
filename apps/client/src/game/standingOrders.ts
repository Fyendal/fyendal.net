import type {
  CardView,
  GameMessage,
  GameView,
  TurnTriggerChoiceOption,
  TurnTriggerEvent,
} from "@fyendal/shared";
import { cardData, functionalKeyOf } from "@fyendal/cards/client";
import { heroCard } from "./board/heroCard.js";
import type { StandingOrders } from "../storage.js";

export interface StandingOrderRow {
  hook: string;
  /** When the printed trigger fires, so "Destroy Fealty" reads as the end-phase
   * trigger rather than the token's instant ability. */
  timing: TurnTriggerEvent;
  label: GameMessage | null;
  fallback: string;
  options: readonly TurnTriggerChoiceOption[];
  /** `null` asks. */
  order: string | null;
}

export interface StandingOrderCardModel {
  key: string;
  /** A printing for naming the card in copy. */
  cardId: string;
  rows: StandingOrderRow[];
}

export function standingOrderKey(card: Pick<CardView, "cardId">): string | null {
  const data = cardData[card.cardId];
  return data ? functionalKeyOf(data) : null;
}

/** Arena permanents of one seat: hero, weapons, equipment, and board cards. */
export function arenaCards(view: GameView, seat: number): CardView[] {
  const player = view.players[seat];
  if (!player) return [];
  return [
    heroCard(player),
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is CardView => card !== undefined),
    ...player.board,
  ];
}

/** The server answers by hook, so the first declaration of one wins. */
export function standingOrderRows(card: CardView, key: string, orders: StandingOrders): StandingOrderRow[] {
  const stored = Object.hasOwn(orders, key) ? orders[key]! : {};
  const rows: StandingOrderRow[] = [];
  for (const trigger of card.turnTriggers ?? []) {
    for (const choice of trigger.choices ?? []) {
      if (rows.some((row) => row.hook === choice.hook)) continue;
      const value = Object.hasOwn(stored, choice.hook) ? stored[choice.hook] : undefined;
      rows.push({
        hook: choice.hook,
        timing: trigger.event,
        label: trigger.labelMessage ?? null,
        fallback: trigger.label,
        options: choice.options,
        order: choice.options.some((option) => option.value === value) ? value! : null,
      });
    }
  }
  return rows;
}

export function standingOrderCardModels(
  view: GameView,
  viewerSeat: number,
  orders: StandingOrders,
): Map<string, StandingOrderCardModel> {
  const models = new Map<string, StandingOrderCardModel>();
  for (const card of arenaCards(view, viewerSeat)) {
    const key = standingOrderKey(card);
    if (!key || models.has(key)) continue;
    const rows = standingOrderRows(card, key, orders);
    if (rows.length === 0) continue;
    models.set(key, { key, cardId: card.cardId, rows });
  }
  return models;
}

export function activeOrderMessages(rows: readonly StandingOrderRow[]): GameMessage[] {
  return rows.flatMap((row) => row.options.find((option) => option.value === row.order)?.message ?? []);
}
