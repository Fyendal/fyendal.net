import type { CardView, GameView, PlayerView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { heroCard } from "./board/BoardPrimitives.js";

function defenderCardsById(
  player: PlayerView,
  stagedCards: readonly CardView[],
): ReadonlyMap<number, CardView> {
  const cards = [
    ...stagedCards,
    ...player.hand,
    ...player.arsenal,
    ...Object.values(player.equipment).flatMap((card) => card ? [card] : []),
    ...player.weapons,
    ...player.board,
    heroCard(player),
  ];
  return new Map(cards.map((card) => [card.instanceId, card]));
}

function visibleDefense(card: CardView): number {
  if (card.defense !== undefined) return card.defense;
  return Math.max(0, (cardData[card.cardId]?.defense ?? 0) - (card.defCounters ?? 0));
}

function optimisticStagedDefense(
  authoritativeCards: readonly CardView[],
  authoritativeDefense: number | undefined,
  stagedCards: readonly CardView[],
): number {
  if (stagedCards.length === 0) return 0;
  const authoritativeIds = new Set(authoritativeCards.map((card) => card.instanceId));
  const stagedIds = new Set(stagedCards.map((card) => card.instanceId));
  let defense = authoritativeDefense
    ?? authoritativeCards.reduce((total, card) => total + visibleDefense(card), 0);

  for (const card of authoritativeCards) {
    if (!stagedIds.has(card.instanceId)) defense -= visibleDefense(card);
  }
  for (const card of stagedCards) {
    if (!authoritativeIds.has(card.instanceId)) defense += visibleDefense(card);
  }
  return Math.max(0, defense);
}

/** Overlay the latest locally requested defender set onto a GameView for
 * rendering and motion only. Local defense values provide immediate feedback;
 * the next authoritative view replaces this estimate with the engine total. */
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

  const authoritativeCards = decision.stagedCards ?? [];
  const cardsById = defenderCardsById(player, authoritativeCards);
  const stagedCards = pendingInstanceIds.flatMap((instanceId) => {
    const card = cardsById.get(instanceId);
    return card ? [card] : [];
  });
  return {
    ...view,
    pendingDecision: {
      ...decision,
      stagedCards,
      stagedDefense: optimisticStagedDefense(
        authoritativeCards,
        decision.stagedDefense,
        stagedCards,
      ),
    },
  };
}
