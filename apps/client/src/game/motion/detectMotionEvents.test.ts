import { describe, expect, it } from "vitest";
import type { CardView, GameView, PlayerView } from "@fyendal/shared";
import { detectGameMotionEvents } from "./detectMotionEvents.js";
import { transitionMotionEvents } from "./transitionMotionEvents.js";
import { extractGamePresentations } from "./extractPresentations.js";
import { focusHandReflows } from "./handReflow.js";
import { resolveMotionBatch } from "./motionGeometry.js";

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

function view(
  players: [PlayerView, PlayerView],
  overrides: Partial<GameView> = {},
): GameView {
  return {
    gameId: "game",
    turn: 1,
    phase: "action",
    activePlayer: 0,
    priorityPlayer: 0,
    players,
    chain: [],
    stack: [],
    ongoing: [],
    pendingDecision: null,
    winner: null,
    log: [],
    ...overrides,
  };
}

const face = (instanceId: number, owner = 0): CardView => ({
  instanceId,
  cardId: `CARD-${instanceId}`,
  owner,
});

describe("game motion detection", () => {
  it.each(["pitch", "graveyard", "banish", "stack"] as const)("closes hand gaps for cards leaving for %s", (zone) => {
    const cards = [face(1), face(2), face(3)];
    const previous = view([player(0, { hand: cards, handCount: 3 }), player(1)]);
    const current = view([player(0, {
      hand: [cards[0]!, cards[2]!], handCount: 2,
      ...(zone === "pitch" ? { pitch: [cards[1]!], pitchCount: 1 } : {}),
      ...(zone === "graveyard" ? { graveyard: [cards[1]!] } : {}),
      ...(zone === "banish" ? { banish: [cards[1]!] } : {}),
    }), player(1)], zone === "stack"
      ? { stack: [{ card: cards[1]!, seat: 0, label: "Played card", optional: false }] } : {});
    const reflows = detectGameMotionEvents(previous, current).flatMap((event) =>
      event.kind === "reflow" && event.instanceId !== undefined ? [event.instanceId] : []);
    expect(reflows).toEqual([1, 3]);
  });

  it("closes the focus gap without a game update or a duplicate hand copy of the focused card", () => {
    const game = view([player(0, { hand: [face(1), face(2), face(3)], handCount: 3 }), player(1)]);
    const presentations = extractGamePresentations(game);
    const events = focusHandReflows(presentations, presentations, [], [2]);
    const rect = (left: number, width = 100) => ({ left, top: 600, width, height: 138 });
    const batch = resolveMotionBatch(events, {
      cards: new Map([["0:hand:1", rect(100)], ["0:hand:2", rect(210)], ["0:hand:3", rect(320)]]),
      zones: new Map(), focusSources: new Map(),
    }, {
      cards: new Map([["0:hand:1", rect(155)], ["0:hand:3", rect(265)]]),
      zones: new Map(), focusSources: new Map([[2, rect(360, 260)]]),
    }, "focus-gap");
    expect(batch?.flights.map((flight) => flight.destinationPresentationKey)).toEqual(["0:hand:1", "0:hand:3"]);
    expect(batch?.flights.every((flight) => flight.mode === "reflow" && flight.delayMs === 0)).toBe(true);
    expect(focusHandReflows(presentations, presentations, [2], [2])).toEqual([]);
    expect(focusHandReflows(presentations, presentations, [2], []).length).toBeGreaterThan(0);
  });

  it("slides only surviving hand cards after optimistic and authoritative pitching", () => {
    const cards = [face(1), face(2), face(3)];
    const previous = view([player(0, { hand: cards, handCount: 3 }), player(1)]);
    const current = view([player(0, { hand: [cards[0]!, cards[2]!], handCount: 2,
      pitch: [cards[1]!], pitchCount: 1 }), player(1)]);
    const semantic = { fromVersion: 1, kind: "forward" as const, events: [{
      kind: "move" as const, from: { kind: "hand" as const, seat: 0 },
      to: { kind: "pitch" as const, seat: 0 }, instanceId: 2, count: 1,
    }] };
    for (const events of [detectGameMotionEvents(previous, current), transitionMotionEvents(previous, current, semantic, "forward")]) {
      expect(events.flatMap((event) => event.kind === "reflow" && event.instanceId !== undefined
        ? [[event.instanceId, event.phase]] : [])).toEqual([[1, "movement"], [3, "movement"]]);
    }
    expect(transitionMotionEvents(current, current, semantic, "forward", { sourceIncludesPredictedTransition: true }))
      .toEqual([]);
  });

  it("slides anonymous opponent hand slots without assigning identities to them", () => {
    const previous = view([player(0), player(1, { handCount: 4 })]);
    const current = view([player(0), player(1, { handCount: 2, pitch: [face(8, 1), face(9, 1)], pitchCount: 2 })]);
    const reflows = detectGameMotionEvents(previous, current).filter((event) => event.kind === "reflow");
    expect(reflows.map((event) => event.sourcePresentationKey)).toEqual(["1:hand:opaque", "1:hand:opaque:1"]);
    expect(reflows.every((event) => event.visual.kind === "back" && event.instanceId === undefined)).toBe(true);
  });

  it("matches a visible card moving from hand to pitch by instance id", () => {
    const card = face(1);
    const previous = view([
      player(0, { hand: [card], handCount: 1 }),
      player(1),
    ]);
    const current = view([
      player(0, { pitch: [card], pitchCount: 1 }),
      player(1),
    ]);

    expect(detectGameMotionEvents(previous, current)).toEqual([{
      kind: "move",
      source: { kind: "hand", seat: 0 },
      destination: { kind: "pitch", seat: 0 },
      visual: { kind: "face", card },
      instanceId: 1,
      sourcePresentationKey: "0:hand:1",
      destinationPresentationKey: "0:pitch:1",
      count: 1,
      confidence: "exact",
    }]);
  });

  it("clones equipment into a new combat-chain presentation", () => {
    const equipment = face(2);
    const previous = view([
      player(0, { equipment: { chest: equipment } }),
      player(1),
    ]);
    const current = view(
      [player(0, { equipment: { chest: equipment } }), player(1)],
      {
        chain: [{
          attackingCard: face(9, 1),
          defendingCards: [equipment],
          attackValue: 4,
          defenseValue: 2,
          damage: 0,
          resolved: false,
          reactions: [],
        }],
      },
    );

    expect(detectGameMotionEvents(previous, current)).toContainEqual({
      kind: "move",
      source: { kind: "equipment", seat: 0, slot: "chest" },
      destination: { kind: "chain-defender", link: 0, index: 0 },
      visual: { kind: "face", card: equipment },
      instanceId: 2,
      sourcePresentationKey: "0:equipment:chest:2",
      destinationPresentationKey: "chain:0:defender:0:2",
      count: 1,
      confidence: "exact",
    });
  });

  it("moves a back from a hidden opponent hand and reveals only at the stack", () => {
    const attack = face(3, 1);
    const previous = view([player(0), player(1, { handCount: 1 })]);
    const current = view(
      [player(0), player(1, { handCount: 0 })],
      {
        chain: [{
          attackingCard: attack,
          defendingCards: [],
          attackValue: 4,
          defenseValue: 0,
          damage: 0,
          resolved: false,
          onStack: true,
          reactions: [],
        }],
      },
    );

    expect(detectGameMotionEvents(previous, current)).toEqual([{
      kind: "move",
      source: { kind: "hand", seat: 1 },
      destination: { kind: "stack-attack" },
      visual: { kind: "back-reveal", card: attack },
      instanceId: 3,
      destinationPresentationKey: "stack:attack:3",
      count: 1,
      confidence: "inferred",
    }]);
  });

  it("moves a resolved attack from the stack onto its combat-chain link", () => {
    const attack = face(4);
    const stackLink = {
      attackingCard: attack,
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 0,
      resolved: false,
      onStack: true,
      reactions: [],
    };
    const previous = view([player(0), player(1)], { chain: [stackLink] });
    const current = view(
      [player(0), player(1)],
      { chain: [{ ...stackLink, onStack: false }] },
    );

    expect(detectGameMotionEvents(previous, current)).toEqual([{
      kind: "move",
      source: { kind: "stack-attack" },
      destination: { kind: "chain-attack", link: 0 },
      visual: { kind: "face", card: attack },
      instanceId: attack.instanceId,
      sourcePresentationKey: `stack:attack:${attack.instanceId}`,
      destinationPresentationKey: `chain:0:attack:${attack.instanceId}`,
      count: 1,
      confidence: "exact",
    }]);
  });

  it("treats a token created with an attack as a fade-in, not a card move", () => {
    const attack = { ...face(6), cardId: "HNT059" };
    const token = { ...face(7), cardId: "SFA037" };
    const previous = view([
      player(0, { hand: [attack], handCount: 1 }),
      player(1),
    ]);
    const current = view(
      [player(0, { board: [token] }), player(1)],
      {
        chain: [{
          attackingCard: attack,
          defendingCards: [],
          attackValue: 4,
          defenseValue: 0,
          damage: 0,
          resolved: false,
          onStack: true,
          reactions: [],
        }],
      },
    );

    const events = detectGameMotionEvents(previous, current);
    expect(events).toContainEqual(expect.objectContaining({
      kind: "move",
      instanceId: attack.instanceId,
      source: { kind: "hand", seat: 0 },
      destination: { kind: "stack-attack" },
    }));
    expect(events).toContainEqual({
      kind: "appear",
      destination: { kind: "board", seat: 0 },
      visual: { kind: "face", card: token },
      instanceId: token.instanceId,
      destinationPresentationKey: `0:board:${token.instanceId}`,
    });
    expect(events).not.toContainEqual(expect.objectContaining({
      kind: "move",
      instanceId: token.instanceId,
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      kind: "connect",
      instanceId: token.instanceId,
    }));
  });

  it("does not infer an opponent's created token as the card leaving their hand", () => {
    const attack = { ...face(16, 1), cardId: "HNT059" };
    const token = { ...face(17, 1), cardId: "SFA037" };
    const previous = view([
      player(0),
      player(1, { handCount: 1 }),
    ]);
    const current = view(
      [player(0), player(1, { board: [token], handCount: 0 })],
      {
        chain: [{
          attackingCard: attack,
          defendingCards: [],
          attackValue: 4,
          defenseValue: 0,
          damage: 0,
          resolved: false,
          onStack: true,
          reactions: [],
        }],
      },
    );

    const events = detectGameMotionEvents(previous, current);
    expect(events).toContainEqual({
      kind: "move",
      source: { kind: "hand", seat: 1 },
      destination: { kind: "stack-attack" },
      visual: { kind: "back-reveal", card: attack },
      instanceId: attack.instanceId,
      destinationPresentationKey: `stack:attack:${attack.instanceId}`,
      count: 1,
      confidence: "inferred",
    });
    expect(events).toContainEqual({
      kind: "appear",
      destination: { kind: "board", seat: 1 },
      visual: { kind: "face", card: token },
      instanceId: token.instanceId,
      destinationPresentationKey: `1:board:${token.instanceId}`,
    });
    expect(events).not.toContainEqual(expect.objectContaining({
      kind: "move",
      instanceId: token.instanceId,
    }));
  });

  it("does not carry a visible identity into a newly hidden destination", () => {
    const known = face(4);
    const hidden = { ...known, cardId: "", hidden: true };
    const previous = view([
      player(0, { graveyard: [known] }),
      player(1),
    ]);
    const current = view([
      player(0, { arsenal: [hidden], arsenalCount: 1 }),
      player(1),
    ]);

    expect(detectGameMotionEvents(previous, current)).toEqual([{
      kind: "move",
      source: { kind: "graveyard", seat: 0 },
      destination: { kind: "arsenal", seat: 0 },
      visual: { kind: "back" },
      instanceId: 4,
      sourcePresentationKey: "0:graveyard:4",
      destinationPresentationKey: "0:arsenal:4",
      count: 1,
      confidence: "exact",
    }]);
  });

  it("infers an anonymous draw and reflows only the pre-existing hand slots", () => {
    const previous = view([
      player(0),
      player(1, { deckCount: 20, handCount: 2 }),
    ]);
    const current = view([
      player(0),
      player(1, { deckCount: 19, handCount: 3 }),
    ]);

    const events = detectGameMotionEvents(previous, current);
    expect(events.filter((event) => event.kind === "move")).toEqual([{
      kind: "move",
      source: { kind: "deck", seat: 1 },
      destination: { kind: "hand", seat: 1 },
      visual: { kind: "back" },
      count: 1,
      confidence: "inferred",
    }]);
    expect(events.flatMap((event) => event.kind === "reflow"
      ? [[event.sourcePresentationKey, event.phase, event.visual.kind]] : []))
      .toEqual([["1:hand:opaque", "draw", "back"], ["1:hand:opaque:1", "draw", "back"]]);
  });

  it("settles silently instead of inventing an ambiguous private path", () => {
    const previous = view([
      player(0, { handCount: 1, deckCount: 20 }),
      player(1),
    ]);
    const current = view([
      player(0, { handCount: 0, deckCount: 19, arsenalCount: 1 }),
      player(1),
    ]);

    expect(detectGameMotionEvents(previous, current)).toEqual([]);
  });

  it("does not animate remaining stack layers merely because their indexes compact", () => {
    const first = face(5);
    const second = face(6);
    const previous = view(
      [player(0), player(1)],
      {
        stack: [
          { card: first, seat: 0, label: "First", optional: false },
          { card: second, seat: 0, label: "Second", optional: false },
        ],
      },
    );
    const current = view(
      [player(0), player(1)],
      { stack: [{ card: second, seat: 0, label: "Second", optional: false }] },
    );

    expect(detectGameMotionEvents(previous, current).some((event) => (
      event.kind === "move" && event.instanceId === second.instanceId
    ))).toBe(false);
  });

  it("moves a hand defender when it is staged, not when it is confirmed", () => {
    const defender = face(12);
    const attack = face(13, 1);
    const chain = [{
      attackingCard: attack,
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 0,
      resolved: false,
      reactions: [],
    }];
    const unstaged = view(
      [player(0, { hand: [defender], handCount: 1 }), player(1)],
      {
        chain,
        pendingDecision: {
          player: 0,
          kind: "defend",
          prompt: "Choose defenders",
          stagedCards: [],
          stagedDefense: 0,
        },
      },
    );
    const staged = view(
      [player(0, { hand: [defender], handCount: 1 }), player(1)],
      {
        chain,
        pendingDecision: {
          player: 0,
          kind: "defend",
          prompt: "Choose defenders",
          stagedCards: [defender],
          stagedDefense: 3,
        },
      },
    );
    const confirmed = view(
      [player(0), player(1)],
      { chain: [{ ...chain[0]!, defendingCards: [defender], defenseValue: 3 }] },
    );

    expect(detectGameMotionEvents(unstaged, staged)).toContainEqual({
      kind: "move",
      source: { kind: "hand", seat: 0 },
      destination: { kind: "chain-staged", link: 0, index: 0 },
      visual: { kind: "face", card: defender },
      instanceId: defender.instanceId,
      sourcePresentationKey: "0:hand:12",
      destinationPresentationKey: "chain:0:staged:12",
      count: 1,
      confidence: "exact",
    });
    expect(detectGameMotionEvents(staged, confirmed)).toEqual([{
      kind: "settle",
      destination: { kind: "chain-defender", link: 0, index: 0 },
      visual: { kind: "face", card: defender },
      instanceId: defender.instanceId,
      destinationPresentationKey: "chain:0:defender:0:12",
    }]);
  });

  it("connects an on-defense trigger from the committed chain defender", () => {
    const defender = face(22);
    const attack = face(23, 1);
    const baseLink = {
      attackingCard: attack,
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 0,
      resolved: false,
      reactions: [],
    };
    const staged = view(
      [player(0, { hand: [defender], handCount: 1 }), player(1)],
      {
        chain: [baseLink],
        pendingDecision: {
          player: 0,
          kind: "defend",
          prompt: "Choose defenders",
          stagedCards: [defender],
          stagedDefense: 3,
        },
      },
    );
    const confirmed = view(
      [player(0), player(1)],
      {
        chain: [{ ...baseLink, defendingCards: [defender], defenseValue: 3 }],
        stack: [{
          card: defender,
          seat: 0,
          label: "When this defends",
          optional: false,
        }],
      },
    );

    expect(detectGameMotionEvents(staged, confirmed)).toEqual([
      {
        kind: "connect",
        source: { kind: "chain-defender", link: 0, index: 0 },
        destination: { kind: "stack-layer", index: 0 },
        instanceId: defender.instanceId,
        sourcePresentationKey: "chain:0:defender:0:22",
        destinationPresentationKey: "stack:layer:22",
      },
      {
        kind: "settle",
        destination: { kind: "chain-defender", link: 0, index: 0 },
        visual: { kind: "face", card: defender },
        instanceId: defender.instanceId,
        destinationPresentationKey: "chain:0:defender:0:22",
      },
    ]);
  });

  it("moves an anonymous card back when an opponent stages from hand", () => {
    const attack = face(31);
    const hiddenDefender: CardView = {
      instanceId: -1,
      cardId: "",
      owner: 1,
      faceDown: true,
      hidden: true,
    };
    const chain = [{
      attackingCard: attack,
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 0,
      resolved: false,
      reactions: [],
    }];
    const unstaged = view(
      [player(0), player(1, { handCount: 1 })],
      {
        chain,
        pendingDecision: {
          player: 1,
          kind: "defend",
          prompt: "",
          stagedCards: [],
          stagedDefense: 0,
        },
      },
    );
    const staged = view(
      [player(0), player(1, { handCount: 1 })],
      {
        chain,
        pendingDecision: {
          player: 1,
          kind: "defend",
          prompt: "",
          stagedCards: [hiddenDefender],
          stagedDefense: 0,
        },
      },
    );

    expect(detectGameMotionEvents(unstaged, staged)).toEqual([{
      kind: "move",
      source: { kind: "hand", seat: 1 },
      destination: { kind: "chain-staged", link: 0, index: 0 },
      visual: { kind: "back" },
      instanceId: -1,
      destinationPresentationKey: "chain:0:staged:-1",
      count: 1,
      confidence: "inferred",
    }]);
  });

  it("flips an opaque staged card on confirmation instead of moving it again", () => {
    const attack = face(34);
    const hiddenDefender: CardView = {
      instanceId: -1,
      cardId: "",
      owner: 1,
      faceDown: true,
      hidden: true,
    };
    const revealedDefender = face(35, 1);
    const baseLink = {
      attackingCard: attack,
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 0,
      resolved: false,
      reactions: [],
    };
    const staged = view(
      [player(0), player(1, { handCount: 1 })],
      {
        chain: [baseLink],
        pendingDecision: {
          player: 1,
          kind: "defend",
          prompt: "",
          stagedCards: [hiddenDefender],
          stagedDefense: 0,
        },
      },
    );
    const confirmed = view(
      [player(0), player(1)],
      {
        chain: [{
          ...baseLink,
          defendingCards: [revealedDefender],
          defenseValue: 3,
        }],
      },
    );

    expect(detectGameMotionEvents(staged, confirmed)).toEqual([{
      kind: "settle",
      destination: { kind: "chain-defender", link: 0, index: 0 },
      visual: { kind: "back-reveal", card: revealedDefender },
      instanceId: revealedDefender.instanceId,
      destinationPresentationKey: "chain:0:defender:0:35",
    }]);
  });

  it("moves a public equipment card when it is staged as a defender", () => {
    const equipment = face(32, 1);
    const attack = face(33);
    const chain = [{
      attackingCard: attack,
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 0,
      resolved: false,
      reactions: [],
    }];
    const unstaged = view(
      [player(0), player(1, { equipment: { arms: equipment } })],
      {
        chain,
        pendingDecision: {
          player: 1,
          kind: "defend",
          prompt: "",
          stagedCards: [],
          stagedDefense: 0,
        },
      },
    );
    const staged = view(
      [player(0), player(1, { equipment: { arms: equipment } })],
      {
        chain,
        pendingDecision: {
          player: 1,
          kind: "defend",
          prompt: "",
          stagedCards: [equipment],
          stagedDefense: 0,
        },
      },
    );
    const confirmed = view(
      [player(0), player(1, { equipment: { arms: equipment } })],
      {
        chain: [{ ...chain[0]!, defendingCards: [equipment], defenseValue: 3 }],
      },
    );

    expect(detectGameMotionEvents(unstaged, staged)).toContainEqual({
      kind: "move",
      source: { kind: "equipment", seat: 1, slot: "arms" },
      destination: { kind: "chain-staged", link: 0, index: 0 },
      visual: { kind: "face", card: equipment },
      instanceId: equipment.instanceId,
      sourcePresentationKey: "1:equipment:arms:32",
      destinationPresentationKey: "chain:0:staged:32",
      count: 1,
      confidence: "exact",
    });
    expect(detectGameMotionEvents(staged, confirmed)).toEqual([{
      kind: "settle",
      destination: { kind: "chain-defender", link: 0, index: 0 },
      visual: { kind: "face", card: equipment },
      instanceId: equipment.instanceId,
      destinationPresentationKey: "chain:0:defender:0:32",
    }]);
  });

  it("does not invent a hidden path for a legacy end-phase shortcut", () => {
    const previous = view(
      [
        player(0),
        player(1, {
          handCount: 4,
          deckCount: 20,
          arsenalCount: 0,
        }),
      ],
      {
        phase: "end",
        pendingDecision: {
          player: 1,
          kind: "arsenal",
          prompt: "Choose a card for arsenal",
        },
      },
    );
    const current = view(
      [
        player(0),
        player(1, {
          handCount: 4,
          deckCount: 19,
          arsenalCount: 1,
        }),
      ],
      { turn: 2, phase: "action", activePlayer: 0, priorityPlayer: 0 },
    );

    const events = detectGameMotionEvents(previous, current);
    expect(events).toEqual([]);
  });

  it("keeps exact arsenal motion but does not infer cleanup draws", () => {
    const chosen = face(40);
    const pitched = face(41);
    const draws = [face(42), face(43), face(44), face(45)];
    const previous = view(
      [
        player(0, {
          hand: [chosen],
          handCount: 1,
          deckCount: 10,
          pitch: [pitched],
          pitchCount: 1,
        }),
        player(1),
      ],
      {
        phase: "end",
        pendingDecision: {
          player: 0,
          kind: "arsenal",
          prompt: "Choose a card for arsenal",
        },
      },
    );
    const arsenaled = { ...chosen, faceDown: true };
    const current = view(
      [
        player(0, {
          hand: draws,
          handCount: draws.length,
          deckCount: 6,
          arsenal: [arsenaled],
          arsenalCount: 1,
        }),
        player(1),
      ],
      { turn: 2, phase: "action" },
    );

    const events = detectGameMotionEvents(previous, current);
    expect(events[0]).toEqual({
      kind: "move",
      source: { kind: "hand", seat: 0 },
      destination: { kind: "arsenal", seat: 0 },
      visual: { kind: "face", card: arsenaled },
      instanceId: chosen.instanceId,
      sourcePresentationKey: "0:hand:40",
      destinationPresentationKey: "0:arsenal:40",
      count: 1,
      confidence: "exact",
    });
    expect(events).toHaveLength(1);
    expect(events.some((event) => event.kind === "move" && event.confidence === "inferred"))
      .toBe(false);
  });

  it("plays authoritative Ponder motion before arsenal motion", () => {
    const ponder = face(90);
    const previous = view(
      [
        player(0),
        player(1, { handCount: 4, deckCount: 20, board: [ponder] }),
      ],
      { phase: "end" },
    );
    const current = view(
      [
        player(0),
        player(1, { handCount: 4, deckCount: 19, arsenalCount: 1 }),
      ],
      { turn: 2, phase: "action", activePlayer: 0, priorityPlayer: 0 },
    );

    const events = transitionMotionEvents(previous, current, {
      fromVersion: 7,
      kind: "forward",
      events: [
        {
          kind: "move",
          from: { kind: "board", seat: 1 },
          to: null,
          count: 1,
          instanceId: ponder.instanceId,
        },
        {
          kind: "move",
          from: { kind: "deck", seat: 1 },
          to: { kind: "hand", seat: 1 },
          count: 1,
        },
        {
          kind: "move",
          from: { kind: "hand", seat: 1 },
          to: { kind: "arsenal", seat: 1 },
          count: 1,
        },
      ],
    }, "forward");

    expect(events.slice(0, 3)).toEqual([
      {
        kind: "disappear",
        source: { kind: "board", seat: 1 },
        visual: { kind: "face", card: ponder },
        instanceId: ponder.instanceId,
        sourcePresentationKey: `1:board:${ponder.instanceId}`,
      },
      expect.objectContaining({
        kind: "move",
        source: { kind: "deck", seat: 1 },
        destination: { kind: "hand", seat: 1 },
      }),
      expect.objectContaining({
        kind: "move",
        source: { kind: "hand", seat: 1 },
        destination: { kind: "arsenal", seat: 1 },
        sourcePresentationKey: "1:hand:opaque:3",
      }),
    ]);
    expect(events.filter((event) => event.kind === "reflow").map((event) => (
      event.sourcePresentationKey
    ))).toEqual([
      "1:hand:opaque",
      "1:hand:opaque:1",
      "1:hand:opaque:2",
    ]);
  });

  it("dissolves a ceasing token without pulsing its resolved stack layer", () => {
    const flurry = face(91);
    const previous = view(
      [player(0, { board: [flurry] }), player(1)],
      {
        stack: [{
          card: flurry,
          seat: 0,
          label: "Destroy Flurry",
          optional: false,
        }],
      },
    );
    const current = view([player(0), player(1)]);

    expect(transitionMotionEvents(previous, current, {
      fromVersion: 8,
      kind: "forward",
      events: [{
        kind: "move",
        from: { kind: "board", seat: 0 },
        to: null,
        count: 1,
        instanceId: flurry.instanceId,
      }],
    }, "forward")).toEqual([{
      kind: "disappear",
      source: { kind: "board", seat: 0 },
      visual: { kind: "face", card: flurry },
      instanceId: flurry.instanceId,
      sourcePresentationKey: `0:board:${flurry.instanceId}`,
    }]);
  });

  it("keeps a pitched card face visible until its deck-bottom flip", () => {
    const pitched = face(91);
    const deckTop = face(92);
    const previous = view([
      player(0, {
        pitch: [pitched],
        pitchCount: 1,
        deckCount: 20,
        visibleDeckTop: deckTop,
      }),
      player(1),
    ], { phase: "end" });
    const current = view([
      player(0, {
        pitch: [],
        pitchCount: 0,
        deckCount: 21,
        visibleDeckTop: deckTop,
      }),
      player(1),
    ], { turn: 2, phase: "action" });

    expect(transitionMotionEvents(previous, current, {
      fromVersion: 8,
      kind: "forward",
      events: [{
        kind: "move",
        from: { kind: "pitch", seat: 0 },
        to: { kind: "deck", seat: 0, position: "bottom" },
        count: 1,
        instanceId: pitched.instanceId,
      }],
    }, "forward")).toContainEqual({
      kind: "move",
      source: { kind: "pitch", seat: 0 },
      destination: { kind: "deck", seat: 0, position: "bottom" },
      visual: { kind: "face-conceal", card: pitched },
      count: 1,
      confidence: "exact",
      instanceId: pitched.instanceId,
      sourcePresentationKey: `0:pitch:${pitched.instanceId}`,
      destinationCoverVisual: { kind: "face", card: deckTop },
    });
  });

  it("adds hand reflow motion alongside end-phase draw-up", () => {
    const kept = face(93);
    const chosen = face(94);
    const drawn = face(95);
    const previous = view([
      player(0, { hand: [kept, chosen], handCount: 2, deckCount: 10 }),
      player(1),
    ], { phase: "end" });
    const current = view([
      player(0, {
        hand: [kept, drawn],
        handCount: 2,
        deckCount: 9,
        arsenal: [{ ...chosen, faceDown: true }],
        arsenalCount: 1,
      }),
      player(1),
    ], { turn: 2, phase: "action" });

    const events = transitionMotionEvents(previous, current, {
      fromVersion: 9,
      kind: "forward",
      events: [
        {
          kind: "move",
          from: { kind: "hand", seat: 0 },
          to: { kind: "arsenal", seat: 0 },
          count: 1,
          instanceId: chosen.instanceId,
        },
        {
          kind: "move",
          from: { kind: "deck", seat: 0, position: "top" },
          to: { kind: "hand", seat: 0 },
          count: 1,
          instanceId: drawn.instanceId,
        },
      ],
    }, "forward");

    expect(events).toContainEqual(expect.objectContaining({
      kind: "move",
      source: { kind: "deck", seat: 0, position: "top" },
      destination: { kind: "hand", seat: 0 },
      visual: { kind: "face", card: drawn },
      instanceId: drawn.instanceId,
      destinationPresentationKey: `0:hand:${drawn.instanceId}`,
    }));
    expect(events).toContainEqual({
      kind: "reflow",
      source: { kind: "hand", seat: 0 },
      destination: { kind: "hand", seat: 0 },
      visual: { kind: "face", card: kept },
      instanceId: kept.instanceId,
      sourcePresentationKey: `0:hand:${kept.instanceId}`,
      destinationPresentationKey: `0:hand:${kept.instanceId}`,
      phase: "draw",
    });
  });

  it("continues draw-up after an optimistic arsenal move without replaying it", () => {
    const kept = face(101);
    const chosen = face(102);
    const draws = [face(103), face(104), face(105)];
    const optimisticallyArsenaled = { ...chosen, faceDown: true };
    const previous = view([
      player(0, {
        hand: [kept],
        handCount: 1,
        deckCount: 10,
        arsenal: [optimisticallyArsenaled],
        arsenalCount: 1,
      }),
      player(1),
    ], {
      phase: "end",
      pendingDecision: null,
    });
    const current = view([
      player(0, {
        hand: [kept, ...draws],
        handCount: 4,
        deckCount: 7,
        arsenal: [optimisticallyArsenaled],
        arsenalCount: 1,
      }),
      player(1),
    ], { turn: 2, phase: "action" });

    const events = transitionMotionEvents(previous, current, {
      fromVersion: 11,
      kind: "forward",
      events: [
        {
          kind: "move",
          from: { kind: "hand", seat: 0 },
          to: { kind: "arsenal", seat: 0 },
          count: 1,
          instanceId: chosen.instanceId,
        },
        ...draws.map((card) => ({
          kind: "move" as const,
          from: { kind: "deck" as const, seat: 0, position: "top" as const },
          to: { kind: "hand" as const, seat: 0 },
          count: 1,
          instanceId: card.instanceId,
        })),
      ],
    }, "forward", { sourceIncludesPredictedTransition: true });

    expect(events).not.toContainEqual(expect.objectContaining({
      kind: "move",
      destination: { kind: "arsenal", seat: 0 },
    }));
    expect(events.filter((event) => (
      event.kind === "move"
      && event.source.kind === "deck"
      && event.destination.kind === "hand"
    ))).toHaveLength(3);
    expect(events).toContainEqual(expect.objectContaining({
      kind: "reflow",
      instanceId: kept.instanceId,
      phase: "draw",
    }));
  });

  it("defers a new-turn stack trigger until end-phase motion completes", () => {
    const mentor = face(96);
    const pitched = face(97);
    const drawn = face(98);
    const previous = view([
      player(0, {
        board: [mentor],
        pitch: [pitched],
        pitchCount: 1,
        deckCount: 10,
      }),
      player(1),
    ], { turn: 1, phase: "end" });
    const current = view([
      player(0, {
        board: [mentor],
        hand: [drawn],
        handCount: 1,
        deckCount: 10,
      }),
      player(1),
    ], {
      turn: 2,
      phase: "start",
      stack: [{ card: mentor, seat: 0, label: "At the start of your turn", optional: false }],
    });

    const events = transitionMotionEvents(previous, current, {
      fromVersion: 10,
      kind: "forward",
      events: [
        {
          kind: "move",
          from: { kind: "pitch", seat: 0 },
          to: { kind: "deck", seat: 0, position: "bottom" },
          count: 1,
          instanceId: pitched.instanceId,
        },
        {
          kind: "move",
          from: { kind: "deck", seat: 0, position: "top" },
          to: { kind: "hand", seat: 0 },
          count: 1,
          instanceId: drawn.instanceId,
        },
      ],
    }, "forward");

    expect(events).toContainEqual(expect.objectContaining({
      kind: "connect",
      destination: { kind: "stack-layer", index: 0 },
      timeline: "turn-start",
    }));
  });
});
