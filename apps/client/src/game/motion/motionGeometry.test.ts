import { describe, expect, it } from "vitest";
import {
  measureMotionAnchors,
  reducedMotionBatch,
  resolveMotionBatch,
  type MotionAnchorSnapshot,
  type MotionRect,
} from "./motionGeometry.js";
import type { GameMotionEvent } from "./motionTypes.js";

const rect = (left: number, top: number, width = 100, height = 138): MotionRect => ({
  left,
  top,
  width,
  height,
});

function anchors({
  cards = [],
  zones = [],
}: {
  cards?: Array<[string, MotionRect]>;
  zones?: Array<[string, MotionRect]>;
}): MotionAnchorSnapshot {
  return { cards: new Map(cards), zones: new Map(zones) };
}

describe("motion geometry", () => {
  it("resolves exact card anchors into a scaled viewport flight", () => {
    const event: GameMotionEvent = {
      kind: "move",
      source: { kind: "hand", seat: 0 },
      destination: { kind: "pitch", seat: 0 },
      visual: {
        kind: "face",
        card: { instanceId: 7, cardId: "SBA016", owner: 0 },
      },
      instanceId: 7,
      sourcePresentationKey: "0:hand:7",
      destinationPresentationKey: "0:pitch:7",
      count: 1,
      confidence: "exact",
    };
    const batch = resolveMotionBatch(
      [event],
      anchors({ cards: [["0:hand:7", rect(40, 600, 160, 220)]] }),
      anchors({ cards: [["0:pitch:7", rect(720, 320, 124, 170)]] }),
      3,
    );

    expect(batch?.flights).toEqual([expect.objectContaining({
      id: "3:flight:0",
      mode: "move",
      start: rect(40, 600, 160, 220),
      end: rect(720, 320, 124, 170),
      destinationPresentationKey: "0:pitch:7",
    })]);
  });

  it("marks hand-to-arsenal travel for its dedicated settle animation", () => {
    const source = rect(60, 620, 160, 220);
    const destination = rect(520, 470, 100, 138);
    const batch = resolveMotionBatch(
      [{
        kind: "move",
        source: { kind: "hand", seat: 0 },
        destination: { kind: "arsenal", seat: 0 },
        visual: {
          kind: "face",
          card: { instanceId: 40, cardId: "TST040", owner: 0, faceDown: true },
        },
        instanceId: 40,
        sourcePresentationKey: "0:hand:40",
        destinationPresentationKey: "0:arsenal:40",
        count: 1,
        confidence: "exact",
      }],
      anchors({ cards: [["0:hand:40", source]] }),
      anchors({ cards: [["0:arsenal:40", destination]] }),
      9,
    );

    expect(batch?.flights).toEqual([expect.objectContaining({
      mode: "arsenal",
      start: source,
      end: destination,
      showCount: false,
    })]);
  });

  it("lands the arsenal card before staggering the draw-up flights", () => {
    const chosen = { instanceId: 50, cardId: "TST050", owner: 0, faceDown: true };
    const draws = [51, 52, 53, 54].map((instanceId) => ({
      instanceId,
      cardId: `TST0${instanceId}`,
      owner: 0,
    }));
    const events: GameMotionEvent[] = [
      {
        kind: "move",
        source: { kind: "hand", seat: 0 },
        destination: { kind: "arsenal", seat: 0 },
        visual: { kind: "face", card: chosen },
        instanceId: chosen.instanceId,
        sourcePresentationKey: "0:hand:50",
        destinationPresentationKey: "0:arsenal:50",
        count: 1,
        confidence: "exact",
      },
      ...draws.map((card): GameMotionEvent => ({
        kind: "move",
        source: { kind: "deck", seat: 0 },
        destination: { kind: "hand", seat: 0 },
        visual: { kind: "back-reveal", card },
        instanceId: card.instanceId,
        destinationPresentationKey: `0:hand:${card.instanceId}`,
        count: 1,
        confidence: "inferred",
      })),
    ];
    const deck = rect(820, 500, 100, 138);
    const batch = resolveMotionBatch(
      events,
      anchors({
        cards: [["0:hand:50", rect(260, 680, 140, 193)]],
        zones: [["0:deck", deck]],
      }),
      anchors({ cards: [
        ["0:arsenal:50", rect(560, 500, 100, 138)],
        ...draws.map((card, index): [string, MotionRect] => [
          `0:hand:${card.instanceId}`,
          rect(220 + index * 110, 680, 100, 138),
        ]),
      ] }),
      10,
    );

    expect(batch?.flights.map((flight) => flight.mode)).toEqual([
      "arsenal",
      "draw",
      "draw",
      "draw",
      "draw",
    ]);
    expect(batch?.flights.map((flight) => flight.delayMs)).toEqual([
      0,
      390,
      475,
      560,
      645,
    ]);
  });

  it("centers an anonymous card-sized flight inside broad zone anchors", () => {
    const event: GameMotionEvent = {
      kind: "move",
      source: { kind: "deck", seat: 1 },
      destination: { kind: "hand", seat: 1 },
      visual: { kind: "back" },
      count: 1,
      confidence: "inferred",
    };
    const batch = resolveMotionBatch(
      [event],
      anchors({ zones: [["1:deck", rect(700, 40)]] }),
      anchors({ zones: [["1:hand", rect(100, 10, 800, 200)]] }),
      4,
    );
    const flight = batch?.flights[0];

    expect(flight?.start.width).toBeCloseTo(100);
    expect(flight?.end.width).toBeCloseTo(flight?.start.width ?? 0);
    expect((flight?.end.left ?? 0) + (flight?.end.width ?? 0) / 2).toBeCloseTo(500);
    expect((flight?.end.top ?? 0) + (flight?.end.height ?? 0) / 2).toBeCloseTo(110);
  });

  it("falls back to a destination pulse when the source cannot be measured", () => {
    const event: GameMotionEvent = {
      kind: "move",
      source: { kind: "hand", seat: 0 },
      destination: { kind: "arsenal", seat: 0 },
      visual: { kind: "back" },
      count: 1,
      confidence: "inferred",
    };
    const destination = rect(400, 500, 124, 170);
    const batch = resolveMotionBatch(
      [event],
      anchors({}),
      anchors({ zones: [["0:arsenal", destination]] }),
      5,
    );

    expect(batch?.flights).toEqual([]);
    expect(batch?.pulses).toEqual([expect.objectContaining({ rect: destination })]);
  });

  it("converts travel into destination-only feedback for reduced motion", () => {
    const destination = rect(720, 320, 124, 170);
    const batch = resolveMotionBatch(
      [{
        kind: "move",
        source: { kind: "hand", seat: 0 },
        destination: { kind: "pitch", seat: 0 },
        visual: { kind: "back" },
        destinationPresentationKey: "0:pitch:7",
        count: 1,
        confidence: "inferred",
      }],
      anchors({ zones: [["0:hand", rect(40, 600, 500, 220)]] }),
      anchors({
        cards: [["0:pitch:7", destination]],
        zones: [["0:pitch", destination]],
      }),
      6,
    );
    const reduced = reducedMotionBatch(batch!, anchors({
      cards: [["0:pitch:7", destination]],
    }));

    expect(reduced.flights).toEqual([]);
    expect(reduced.pulses).toContainEqual(expect.objectContaining({ rect: destination }));
  });

  it("collapses simultaneous copies of one generated board token into one fade", () => {
    const token = (instanceId: number): GameMotionEvent => ({
      kind: "appear",
      destination: { kind: "board", seat: 1 },
      visual: {
        kind: "face",
        card: { instanceId, cardId: "RUNECHANT", owner: 1 },
      },
      instanceId,
      destinationPresentationKey: `1:board:${instanceId}`,
    });
    const boardZone = rect(500, 60, 500, 180);
    const tokenRect = rect(620, 80, 100, 138);
    const batch = resolveMotionBatch(
      [token(20), token(21)],
      anchors({}),
      anchors({
        cards: [["1:board:20", tokenRect]],
        zones: [["1:board", boardZone]],
      }),
      7,
    );

    expect(batch?.flights).toEqual([expect.objectContaining({
      mode: "appear",
      count: 2,
      showCount: false,
      start: tokenRect,
      end: tokenRect,
    })]);
  });

  it("resolves a trigger into a short connector from its current source", () => {
    const source = rect(420, 260, 100, 138);
    const destination = rect(700, 220, 100, 138);
    const batch = resolveMotionBatch(
      [{
        kind: "connect",
        source: { kind: "chain-defender", link: 0, index: 0 },
        destination: { kind: "stack-layer", index: 0 },
        instanceId: 22,
        sourcePresentationKey: "chain:0:defender:0:22",
        destinationPresentationKey: "stack:layer:22",
      }],
      anchors({}),
      anchors({ cards: [
        ["chain:0:defender:0:22", source],
        ["stack:layer:22", destination],
      ] }),
      8,
    );

    expect(batch?.flights).toEqual([]);
    expect(batch?.connectors).toEqual([{
      id: "8:connector:0",
      start: source,
      end: destination,
      delayMs: 0,
    }]);
  });

  it("measures card and zone attributes in one read phase", () => {
    const cardElement = {
      dataset: { motionCard: "0:hand:7" },
      getBoundingClientRect: () => rect(10, 20),
    } as unknown as HTMLElement;
    const zoneElement = {
      dataset: { motionZone: "0:hand" },
      getBoundingClientRect: () => rect(0, 0, 600, 220),
    } as unknown as HTMLElement;
    const root = {
      querySelectorAll: (selector: string) => (
        selector === "[data-motion-card]" ? [cardElement] : [zoneElement]
      ),
    } as unknown as ParentNode;

    const measured = measureMotionAnchors(root);

    expect(measured.snapshot.cards.get("0:hand:7")).toEqual(rect(10, 20));
    expect(measured.snapshot.zones.get("0:hand")).toEqual(rect(0, 0, 600, 220));
    expect(measured.cardElements.get("0:hand:7")).toBe(cardElement);
  });
});
