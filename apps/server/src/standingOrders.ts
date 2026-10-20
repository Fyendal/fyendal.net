import { cardData, functionalKeyOf } from "@fyendal/cards";
import { legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { CardView, GameIntent, GameView, SeatStandingOrders } from "@fyendal/shared";

/** Functional key of every arena permanent of both seats, by instance. */
function arenaKeys(view: GameView): Map<number, { key: string; seat: number }> {
  const keys = new Map<number, { key: string; seat: number }>();
  for (const player of view.players) {
    const add = (instanceId: number, cardId: string): void => {
      const data = cardData[cardId];
      if (data) keys.set(instanceId, { key: functionalKeyOf(data), seat: player.seat });
    };
    add(player.heroInstanceId, player.heroCardId);
    const cards: CardView[] = [
      ...player.weapons,
      ...Object.values(player.equipment).filter((card): card is CardView => card !== undefined),
      ...player.board,
    ];
    for (const card of cards) add(card.instanceId, card.cardId);
  }
  return keys;
}

/** The legal intent a standing order answers the seat's current question
 * with: a pass in a window opened by an arena permanent's trigger, or the
 * ordered yes/no on its optional trigger. A decided optional trigger of the
 * seat's own card also passes that card's windows. */
export function standingOrderIntent(
  state: GameState,
  seat: number,
  orders: SeatStandingOrders,
  code: string,
): GameIntent | null {
  const decision = state.pendingDecision;
  if (!decision || decision.player !== seat) return null;
  if (decision.kind !== "priority-window" && decision.kind !== "optional-effect") return null;
  const view = projectStateFor(state, seat, code);
  const keys = arenaKeys(view);
  const legal = legalIntents(state, seat);
  if (decision.kind === "priority-window") {
    const source = view.stack[0]?.card ? keys.get(view.stack[0].card.instanceId) : undefined;
    const order = source ? orders[source.key] : undefined;
    if (!source || !order) return null;
    const decidedOwnTrigger = source.seat === seat && order.optionalTrigger !== undefined;
    if (order.priorityWindow !== "pass" && !decidedOwnTrigger) return null;
    return legal.some((intent) => intent.kind === "pass") ? { kind: "pass" } : null;
  }
  const options = decision.options;
  if (decision.sourceInstanceId === undefined || options?.length !== 2
    || !options.includes("yes") || !options.includes("no")) return null;
  const source = keys.get(decision.sourceInstanceId);
  const value = source?.seat === seat ? orders[source.key]?.optionalTrigger : undefined;
  if (!value) return null;
  return legal.some((intent) => intent.kind === "choose" && intent.optionId === value)
    ? { kind: "choose", optionId: value }
    : null;
}
