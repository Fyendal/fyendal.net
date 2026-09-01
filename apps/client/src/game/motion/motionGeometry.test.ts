import { describe, expect, it } from "vitest";
import {
  measureMotionAnchors,
  reducedMotionBatch,
  resolveMotionBatch,
  resolveMotionBatches,
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

  it("lands hidden arsenaling on the maskable opaque arsenal back", () => {
    const hand = rect(240, 30, 100, 138);
    const arsenal = rect(620, 210, 100, 138);
    const batch = resolveMotionBatch(
      [{
        kind: "move",
        source: { kind: "hand", seat: 1 },
        destination: { kind: "arsenal", seat: 1 },
        visual: { kind: "back" },
        destinationPresentationKey: "1:arsenal:opaque",
        count: 1,
        confidence: "inferred",
      }],
      anchors({ zones: [["1:hand", hand]] }),
      anchors({ cards: [["1:arsenal:opaque", arsenal]] }),
      14,
    );

    expect(batch?.flights).toEqual([expect.objectContaining({
      mode: "arsenal",
      end: arsenal,
      destinationPresentationKey: "1:arsenal:opaque",
    })]);
    expect(batch?.flights[0]?.start.left).toBeGreaterThanOrEqual(hand.left);
    expect(batch?.flights[0]?.start.left).toBeLessThan(hand.left + hand.width);
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
        visual: { kind: "face", card },
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

  it("starts the played card before overlapping pitch payment", () => {
    const playedSource = rect(220, 680, 140, 193);
    const pitchSource = rect(380, 680, 140, 193);
    const stackDestination = rect(520, 260, 100, 138);
    const pitchDestination = rect(690, 500, 100, 138);
    const batch = resolveMotionBatch(
      [
        {
          kind: "move",
          source: { kind: "hand", seat: 0 },
          destination: { kind: "stack-layer", index: 0 },
          visual: {
            kind: "face",
            card: { instanceId: 60, cardId: "TST060", owner: 0 },
          },
          instanceId: 60,
          sourcePresentationKey: "0:hand:60",
          destinationPresentationKey: "stack:layer:60",
          count: 1,
          confidence: "exact",
        },
        {
          kind: "move",
          source: { kind: "hand", seat: 0 },
          destination: { kind: "pitch", seat: 0 },
          visual: {
            kind: "face",
            card: { instanceId: 61, cardId: "TST061", owner: 0 },
          },
          instanceId: 61,
          sourcePresentationKey: "0:hand:61",
          destinationPresentationKey: "0:pitch:61",
          count: 1,
          confidence: "exact",
        },
      ],
      anchors({ cards: [
        ["0:hand:60", playedSource],
        ["0:hand:61", pitchSource],
      ] }),
      anchors({ cards: [
        ["stack:layer:60", stackDestination],
        ["0:pitch:61", pitchDestination],
      ] }),
      11,
    );

    const stackFlight = batch?.flights.find((flight) => flight.phase === "stack-entry");
    const pitchFlight = batch?.flights.find((flight) => flight.phase === "payment");
    expect(stackFlight?.delayMs).toBe(0);
    expect(pitchFlight?.delayMs).toBe(45);
  });

  it("flips a pitch card before tucking it into the deck bottom", () => {
    const pitchSource = rect(690, 500, 100, 138);
    const deckDestination = rect(820, 500, 100, 138);
    const batch = resolveMotionBatch(
      [{
        kind: "move",
        source: { kind: "pitch", seat: 0 },
        destination: { kind: "deck", seat: 0, position: "bottom" },
        visual: {
          kind: "face-conceal",
          card: { instanceId: 62, cardId: "TST062", owner: 0 },
        },
        instanceId: 62,
        sourcePresentationKey: "0:pitch:62",
        count: 1,
        confidence: "exact",
      }],
      anchors({ cards: [["0:pitch:62", pitchSource]] }),
      anchors({ zones: [["0:deck", deckDestination]] }),
      14,
    );

    expect(batch?.flights).toEqual([
      expect.objectContaining({
        mode: "deck-bottom",
        phase: "cleanup",
        start: pitchSource,
        end: deckDestination,
        visual: {
          kind: "face-conceal",
          card: { instanceId: 62, cardId: "TST062", owner: 0 },
        },
        holdAtSource: true,
      }),
    ]);
    expect(batch?.durationMs).toBe(560);
  });

  it("holds delayed sources and moves unchanged hand cards into their new slots", () => {
    const oldHand = rect(260, 680, 140, 193);
    const newHand = rect(160, 680, 140, 193);
    const batch = resolveMotionBatch(
      [{
        kind: "reflow",
        source: { kind: "hand", seat: 0 },
        destination: { kind: "hand", seat: 0 },
        visual: {
          kind: "face",
          card: { instanceId: 63, cardId: "TST063", owner: 0 },
        },
        instanceId: 63,
        sourcePresentationKey: "0:hand:63",
        destinationPresentationKey: "0:hand:63",
        phase: "draw",
      }],
      anchors({ cards: [["0:hand:63", oldHand]] }),
      anchors({ cards: [["0:hand:63", newHand]] }),
      16,
    );

    expect(batch?.flights).toEqual([
      expect.objectContaining({
        mode: "reflow",
        phase: "draw",
        start: oldHand,
        end: newHand,
        holdAtSource: true,
        destinationPresentationKey: "0:hand:63",
      }),
    ]);
  });

  it("gathers multiple ordered pitch cards before one horizontal bottom-deck flight", () => {
    const firstSource = rect(650, 500, 100, 138);
    const secondSource = rect(670, 514, 100, 138);
    const deckDestination = rect(820, 500, 100, 138);
    const firstCard = { instanceId: 64, cardId: "TST064", owner: 0 };
    const secondCard = { instanceId: 65, cardId: "TST065", owner: 0 };
    const batches = resolveMotionBatches(
      [firstCard, secondCard].map((card): GameMotionEvent => ({
        kind: "move",
        source: { kind: "pitch", seat: 0 },
        destination: { kind: "deck", seat: 0, position: "bottom" },
        visual: { kind: "face-conceal", card },
        instanceId: card.instanceId,
        sourcePresentationKey: `0:pitch:${card.instanceId}`,
        destinationCoverVisual: { kind: "back" },
        count: 1,
        confidence: "exact",
      })),
      anchors({ cards: [
        ["0:pitch:64", firstSource],
        ["0:pitch:65", secondSource],
      ] }),
      anchors({ zones: [["0:deck", deckDestination]] }),
      17,
    );

    expect(batches).toHaveLength(2);
    expect(batches[0]).toEqual(expect.objectContaining({
      id: "17:pitch-gather:0",
      stage: "end-turn",
      durationMs: 180,
    }));
    expect(batches[0]?.flights).toEqual([
      expect.objectContaining({
        mode: "pitch-gather",
        phase: "cleanup",
        start: firstSource,
        end: rect(670, 500, 100, 138),
        count: 1,
        showCount: false,
        delayMs: 0,
      }),
      expect.objectContaining({
        mode: "pitch-gather",
        phase: "cleanup",
        start: secondSource,
        end: rect(670, 500, 100, 138),
        visual: { kind: "face", card: secondCard },
        delayMs: 0,
      }),
    ]);
    expect(batches[1]).toEqual(expect.objectContaining({
      id: "17:pitch-bottom:0",
      stage: "end-turn",
      durationMs: 560,
    }));
    expect(batches[1]?.flights).toEqual([
      expect.objectContaining({
        mode: "deck-bottom",
        phase: "cleanup",
        start: rect(670, 500, 100, 138),
        end: deckDestination,
        visual: { kind: "face-conceal", card: secondCard },
        destinationCoverVisual: { kind: "back" },
        delayMs: 0,
      }),
    ]);
  });

  it("queues arsenal, pitch packet, draw, and turn-start motion in causal order", () => {
    const chosen = { instanceId: 66, cardId: "TST066", owner: 0 };
    const firstPitch = { instanceId: 67, cardId: "TST067", owner: 0 };
    const secondPitch = { instanceId: 68, cardId: "TST068", owner: 0 };
    const drawn = { instanceId: 69, cardId: "TST069", owner: 0 };
    const trigger = { instanceId: 70, cardId: "TST070", owner: 0 };
    const retained = { instanceId: 71, cardId: "TST071", owner: 0 };
    const batches = resolveMotionBatches(
      [
        {
          kind: "move",
          source: { kind: "hand", seat: 0 },
          destination: { kind: "arsenal", seat: 0 },
          visual: { kind: "face", card: chosen },
          instanceId: chosen.instanceId,
          sourcePresentationKey: "0:hand:66",
          destinationPresentationKey: "0:arsenal:66",
          count: 1,
          confidence: "exact",
        },
        ...[firstPitch, secondPitch].map((card): GameMotionEvent => ({
          kind: "move",
          source: { kind: "pitch", seat: 0 },
          destination: { kind: "deck", seat: 0, position: "bottom" },
          visual: { kind: "face-conceal", card },
          instanceId: card.instanceId,
          sourcePresentationKey: `0:pitch:${card.instanceId}`,
          destinationCoverVisual: { kind: "back" },
          count: 1,
          confidence: "exact",
        })),
        {
          kind: "move",
          source: { kind: "deck", seat: 0, position: "top" },
          destination: { kind: "hand", seat: 0 },
          visual: { kind: "face", card: drawn },
          instanceId: drawn.instanceId,
          destinationPresentationKey: "0:hand:69",
          count: 1,
          confidence: "exact",
        },
        {
          kind: "reflow",
          source: { kind: "hand", seat: 0 },
          destination: { kind: "hand", seat: 0 },
          visual: { kind: "face", card: retained },
          instanceId: retained.instanceId,
          sourcePresentationKey: "0:hand:71",
          destinationPresentationKey: "0:hand:71",
          phase: "draw",
        },
        {
          kind: "connect",
          source: { kind: "board", seat: 0 },
          destination: { kind: "stack-layer", index: 0 },
          instanceId: trigger.instanceId,
          sourcePresentationKey: "0:board:70",
          destinationPresentationKey: "stack:layer:70",
          timeline: "turn-start",
        },
      ],
      anchors({
        cards: [
          ["0:hand:66", rect(200, 650)],
          ["0:hand:71", rect(300, 650)],
          ["0:pitch:67", rect(640, 500)],
          ["0:pitch:68", rect(660, 514)],
        ],
        zones: [["0:deck", rect(820, 500)]],
      }),
      anchors({
        cards: [
          ["0:arsenal:66", rect(520, 500)],
          ["0:hand:69", rect(240, 650)],
          ["0:hand:71", rect(140, 650)],
          ["0:board:70", rect(400, 300)],
          ["stack:layer:70", rect(700, 250)],
        ],
        zones: [["0:deck", rect(820, 500)]],
      }),
      18,
    );

    expect(batches.map((batch) => batch.id)).toEqual([
      "18:end-turn:before-pitch",
      "18:pitch-gather:0",
      "18:pitch-bottom:0",
      "18:end-turn:after-pitch",
      "18:turn-start",
    ]);
    expect(batches.map((batch) => batch.flights[0]?.mode ?? "connector")).toEqual([
      "arsenal",
      "pitch-gather",
      "deck-bottom",
      "draw",
      "connector",
    ]);
    for (const batch of batches.slice(0, 3)) {
      expect(batch.flights).toContainEqual(expect.objectContaining({
        mode: "hold",
        start: rect(300, 650),
        end: rect(300, 650),
        durationMs: batch.durationMs,
      }));
    }
    expect(batches[3]?.flights).toContainEqual(expect.objectContaining({
      mode: "reflow",
      start: rect(300, 650),
      end: rect(140, 650),
      maskDestinationWhilePending: true,
    }));
  });

  it("does not infer a bottom tuck for an explicit deck-top placement", () => {
    const source = rect(690, 500, 100, 138);
    const destination = rect(820, 500, 100, 138);
    const batch = resolveMotionBatch(
      [{
        kind: "move",
        source: { kind: "graveyard", seat: 0 },
        destination: { kind: "deck", seat: 0, position: "top" },
        visual: { kind: "back" },
        count: 1,
        confidence: "exact",
      }],
      anchors({ zones: [["0:graveyard", source]] }),
      anchors({ zones: [["0:deck", destination]] }),
      15,
    );

    expect(batch?.flights[0]).toEqual(expect.objectContaining({ mode: "move" }));
    expect(batch?.durationMs).toBe(320);
  });

  it("waits for stack resolution before fading in a resulting token", () => {
    const stackSource = rect(520, 260, 100, 138);
    const graveyardDestination = rect(850, 500, 100, 138);
    const tokenDestination = rect(340, 120, 100, 138);
    const batch = resolveMotionBatch(
      [
        {
          kind: "appear",
          destination: { kind: "board", seat: 0 },
          visual: {
            kind: "face",
            card: { instanceId: 71, cardId: "ARC112", owner: 0 },
          },
          instanceId: 71,
          destinationPresentationKey: "0:board:71",
        },
        {
          kind: "move",
          source: { kind: "stack-layer", index: 0 },
          destination: { kind: "graveyard", seat: 0 },
          visual: {
            kind: "face",
            card: { instanceId: 70, cardId: "TST070", owner: 0 },
          },
          instanceId: 70,
          sourcePresentationKey: "stack:layer:70",
          destinationPresentationKey: "0:graveyard:70",
          count: 1,
          confidence: "exact",
        },
      ],
      anchors({ cards: [["stack:layer:70", stackSource]] }),
      anchors({ cards: [
        ["0:graveyard:70", graveyardDestination],
        ["0:board:71", tokenDestination],
      ] }),
      12,
    );

    const resolution = batch?.flights.find((flight) => flight.phase === "resolution");
    const result = batch?.flights.find((flight) => flight.phase === "result");
    expect(resolution?.delayMs).toBe(0);
    expect(result?.delayMs).toBe(390);
  });

  it("lands an attack on the stack before fading in its created token", () => {
    const handSource = rect(220, 680, 140, 193);
    const stackDestination = rect(520, 260, 100, 138);
    const tokenDestination = rect(340, 120, 100, 138);
    const batch = resolveMotionBatch(
      [
        {
          kind: "move",
          source: { kind: "hand", seat: 0 },
          destination: { kind: "stack-attack" },
          visual: {
            kind: "face",
            card: { instanceId: 72, cardId: "HNT059", owner: 0 },
          },
          instanceId: 72,
          sourcePresentationKey: "0:hand:72",
          destinationPresentationKey: "stack:attack:72",
          count: 1,
          confidence: "exact",
        },
        {
          kind: "appear",
          destination: { kind: "board", seat: 0 },
          visual: {
            kind: "face",
            card: { instanceId: 73, cardId: "SFA037", owner: 0 },
          },
          instanceId: 73,
          destinationPresentationKey: "0:board:73",
        },
      ],
      anchors({ cards: [["0:hand:72", handSource]] }),
      anchors({ cards: [
        ["stack:attack:72", stackDestination],
        ["0:board:73", tokenDestination],
      ] }),
      13,
    );

    const attackArrival = batch?.flights.find((flight) => flight.phase === "stack-entry");
    const tokenAppearance = batch?.flights.find((flight) => flight.phase === "result");
    expect(attackArrival).toEqual(expect.objectContaining({
      mode: "move",
      start: handSource,
      end: stackDestination,
      delayMs: 0,
      destinationLayer: "stack",
    }));
    expect(tokenAppearance).toEqual(expect.objectContaining({
      mode: "appear",
      start: tokenDestination,
      end: tokenDestination,
      delayMs: 390,
    }));
    expect(batch?.connectors).toEqual([]);
  });

  it("layers stack-to-chain travel above its chain destination but below the stack", () => {
    const stackSource = rect(120, 280, 100, 138);
    const chainDestination = rect(460, 330, 100, 138);
    const batch = resolveMotionBatch(
      [{
        kind: "move",
        source: { kind: "stack-attack" },
        destination: { kind: "chain-attack", link: 0 },
        visual: {
          kind: "face",
          card: { instanceId: 80, cardId: "AHA002", owner: 1 },
        },
        instanceId: 80,
        sourcePresentationKey: "stack:attack:80",
        destinationPresentationKey: "chain:0:attack:80",
        count: 1,
        confidence: "exact",
      }],
      anchors({ cards: [["stack:attack:80", stackSource]] }),
      anchors({ cards: [["chain:0:attack:80", chainDestination]] }),
      14,
    );

    expect(batch?.flights).toEqual([expect.objectContaining({
      mode: "move",
      start: stackSource,
      end: chainDestination,
      destinationLayer: "chain",
    })]);
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

    expect(reduced.reducedMotion).toBe(true);
    expect(reduced.flights).toEqual([]);
    expect(reduced.pulses.every((pulse) => pulse.delayMs === 0)).toBe(true);
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
      phase: "trigger",
      start: source,
      end: destination,
      delayMs: 0,
      destinationPresentationKey: "stack:layer:22",
    }]);
  });

  it("splits turn-start motion into the callback-driven batch after end-turn", () => {
    const deck = rect(760, 480, 100, 138);
    const hand = rect(220, 640, 100, 138);
    const source = rect(420, 260, 100, 138);
    const destination = rect(700, 220, 100, 138);
    const batches = resolveMotionBatches(
      [
        {
          kind: "move",
          source: { kind: "deck", seat: 0, position: "top" },
          destination: { kind: "hand", seat: 0 },
          visual: { kind: "back" },
          destinationPresentationKey: "0:hand:opaque",
          count: 1,
          confidence: "inferred",
        },
        {
          kind: "connect",
          source: { kind: "board", seat: 0 },
          destination: { kind: "stack-layer", index: 0 },
          instanceId: 23,
          sourcePresentationKey: "0:board:23",
          destinationPresentationKey: "stack:layer:23",
          timeline: "turn-start",
        },
      ],
      anchors({ zones: [["0:deck", deck]] }),
      anchors({ cards: [
        ["0:hand:opaque", hand],
        ["0:board:23", source],
        ["stack:layer:23", destination],
      ] }),
      9,
    );

    expect(batches).toHaveLength(2);
    expect(batches[0]).toEqual(expect.objectContaining({
      id: "9:end-turn",
      stage: "end-turn",
      connectors: [],
    }));
    expect(batches[0]?.flights[0]).toEqual(expect.objectContaining({
      mode: "draw",
      delayMs: 0,
    }));
    expect(batches[1]).toEqual(expect.objectContaining({
      id: "9:turn-start",
      stage: "turn-start",
      flights: [],
    }));
    expect(batches[1]?.connectors[0]).toEqual(expect.objectContaining({
      phase: "turn-start",
      delayMs: 0,
    }));
  });

  it("measures card and zone attributes in one read phase", () => {
    const cardElement = {
      dataset: {
        motionCard: "0:board:7",
        motionCardAliases: "0:board:8 0:board:9",
      },
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

    expect(measured.snapshot.cards.get("0:board:7")).toEqual(rect(10, 20));
    expect(measured.snapshot.cards.get("0:board:8")).toEqual(rect(10, 20));
    expect(measured.snapshot.cards.get("0:board:9")).toEqual(rect(10, 20));
    expect(measured.snapshot.zones.get("0:hand")).toEqual(rect(0, 0, 600, 220));
    expect(measured.cardElements.get("0:board:8")).toBe(cardElement);
  });

  it("prefers a card-sized zone anchor over a broad hidden-hand container", () => {
    const broadHand = {
      dataset: { motionZone: "1:hand" },
      getBoundingClientRect: () => rect(0, 0, 900, 120),
    } as unknown as HTMLElement;
    const handCard = {
      dataset: { motionZoneAnchor: "1:hand" },
      getBoundingClientRect: () => rect(570, 10, 100, 138),
    } as unknown as HTMLElement;
    const root = {
      querySelectorAll: (selector: string) => {
        if (selector === "[data-motion-zone]") return [broadHand];
        if (selector === "[data-motion-zone-anchor]") return [handCard];
        return [];
      },
    } as unknown as ParentNode;

    const measured = measureMotionAnchors(root);

    expect(measured.snapshot.zones.get("1:hand")).toEqual(rect(570, 10, 100, 138));
  });
});
