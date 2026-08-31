import { describe, expect, it } from "vitest";
import {
  decodeAccountExportResponse,
  decodeAccountBadgesResponse,
  decodeBugReportResponse,
  decodeApiError,
  decodeClientMessage,
  decodeDeckDetailResponse,
  decodeDeckInvalidResponse,
  decodeDeckResponse,
  decodeDecksResponse,
  decodeGameView,
  decodeLoginResponse,
  decodeOkResponse,
  decodeReplayFile,
  decodeReplayResponse,
  decodeReplaysResponse,
  decodeServerMessage,
  decodeStatsResponse,
} from "../index.js";

const player = (seat: 0 | 1) => ({
  seat,
  heroCardId: `HERO${seat}`,
  heroInstanceId: seat,
  heroName: `Hero ${seat}`,
  life: 20,
  actionPoints: 1,
  resources: 0,
  hand: [],
  handCount: 0,
  deckCount: 40,
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
});

const card = {
  instanceId: 1,
  cardId: "WTR001",
  name: "Bravo, Showstopper",
  owner: 0,
  pitchCount: 2,
  subcards: [{ instanceId: 2, cardId: "UPR043", owner: 0 }],
  grantedNames: ["Surging Strike"],
  attack: 4,
  defense: 3,
  faceDown: false,
  tapped: true,
  defCounters: 1,
  counters: { lesson: 2 },
  playableFromSourceCardId: "HERO0",
  usedAbilityIndexes: [0, 2],
  activatedAbilityLabels: ["Attack", "Reload"],
  life: 1,
  hidden: false,
};

const gameView = () => ({
  gameId: "game",
  turn: 1,
  phase: "action",
  activePlayer: 0,
  priorityPlayer: 1,
  turnFacts: {
    players: [0, 1].map(() => ({
      attacks: 0,
      weaponAttacks: 0,
      playedSubtypes: [],
      usedOncePerTurnEffectSourceIds: [],
      dealtDamage: false,
      physicalDamageDealt: false,
      arcaneDamageDealt: false,
      damageTaken: false,
      physicalDamageTaken: false,
      arcaneDamageTaken: false,
    })),
  },
  players: [{
    ...player(0),
    hand: [card],
    handCount: 1,
    deck: [card],
    visibleDeckTop: card,
    heroDefCounters: 1,
    heroSubcards: [card],
    heroAbilityLabels: ["Attack", "Transform"],
  }, player(1)],
  chain: [{
    attackingCard: card,
    defendingCards: [card],
    attackValue: 4,
    defenseValue: 3,
    attackModifiers: [{ sourceCardId: "WTR001", amount: 2 }],
    defenseModifiers: [{ sourceCardId: "UPR043", amount: -1 }],
    onHitEffects: [{
      sourceCardId: "WTR001",
      text: "When this hits, draw a card.",
      impact: { drawCards: 1, grantsTempo: true },
    }],
    damageToPrevent: 1,
    preventionModifiers: [{ sourceCardId: "UPR043", amount: 1 }],
    damage: 1,
    resolved: false,
    onStack: true,
    hit: false,
    goAgain: true,
    wagered: true,
    wagerRewards: ["Winner creates Gold"],
    dominate: false,
    overpower: true,
    reactions: [card],
    targetAllyName: "Ally",
    targetAlly: card,
  }],
  stack: [{ card, seat: 0, label: "Trigger", optional: true }],
  stackContext: "DAMAGE STEP · ON-HIT TRIGGERS",
  ongoing: [{ seat: 0, cardId: "WTR001", label: "+1" }],
  pendingDecision: {
    player: 1,
    kind: "choose-target",
    prompt: "Choose",
    options: ["1"],
    defaultOption: "1",
    optionCards: [card],
    revealedCards: [card],
    stagedCards: [card],
    stagedDefense: 3,
  },
  winner: null,
  log: ["started"],
});

const playerProfiles = [
  { username: "alice", badge: "early-tester" },
  { username: "bob", badge: null },
];

const summary = {
  id: "deck-id",
  name: "Deck",
  format: "cc",
  fabraryUrl: null,
  heroName: "Hero",
  deckSize: 80,
  updatedAt: 1,
};

