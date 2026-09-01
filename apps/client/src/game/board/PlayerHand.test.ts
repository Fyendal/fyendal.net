import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameView, PlayerView } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { handScrollAvailability, PlayerHand } from "./PlayerHand.js";

describe("hand scroll controls", () => {
  it("hides both controls while all cards fit", () => {
    expect(handScrollAvailability({ scrollLeft: 0, clientWidth: 900, scrollWidth: 900 }))
      .toEqual({ left: false, right: false });
  });

  it("shows only the direction containing hidden cards at either edge", () => {
    expect(handScrollAvailability({ scrollLeft: 0, clientWidth: 900, scrollWidth: 1500 }))
      .toEqual({ left: false, right: true });
    expect(handScrollAvailability({ scrollLeft: 600, clientWidth: 900, scrollWidth: 1500 }))
      .toEqual({ left: true, right: false });
  });

  it("shows both controls between the edges", () => {
    expect(handScrollAvailability({ scrollLeft: 240, clientWidth: 900, scrollWidth: 1500 }))
      .toEqual({ left: true, right: true });
  });
});

describe("hand motion anchors", () => {
  it("anchors the hand zone and each projected physical card", () => {
    const player: PlayerView = {
      seat: 0,
      heroCardId: "HERO",
      heroInstanceId: 100,
      heroName: "Hero",
      life: 20,
      actionPoints: 1,
      resources: 0,
      hand: [{ instanceId: 7, cardId: "SBA016", owner: 0 }],
      handCount: 1,
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
    };
    const opponent = { ...player, seat: 1, hand: [], handCount: 0 } as PlayerView;
    const view: GameView = {
      gameId: "game",
      turn: 1,
      phase: "action",
      activePlayer: 0,
      priorityPlayer: 0,
      players: [player, opponent],
      chain: [],
      stack: [],
      ongoing: [],
      pendingDecision: null,
      winner: null,
      log: [],
    };
    const html = renderToStaticMarkup(createElement(PlayerHand, {
      view,
      player,
      viewerSeat: 0,
      spectating: false,
      replaying: false,
      interaction: {
        legalState: {
          playableHand: new Set<number>(),
          playableArsenal: new Set<number>(),
          playableZones: new Map(),
          activatable: new Set<number>(),
          stageableDefenders: new Set<number>(),
          canPass: false,
          canCloseChain: false,
        },
        legalIntents: [],
        selection: { kind: "none" },
        preStackSelectedInstanceId: 7,
        pitchSelection: [],
        selectedPaymentVariants: [],
        stagedIds: new Set<number>(),
        optimisticallyHiddenIds: new Set<number>(),
        defending: false,
        choosingArsenal: false,
        handPick: null,
        onCardClick: () => undefined,
        onSelect: () => undefined,
      },
    }));

    expect(html).toContain('data-motion-zone="0:hand"');
    expect(html).toContain('data-motion-card="0:hand:7"');
    expect(html).toContain("card-selected");
  });

  it("gives a spectator's compact hidden hand stable opaque anchors", () => {
    const player: PlayerView = {
      seat: 0,
      heroCardId: "HERO",
      heroInstanceId: 100,
      heroName: "Hero",
      life: 20,
      actionPoints: 1,
      resources: 0,
      hand: [],
      handCount: 2,
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
    };
    const opponent = { ...player, seat: 1 } as PlayerView;
    const view: GameView = {
      gameId: "spectator-game",
      turn: 1,
      phase: "action",
      activePlayer: 0,
      priorityPlayer: 0,
      players: [player, opponent],
      chain: [],
      stack: [],
      ongoing: [],
      pendingDecision: null,
      winner: null,
      log: [],
    };
    const html = renderToStaticMarkup(createElement(PlayerHand, {
      view,
      player,
      viewerSeat: 0,
      spectating: true,
      replaying: false,
      interaction: {
        legalState: {
          playableHand: new Set<number>(),
          playableArsenal: new Set<number>(),
          playableZones: new Map(),
          activatable: new Set<number>(),
          stageableDefenders: new Set<number>(),
          canPass: false,
          canCloseChain: false,
        },
        legalIntents: [],
        selection: { kind: "none" },
        preStackSelectedInstanceId: null,
        pitchSelection: [],
        selectedPaymentVariants: [],
        stagedIds: new Set<number>(),
        optimisticallyHiddenIds: new Set<number>(),
        defending: false,
        choosingArsenal: false,
        handPick: null,
        onCardClick: () => undefined,
        onSelect: () => undefined,
      },
    }));

    expect(html).toContain('class="hand hand-spectator"');
    expect(html).toContain('data-motion-card="0:hand:opaque"');
    expect(html).toContain('data-motion-card="0:hand:opaque:1"');
  });
});
