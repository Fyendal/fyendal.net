import type { DeckSummary } from "@fyendal/protocol";
import type { CardPoolMode, Format, QueuePoolCounts } from "@fyendal/shared";

const STRICTNESS: Record<CardPoolMode, number> = { legal: 0, future: 1, open: 2 };
const POOLS = ["legal", "future", "open"] as const;

export function emptyQueueCounts(): Record<Format, QueuePoolCounts> {
  const pools = (): QueuePoolCounts => ({
    legal: { legal: 0, future: 0, open: 0 },
    future: { legal: 0, future: 0, open: 0 },
    open: { legal: 0, future: 0, open: 0 },
  });
  return { cc: pools(), "silver-age": pools() };
}

/** The strictest pool a deck is legal in, from the server's legality hints.
 *  Without a deck, assume one that pairs under any pool. */
export function deckCardPool(deck: Pick<DeckSummary, "bannedCards" | "futureCards"> | null | undefined): CardPoolMode {
  if (deck?.bannedCards?.length) return "open";
  if (deck?.futureCards?.length) return "future";
  return "legal";
}

/** Searchers this player could be paired with, mirroring the server: the game
 *  plays in the stricter queued pool, and both decks must be legal there.
 *  `includesSelf` removes this account's own entry when it is searching. */
export function pairableSearchers(
  counts: QueuePoolCounts,
  cardPoolMode: CardPoolMode,
  deckPool: CardPoolMode,
  includesSelf: boolean,
): number {
  let total = 0;
  for (const queued of POOLS) {
    const pool = STRICTNESS[queued] <= STRICTNESS[cardPoolMode] ? queued : cardPoolMode;
    if (STRICTNESS[pool] < STRICTNESS[deckPool]) continue;
    for (const theirDeck of POOLS) {
      if (STRICTNESS[pool] >= STRICTNESS[theirDeck]) total += counts[queued][theirDeck];
    }
  }
  return Math.max(0, total - (includesSelf ? 1 : 0));
}
