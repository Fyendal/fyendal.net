import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameView, PlayerView } from "@fyendal/shared";
import type { StoreState } from "../store/types.js";

const gameStore = vi.hoisted(() => ({ state: {} as StoreState }));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(gameStore.state),
}));

import { GameBoard } from "./GameBoard.js";
import { presentedHandCount } from "./defenderState.js";
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
    authUser: null,
    friends: [],
    setSocialOpen: vi.fn(),
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

describe("staged defender hand presentation", () => {
  it("counts a focused hand card once when another presentation also hides it", () => {
    const view = interactiveView();
    const me = view.players[0]!;
    me.hand.push({ instanceId: 11, cardId: "WTR171", owner: 0 });
    me.handCount = 2;
    view.pendingDecision = {
      player: 0,
      kind: "defend",
      prompt: "",
      stagedCards: [me.hand[0]!],
      stagedHandCount: 1,
    };

    expect(presentedHandCount(view, 0, new Set([10]))).toBe(1);
    view.pendingDecision = null;
    expect(presentedHandCount(view, 0, new Set([10]))).toBe(1);
  });

  it("removes only staged hand cards from the opponent's visible hand", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const view = interactiveView();
    view.pendingDecision = {
      player: 1,
      kind: "defend",
      prompt: "",
      stagedCards: [
        { instanceId: -1, cardId: "", owner: 1, hidden: true, faceDown: true },
        { instanceId: -2, cardId: "", owner: 1, hidden: true, faceDown: true },
        { instanceId: 41, cardId: "TST-EQUIPMENT", owner: 1 },
      ],
      stagedHandCount: 2,
      stagedDefense: 0,
    };
    gameStore.state = { ...liveState(false), view };

    const render = () => renderToStaticMarkup(<TestI18nProvider><GameBoard /></TestI18nProvider>);
    const handBacks = (html: string) => html.match(/data-motion-card="1:hand:opaque(?::\d+)?"/g) ?? [];
    expect(handBacks(render())).toHaveLength(2);

    view.pendingDecision.stagedCards?.push(
      { instanceId: -3, cardId: "", owner: 1, hidden: true, faceDown: true },
      { instanceId: -4, cardId: "", owner: 1, hidden: true, faceDown: true },
    );
    view.pendingDecision.stagedHandCount = 4;
    const emptyHand = render();
    expect(handBacks(emptyHand)).toHaveLength(0);
    expect(emptyHand).toContain("opponent has no cards in hand");

    view.pendingDecision = null;
    expect(handBacks(render())).toHaveLength(4);
  });
});

describe("GameBoard social notifications", () => {
  it("counts unread messages across friends on More without counting invitations", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    gameStore.state = {
      ...liveState(false),
      authUser: "CurrentUser",
      friends: [
        { username: "Alice", presence: "online", friendsSince: 1, unreadCount: 2 },
        { username: "Bob", presence: "offline", friendsSince: 1, unreadCount: 3 },
      ],
      friendRequests: [{ username: "Charlie", direction: "incoming", createdAt: 1 }],
    };
    const html = renderToStaticMarkup(<TestI18nProvider><GameBoard /></TestI18nProvider>);
    expect(html).toContain('aria-label="5 unread messages">5</span>');
  });
});

describe("GameBoard replay result", () => {
  it("shows the game-ending dialog only on the final replay frame", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const first = spectatorView();
    const final = { ...first, phase: "game-over" as const, winner: 1 as const };
    const base = liveState(false);
    gameStore.state = {
      ...base,
      screen: "replay",
      spectating: true,
      view: first,
      replayViews: [first, final],
      replayStep: 0,
      closeReplay: vi.fn(),
    };
    const render = () => renderToStaticMarkup(<TestI18nProvider><GameBoard /></TestI18nProvider>);

    expect(render()).not.toContain('class="overlay gameover-overlay"');
    gameStore.state = { ...gameStore.state, view: final, replayStep: 1 };
    const html = render();
    expect(html).toContain('class="overlay gameover-overlay"');
    expect(html).toContain('<h2 class="gameover-headline">Hero 1 wins!</h2>');
    expect(html).toContain("Exit replay");
    expect(html).not.toContain("Watch replay");
    expect(html).not.toContain("Back to lobby");
  });
});