const pool = {
  heroId: "HERO0",
  weaponIds: ["WTR001"],
  equipmentPool: ["WTR002"],
  inventoryPool: ["DTD164B"],
  deck: ["WTR003"],
  sideboard: ["WTR004"],
};

describe("client messages", () => {
  const variants = [
    { type: "auth", token: "token" },
    { type: "create-room", format: "classic-battles", hero: "rhinar" },
    { type: "create-room", format: "silver-age", deckId: "deck", private: true },
    { type: "create-bot-room", format: "silver-age", deckId: "precon-sba", bot: "briar" },
    { type: "create-bot-room", format: "cc", deckId: "precon-asr", bot: "ira" },
    { type: "create-bot-room", format: "cc", deckId: "precon-asr", bot: "cindra" },
    { type: "create-bot-room", format: "cc", deckId: "precon-asr", bot: "jarl" },
    { type: "create-bot-room", deckId: "precon-sba" },
    { type: "join-room", code: "ABC123", token: "seat-token", deckId: "deck", hero: "dorinthea", spectate: false },
    { type: "inspect-room", code: "ABC123" },
    { type: "list-rooms" },
    { type: "queue-join", format: "cc", deckId: "deck" },
    { type: "queue-join", format: "cc", deckId: "deck", avoidRoomCodes: ["ABC123", "DEF456"] },
    { type: "queue-leave" },
    { type: "accept-match" },
    { type: "present-deck", deck: { weaponIds: [], equipment: {}, deck: [] } },
    { type: "prep-unready" },
    { type: "choose-first", first: true },
    { type: "priority-mode", mode: "auto-pass" },
    { type: "priority-mode", mode: "always-pause" },
    { type: "runechant-skip", enabled: true },
    { type: "runechant-skip", enabled: false },
    { type: "leave-room" },
    { type: "leave-room", endGame: true },
    { type: "undo" },
    { type: "emote", message: "Thinking..." },
    { type: "claim-victory" },
  ];
  const intents = [
    {
      kind: "play-card",
      instanceId: 1,
      pitchInstanceIds: [],
      pitchRequired: 2,
      targetCardInstanceId: 2,
      boost: true,
      boostCount: 2,
      alternativeCostCardInstanceIds: [3],
      additionalCostSelection: {
        kind: "destroy-controlled-and-or-discard-hand",
        cardLabel: "zombies",
        maximumDestroyed: 3,
        maximumDiscarded: 3,
      },
    },
    { kind: "play-from-arsenal", instanceId: 1, pitchInstanceIds: [], meldSide: "both", boost: true },
    { kind: "play-from-zone", zone: "deck", instanceId: 1, pitchInstanceIds: [], targetAllyId: 2, boost: true },
    { kind: "activate-ability", sourceInstanceId: 1, pitchInstanceIds: [], abilityIndex: 0, alternativeCostCardInstanceIds: [2] },
    { kind: "pass" },
    { kind: "defend", instanceIds: [1], pitchInstanceIds: [2] },
    { kind: "stage-defenders", instanceIds: [1] },
    { kind: "choose", optionId: "yes" },
    { kind: "order-triggers", optionIds: ["41:0", "42:0"] },
    { kind: "skip-runechant" },
    { kind: "close-chain" },
    { kind: "concede" },
  ];

  it("accepts every variant and every intent variant", () => {
    for (const message of variants) {
      expect(decodeClientMessage(message)).toEqual(message);
      expect(decodeClientMessage({ ...message, unknown: true })).toBeNull();
    }
    for (const intent of intents) {
      expect(decodeClientMessage({ type: "intent", intent })).not.toBeNull();
      expect(decodeClientMessage({ type: "intent", intent: { ...intent, unknown: true } })).toBeNull();
    }
    expect(decodeClientMessage({
      type: "intent",
      intent: { kind: "pass" },
      autoPass: true,
    })).not.toBeNull();
    for (const target of ["last-action", "current-turn", "previous-turn"]) {
      expect(decodeClientMessage({ type: "undo", target })).not.toBeNull();
    }
  });

  it("rejects unknown fields, unsafe integers, oversized data, bad nesting, and non-literal Boost", () => {
    expect(decodeClientMessage({ type: "list-rooms", extra: true })).toBeNull();
    expect(decodeClientMessage({ type: "create-bot-room", format: "classic-battles", deckId: "precon-asr" })).toBeNull();
    expect(decodeClientMessage({ type: "create-bot-room", format: "cc", deckId: "precon-asr", bot: "kayo" })).toBeNull();
    expect(decodeClientMessage({ type: "auth", token: "x".repeat(129) })).toBeNull();
    expect(decodeClientMessage({ type: "intent", intent: { kind: "choose", optionId: "x".repeat(257) } })).toBeNull();
    expect(decodeClientMessage({ type: "intent", intent: { kind: "play-card", instanceId: Number.MAX_SAFE_INTEGER + 1, pitchInstanceIds: [] } })).toBeNull();
    expect(decodeClientMessage({ type: "intent", intent: { kind: "play-card", instanceId: 1, pitchInstanceIds: [], pitchRequired: -1 } })).toBeNull();
    expect(decodeClientMessage({ type: "intent", intent: { kind: "defend", instanceIds: Array(257).fill(1) } })).toBeNull();
    expect(decodeClientMessage({ type: "present-deck", deck: { weaponIds: [], equipment: { crown: "x" }, deck: [] } })).toBeNull();
    expect(decodeClientMessage({ type: "intent", intent: { kind: "pass" }, autoPass: false })).toBeNull();
    expect(decodeClientMessage({ type: "intent", intent: { kind: "pass" }, autoPass: "yes" })).toBeNull();
    expect(decodeClientMessage({ type: "priority-mode" })).toBeNull();
    expect(decodeClientMessage({ type: "priority-mode", mode: "sometimes" })).toBeNull();
    expect(decodeClientMessage({ type: "runechant-skip" })).toBeNull();
    expect(decodeClientMessage({ type: "runechant-skip", enabled: "yes" })).toBeNull();
    expect(decodeClientMessage({ type: "undo", target: "entire-game" })).toBeNull();
    expect(decodeClientMessage({ type: "emote", message: "custom text" })).toBeNull();
    expect(decodeClientMessage({ type: "emote", message: "Well played!" })).toBeNull();
    expect(decodeClientMessage({ type: "emote", message: "Hello!", seat: 0 })).toBeNull();
    expect(decodeClientMessage({ type: "queue-join", format: "cc", deckId: "deck", avoidRoomCodes: Array(21).fill("ABC123") })).toBeNull();
    expect(decodeClientMessage({ type: "queue-join", format: "cc", deckId: "deck", avoidRoomCodes: ["bad"] })).toBeNull();
    for (const boost of [false, "true", 1, null]) {
      expect(decodeClientMessage({ type: "intent", intent: { kind: "play-card", instanceId: 1, pitchInstanceIds: [], boost } })).toBeNull();
    }
    for (const boostCount of [0, 1, 9, 2.5, "2", null]) {
      expect(decodeClientMessage({ type: "intent", intent: { kind: "play-card", instanceId: 1, pitchInstanceIds: [], boost: true, boostCount } })).toBeNull();
    }
    expect(decodeClientMessage({ type: "intent", intent: { kind: "play-card", instanceId: 1, pitchInstanceIds: [], boostCount: 2 } })).toBeNull();
  });
});

