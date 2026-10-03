import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MotionCardVisual, motionFlightHandsOff, motionFlightLayer, motionFlightStartRect, squareMotionFlight } from "./GameMotionLayer.js";
import type { MotionFlight } from "./motionGeometry.js";

const card = { instanceId: 12, cardId: "WTR160", owner: 0 };

describe("motion card presentation", () => {
  it("keeps the landed attack visible until its stack destination can take over", () => {
    const flight = {
      mode: "move", destinationPresentationKey: "stack:layer:42",
    } as MotionFlight;
    expect(motionFlightHandsOff(flight, false)).toBe(false);
    expect(motionFlightHandsOff(flight, true)).toBe(true);
    expect(motionFlightHandsOff({ ...flight, mode: "settle" }, false)).toBe(false);
    expect(motionFlightHandsOff({ ...flight, mode: "disappear", destinationPresentationKey: undefined }, false)).toBe(true);
  });
  it("keeps a delayed stack departure above its source float on the way to combat", () => {
    const flight = {
      destinationLayer: "chain", sourceMaskPresentationKey: "stack:layer:42", delayMs: 290,
    } as MotionFlight;
    expect(motionFlightLayer(flight)).toBe("stack");
    expect(motionFlightLayer({ ...flight, sourceMaskPresentationKey: undefined })).toBe("chain");
  });
  it("uses the square card's name, frame crop, and stat badge during a compact flight", () => {
    const html = renderToStaticMarkup(createElement(MotionCardVisual, {
      visual: { kind: "face", card },
      count: 1,
      square: true,
    }));

    expect(html).toContain("game-motion-visual-square");
    expect(html).toContain("card-board-square");
    expect(html).toContain("board-square-name");
    expect(html).toContain("board-square-frame-left");
    expect(html).toContain("board-square-stats");
    expect(html).not.toContain("game-motion-image game-motion-face");
  });

  it("keeps full cards and hidden backs in their intended presentation", () => {
    const full = renderToStaticMarkup(createElement(MotionCardVisual, {
      visual: { kind: "face", card },
      count: 1,
    }));
    const hidden = renderToStaticMarkup(createElement(MotionCardVisual, {
      visual: { kind: "back" },
      count: 1,
      square: true,
    }));

    expect(full).not.toContain("board-square-name");
    expect(hidden).toContain("card-back-square");
    expect(hidden).not.toContain("data-cardid");
  });

  it("uses compact geometry only for compact destinations outside full-card floats", () => {
    const flight = {
      end: { left: 0, top: 0, width: 120, height: 106 },
    } as MotionFlight;
    expect(squareMotionFlight(flight, true)).toBe(true);
    expect(squareMotionFlight(flight, false)).toBe(false);
    expect(squareMotionFlight({ ...flight, destinationLayer: "chain" }, true)).toBe(false);
    expect(squareMotionFlight({ ...flight, destinationLayer: "stack" }, true)).toBe(false);
    expect(squareMotionFlight({ ...flight, end: { ...flight.end, height: 168 } }, true)).toBe(false);
  });

  it("keeps an equipment card full sized while it flies to the combat chain", () => {
    const flight = {
      start: { left: 100, top: 50, width: 120, height: 106 },
      end: { left: 400, top: 200, width: 140, height: 195 },
      destinationLayer: "chain",
    } as MotionFlight;

    expect(motionFlightStartRect(flight, true)).toEqual({
      left: 90,
      top: 5.5,
      width: 140,
      height: 195,
    });
    expect(motionFlightStartRect(flight, false)).toEqual(flight.start);
  });
});
