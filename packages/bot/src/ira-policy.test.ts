import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseIraIntent, chooseIraIntentWithTrace } from "./ira-policy.js";
import { iraPresentation } from "./sideboard.js";

function iraDeck(): Decklist {
  const pool = precon("precon-asr")!.pool;
  return { heroId: pool.heroId, ...iraPresentation() };
}

function replaceHand(
  state: ReturnType<typeof createGame>,
  seat: 0 | 1,
  cardIds: readonly string[],
): void {
  state.players[seat]!.hand = cardIds.map((cardId) => ({
    instanceId: state.nextInstanceId++,
    cardId,
    owner: seat,
  }));
}

function apply(
  state: ReturnType<typeof createGame>,
  seat: 0 | 1,
  intent: GameIntent,
): ReturnType<typeof createGame> {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function advanceUntil(
  initial: ReturnType<typeof createGame>,
  predicate: (state: ReturnType<typeof createGame>) => boolean,
): ReturnType<typeof createGame> {
  let state = initial;
  for (let step = 0; step < 60; step++) {
    if (predicate(state)) return state;
    const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    const legal = legalIntents(state, actor);
    const intent = state.pendingDecision?.kind === "defend"
      ? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
      : legal.find((candidate) => candidate.kind === "pass");
    if (!intent) throw new Error(`no automatic advance from ${state.phase}`);
    state = apply(state, actor, intent);
  }
  throw new Error("state did not reach expected point");
}

describe("Ira policy", () => {
  it("uses an exact three-damage attack to clear untapped Sawbones", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9109,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 1;
    replaceHand(state, 0, ["ASR010"]);
    const sawbones = {
      instanceId: state.nextInstanceId++,
      cardId: "SEA264",
      owner: 1 as const,
      life: 2,
    };
    state.players[1]!.board.push(sawbones);
    const attackId = state.players[0]!.hand[0]!.instanceId;
    const legal = legalIntents(state, 0).filter((candidate) =>
      candidate.kind === "play-card" && candidate.instanceId === attackId
    );

    const intent = chooseIraIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal,
      cards: cardData,
    });
    expect(intent).toMatchObject({
      kind: "play-card",
      targetAllyId: sawbones.instanceId,
    });
  });

  it("chooses a hand card when Felling of the Crown requires one to be bottomed", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9100,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["ASR012", "ASR026"]);
    const options = state.players[0]!.hand.map((card) => String(card.instanceId));
    state.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Put a card from your hand on the bottom of your deck",
      options,
      cardOptions: state.players[0]!.hand.map((card) => card.instanceId),
      sourceInstanceId: state.players[1]!.hero.instanceId,
      chooseHook: "felling-hand:1:0",
    };

    const decision = chooseIraIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    const intent = decision.intent;

    expect(intent.kind).toBe("choose");
    expect(options).toContain(intent.kind === "choose" ? intent.optionId : "");
  });

  it("preserves its opening hand, then puts a card in arsenal", () => {
    let state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9101,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["ASR007", "ASR012", "ASR016", "ASR026"]);

    const opening = chooseIraIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(opening).toEqual({ kind: "pass" });
    state = apply(state, 0, opening);

    const arsenal = chooseIraIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(arsenal.kind).toBe("choose");
    state = apply(state, 0, arsenal);
    expect(state.players[0]!.arsenal).toHaveLength(1);
    expect(state.turn).toBe(2);
  });

  it("preserves staged cards while adding required equipment", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 91011,
      startPlayer: 1,
    });
    const view = projectStateFor(state, 0);
    const equipment = Object.values(view.players[0].equipment).find((card) =>
      card && cardData[card.cardId]?.cardType === "equipment"
    )!;
    const handCard = view.players[0].hand[0]!;
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = {
      player: 0,
      kind: "defend",
      prompt: "Choose defending cards",
      stagedCards: [handCard],
      stagedDefense: handCard.defense ?? 0,
    };
    view.chain = [{
      attackingCard: { instanceId: 99_902, cardId: "EVR073", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "stage-defenders", instanceIds: [handCard.instanceId] },
      { kind: "stage-defenders", instanceIds: [equipment.instanceId] },
      { kind: "concede" },
    ];

    expect(chooseIraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({
        kind: "stage-defenders",
        instanceIds: [handCard.instanceId, equipment.instanceId],
      });
  });

  it("opens on Edge of Autumn when it has a combo chain behind it", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9102,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["ASR012", "ASR025", "ASR008", "ASR026"]);

    const decision = chooseIraIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    const intent = decision.intent;
    expect(intent.kind).toBe("activate-ability");
    if (intent.kind !== "activate-ability") return;
    expect(state.players[0]!.weapons[0]?.instanceId).toBe(intent.sourceInstanceId);
    expect(intent.pitchInstanceIds).toHaveLength(1);
    expect(cardData[state.players[0]!.hand.find((card) =>
      card.instanceId === intent.pitchInstanceIds[0])!.cardId]!.pitch).toBe(3);
    expect(decision.plan?.line.some((candidate) =>
      candidate.kind === "play-card" &&
      state.players[0]!.hand.find((card) => card.instanceId === candidate.instanceId)?.cardId === "ASR012"
    )).toBe(true);
    expect(decision.plan?.nodes).toBeLessThanOrEqual(4);
    expect(decision.plan?.transitions).toBeLessThanOrEqual(8);
    expect(decision.plan?.candidateTrace.rootPrepared).toBeLessThanOrEqual(1);
  });

  it("turns an Edge opener into a red Seek Vengeance combo link", () => {
    let state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9103,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["ASR012", "ASR025", "ASR008", "ASR026"]);
    const edge = chooseIraIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    state = apply(state, 0, edge);
    state = advanceUntil(state, (candidate) =>
      candidate.phase === "action" &&
      candidate.activePlayer === 0 &&
      candidate.priorityPlayer === 0 &&
      candidate.pendingDecision === null &&
      candidate.chain.some((link) => link.resolved)
    );

    const followup = chooseIraIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(followup.kind).toBe("play-card");
    if (followup.kind !== "play-card") return;
    expect(state.players[0]!.hand.find((card) => card.instanceId === followup.instanceId)?.cardId)
      .toBe("ASR012");
  });

  it("uses Razor Reflex in its attack-reaction window", () => {
    let state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9104,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["ASR013", "ASR016", "ASR022", "ASR021"]);
    const snatch = state.players[0]!.hand.find((card) => card.cardId === "ASR013")!;
    state = apply(state, 0, {
      kind: "play-card",
      instanceId: snatch.instanceId,
      pitchInstanceIds: [],
    });
    state = advanceUntil(state, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const intent = chooseIraIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(intent.kind).toBe("play-card");
    if (intent.kind !== "play-card") return;
    expect(state.players[0]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId)
      .toBe("ASR016");
  });

  it("uses Snapdragon Scalers to continue a chain into a reserved attack", () => {
    let state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9109,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["ASR013", "ASR012", "ASR026", "ASR021"]);
    const snatch = state.players[0]!.hand.find((card) => card.cardId === "ASR013")!;
    state = apply(state, 0, {
      kind: "play-card",
      instanceId: snatch.instanceId,
      pitchInstanceIds: [],
    });
    state = advanceUntil(state, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const intent = chooseIraIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(intent.kind).toBe("activate-ability");
    if (intent.kind !== "activate-ability") return;
    expect(state.players[0]!.equipment.legs?.instanceId).toBe(intent.sourceInstanceId);
  });

  it("preserves Snapdragon Scalers when an underblocked attack will get go again on hit", () => {
    let state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9110,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["ASR015", "ASR012", "ASR026", "ASR021"]);
    replaceHand(state, 1, ["ASR012"]);
    const torrent = state.players[0]!.hand.find((card) => card.cardId === "ASR015")!;
    const pitch = state.players[0]!.hand.find((card) => card.cardId === "ASR026")!;
    state = apply(state, 0, {
      kind: "play-card",
      instanceId: torrent.instanceId,
      pitchInstanceIds: [pitch.instanceId],
    });
    state = advanceUntil(state, (candidate) => candidate.pendingDecision?.kind === "defend");
    const defender = state.players[1]!.hand[0]!;
    state = apply(state, 1, { kind: "defend", instanceIds: [defender.instanceId] });
    state = advanceUntil(state, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const view = projectStateFor(state, 0);
    const link = view.chain.at(-1)!;
    expect(link.defenseValue).toBeLessThan(link.attackValue);
    expect(link.onHitEffects?.some((effect) => /go again/i.test(effect.text))).toBe(true);

    const intent = chooseIraIntent({
      seat: 0,
      view,
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(intent).toEqual({ kind: "pass" });
  });

  it("preserves Okana Scar Wraps when its attack is already overblocked", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9111,
      startPlayer: 0,
    });
    const view = projectStateFor(state, 0);
    const wraps = view.players[0].equipment.arms!;
    view.turn = 2;
    view.activePlayer = 0;
    view.priorityPlayer = 0;
    view.phase = "reaction";
    view.pendingDecision = {
      player: 0,
      kind: "attack-reaction",
      prompt: "Play an attack reaction or pass",
    };
    view.chain = [{
      attackingCard: { instanceId: 99_101, cardId: "ASR012", owner: 0 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 5,
      damage: 0,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "pass" },
      { kind: "activate-ability", sourceInstanceId: wraps.instanceId, pitchInstanceIds: [] },
    ];

    expect(chooseIraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("keeps an offensive starter instead of making a nonlethal partial block", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9105,
      startPlayer: 1,
    });
    state.turn = 2;
    replaceHand(state, 0, ["ASR007", "ASR012", "ASR016", "ASR026"]);
    const view = projectStateFor(state, 0);
    const starter = view.players[0].hand.find((card) => card.cardId === "ASR007")!;
    view.phase = "defend";
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 99_001, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 2,
      defenseValue: 0,
      damage: 0,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [starter.instanceId] },
    ];

    expect(chooseIraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });
  });

  it("maximizes prevention when it defends on the opening turn", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9106,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["ASR007", "ASR012", "ASR016", "ASR026"]);
    const view = projectStateFor(state, 0);
    const hand = view.players[0].hand;
    view.phase = "defend";
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 99_002, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 8,
      defenseValue: 0,
      damage: 0,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: hand.slice(0, 1).map((card) => card.instanceId) },
      { kind: "defend", instanceIds: hand.slice(0, 3).map((card) => card.instanceId) },
    ];

    expect(chooseIraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual(legal[2]);
  });

  it("does not add a hand blocker when a defense reaction covers the attack", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 91061,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["ASR018", "ASR012"]);
    const blocker = state.players[0]!.hand[1]!;
    const view = projectStateFor(state, 0);
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 99_003, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 4,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [blocker.instanceId] },
    ];

    expect(chooseIraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });
  });

  it("passes priority instead of stacking more defense reactions over Flic Flak", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 910611,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["ASR017", "ASR018", "ASR017"]);
    const view = projectStateFor(state, 0);
    const [pendingFlicFlak, sinkBelow, secondFlicFlak] = view.players[0].hand;
    view.players[0].hand = [sinkBelow!, secondFlicFlak!];
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "reaction";
    view.pendingDecision = {
      player: 0,
      kind: "defense-reaction",
      prompt: "Play a defense reaction or pass",
    };
    view.chain = [{
      attackingCard: { instanceId: 99_003_1, cardId: "PEN072", owner: 1 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 4,
      resolved: false,
      reactions: [],
    }];
    view.stack = [{
      card: pendingFlicFlak!,
      seat: 0,
      label: "Flic Flak",
      optional: false,
    }];
    const legal: GameIntent[] = [
      { kind: "pass" },
      { kind: "play-card", instanceId: sinkBelow!.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: secondFlicFlak!.instanceId, pitchInstanceIds: [] },
    ];

    expect(chooseIraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("survives lethal with the block that preserves the strongest offense", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 91062,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["ASR007", "ASR010"]);
    state.players[0]!.life = 3;
    const [blockTwo, blockThree] = state.players[0]!.hand;
    const view = projectStateFor(state, 0);
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 99_004, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 4,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [blockTwo!.instanceId] },
      { kind: "defend", instanceIds: [blockThree!.instanceId] },
    ];

    expect(chooseIraIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [blockThree!.instanceId] });
  });

  it("stages a Lava Burst block that survives lethal and maximizes next-turn damage", () => {
    const state = createGame({
      decklists: [iraDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 91063,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["ASR007", "ASR010", "ASR016", "ASR026"]);
    state.players[0]!.life = 5;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 99_906, cardId: "SFA019", owner: 1 },
      defendingCards: [],
      attackValue: 5,
      defenseValue: 0,
      damage: 5,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      ...view.players[0].hand.map((card) => ({
        kind: "stage-defenders" as const,
        instanceIds: [card.instanceId],
      })),
    ];

    const intent = chooseIraIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent.kind).toBe("stage-defenders");
    if (intent.kind !== "stage-defenders") return;
    expect(intent.instanceIds).toHaveLength(1);
    const blocker = view.players[0].hand.find((card) =>
      card.instanceId === intent.instanceIds[0]
    );
    expect(blocker?.cardId).toBe("ASR026");
    expect(blocker?.defense).toBeGreaterThan(0);
  });

  it("only returns authoritative legal intents during a seeded playout", () => {
    let state = createGame({
      decklists: [iraDeck(), iraDeck()],
      cards: cardData,
      scripts,
      seed: 9107,
      startPlayer: 0,
    });
    for (let step = 0; step < 300 && state.winner === null; step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const legal = legalIntents(state, actor).filter((intent) => intent.kind !== "concede");
      expect(
        legal.length,
        `step ${step}: turn ${state.turn}, phase ${state.phase}, pending ${state.pendingDecision?.kind ?? "none"}, actor ${actor}`,
      ).toBeGreaterThan(0);
      const intent = chooseIraIntent({
        seat: actor,
        view: projectStateFor(state, actor),
        legal,
        cards: cardData,
      });
      const advertisedStageIds = new Set(legal.flatMap((candidate) =>
        candidate.kind === "stage-defenders" ? candidate.instanceIds : []
      ));
      expect(
        legal.some((candidate) => JSON.stringify(candidate) === JSON.stringify(intent)) ||
        (intent.kind === "stage-defenders" &&
          intent.instanceIds.every((id) => advertisedStageIds.has(id))),
      ).toBe(true);
      state = apply(state, actor, intent);
    }
  });

  it("cannot distinguish changes to the opponent's hidden hand and deck order", () => {
    const state = createGame({
      decklists: [iraDeck(), iraDeck()],
      cards: cardData,
      scripts,
      seed: 9108,
      startPlayer: 0,
    });
    const { cardsRef: _cardsRef, scriptsRef: _scriptsRef, ...serializable } = state;
    const altered = JSON.parse(JSON.stringify(serializable)) as typeof state;
    altered.cardsRef = cardData;
    altered.scriptsRef = scripts;
    const opponent = altered.players[1]!;
    const handCard = opponent.hand[0]!;
    const deckCard = opponent.deck[0]!;
    opponent.hand[0] = deckCard;
    opponent.deck[0] = handCard;

    const a = projectStateFor(state, 0);
    const b = projectStateFor(altered, 0);
    expect(a).toEqual(b);
    const legal = legalIntents(state, 0);
    expect(chooseIraIntent({ seat: 0, view: a, legal, cards: cardData }))
      .toEqual(chooseIraIntent({ seat: 0, view: b, legal, cards: cardData }));
  });
});
