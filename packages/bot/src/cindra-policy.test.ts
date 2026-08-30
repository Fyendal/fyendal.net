import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { CardView, Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  chooseCindraContinuationIntent,
  chooseCindraIntent,
  chooseCindraIntentWithTrace,
} from "./cindra-policy.js";
import { cindraPresentationFor } from "./sideboard.js";
import { botObservationKey, isCleanActionDecision } from "./turn-planner.js";

function cindraDeck(): Decklist {
  const pool = precon("bot-cindra-head-jabs")!.pool;
  return { heroId: pool.heroId, ...cindraPresentationFor(decklists.dorinthea) };
}

function state(startPlayer: Seat = 1) {
  return createGame({
    decklists: [cindraDeck(), decklists.dorinthea],
    cards: cardData,
    scripts,
    seed: 12_301,
    startPlayer,
  });
}

type TestState = ReturnType<typeof state>;
type Seat = 0 | 1;

function replaceHand(game: TestState, seat: Seat, cardIds: readonly string[]): void {
  game.players[seat]!.hand = cardIds.map((cardId) => ({
    instanceId: game.nextInstanceId++,
    cardId,
    owner: seat,
  }));
}

function replaceDeck(game: TestState, seat: Seat, cardIds: readonly string[]): void {
  game.players[seat]!.deck = cardIds.map((cardId) => ({
    instanceId: game.nextInstanceId++,
    cardId,
    owner: seat,
  }));
}

function addOpponentAlly(game: TestState, cardId: string) {
  const life = cardData[cardId]?.life;
  if (life === undefined) throw new Error(`${cardId} is not a living ally`);
  const ally = {
    instanceId: game.nextInstanceId++,
    cardId,
    owner: 1 as const,
    life,
  };
  game.players[1]!.board.push(ally);
  return ally;
}

