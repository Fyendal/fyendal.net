import { describe, expect, it } from "vitest";
import type { ChainLinkView } from "@fyendal/shared";
import { motionCombatPresentation } from "./combatMotionPresentation.js";
import { completeMotionBatch, enqueueMotionBatch, EMPTY_MOTION_BATCH_QUEUE } from "./motionBatchQueue.js";
import { resolveMotionBatch, type GameMotionBatch, type MotionAnchorSnapshot } from "./motionGeometry.js";

const card = { instanceId: 42, cardId: "SBA016", owner: 0 };
const link: ChainLinkView = {
  attackingCard: card, defendingCards: [], reactions: [],
  attackValue: 3, defenseValue: 0, damage: 3, resolved: false,
};
const stack = [{ card, seat: 0, label: "Attack layer", optional: false }];
const onStack = { chain: [], stack, context: "LAYER STEP · ATTACK" };
const current = { chain: [link], stack: [], context: undefined };
const none = new Set<string>();
const rect = (left: number) => ({ left, top: 0, width: 100, height: 138 });

function resolutionBatch(): GameMotionBatch {
  const previous: MotionAnchorSnapshot = {
    cards: new Map([["stack:layer:42", rect(300)], ["0:hand:7", rect(0)]]),
    zones: new Map(),
  };
  const next: MotionAnchorSnapshot = {
    cards: new Map([["chain:0:attack:42", rect(600)], ["0:hand:7", rect(100)]]),
    zones: new Map(),
  };
  const batch = resolveMotionBatch([
    {
      kind: "reflow", source: { kind: "hand", seat: 0 }, destination: { kind: "hand", seat: 0 },
      sourcePresentationKey: "0:hand:7", destinationPresentationKey: "0:hand:7",
      visual: { kind: "back" }, phase: "movement",
    },
    {
      kind: "move", source: { kind: "stack-layer", index: 0 }, destination: { kind: "chain-attack", link: 0 },
      sourcePresentationKey: "stack:layer:42", destinationPresentationKey: "chain:0:attack:42",
      visual: { kind: "face", card }, instanceId: 42, count: 1, confidence: "exact",
    },
  ], previous, next, "resolution")!;
  return { ...batch, combatPresentation: current, sourceCombatPresentation: onStack };
}

describe("attack float motion lifecycle", () => {
  it("switches floats on the attack's departure, not activation of its delayed batch", () => {
    const entry: GameMotionBatch = {
      id: "entry", flights: [], connectors: [], durationMs: 320, combatPresentation: onStack,
    };
    const resolution = resolutionBatch();
    const attack = resolution.flights.find((flight) => flight.destinationLayer === "chain")!;
    const reflow = resolution.flights.find((flight) => flight.mode === "reflow")!;
    expect(attack.delayMs).toBeGreaterThan(0);
    expect(attack.sourceMaskPresentationKey).toBe("stack:layer:42");
    const queued = enqueueMotionBatch(
      enqueueMotionBatch(EMPTY_MOTION_BATCH_QUEUE, entry).queue, resolution,
    ).queue;
    const waiting = { ...current, stack, context: onStack.context, deferChain: true, deferStack: false };
    expect(motionCombatPresentation(current, queued, none)).toEqual(waiting);
    const resolving = completeMotionBatch(queued, entry.id);
    expect(motionCombatPresentation(current, resolving, none)).toEqual(waiting);
    expect(motionCombatPresentation(current, resolving, new Set([reflow.id]))).toEqual(waiting);
    expect(motionCombatPresentation(current, resolving, new Set([attack.id]))).toEqual({
      ...current, deferChain: false, deferStack: false,
    });
  });

  it("opens the stack when its incoming card starts, including a queued entry", () => {
    const entry: GameMotionBatch = {
      id: "entry", combatPresentation: onStack, durationMs: 610, connectors: [],
      flights: [{
        id: "entry:attack", phase: "stack-entry", mode: "move",
        start: rect(0), end: rect(300), visual: { kind: "face", card },
        count: 1, showCount: false, delayMs: 290,
        destinationLayer: "stack", destinationPresentationKey: "stack:layer:42",
      }],
    };
    const queue = { active: entry, pending: [] };
    expect(motionCombatPresentation(onStack, queue, none).deferStack).toBe(true);
    expect(motionCombatPresentation(onStack, queue, new Set(["other"])).deferStack).toBe(true);
    expect(motionCombatPresentation(onStack, queue, new Set(["entry:attack"])).deferStack).toBe(false);
    const queued = { active: resolutionBatch(), pending: [entry] };
    expect(motionCombatPresentation(onStack, queued, none).deferStack).toBe(true);
  });

  it("settles immediately after cancellation or with motion disabled", () => {
    expect(motionCombatPresentation(current, EMPTY_MOTION_BATCH_QUEUE, none)).toEqual({
      ...current, deferChain: false, deferStack: false,
    });
  });

  it("keeps the chain visible when its attack creates a trigger on the stack", () => {
    const trigger = { ...resolutionBatch(), flights: [], combatPresentation: { ...current, stack } };
    expect(motionCombatPresentation(current, { active: trigger, pending: [] }, none).deferChain).toBe(false);
  });
});
