import { describe, expect, it } from "vitest";
import { HUD_RESERVE_GAP, hudReserve } from "./useHudReserve.js";

const rect = (left: number, top: number, width: number, height: number): DOMRectReadOnly => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

describe("hudReserve", () => {
  const board = rect(0, 0, 824, 840);

  it("reserves the HUD's width from the mat edge plus clearance when it crosses the divider", () => {
    expect(hudReserve(board, rect(496, 324, 194, 193), 420)).toBe(824 - 496 + HUD_RESERVE_GAP);
  });

  it("reserves nothing while the HUD is pinned above the arena", () => {
    expect(hudReserve(board, rect(8, 8, 808, 50), 420)).toBe(0);
  });

  it("reserves nothing for an unrendered HUD", () => {
    expect(hudReserve(board, rect(0, 0, 0, 0), 420)).toBe(0);
  });

  it("never reports a negative reserve for a HUD beyond the mat", () => {
    expect(hudReserve(board, rect(900, 324, 194, 193), 420)).toBe(0);
  });
});
