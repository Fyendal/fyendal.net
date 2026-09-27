import type { CardView, GameView } from "@fyendal/shared";
import type { Sel } from "./useActionAnnouncement.js";
import { heroCard } from "./board/BoardPrimitives.js";

export interface PitchFocusSource {
  card: CardView;
  fromHand: boolean;
}

/** Only use cards already visible to the paying player. */
export function pitchFocusSource(view: GameView, seat: number, selection: Sel): PitchFocusSource | null {
  const player = view.players[seat];
  if (!player) return null;
  const pending = view.pendingDecision;
  if (pending?.player === seat && pending.resourcePayment && pending.preStackSource) {
    if (pending.preStackSource.card.hidden) return null;
    return {
      card: pending.preStackSource.card,
      fromHand: pending.preStackSource.zone === "hand",
    };
  }
  if (selection.kind === "none" || selection.kind === "choose-hand-action") return null;
  const id = selection.kind === "activate" ? selection.sourceInstanceId : selection.instanceId;
  const card = [
    heroCard(player), ...player.hand, ...player.arsenal, ...player.weapons,
    ...Object.values(player.equipment), ...player.board,
    ...view.players.flatMap((owner) => [...owner.banish, ...owner.graveyard]),
    ...(player.visibleDeckTop ? [player.visibleDeckTop] : []),
    ...view.chain.flatMap((link) => [link.attackingCard, ...link.defendingCards, ...link.reactions]),
  ].find((candidate) => candidate?.instanceId === id);
  if (!card || card.hidden) return null;
  return { card, fromHand: player.hand.some((candidate) => candidate.instanceId === id) };
}
