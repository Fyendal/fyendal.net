import type { CardView, GameView } from "@fyendal/shared";
import type { Sel } from "./useActionAnnouncement.js";
import { heroCard } from "./board/heroCard.js";

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
  const paymentSourceId = pending?.player === seat && pending.resourcePayment
    ? pending.resourcePayment.sourceInstanceId : undefined;
  const id = paymentSourceId ?? (selection.kind === "activate" ? selection.sourceInstanceId
    : selection.kind !== "none" && selection.kind !== "choose-hand-action" ? selection.instanceId : undefined);
  if (id === undefined) return null;
  const card = [
    ...player.hand, ...player.arsenal,
    ...view.players.flatMap((owner) => [heroCard(owner), ...owner.weapons,
      ...Object.values(owner.equipment), ...owner.board]),
    ...view.players.flatMap((owner) => [...owner.banish, ...owner.graveyard]),
    ...(player.visibleDeckTop ? [player.visibleDeckTop] : []),
    ...view.chain.flatMap((link) => [link.attackingCard, ...link.defendingCards, ...link.reactions]),
    ...view.stack.map((layer) => layer.card),
  ].find((candidate) => candidate?.instanceId === id);
  if (!card || card.hidden) return null;
  return { card, fromHand: player.hand.some((candidate) => candidate.instanceId === id) };
}
