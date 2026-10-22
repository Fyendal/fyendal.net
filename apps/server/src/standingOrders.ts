import { cardData, functionalKeyOf } from "@fyendal/cards";
import { legalIntents, type GameState } from "@fyendal/engine";
import type { GameIntent, SeatStandingOrders } from "@fyendal/shared";

function ownArenaKey(state: GameState, seat: number, instanceId: number): string | null {
  const player = state.players[seat];
  if (!player) return null;
  const card = [
    player.hero,
    ...player.weapons,
    ...Object.values(player.equipment),
    ...player.board,
  ].find((candidate) => candidate?.instanceId === instanceId);
  const data = card ? cardData[card.cardId] : undefined;
  return data ? functionalKeyOf(data) : null;
}

/** Only answers choices raised by the seat's own arena permanents; never passes. */
export function standingOrderIntent(
  state: GameState,
  seat: number,
  orders: SeatStandingOrders,
): Extract<GameIntent, { kind: "choose" }> | null {
  const decision = state.pendingDecision;
  if (!decision || decision.player !== seat) return null;
  const hook = decision.chooseHook;
  if (hook === undefined || decision.sourceInstanceId === undefined) return null;
  const key = ownArenaKey(state, seat, decision.sourceInstanceId);
  const order = key && Object.hasOwn(orders, key) ? orders[key] : undefined;
  const value = order && Object.hasOwn(order, hook) ? order[hook] : undefined;
  if (value === undefined) return null;
  return legalIntents(state, seat).some((intent) => intent.kind === "choose" && intent.optionId === value)
    ? { kind: "choose", optionId: value }
    : null;
}