describe("GameBoard spectator presentation", () => {
  it("shows hidden arsenal card backs for both players", () => {
    gameStore.state = {
      authUser: null,
      friends: [],
      setSocialOpen: vi.fn(),
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
    expect(html).toContain('class="card card-hand card-back"');
    expect(html).toContain('data-motion-card="0:hand:opaque"');
    expect(html).toContain('data-motion-card="1:hand:opaque"');
    expect(html).toContain('data-motion-card="0:arsenal:opaque"');
    expect(html).toContain('data-motion-card="1:arsenal:opaque"');
  });
});

describe("GameBoard pending interactions", () => {
  it("shows a pending attack in the stack until the Attack Step", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const view = interactiveView();
    view.chain[0]!.onStack = true;
    gameStore.state = { ...liveState(false), view };
    const render = () => renderToStaticMarkup(<TestI18nProvider><GameBoard /></TestI18nProvider>);

    const pendingAttack = render();
    expect(pendingAttack).toContain('data-motion-card="stack:layer:30"');
    expect(pendingAttack).not.toContain('data-motion-card="chain:0:attack:30"');
    expect(pendingAttack).toContain('class="float stack-float"');
    expect(pendingAttack).toContain('class="stack-context">LAYER STEP · ATTACK</div>');

    view.chain[0]!.onStack = false;
    view.stack = [{
      card: { instanceId: 1, cardId: "TST-HERO-0", owner: 0 },
      seat: 0,
      label: "Triggered ability",
      optional: false,
    }];
    const withTrigger = render();
    expect(withTrigger).toContain('data-motion-card="chain:0:attack:30"');
    expect(withTrigger).not.toContain('data-motion-card="stack:layer:30"');
    expect(withTrigger).toContain('data-motion-card="stack:layer:1"');
    expect(withTrigger).toContain('data-motion-card="0:hero:1"');
    // Default settings hide guidance, but the stack still identifies its effects.
    expect(withTrigger).toContain('class="stack-label">Triggered ability</div>');
  });

  it("highlights only pitchable hand cards during payment and restores ordinary action cues afterwards", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const state = liveState(false);
    const view = interactiveView();
    const me = view.players[0]!;
    me.hand.push({ instanceId: 11, cardId: "WTR171", owner: 0 });
    me.handCount = 2;
    me.equipment.head = { instanceId: 40, cardId: "TST-EQUIPMENT", owner: 0 };
    me.weapons = [{ instanceId: 41, cardId: "TST-WEAPON", owner: 0 }];
    me.arsenal = [{ instanceId: 42, cardId: "TST-ARSENAL", owner: 0 }];
    me.visibleDeckTop = { instanceId: 43, cardId: "TST-DECK", owner: 0 };
    const actionCandidates = [
      ...state.actionCandidates,
      { kind: "activate-ability" as const, sourceInstanceId: me.heroInstanceId, pitchInstanceIds: [] },
      { kind: "activate-ability" as const, sourceInstanceId: 40, pitchInstanceIds: [] },
      { kind: "activate-ability" as const, sourceInstanceId: 41, pitchInstanceIds: [] },
      { kind: "play-from-arsenal" as const, instanceId: 42, pitchInstanceIds: [] },
      { kind: "play-from-zone" as const, zone: "deck" as const, instanceId: 43, pitchInstanceIds: [] },
    ];
    gameStore.state = { ...state, view, actionCandidates };
    const render = () => renderToStaticMarkup(<TestI18nProvider><GameBoard /></TestI18nProvider>);
    const normal = render();
    const otherCards = ["TST-HAND", "TST-EQUIPMENT", "TST-WEAPON", "TST-HERO-0",
      "TST-BOARD", "TST-CHAIN", "TST-ARSENAL", "TST-DECK"];
    for (const cardId of otherCards) expect(cardClasses(normal, cardId)).toContain("card-highlight");

    view.pendingDecision = {
      player: 0, kind: "choose-target", prompt: "Pay 2 resources", options: ["pitch"],
      resourcePayment: { cost: 2, options: [{ optionId: "pitch", pitchInstanceIds: [11] }] },
    };
    const payment = render();
    for (const cardId of otherCards) {
      expect(cardClasses(payment, cardId)).not.toContain("card-highlight");
      expect(cardClasses(payment, cardId)).not.toContain("card-clickable");
    }
    expect(cardClasses(payment, "WTR171")).toContain("card-highlight");
    expect(cardClasses(payment, "WTR171")).toContain("card-clickable");

    view.pendingDecision = null;
    const restored = render();
    for (const cardId of otherCards) expect(cardClasses(restored, cardId)).toContain("card-highlight");
  });

  it("focuses a pre-stack payment source and locks hand reordering while retaining pitch choices", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const state = liveState(false);
    const view = interactiveView();
    const source = view.players[0]!.hand[0]!;
    const pitch = { instanceId: 11, cardId: "WTR171", owner: 0 };
    view.players[0]!.hand = [source, pitch];
    view.players[0]!.handCount = 2;
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Pay 2 resources",
      options: ["pitch"],
      preStackSource: { card: source, zone: "hand" },
      resourcePayment: { cost: 2, options: [{ optionId: "pitch", pitchInstanceIds: [11] }] },
    };
    gameStore.state = { ...state, view, legal: [{ kind: "choose", optionId: "pitch" }], actionCandidates: [] };
    const html = renderToStaticMarkup(<TestI18nProvider><GameBoard /></TestI18nProvider>);
    expect(html).toContain('class="pitch-focus-card"');
    expect(html).toContain("decision-float-pitch");
    expect(html).toContain('aria-label="0 of 2 pitch resources selected"');
    expect(html).not.toContain("data-hand-instance-id");
    expect(html).not.toContain('aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"');
    expect(cardClasses(html, "WTR171")).toContain("card-clickable");

    gameStore.state = { ...gameStore.state, spectating: true, yourSeat: null };
    const spectatorHtml = renderToStaticMarkup(<TestI18nProvider><GameBoard /></TestI18nProvider>);
    expect(spectatorHtml).not.toContain('class="pitch-focus-card"');
    expect(spectatorHtml).not.toContain("decision-float-pitch");
  });

  it("shows a waiting message without the opponent's pre-stack card", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const view = interactiveView();
    view.activePlayer = 1;
    view.priorityPlayer = 1;
    view.pendingDecision = {
      player: 1, kind: "choose-target", prompt: "",
      preStackSource: {
        card: { instanceId: 90, cardId: "OPPONENT-ANNOUNCED", name: "Pending Action", owner: 1 },
        zone: "hand",
      },
    };
    gameStore.state = { ...liveState(false), view, legal: [], actionCandidates: [] };
    const html = renderToStaticMarkup(<TestI18nProvider><GameBoard /></TestI18nProvider>);
    expect(html).toContain("Hero 1 is deciding…");
    expect(html).not.toContain("OPPONENT-ANNOUNCED");
    expect(html).not.toContain('class="pitch-focus-card"');
  });

  it("keeps a disabled Pass action in both HUD layouts while waiting on the opponent", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    gameStore.state = {
      ...liveState(false),
      view: {
        ...interactiveView(),
        activePlayer: 1,
        priorityPlayer: 1,
      },
      legal: [],
      actionCandidates: [],
    };

    const html = renderToStaticMarkup(
      <TestI18nProvider><GameBoard /></TestI18nProvider>,
    );

    expect(html.match(/class="btn-primary btn-pass shortcut-button"[^>]*disabled=""/g))
      .toHaveLength(2);
    expect(html.match(/title="Pass \(Space\)"/g)).toHaveLength(2);
    expect(html).toContain("mobile-primary-action");
  });

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
