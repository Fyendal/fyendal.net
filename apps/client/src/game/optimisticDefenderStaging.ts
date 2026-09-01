import type { CardView, GameView, PlayerView } from "@fyendal/shared";
import { heroCard } from "./board/BoardPrimitives.js";

function defenderCardsById(
  player: PlayerView,
  stagedCards: readonly CardView[],
): ReadonlyMap<number, CardView> {
  const cards = [
    ...stagedCards,
    ...player.hand,
    ...Object.values(player.equipment).flatMap((card) => card ? [card] : []),
    ...player.weapons,
    ...player.board,
    heroCard(player),
  ];
  return new Map(cards.map((card) => [card.instanceId, card]));
}

/** Overlay the latest locally requested defender set onto a GameView for
 * rendering and motion only. The authoritative view remains untouched and
 * continues to own legality and calculated defense totals. */
export function optimisticDefenderView(
  view: GameView | null,
  yourSeat: number | null,
  pendingInstanceIds: readonly number[] | null,
): GameView | null {
  if (!view || yourSeat === null || pendingInstanceIds === null) return view;
  const decision = view.pendingDecision;
  if (decision?.kind !== "defend" || decision.player !== yourSeat) return view;
  const player = view.players[yourSeat];
  if (!player) return view;

  const cardsById = defenderCardsById(player, decision.stagedCards ?? []);
  const stagedCards = pendingInstanceIds.flatMap((instanceId) => {
    const card = cardsById.get(instanceId);
    return card ? [card] : [];
  });
  return {
    ...view,
    pendingDecision: {
      ...decision,
      stagedCards,
    },
  };
}
