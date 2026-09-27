import { describe, expect, it, vi } from "vitest";
import {
  animateHandReorder,
  captureHandPositions,
  handCardSlotLeft,
  handCardSlotTop,
  handDragTilt,
  handReturnDuration,
  HAND_REORDER_DURATION_MS,
} from "./handMotion.js";

function card(id: number, slot: number, visualLeft: number) {
  const animation = { cancel: vi.fn() };
  const animate = vi.fn(() => animation);
  const element = {
    dataset: { handInstanceId: String(id) },
    offsetLeft: slot,
    offsetWidth: 90,
    getBoundingClientRect: () => ({ left: visualLeft }),
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
  it("keeps the play boundary fixed when undo restores a raised or hovered card", () => {
    const row = {
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 500 }),
    } as unknown as HTMLElement;
    const restored = {
      offsetTop: 23,
      getBoundingClientRect: vi.fn(() => ({ top: 505 })),
    } as unknown as HTMLElement;
    expect(handCardSlotTop(row, restored)).toBe(523);
    expect(restored.getBoundingClientRect).not.toHaveBeenCalled();
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

  it("cancels motion and uses immediate slots when reduced motion is enabled", () => {
    const moving = card(2, 100, 0);
    const oldAnimation = { cancel: vi.fn() } as unknown as Animation;
    const animations = new Map([[moving.element, oldAnimation]]);
    animateHandReorder(hand([moving.element]), new Map([[2, 0]]), animations, null, true);

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
});
