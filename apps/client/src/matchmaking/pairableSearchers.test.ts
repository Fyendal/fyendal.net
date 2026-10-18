import { describe, expect, it } from "vitest";
import { deckCardPool, emptyQueueCounts, pairableSearchers } from "./pairableSearchers.js";

/** One searcher in each queued pool with the loosest deck that pool admits,
 *  plus a future-pool searcher whose deck is legal anyway. */
function mixedQueue() {
  const counts = emptyQueueCounts().cc;
  counts.legal.legal = 1;
  counts.future.future = 1;
  counts.future.legal = 1;
  counts.open.open = 1;
  return counts;
}

describe("pairableSearchers", () => {
  it("counts a stricter searcher only when this deck is legal in their pool", () => {
    expect(pairableSearchers(mixedQueue(), "legal", "legal", false)).toBe(2);
    expect(pairableSearchers(mixedQueue(), "future", "legal", false)).toBe(3);
    expect(pairableSearchers(mixedQueue(), "future", "future", false)).toBe(2);
    expect(pairableSearchers(mixedQueue(), "open", "open", false)).toBe(1);
    expect(pairableSearchers(mixedQueue(), "open", "legal", false)).toBe(4);
  });

  it("removes this account's own entry while it searches", () => {
    expect(pairableSearchers(mixedQueue(), "legal", "legal", true)).toBe(1);
    expect(pairableSearchers(emptyQueueCounts().cc, "legal", "legal", true)).toBe(0);
  });
});

describe("deckCardPool", () => {
  it("reads the strictest legal pool from deck hints", () => {
    expect(deckCardPool(null)).toBe("legal");
    expect(deckCardPool({})).toBe("legal");
    expect(deckCardPool({ futureCards: ["X"] })).toBe("future");
    expect(deckCardPool({ futureCards: ["X"], bannedCards: ["Y"] })).toBe("open");
  });
});
