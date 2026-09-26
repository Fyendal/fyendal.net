import { describe, expect, it } from "vitest";
import {
  handDragScrollSpeed,
  handDragStarted,
  handDragLocation,
  canPlayHandDrop,
  moveHandCard,
  moveVisibleHandCard,
  reconcileHandOrder,
} from "./handOrder.js";

describe("local hand ordering", () => {
  it("retains a custom order through authoritative updates and appends draws", () => {
    const custom = moveHandCard([1, 2, 3, 4], 4, 1);
    expect(custom).toEqual([1, 4, 2, 3]);
    expect(reconcileHandOrder([1, 2, 3, 4], custom)).toEqual(custom);
    expect(reconcileHandOrder([2, 3, 4, 5], custom)).toEqual([4, 2, 3, 5]);
  });

  it("places a returning card after survivors once its old instance has departed", () => {
    const surviving = reconcileHandOrder([1, 3], [3, 2, 1]);
    expect(reconcileHandOrder([1, 2, 3], surviving)).toEqual([3, 1, 2]);
  });

  it("moves physical instances independently and never mutates the input order", () => {
    const order = [10, 11, 12];
    expect(moveHandCard(order, 10, 2)).toEqual([11, 12, 10]);
    expect(moveHandCard(order, 12, 0)).toEqual([12, 10, 11]);
    expect(order).toEqual([10, 11, 12]);
  });

  it("handles removed cards, empty hands and movement beyond either end", () => {
    expect(reconcileHandOrder([], [3, 2, 1])).toEqual([]);
    expect(moveHandCard([1, 2], 3, 0)).toEqual([1, 2]);
    expect(moveHandCard([1, 2], 2, -1)).toEqual([2, 1]);
    expect(moveHandCard([1, 2], 1, 9)).toEqual([2, 1]);
  });

  it("keeps staged and hidden cards in their slots while sorting visible cards", () => {
    const order = [1, 2, 3, 4, 5];
    expect(moveVisibleHandCard(order, [1, 3, 5], 1, 2)).toEqual([3, 2, 5, 4, 1]);
    expect(moveVisibleHandCard(order, [1, 3, 5], 5, 0)).toEqual([5, 2, 1, 4, 3]);
  });
});

describe("hand drag gestures", () => {
  it("keeps clicks and small jitter out of dragging, and allows horizontal and vertical drags", () => {
    expect(handDragStarted(50, 50, 50, 50)).toBe(false);
    expect(handDragStarted(50, 50, 59, 54)).toBe(false);
    expect(handDragStarted(50, 50, 58, 58)).toBe(false);
    expect(handDragStarted(50, 50, 60, 90)).toBe(true);
    expect(handDragStarted(50, 50, 50, 30)).toBe(true);
    expect(handDragStarted(50, 50, 61, 54)).toBe(true);
    expect(handDragStarted(50, 50, 30, 54)).toBe(true);
  });

  it("scrolls at either edge with bounded speed and leaves the center still", () => {
    expect(handDragScrollSpeed(300, 100, 500)).toBe(0);
    expect(handDragScrollSpeed(124, 100, 500)).toBe(-300);
    expect(handDragScrollSpeed(476, 100, 500)).toBe(300);
    expect(handDragScrollSpeed(0, 100, 500)).toBe(-600);
    expect(handDragScrollSpeed(900, 100, 500)).toBe(600);
    expect(handDragScrollSpeed(100, 100, 100)).toBe(0);
  });
});

describe("arena hand drops", () => {
  const arena = { left: 0, right: 800, top: 0, bottom: 700 };
  const hand = { left: 0, right: 800, top: 500, bottom: 700 };

  it("distinguishes hand sorting from arena plays and drops outside the board", () => {
    expect(handDragLocation(400, 600, hand, arena)).toBe("hand");
    expect(handDragLocation(400, 300, hand, arena)).toBe("arena");
    expect(handDragLocation(400, 490, hand, arena)).toBe("buffer");
    expect(handDragLocation(400, 480, hand, arena)).toBe("buffer");
    expect(handDragLocation(400, 479, hand, arena)).toBe("arena");
    expect(handDragLocation(900, 300, hand, arena)).toBe("outside");
    expect(handDragLocation(400, -10, hand, arena)).toBe("outside");
    expect(handDragLocation(400, 750, hand, arena)).toBe("outside");
  });

  it("allows a legal play or the selected card, but never a different payment card", () => {
    const playable = new Set([1, 2]);
    expect(canPlayHandDrop(1, playable, { kind: "none" }, false)).toBe(true);
    expect(canPlayHandDrop(3, playable, { kind: "none" }, false)).toBe(false);
    expect(canPlayHandDrop(1, playable, { kind: "play-hand", instanceId: 1 }, false)).toBe(true);
    expect(canPlayHandDrop(2, playable, { kind: "play-hand", instanceId: 1 }, false)).toBe(false);
    expect(canPlayHandDrop(1, playable, { kind: "activate", sourceInstanceId: 1 }, false)).toBe(false);
  });

  it("disables the play glow during decisions and when authoritative legality changes", () => {
    expect(canPlayHandDrop(1, new Set([1]), { kind: "none" }, true)).toBe(false);
    expect(canPlayHandDrop(1, new Set(), { kind: "none" }, false)).toBe(false);
  });
});
