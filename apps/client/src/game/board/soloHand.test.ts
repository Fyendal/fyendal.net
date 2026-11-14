import { describe, expect, it } from "vitest";
import {
  SOLO_HAND_CHIP_ROOM,
  SOLO_HAND_EDGE_GAP,
  SOLO_HAND_TOP,
  soloHandFrame,
  soloHandWings,
} from "./soloHand.js";

const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, right: left + width, bottom: top + height });

// 1440x900 square board, measured live.
const zones = {
  board: box(0, 0, 1164, 900),
  legs: box(18, 68, 110, 110),
  arsenal: box(527, 68, 110, 110),
  banished: box(1036, 68, 110, 110),
  nameplate: box(12, 12, 179, 28),
};

describe("solo hand frame", () => {
  it("fits between the nameplate, legs, arsenal and banished zone", () => {
    expect(soloHandFrame(zones)).toEqual({
      left: 191 + SOLO_HAND_EDGE_GAP,
      right: 1036 - SOLO_HAND_EDGE_GAP,
      top: SOLO_HAND_TOP,
      bottom: 178 - SOLO_HAND_CHIP_ROOM,
      gapLeft: 527 - SOLO_HAND_EDGE_GAP,
      gapRight: 637 + SOLO_HAND_EDGE_GAP,
    });
  });

  it("takes the whole row when the seat has no effect chips", () => {
    expect(soloHandFrame({ ...zones, chipRoom: false })?.bottom).toBe(178);
  });

  it("starts below a HUD docked across the top edge", () => {
    const hud = box(152, 8, 520, 47);
    expect(soloHandFrame({ ...zones, hud })?.top).toBe(55 + SOLO_HAND_TOP);
    // The usual seam HUD sits below the row and is ignored.
    expect(soloHandFrame({ ...zones, hud: box(800, 360, 180, 160) })?.top).toBe(SOLO_HAND_TOP);
  });

  it("gives up when the zones are missing or the row is too short", () => {
    expect(soloHandFrame({ ...zones, arsenal: null })).toBeNull();
    expect(soloHandFrame({ ...zones, hud: box(152, 8, 520, 120) })).toBeNull();
  });
});

describe("solo hand wings", () => {
  const frame = soloHandFrame(zones)!;

  it("shows whole cards without overlap while both wings have room", () => {
    const four = soloHandWings(frame, 4);
    expect(four.cardHeight).toBe(134);
    expect(four.cardWidth).toBe(96);
    expect(four.left.count + four.right.count).toBe(4);
    expect(four.left.step).toBeGreaterThanOrEqual(four.cardWidth);
    expect(four.right.step).toBeGreaterThanOrEqual(four.cardWidth);
  });

  it("overlaps evenly inside each wing for an oversized hand", () => {
    for (const count of [7, 9, 12]) {
      const wings = soloHandWings(frame, count);
      expect(wings.left.count + wings.right.count).toBe(count);
      const leftSpan = wings.cardWidth + (wings.left.count - 1) * wings.left.step;
      const rightSpan = wings.cardWidth + (wings.right.count - 1) * wings.right.step;
      expect(leftSpan).toBeLessThanOrEqual(frame.gapLeft - frame.left);
      expect(rightSpan).toBeLessThanOrEqual(frame.right - frame.gapRight);
    }
  });

  it("puts a single card beside the arsenal", () => {
    expect(soloHandWings(frame, 1)).toMatchObject({ left: { count: 1, step: 0 }, right: { count: 0 } });
  });
});
