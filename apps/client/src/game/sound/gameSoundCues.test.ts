import { describe, expect, it } from "vitest";
import type { GameMotionEvent } from "../motion/motionTypes.js";
import { gameSoundCuesForEvents } from "./gameSoundCues.js";

const card = (instanceId: number) => ({
  instanceId,
  cardId: `CARD-${instanceId}`,
  owner: 0,
});

describe("game sound cues", () => {
  it("sounds a played card at stack entry without sounding its pitch payment", () => {
    const events: GameMotionEvent[] = [
      {
        kind: "move",
        source: { kind: "hand", seat: 0 },
        destination: { kind: "stack-layer", index: 0 },
        visual: { kind: "face", card: card(1) },
        count: 1,
        confidence: "exact",
      },
      {
        kind: "move",
        source: { kind: "hand", seat: 0 },
        destination: { kind: "pitch", seat: 0 },
        visual: { kind: "face", card: card(2) },
        count: 1,
        confidence: "exact",
      },
    ];

    expect(gameSoundCuesForEvents(events, [])).toEqual([
      { kind: "play", delayMs: 0 },
    ]);
  });

  it("waits for arsenaling before staggering each card in a draw-up", () => {
    const events: GameMotionEvent[] = [
      {
        kind: "move",
        source: { kind: "hand", seat: 0 },
        destination: { kind: "arsenal", seat: 0 },
        visual: { kind: "face", card: card(3) },
        count: 1,
        confidence: "exact",
      },
      {
        kind: "move",
        source: { kind: "deck", seat: 0 },
        destination: { kind: "hand", seat: 0 },
        visual: { kind: "back" },
        count: 4,
        confidence: "inferred",
      },
    ];

    expect(gameSoundCuesForEvents(events, [])).toEqual([
      { kind: "draw", delayMs: 390 },
      { kind: "draw", delayMs: 475 },
      { kind: "draw", delayMs: 560 },
      { kind: "draw", delayMs: 645 },
    ]);
  });

  it("does not treat a trigger connection or stack resolution as another play", () => {
    const events: GameMotionEvent[] = [
      {
        kind: "connect",
        source: { kind: "chain-defender", link: 0, index: 0 },
        destination: { kind: "stack-layer", index: 0 },
        instanceId: 4,
        sourcePresentationKey: "chain:0:defender:0:4",
        destinationPresentationKey: "stack:layer:4",
      },
      {
        kind: "move",
        source: { kind: "stack-attack" },
        destination: { kind: "chain-attack", link: 0 },
        visual: { kind: "face", card: card(5) },
        count: 1,
        confidence: "exact",
      },
    ];

    expect(gameSoundCuesForEvents(events, [])).toEqual([]);
  });

  it("sounds each public shuffle announcement once", () => {
    expect(gameSoundCuesForEvents([], [{
      kind: "shuffle",
      cardIds: [],
      label: "Hero 0 shuffles their deck",
      seat: 0,
    }])).toEqual([{ kind: "shuffle", delayMs: 0 }]);
  });
});
