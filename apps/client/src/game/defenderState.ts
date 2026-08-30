import type { ChainLinkView } from "@fyendal/shared";

/** Instance ids committed as defenders anywhere on the open combat chain. */
export function chainDefenderIds(chain: readonly ChainLinkView[]): Set<number> {
  const ids = new Set<number>();
  for (const link of chain) {
    for (const card of link.defendingCards) ids.add(card.instanceId);
  }
  return ids;
}
