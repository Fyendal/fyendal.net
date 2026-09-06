import { describe, expect, it } from "vitest";
import type { GameLogViewEntry, GameView, PlayerView } from "@fyendal/shared";
import type { GameMotionEvent } from "../motion/motionTypes.js";
import {
  damageSoundCuesForViews,
  gameSoundCuesForEvents,
  prioritySoundCueForViews,
} from "./gameSoundCues.js";

const card = (instanceId: number) => ({
  instanceId,
  cardId: `CARD-${instanceId}`,
  owner: 0,
});

function player(seat: number): PlayerView {
  return {
    seat,
    heroCardId: `hero-${seat}`,
    heroInstanceId: 100 + seat,
    heroName: `Hero ${seat}`,
    life: 20,
    actionPoints: 1,
    resources: 0,
    hand: [],
    handCount: 0,
    deckCount: 30,
    arsenal: [],
    arsenalCount: 0,
    pitch: [],
    pitchCount: 0,
    graveyard: [],
    banish: [],
    soul: [],
    equipment: {},
    weapons: [],
    board: [],
  };
}

function view(overrides: Partial<GameView> = {}): GameView {
  return {
    gameId: "game",
    turn: 1,
    phase: "action",
    activePlayer: 0,
    priorityPlayer: 0,
    players: [player(0), player(1)],
    chain: [],
    stack: [],
    ongoing: [],
    pendingDecision: null,
    winner: null,
    log: [],
    ...overrides,
  };
}

describe("game sound cues", () => {
  it("alerts once when an unattended player receives priority", () => {
    expect(prioritySoundCueForViews(
      view({ priorityPlayer: 1 }),
      view({ priorityPlayer: 0 }),
      0,
      true,
    )).toEqual([{ kind: "priority", delayMs: 0 }]);
  });

  it("keeps foreground, repeated, spectator, and mandatory-decision priority quiet", () => {
    const opponentPriority = view({ priorityPlayer: 1 });
    const ownPriority = view({ priorityPlayer: 0 });
    expect(prioritySoundCueForViews(opponentPriority, ownPriority, 0, false)).toEqual([]);
    expect(prioritySoundCueForViews(ownPriority, ownPriority, 0, true)).toEqual([]);
    expect(prioritySoundCueForViews(opponentPriority, ownPriority, null, true)).toEqual([]);
    expect(prioritySoundCueForViews(opponentPriority, view({
      phase: "defend",
      priorityPlayer: 0,
      pendingDecision: { player: 0, kind: "defend", prompt: "Defend" },
    }), 0, true)).toEqual([]);
  });

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

  it("sounds combat damage as a slash and arcane damage as a zap", () => {
    const before: GameLogViewEntry = {
      fallback: "Before",
      sequence: 4,
      message: { id: "engine.log.before" },
    };
    const slash: GameLogViewEntry = {
      fallback: "Attack hits",
      sequence: 5,
      message: { id: "engine.log.damage.hit" },
      event: { kind: "damage", targetSeat: 1, amount: 4, damageType: "physical" },
    };
    const physicalEffect: GameLogViewEntry = {
      fallback: "Effect deals damage",
      sequence: 6,
      message: { id: "card.log.effect.damage" },
      event: { kind: "damage", targetSeat: 1, amount: 1, damageType: "physical" },
    };
    const zap: GameLogViewEntry = {
      fallback: "Hero takes arcane damage",
      sequence: 7,
      message: { id: "engine.log.damage.hero.takes.arcane" },
      event: { kind: "damage", targetSeat: 1, amount: 1, damageType: "arcane" },
    };

    expect(damageSoundCuesForViews(
      view({ log: [before.fallback], logEntries: [before] }),
      view({
        log: [before.fallback, slash.fallback, physicalEffect.fallback, zap.fallback],
        logEntries: [before, slash, physicalEffect, zap],
      }),
    )).toEqual([
      { kind: "slash", delayMs: 0 },
      { kind: "zap", delayMs: 90 },
    ]);
  });

  it("does not replay historical damage or sound raw life loss", () => {
    const damage: GameLogViewEntry = {
      fallback: "Attack hits",
      sequence: 2,
      message: { id: "engine.log.damage.hit" },
      event: { kind: "damage", targetSeat: 1, amount: 2, damageType: "physical" },
    };
    const existing = view({ log: [damage.fallback], logEntries: [damage] });

    expect(damageSoundCuesForViews(existing, existing)).toEqual([]);
    expect(damageSoundCuesForViews(
      view({ players: [player(0), player(1)] }),
      view({ players: [player(0), { ...player(1), life: 19 }] }),
    )).toEqual([]);
  });
});
