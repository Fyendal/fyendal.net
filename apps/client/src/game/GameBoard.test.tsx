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
      watchReplay: vi.fn(),
      downloadReplay: vi.fn(),
      getRecordedViews: vi.fn(() => []),
      lastActionAt: null,
      claimVictory: vi.fn(),
      reportBug: vi.fn(),
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
