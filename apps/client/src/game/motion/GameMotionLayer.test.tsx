import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  cardHoleClipPath,
  MotionCardVisual,
  motionFlightHandsOff,
  motionFlightLayer,
  motionFlightMorph,
  motionFlightSoulSeat,
  motionFlightStartRect,
  squareMotionFlight,
} from "./GameMotionLayer.js";
import { measureMotionAnchors, resolveMotionBatch, type MotionFlight } from "./motionGeometry.js";

const card = { instanceId: 12, cardId: "WTR160", owner: 0 };

describe("motion card presentation", () => {
  it.each(["graveyard", "banish"] as const)(
    "matches the %s pile when a deck card has no visible destination card",
    (kind) => {
      const deck = { left: 600, top: 300, width: 120, height: 106 };
      const pile = { left: 600, top: 100, width: 120, height: 106 };
      const zoneAnchors = [
        { dataset: { motionZoneAnchor: "0:deck" }, getBoundingClientRect: () => deck },
        { dataset: { motionZoneAnchor: `0:${kind}` }, getBoundingClientRect: () => pile },
      ];
      const root = {
        querySelectorAll: (selector: string) => selector === "[data-motion-zone-anchor]" ? zoneAnchors : [],
      } as unknown as ParentNode;
      const { snapshot } = measureMotionAnchors(root);
      const batch = resolveMotionBatch([{
        kind: "move",
        source: { kind: "deck", seat: 0 },
        destination: { kind, seat: 0 },
        destinationPresentationKey: `0:${kind}:${card.instanceId}`,
        visual: { kind: "face", card },
        instanceId: card.instanceId,
        count: 1,
        confidence: "exact",
      }], snapshot, snapshot, "deck-to-pile");
      const flight = batch!.flights[0]!;

      expect(flight.start).toEqual(deck);
      expect(flight.end).toEqual(pile);
      expect(squareMotionFlight(flight, true)).toBe(true);
      const html = renderToStaticMarkup(createElement(MotionCardVisual, {
        visual: flight.visual,
        count: 1,
        square: squareMotionFlight(flight, true),
      }));
      expect(html).toContain("card-board-square");
      expect(html).not.toContain("game-motion-image game-motion-face");
    },
  );

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

  it("morphs a hand card down to a compact zone instead of swapping shapes", () => {
    const flight = {
      visual: { kind: "face", card },
      start: { left: 100, top: 500, width: 140, height: 196 },
      end: { left: 400, top: 200, width: 120, height: 106 },
    } as MotionFlight;
    const morph = motionFlightMorph(flight, true);

    expect(morph).not.toBeNull();
    expect(morph!.scale).toBeCloseTo(120 / 140);
    expect(morph!.crop).toBeCloseTo((196 - 106 / (120 / 140)) / 2);
    const html = renderToStaticMarkup(createElement(MotionCardVisual, {
      visual: flight.visual, count: 1, square: true, morph,
    }));
    expect(html).toContain("game-motion-morph-full");
    expect(motionFlightMorph(flight, false)).toBeNull();
    expect(motionFlightMorph({ ...flight, visual: { kind: "back" } } as MotionFlight, true)).toBeNull();
    expect(motionFlightMorph({
      ...flight, start: { ...flight.start, width: 120, height: 106 },
    }, true)).toBeNull();
  });

  it("flips a face-up arsenal card at full size before it morphs to the deck bottom", () => {
    const flight = {
      mode: "deck-bottom",
      visual: { kind: "face-conceal", card },
      start: { left: 100, top: 500, width: 140, height: 196 },
      end: { left: 400, top: 200, width: 120, height: 106 },
    } as MotionFlight;
    const morph = motionFlightMorph(flight, true);

    expect(morph?.flip).toBe(true);
    const html = renderToStaticMarkup(createElement(MotionCardVisual, {
      visual: flight.visual, count: 1, square: true, morph,
    }));
    expect(html).toContain("game-motion-morph-flip");
    expect(html).not.toContain("data-cardid");
    expect(motionFlightMorph({ ...flight, mode: "move" }, true)).toBeNull();
  });

  it("sends charged cards beneath their own hero", () => {
    const flight = { destinationPresentationKey: "1:soul:42" } as MotionFlight;
    expect(motionFlightSoulSeat(flight)).toBe(1);
    expect(motionFlightSoulSeat({ destinationPresentationKey: "1:graveyard:42" } as MotionFlight)).toBeNull();
    expect(cardHoleClipPath({ left: 10, top: 20, width: 100, height: 50 })).toContain("polygon(evenodd");
  });
});
