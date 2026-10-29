import { describe, expect, it, vi } from "vitest";
import {
  animateHandReorder,
  captureHandPositions,
  handCardSlotLeft,
  handCardSlotTop,
  handDragPreviewOffset,
  handDragPreviewSize,
  handDragTilt,
  handReturnDuration,
  HAND_REORDER_DURATION_MS,
} from "./handMotion.js";

function card(id: number, slot: number, visualLeft: number, tiltSpread = 0) {
  const animation = { cancel: vi.fn() };
  const animate = vi.fn(() => animation);
  const element = {
    dataset: { handInstanceId: String(id) },
    offsetLeft: slot,
    offsetWidth: 90,
    offsetHeight: 124,
    getBoundingClientRect: () => ({
      left: visualLeft - tiltSpread,
      top: 0,
      width: 90 + 2 * tiltSpread,
      height: 124,
    }),
    animate,
  } as unknown as HTMLElement;
  return { element, animate, animation };
}

function hand(cards: HTMLElement[], left = 0, scrollLeft = 0) {
  return {
    scrollLeft,
    getBoundingClientRect: () => ({ left }),
    querySelectorAll: () => cards,
  } as unknown as HTMLElement;
}

describe("hand reorder motion", () => {
  it("keeps the play boundary fixed when hover or selection raises a card", () => {
    const row = {
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 500 }),
    } as unknown as HTMLElement;
    const raised = {
      offsetTop: 23,
      getBoundingClientRect: vi.fn(() => ({ top: 505 })),
    } as unknown as HTMLElement;
    expect(handCardSlotTop(row, raised)).toBe(523);
    expect(raised.getBoundingClientRect).not.toHaveBeenCalled();
  });
  it("slides neighboring cards from their previous positions while the dragged source stays hidden", () => {
    const dragged = card(1, 100, 100);
    const neighbor = card(2, 0, 0);
    const animations = new Map<HTMLElement, Animation>();
    animateHandReorder(hand([dragged.element, neighbor.element]), new Map([[1, 0], [2, 100]]),
      animations, 1, false);

    expect(dragged.animate).not.toHaveBeenCalled();
    expect(neighbor.animate).toHaveBeenCalledWith([
      { translate: "100px 0px" }, { translate: "0px 0px" },
    ], expect.objectContaining({ duration: HAND_REORDER_DURATION_MS }));
  });

  it("retargets a moving card from its visual position and keeps hit testing on its layout slot", () => {
    const moving = card(2, 100, 45);
    const row = hand([moving.element], 30, 15);
    const oldAnimation = { cancel: vi.fn() } as unknown as Animation;
    const animations = new Map([[moving.element, oldAnimation]]);
    const previous = captureHandPositions(row);
    expect(handCardSlotLeft(row, moving.element)).toBe(115);

    animateHandReorder(row, previous, animations, null, false);
    expect(oldAnimation.cancel).toHaveBeenCalledOnce();
    expect(moving.animate).toHaveBeenCalledWith([
      { translate: "-70px 0px" }, { translate: "0px 0px" },
    ], expect.anything());
  });

  it("measures a fanned card from its untilted box", () => {
    const tilted = card(3, 100, 100, 12);
    expect(captureHandPositions(hand([tilted.element])).get(3)).toBe(100);
  });

  it("cancels motion and uses immediate slots when reduced motion is enabled", () => {
    const moving = card(2, 100, 0);
    const oldAnimation = { cancel: vi.fn() } as unknown as Animation;
    const animations = new Map([[moving.element, oldAnimation]]);
    const row = hand([moving.element]);
    row.getBoundingClientRect = vi.fn(() => { throw new Error("Unnecessary geometry read"); });
    animateHandReorder(row, new Map([[2, 0]]), animations, null, true);

    expect(oldAnimation.cancel).toHaveBeenCalledOnce();
    expect(moving.animate).not.toHaveBeenCalled();
    expect(animations.size).toBe(0);
  });
});

describe("dragged card motion", () => {
  it("bounds return timing for both nearby slots and distant arena drops", () => {
    expect(handReturnDuration(0)).toBe(160);
    expect(handReturnDuration(300)).toBe(220);
    expect(handReturnDuration(1000)).toBe(260);
  });

  it("tilts gently with movement and settles when the pointer stops", () => {
    const right = handDragTilt(0, 80, 16);
    const left = handDragTilt(0, -80, 16);
    expect(right).toBeGreaterThan(0);
    expect(right).toBeLessThan(4);
    expect(left).toBeCloseTo(-right);
    expect(handDragTilt(right, 0, 80)).toBeLessThan(right);
    expect(handDragTilt(right, 0, 0)).toBe(right);
  });

  it("keeps the whole drag preview beside the card when it fits", () => {
    const preview = { width: 296, height: 413 };
    expect(handDragPreviewSize(preview, { width: 180, height: 250 }, { width: 1440, height: 900 }))
      .toEqual({ ...preview, stacked: false });
  });

  it("shrinks the drag preview to fit above or below a phone card", () => {
    // (812 - 114) / 2 - 12 - 8 leaves 329px of height.
    expect(handDragPreviewSize({ width: 296, height: 413 }, { width: 83, height: 114 }, { width: 375, height: 812 }))
      .toEqual({ width: 236, height: 329, stacked: true });
  });

  it("places the drag preview beside the card on the roomier side", () => {
    const viewport = { width: 1440, height: 900 };
    const preview = { width: 296, height: 413 };
    const card = { width: 180, height: 250 };
    expect(handDragPreviewOffset({ ...card, left: 200, top: 400 }, preview, viewport))
      .toEqual({ x: 192, y: -81.5 });
    expect(handDragPreviewOffset({ ...card, left: 1200, top: 400 }, preview, viewport))
      .toEqual({ x: -308, y: -81.5 });
    // Touch prefers the left, clear of a right thumb, when it fits.
    expect(handDragPreviewOffset({ ...card, left: 600, top: 400 }, preview, viewport, "left"))
      .toEqual({ x: -308, y: -81.5 });
    expect(handDragPreviewOffset({ ...card, left: 200, top: 400 }, preview, viewport, "left"))
      .toEqual({ x: 192, y: -81.5 });
    // Near the bottom edge the preview rises to stay visible.
    expect(handDragPreviewOffset({ ...card, left: 200, top: 700 }, preview, viewport).y).toBe(900 - 8 - 413 - 700);
  });

  it("stacks the drag preview above or below a phone card", () => {
    const viewport = { width: 375, height: 812 };
    const preview = { width: 236, height: 329 };
    const card = { width: 83, height: 114 };
    // Low on screen: above, centred on the card.
    expect(handDragPreviewOffset({ ...card, left: 146, top: 500 }, preview, viewport))
      .toEqual({ x: -76.5, y: -341 });
    // An above preference stacks even when the side would fit.
    const wide = { width: 430, height: 932 };
    const above = handDragPreviewSize(preview, card, wide, "above");
    expect(above.stacked).toBe(true);
    expect(handDragPreviewOffset({ ...card, left: 146, top: 600 }, above, wide, "above").y)
      .toBe(-12 - above.height);
    // High on screen: below.
    expect(handDragPreviewOffset({ ...card, left: 146, top: 200 }, preview, viewport))
      .toEqual({ x: -76.5, y: 126 });
  });
});