function apply(game: TestState, seat: Seat, intent: GameIntent): TestState {
  expect(legalIntents(game, seat)).toContainEqual(intent);
  const result = applyIntent(game, seat, intent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function legalIntent(
  game: TestState,
  seat: Seat,
  predicate: (intent: GameIntent) => boolean,
  label: string,
): GameIntent {
  const intent = legalIntents(game, seat).find(predicate);
  if (!intent) throw new Error(`no legal ${label} intent in ${game.phase}`);
  return intent;
}

function cindraIntent(game: TestState): GameIntent {
  const legal = legalIntents(game, 0);
  const intent = chooseCindraIntent({
    seat: 0,
    view: projectStateFor(game, 0),
    legal,
    cards: cardData,
  });
  expect(legal).toContainEqual(intent);
  return intent;
}

function applyCindra(game: TestState): TestState {
  return apply(game, 0, cindraIntent(game));
}

function advanceUntil(
  initial: TestState,
  predicate: (game: TestState) => boolean,
): TestState {
  let game = initial;
  for (let step = 0; step < 80; step++) {
    if (predicate(game)) return game;
    const actor = (game.pendingDecision?.player ?? game.priorityPlayer) as Seat;
    const legal = legalIntents(game, actor);
    const intent = game.pendingDecision?.kind === "defend"
      ? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
      : game.pendingDecision?.kind === "order-triggers"
        ? legal.find((candidate) => candidate.kind === "order-triggers")
      : legal.find((candidate) => candidate.kind === "choose" && candidate.optionId === "pass")
        ?? legal.find((candidate) => candidate.kind === "pass");
    if (!intent) throw new Error(
      `no automatic advance from ${game.phase}/${game.pendingDecision?.kind ?? "none"}: ` +
      `${game.pendingDecision?.prompt ?? "no prompt"}`,
    );
    game = apply(game, actor, intent);
  }
  throw new Error(`state did not reach expected point: ${JSON.stringify({
    phase: game.phase,
    priorityPlayer: game.priorityPlayer,
    pendingDecision: game.pendingDecision,
    chain: game.chain.map((link) => link.attackingCard.cardId),
  })}`);
}

function playCard(game: TestState, seat: Seat, cardId: string): TestState {
  const card = game.players[seat]!.hand.find((candidate) => candidate.cardId === cardId);
  if (!card) throw new Error(`${cardId} is not in seat ${seat}'s hand`);
  const intent = legalIntent(
    game,
    seat,
    (candidate) => candidate.kind === "play-card" && candidate.instanceId === card.instanceId,
    `play ${cardId}`,
  );
  return apply(game, seat, intent);
}

function defendWith(game: TestState, seat: Seat, instanceIds: readonly number[]): TestState {
  if (instanceIds.length > 0) {
    const stage = legalIntent(
      game,
      seat,
      (intent) => intent.kind === "stage-defenders" &&
        instanceIds.every((instanceId) => intent.instanceIds.includes(instanceId)),
      "stage defenders",
    );
    game = apply(game, seat, stage);
  }
  const defend = legalIntent(
    game,
    seat,
    (intent) => intent.kind === "defend" &&
      intent.instanceIds.length === instanceIds.length &&
      instanceIds.every((instanceId) => intent.instanceIds.includes(instanceId)),
    "defend",
  );
  return apply(game, seat, defend);
}

function opposingAttack(view: ReturnType<typeof projectStateFor>, attackValue = 4): void {
  view.priorityPlayer = 0;
  view.phase = "defend";
  view.pendingDecision = {
    player: 0,
    kind: "defend",
    prompt: "Choose defending cards",
    stagedCards: [],
    stagedDefense: 0,
  };
  view.chain = [{
    attackingCard: { instanceId: 90_001, cardId: "WTR159", owner: 1 },
    defendingCards: [],
    attackValue,
    defenseValue: 0,
    damage: attackValue,
    resolved: false,
    reactions: [],
  }];
}

function ordinaryDefenseChoice(options: {
  attackValue?: number;
  life?: number;
  onHitText?: string;
  occupiedArsenal?: boolean;
} = {}): { choice: GameIntent; blocker: CardView } {
  const game = state();
  const view = projectStateFor(game, 0);
  view.turn = 3;
  opposingAttack(view, options.attackValue ?? 3);
  view.players[0].life = options.life ?? 40;
  const blocker: CardView = {
    instanceId: 90_002,
    cardId: "TEST_EXPENDABLE_BLOCKER",
    owner: 0,
    defense: 3,
  };
  view.players[0].hand = [blocker];
  view.players[0].handCount = 1;
  const arsenal = options.occupiedArsenal
    ? [{ instanceId: 90_003, cardId: "TEST_ARSENAL", owner: 0 as const }]
    : [];
  view.players[0].arsenal = arsenal;
  view.players[0].arsenalCount = arsenal.length;
  if (options.onHitText) {
    view.chain[0]!.onHitEffects = [{
      sourceCardId: view.chain[0]!.attackingCard.cardId,
      text: options.onHitText,
    }];
  }
  const cards = {
    ...cardData,
    TEST_EXPENDABLE_BLOCKER: {
      id: "TEST_EXPENDABLE_BLOCKER",
      name: "Test Expendable Blocker",
      cardType: "action" as const,
      text: "",
      pitch: 1 as const,
      cost: 0,
      defense: 3,
    },
    TEST_ARSENAL: {
      id: "TEST_ARSENAL",
      name: "Test Arsenal",
      cardType: "action" as const,
      text: "",
      pitch: 1 as const,
      cost: 0,
      defense: 3,
    },
  };
  const legal: GameIntent[] = [
    { kind: "defend", instanceIds: [] },
    { kind: "stage-defenders", instanceIds: [blocker.instanceId] },
    { kind: "concede" },
  ];
  return {
    choice: chooseCindraIntent({ seat: 0, view, legal, cards }),
    blocker,
  };
}

describe("Cindra Head Jabs policy", () => {
  it("plays Blaze Headlong as the second link before terminal Draconic attacks", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["ANQ029", "HNT157", "HNT067", "HNT059"]);
    replaceDeck(game, 0, ["SFA023"]);
    replaceHand(game, 1, ["RNR020", "RNR020"]);
    game.players[0]!.equipment.chest = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT168",
      owner: 0,
    };

    const rabble = cindraIntent(game);
    expect(rabble.kind).toBe("play-card");
    if (rabble.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === rabble.instanceId)?.cardId)
      .toBe("ANQ029");
    game = apply(game, 0, rabble);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    const blockerIds = game.players[1]!.hand.map((card) => card.instanceId);
    const staged = applyIntent(game, 1, { kind: "stage-defenders", instanceIds: blockerIds });
    if (!staged.ok) throw new Error(staged.error);
    game = staged.state;
    game = apply(game, 1, legalIntent(
      game,
      1,
      (intent) => intent.kind === "defend" && intent.instanceIds.length === blockerIds.length,
      "defend",
    ));
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );
    const flick = cindraIntent(game);
    expect(flick).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.equipment.arms!.instanceId,
    });
    game = apply(game, 0, flick);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Flick Knives") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Blood Splattered Vest") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true && candidate.pendingDecision === null
    );
    expect(game.players[0]!.resources).toBe(1);
    expect(game.players[0]!.equipment.chest?.counters?.stain).toBe(1);

    const reactiveSecond = cindraIntent(game);
    expect(reactiveSecond.kind).toBe("play-card");
    if (reactiveSecond.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === reactiveSecond.instanceId)?.cardId)
      .toBe("HNT157");

    const second = chooseCindraIntentWithTrace({
      seat: 0,
      view: projectStateFor(game, 0),
      legal: legalIntents(game, 0),
      cards: cardData,
      state: game,
    }).intent;
    expect(second.kind).toBe("play-card");
    if (second.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === second.instanceId)?.cardId)
      .toBe("HNT157");
  });

  it("spends Fealty on a non-Draconic go-again card before terminal Draconic cards", () => {
    const game = state();
    const fealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 as const };
    const rabble = { instanceId: game.nextInstanceId++, cardId: "ANQ029", owner: 0 as const };
    const breakingPoint = { instanceId: game.nextInstanceId++, cardId: "FAB091", owner: 0 as const };
    game.players[0]!.board.push(fealty);
    game.players[0]!.hand = [rabble, breakingPoint];
    game.players[0]!.graveyard.push(game.players[0]!.weapons.pop()!);
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    const activation: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: fealty.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [
      activation,
      { kind: "play-card", instanceId: rabble.instanceId, pitchInstanceIds: [] },
      {
        kind: "play-card",
        instanceId: breakingPoint.instanceId,
        pitchInstanceIds: [rabble.instanceId],
        pitchRequired: 1,
      },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual(activation);
  });

  it("pitches a non-Draconic terminal card to bridge into a Draconic finisher with Kunai", () => {
    const game = state();
    const breakingPoint = { instanceId: game.nextInstanceId++, cardId: "FAB091", owner: 0 as const };
    const nonDraconicPitch = { instanceId: game.nextInstanceId++, cardId: "RNR020", owner: 0 as const };
    game.players[0]!.hand = [breakingPoint, nonDraconicPitch];
    const view = projectStateFor(game, 0);
    const dagger = view.players[0].weapons[0]!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.players[0].resources = 0;
    view.chain = [{
      attackingCard: { instanceId: 90_011, cardId: "HNT058", owner: 0 },
      defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
      resolved: true, hit: true, goAgain: true, reactions: [],
    }];
    const daggerWithNonDraconicPitch: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: dagger.instanceId,
      pitchInstanceIds: [nonDraconicPitch.instanceId],
      pitchRequired: 1,
    };
    const legal: GameIntent[] = [
      daggerWithNonDraconicPitch,
      {
        kind: "activate-ability",
        sourceInstanceId: dagger.instanceId,
        pitchInstanceIds: [breakingPoint.instanceId],
        pitchRequired: 1,
      },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual(daggerWithNonDraconicPitch);
  });

  it("plays a terminal Draconic attack before a terminal non-Draconic attack", () => {
    const game = state();
    const breakingPoint = { instanceId: game.nextInstanceId++, cardId: "FAB091", owner: 0 as const };
    const ragingOnslaught = { instanceId: game.nextInstanceId++, cardId: "RNR020", owner: 0 as const };
    game.players[0]!.hand = [breakingPoint, ragingOnslaught];
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.players[0].resources = 3;
    view.chain = [{
      attackingCard: { instanceId: 90_012, cardId: "HNT058", owner: 0 },
      defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
      resolved: true, hit: true, goAgain: true, reactions: [],
    }];
    const breakingPointIntent: GameIntent = {
      kind: "play-card",
      instanceId: breakingPoint.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [
      breakingPointIntent,
      { kind: "play-card", instanceId: ragingOnslaught.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual(breakingPointIntent);
  });

  it("uses Flight Path on a terminal Draconic attack to unlock one final hand attack", () => {
    const game = state();
    const snatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 as const };
    game.players[0]!.hand = [snatch];
    const view = projectStateFor(game, 0);
    const flightPath = view.players[0].equipment.legs!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [
      {
        attackingCard: { instanceId: 90_013, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_014, cardId: "HNT067", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_015, cardId: "FAB091", owner: 0 },
        defendingCards: [], attackValue: 5, defenseValue: 0, damage: 5,
        resolved: false, hit: true, goAgain: false, reactions: [],
      },
    ];
    const activation: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: flightPath.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [activation, { kind: "pass" }, { kind: "concede" }];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual(activation);
  });

  it("no-blocks a nonlethal attack to protect the five-card offense", () => {
    const game = state();
    const view = projectStateFor(game, 0);
    opposingAttack(view);
    const blocker = view.players[0].hand.find((card) => (card.defense ?? 0) > 0)!;
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "stage-defenders", instanceIds: [blocker.instanceId] },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });
  });

  it("no-blocks to preserve a Draco Fire Kunai conversion hand", () => {
    const game = state();
    replaceHand(game, 0, ["OMN245", "GEM010", "HNT157", "HNT157"]);
    const view = projectStateFor(game, 0);
    opposingAttack(view, 4);
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      ...view.players[0].hand
        .filter((card) => (card.defense ?? 0) > 0)
        .map((card) => ({
          kind: "stage-defenders" as const,
          instanceIds: [card.instanceId],
        })),
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });
  });

  it("blocks with a terminal attack that the next turn cannot use", () => {
    const game = state();
    replaceHand(game, 0, ["UPR098", "ANQ031"]);
    const view = projectStateFor(game, 0);
    view.players[0].weapons = [];
    opposingAttack(view, 3);
    const lavaBurst = view.players[0].hand.find((card) => card.cardId === "UPR098")!;
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "stage-defenders", instanceIds: [lavaBurst.instanceId] },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "stage-defenders", instanceIds: [lavaBurst.instanceId] });
  });

  it("blocks ordinary nonlethal damage with an offensively unusable card", () => {
    const { choice, blocker } = ordinaryDefenseChoice({ attackValue: 4, life: 5 });
    expect(choice).toEqual({ kind: "stage-defenders", instanceIds: [blocker.instanceId] });
  });

  it.each([
    "When this hits, draw a card.",
    "When this hits, create a Bloodrot Pox token.",
  ])("blocks a low-value on-hit with an offensively unusable card: %s", (onHitText) => {
    const { choice, blocker } = ordinaryDefenseChoice({ onHitText });
    expect(choice).toEqual({ kind: "stage-defenders", instanceIds: [blocker.instanceId] });
  });

  it("permits ordinary defense against an on-hit valued at six or more", () => {
    const { choice, blocker } = ordinaryDefenseChoice({
      onHitText: "When this hits, draw 2 cards.",
    });
    expect(choice).toEqual({ kind: "stage-defenders", instanceIds: [blocker.instanceId] });
  });

  it("permits ordinary defense against two-card hand disruption", () => {
    const { choice, blocker } = ordinaryDefenseChoice({
      onHitText: "When this hits, the defending hero discards 2 cards from their hand.",
    });
    expect(choice).toEqual({ kind: "stage-defenders", instanceIds: [blocker.instanceId] });
  });

  it("permits arsenal protection only while the arsenal is occupied", () => {
    const onHitText = "When this hits, destroy a card in the defending hero's arsenal.";
    const occupied = ordinaryDefenseChoice({ onHitText, occupiedArsenal: true });
    const empty = ordinaryDefenseChoice({ onHitText, occupiedArsenal: false });
    expect(occupied.choice).toEqual({
      kind: "stage-defenders",
      instanceIds: [occupied.blocker.instanceId],
    });
    expect(empty.choice).toEqual({ kind: "defend", instanceIds: [] });
  });

  it("requires an ordinary block that survives lethal damage", () => {
    const { choice, blocker } = ordinaryDefenseChoice({ attackValue: 4, life: 3 });
    expect(choice).toEqual({ kind: "stage-defenders", instanceIds: [blocker.instanceId] });
  });

  it("reserves its equipment suite against nonlethal on-hits", () => {
    const game = state();
    const view = projectStateFor(game, 0);
    opposingAttack(view);
    view.chain[0]!.onHitEffects = [{
      sourceCardId: view.chain[0]!.attackingCard.cardId,
      text: "When this hits, draw a card.",
    }];
    const equipment = Object.values(view.players[0].equipment)
      .filter((card) => card !== undefined && (card.defense ?? 0) > 0);
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      ...equipment.map((card) => ({
        kind: "stage-defenders" as const,
        instanceIds: [card.instanceId],
      })),
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });
  });

  it("blocks with Dragonscaler when the next hand will consume it for an attack chain", () => {
    const game = state();
    replaceHand(game, 0, ["HNT058", "HNT060", "SFA019", "ANQ031"]);
    const view = projectStateFor(game, 0);
    opposingAttack(view);
    const flightPath = view.players[0].equipment.legs!;
    expect(cardData[flightPath.cardId]?.name).toBe("Dragonscaler Flight Path");
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "stage-defenders", instanceIds: [flightPath.instanceId] },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "stage-defenders", instanceIds: [flightPath.instanceId] });
  });

  it("uses a defense reaction instead of ordinary hand blocks", () => {
    const game = state();
    const reaction = {
      instanceId: game.nextInstanceId++,
      cardId: "ANQ034",
      owner: 0,
    };
    game.players[0].hand = [reaction];
    const view = projectStateFor(game, 0);
    opposingAttack(view, 5);
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "defense-reaction", prompt: "Defense reactions" };
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: reaction.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "play-card", instanceId: reaction.instanceId, pitchInstanceIds: [] });
  });

  it("uses Ancestral instead of Flick when its pump makes the current link hit", () => {
    const game = state();
    const view = projectStateFor(game, 0);
    const flick = view.players[0].equipment.arms!;
    const ancestral = view.players[0].hand[0]!;
    ancestral.cardId = "WTR082";
    view.priorityPlayer = 0;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [
      {
        attackingCard: { instanceId: 90_101, cardId: "HNT083", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3, resolved: true, hit: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_102, cardId: "HNT157", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0, resolved: false, goAgain: true, reactions: [],
      },
    ];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: ancestral.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    const ancestralIntent: GameIntent = {
      kind: "play-card",
      instanceId: ancestral.instanceId,
      pitchInstanceIds: [],
    };
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual(ancestralIntent);

    view.players[0].hand = [];
    view.players[0].handCount = 0;
    view.stack = [{
      card: ancestral,
      seat: 0,
      label: "Ancestral Empowerment",
      optional: false,
    }];
    const whileAncestralIsPending: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];
    expect(chooseCindraIntent({ seat: 0, view, legal: whileAncestralIsPending, cards: cardData }))
      .toEqual({ kind: "pass" });

    view.stack = [];
    view.chain[1]!.attackValue = 4;
    view.chain[1]!.damage = 1;
    view.chain[1]!.reactions = [ancestral];
    const afterAncestral: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];
    expect(chooseCindraIntent({ seat: 0, view, legal: afterAncestral, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it.each([
    [10, 1, false],
    [9, 0, false],
    [9, 1, true],
    [9, 2, true],
    [9, 3, false],
  ] as const)(
    "guards the last Flick dagger at %i opposing life after %i consecutive hits",
    (opponentLife, priorHits, shouldFlick) => {
      const game = state();
      game.players[0].hand = [];
      game.players[0].weapons = [game.players[0].weapons[0]!];
      game.players[1].life = opponentLife;
      const view = projectStateFor(game, 0);
      const flick = view.players[0].equipment.arms!;
      view.priorityPlayer = 0;
      view.phase = "reaction";
      view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
      view.chain = [
        ...Array.from({ length: priorHits }, (_, index) => ({
          attackingCard: { instanceId: 90_201 + index, cardId: "HNT083", owner: 0 as const },
          defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
          resolved: true, hit: true, goAgain: true, reactions: [],
        })),
        {
          attackingCard: { instanceId: 90_210, cardId: "HNT157", owner: 0 as const },
          defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0,
          resolved: false, hit: false, goAgain: true, reactions: [],
        },
      ];
      const flickIntent: GameIntent = {
        kind: "activate-ability",
        sourceInstanceId: flick.instanceId,
        pitchInstanceIds: [],
      };
      const legal: GameIntent[] = [flickIntent, { kind: "pass" }, { kind: "concede" }];

      expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
        .toEqual(shouldFlick ? flickIntent : { kind: "pass" });
    },
  );

  it("fires Flick Knives on the final playable attack before buying daggers back", () => {
    const game = state();
    game.players[0].hand = [];
    const view = projectStateFor(game, 0);
    const flick = view.players[0].equipment.arms!;
    for (const weapon of view.players[0].weapons) weapon.usedAbilityIndexes = [0];
    view.priorityPlayer = 0;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [{
      attackingCard: { instanceId: 90_111, cardId: "ANQ031", owner: 0 },
      defendingCards: [], attackValue: 4, defenseValue: 0, damage: 4, resolved: false, reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] });
  });

  it("uses Flick on a fully blocked attack even when the previous link missed", () => {
    const game = state();
    const followup = {
      instanceId: game.nextInstanceId++,
      cardId: "ANQ031",
      owner: 0,
    };
    game.players[0].hand = [followup];
    const view = projectStateFor(game, 0);
    const flick = view.players[0].equipment.arms!;
    view.priorityPlayer = 0;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [
      {
        attackingCard: { instanceId: 90_121, cardId: "HNT083", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0, resolved: true, hit: false, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_122, cardId: "HNT157", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0, resolved: false, goAgain: true, reactions: [],
      },
    ];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] });
  });

  it("does not Flick the recovered dagger when the other Kunai dies on chain close", () => {
    const game = state();
    const view = projectStateFor(game, 0);
    const flick = view.players[0].equipment.arms!;
    const doomedKunai = view.players[0].weapons[0]!;
    doomedKunai.usedAbilityIndexes = [0];
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [
      {
        attackingCard: doomedKunai,
        defendingCards: [], attackValue: 1, defenseValue: 0, damage: 1,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_123, cardId: "FAB091", owner: 0 },
        defendingCards: [], attackValue: 5, defenseValue: 5, damage: 0,
        resolved: false, hit: false, reactions: [],
      },
    ];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("holds Flick when the current link already hits and another attack is playable", () => {
    const game = state();
    const followup = {
      instanceId: game.nextInstanceId++,
      cardId: "ANQ031",
      owner: 0,
    };
    game.players[0].hand = [followup];
    const view = projectStateFor(game, 0);
    const flick = view.players[0].equipment.arms!;
    view.priorityPlayer = 0;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [
      {
        attackingCard: { instanceId: 90_131, cardId: "HNT083", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3, resolved: true, hit: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_132, cardId: "HNT157", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3, resolved: false, goAgain: true, reactions: [],
      },
    ];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("holds Flick when Ignite makes the only remaining Draconic attack free", () => {
    const game = state();
    const followup = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT059",
      owner: 0,
    };
    game.players[0].hand = [followup];
    game.players[0].resources = 0;
    const view = projectStateFor(game, 0);
    const flick = view.players[0].equipment.arms!;
    for (const weapon of view.players[0].weapons) weapon.usedAbilityIndexes = [0];
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [{
      attackingCard: { instanceId: 90_133, cardId: "HNT058", owner: 0 },
      defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
      resolved: false, hit: true, goAgain: true, reactions: [],
    }];
    view.ongoing.push({
      seat: 0,
      cardId: "HNT058",
      label: "play costs 1 less · activation costs 1 less",
    });
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("does not count spent daggers as followups when scoring a final attack", () => {
    const game = state();
    const snatch = {
      instanceId: game.nextInstanceId++,
      cardId: "ANQ031",
      owner: 0,
    };
    game.players[0].hand = [snatch];
    const view = projectStateFor(game, 0);
    for (const weapon of view.players[0].weapons) weapon.usedAbilityIndexes = [0];
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    const play: GameIntent = {
      kind: "play-card",
      instanceId: snatch.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [play, { kind: "pass" }, { kind: "concede" }];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual(play);
  });

  it("uses Dragonscaler Flight Path to convert a second attack from hand", () => {
    const game = state();
    const followup = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    game.players[0].hand = [followup];
    const view = projectStateFor(game, 0);
    const flightPath = view.players[0].equipment.legs!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [
      {
        attackingCard: { instanceId: 90_141, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_142, cardId: "HNT060", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_143, cardId: "SFA019", owner: 0 },
        defendingCards: [], attackValue: 5, defenseValue: 0, damage: 5,
        resolved: false, hit: true, reactions: [],
      },
    ];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flightPath.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "activate-ability", sourceInstanceId: flightPath.instanceId, pitchInstanceIds: [] });
  });

  it("preserves Dragonscaler on terminal Breaking Point after Mask already triggered", () => {
    const game = state();
    game.players[0].hand = [];
    const view = projectStateFor(game, 0);
    const flightPath = view.players[0].equipment.legs!;
    const mask = view.players[0].equipment.head!;
    view.turnFacts!.players[0].usedOncePerTurnEffectSourceIds = [mask.instanceId];
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [
      {
        attackingCard: { instanceId: 90_143_1, cardId: "ANQ029", owner: 0 },
        defendingCards: [], attackValue: 4, defenseValue: 0, damage: 4,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_143_2, cardId: "UPR075", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_143_4, cardId: "UPR093", owner: 0 },
        defendingCards: [], attackValue: 7, defenseValue: 0, damage: 7,
        resolved: false, hit: true, reactions: [],
      },
    ];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flightPath.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("preserves Dragonscaler when the only stranded followup can be arsenaled", () => {
    const game = state();
    const snatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    game.players[0].hand = [snatch];
    const view = projectStateFor(game, 0);
    const flightPath = view.players[0].equipment.legs!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [{
      attackingCard: { instanceId: 90_144, cardId: "HNT067", owner: 0 },
      defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
      resolved: false, hit: true, reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flightPath.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("uses Dragonscaler when two followup attacks would otherwise be stranded", () => {
    const game = state();
    const firstSnatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    const secondSnatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    game.players[0].hand = [firstSnatch, secondSnatch];
    const view = projectStateFor(game, 0);
    const flightPath = view.players[0].equipment.legs!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [{
      attackingCard: { instanceId: 90_145, cardId: "HNT067", owner: 0 },
      defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
      resolved: false, hit: true, reactions: [],
    }];
    const freeActivation: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: flightPath.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [
      freeActivation,
      {
        kind: "activate-ability",
        sourceInstanceId: flightPath.instanceId,
        pitchInstanceIds: [firstSnatch.instanceId],
        pitchRequired: 1,
      },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual(freeActivation);
  });

  it("does not use Dragonscaler before the attack-reaction window", () => {
    const game = state();
    const firstSnatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    const secondSnatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    game.players[0].hand = [firstSnatch, secondSnatch];
    const view = projectStateFor(game, 0);
    const flightPath = view.players[0].equipment.legs!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.chain = [{
      attackingCard: { instanceId: 90_145_1, cardId: "HNT067", owner: 0 },
      defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
      resolved: false, hit: true, reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flightPath.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("uses Dragonscaler on a Draconic Snatch that can draw a followup", () => {
    const game = state();
    game.players[0].hand = [];
    const view = projectStateFor(game, 0);
    const flightPath = view.players[0].equipment.legs!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [{
      attackingCard: {
        instanceId: 90_146,
        cardId: "ANQ031",
        owner: 0,
        grantedTypes: ["draconic"],
      },
      defendingCards: [], attackValue: 4, defenseValue: 0, damage: 4,
      resolved: false, hit: true, reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flightPath.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "activate-ability", sourceInstanceId: flightPath.instanceId, pitchInstanceIds: [] });
  });

  it("uses Flick and Vest to pay the last resource for Dragonscaler", () => {
    const game = state();
    const firstSnatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    const secondSnatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    game.players[0].hand = [firstSnatch, secondSnatch];
    game.players[0].graveyard.push(game.players[0].weapons.shift()!);
    game.players[0].resources = 0;
    game.players[1].life = 9;
    game.players[0].equipment.chest = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT168",
      owner: 0,
    };
    const view = projectStateFor(game, 0);
    const flightPath = view.players[0].equipment.legs!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.chain = [
      {
        attackingCard: { instanceId: 90_147, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_148, cardId: "SFA019", owner: 0 },
        defendingCards: [], attackValue: 5, defenseValue: 0, damage: 5,
        resolved: false, hit: true, reactions: [],
      },
    ];
    const flick = view.players[0].equipment.arms!;
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    let legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      {
        kind: "activate-ability",
        sourceInstanceId: flightPath.instanceId,
        pitchInstanceIds: [firstSnatch.instanceId],
        pitchRequired: 1,
      },
      { kind: "pass" },
      { kind: "concede" },
    ];
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] });

    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Blood Splattered Vest: gain 1 resource and add a stain counter?",
      options: ["yes", "no"],
    };
    legal = [
      { kind: "choose", optionId: "yes" },
      { kind: "choose", optionId: "no" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "yes" });

    view.players[0].resources = 1;
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    legal = [
      { kind: "activate-ability", sourceInstanceId: flightPath.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "activate-ability", sourceInstanceId: flightPath.instanceId, pitchInstanceIds: [] });
  });

  it("does not pitch a poor four-card hand into a Kunai opener", () => {
    const game = state();
    const hand = [0, 1, 2, 3].map(() => ({
      instanceId: game.nextInstanceId++,
      cardId: "ANQ031",
      owner: 0 as const,
    }));
    game.players[0].hand = hand;
    const view = projectStateFor(game, 0);
    const kunai = view.players[0].weapons[0]!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    const snatchPlay: GameIntent = {
      kind: "play-card",
      instanceId: hand[0]!.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [
      {
        kind: "activate-ability",
        sourceInstanceId: kunai.instanceId,
        pitchInstanceIds: [hand[0]!.instanceId],
        pitchRequired: 1,
      },
      snatchPlay,
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual({ kind: "pass" });
  });

  it("uses Flick for Cut only when it converts another no-go-again attack", () => {
    const game = state();
    const rising = { instanceId: game.nextInstanceId++, cardId: "SFA022", owner: 0 };
    const hot = { instanceId: game.nextInstanceId++, cardId: "HNT067", owner: 0 };
    const cut = { instanceId: game.nextInstanceId++, cardId: "HNT176", owner: 0 };
    const snatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    game.players[0].hand = [rising, hot, cut, snatch];
    game.players[0].resources = 0;
    const view = projectStateFor(game, 0);
    const dagger = view.players[0].weapons[0]!;
    const flick = view.players[0].equipment.arms!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    let legal: GameIntent[] = [
      { kind: "play-card", instanceId: rising.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: hot.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: cut.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: snatch.instanceId, pitchInstanceIds: [] },
      {
        kind: "activate-ability",
        sourceInstanceId: dagger.instanceId,
        pitchInstanceIds: [hot.instanceId],
        pitchRequired: 1,
      },
      {
        kind: "activate-ability",
        sourceInstanceId: dagger.instanceId,
        pitchInstanceIds: [cut.instanceId],
        pitchRequired: 1,
      },
      { kind: "pass" },
      { kind: "concede" },
    ];
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "play-card", instanceId: rising.instanceId, pitchInstanceIds: [] });

    view.players[0].hand = [hot, cut, snatch];
    view.chain = [{
      attackingCard: rising,
      defendingCards: [], attackValue: 3, defenseValue: 1, damage: 2,
      resolved: true, hit: true, goAgain: true, reactions: [],
    }];
    legal = [
      { kind: "play-card", instanceId: hot.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: cut.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: snatch.instanceId, pitchInstanceIds: [] },
      {
        kind: "activate-ability",
        sourceInstanceId: dagger.instanceId,
        pitchInstanceIds: [hot.instanceId],
        pitchRequired: 1,
      },
      {
        kind: "activate-ability",
        sourceInstanceId: dagger.instanceId,
        pitchInstanceIds: [cut.instanceId],
        pitchRequired: 1,
      },
      { kind: "pass" },
      { kind: "concede" },
    ];
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "play-card", instanceId: hot.instanceId, pitchInstanceIds: [] });

    view.players[0].hand = [cut];
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain.push({
      attackingCard: hot,
      defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
      resolved: false, hit: true, goAgain: true, reactions: [],
    });
    legal = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });

    view.players[0].hand = [cut, snatch];
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] });
  });

  it("does not spend Throw Dagger or Flick while visible Ward prevents the dagger hit", () => {
    const game = state();
    const tag = { instanceId: game.nextInstanceId++, cardId: "HNT092", owner: 0 };
    const cut = { instanceId: game.nextInstanceId++, cardId: "HNT176", owner: 0 };
    const display = { instanceId: game.nextInstanceId++, cardId: "HNT060", owner: 0 };
    const bloodRunsDeep = { instanceId: game.nextInstanceId++, cardId: "HNT057", owner: 0 };
    const throwDagger = { instanceId: game.nextInstanceId++, cardId: "HNT175", owner: 0 };
    game.players[0].hand = [cut, display, bloodRunsDeep, throwDagger];
    game.players[1].board = [{ instanceId: game.nextInstanceId++, cardId: "AZS016", owner: 1 }];
    const view = projectStateFor(game, 0);
    const flick = view.players[0].equipment.arms!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [{
      attackingCard: tag,
      defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0,
      resolved: false, hit: false, goAgain: true, reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: throwDagger.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("uses Throw Dagger to clear Ward for Mask when Flick is unavailable", () => {
    const game = state();
    const view = projectStateFor(game, 0);
    const throwDagger = { instanceId: 90_010, cardId: "HNT175", owner: 0 as const };
    view.players[0].hand = [throwDagger];
    view.players[0].handCount = 1;
    view.players[0].weapons = [view.players[0].weapons[0]!];
    view.players[1].board = [{ instanceId: 90_011, cardId: "AZS016", owner: 1 }];
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [
      {
        attackingCard: { instanceId: 90_012, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_013, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_014, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 1, defenseValue: 0, damage: 1,
        resolved: false, hit: false, goAgain: true, reactions: [],
      },
    ];
    const throwIntent: GameIntent = {
      kind: "play-card",
      instanceId: throwDagger.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [throwIntent, { kind: "pass" }, { kind: "concede" }];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual(throwIntent);
  });

  it("always Flicks when clearing Ward makes the active chain link hit", () => {
    const game = state();
    const view = projectStateFor(game, 0);
    const throwDagger = { instanceId: 90_020, cardId: "HNT175", owner: 0 as const };
    view.players[0].hand = [throwDagger];
    view.players[0].handCount = 1;
    view.players[1].board = [{ instanceId: 90_021, cardId: "AZS016", owner: 1 }];
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.players[0].weapons = [view.players[0].weapons[0]!];
    view.chain = [{
      attackingCard: { instanceId: 90_022, cardId: "HNT058", owner: 0 },
      defendingCards: [], attackValue: 1, defenseValue: 0, damage: 1,
      resolved: false, hit: false, goAgain: true, reactions: [],
    }];
    const flick = view.players[0].equipment.arms!;
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flick.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: throwDagger.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual({
      kind: "activate-ability",
      sourceInstanceId: flick.instanceId,
      pitchInstanceIds: [],
    });
  });

  it("uses a paid dagger opener when every hand attack needs two Draconic links", () => {
    const game = state();
    const hand = ["HNT067", "HNT059", "HNT060"].map((cardId) => ({
      instanceId: game.nextInstanceId++,
      cardId,
      owner: 0 as const,
    }));
    game.players[0].hand = hand;
    game.players[0].resources = 0;
    const view = projectStateFor(game, 0);
    const dagger = view.players[0].weapons[0]!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    const daggerIntent: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: dagger.instanceId,
      pitchInstanceIds: [hand[0]!.instanceId],
      pitchRequired: 1,
    };
    const legal: GameIntent[] = [
      daggerIntent,
      ...hand.map((card): GameIntent => ({
        kind: "play-card",
        instanceId: card.instanceId,
        pitchInstanceIds: [],
      })),
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual(daggerIntent);
  });

  it("uses Kunai to unlock conditional go again through visible Ward", () => {
    const game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["UPR098", "HNT064", "GEM014", "HNT064"]);
    game.players[1]!.board = [{
      instanceId: game.nextInstanceId++,
      cardId: "AZS016",
      owner: 1,
    }];

    const intent = cindraIntent(game);
    expect(intent.kind).toBe("activate-ability");
    if (intent.kind !== "activate-ability") return;
    expect(game.players[0]!.weapons.map((card) => card.instanceId))
      .toContain(intent.sourceInstanceId);
    expect(intent.pitchInstanceIds).toHaveLength(1);
    expect(intent.pitchInstanceIds.map((instanceId) =>
      game.players[0]!.hand.find((card) => card.instanceId === instanceId)?.cardId
    )).toEqual(["GEM014"]);
  });

  it("opens with a dagger to unlock Display Loyalty and free Blood Runs Deep", () => {
    const game = state();
    const tag = { instanceId: game.nextInstanceId++, cardId: "HNT092", owner: 0 };
    const cut = { instanceId: game.nextInstanceId++, cardId: "HNT176", owner: 0 };
    const display = { instanceId: game.nextInstanceId++, cardId: "HNT060", owner: 0 };
    const bloodRunsDeep = { instanceId: game.nextInstanceId++, cardId: "HNT057", owner: 0 };
    game.players[0].hand = [tag, cut, display, bloodRunsDeep];
    game.players[0].resources = 0;
    game.players[1].board = [{ instanceId: game.nextInstanceId++, cardId: "OMN038", owner: 1 }];
    const view = projectStateFor(game, 0);
    const dagger = view.players[0].weapons[0]!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    const daggerIntent: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: dagger.instanceId,
      pitchInstanceIds: [cut.instanceId],
      pitchRequired: 1,
    };
    const legal: GameIntent[] = [
      daggerIntent,
      ...game.players[0].hand.map((card): GameIntent => ({
        kind: "play-card",
        instanceId: card.instanceId,
        pitchInstanceIds: [],
      })),
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual(daggerIntent);
  });

  it("plays Burning Blade Dance before a terminal attack once two Draconic links are active", () => {
    const game = state();
    const burningBladeDance = { instanceId: game.nextInstanceId++, cardId: "HNT064", owner: 0 };
    const cut = { instanceId: game.nextInstanceId++, cardId: "HNT176", owner: 0 };
    const breakingPoint = { instanceId: game.nextInstanceId++, cardId: "FAB091", owner: 0 };
    game.players[0].hand = [cut, burningBladeDance, breakingPoint];
    game.players[0].resources = 1;
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.chain = [
      {
        attackingCard: { instanceId: 90_161, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 2, damage: 0,
        resolved: true, hit: false, goAgain: true, reactions: [],
      },
      {
        attackingCard: { ...view.players[0].weapons[0]! },
        defendingCards: [], attackValue: 1, defenseValue: 0, damage: 1,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
    ];
    const burningBladeDanceIntent: GameIntent = {
      kind: "play-card",
      instanceId: burningBladeDance.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: cut.instanceId, pitchInstanceIds: [] },
      burningBladeDanceIntent,
      { kind: "play-card", instanceId: breakingPoint.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual(burningBladeDanceIntent);
  });

  it("uses a mid-chain dagger when Ignite makes the activation free", () => {
    const game = state();
    const cut = { instanceId: game.nextInstanceId++, cardId: "HNT176", owner: 0 };
    game.players[0].hand = [cut];
    game.players[0].resources = 0;
    const view = projectStateFor(game, 0);
    const dagger = view.players[0].weapons[0]!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.chain = [{
      attackingCard: { instanceId: 90_149, cardId: "HNT058", owner: 0 },
      defendingCards: [], attackValue: 2, defenseValue: 2, damage: 0,
      resolved: true, hit: false, goAgain: true, reactions: [],
    }];
    view.ongoing.push({
      seat: 0,
      cardId: "HNT058",
      label: "play costs 1 less · activation costs 1 less",
    });
    const freeDagger: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: dagger.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    };
    const legal: GameIntent[] = [
      freeDagger,
      { kind: "play-card", instanceId: cut.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual(freeDagger);
  });

  it("keeps Dragonscaler Flight Path when only recovered weapons remain", () => {
    const game = state();
    game.players[0].hand = [];
    const view = projectStateFor(game, 0);
    const flightPath = view.players[0].equipment.legs!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [{
      attackingCard: { instanceId: 90_151, cardId: "SFA019", owner: 0 },
      defendingCards: [], attackValue: 5, defenseValue: 0, damage: 5,
      resolved: false, hit: true, reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: flightPath.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("forces another attack after two consecutive hits to threaten Mask", () => {
    const game = state();
    const attack = {
      instanceId: game.nextInstanceId++,
      cardId: "ANQ031",
      owner: 0,
    };
    game.players[0].hand = [attack];
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.chain = [
      {
        attackingCard: { instanceId: 90_201, cardId: "HNT083", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3, resolved: true, hit: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_202, cardId: "HNT157", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3, resolved: true, hit: true, reactions: [],
      },
    ];
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: attack.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "play-card", instanceId: attack.instanceId, pitchInstanceIds: [] });
  });

  it("buys destroyed Draconic daggers back when none remain equipped", () => {
    const game = state();
    replaceHand(game, 0, ["HNT175"]);
    game.players[0]!.graveyard.push(...game.players[0]!.weapons.splice(0));
    const view = projectStateFor(game, 0);
    const blue = view.players[0].hand[0]!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    view.players[0].weapons = [];
    const legal: GameIntent[] = [
      {
        kind: "activate-ability",
        sourceInstanceId: view.players[0].heroInstanceId,
        pitchInstanceIds: [blue.instanceId],
        pitchRequired: 3,
      },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({
        kind: "activate-ability",
        sourceInstanceId: view.players[0].heroInstanceId,
        pitchInstanceIds: [blue.instanceId],
        pitchRequired: 3,
      });
  });

  it("never buys daggers back during the opponent's turn", () => {
    const game = state();
    replaceHand(game, 0, ["RNR020", "FAB307", "FAB307"]);
    game.players[0]!.graveyard.push(...game.players[0]!.weapons.splice(0));
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 1;
    view.turn = 3;
    view.phase = "action";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    view.players[0].weapons = [];
    const heroActivation: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: view.players[0].heroInstanceId,
      pitchInstanceIds: view.players[0].hand.map((card) => card.instanceId),
      pitchRequired: 3,
    };
    const legal: GameIntent[] = [heroActivation, { kind: "pass" }, { kind: "concede" }];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("never plays Draco Fire during the opponent's turn", () => {
    const game = state();
    replaceHand(game, 0, ["OMN245", "HNT067"]);
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 1;
    view.turn = 3;
    view.phase = "action";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    const dracoFire = view.players[0].hand.find((card) => card.cardId === "OMN245")!;
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: dracoFire.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("plays Draco Fire before a one-cost Draconic attack", () => {
    const game = state();
    replaceHand(game, 0, ["OMN245", "GEM011"]);
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.players[0].actionPoints = 1;
    view.players[0].weapons = [];
    const dracoFire = view.players[0].hand.find((card) => card.cardId === "OMN245")!;
    const playDracoFire: GameIntent = {
      kind: "play-card",
      instanceId: dracoFire.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [playDracoFire, { kind: "pass" }, { kind: "concede" }];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual(playDracoFire);
  });

  it("does not play Draco Fire in response to an attack on the stack", () => {
    const game = state();
    replaceHand(game, 0, ["OMN245", "GEM011"]);
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "layer";
    view.players[0].actionPoints = 1;
    view.stack = [{
      card: { instanceId: game.nextInstanceId++, cardId: "ANQ029", owner: 0 },
      seat: 0,
      label: "Ravenous Rabble",
      optional: false,
    }];
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    const dracoFire = view.players[0].hand.find((card) => card.cardId === "OMN245")!;
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: dracoFire.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it.each([
    ["zero-cost", "HNT067"],
    ["two-cost", "HNT057"],
  ] as const)("does not play Draco Fire before a %s attack", (_cost, attackCardId) => {
    const game = state();
    replaceHand(game, 0, ["OMN245", attackCardId]);
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.players[0].actionPoints = 1;
    view.players[0].weapons = [];
    const dracoFire = view.players[0].hand.find((card) => card.cardId === "OMN245")!;
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: dracoFire.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("plays Draco Fire before an available Kunai activation", () => {
    const game = state();
    replaceHand(game, 0, ["OMN245"]);
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.players[0].actionPoints = 1;
    const dracoFire = view.players[0].hand[0]!;
    const playDracoFire: GameIntent = {
      kind: "play-card",
      instanceId: dracoFire.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [playDracoFire, { kind: "pass" }, { kind: "concede" }];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual(playDracoFire);
  });

  it("attacks with a Kunai before playing a second Draco Fire", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["OMN245", "OMN245"]);
    replaceDeck(game, 0, []);
    game.players[0]!.resources = 0;

    const firstDracoFire = cindraIntent(game);
    expect(firstDracoFire.kind).toBe("play-card");
    if (firstDracoFire.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) =>
      card.instanceId === firstDracoFire.instanceId
    )?.cardId).toBe("OMN245");
    game = apply(game, 0, firstDracoFire);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );

    const firstKunai = cindraIntent(game);
    expect(firstKunai.kind).toBe("activate-ability");
    if (firstKunai.kind !== "activate-ability") return;
    expect(game.players[0]!.weapons.some((weapon) =>
      weapon.instanceId === firstKunai.sourceInstanceId
    )).toBe(true);
    expect(firstKunai.pitchInstanceIds).toEqual([]);
  });

  it("holds Flick so two Draco Fires can empower both available Kunai", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["OMN245", "OMN245"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, ["RNR020"]);
    game.players[0]!.resources = 0;

    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );
    const firstKunai = cindraIntent(game);
    expect(firstKunai.kind).toBe("activate-ability");
    if (firstKunai.kind !== "activate-ability") return;
    const firstKunaiId = firstKunai.sourceInstanceId;
    game = apply(game, 0, firstKunai);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    expect(cindraIntent(game)).toEqual({ kind: "pass" });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true && candidate.priorityPlayer === 0
    );

    const secondDracoFire = cindraIntent(game);
    expect(secondDracoFire.kind).toBe("play-card");
    if (secondDracoFire.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) =>
      card.instanceId === secondDracoFire.instanceId
    )?.cardId).toBe("OMN245");
    game = apply(game, 0, secondDracoFire);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );

    const secondKunai = cindraIntent(game);
    expect(secondKunai.kind).toBe("activate-ability");
    if (secondKunai.kind !== "activate-ability") return;
    expect(game.players[0]!.weapons.some((weapon) =>
      weapon.instanceId === secondKunai.sourceInstanceId
    )).toBe(true);
    expect(secondKunai.sourceInstanceId).not.toBe(firstKunaiId);
    expect(secondKunai.pitchInstanceIds).toEqual([]);
  });

  it("does not treat Claw of Vynserakai as a Draco Fire followup", () => {
    const game = state();
    replaceHand(game, 0, ["OMN245"]);
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.players[0].actionPoints = 1;
    view.players[0].weapons = [{ ...view.players[0].weapons[0]!, cardId: "SEA257" }];
    const dracoFire = view.players[0].hand[0]!;
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: dracoFire.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it.each([
    ["Cindra", "HNT054", "hero"],
    ["Fealty", "HNT167", "board"],
    ["Flamescale Furnace", "UPR084", "chest"],
    ["Dragonscaler Flight Path", "HNT143", "legs"],
    ["Fyendal's Spring Tunic", "WTR150", "chest"],
  ] as const)("never activates the %s instant ability during the opponent's turn", (_name, cardId, zone) => {
    const game = state();
    game.players[0]!.graveyard.push(...game.players[0]!.weapons.splice(0));
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 1;
    view.turn = 3;
    view.phase = "action";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    const source = { instanceId: game.nextInstanceId++, cardId, owner: 0 as const };
    const sourceInstanceId = zone === "hero" ? view.players[0].heroInstanceId : source.instanceId;
    if (zone === "board") view.players[0].board = [source];
    if (zone === "chest") view.players[0].equipment.chest = source;
    if (zone === "legs") view.players[0].equipment.legs = source;
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("buys a dagger early only when a blocked link needs Flick Knives and none remain", () => {
    const game = state();
    game.players[0]!.hand = [];
    game.players[0]!.graveyard.push(...game.players[0]!.weapons.splice(0));
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [
      {
        attackingCard: { instanceId: 90_251, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
        resolved: true, hit: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_252, cardId: "HNT060", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0,
        resolved: false, hit: false, reactions: [],
      },
    ];
    const legal: GameIntent[] = [
      {
        kind: "activate-ability",
        sourceInstanceId: view.players[0].heroInstanceId,
        pitchInstanceIds: [],
      },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({
        kind: "activate-ability",
        sourceInstanceId: view.players[0].heroInstanceId,
        pitchInstanceIds: [],
      });
  });

  it("does not pitch three Draconic reds for recovery before they make it free", () => {
    const game = state();
    replaceHand(game, 0, ["SFA022", "SFA023", "HNT157"]);
    game.players[0].graveyard.push(...game.players[0].weapons.splice(0));
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.players[0].actionPoints = 0;
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [{
      attackingCard: { instanceId: 90_255, cardId: "HNT083", owner: 0 },
      defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0,
      resolved: false, hit: false, goAgain: true, reactions: [],
    }];
    const prematureRecovery: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: view.players[0].heroInstanceId,
      pitchInstanceIds: view.players[0].hand.map((card) => card.instanceId),
      pitchRequired: 3,
    };
    const legal: GameIntent[] = [prematureRecovery, { kind: "pass" }, { kind: "concede" }];

    expect(view.players[0].hand.map((card) => cardData[card.cardId]?.name)).toEqual([
      "Rising Resentment",
      "Ronin Renegade",
      "Blaze Headlong",
    ]);
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("does not pay three resources for a second dagger", () => {
    const game = state();
    const view = projectStateFor(game, 0);
    const blue = view.players[0].hand[0]!;
    blue.cardId = "HNT175";
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    view.players[0].weapons = [view.players[0].weapons[0]!];
    const legal: GameIntent[] = [
      {
        kind: "activate-ability",
        sourceInstanceId: view.players[0].heroInstanceId,
        pitchInstanceIds: [blue.instanceId],
        pitchRequired: 3,
      },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("keeps attacking resources instead of paying to recover the second dagger", () => {
    const game = state();
    game.players[0]!.hand = [{ instanceId: game.nextInstanceId++, cardId: "WTR082", owner: 0 }];
    game.players[0]!.resources = 1;
    game.players[0]!.graveyard.push(game.players[0]!.weapons.pop()!);
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.players[0].actionPoints = 0;
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [
      {
        attackingCard: { instanceId: 90_261, cardId: "HNT083", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_262, cardId: "HNT060", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
        resolved: false, hit: true, goAgain: false, reactions: [],
      },
    ];
    const recovery: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: view.players[0].heroInstanceId,
      pitchInstanceIds: [view.players[0].hand[0]!.instanceId],
      pitchRequired: 1,
    };
    const legal: GameIntent[] = [recovery, { kind: "pass" }, { kind: "concede" }];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("ends a resolved chain instead of paying to recover the second dagger", () => {
    const game = state();
    const hand = [0, 1, 2, 3].map(() => ({
      instanceId: game.nextInstanceId++,
      cardId: "WTR082",
      owner: 0 as const,
    }));
    game.players[0]!.hand = hand;
    game.players[0]!.graveyard.push(game.players[0]!.weapons.pop()!);
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.chain = [
      {
        attackingCard: { instanceId: 90_263, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 2, damage: 0,
        resolved: true, hit: false, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_264, cardId: "HNT060", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0,
        resolved: true, hit: false, goAgain: true, reactions: [],
      },
    ];
    const recovery: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: view.players[0].heroInstanceId,
      pitchInstanceIds: [hand[0]!.instanceId],
      pitchRequired: 1,
    };
    const legal: GameIntent[] = [
      recovery,
      {
        kind: "activate-ability",
        sourceInstanceId: view.players[0].weapons[0]!.instanceId,
        pitchInstanceIds: [hand[0]!.instanceId],
        pitchRequired: 1,
      },
      { kind: "close-chain" },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(view.players[0].weapons).toHaveLength(1);
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "close-chain" });
  });

  it("preserves Lava Burst instead of paying for a mid-chain dagger", () => {
    const game = state();
    const lavaBurst = { instanceId: game.nextInstanceId++, cardId: "SFA019", owner: 0 };
    const displayLoyalty = { instanceId: game.nextInstanceId++, cardId: "HNT060", owner: 0 };
    game.players[0]!.hand = [lavaBurst, displayLoyalty];
    const view = projectStateFor(game, 0);
    const dagger = view.players[0].weapons[0]!;
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.chain = [
      {
        attackingCard: { instanceId: 90_281, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_282, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
    ];
    const legal: GameIntent[] = [
      {
        kind: "activate-ability",
        sourceInstanceId: dagger.instanceId,
        pitchInstanceIds: [lavaBurst.instanceId],
        pitchRequired: 1,
      },
      {
        kind: "activate-ability",
        sourceInstanceId: dagger.instanceId,
        pitchInstanceIds: [displayLoyalty.instanceId],
        pitchRequired: 1,
      },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("declines Blood Splattered Vest without a one-cost card or necessary recovery", () => {
    const game = state();
    game.players[0]!.hand = [];
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Blood Splattered Vest: gain 1 resource and add a stain counter?",
      options: ["yes", "no"],
    };
    const legal: GameIntent[] = [
      { kind: "choose", optionId: "yes" },
      { kind: "choose", optionId: "no" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "no" });
  });

  it("uses Blood Splattered Vest when its resource is needed to recover the only dagger", () => {
    const game = state();
    game.players[0]!.hand = [];
    game.players[0]!.resources = 0;
    game.players[0]!.graveyard.push(...game.players[0]!.weapons.splice(0));
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.chain = [{
      attackingCard: { instanceId: 90_291, cardId: "HNT058", owner: 0 },
      defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
      resolved: false, hit: true, goAgain: false, reactions: [],
    }];
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Blood Splattered Vest: gain 1 resource and add a stain counter?",
      options: ["yes", "no"],
    };
    const legal: GameIntent[] = [
      { kind: "choose", optionId: "yes" },
      { kind: "choose", optionId: "no" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "yes" });
  });

  it("does not pop a newly created Fealty during the reaction window", () => {
    const game = state();
    const fealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 };
    const payoff = { instanceId: game.nextInstanceId++, cardId: "FAB307", owner: 0 };
    game.players[0]!.board.push(fealty);
    game.players[0]!.hand = [payoff];
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [{
      attackingCard: { instanceId: 90_301, cardId: "HNT058", owner: 0 },
      defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2, resolved: false, reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: fealty.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("holds Fealty when the available non-Draconic attack has no payoff", () => {
    const game = state();
    const fealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 };
    const snatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    game.players[0]!.board.push(fealty);
    game.players[0]!.hand = [snatch];
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: fealty.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: snatch.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .not.toEqual({ kind: "activate-ability", sourceInstanceId: fealty.instanceId, pitchInstanceIds: [] });
  });

  it("uses Fealty on Tag the Target when it unlocks the two-link Draconic sequence", () => {
    const game = state();
    const fealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 };
    const tag = { instanceId: game.nextInstanceId++, cardId: "HNT092", owner: 0 };
    const display = { instanceId: game.nextInstanceId++, cardId: "HNT060", owner: 0 };
    const bloodRunsDeep = { instanceId: game.nextInstanceId++, cardId: "HNT057", owner: 0 };
    game.players[0].board.push(fealty);
    game.players[0].hand = [tag, display, bloodRunsDeep];
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    const fealtyIntent: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: fealty.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [
      fealtyIntent,
      ...game.players[0].hand.map((card): GameIntent => ({
        kind: "play-card",
        instanceId: card.instanceId,
        pitchInstanceIds: [],
      })),
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData })).toEqual(fealtyIntent);
  });

  it("plays a natural third Draconic link instead of spending Fealty or pitching Cut Through", () => {
    const game = state();
    const fealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 };
    const hotOnTheirHeels = { instanceId: game.nextInstanceId++, cardId: "HNT067", owner: 0 };
    const cutThrough = { instanceId: game.nextInstanceId++, cardId: "HNT176", owner: 0 };
    game.players[0]!.board.push(fealty);
    game.players[0]!.hand = [cutThrough, hotOnTheirHeels];
    game.players[0]!.graveyard.push(...game.players[0]!.weapons.splice(0));
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.chain = [
      {
        attackingCard: { instanceId: 90_321, cardId: "FAB307", owner: 0 },
        defendingCards: [], attackValue: 4, defenseValue: 0, damage: 4,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_322, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 2, damage: 0,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
    ];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: fealty.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: hotOnTheirHeels.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: cutThrough.instanceId, pitchInstanceIds: [] },
      {
        kind: "activate-ability",
        sourceInstanceId: view.players[0].heroInstanceId,
        pitchInstanceIds: [cutThrough.instanceId],
        pitchRequired: 1,
      },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "play-card", instanceId: hotOnTheirHeels.instanceId, pitchInstanceIds: [] });
  });

  it("counts Draconic attacks in hand before spending Fealty on the missing third link", () => {
    const game = state();
    const fealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 };
    const hotOnTheirHeels = { instanceId: game.nextInstanceId++, cardId: "HNT067", owner: 0 };
    const snatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    game.players[0]!.board.push(fealty);
    game.players[0]!.hand = [hotOnTheirHeels, snatch];
    game.players[0]!.graveyard.push(...game.players[0]!.weapons.splice(0));
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.pendingDecision = null;
    view.chain = [{
      attackingCard: { instanceId: 90_331, cardId: "HNT058", owner: 0 },
      defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
      resolved: true, hit: true, goAgain: true, reactions: [],
    }];
    let legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: fealty.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: hotOnTheirHeels.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: snatch.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "play-card", instanceId: hotOnTheirHeels.instanceId, pitchInstanceIds: [] });

    view.players[0].hand = [snatch];
    view.chain.push({
      attackingCard: hotOnTheirHeels,
      defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
      resolved: true, hit: true, goAgain: true, reactions: [],
    });
    legal = [
      { kind: "activate-ability", sourceInstanceId: fealty.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: snatch.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "activate-ability", sourceInstanceId: fealty.instanceId, pitchInstanceIds: [] });
  });

  it("plays the pending-Fealty Snatch before recovering daggers from a resolved chain", () => {
    const game = state();
    const snatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    game.players[0]!.hand = [snatch];
    game.players[0]!.graveyard.push(...game.players[0]!.weapons.splice(0));
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "action";
    view.players[0].actionPoints = 0;
    view.chain = [
      {
        attackingCard: {
          instanceId: 90_371,
          cardId: "FAB307",
          owner: 0,
          grantedTypes: ["draconic"],
        },
        defendingCards: [], attackValue: 4, defenseValue: 0, damage: 4,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_372, cardId: "HNT083", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_373, cardId: "HNT057", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0,
        resolved: true, hit: false, goAgain: true, reactions: [],
      },
    ];
    view.ongoing.push({
      seat: 0,
      cardId: "HNT167",
      label: "the next card you play this turn is Draconic",
    });
    view.pendingDecision = {
      player: 0,
      kind: "priority-window",
      prompt: "Fealty has resolved — play an instant or pass",
    };
    const heroActivation: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: view.players[0].heroInstanceId,
      pitchInstanceIds: [snatch.instanceId],
      pitchRequired: 1,
    };
    let legal: GameIntent[] = [heroActivation, { kind: "pass" }, { kind: "concede" }];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });

    view.pendingDecision = null;
    view.players[0].actionPoints = 1;
    legal = [
      heroActivation,
      { kind: "play-card", instanceId: snatch.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
      { kind: "concede" },
    ];
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "play-card", instanceId: snatch.instanceId, pitchInstanceIds: [] });

    view.players[0].hand = [];
    view.players[0].actionPoints = 0;
    view.ongoing = [];
    view.chain.push({
      attackingCard: { ...snatch, grantedTypes: ["draconic"] },
      defendingCards: [], attackValue: 5, defenseValue: 0, damage: 5,
      resolved: false, reactions: [],
    });
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    const freeBuyback: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: view.players[0].heroInstanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    };
    legal = [freeBuyback, { kind: "pass" }, { kind: "concede" }];
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual(freeBuyback);
  });

  it("banks a Vest resource when played plus held Draconic attacks total fewer than three", () => {
    const game = state();
    const snatch = { instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 };
    game.players[0]!.hand = [snatch];
    game.players[0]!.resources = 0;
    game.players[0]!.graveyard.push(...game.players[0]!.weapons.splice(0));
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.chain = [
      {
        attackingCard: { instanceId: 90_341, cardId: "HNT083", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_342, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_343, cardId: "HNT067", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0,
        resolved: false, hit: true, goAgain: true, reactions: [],
      },
    ];
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Blood Splattered Vest: gain 1 resource and add a stain counter?",
      options: ["yes", "no"],
    };
    const legal: GameIntent[] = [
      { kind: "choose", optionId: "yes" },
      { kind: "choose", optionId: "no" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "yes" });
  });

  it("compares Blood Runs Deep's discounted cost with floating resources before staining Vest", () => {
    const game = state();
    game.players[0]!.hand = [{ instanceId: game.nextInstanceId++, cardId: "HNT057", owner: 0 }];
    game.players[0]!.graveyard.push(game.players[0]!.weapons.shift()!);
    game.players[0]!.resources = 0;
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.chain = [{
      attackingCard: { instanceId: 90_362, cardId: "HNT083", owner: 0 },
      defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0,
      resolved: false, hit: true, goAgain: true, reactions: [],
    }];
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Blood Splattered Vest: gain 1 resource and add a stain counter?",
      options: ["yes", "no"],
    };
    const legal: GameIntent[] = [
      { kind: "choose", optionId: "yes" },
      { kind: "choose", optionId: "no" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "yes" });

    view.chain.unshift({
      attackingCard: { instanceId: 90_361, cardId: "HNT067", owner: 0 },
      defendingCards: [], attackValue: 3, defenseValue: 0, damage: 3,
      resolved: true, hit: true, goAgain: true, reactions: [],
    });
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "yes" });

    view.ongoing.push({
      seat: 0,
      cardId: "HNT058",
      label: "play costs 1 less · activation costs 1 less",
    });
    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "no" });
  });

  it("preserves Vest when Fealty can supply the missing third Draconic link", () => {
    const game = state();
    game.players[0]!.hand = [{ instanceId: game.nextInstanceId++, cardId: "ANQ031", owner: 0 }];
    game.players[0]!.board.push({ instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 });
    game.players[0]!.resources = 0;
    game.players[0]!.graveyard.push(...game.players[0]!.weapons.splice(0));
    const view = projectStateFor(game, 0);
    view.priorityPlayer = 0;
    view.activePlayer = 0;
    view.turn = 2;
    view.phase = "reaction";
    view.chain = [
      {
        attackingCard: { instanceId: 90_351, cardId: "HNT058", owner: 0 },
        defendingCards: [], attackValue: 2, defenseValue: 0, damage: 2,
        resolved: true, hit: true, goAgain: true, reactions: [],
      },
      {
        attackingCard: { instanceId: 90_352, cardId: "HNT067", owner: 0 },
        defendingCards: [], attackValue: 3, defenseValue: 3, damage: 0,
        resolved: false, hit: true, goAgain: true, reactions: [],
      },
    ];
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Blood Splattered Vest: gain 1 resource and add a stain counter?",
      options: ["yes", "no"],
    };
    const legal: GameIntent[] = [
      { kind: "choose", optionId: "yes" },
      { kind: "choose", optionId: "no" },
      { kind: "concede" },
    ];

    expect(chooseCindraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "no" });
  });
});

describe("Cindra engine-driven behavior scenarios", () => {
  it("reuses every traced checkpoint through no-response play with an ally on board", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT070", "HNT070", "HNT070"]);
    replaceDeck(game, 0, []);
    game.players[0].weapons = [];
    game.players[0].equipment = {};
    const ally = {
      instanceId: game.nextInstanceId++,
      cardId: "SEA052",
      owner: 0 as const,
      life: 7,
    };
    game.players[0].board.push(ally);
    const publicGameId = "cindra-cache-ally";
    const rootInput = {
      seat: 0 as const,
      view: projectStateFor(game, 0, publicGameId),
      legal: legalIntents(game, 0),
      cards: cardData,
      state: game,
    };
    const decision = chooseCindraIntentWithTrace(rootInput);
    const checkpoints = decision.plan?.checkpoints ?? [];
    expect(decision.plan?.nodes).toBeLessThanOrEqual(6);
    expect(decision.plan?.transitions).toBeLessThanOrEqual(24);
    expect(decision.plan?.candidateTrace.rootPrepared).toBeLessThanOrEqual(6);
    expect(checkpoints.length).toBeGreaterThan(1);
    expect(checkpoints[0]?.intent).toEqual(decision.intent);
    expect(rootInput.view.players[0].board.some((card) => card.instanceId === ally.instanceId))
      .toBe(true);

    let forcedBotSteps = 0;
    for (const [index, checkpoint] of checkpoints.entries()) {
      expect(isCleanActionDecision(game, 0)).toBe(true);
      const input = {
        seat: 0 as const,
        view: projectStateFor(game, 0, publicGameId),
        legal: legalIntents(game, 0),
        cards: cardData,
        state: game,
      };
      expect(botObservationKey(input)).toBe(checkpoint.observationKey);
      expect(input.legal).toContainEqual(checkpoint.intent);
      if (index > 0) {
        expect(chooseCindraContinuationIntent(input, checkpoint.intent))
          .toEqual(checkpoint.intent);
      }
      game = apply(game, 0, checkpoint.intent);
      if (index === checkpoints.length - 1) break;

      for (let step = 0; step < 80 && !isCleanActionDecision(game, 0); step++) {
        const actor = (game.pendingDecision?.player ?? game.priorityPlayer) as Seat;
        const legal = legalIntents(game, actor).filter((intent) => intent.kind !== "concede");
        const intent = actor === 0
          ? chooseCindraIntent({
              seat: 0,
              view: projectStateFor(game, 0, publicGameId),
              legal,
              cards: cardData,
            })
          : game.pendingDecision?.kind === "defend"
            ? legal.find((candidate) =>
                candidate.kind === "defend" && candidate.instanceIds.length === 0
              )
            : legal.find((candidate) =>
                candidate.kind === "choose" && candidate.optionId === "pay 0"
              )
              ?? legal.find((candidate) => candidate.kind === "choose" &&
                ["no", "decline", "pass"].includes(candidate.optionId))
              ?? legal.find((candidate) => candidate.kind === "pass")
              ?? legal.find((candidate) => candidate.kind === "close-chain")
              ?? legal.find((candidate) => candidate.kind === "order-triggers")
              ?? legal.find((candidate) => candidate.kind === "skip-runechant");
        if (!intent) throw new Error(`no no-response continuation from ${game.phase}`);
        if (actor === 0) forcedBotSteps++;
        game = apply(game, actor, intent);
      }
      expect(isCleanActionDecision(game, 0)).toBe(true);
    }
    expect(forcedBotSteps).toBeGreaterThan(0);
  });

  it("uses Draco Fire to play Breaking Point for free instead of pitching it", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["OMN245", "FAB091"]);
    replaceDeck(game, 0, []);
    game.players[0]!.resources = 0;
    game.players[0]!.weapons = [];

    const dracoFire = cindraIntent(game);
    expect(dracoFire.kind).toBe("play-card");
    if (dracoFire.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === dracoFire.instanceId)?.cardId)
      .toBe("OMN245");
    game = apply(game, 0, dracoFire);
    game = advanceUntil(game, (candidate) =>
      candidate.stack.length === 0 && (
        candidate.pendingDecision?.kind === "priority-window" ||
        (candidate.phase === "action" && candidate.pendingDecision === null)
      )
    );
    const breakingPoint = cindraIntent(game);
    expect(breakingPoint.kind).toBe("play-card");
    if (breakingPoint.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === breakingPoint.instanceId)?.cardId)
      .toBe("FAB091");
    expect(breakingPoint.pitchInstanceIds).toEqual([]);
    game = apply(game, 0, breakingPoint);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    expect(projectStateFor(game, 0).chain.at(-1)?.attackValue).toBe(7);
  });

  it("preserves the last dagger after the third consecutive-hit window", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["ANQ029", "UPR075", "PEN250", "OMN245", "UPR093"]);
    replaceDeck(game, 0, ["HNT157"]);
    replaceHand(game, 1, []);
    game.players[0]!.resources = 0;
    game.players[0]!.equipment.chest = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT168",
      owner: 0,
    };

    const playExpectedAttack = (cardId: string): void => {
      const attack = cindraIntent(game);
      expect(attack.kind === "play-card" || attack.kind === "play-from-zone").toBe(true);
      if (attack.kind !== "play-card" && attack.kind !== "play-from-zone") return;
      const cards = [...game.players[0]!.hand, ...game.players[0]!.banish];
      expect(cards.find((card) => card.instanceId === attack.instanceId)?.cardId).toBe(cardId);
      game = apply(game, 0, attack);
      game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
      game = defendWith(game, 1, []);
      game = advanceUntil(game, (candidate) =>
        candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
      );
    };
    const finishAttack = (expectedLinks: number): void => {
      expect(cindraIntent(game)).toEqual({ kind: "pass" });
      game = applyCindra(game);
      game = advanceUntil(game, (candidate) =>
        candidate.phase === "action" && candidate.chain.length === expectedLinks &&
        candidate.chain.at(-1)?.resolved === true
      );
    };

    playExpectedAttack("ANQ029");
    finishAttack(1);

    playExpectedAttack("UPR075");
    expect(cindraIntent(game)).toEqual({ kind: "pass" });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "choose-target" &&
      candidate.pendingDecision?.prompt.toLowerCase().includes("rising resentment") === true
    );
    const enflameChoice = cindraIntent(game);
    expect(enflameChoice.kind).toBe("choose");
    if (enflameChoice.kind !== "choose") return;
    expect(game.players[0]!.hand.find((card) =>
      card.instanceId === Number(enflameChoice.optionId)
    )?.cardId).toBe("PEN250");
    game = apply(game, 0, enflameChoice);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 2 &&
      candidate.chain[1]?.resolved === true
    );

    playExpectedAttack("PEN250");
    finishAttack(3);
    expect(game.players[0]!.hand.some((card) => card.cardId === "HNT157")).toBe(true);

    playExpectedAttack("HNT157");
    finishAttack(4);

    const dracoFire = cindraIntent(game);
    expect(dracoFire.kind).toBe("play-card");
    if (dracoFire.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === dracoFire.instanceId)?.cardId)
      .toBe("OMN245");
    game = apply(game, 0, dracoFire);
    game = advanceUntil(game, (candidate) =>
      candidate.stack.length === 0 && (
        candidate.pendingDecision?.kind === "priority-window" ||
        (candidate.phase === "action" && candidate.pendingDecision === null)
      )
    );

    const kunai = cindraIntent(game);
    expect(kunai.kind).toBe("activate-ability");
    if (kunai.kind !== "activate-ability") return;
    expect(game.players[0]!.weapons.map((weapon) => weapon.instanceId)).toContain(kunai.sourceInstanceId);
    expect(kunai.pitchInstanceIds).toEqual([]);
    game = apply(game, 0, kunai);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    expect(projectStateFor(game, 0).chain.at(-1)?.attackValue).toBe(3);
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );

    expect(cindraIntent(game)).toEqual({ kind: "pass" });
  });

  it("banks a Flick Knives hit to play Draco, Kunai, and Breaking Point", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT058", "HNT157", "HNT067", "OMN245", "FAB091"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, []);
    game.players[0]!.resources = 0;
    game.players[0]!.weapons = [game.players[0]!.weapons.find((weapon) =>
      cardData[weapon.cardId]?.name === "Kunai of Retribution"
    )!];
    game.players[0]!.equipment.chest = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT168",
      owner: 0,
    };

    for (const cardId of ["HNT058", "HNT157"] as const) {
      game = playCard(game, 0, cardId);
      game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
      game = defendWith(game, 1, []);
      game = advanceUntil(game, (candidate) =>
        candidate.phase === "action" && candidate.chain.at(-1)?.resolved === true
      );
    }

    game = playCard(game, 0, "HNT067");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );

    game.players[1]!.life = 9;
    const flick = cindraIntent(game);
    expect(flick).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.equipment.arms!.instanceId,
    });
    game = apply(game, 0, flick);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Flick Knives") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Blood Splattered Vest") === true
    );
    expect(cindraIntent(game)).toEqual({ kind: "choose", optionId: "yes" });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 3 &&
      candidate.chain[2]?.resolved === true
    );
    expect(game.players[0]!.resources).toBe(1);
    expect(game.players[0]!.graveyard.some((card) =>
      cardData[card.cardId]?.name === "Kunai of Retribution"
    )).toBe(true);

    const recover = cindraIntent(game);
    expect(recover).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
      pitchInstanceIds: [],
    });
    game = apply(game, 0, recover);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Draconic daggers") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.stack.length === 0 && (
        candidate.pendingDecision?.kind === "priority-window" ||
        (candidate.phase === "action" && candidate.pendingDecision === null)
      )
    );
    expect(game.players[0]!.weapons.some((weapon) =>
      cardData[weapon.cardId]?.name === "Kunai of Retribution"
    )).toBe(true);
    expect(game.players[0]!.resources).toBe(1);

    const dracoFire = cindraIntent(game);
    expect(dracoFire.kind).toBe("play-card");
    if (dracoFire.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === dracoFire.instanceId)?.cardId)
      .toBe("OMN245");
    game = apply(game, 0, dracoFire);
    game = advanceUntil(game, (candidate) =>
      candidate.stack.length === 0 && (
        candidate.pendingDecision?.kind === "priority-window" ||
        (candidate.phase === "action" && candidate.pendingDecision === null)
      )
    );
    expect(game.players[0]!.resources).toBe(1);
    expect(legalIntents(game, 0).some((intent) =>
      intent.kind === "activate-ability" && game.players[0]!.weapons.some((weapon) =>
        weapon.instanceId === intent.sourceInstanceId
      )
    )).toBe(true);

    const kunai = cindraIntent(game);
    expect(kunai.kind).toBe("activate-ability");
    if (kunai.kind !== "activate-ability") return;
    expect(game.players[0]!.weapons.map((weapon) => weapon.instanceId)).toContain(kunai.sourceInstanceId);
    expect(kunai.pitchInstanceIds).toEqual([]);
    game = apply(game, 0, kunai);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    expect(projectStateFor(game, 0).chain.at(-1)?.attackValue).toBe(3);
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 4 &&
      candidate.chain[3]?.resolved === true
    );

    const breakingPoint = cindraIntent(game);
    expect(breakingPoint.kind).toBe("play-card");
    if (breakingPoint.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === breakingPoint.instanceId)?.cardId)
      .toBe("FAB091");
    expect(breakingPoint.pitchInstanceIds).toEqual([]);
    game = apply(game, 0, breakingPoint);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    expect(projectStateFor(game, 0).chain.at(-1)?.attackValue).toBe(5);
    expect(game.players[0]!.resources).toBe(0);
  });

  it("plays Draco Fire immediately before a free three-power Kunai", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["OMN245"]);
    replaceDeck(game, 0, []);
    game.players[0]!.resources = 0;
    game.players[0]!.weapons = [game.players[0]!.weapons[0]!];

    const dracoFire = cindraIntent(game);
    expect(dracoFire.kind).toBe("play-card");
    if (dracoFire.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === dracoFire.instanceId)?.cardId)
      .toBe("OMN245");
    game = apply(game, 0, dracoFire);
    game = advanceUntil(game, (candidate) =>
      candidate.stack.length === 0 && legalIntents(candidate, 0).some((intent) =>
        intent.kind === "activate-ability" &&
        candidate.players[0]!.weapons.some((weapon) => weapon.instanceId === intent.sourceInstanceId) &&
        intent.pitchInstanceIds.length === 0
      )
    );

    const kunai = cindraIntent(game);
    expect(kunai.kind).toBe("activate-ability");
    if (kunai.kind !== "activate-ability") return;
    expect(game.players[0]!.weapons.map((weapon) => weapon.instanceId)).toContain(kunai.sourceInstanceId);
    expect(kunai.pitchInstanceIds).toEqual([]);
    game = apply(game, 0, kunai);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    expect(projectStateFor(game, 0).chain.at(-1)?.attackValue).toBe(3);
  });

  it("values Draco Fire as a Kunai link before a zero-cost Snatch finisher", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["OMN245", "ANQ031"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, []);
    game.players[0]!.resources = 0;
    game.players[0]!.weapons = [game.players[0]!.weapons[0]!];

    const dracoFire = cindraIntent(game);
    expect(dracoFire.kind).toBe("play-card");
    if (dracoFire.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === dracoFire.instanceId)?.cardId)
      .toBe("OMN245");
    game = apply(game, 0, dracoFire);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );

    const kunai = cindraIntent(game);
    expect(kunai.kind).toBe("activate-ability");
    if (kunai.kind !== "activate-ability") return;
    expect(kunai.pitchInstanceIds).toEqual([]);
    expect(kunai.targetAllyId).toBeUndefined();
    game = apply(game, 0, kunai);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    expect(projectStateFor(game, 0).chain.at(-1)?.attackValue).toBe(3);
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.at(-1)?.resolved === true &&
      candidate.priorityPlayer === 0
    );

    const snatch = cindraIntent(game);
    expect(snatch.kind).toBe("play-card");
    if (snatch.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === snatch.instanceId)?.cardId)
      .toBe("ANQ031");
  });

  it("plays paid Kunai into the hero, then clears Spectra with Snatch in the unconvertible hand", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT059", "ANQ031", "HNT161", "WTR082"]);
    replaceHand(game, 1, []);
    game.players[0]!.resources = 0;
    game.players[0]!.weapons = [game.players[0]!.weapons[0]!];
    const hazeBending = { instanceId: game.nextInstanceId++, cardId: "APR024", owner: 1 as const };
    game.players[1]!.board = [hazeBending];
    const legal = legalIntents(game, 0);
    expect(legal.some((intent) =>
      intent.kind === "activate-ability" && intent.targetAllyId === hazeBending.instanceId
    )).toBe(true);

    const kunai = cindraIntent(game);
    expect(kunai.kind).toBe("activate-ability");
    if (kunai.kind !== "activate-ability") return;
    expect(kunai.pitchInstanceIds.map((id) =>
      game.players[0]!.hand.find((card) => card.instanceId === id)?.cardId
    )).toEqual(["HNT059"]);
    expect(kunai.targetAllyId).toBeUndefined();
    game = apply(game, 0, kunai);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.pendingDecision === null &&
      candidate.stack.length === 0 && candidate.priorityPlayer === 0
    );

    const snatch = cindraIntent(game);
    expect(snatch.kind).toBe("play-card");
    if (snatch.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === snatch.instanceId)?.cardId)
      .toBe("ANQ031");
    expect(snatch.targetAllyId).toBe(hazeBending.instanceId);
  });

  it("delays an ally clear until the guaranteed third hit triggers Mask", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT070", "HNT070", "ANQ031"]);
    replaceDeck(game, 0, ["HNT067"]);
    replaceHand(game, 1, []);
    const moray = addOpponentAlly(game, "SEA051");

    for (let link = 0; link < 2; link++) {
      const attack = cindraIntent(game);
      expect(attack.kind).toBe("play-card");
      if (attack.kind !== "play-card") return;
      expect(game.players[0]!.hand.find((card) => card.instanceId === attack.instanceId)?.cardId)
        .toBe("HNT070");
      expect(attack.targetAllyId).toBeUndefined();
      game = apply(game, 0, attack);
      game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
      game = defendWith(game, 1, []);
      game = advanceUntil(game, (candidate) =>
        candidate.phase === "action" && candidate.chain.length === link + 1 &&
        candidate.chain.at(-1)?.resolved === true
      );
    }

    const thirdHit = cindraIntent(game);
    expect(thirdHit.kind).toBe("play-card");
    if (thirdHit.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === thirdHit.instanceId)?.cardId)
      .toBe("ANQ031");
    expect(thirdHit.targetAllyId).toBe(moray.instanceId);
    game = apply(game, 0, thirdHit);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 3 &&
      candidate.chain.at(-1)?.resolved === true
    );

    expect(game.players[1]!.board.some((card) => card.instanceId === moray.instanceId)).toBe(false);
    const maskId = game.players[0]!.equipment.head!.instanceId;
    expect(projectStateFor(game, 0).turnFacts?.players[0].usedOncePerTurnEffectSourceIds)
      .toContain(maskId);
  });

  it("keeps a nonlethal attack on the hero instead of dealing ally chip damage", () => {
    const game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["ANQ031"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, []);
    addOpponentAlly(game, "SEA052");

    const snatch = cindraIntent(game);
    expect(snatch.kind).toBe("play-card");
    if (snatch.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === snatch.instanceId)?.cardId)
      .toBe("ANQ031");
    expect(snatch.targetAllyId).toBeUndefined();
  });

  it("uses Draco Fire to kill Chum before another ally", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["OMN245", "UPR093"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, []);
    const chum = addOpponentAlly(game, "SEA050");
    const moray = addOpponentAlly(game, "SEA051");

    const dracoFire = cindraIntent(game);
    expect(dracoFire.kind).toBe("play-card");
    if (dracoFire.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === dracoFire.instanceId)?.cardId)
      .toBe("OMN245");
    game = apply(game, 0, dracoFire);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );

    const breakingPoint = cindraIntent(game);
    expect(breakingPoint.kind).toBe("play-card");
    if (breakingPoint.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === breakingPoint.instanceId)?.cardId)
      .toBe("UPR093");
    expect(breakingPoint.targetAllyId).toBe(chum.instanceId);
    game = apply(game, 0, breakingPoint);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.at(-1)?.resolved === true
    );

    expect(game.players[1]!.board.some((card) => card.instanceId === chum.instanceId)).toBe(false);
    expect(game.players[1]!.board.some((card) => card.instanceId === moray.instanceId)).toBe(true);
  });

  it("commits a continuing attack to Chum when the held followup completes the kill", () => {
    const game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["UPR075", "ANQ031"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, []);
    const chum = addOpponentAlly(game, "SEA050");

    const rising = cindraIntent(game);
    expect(rising.kind).toBe("play-card");
    if (rising.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === rising.instanceId)?.cardId)
      .toBe("UPR075");
    expect(rising.targetAllyId).toBe(chum.instanceId);
  });

  it("uses Draco Fire's three-power Kunai before Snatch to kill Chum", () => {
    let game = state(0);
    game.turn = 2;
    game.players[0]!.resources = 1;
    replaceHand(game, 0, ["OMN245", "ANQ031"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, []);
    const chum = addOpponentAlly(game, "SEA050");

    const dracoFire = cindraIntent(game);
    expect(dracoFire.kind).toBe("play-card");
    if (dracoFire.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === dracoFire.instanceId)?.cardId)
      .toBe("OMN245");
    game = apply(game, 0, dracoFire);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );

    const kunai = cindraIntent(game);
    expect(kunai.kind).toBe("activate-ability");
    if (kunai.kind !== "activate-ability") return;
    const attackingWeapon = game.players[0]!.weapons.find((card) =>
      card.instanceId === kunai.sourceInstanceId
    );
    expect(cardData[attackingWeapon?.cardId ?? ""]?.name).toBe("Kunai of Retribution");
    expect(kunai.pitchInstanceIds).toEqual([]);
    expect(kunai.targetAllyId).toBe(chum.instanceId);
    game = apply(game, 0, kunai);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.priorityPlayer === 0 &&
      candidate.players[1]!.board.find((card) => card.instanceId === chum.instanceId)?.life === 3
    );

    expect(game.players[1]!.board.find((card) => card.instanceId === chum.instanceId)?.life).toBe(3);
    const snatch = cindraIntent(game);
    expect(snatch.kind).toBe("play-card");
    if (snatch.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === snatch.instanceId)?.cardId)
      .toBe("ANQ031");
    expect(snatch.targetAllyId).toBe(chum.instanceId);
  });

  it("plays Burning Blade Dance after Ignite and Kunai instead of terminating with Breaking Point", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT058", "HNT064", "HNT176", "FAB091"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, ["RNR020"]);
    game.players[0]!.equipment.arms = undefined;

    const ignite = cindraIntent(game);
    expect(ignite.kind).toBe("play-card");
    if (ignite.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === ignite.instanceId)?.cardId)
      .toBe("HNT058");
    game = apply(game, 0, ignite);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.pendingDecision === null &&
      candidate.stack.length === 0 && candidate.priorityPlayer === 0
    );

    const kunai = cindraIntent(game);
    expect(kunai.kind).toBe("activate-ability");
    if (kunai.kind !== "activate-ability") return;
    expect(game.players[0]!.weapons.map((card) => card.instanceId)).toContain(kunai.sourceInstanceId);
    expect(kunai.pitchInstanceIds).toEqual([]);
    game = apply(game, 0, kunai);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.pendingDecision === null &&
      candidate.stack.length === 0 && candidate.priorityPlayer === 0
    );

    const burningBladeDance = cindraIntent(game);
    expect(burningBladeDance.kind).toBe("play-card");
    if (burningBladeDance.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === burningBladeDance.instanceId)?.cardId)
      .toBe("HNT064");
  });

  it("plays dagger, Display Loyalty, then free Blood Runs Deep through visible Ward", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT092", "HNT176", "HNT060", "HNT057"]);
    replaceDeck(game, 0, []);
    game.players[1]!.board = [{ instanceId: game.nextInstanceId++, cardId: "OMN038", owner: 1 }];

    const dagger = cindraIntent(game);
    expect(dagger.kind).toBe("activate-ability");
    if (dagger.kind !== "activate-ability") return;
    expect(game.players[0]!.weapons.map((card) => card.instanceId)).toContain(dagger.sourceInstanceId);
    expect(dagger.pitchInstanceIds.map((id) =>
      game.players[0]!.hand.find((card) => card.instanceId === id)?.cardId
    )).toEqual(["HNT176"]);
    game = apply(game, 0, dagger);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.startsWith("Ward:") === true
    );
    game = apply(game, 1, legalIntent(
      game,
      1,
      (candidate) => candidate.kind === "choose",
      "Ward prevention",
    ));
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.pendingDecision === null &&
      candidate.stack.length === 0 && candidate.priorityPlayer === 0
    );

    const display = cindraIntent(game);
    expect(display.kind).toBe("play-card");
    if (display.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === display.instanceId)?.cardId)
      .toBe("HNT060");
    game = apply(game, 0, display);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.pendingDecision === null &&
      candidate.stack.length === 0 && candidate.priorityPlayer === 0
    );

    const bloodRunsDeep = cindraIntent(game);
    expect(bloodRunsDeep.kind).toBe("play-card");
    if (bloodRunsDeep.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === bloodRunsDeep.instanceId)?.cardId)
      .toBe("HNT057");
    expect(bloodRunsDeep.pitchInstanceIds).toEqual([]);
  });

  it("arsenals a poor four-card hand instead of pitching a card into Kunai", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["ANQ031", "ANQ031", "ANQ031", "ANQ031"]);
    replaceDeck(game, 0, ["HNT070", "HNT070"]);

    expect(cindraIntent(game)).toEqual({ kind: "pass" });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "arsenal" && candidate.pendingDecision.player === 0
    );

    const arsenal = cindraIntent(game);
    expect(arsenal.kind).toBe("choose");
    if (arsenal.kind !== "choose") return;
    expect(arsenal.optionId).not.toBe("pass");
    game = apply(game, 0, arsenal);
    game = advanceUntil(game, (candidate) => candidate.turn === 3 && candidate.activePlayer === 1);

    expect(game.players[0]!.hand).toHaveLength(4);
    expect(game.players[0]!.arsenal).toHaveLength(1);
  });

  it("plays Rising then Hot, then Flicks to convert Cut Through into a followup", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["SFA022", "HNT067", "HNT176", "ANQ031"]);
    replaceHand(game, 1, ["RNR020", "RNR020"]);

    const rising = cindraIntent(game);
    expect(rising.kind).toBe("play-card");
    if (rising.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === rising.instanceId)?.cardId)
      .toBe("SFA022");
    game = apply(game, 0, rising);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 && candidate.chain[0]?.resolved === true
    );

    const hot = cindraIntent(game);
    expect(hot.kind).toBe("play-card");
    if (hot.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === hot.instanceId)?.cardId)
      .toBe("HNT067");
    game = apply(game, 0, hot);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );

    const flick = cindraIntent(game);
    expect(flick).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.equipment.arms!.instanceId,
    });
    game = apply(game, 0, flick);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Flick Knives") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 2 && candidate.chain[1]?.resolved === true
    );

    const cut = cindraIntent(game);
    expect(cut.kind).toBe("play-card");
    if (cut.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === cut.instanceId)?.cardId)
      .toBe("HNT176");
    game = apply(game, 0, cut);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    const cutLink = projectStateFor(game, 0).chain.at(-1);
    expect(cutLink?.attackValue).toBe(4);
    expect(cutLink?.goAgain).toBe(true);
    expect(game.players[0]!.hand.some((card) => card.cardId === "ANQ031")).toBe(true);
  });

  it("plays a five-power Lava Burst before buying both spent daggers back at end of turn", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT067", "HNT059", "HNT060", "HNT067"]);
    game.players[0]!.arsenal = [{
      instanceId: game.nextInstanceId++,
      cardId: "HNT175",
      owner: 0,
      faceDown: true,
    }];
    replaceDeck(game, 0, ["SFA019"]);
    replaceHand(game, 1, ["RNR020", "RNR020", "RNR020"]);
    game.players[1]!.life = 9;
    game.players[0]!.equipment.chest = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT168",
      owner: 0,
    };
    const daggerIds = game.players[0]!.weapons.map((card) => card.instanceId);

    const openingDagger = cindraIntent(game);
    expect(openingDagger.kind).toBe("activate-ability");
    if (openingDagger.kind !== "activate-ability") return;
    expect(game.players[0]!.weapons.map((card) => card.instanceId)).toContain(openingDagger.sourceInstanceId);
    expect(openingDagger.pitchInstanceIds.map((id) =>
      game.players[0]!.hand.find((card) => card.instanceId === id)?.cardId
    )).not.toContain("SFA019");
    game = apply(game, 0, openingDagger);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );

    const throwDagger = cindraIntent(game);
    expect(throwDagger.kind).toBe("play-from-arsenal");
    if (throwDagger.kind !== "play-from-arsenal") return;
    expect(game.players[0]!.arsenal.find((card) => card.instanceId === throwDagger.instanceId)?.cardId)
      .toBe("HNT175");
    game = apply(game, 0, throwDagger);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.prompt === "Choose a dagger");
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Blood Splattered Vest") === true
    );
    expect(cindraIntent(game)).toEqual({ kind: "choose", optionId: "yes" });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 && candidate.chain[0]?.resolved === true
    );
    if (game.pendingDecision?.prompt.includes("Blood Splattered Vest")) {
      expect(cindraIntent(game)).toEqual({ kind: "choose", optionId: "no" });
      game = applyCindra(game);
      game = advanceUntil(game, (candidate) =>
        candidate.phase === "action" && candidate.pendingDecision === null &&
        candidate.chain.length === 1 && candidate.chain[0]?.resolved === true
      );
    }
    expect(game.players[0]!.hand.map((card) => card.cardId)).toContain("SFA019");

    const demonstrate = cindraIntent(game);
    expect(demonstrate.kind).toBe("play-card");
    if (demonstrate.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === demonstrate.instanceId)?.cardId)
      .toBe("HNT059");
    game = apply(game, 0, demonstrate);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 2 && candidate.chain[1]?.resolved === true
    );

    const display = cindraIntent(game);
    expect(display.kind).toBe("play-card");
    if (display.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === display.instanceId)?.cardId)
      .toBe("HNT060");
    game = apply(game, 0, display);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );

    const flick = cindraIntent(game);
    expect(flick).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.equipment.arms!.instanceId,
    });
    game = apply(game, 0, flick);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Flick Knives") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Blood Splattered Vest") === true
    );
    expect(cindraIntent(game)).toEqual({ kind: "choose", optionId: "no" });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.stack.length === 0 && candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );
    expect(cindraIntent(game)).not.toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
    });
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 3 && candidate.chain[2]?.resolved === true
    );
    expect(game.players[0]!.graveyard.filter((card) => daggerIds.includes(card.instanceId))).toHaveLength(2);

    const hot = cindraIntent(game);
    expect(hot.kind).toBe("play-card");
    if (hot.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === hot.instanceId)?.cardId)
      .toBe("HNT067");
    game = apply(game, 0, hot);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );
    expect(cindraIntent(game)).not.toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
    });
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 4 && candidate.chain[3]?.resolved === true
    );

    const lavaBurst = cindraIntent(game);
    expect(lavaBurst.kind).toBe("play-card");
    if (lavaBurst.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === lavaBurst.instanceId)?.cardId)
      .toBe("SFA019");
    expect(lavaBurst.pitchInstanceIds).toEqual([]);
    game = apply(game, 0, lavaBurst);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    expect(projectStateFor(game, 0).chain.at(-1)?.attackValue).toBe(5);
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );

    const buyback = cindraIntent(game);
    expect(buyback).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
      pitchInstanceIds: [],
    });
    game = apply(game, 0, buyback);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Draconic daggers") === true
    );
    game = applyCindra(game);
    game = applyCindra(game);

    expect(game.players[0]!.weapons.filter((card) => daggerIds.includes(card.instanceId))).toHaveLength(2);
    const flightPath = game.players[0]!.equipment.legs!;
    expect(cardData[flightPath.cardId]?.name).toBe("Dragonscaler Flight Path");
    expect(cindraIntent(game)).not.toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: flightPath.instanceId,
    });
    expect(game.players[0]!.graveyard.some((card) => card.cardId === "SFA019")).toBe(false);
  });

  it("plays Hot for free recovery without pitching Cut Through or spending spare Fealty", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["FAB307", "WTR082", "HNT058", "HNT176"]);
    replaceDeck(game, 0, ["HNT067"]);
    replaceHand(game, 1, ["RNR020"]);
    game.players[0]!.equipment.chest = undefined;
    const daggerIds = game.players[0]!.weapons.map((card) => card.instanceId);
    game.players[0]!.graveyard.push(game.players[0]!.weapons.shift()!);
    const fealties = [0, 1].map(() => ({
      instanceId: game.nextInstanceId++,
      cardId: "HNT167",
      owner: 0,
    }));
    game.players[0]!.board.push(...fealties);

    const firstFealty = cindraIntent(game);
    expect(firstFealty).toMatchObject({ kind: "activate-ability" });
    if (firstFealty.kind !== "activate-ability") return;
    expect(fealties.map((card) => card.instanceId)).toContain(firstFealty.sourceInstanceId);
    game = apply(game, 0, firstFealty);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );

    const art = cindraIntent(game);
    expect(art.kind).toBe("play-card");
    if (art.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === art.instanceId)?.cardId).toBe("FAB307");
    game = apply(game, 0, art);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );

    const ancestral = cindraIntent(game);
    expect(ancestral.kind).toBe("play-card");
    if (ancestral.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === ancestral.instanceId)?.cardId)
      .toBe("WTR082");
    game = apply(game, 0, ancestral);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 && candidate.chain[0]?.resolved === true
    );
    expect(game.players[0]!.hand.map((card) => card.cardId)).toContain("HNT067");

    const ignite = cindraIntent(game);
    expect(ignite.kind).toBe("play-card");
    if (ignite.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === ignite.instanceId)?.cardId).toBe("HNT058");
    game = apply(game, 0, ignite);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );

    game.players[1]!.life = 9;
    const flick = cindraIntent(game);
    expect(flick).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.equipment.arms!.instanceId,
    });
    game = apply(game, 0, flick);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Flick Knives") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.stack.length === 0 && candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );
    expect(projectStateFor(game, 0).players[0].equipment.arms?.usedAbilityIndexes).toContain(0);
    expect(cindraIntent(game)).not.toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
    });
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 2 && candidate.chain[1]?.resolved === true
    );
    expect(game.players[0]!.graveyard.filter((card) => daggerIds.includes(card.instanceId))).toHaveLength(2);

    const hotOnTheirHeels = cindraIntent(game);
    expect(hotOnTheirHeels.kind).toBe("play-card");
    if (hotOnTheirHeels.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === hotOnTheirHeels.instanceId)?.cardId)
      .toBe("HNT067");
    expect(hotOnTheirHeels.pitchInstanceIds).toEqual([]);
    expect(game.players[0]!.hand.map((card) => card.cardId)).toContain("HNT176");
    expect(game.players[0]!.board.filter((card) => card.cardId === "HNT167")).toHaveLength(1);
    game = apply(game, 0, hotOnTheirHeels);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    if (game.pendingDecision?.kind === "order-triggers") game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 3 && candidate.chain[2]?.resolved === true
    );

    const cutThrough = cindraIntent(game);
    expect(cutThrough.kind).toBe("play-card");
    if (cutThrough.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === cutThrough.instanceId)?.cardId)
      .toBe("HNT176");
    game = apply(game, 0, cutThrough);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" && candidate.pendingDecision.player === 0
    );

    const freeBuyback = cindraIntent(game);
    expect(freeBuyback).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
      pitchInstanceIds: [],
    });
    expect(game.players[0]!.board.filter((card) => card.cardId === "HNT167")).toHaveLength(1);
  });

  it("plays Brand with Cinderclaw before Art so Art actually has go again", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["FAB307", "UPR060"]);
    replaceDeck(game, 0, []);

    const brand = cindraIntent(game);
    expect(brand.kind).toBe("play-card");
    if (brand.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === brand.instanceId)?.cardId)
      .toBe("UPR060");
    game = apply(game, 0, brand);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true
    );

    const art = cindraIntent(game);
    expect(art.kind).toBe("play-card");
    if (art.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === art.instanceId)?.cardId)
      .toBe("FAB307");
    game = apply(game, 0, art);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");

    expect(game.chain.at(-1)?.flags["grantedType:draconic"]).toBe(true);
    expect(game.chain.at(-1)?.goAgain).toBe(true);
  });

  it("spends Fealty on Art of the Dragon: Blood's Draconic payoff", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["FAB307"]);
    replaceDeck(game, 0, []);
    const fealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 };
    game.players[0]!.board.push(fealty);

    const activation = cindraIntent(game);
    expect(activation).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: fealty.instanceId,
    });
    game = apply(game, 0, activation);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );

    expect(game.players[0]!.board.some((card) => card.instanceId === fealty.instanceId)).toBe(false);
    const payoff = cindraIntent(game);
    expect(payoff.kind).toBe("play-card");
    if (payoff.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === payoff.instanceId)?.cardId)
      .toBe("FAB307");
    game = apply(game, 0, payoff);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");

    expect(game.chain.at(-1)?.flags["grantedType:draconic"]).toBe(true);
    expect(game.chain.at(-1)?.goAgain).toBe(true);
  });

  it("uses Vest to fund recovery when the full hand projects only two Draconic links", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["FAB307", "HNT067", "ANQ031"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, ["RNR020"]);
    game.players[1]!.life = 9;
    game.players[0]!.equipment.chest = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT168",
      owner: 0,
    };
    const firstDagger = game.players[0]!.weapons.shift()!;
    game.players[0]!.graveyard.push(firstDagger);
    const fealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 };
    game.players[0]!.board.push(fealty);

    game = apply(game, 0, cindraIntent(game));
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );
    game = playCard(game, 0, "FAB307");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true
    );

    game = playCard(game, 0, "HNT067");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const flick = cindraIntent(game);
    expect(flick.kind).toBe("activate-ability");
    if (flick.kind !== "activate-ability") return;
    expect(cardData[game.players[0]!.equipment.arms?.cardId ?? ""]?.name).toBe("Flick Knives");
    expect(flick.sourceInstanceId).toBe(game.players[0]!.equipment.arms!.instanceId);
    game = apply(game, 0, flick);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.toLowerCase().includes("choose a dagger") === true ||
      candidate.pendingDecision?.prompt.includes("Blood Splattered Vest") === true
    );
    if (game.pendingDecision?.prompt.toLowerCase().includes("choose a dagger")) game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Blood Splattered Vest") === true
    );

    expect(game.players[0]!.weapons).toHaveLength(0);
    expect(game.players[0]!.hand.map((card) => card.cardId)).toEqual(["ANQ031"]);
    expect(cindraIntent(game)).toEqual({ kind: "choose", optionId: "yes" });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 2 &&
      candidate.chain[1]?.resolved === true
    );
    expect(game.players[0]!.resources).toBe(1);

    game = playCard(game, 0, "ANQ031");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const paidBuyback = cindraIntent(game);
    expect(paidBuyback).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
      pitchInstanceIds: [],
    });
    game = apply(game, 0, paidBuyback);
    expect(game.players[0]!.resources).toBe(0);
  });

  it("plays Blood Runs Deep after Art and Fire Tenet before generic finishers", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["FAB307", "HNT083", "HNT057", "ANQ029", "ANQ031"]);
    replaceDeck(game, 0, ["HNT070"]);
    replaceHand(game, 1, ["RNR020"]);
    game.players[0]!.equipment.chest = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT168",
      owner: 0,
    };
    const fealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 };
    game.players[0]!.board.push(fealty);

    game = apply(game, 0, cindraIntent(game));
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );
    game = playCard(game, 0, "FAB307");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true
    );

    game = playCard(game, 0, "HNT083");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );
    const flick = cindraIntent(game);
    expect(flick).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.equipment.arms!.instanceId,
    });
    game = apply(game, 0, flick);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.toLowerCase().includes("choose a dagger") === true ||
      candidate.pendingDecision?.prompt.includes("Blood Splattered Vest") === true
    );
    if (game.pendingDecision?.prompt.toLowerCase().includes("choose a dagger")) game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Blood Splattered Vest") === true
    );

    expect(game.players[0]!.weapons).toHaveLength(1);
    expect(cindraIntent(game)).toEqual({ kind: "choose", optionId: "no" });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 2 &&
      candidate.chain[1]?.resolved === true
    );

    const bloodRunsDeep = cindraIntent(game);
    expect(bloodRunsDeep.kind).toBe("play-card");
    if (bloodRunsDeep.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === bloodRunsDeep.instanceId)?.cardId)
      .toBe("HNT057");
    expect(bloodRunsDeep.pitchInstanceIds).toEqual([]);
  });

  it("plays the complete Fealty, Art, Fire Tenet, Blood Runs, Fealty, Snatch, free-recovery turn", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["FAB307", "HNT083", "HNT057", "ANQ031"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, ["RNR020"]);
    game.players[1]!.hero.counters = { ...(game.players[1]!.hero.counters ?? {}), marked: 1 };
    game.players[0]!.equipment.chest = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT168",
      owner: 0,
    };
    const openingFealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 };
    game.players[0]!.board.push(openingFealty);
    const sequence: string[] = [];

    const fealtyForArt = cindraIntent(game);
    expect(fealtyForArt).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: openingFealty.instanceId,
    });
    sequence.push("Fealty");
    game = apply(game, 0, fealtyForArt);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );

    const art = cindraIntent(game);
    expect(art.kind).toBe("play-card");
    if (art.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === art.instanceId)?.cardId).toBe("FAB307");
    sequence.push("Art of the Dragon: Blood");
    game = apply(game, 0, art);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true
    );

    const fireTenet = cindraIntent(game);
    expect(fireTenet.kind).toBe("play-card");
    if (fireTenet.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === fireTenet.instanceId)?.cardId).toBe("HNT083");
    sequence.push("Fire Tenet: Strike First");
    game = apply(game, 0, fireTenet);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 2 &&
      candidate.chain[1]?.resolved === true
    );

    const bloodRunsDeep = cindraIntent(game);
    expect(bloodRunsDeep.kind).toBe("play-card");
    if (bloodRunsDeep.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === bloodRunsDeep.instanceId)?.cardId)
      .toBe("HNT057");
    expect(bloodRunsDeep.pitchInstanceIds).toEqual([]);
    sequence.push("Blood Runs Deep");
    game = apply(game, 0, bloodRunsDeep);

    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);

    while (!(game.phase === "action" && game.chain.length === 3 && game.chain[2]?.resolved === true &&
      game.stack.length === 0 && game.pendingDecision === null)) {
      game = advanceUntil(game, (candidate) =>
        (candidate.phase === "action" && candidate.chain.length === 3 && candidate.chain[2]?.resolved === true &&
          candidate.stack.length === 0 && candidate.pendingDecision === null) ||
        (candidate.pendingDecision?.kind === "choose-target" &&
          candidate.pendingDecision.prompt.includes("Blood Splattered Vest"))
      );
      if (game.pendingDecision?.kind === "choose-target") {
        expect(cindraIntent(game)).toEqual({ kind: "choose", optionId: "no" });
        game = applyCindra(game);
      }
    }
    expect(game.players[0]!.weapons).toHaveLength(0);

    const recoveryFealty = cindraIntent(game);
    expect(recoveryFealty.kind).toBe("activate-ability");
    if (recoveryFealty.kind !== "activate-ability") return;
    const recoveryFealtyCard = game.players[0]!.board.find((card) =>
      card.instanceId === recoveryFealty.sourceInstanceId
    );
    expect(cardData[recoveryFealtyCard?.cardId ?? ""]?.name).toBe("Fealty");
    sequence.push("Fealty");
    game = apply(game, 0, recoveryFealty);

    for (let step = 0; step < 20; step++) {
      if (game.phase === "action" && game.stack.length === 0 &&
        game.pendingDecision === null && game.priorityPlayer === 0) break;
      const actor = (game.pendingDecision?.player ?? game.priorityPlayer) as Seat;
      if (actor === 0) {
        const priorityIntent = cindraIntent(game);
        expect(priorityIntent).toEqual({ kind: "pass" });
        game = apply(game, 0, priorityIntent);
      } else {
        const pass = legalIntent(game, 1, (intent) => intent.kind === "pass", "priority pass");
        game = apply(game, 1, pass);
      }
    }
    expect(game.phase).toBe("action");
    expect(game.stack).toHaveLength(0);

    const snatch = cindraIntent(game);
    expect(snatch.kind).toBe("play-card");
    if (snatch.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === snatch.instanceId)?.cardId).toBe("ANQ031");
    expect(snatch.pitchInstanceIds).toEqual([]);
    sequence.push("Snatch");
    game = apply(game, 0, snatch);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const flightPath = game.players[0]!.equipment.legs!;
    expect(cardData[flightPath.cardId]?.name).toBe("Dragonscaler Flight Path");
    const flightPathActivation = cindraIntent(game);
    expect(flightPathActivation).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: flightPath.instanceId,
      pitchInstanceIds: [],
    });
    sequence.push("Dragonscaler Flight Path");
    game = apply(game, 0, flightPathActivation);
    game = advanceUntil(game, (candidate) =>
      candidate.stack.length === 0 && candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0 && candidate.players[0]!.equipment.legs === undefined
    );

    const freeRecovery = cindraIntent(game);
    expect(freeRecovery).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    });
    sequence.push("Cindra (free)");
    game = apply(game, 0, freeRecovery);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Equip up to 2 Draconic daggers") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Equip one more Draconic dagger") === true
    );
    game = applyCindra(game);

    expect(game.players[0]!.weapons).toHaveLength(2);
    expect(game.players[0]!.hand).toHaveLength(0);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 4 &&
      candidate.chain[3]?.resolved === true && candidate.pendingDecision === null
    );
    expect(cindraIntent(game)).toEqual({ kind: "close-chain" });
    game = applyCindra(game);
    expect(cindraIntent(game)).toEqual({ kind: "pass" });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) => candidate.turn === 3 && candidate.activePlayer === 1);
    expect(game).toMatchObject({ turn: 3, activePlayer: 1 });

    expect(sequence).toEqual([
      "Fealty",
      "Art of the Dragon: Blood",
      "Fire Tenet: Strike First",
      "Blood Runs Deep",
      "Fealty",
      "Snatch",
      "Dragonscaler Flight Path",
      "Cindra (free)",
    ]);
  });

  it("spends Fealty to make the third Draconic link, then recovers a dagger for free", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT058", "HNT058", "ANQ031"]);
    replaceDeck(game, 0, []);
    game.players[0]!.equipment.arms = undefined;
    const dagger = game.players[0]!.weapons.shift()!;
    game.players[0]!.graveyard.push(dagger);
    const unavailableDagger = game.players[0]!.weapons[0]!;
    game.players[0]!.flags[`activated:${unavailableDagger.instanceId}`] = true;
    const fealty = { instanceId: game.nextInstanceId++, cardId: "HNT167", owner: 0 };
    game.players[0]!.board.push(fealty);

    for (let link = 1; link <= 2; link++) {
      game = playCard(game, 0, "HNT058");
      game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
      game = defendWith(game, 1, []);
      game = advanceUntil(game, (candidate) =>
        candidate.phase === "action" && candidate.chain.length === link &&
        candidate.chain.at(-1)?.resolved === true
      );
    }

    const activation = cindraIntent(game);
    expect(activation).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: fealty.instanceId,
    });
    game = apply(game, 0, activation);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.stack.length === 0 &&
      candidate.pendingDecision === null && candidate.priorityPlayer === 0
    );

    const thirdAttack = cindraIntent(game);
    expect(thirdAttack.kind).toBe("play-card");
    if (thirdAttack.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === thirdAttack.instanceId)?.cardId)
      .toBe("ANQ031");
    game = apply(game, 0, thirdAttack);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const flightPath = game.players[0]!.equipment.legs!;
    const flightPathActivation = cindraIntent(game);
    expect(flightPathActivation).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: flightPath.instanceId,
      pitchInstanceIds: [],
    });
    game = apply(game, 0, flightPathActivation);
    game = advanceUntil(game, (candidate) =>
      candidate.stack.length === 0 && candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0 && candidate.players[0]!.equipment.legs === undefined
    );

    const buyback = cindraIntent(game);
    expect(buyback).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
      pitchInstanceIds: [],
    });
  });

  it("rescues the third consecutive link with Flick, recovers the dagger, and completes Mask", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT058", "HNT058", "HNT058", "HNT070"]);
    replaceDeck(game, 0, ["RNR020"]);
    replaceHand(game, 1, ["RNR020"]);

    for (let link = 1; link <= 2; link++) {
      game = playCard(game, 0, "HNT058");
      game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
      game = defendWith(game, 1, []);
      game = advanceUntil(game, (candidate) =>
        candidate.phase === "action" && candidate.chain.length === link &&
        candidate.chain.at(-1)?.resolved === true
      );
      expect(game.chain.at(-1)?.hit).toBe(true);
    }

    const thirdAttack = cindraIntent(game);
    expect(thirdAttack.kind).toBe("play-card");
    game = apply(game, 0, thirdAttack);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    const blocker = game.players[1]!.hand[0]!;
    game = defendWith(game, 1, [blocker.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const flickId = game.players[0]!.equipment.arms!.instanceId;
    const daggerId = game.players[0]!.weapons[0]!.instanceId;
    const flick = cindraIntent(game);
    expect(flick).toMatchObject({ kind: "activate-ability", sourceInstanceId: flickId });
    game = apply(game, 0, flick);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Flick Knives") === true
    );

    const throwDagger = cindraIntent(game);
    expect(throwDagger).toEqual({ kind: "choose", optionId: String(daggerId) });
    game = apply(game, 0, throwDagger);
    expect(game.chain.at(-1)?.hit).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.instanceId === daggerId)).toBe(true);

    expect(cindraIntent(game)).not.toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
    });

    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 3 &&
      candidate.chain.at(-1)?.resolved === true
    );
    expect(game.chain.at(-1)).toMatchObject({ damage: 0, hit: true, resolved: true });

    const fourthAttack = cindraIntent(game);
    expect(fourthAttack.kind).toBe("play-card");
    game = apply(game, 0, fourthAttack);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const buyback = cindraIntent(game);
    expect(buyback).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
    });
    game = apply(game, 0, buyback);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Draconic daggers") === true
    );
    const equipDagger = cindraIntent(game);
    expect(equipDagger).toEqual({ kind: "choose", optionId: String(daggerId) });
    game = apply(game, 0, equipDagger);
    expect(game.players[0]!.weapons.some((card) => card.instanceId === daggerId)).toBe(true);

    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 4 &&
      candidate.chain.at(-1)?.resolved === true
    );

    expect(game.players[0]!.hand.map((card) => card.cardId)).toContain("RNR020");
    expect(game.players[0]!.deck).toHaveLength(0);
    const maskId = game.players[0]!.equipment.head!.instanceId;
    expect(projectStateFor(game, 0).turnFacts?.players[0].usedOncePerTurnEffectSourceIds)
      .toContain(maskId);
  });

  it("holds Flick while another attack remains, then uses the final window and buys the dagger back", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT058", "HNT058"]);
    game.players[0]!.weapons = [game.players[0]!.weapons[0]!];
    game.players[0]!.flags[`activated:${game.players[0]!.weapons[0]!.instanceId}`] = true;
    game.players[0]!.resources = 2;
    game.players[1]!.life = 9;

    game = playCard(game, 0, "HNT058");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const earlyWindow = cindraIntent(game);
    expect(earlyWindow).not.toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.equipment.arms!.instanceId,
    });
    game = apply(game, 0, earlyWindow);
    game = advanceUntil(game, (candidate) =>
      candidate.stack.length === 0 &&
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );
    expect(cindraIntent(game)).toEqual({ kind: "pass" });
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true
    );

    const daggerId = game.players[0]!.weapons[0]!.instanceId;
    const finalAttack = cindraIntent(game);
    expect(finalAttack.kind).toBe("play-card");
    game = apply(game, 0, finalAttack);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const flickId = game.players[0]!.equipment.arms!.instanceId;
    expect(game.players[0]!.hand).toHaveLength(0);
    expect(projectStateFor(game, 0).players[0].weapons[0]!.usedAbilityIndexes).toContain(0);
    expect(legalIntents(game, 0)).toContainEqual({
      kind: "activate-ability",
      sourceInstanceId: flickId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    });
    const finalFlick = cindraIntent(game);
    expect(finalFlick.kind).toBe("activate-ability");
    if (finalFlick.kind !== "activate-ability") return;
    const finalFlickSource = [
      ...game.players[0]!.weapons,
      ...Object.values(game.players[0]!.equipment).filter((card) => card !== undefined),
    ].find((card) => card.instanceId === finalFlick.sourceInstanceId);
    expect(cardData[finalFlickSource!.cardId]!.name).toBe("Flick Knives");
    expect(finalFlick.sourceInstanceId).toBe(flickId);
    game = apply(game, 0, finalFlick);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Flick Knives") === true
    );
    game = applyCindra(game);
    expect(game.players[0]!.graveyard.some((card) => card.instanceId === daggerId)).toBe(true);

    const buyback = cindraIntent(game);
    expect(buyback).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
    });
    game = apply(game, 0, buyback);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Draconic daggers") === true
    );
    game = applyCindra(game);

    expect(game.players[0]!.weapons.some((card) => card.instanceId === daggerId)).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.instanceId === daggerId)).toBe(false);
  });

  it("Flicks the chain-close Kunai before buying both daggers back on Lava Burst", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT058", "HNT058", "HNT058", "SFA019"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, []);
    game.players[0]!.resources = 1;
    const recoverableKunai = game.players[0]!.weapons.pop()!;
    const attackingKunai = game.players[0]!.weapons[0]!;
    game.players[0]!.graveyard.push(recoverableKunai);

    const daggerAttack = legalIntent(
      game,
      0,
      (intent) => intent.kind === "activate-ability" &&
        intent.sourceInstanceId === attackingKunai.instanceId &&
        intent.pitchInstanceIds.length === 0,
      "Kunai attack",
    );
    game = apply(game, 0, daggerAttack);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true
    );

    for (let link = 2; link <= 4; link++) {
      game = playCard(game, 0, "HNT058");
      game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
      game = defendWith(game, 1, []);
      game = advanceUntil(game, (candidate) =>
        candidate.phase === "action" && candidate.chain.length === link &&
        candidate.chain.at(-1)?.resolved === true
      );
    }

    game = playCard(game, 0, "SFA019");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const flickId = game.players[0]!.equipment.arms!.instanceId;
    expect(cindraIntent(game)).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: flickId,
    });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Flick Knives") === true
    );
    expect(cindraIntent(game)).toEqual({
      kind: "choose",
      optionId: String(attackingKunai.instanceId),
    });
    game = applyCindra(game);

    const buyback = cindraIntent(game);
    expect(buyback).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
      pitchInstanceIds: [],
    });
    game = apply(game, 0, buyback);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Equip up to 2 Draconic daggers") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Equip one more Draconic dagger") === true
    );
    game = applyCindra(game);

    expect(game.players[0]!.weapons.map((card) => card.instanceId).sort((a, b) => a - b))
      .toEqual([attackingKunai.instanceId, recoverableKunai.instanceId].sort((a, b) => a - b));
  });

  it("uses Hot on Their Heels as the second Draconic link because it counts itself", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT058", "HNT067", "ANQ031"]);
    replaceDeck(game, 0, []);

    game = playCard(game, 0, "HNT058");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true
    );

    const hotOnTheirHeels = cindraIntent(game);
    expect(hotOnTheirHeels.kind).toBe("play-card");
    if (hotOnTheirHeels.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === hotOnTheirHeels.instanceId)?.cardId)
      .toBe("HNT067");
    game = apply(game, 0, hotOnTheirHeels);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 2 &&
      candidate.chain[1]?.resolved === true
    );

    expect(game.chain[1]?.goAgain).toBe(true);
    expect(game.players[0]!.actionPoints).toBe(1);
  });

  it("uses Throw Dagger and Blood Splattered Vest to fund a one-cost Draconic attack", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT083", "HNT175", "GEM011"]);
    replaceDeck(game, 0, []);
    game.players[0]!.equipment.chest = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT168",
      owner: 0,
    };

    game = playCard(game, 0, "HNT083");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, []);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const throwDagger = cindraIntent(game);
    expect(throwDagger.kind).toBe("play-card");
    if (throwDagger.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === throwDagger.instanceId)?.cardId)
      .toBe("HNT175");
    game = apply(game, 0, throwDagger);
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.prompt === "Choose a dagger");
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Blood Splattered Vest") === true
    );
    expect(cindraIntent(game)).toEqual({ kind: "choose", optionId: "yes" });
    game = applyCindra(game);

    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true
    );
    expect(game.players[0]!.resources).toBe(1);

    const fundedAttack = cindraIntent(game);
    expect(fundedAttack.kind).toBe("play-card");
    if (fundedAttack.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === fundedAttack.instanceId)?.cardId)
      .toBe("GEM011");
    expect(fundedAttack.pitchInstanceIds).toEqual([]);
  });

  it("Flicks a blocked Ignite but does not stain Vest when Demonstrate Devotion is free", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT083", "HNT058", "HNT059"]);
    replaceDeck(game, 0, []);
    replaceHand(game, 1, ["RNR020", "RNR020"]);
    game.players[0]!.equipment.chest = {
      instanceId: game.nextInstanceId++,
      cardId: "HNT168",
      owner: 0,
    };

    game = playCard(game, 0, "HNT083");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 1 &&
      candidate.chain[0]?.resolved === true
    );

    game = playCard(game, 0, "HNT058");
    game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
    game = defendWith(game, 1, [game.players[1]!.hand[0]!.instanceId]);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    expect(cardData[game.players[0]!.equipment.chest!.cardId]?.name).toBe("Blood Splattered Vest");
    expect(projectStateFor(game, 0).chain[1]).toMatchObject({ attackValue: 3, defenseValue: 3, goAgain: true });
    expect(game.players[0]!.resources).toBe(0);
    expect(game.players[0]!.hand.map((card) => card.cardId)).toEqual(["HNT059"]);
    const flick = cindraIntent(game);
    expect(flick).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.equipment.arms!.instanceId,
    });
    game = apply(game, 0, flick);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Flick Knives") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Blood Splattered Vest") === true
    );
    expect(cindraIntent(game)).toEqual({ kind: "choose", optionId: "no" });
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 2 &&
      candidate.chain[1]?.resolved === true
    );

    expect(game.players[0]!.resources).toBe(0);
    expect(game.players[0]!.equipment.chest?.counters?.stain ?? 0).toBe(0);
    const demonstrateDevotion = cindraIntent(game);
    expect(demonstrateDevotion.kind).toBe("play-card");
    if (demonstrateDevotion.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === demonstrateDevotion.instanceId)?.cardId)
      .toBe("HNT059");
    expect(demonstrateDevotion.pitchInstanceIds).toEqual([]);
    game = apply(game, 0, demonstrateDevotion);
    expect(game.players[0]!.resources).toBe(0);
    expect(game.players[0]!.equipment.chest?.counters?.stain ?? 0).toBe(0);
  });

  it("plays available Draconic links before buying a dagger back for free", () => {
    let game = state(0);
    game.turn = 2;
    replaceHand(game, 0, ["HNT058", "HNT058", "HNT058", "RNR020"]);
    replaceDeck(game, 0, []);
    game.players[0]!.resources = 1;
    const dagger = game.players[0]!.weapons.shift()!;
    game.players[0]!.graveyard.push(dagger);
    const remainingDagger = game.players[0]!.weapons[0]!;
    game.players[0]!.flags[`activated:${remainingDagger.instanceId}`] = true;

    for (let link = 1; link <= 3; link++) {
      const attack = cindraIntent(game);
      expect(attack.kind).toBe("play-card");
      if (attack.kind !== "play-card") return;
      expect(game.players[0]!.hand.find((card) => card.instanceId === attack.instanceId)?.cardId)
        .toBe("HNT058");
      game = apply(game, 0, attack);

      game = advanceUntil(game, (candidate) => candidate.pendingDecision?.kind === "defend");
      game = defendWith(game, 1, []);
      game = advanceUntil(game, (candidate) =>
        candidate.pendingDecision?.kind === "attack-reaction" &&
        candidate.pendingDecision.player === 0
      );
      if (link < 3) {
        let passed = false;
        for (let window = 0; window < 3; window++) {
          const reaction = cindraIntent(game);
          expect(reaction).not.toMatchObject({
            kind: "activate-ability",
            sourceInstanceId: game.players[0]!.hero.instanceId,
          });
          expect(reaction).not.toMatchObject({
            kind: "activate-ability",
            sourceInstanceId: game.players[0]!.equipment.arms!.instanceId,
          });
          if (reaction.kind === "pass") {
            passed = true;
            break;
          }
          game = apply(game, 0, reaction);
          game = advanceUntil(game, (candidate) =>
            candidate.stack.length === 0 &&
            candidate.pendingDecision?.kind === "attack-reaction" &&
            candidate.pendingDecision.player === 0
          );
        }
        expect(passed).toBe(true);
      }

      game = advanceUntil(game, (candidate) =>
        candidate.phase === "action" && candidate.chain.length === link &&
        candidate.chain.at(-1)?.resolved === true
      );
    }

    const resourcesBeforeBuyback = game.players[0]!.resources;
    const buyback = cindraIntent(game);
    expect(buyback).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: game.players[0]!.hero.instanceId,
      pitchInstanceIds: [],
    });
    game = apply(game, 0, buyback);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("Draconic daggers") === true
    );
    game = applyCindra(game);

    expect(game.players[0]!.weapons.some((card) => card.instanceId === dagger.instanceId)).toBe(true);
    expect(game.players[0]!.hand.map((card) => card.cardId)).toEqual(["RNR020"]);
    expect(game.players[0]!.resources).toBe(resourcesBeforeBuyback);
  });

  it("no-blocks with real defend intents, then plays its defense reaction", () => {
    let game = state(1);
    game.turn = 2;
    replaceHand(game, 0, ["ANQ034", "HNT175"]);
    replaceHand(game, 1, ["ANQ031"]);
    const startingLife = game.players[0]!.life;

    game = playCard(game, 1, "ANQ031");
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "defend" && candidate.pendingDecision.player === 0
    );

    const noBlock = cindraIntent(game);
    expect(noBlock).toEqual({ kind: "defend", instanceIds: [] });
    game = apply(game, 0, noBlock);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.kind === "defense-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const reaction = cindraIntent(game);
    expect(reaction.kind).toBe("play-card");
    if (reaction.kind !== "play-card") return;
    expect(game.players[0]!.hand.find((card) => card.instanceId === reaction.instanceId)?.cardId)
      .toBe("ANQ034");
    game = apply(game, 0, reaction);
    game = advanceUntil(game, (candidate) =>
      candidate.pendingDecision?.prompt.includes("bottom of your deck") === true
    );
    game = applyCindra(game);
    game = advanceUntil(game, (candidate) =>
      candidate.phase === "action" && candidate.chain.length === 0
    );

    expect(game.players[0]!.life).toBe(startingLife);
    expect(game.players[0]!.graveyard.some((card) => card.cardId === "ANQ034")).toBe(true);
  });
});
