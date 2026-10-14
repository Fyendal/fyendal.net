import type { GamePresentations } from "./extractPresentations.js";
import type { BoardReflowMotionEvent } from "./motionTypes.js";

/** When a card leaves a seat's arena, the cards that stay there slide into
 * the vacated slots. Their geometry decides whether anything actually moves;
 * the departing card keeps its own movement or disappearance. */
export function boardReflows(
  previous: GamePresentations,
  current: GamePresentations,
): BoardReflowMotionEvent[] {
  const boardKey = (seat: number, instanceId: number) => `${seat}:${instanceId}`;
  const currentBoard = new Map(current.cards.flatMap((card) => card.location.kind === "board"
    ? [[boardKey(card.location.seat, card.instanceId), card] as const] : []));
  const previousBoard = previous.cards.filter((card) => card.location.kind === "board");
  const vacatedSeats = new Set(previousBoard.flatMap((card) => (
    card.location.kind === "board" && !currentBoard.has(boardKey(card.location.seat, card.instanceId))
      ? [card.location.seat] : []
  )));
  const reflows: BoardReflowMotionEvent[] = [];
  for (const before of previousBoard) {
    if (before.location.kind !== "board" || !vacatedSeats.has(before.location.seat)) continue;
    const seat = before.location.seat;
    const after = currentBoard.get(boardKey(seat, before.instanceId));
    if (!after) continue;
    reflows.push({
      kind: "reflow", source: { kind: "board", seat }, destination: { kind: "board", seat },
      visual: after.card.hidden || after.card.cardId === "" ? { kind: "back" } : { kind: "face", card: after.card },
      instanceId: after.instanceId, sourcePresentationKey: before.key, destinationPresentationKey: after.key,
      phase: "movement",
    });
  }
  return reflows;
}
