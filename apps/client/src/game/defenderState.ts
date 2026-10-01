import type { ChainLinkView, GameView } from "@fyendal/shared";

/** Cards remain in hand until a block is confirmed, but staged hand cards
 * already occupy the chain in the presentation. */
export function presentedHandCount(
  view: GameView,
  seat: number,
  hiddenInstanceIds?: ReadonlySet<number>,
): number {
  const player = view.players[seat];
  if (!player) return 0;
  const decision = view.pendingDecision;
  const stagedIds = new Set(decision?.kind === "defend" && decision.player === seat
    ? (decision.stagedCards ?? []).map((card) => card.instanceId)
    : []);
  const stagedHandCount = decision?.kind === "defend" && decision.player === seat
    ? decision.stagedHandCount ?? player.hand.filter((card) => stagedIds.has(card.instanceId)).length
    : 0;
  const additionallyHidden = player.hand.filter((card) =>
    hiddenInstanceIds?.has(card.instanceId) && !stagedIds.has(card.instanceId)
  ).length;
  return Math.max(0, player.handCount - stagedHandCount - additionallyHidden);
}

/** Instance ids committed as defenders anywhere on the open combat chain. */
export function chainDefenderIds(chain: readonly ChainLinkView[]): Set<number> {
  const ids = new Set<number>();
  for (const link of chain) {
    for (const card of link.defendingCards) ids.add(card.instanceId);
  }
  return ids;
}
