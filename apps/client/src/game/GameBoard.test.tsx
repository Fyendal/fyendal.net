import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameView, PlayerView } from "@fyendal/shared";
import type { StoreState } from "../store/types.js";

const gameStore = vi.hoisted(() => ({ state: {} as StoreState }));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(gameStore.state),
}));

import { GameBoard } from "./GameBoard.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

afterEach(() => vi.unstubAllGlobals());

function player(seat: 0 | 1): PlayerView {
  return {
    seat,
    heroCardId: `TST-HERO-${seat}`,
    heroInstanceId: seat + 1,
    heroName: `Hero ${seat}`,
    life: 40,
    actionPoints: seat === 0 ? 1 : 0,
    resources: 0,
    hand: [],
    handCount: 4,
    deckCount: 20,
    arsenal: [],
    arsenalCount: 1,
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

function spectatorView(): GameView {
  return {
    gameId: "spectator-arsenal",
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
  };
}

function interactiveView(): GameView {
  const me = {
    ...player(0),
    hand: [{ instanceId: 10, cardId: "TST-HAND", owner: 0 }],
    handCount: 1,
    arsenalCount: 0,
    board: [{ instanceId: 20, cardId: "TST-BOARD", owner: 0 }],
  };
  return {
    ...spectatorView(),
    gameId: "pending-interactions",
    players: [me, player(1)],
    chain: [{
      attackingCard: { instanceId: 30, cardId: "TST-CHAIN", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
    }],
  };
}

function liveState(roomCommandPending: boolean): StoreState {
  return {
    view: interactiveView(),
    viewUpdate: { sequence: 1, source: "server", transition: "replace" },
    playerProfiles: null,
    legal: [{ kind: "pass" }],
    actionCandidates: [
      { kind: "play-card", instanceId: 10, pitchInstanceIds: [] },
      { kind: "activate-ability", sourceInstanceId: 20, abilityIndex: 0, pitchInstanceIds: [] },
      { kind: "activate-ability", sourceInstanceId: 30, abilityIndex: 0, pitchInstanceIds: [] },
    ],
    roomCommandPending,
    pendingInteraction: null,
    pendingDefenderStageIds: null,
    yourSeat: 0,
    spectating: false,
    spectatorCount: 0,
    botGame: false,
    sendIntent: vi.fn(),
    sendPriorityMode: vi.fn(),
    sendRunechantSkip: vi.fn(),
    sendEmote: vi.fn(),
    latestEmote: null,
    undo: vi.fn(),
    error: null,
    leave: vi.fn(),
    opponentConnected: true,
    connected: true,
    connectionIssueVisible: false,
    roomCode: "ABC123",
    screen: "game",
    replayFrames: 0,
    replayNotes: [],
    setReplayNote: vi.fn(),
    watchReplay: vi.fn(),
    downloadReplay: vi.fn(),
    getRecordedViews: vi.fn(() => []),
    lastActionAt: null,
    claimVictory: vi.fn(),
    reportBug: vi.fn(),
    backgroundMatchmaking: { state: "inactive" },
    stopBackgroundMatchmaking: vi.fn(),
  } as unknown as StoreState;
}

function cardClasses(html: string, cardId: string): string {
  const match = html.match(new RegExp(`<div class="(card [^"]*)" data-cardid="${cardId}"`));
  if (!match?.[1]) throw new Error(`Card ${cardId} was not rendered`);
  return match[1];
}

describe("GameBoard spectator presentation", () => {
  it("shows hidden arsenal card backs for both players", () => {
    gameStore.state = {
      view: spectatorView(),
      viewUpdate: { sequence: 1, source: "server", transition: "replace" },
      playerProfiles: null,
      legal: [],
      actionCandidates: [],
      roomCommandPending: false,
      pendingInteraction: null,
      pendingDefenderStageIds: null,
      yourSeat: null,
      spectating: true,
      spectatorCount: 1,
      botGame: false,
      sendIntent: vi.fn(),
      sendPriorityMode: vi.fn(),
      sendRunechantSkip: vi.fn(),
      sendEmote: vi.fn(),
      latestEmote: null,
      undo: vi.fn(),
      error: null,
      leave: vi.fn(),
      opponentConnected: true,
      connected: true,
      roomCode: "ABC123",
      screen: "game",
      replayFrames: 0,
      replayNotes: [],
      setReplayNote: vi.fn(),
      watchReplay: vi.fn(),
      downloadReplay: vi.fn(),
      getRecordedViews: vi.fn(() => []),
      lastActionAt: null,
      claimVictory: vi.fn(),
      reportBug: vi.fn(),
      backgroundMatchmaking: { state: "inactive" },
      stopBackgroundMatchmaking: vi.fn(),
    } as unknown as StoreState;

    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    const html = renderToStaticMarkup(
      <TestI18nProvider><GameBoard /></TestI18nProvider>,
    );

    expect(html).toContain('class="hand"');
    expect(html).toContain('class="card card-hand card-back ');
    expect(html).toContain('data-motion-card="0:hand:opaque"');
    expect(html).toContain('data-motion-card="1:hand:opaque"');
    expect(html).toContain('data-motion-card="0:arsenal:opaque"');
    expect(html).toContain('data-motion-card="1:arsenal:opaque"');
  });
});

describe("GameBoard pending interactions", () => {
  it("locks playable hand cards and board or combat-chain abilities with the primary action", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    gameStore.state = liveState(false);
    const interactiveHtml = renderToStaticMarkup(
      <TestI18nProvider><GameBoard /></TestI18nProvider>,
    );

    for (const cardId of ["TST-HAND", "TST-BOARD", "TST-CHAIN"]) {
      expect(cardClasses(interactiveHtml, cardId)).toContain("card-highlight");
      expect(cardClasses(interactiveHtml, cardId)).toContain("card-clickable");
    }

    gameStore.state = liveState(true);
    const pendingHtml = renderToStaticMarkup(
      <TestI18nProvider><GameBoard /></TestI18nProvider>,
    );

    for (const cardId of ["TST-HAND", "TST-BOARD", "TST-CHAIN"]) {
      expect(cardClasses(pendingHtml, cardId)).not.toContain("card-highlight");
      expect(cardClasses(pendingHtml, cardId)).not.toContain("card-clickable");
    }
    expect(pendingHtml.match(/class="btn-primary btn-pass shortcut-button"[^>]*disabled=""/g))
      .toHaveLength(2);
  });
});
