import type { CardView, GameIntent, GameView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";

/** True when passing would give up an unused action point on the player's own
 * action-phase turn while an action card or weapon could still be used. The
 * game's opening turn (engine turn 1, "turn 0" in play) never warns. */
export function shouldWarnBeforeEndTurn(
  view: GameView | null,
  seat: number | null,
  candidates: readonly GameIntent[],
): boolean {
  if (!view || seat === null) return false;
  if (view.turn <= 1 || view.phase !== "action" || view.activePlayer !== seat) return false;
  if (view.pendingDecision || view.stack.length > 0) return false;
  const player = view.players[seat];
  if (!player || player.actionPoints <= 0) return false;

  const weaponIds = new Set(player.weapons.map((card) => card.instanceId));
  const cards = new Map<number, CardView>();
  for (const card of [
    ...player.hand,
    ...player.arsenal,
    ...player.graveyard,
    ...player.banish,
    ...(player.visibleDeckTop ? [player.visibleDeckTop] : []),
  ]) cards.set(card.instanceId, card);

  return candidates.some((intent) => {
    if (intent.kind === "activate-ability") return weaponIds.has(intent.sourceInstanceId);
    if (
      intent.kind !== "play-card" &&
      intent.kind !== "play-from-arsenal" &&
      intent.kind !== "play-from-zone"
    ) return false;
    if (intent.asInstant) return false;
    const card = cards.get(intent.instanceId);
    return card !== undefined && cardData[card.cardId]?.cardType === "action";
  });
}