describe("GameView and server messages", () => {
  it("accepts server-grouped stack layers with a bounded count", () => {
    const grouped = gameView();
    (grouped.stack[0] as typeof grouped.stack[0] & { count: number }).count = 3;
    expect(decodeGameView(grouped)).not.toBeNull();

    const invalid = gameView();
    (invalid.stack[0] as typeof invalid.stack[0] & { count: number }).count = 1;
    expect(decodeGameView(invalid)).toBeNull();
  });

  it("accepts only the presence-only end-turn pass flag", () => {
    expect(decodeGameView({ ...gameView(), endTurnPassPending: true })).not.toBeNull();
    expect(decodeGameView({ ...gameView(), endTurnPassPending: false })).toBeNull();
  });

  it("accepts negative projection-local ids only for hidden card backs", () => {
    const hiddenCard = {
      instanceId: -1,
      cardId: "",
      owner: 1 as const,
      faceDown: true,
      hidden: true,
    };
    const hiddenView = gameView();
    (hiddenView.players[1] as unknown as { graveyard: unknown[] }).graveyard = [hiddenCard];

    expect(decodeGameView(hiddenView)).not.toBeNull();

    const visibleNegativeId = gameView();
    (visibleNegativeId.players[1] as unknown as { graveyard: unknown[] }).graveyard = [{
      ...hiddenCard,
      hidden: false,
    }];
    expect(decodeGameView(visibleNegativeId)).toBeNull();

    const malformedHiddenBack = gameView();
    (malformedHiddenBack.players[1] as unknown as { graveyard: unknown[] }).graveyard = [{
      ...hiddenCard,
      faceDown: false,
    }];
    expect(decodeGameView(malformedHiddenBack)).toBeNull();
  });

  it("does not treat a card's zone index as its nested-subcard depth", () => {
    const view = gameView();
    (view.players[1] as unknown as { graveyard: unknown[] }).graveyard = Array.from({ length: 10 }, (_, index) => ({
      instanceId: 100 + index,
      cardId: `CARD${index}`,
      owner: 1 as const,
    }));

    expect(decodeGameView(view)).not.toBeNull();
  });

  it("still enforces the nested-subcard depth limit", () => {
    const nestedCard = (depth: number, instanceId = 100): Record<string, unknown> => ({
      instanceId,
      cardId: `CARD${instanceId}`,
      owner: 0,
      ...(depth > 0 ? { subcards: [nestedCard(depth - 1, instanceId + 1)] } : {}),
    });
    const atLimit = gameView();
    atLimit.players[0]!.hand = [nestedCard(8) as typeof card];
    const overLimit = gameView();
    overLimit.players[0]!.hand = [nestedCard(9) as typeof card];

    expect(decodeGameView(atLimit)).not.toBeNull();
    expect(decodeGameView(overLimit)).toBeNull();
  });

  it("validates the complete nested view and rejects unknown or malformed nested fields", () => {
    expect(decodeGameView(gameView())).not.toBeNull();
    expect(decodeGameView({
      ...gameView(),
      chain: [{ ...gameView().chain[0], attackModifiers: [{ sourceCardId: "WTR001", amount: "two" }] }],
    })).toBeNull();
    expect(decodeGameView({ ...gameView(), extra: true })).toBeNull();
    const badCard = gameView();
    (badCard.players[0] as unknown as { hand: unknown[] }).hand = [{ ...card, poison: "SECRET" }];
    expect(decodeGameView(badCard)).toBeNull();

    const badCardName = gameView();
    (badCardName.players[0] as unknown as { hand: unknown[] }).hand = [{ ...card, name: 42 }];
    expect(decodeGameView(badCardName)).toBeNull();
    const badSubcard = gameView();
    (badSubcard.players[0] as unknown as { hand: unknown[] }).hand = [{
      ...card,
      subcards: [{ instanceId: 2, cardId: "UPR043", owner: 0, poison: true }],
    }];
    expect(decodeGameView(badSubcard)).toBeNull();
    const badDecision = gameView();
    badDecision.pendingDecision.optionCards = [];
    expect(decodeGameView(badDecision)).toBeNull();
    expect(decodeGameView({
      ...gameView(),
      pendingDecision: { ...gameView().pendingDecision, defaultOption: "missing" },
    })).toBeNull();
    expect(decodeGameView({ ...gameView(), log: Array(201).fill("x") })).toBeNull();
    expect(decodeGameView({ ...gameView(), chain: Array(257).fill(gameView().chain[0]) })).toBeNull();
    const resourcePayment = {
      ...gameView(),
      pendingDecision: {
        player: 0,
        kind: "choose-target",
        prompt: "Pay 4 resources",
        options: ["pay with two cards"],
        resourcePayment: {
          cost: 4,
          options: [{ optionId: "pay with two cards", pitchInstanceIds: [2, 3] }],
        },
      },
    };
    expect(decodeGameView(resourcePayment)).not.toBeNull();
    const triggerOrder = {
      ...gameView(),
      pendingDecision: {
        player: 0,
        kind: "order-triggers",
        prompt: "Order your triggered abilities",
        options: ["41:0", "42:0"],
        optionLabels: ["Create a Might token", "Draw a card"],
        optionCounts: [null, 3],
        optionCards: [card, card],
      },
    };
    expect(decodeGameView(triggerOrder)).not.toBeNull();
    expect(decodeGameView({
      ...triggerOrder,
      pendingDecision: {
        ...triggerOrder.pendingDecision,
        optionLabels: ["missing the second label"],
      },
    })).toBeNull();
    expect(decodeGameView({
      ...resourcePayment,
      pendingDecision: {
        ...resourcePayment.pendingDecision,
        resourcePayment: { ...resourcePayment.pendingDecision.resourcePayment, cost: -1 },
      },
    })).toBeNull();
    expect(decodeGameView({
      ...gameView(),
      gameStats: {
        turns: [{
          turn: 1,
          activePlayer: 0,
          attacks: [1, 0],
          threatened: [4, 0],
          blocked: [0, 2],
          damageDealt: [2, 0],
        }],
      },
    })).not.toBeNull();
    expect(decodeGameView({
      ...gameView(),
      gameStats: {
        turns: [{
          turn: 1,
          activePlayer: 0,
          attacks: [1, -1],
          threatened: [4, 0],
          blocked: [0, 2],
          damageDealt: [2, 0],
        }],
      },
    })).toBeNull();
  });

  it("accepts every server variant", () => {
    const variants = [
      { type: "authed", username: "alice" }, { type: "auth-failed" },
      { type: "room-created", code: "ABC123", seat: 0, token: "token", version: 1 },
      { type: "joined", code: "ABC123", seat: null, token: "", spectator: true, version: 1 },
      { type: "game-started", version: 1 },
      { type: "state", version: 1, view: gameView(), transition: { fromVersion: 0, kind: "forward", events: [{ kind: "move", from: { kind: "deck", seat: 0, position: "top" }, to: { kind: "hand", seat: 0 }, count: 1 }] }, playerProfiles, yourSeat: 0, legal: [{ kind: "play-card", instanceId: 1, pitchInstanceIds: [], boost: true }], actionCandidates: [{ kind: "play-card", instanceId: 2, pitchInstanceIds: [], pitchRequired: 4 }], spectators: 2, lastActionAt: [0, 1], botGame: true },
      { type: "spectators", count: 2, version: 1 },
      { type: "opponent-disconnected", version: 1 }, { type: "opponent-reconnected", version: 1 },
      { type: "emote", seat: 1, message: "Good game!" },
      { type: "rooms", rooms: [{ code: "ABC123", format: "cc", heroes: ["A", null], createdAt: 1, spectateOnly: false, yours: true, allowFutureCards: true }] },
      { type: "room-info", room: { code: "ABC123", format: "silver-age", spectateOnly: true, yours: false, allowFutureCards: true } },
      { type: "queue-status", counts: { "classic-battles": 0, cc: 1, "silver-age": 2 } },
      { type: "queued", format: "silver-age" }, { type: "queue-left" }, { type: "match-timeout" },
      { type: "prep-state", version: 1, prep: { format: "cc", seats: [null, null], yourSeat: 0, die: null, startPlayer: null, botGame: true, allowFutureCards: true, deadlineAt: 30_000, deadlinePhase: "accept" } },
      { type: "left" }, { type: "error", code: "ROOM_NOT_FOUND", message: "gone" },
    ];
    for (const message of variants) {
      expect(decodeServerMessage(message)).not.toBeNull();
      expect(decodeServerMessage({ ...message, unknown: true })).toBeNull();
    }
  });

  it("rejects unknown fields, oversized collections, unsafe versions, and bad Boost", () => {
    expect(decodeServerMessage({ type: "auth-failed", why: "x" })).toBeNull();
    expect(decodeClientMessage({ type: "leave-room", endGame: false })).toBeNull();
    expect(decodeServerMessage({ type: "rooms", rooms: Array(10_001).fill({}) })).toBeNull();
    expect(decodeServerMessage({ type: "game-started", version: 1.5 })).toBeNull();
    expect(decodeServerMessage({ type: "emote", seat: 2, message: "Hello!" })).toBeNull();
    expect(decodeServerMessage({ type: "emote", seat: 0, message: "custom text" })).toBeNull();
    expect(decodeServerMessage({ type: "state", version: 1, view: gameView(), playerProfiles, yourSeat: 0, legal: [{ kind: "play-card", instanceId: 1, pitchInstanceIds: [], boost: false }], lastActionAt: [0, 0] })).toBeNull();
    expect(decodeServerMessage({ type: "state", version: 1, view: gameView(), playerProfiles, yourSeat: 0, legal: [{ kind: "play-card", instanceId: 1, pitchInstanceIds: [], asInstant: true }], lastActionAt: [0, 0] })).not.toBeNull();
    expect(decodeServerMessage({ type: "state", version: 1, view: gameView(), playerProfiles, yourSeat: 0, legal: [{ kind: "play-card", instanceId: 1, pitchInstanceIds: [], asInstant: false }], lastActionAt: [0, 0] })).toBeNull();
    expect(decodeServerMessage({ type: "state", version: 1, view: gameView(), transition: { fromVersion: 0, kind: "replace", events: [{ kind: "move", from: null, to: { kind: "hand", seat: 0 }, count: 1 }] }, playerProfiles, yourSeat: 0, legal: [], lastActionAt: [0, 0] })).toBeNull();
    expect(decodeServerMessage({ type: "state", version: 1, view: gameView(), transition: { fromVersion: 0, kind: "forward", events: [{ kind: "move", from: { kind: "hand", seat: 0, position: "bottom" }, to: { kind: "deck", seat: 0, position: "bottom" }, count: 1 }] }, playerProfiles, yourSeat: 0, legal: [], lastActionAt: [0, 0] })).toBeNull();
  });
});

