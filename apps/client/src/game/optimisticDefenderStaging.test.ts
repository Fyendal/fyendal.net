import { describe, expect, it } from "vitest";
import type { CardView, GameView, PlayerView } from "@fyendal/shared";
import { optimisticDefenderView } from "./optimisticDefenderStaging.js";

function player(seat: 0 | 1, overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    seat,
    heroCardId: `HERO-${seat}`,
    heroInstanceId: 100 + seat,
    heroName: `Hero ${seat}`,
    life: 20,
    actionPoints: 1,
    resources: 0,
    hand: [],
    handCount: 0,
    deckCount: 0,
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
    ...overrides,
  };
}

function defendView(defender: PlayerView): GameView {
  return {
    gameId: "game",
    turn: 1,
    phase: "action",
    activePlayer: 1,
    priorityPlayer: 0,
    players: [defender, player(1)],
    chain: [],
    stack: [],
    ongoing: [],
    pendingDecision: {
      player: 0,
      kind: "defend",
      prompt: "Choose defenders",
      stagedCards: [],
      stagedDefense: 0,
    },
    winner: null,
    log: [],
  };
}

describe("optimistic defender staging", () => {
  it("projects requested hand, arsenal, equipment, board, and hero cards without mutating rules state", () => {
    const hand: CardView = { instanceId: 11, cardId: "HAND", owner: 0 };
    const equipment: CardView = { instanceId: 12, cardId: "HEAD", owner: 0 };
    const ally: CardView = { instanceId: 13, cardId: "ALLY", owner: 0 };
    const arsenal: CardView = { instanceId: 14, cardId: "AMBUSH", owner: 0, faceDown: true };
    const view = defendView(player(0, {
      hand: [hand],
      handCount: 1,
      arsenal: [arsenal],
      arsenalCount: 1,
      equipment: { head: equipment },
      board: [ally],
    }));

    const projected = optimisticDefenderView(view, 0, [11, 14, 12, 13, 100]);

    expect(projected).not.toBe(view);
    expect(projected?.pendingDecision?.kind).toBe("defend");
    if (projected?.pendingDecision?.kind !== "defend") throw new Error("expected defend decision");
    expect(projected.pendingDecision.stagedCards?.map((card) => card.instanceId))
      .toEqual([11, 14, 12, 13, 100]);
    expect(projected.pendingDecision.stagedDefense).toBe(0);
    expect(view.pendingDecision?.kind === "defend" && view.pendingDecision.stagedCards).toEqual([]);
  });

  it("returns the authoritative object when no optimistic set applies", () => {
    const view = defendView(player(0));
    expect(optimisticDefenderView(view, 0, null)).toBe(view);
    expect(optimisticDefenderView(view, 1, [101])).toBe(view);
  });
});