describe("replays and HTTP responses", () => {
  it("accepts only exact initial replay frames", () => {
    expect(decodeReplayFile({ version: 1, seat: 0, views: [gameView()] })).not.toBeNull();
    expect(decodeReplayFile({ version: 2, seat: 0, frames: [
      { view: gameView(), transition: null },
      { view: { ...gameView(), turn: 2 }, transition: { kind: "forward", events: [{ kind: "move", from: { kind: "deck", seat: 0 }, to: { kind: "hand", seat: 0 }, count: 1 }] } },
    ] })).not.toBeNull();
    expect(decodeReplayFile({ version: 2, seat: 0, views: [gameView()] })).toBeNull();
    expect(decodeReplayFile({ version: 1, seat: 0, views: [gameView()], extra: true })).toBeNull();
    expect(decodeReplayFile({ version: 1, seat: 0, views: Array(10_001).fill(gameView()) })).toBeNull();
  });

  it("decodes every HTTP response shape with exact keys and bounds", () => {
    expect(decodeApiError({ ok: false, error: "bad" })).not.toBeNull();
    expect(decodeOkResponse({ ok: true })).not.toBeNull();
    expect(decodeLoginResponse({ ok: true, token: "token", username: "alice" })).not.toBeNull();
    expect(decodeStatsResponse({ ok: true, inGame: 1, openRooms: 2 })).not.toBeNull();
    expect(decodeBugReportResponse({ ok: true, reportId: "report-id" })).not.toBeNull();
    expect(decodeDecksResponse({
      ok: true,
      decks: [{ ...summary, bannedCards: ["Art of War"], futureCards: ["Tomorrow's Attack"] }],
    })).not.toBeNull();
    expect(decodeDeckResponse({ ok: true, deck: summary })).not.toBeNull();
    expect(decodeDeckDetailResponse({
      ok: true,
      deck: {
        ...summary,
        decklist: pool,
        matchups: [{
          id: "bravo-plan",
          name: "Into Bravo",
          heroIdentifiers: ["bravo_showstopper"],
          preferredTurnOrder: "second",
          notes: "Keep defense reactions.",
        }],
        selectedMatchupId: "bravo-plan",
      },
    })).not.toBeNull();
    expect(decodeDeckInvalidResponse({ ok: false, errors: ["bad"], missing: [], unimplemented: [] })).not.toBeNull();
    expect(decodeAccountBadgesResponse({
      ok: true,
      availableBadges: ["early-tester"],
      selectedBadge: "early-tester",
    })).not.toBeNull();
    expect(decodeAccountBadgesResponse({
      ok: true,
      availableBadges: [],
      selectedBadge: "early-tester",
    })).toBeNull();
    expect(decodeAccountExportResponse({
      ok: true,
      export: {
        exportedAt: "2026-01-01T00:00:00.000Z",
        account: { username: "alice", createdAt: 1, earlyTester: true, selectedBadge: "early-tester" },
        decks: [{
          id: summary.id,
          name: summary.name,
          format: summary.format,
          fabraryUrl: summary.fabraryUrl,
          decklist: pool,
          heroName: summary.heroName,
          createdAt: 1,
          updatedAt: summary.updatedAt,
        }],
        rooms: [{ code: "ABC123", format: "cc", status: "playing", winner: null, createdAt: 1, seat: 0, allowFutureCards: true }],
        matchmaking: {
          format: "silver-age",
          hero: null,
          deckId: "precon-ira",
          retainedRoomCode: "ABC123",
          joinedAt: 2,
        },
        bugReports: [{
          id: "report-id",
          roomCode: "ABC123",
          roomVersion: 2,
          rulesetVersion: "rules-a",
          description: "The attack resolved incorrectly.",
          createdAt: 2,
        }],
        replays: [{
          id: "replay-id",
          finishedAt: 3,
          expiresAt: 4,
          replay: { version: 1, seat: 0, views: [gameView()] },
        }],
      },
    })).not.toBeNull();
    const replaySummary = {
      id: "replay-id",
      format: "cc",
      heroIds: ["HERO0", "HERO1"],
      yourSeat: 0,
      winner: 1,
      finishedAt: 3,
      expiresAt: 4,
      frameCount: 2,
    };
    expect(decodeReplaysResponse({ ok: true, replays: [replaySummary] })).not.toBeNull();
    expect(decodeReplaysResponse({
      ok: true,
      replays: [{ ...replaySummary, winner: null }],
    })).not.toBeNull();
    expect(decodeReplayResponse({ ok: true, replay: { version: 1, seat: 0, views: [gameView()] } })).not.toBeNull();
    const exactResponseCases = [
      [decodeApiError, { ok: false, error: "bad" }],
      [decodeOkResponse, { ok: true }],
      [decodeLoginResponse, { ok: true, token: "token", username: "alice" }],
      [decodeStatsResponse, { ok: true, inGame: 1, openRooms: 2 }],
      [decodeBugReportResponse, { ok: true, reportId: "report-id" }],
      [decodeDecksResponse, { ok: true, decks: [summary] }],
      [decodeDeckResponse, { ok: true, deck: summary }],
      [decodeDeckDetailResponse, { ok: true, deck: { ...summary, decklist: pool } }],
      [decodeDeckInvalidResponse, { ok: false, errors: ["bad"], missing: [], unimplemented: [] }],
      [decodeAccountBadgesResponse, {
        ok: true,
        availableBadges: ["early-tester"],
        selectedBadge: "early-tester",
      }],
      [decodeAccountExportResponse, {
        ok: true,
        export: {
          exportedAt: "2026-01-01T00:00:00.000Z",
          account: { username: "alice", createdAt: 1, earlyTester: true, selectedBadge: "early-tester" },
          decks: [],
          rooms: [],
          matchmaking: null,
          bugReports: [],
          replays: [],
        },
      }],
      [decodeReplaysResponse, { ok: true, replays: [replaySummary] }],
      [decodeReplayResponse, { ok: true, replay: { version: 1, seat: 0, views: [gameView()] } }],
    ] as const;
    for (const [decode, response] of exactResponseCases) {
      expect(decode({ ...response, unknown: true })).toBeNull();
    }
    expect(decodeStatsResponse({ ok: true, inGame: -1, openRooms: 2 })).toBeNull();
    expect(decodeDecksResponse({ ok: true, decks: Array(1_001).fill(summary) })).toBeNull();
    expect(decodeDeckDetailResponse({ ok: true, deck: { ...summary, decklist: { ...pool, nested: {} } } })).toBeNull();
    expect(decodeDeckDetailResponse({
      ok: true,
      deck: {
        ...summary,
        decklist: pool,
        matchups: [{ id: "plan", name: "Plan", preferredTurnOrder: "sometimes" }],
      },
    })).toBeNull();
  });
});
