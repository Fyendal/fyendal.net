import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { CardView, Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseHalaIntent, chooseHalaIntentWithTrace } from "./hala-policy.js";
import { halaPresentationFor } from "./sideboard.js";

function halaDeck(opponent: Decklist = decklists.dorinthea): Decklist {
  const pool = precon("precon-hala-masterclass")!.pool;
  return { heroId: pool.heroId, ...halaPresentationFor(opponent) };
}

function gravyDeck(): Decklist {
  const pool = precon("precon-sgb")!.pool;
  return {
    heroId: "AGB001",
    weaponIds: pool.weaponIds,
    equipment: {
      head: "SGB003",
      chest: "SGB004",
      arms: "SGB007",
      legs: "SGB008",
    },
    deck: pool.deck,
  };
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

function addOpponentAlly(
  state: ReturnType<typeof createGame>,
  cardId: string,
  life = cardData[cardId]?.life ?? 1,
): CardView {
  const ally = {
    instanceId: state.nextInstanceId++,
    cardId,
    owner: 1 as const,
    life,
  };
  state.players[1]!.board.push(ally);
  return ally;
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
  for (let step = 0; step < 80; step++) {
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

function chooseRerebracePayment(options: {
  counters: number;
  resolvingCardId?: string;
  heldCardId?: string;
  opponentLife?: number;
  attackValue?: number;
  seat?: 0 | 1;
}): GameIntent {
  const seat = options.seat ?? 0;
  const opponent = (1 - seat) as 0 | 1;
  const state = createGame({
    decklists: seat === 0
      ? [halaDeck(), decklists.dorinthea]
      : [decklists.dorinthea, halaDeck()],
    cards: cardData,
    scripts,
    seed: 9390,
    startPlayer: seat,
  });
  const view = projectStateFor(state, seat);
  view.turn = 2;
  view.players[seat].resources = 2;
  replaceHand(state, seat, options.heldCardId ? [options.heldCardId, "HNT117"] : ["HNT117"]);
  view.players[seat].hand = projectStateFor(state, seat).players[seat].hand;
  view.players[seat].handCount = view.players[seat].hand.length;
  const blade = view.players[seat].weapons[0]!;
  blade.counters = { power: options.counters, sharpenedTurn: 2 };
  view.players[opponent].life = options.opponentLife ?? 40;
  view.phase = "layer";
  view.priorityPlayer = seat;
  view.pendingDecision = {
    player: seat,
    kind: "optional-effect",
    prompt: "Reverent Rerebrace: pay 1 and destroy this to sharpen an additional time?",
    options: ["paid", "no"],
    resourcePayment: {
      cost: 1,
      options: [{ optionId: "paid", pitchInstanceIds: [] }],
    },
  };
  view.stack = options.resolvingCardId
    ? [{
        card: { instanceId: 99_390, cardId: options.resolvingCardId, owner: seat },
        seat,
        label: `Resolve ${cardData[options.resolvingCardId]?.name}`,
        optional: false,
      }]
    : [];
  view.chain = options.attackValue === undefined
    ? []
    : [{
        attackingCard: blade,
        defendingCards: [],
        attackValue: options.attackValue,
        defenseValue: 0,
        damage: options.attackValue,
        resolved: false,
        reactions: [],
      }];
  return chooseHalaIntent({
    seat,
    view,
    legal: [
      { kind: "choose", optionId: "paid" },
      { kind: "choose", optionId: "no" },
    ],
    cards: cardData,
  });
}

describe("Hala policy", () => {
  it("preserves its opening hand and prioritizes a Flurry generator for arsenal", () => {
    let state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9301,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["MPW103", "PEN048", "PEN319", "MPW046"]);

    const opening = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(opening).toEqual({ kind: "pass" });
    state = apply(state, 0, opening);

    const arsenal = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(arsenal.kind).toBe("choose");
    state = apply(state, 0, arsenal);
    expect(state.players[0]!.arsenal[0]?.cardId).toBe("MPW103");
  });

  it("values Shelter from the Storm as a four-defense arsenal card", () => {
    let state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9322,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["PEN321", "PEN319", "PEN054", "PEN049"]);

    const opening = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(opening).toEqual({ kind: "pass" });
    state = apply(state, 0, opening);

    const arsenal = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    state = apply(state, 0, arsenal);
    expect(state.players[0]!.arsenal[0]?.cardId).toBe("PEN321");
  });

  it("starts its Drawn and yellow Edict Flurry line instead of passing", () => {
    const opponent = gravyDeck();
    const state = createGame({
      decklists: [opponent, halaDeck(opponent)],
      cards: cardData,
      scripts,
      seed: 93011,
      startPlayer: 1,
    });
    state.turn = 2;
    replaceHand(state, 1, ["MPW030", "MPW104", "HVY209", "OMN238"]);

    const decision = chooseHalaIntentWithTrace({
      seat: 1,
      view: projectStateFor(state, 1),
      legal: legalIntents(state, 1),
      cards: cardData,
      state,
    });

    expect(decision.intent).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[1]!.hero.instanceId,
    });
  });

  it.each(["SEA050", "SEA051", "SEA052", "SEA264"])(
    "starts the Drawn and yellow Edict line against Gravy ally %s",
    (allyCardId) => {
      const opponent = gravyDeck();
      const state = createGame({
        decklists: [halaDeck(opponent), opponent],
        cards: cardData,
        scripts,
        seed: 93012,
        startPlayer: 0,
      });
      state.turn = 2;
      replaceHand(state, 0, ["MPW030", "MPW104", "HVY209", "OMN238"]);
      addOpponentAlly(state, allyCardId);

      const decision = chooseHalaIntentWithTrace({
        seat: 0,
        view: projectStateFor(state, 0),
        legal: legalIntents(state, 0),
        cards: cardData,
        state,
      });

      expect(decision.intent).toMatchObject({
        kind: "activate-ability",
        sourceInstanceId: state.players[0]!.hero.instanceId,
      });
    },
  );

  it("keeps Ripple Away in hand to block instead of putting it into an empty arsenal", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9338,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["HVY209"]);
    const view = projectStateFor(state, 0);
    const ripple = view.players[0].hand[0]!;
    view.phase = "end";
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "arsenal",
      prompt: "You may put a card from your hand into your arsenal, or pass",
      options: [String(ripple.instanceId), "pass"],
      optionCards: [ripple, null],
    };

    expect(chooseHalaIntent({
      seat: 0,
      view,
      legal: [
        { kind: "choose", optionId: String(ripple.instanceId) },
        { kind: "choose", optionId: "pass" },
      ],
      cards: cardData,
    })).toEqual({ kind: "choose", optionId: "pass" });
  });

  it("arsenals Sharp Incline over Ripple Away when both survive the turn", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9339,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["HVY209", "MPW121"]);
    const view = projectStateFor(state, 0);
    const [ripple, sharp] = view.players[0].hand;
    view.phase = "end";
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "arsenal",
      prompt: "You may put a card from your hand into your arsenal, or pass",
      options: [String(ripple!.instanceId), String(sharp!.instanceId), "pass"],
      optionCards: [ripple!, sharp!, null],
    };

    expect(chooseHalaIntent({
      seat: 0,
      view,
      legal: [
        { kind: "choose", optionId: String(ripple!.instanceId) },
        { kind: "choose", optionId: String(sharp!.instanceId) },
        { kind: "choose", optionId: "pass" },
      ],
      cards: cardData,
    })).toEqual({ kind: "choose", optionId: String(sharp!.instanceId) });
  });

  it("sharpens before converting Olé into an additional sword attack", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9302,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["MPW103", "MPW046", "HNT117", "PEN048"]);

    const intent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(intent).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.hero.instanceId,
    });
  });

  it("pitches a blue so a Flurry turn can pay for both Zenith Blade attacks", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9303,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "MPW135",
      owner: 0,
    });
    replaceHand(state, 0, ["MPW046", "PEN048", "HNT117", "MPW025"]);

    const intent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(intent.kind).toBe("activate-ability");
    if (intent.kind !== "activate-ability") return;
    expect(intent.sourceInstanceId).toBe(state.players[0]!.weapons[0]!.instanceId);
    expect(intent.pitchInstanceIds).toHaveLength(1);
    const pitched = state.players[0]!.hand.find((card) => card.instanceId === intent.pitchInstanceIds[0]);
    expect(cardData[pitched!.cardId]!.pitch).toBe(3);
  });

  it("uses one blue instead of a yellow and red to pay Hala's ability", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9320,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["PEN049", "PEN321", "PEN054", "MPW105"]);
    const heroId = state.players[0]!.hero.instanceId;
    const legal = legalIntents(state, 0).filter((candidate) =>
      candidate.kind === "activate-ability" && candidate.sourceInstanceId === heroId
    );

    const decision = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal,
      cards: cardData,
      state,
    });
    const intent = decision.intent;

    expect(intent.kind).toBe("activate-ability");
    if (intent.kind !== "activate-ability") return;
    expect(intent.pitchInstanceIds).toHaveLength(1);
    const pitched = state.players[0]!.hand.find((card) => card.instanceId === intent.pitchInstanceIds[0]);
    expect(cardData[pitched!.cardId]!.pitch).toBe(3);
    expect(decision.plan).toBeDefined();
    expect(decision.plan!.candidateTrace.rootPrepared)
      .toBeLessThan(decision.plan!.candidateTrace.rootStrategic);
  });

  it("plays Brimming and Drawn, kills Chum with Zenith, then plays Command and Conquer", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 93201,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["PEN056", "PEN319", "MPW030", "AHA011"]);
    const chum = addOpponentAlly(state, "SEA050", 6);
    const brimming = state.players[0]!.hand.find((card) => card.cardId === "AHA011")!;
    const cut = state.players[0]!.hand.find((card) => card.cardId === "PEN056")!;
    const drawn = state.players[0]!.hand.find((card) => card.cardId === "MPW030")!;

    const decision = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });

    expect(decision.intent).toMatchObject({
      kind: "play-card",
      instanceId: brimming.instanceId,
      pitchInstanceIds: [cut.instanceId],
    });

    let current = apply(state, 0, decision.intent);
    const cleanActions: GameIntent[] = [decision.intent];
    for (let step = 0; step < 120 && current.turn === 2; step++) {
      const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
      const legal = legalIntents(current, actor);
      const cleanAction = actor === 0 && current.phase === "action" &&
        current.pendingDecision === null && current.stack.length === 0;
      const intent = actor === 0
        ? chooseHalaIntent({
            seat: 0,
            view: projectStateFor(current, 0),
            legal,
            cards: cardData,
            state: current,
          })
        : current.pendingDecision?.kind === "defend"
        ? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
        : legal.find((candidate) => candidate.kind === "choose" &&
            ["no", "decline", "pass", "pay 0"].includes(candidate.optionId)) ??
          legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "close-chain") ??
          legal.find((candidate) => candidate.kind === "order-triggers");
      if (!intent) throw new Error(`no replay rollout intent for ${current.phase}`);
      if (cleanAction) cleanActions.push(intent);
      if (cleanAction && intent.kind === "play-card" && intent.instanceId ===
        state.players[0]!.hand.find((card) => card.cardId === "PEN319")!.instanceId) break;
      current = apply(current, actor, intent);
    }

    const swordIndex = cleanActions.findIndex((intent) =>
      intent.kind === "activate-ability" &&
      intent.sourceInstanceId === state.players[0]!.weapons[0]!.instanceId
    );
    const drawnIndex = cleanActions.findIndex((intent) =>
      intent.kind === "play-card" && intent.instanceId === drawn.instanceId
    );
    const cncId = state.players[0]!.hand.find((card) => card.cardId === "PEN319")!.instanceId;
    const cncIndex = cleanActions.findIndex((intent) =>
      intent.kind === "play-card" && intent.instanceId === cncId
    );
    expect(drawnIndex).toBeGreaterThan(0);
    expect(swordIndex).toBeGreaterThan(drawnIndex);
    expect(cncIndex).toBeGreaterThan(swordIndex);
    expect(cleanActions[swordIndex]).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
    });
    expect(cleanActions[swordIndex]).toMatchObject({ targetAllyId: chum.instanceId });
    expect(cleanActions[cncIndex]).toMatchObject({
      kind: "play-card",
      instanceId: cncId,
    });
    expect("targetAllyId" in cleanActions[cncIndex]!
      ? cleanActions[cncIndex].targetAllyId
      : undefined)
      .toBeUndefined();
    expect(current.players[1]!.board.some((card) => card.instanceId === chum.instanceId)).toBe(false);
  });

  it("uses every red or yellow sharpener before its first Zenith attack without Flurry", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 93202,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["PEN056", "AHA011", "MPW119", "PEN048"]);
    const brimmingId = state.players[0]!.hand.find((card) => card.cardId === "AHA011")!.instanceId;
    const inclineId = state.players[0]!.hand.find((card) => card.cardId === "MPW119")!.instanceId;
    const bladeId = state.players[0]!.weapons[0]!.instanceId;
    const heroId = state.players[0]!.hero.instanceId;

    let current = state;
    const cleanActions: GameIntent[] = [];
    for (let step = 0; step < 120 && current.turn === 2; step++) {
      const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
      const legal = legalIntents(current, actor);
      const cleanAction = actor === 0 && current.phase === "action" &&
        current.pendingDecision === null && current.stack.length === 0;
      const intent = actor === 0
        ? chooseHalaIntent({
            seat: 0,
            view: projectStateFor(current, 0),
            legal,
            cards: cardData,
            state: current,
          })
        : current.pendingDecision?.kind === "defend"
        ? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
        : legal.find((candidate) => candidate.kind === "choose" &&
            ["no", "decline", "pass", "pay 0"].includes(candidate.optionId)) ??
          legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "close-chain") ??
          legal.find((candidate) => candidate.kind === "order-triggers");
      if (!intent) throw new Error(`no sharpener rollout intent for ${current.phase}`);
      if (cleanAction) cleanActions.push(intent);
      current = apply(current, actor, intent);
    }

    const brimmingIndex = cleanActions.findIndex((intent) =>
      intent.kind === "play-card" && intent.instanceId === brimmingId
    );
    const inclineIndex = cleanActions.findIndex((intent) =>
      intent.kind === "play-card" && intent.instanceId === inclineId
    );
    const swordIndex = cleanActions.findIndex((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === bladeId
    );
    expect(brimmingIndex).toBeGreaterThanOrEqual(0);
    expect(inclineIndex).toBeGreaterThanOrEqual(0);
    expect(swordIndex).toBeGreaterThan(brimmingIndex);
    expect(swordIndex).toBeGreaterThan(inclineIndex);
    expect(cleanActions.slice(swordIndex + 1).some((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === heroId
    )).toBe(false);
  });

  it("pitches an arsenal-worthy setup card to kill an ally with Zenith", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 93203,
      startPlayer: 0,
    });
    state.turn = 18;
    replaceHand(state, 0, ["MPW103"]);
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "AHA027",
      owner: 0,
    });
    const anka = addOpponentAlly(state, "SEA262", 3);
    const edict = state.players[0]!.hand[0]!;
    const blade = state.players[0]!.weapons[0]!;

    expect(chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    })).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: blade.instanceId,
      pitchInstanceIds: [edict.instanceId],
      targetAllyId: anka.instanceId,
    });
  });

  it("builds its replay hand before attacking into a board of ordinary allies", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 93_205,
      startPlayer: 0,
    });
    state.turn = 12;
    state.players[0]!.resources = 1;
    state.players[1]!.life = 29;
    replaceHand(state, 0, ["MPW105", "MPW126", "MPW028"]);
    state.players[0]!.arsenal = [];
    addOpponentAlly(state, "IAR090", 3);
    addOpponentAlly(state, "AMA014", 2);
    addOpponentAlly(state, "IAR084", 3);
    const edict = state.players[0]!.hand.find((card) => card.cardId === "MPW105")!;

    const decision = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });

    expect(decision.intent).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.hero.instanceId,
      pitchInstanceIds: [edict.instanceId],
    });
  });

  it("plays an arsenaled Edict then pitches Big Blinder to kill the replay ally", () => {
    const gravy = gravyDeck();
    let state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 93204,
      startPlayer: 0,
    });
    state.turn = 20;
    replaceHand(state, 0, ["MPW076"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "MPW103",
      owner: 0,
      faceDown: true,
    }];
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "AHA027",
      owner: 0,
    });
    const anka = addOpponentAlly(state, "SEA262", 3);
    const blinder = state.players[0]!.hand[0]!;
    const edict = state.players[0]!.arsenal[0]!;
    const blade = state.players[0]!.weapons[0]!;

    const setup = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(setup).toMatchObject({ kind: "play-from-arsenal", instanceId: edict.instanceId });
    state = advanceUntil(apply(state, 0, setup), (candidate) =>
      candidate.phase === "action" && candidate.priorityPlayer === 0 &&
      candidate.pendingDecision === null && candidate.stack.length === 0
    );

    expect(chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    })).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: blade.instanceId,
      pitchInstanceIds: [blinder.instanceId],
      targetAllyId: anka.instanceId,
    });
  });

  it("pitches yellow before red and preserves Shelter from the Storm", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9321,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["PEN321", "PEN054", "PEN049"]);
    const heroId = state.players[0]!.hero.instanceId;
    const legal = legalIntents(state, 0).filter((candidate) =>
      candidate.kind === "activate-ability" && candidate.sourceInstanceId === heroId
    );

    const intent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal,
      cards: cardData,
    });

    expect(intent.kind).toBe("activate-ability");
    if (intent.kind !== "activate-ability") return;
    const pitchedIds = intent.pitchInstanceIds.map((id) =>
      state.players[0]!.hand.find((card) => card.instanceId === id)?.cardId
    );
    expect(pitchedIds).toEqual(["PEN049", "PEN054"]);
    expect(pitchedIds).not.toContain("PEN321");
  });

  it("plays Shelter from the Storm as a defense reaction instead of discarding it", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9323,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["PEN321"]);
    const shelter = state.players[0]!.hand[0]!;
    const view = projectStateFor(state, 0);
    view.phase = "reaction";
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "defense-reaction",
      prompt: "Play a defense reaction or pass",
    };
    view.chain = [{
      attackingCard: { instanceId: 93_230, cardId: "AOL002", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    view.turnFacts!.players[0].weaponAttacks = 1;
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: shelter.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: shelter.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
    ];

    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "play-card", instanceId: shelter.instanceId, pitchInstanceIds: [] });
  });

  it("keeps Shelter in hand while an ordinary attack is on the stack", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9324,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["PEN321"]);
    const shelter = state.players[0]!.hand[0]!;
    const view = projectStateFor(state, 0);
    const grail = { instanceId: 93_240, cardId: "AOL002", owner: 1 };
    view.phase = "layer";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.chain = [{
      attackingCard: grail,
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      onStack: true,
      reactions: [],
    }];
    view.stack = [{ card: grail, seat: 1, label: "Golden Grail", optional: false }];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: shelter.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
    ];

    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData })).toEqual({ kind: "pass" });
  });

  it("holds Toe the Line until reactions and adds copies until the attack is covered", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9326,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBL022", "SBL022"]);
    const [firstToe, secondToe] = state.players[0]!.hand;
    const view = projectStateFor(state, 0);
    const grail = { instanceId: 93_260, cardId: "AOL002", owner: 1 };
    view.phase = "layer";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.chain = [{
      attackingCard: grail,
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      onStack: true,
      reactions: [],
    }];
    view.stack = [{ card: grail, seat: 1, label: "Golden Grail", optional: false }];
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: firstToe!.instanceId, pitchInstanceIds: [] },
      { kind: "play-card", instanceId: secondToe!.instanceId, pitchInstanceIds: [] },
      { kind: "pass" },
    ];

    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData })).toEqual({ kind: "pass" });

    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "defense-reaction", prompt: "Play a defense reaction or pass" };
    view.chain[0]!.onStack = false;
    view.stack = [];
    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "play-card", instanceId: firstToe!.instanceId, pitchInstanceIds: [] });

    view.stack = [{ card: firstToe!, seat: 0, label: "Toe the Line", optional: false }];
    expect(chooseHalaIntent({
      seat: 0,
      view,
      legal: [
        { kind: "play-card", instanceId: secondToe!.instanceId, pitchInstanceIds: [] },
        { kind: "pass" },
      ],
      cards: cardData,
    })).toEqual({ kind: "play-card", instanceId: secondToe!.instanceId, pitchInstanceIds: [] });

    view.stack = [
      { card: secondToe!, seat: 0, label: "Toe the Line", optional: false },
      { card: firstToe!, seat: 0, label: "Toe the Line", optional: false },
    ];
    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData })).toEqual({ kind: "pass" });

    view.stack = [];
    view.ongoing = [{
      seat: 0,
      cardId: "SBL022",
      label: "prevent next 4 damage, create Flurry when damage is prevented · this turn",
    }];
    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData })).toEqual({ kind: "pass" });

    view.ongoing = [];
    view.chain[0]!.defenseValue = 3;
    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData })).toEqual({ kind: "pass" });
  });

  it("does not throw away Toe the Line during its own action phase", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9332,
      startPlayer: 0,
    });
    state.turn = 3;
    replaceHand(state, 0, ["MPW074", "MPW103", "PEN048"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "PEN048",
      owner: 0,
      faceDown: true,
    }];
    const toe = state.players[0]!.hand[0]!;

    const decision = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(decision.intent).not.toMatchObject({
      kind: "play-card",
      instanceId: toe.instanceId,
    });
    expect(decision.plan?.line ?? []).not.toContainEqual(expect.objectContaining({
      instanceId: toe.instanceId,
    }));
  });

  it("plans attack blocks around Toe the Line's 2 prevention", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9327,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBL022", "MPW046"]);
    const blocker = state.players[0]!.hand[1]!;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defending cards" };
    view.chain = [{
      attackingCard: { instanceId: 93_270, cardId: "AOL002", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [blocker.instanceId] },
    ];

    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });
  });

  it.each([
    ["arcane", null, "Destroy Runechant: 1 arcane damage to the opposing hero"],
    ["physical", { instanceId: 93_281, cardId: "OUT139", owner: 1 }, "Flick Knives"],
  ] as const)("plays Toe the Line immediately for a non-attack %s damage effect", (_type, source, label) => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9328,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBL022"]);
    const toe = state.players[0]!.hand[0]!;
    const view = projectStateFor(state, 0);
    view.phase = "layer";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.chain = [];
    view.stack = [{
      card: source,
      seat: 1,
      label,
      optional: false,
    }];
    const play: GameIntent = { kind: "play-card", instanceId: toe.instanceId, pitchInstanceIds: [] };

    expect(chooseHalaIntent({ seat: 0, view, legal: [play, { kind: "pass" }], cards: cardData }))
      .toEqual(play);
  });

  it.each([
    ["Runechant", null, "Destroy Runechant: 1 arcane damage to the opposing hero"],
    ["Flick Knives", { instanceId: 93_251, cardId: "OUT139", owner: 1 }, "Flick Knives"],
  ] as const)("discards Shelter to prevent damage from %s", (_name, source, label) => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9325,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["PEN321"]);
    const shelter = state.players[0]!.hand[0]!;
    const view = projectStateFor(state, 0);
    view.phase = source ? "reaction" : "layer";
    view.priorityPlayer = 0;
    view.pendingDecision = source
      ? { player: 0, kind: "defense-reaction", prompt: "Play a defense reaction or pass" }
      : { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.stack = [{ card: source, seat: 1, label, optional: false }];
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: shelter.instanceId, pitchInstanceIds: [] },
      ...(source ? [{
        kind: "play-card" as const,
        instanceId: shelter.instanceId,
        pitchInstanceIds: [],
      }] : []),
      { kind: "pass" },
    ];

    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "activate-ability", sourceInstanceId: shelter.instanceId, pitchInstanceIds: [] });
  });

  it.each([false, true])(
    "sharpens with Hala before Drawn to the Blade when the hand funds %s Flurry",
    (flurry) => {
      const state = createGame({
        decklists: [halaDeck(), decklists.dorinthea],
        cards: cardData,
        scripts,
        seed: flurry ? 9311 : 9310,
        startPlayer: 0,
      });
      state.turn = 2;
      state.players[0]!.resources = 0;
      replaceHand(state, 0, ["HVY209", "MPW025"]);
      state.players[0]!.arsenal = [{
        instanceId: state.nextInstanceId++,
        cardId: "MPW030",
        owner: 0,
        faceDown: true,
      }];
      if (flurry) {
        state.players[0]!.board.push({
          instanceId: state.nextInstanceId++,
          cardId: "MPW135",
          owner: 0,
        });
      }

      const intent = chooseHalaIntent({
        seat: 0,
        view: projectStateFor(state, 0),
        legal: legalIntents(state, 0),
        cards: cardData,
      });
      expect(intent.kind).toBe("activate-ability");
      if (intent.kind !== "activate-ability") return;
      expect(intent.sourceInstanceId).toBe(state.players[0]!.hero.instanceId);
      expect(intent.pitchInstanceIds).toContain(
        state.players[0]!.hand.find((card) => card.cardId === "HVY209")!.instanceId,
      );
    },
  );

  it("converts Showdown into two sharpened attacks without spending Reverent", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9340,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 0;
    replaceHand(state, 0, ["HNT117", "MPW105", "MPW126"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "MPW030",
      owner: 0,
      faceDown: true,
    }];

    let current = state;
    const weaponId = current.players[0]!.weapons[0]!.instanceId;
    const botIntents: GameIntent[] = [];
    const rerebraceChoices: GameIntent[] = [];
    for (let step = 0; step < 160; step++) {
      const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
      const legal = legalIntents(current, actor);
      const intent = actor === 0
        ? chooseHalaIntent({
            seat: 0,
            view: projectStateFor(current, 0),
            legal,
            cards: cardData,
            state: current,
          })
        : current.pendingDecision?.kind === "defend"
        ? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
        : legal.find((candidate) => candidate.kind === "choose" &&
          ["no", "decline", "pass", "pay 0"].includes(candidate.optionId)) ??
          legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "close-chain") ??
          legal.find((candidate) => candidate.kind === "order-triggers");
      if (!intent) throw new Error(`no test rollout intent for ${current.phase}`);
      if (actor === 0) {
        botIntents.push(intent);
        if (
          current.pendingDecision?.prompt.toLowerCase().includes("reverent rerebrace") &&
          legal.some((candidate) => candidate.kind === "choose" && candidate.optionId === "no")
        ) {
          rerebraceChoices.push(intent);
        }
      }
      current = apply(current, actor, intent);
      if (botIntents.filter((candidate) =>
        candidate.kind === "activate-ability" && candidate.sourceInstanceId === weaponId
      ).length === 2) break;
    }

    expect(rerebraceChoices).not.toHaveLength(0);
    expect(rerebraceChoices.every((choice) =>
      choice.kind === "choose" && choice.optionId === "no"
    )).toBe(true);
    expect(botIntents.filter((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId
    )).toHaveLength(2);
    expect(current.players[0]!.equipment.arms?.cardId).toBe("AHA005");
    expect(current.log.some((entry) =>
      entry.publicText === "Hala, Bladesaint of the Vow creates Flurry"
    )).toBe(true);
    expect(current.log.some((entry) =>
      entry.publicText?.includes("Reverent Rerebrace sharpens") === true
    )).toBe(false);
  }, 10_000);

  it.each([
    { label: "two blues", resources: 0, hand: ["HVY209", "HNT117", "MPW103", "PEN048"] },
    { label: "one blue and floating resources", resources: 3, hand: ["HVY209", "MPW103", "PEN048"] },
  ] as const)("uses the reacted Edict power-turn swing before killing Restless Cleric with $label", ({
    resources,
    hand,
  }) => {
    const gravy = gravyDeck();
    let state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9341,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = resources;
    replaceHand(state, 0, hand);
    state.players[0]!.equipment.legs!.defCounters = 1;
    const cleric = addOpponentAlly(state, "IAR084");
    const edictId = state.players[0]!.hand.find((card) => card.cardId === "MPW103")!.instanceId;
    const shineId = state.players[0]!.hand.find((card) => card.cardId === "PEN048")!.instanceId;
    const weaponId = state.players[0]!.weapons[0]!.instanceId;
    const opponentLife = state.players[1]!.life;
    const botIntents: GameIntent[] = [];
    const weaponTargets: Array<number | undefined> = [];
    const shineTargets: Array<number | undefined> = [];

    for (let step = 0; step < 160 && state.turn === 2; step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const legal = legalIntents(state, actor);
      const intent = actor === 0
        ? chooseHalaIntent({
            seat: 0,
            view: projectStateFor(state, 0),
            legal,
            cards: cardData,
            state,
          })
        : state.pendingDecision?.kind === "defend"
        ? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
        : legal.find((candidate) => candidate.kind === "choose" &&
          ["no", "decline", "pass", "pay 0"].includes(candidate.optionId)) ??
          legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "close-chain") ??
          legal.find((candidate) => candidate.kind === "order-triggers");
      if (!intent) throw new Error(`no test rollout intent for ${state.phase}`);
      if (actor === 0) {
        botIntents.push(intent);
        if (intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId) {
          weaponTargets.push(intent.targetAllyId);
        }
        if (intent.kind === "play-card" && intent.instanceId === shineId) {
          shineTargets.push(projectStateFor(state, 0).chain.at(-1)?.targetAlly?.instanceId);
        }
      }
      state = apply(state, actor, intent);
    }

    expect(botIntents[0]).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.hero.instanceId,
    });
    expect(botIntents.some((intent) =>
      intent.kind === "play-card" && intent.instanceId === edictId
    )).toBe(true);
    expect(botIntents.some((intent) =>
      intent.kind === "play-card" && intent.instanceId === shineId
    )).toBe(true);
    expect(botIntents.filter((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId
    )).toHaveLength(2);
    expect(weaponTargets).toEqual([undefined, cleric.instanceId]);
    expect(shineTargets).toEqual([undefined]);
    expect(state.players[1]!.board.some((card) => card.instanceId === cleric.instanceId)).toBe(false);
    expect(opponentLife - state.players[1]!.life).toBe(10);
    expect(state.players[0]!.equipment.legs?.defCounters ?? 0).toBe(0);
  }, 10_000);

  it("plays the exact room 7BEBE4 hand through Hala, blue Edict, and Flurry", () => {
    const maliceDeck: Decklist = { ...decklists.dorinthea, heroId: "IAR053" };
    let state = createGame({
      decklists: [maliceDeck, halaDeck(maliceDeck)],
      cards: cardData,
      scripts,
      seed: 3_506_832_352,
      startPlayer: 1,
    });
    state.turn = 2;
    state.players[0]!.life = 41;
    replaceHand(state, 0, ["IAR166", "AMA011", "SFA034", "SEA208"]);
    state.players[1]!.resources = 0;
    replaceHand(state, 1, ["MPW046", "HVY209", "MPW105", "PEN048"]);
    const drawnIndex = state.players[1]!.deck.findIndex((card) => card.cardId === "MPW030");
    if (drawnIndex < 0) throw new Error("exact-room Hala deck did not contain Drawn to the Blade");
    [state.players[1]!.deck[0], state.players[1]!.deck[drawnIndex]] =
      [state.players[1]!.deck[drawnIndex]!, state.players[1]!.deck[0]!];
    const cleric = {
      instanceId: state.nextInstanceId++,
      cardId: "IAR084",
      owner: 0 as const,
      life: 2,
      counters: { lifePenalty: 1 },
    };
    state.players[0]!.board.push(cleric);
    const edictId = state.players[1]!.hand.find((card) => card.cardId === "MPW105")!.instanceId;
    const shineId = state.players[1]!.hand.find((card) => card.cardId === "PEN048")!.instanceId;
    const blueIds = new Set(state.players[1]!.hand.filter((card) =>
      card.cardId === "MPW046" || card.cardId === "HVY209"
    ).map((card) => card.instanceId));
    const weaponId = state.players[1]!.weapons[0]!.instanceId;
    const weaponTargets: Array<number | undefined> = [];
    const setupPitchIds: number[] = [];
    const shineTargets: Array<number | undefined> = [];
    const botIntents: GameIntent[] = [];

    for (let step = 0; step < 180 && state.turn === 2; step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const legal = legalIntents(state, actor);
      const intent = actor === 1
        ? chooseHalaIntent({
            seat: 1,
            view: projectStateFor(state, 1),
            legal,
            cards: cardData,
            state,
          })
        : state.pendingDecision?.kind === "defend"
        ? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
        : legal.find((candidate) => candidate.kind === "choose" &&
          ["no", "decline", "pass", "pay 0"].includes(candidate.optionId)) ??
          legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "close-chain") ??
          legal.find((candidate) => candidate.kind === "order-triggers");
      if (!intent) throw new Error(`no exact-room rollout intent for ${state.phase}`);
      if (actor === 1) {
        botIntents.push(intent);
        if (intent.kind === "activate-ability" && intent.sourceInstanceId === state.players[1]!.hero.instanceId) {
          setupPitchIds.push(...intent.pitchInstanceIds);
        }
        if (
          intent.kind === "choose" &&
          state.pendingDecision?.prompt.toLowerCase().includes("reverent rerebrace")
        ) {
          const payment = state.pendingDecision.resourcePayment?.options.find((option) =>
            option.optionId === intent.optionId
          );
          setupPitchIds.push(...(payment?.pitchInstanceIds ?? []));
        }
        if (intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId) {
          weaponTargets.push(intent.targetAllyId);
        }
        if (intent.kind === "play-card" && intent.instanceId === shineId) {
          shineTargets.push(projectStateFor(state, 1).chain.at(-1)?.targetAlly?.instanceId);
        }
      }
      state = apply(state, actor, intent);
    }

    expect(botIntents[0]).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[1]!.hero.instanceId,
    });
    expect(new Set(setupPitchIds)).toEqual(blueIds);
    expect(botIntents.some((intent) =>
      intent.kind === "play-card" && intent.instanceId === edictId
    )).toBe(true);
    expect(weaponTargets).toEqual([undefined, cleric.instanceId]);
    expect(shineTargets).toEqual([undefined]);
    expect(state.players[0]!.board.some((card) => card.instanceId === cleric.instanceId)).toBe(false);
    expect(state.players[1]!.equipment.arms).toBeUndefined();
  }, 10_000);

  it.each([
    [0, 0],
    [1, 1],
  ] as const)("plays Edict before an exact ally kill with %s floating resources", (
    resources,
    expectedShinePlays,
  ) => {
    const gravy = gravyDeck();
    let state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9403,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = resources;
    replaceHand(state, 0, ["HVY209", "MPW103", "PEN048"]);
    const cleric = addOpponentAlly(state, "IAR084");
    const edictId = state.players[0]!.hand.find((card) => card.cardId === "MPW103")!.instanceId;
    const shineId = state.players[0]!.hand.find((card) => card.cardId === "PEN048")!.instanceId;
    const weaponId = state.players[0]!.weapons[0]!.instanceId;
    const weaponTargets: Array<number | undefined> = [];
    const shineTargets: Array<number | undefined> = [];
    const botIntents: GameIntent[] = [];

    for (let step = 0; step < 160 && state.turn === 2; step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const legal = legalIntents(state, actor);
      const intent = actor === 0
        ? chooseHalaIntent({
            seat: 0,
            view: projectStateFor(state, 0),
            legal,
            cards: cardData,
            state,
          })
        : state.pendingDecision?.kind === "defend"
        ? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
        : legal.find((candidate) => candidate.kind === "choose" &&
          ["no", "decline", "pass", "pay 0"].includes(candidate.optionId)) ??
          legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "close-chain") ??
          legal.find((candidate) => candidate.kind === "order-triggers");
      if (!intent) throw new Error(`no test rollout intent for ${state.phase}`);
      if (actor === 0) {
        botIntents.push(intent);
        if (intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId) {
          weaponTargets.push(intent.targetAllyId);
        }
        if (intent.kind === "play-card" && intent.instanceId === shineId) {
          shineTargets.push(projectStateFor(state, 0).chain.at(-1)?.targetAlly?.instanceId);
        }
      }
      state = apply(state, actor, intent);
    }

    expect(botIntents[0]).toMatchObject({ kind: "play-card", instanceId: edictId });
    expect(weaponTargets).toEqual([undefined, cleric.instanceId]);
    expect(shineTargets).toHaveLength(expectedShinePlays);
    expect(shineTargets.every((target) => target === undefined)).toBe(true);
    expect(state.players[1]!.board.some((card) => card.instanceId === cleric.instanceId)).toBe(false);
  }, 10_000);

  it("plays free Edict before spending a blue on an existing-Flurry turn", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9329,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 1;
    replaceHand(state, 0, ["SBL022", "MPW103", "HVY209"]);
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "MPW135",
      owner: 0,
    });
    const edict = state.players[0]!.hand.find((card) => card.cardId === "MPW103")!;

    const decision = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(decision.intent).toMatchObject({
      kind: "play-card",
      instanceId: edict.instanceId,
      pitchInstanceIds: [],
    });
    expect(decision.plan).toBeUndefined();
  });

  it("sharpens before an And Again hand instead of opening with unsharpened Zenith", () => {
    const gravy = gravyDeck();
    const hala = halaDeck(gravy);
    const state = createGame({
      decklists: [hala, gravy],
      cards: cardData,
      scripts,
      seed: 9333,
      startPlayer: 0,
    });
    state.turn = 3;
    state.players[1]!.life = 37;
    replaceHand(state, 0, ["HNT117", "OMN238", "MPW046", "MPW028"]);
    const provoke = state.players[0]!.hand.find((card) => card.cardId === "HNT117")!;

    const choice = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(choice.intent).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.hero.instanceId,
      pitchInstanceIds: [provoke.instanceId],
    });
    expect(choice.plan).toBeUndefined();
  });

  it("plays Swordmaster's Path before Sharp Incline instead of pitching the Path", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9334,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.life = 36;
    state.players[1]!.life = 33;
    replaceHand(state, 0, ["MPW025", "MPW074", "MPW130", "MPW121"]);
    addOpponentAlly(state, "AMA014", 2);
    const path = state.players[0]!.hand.find((card) => card.cardId === "MPW130")!;

    const choice = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(choice.intent).toMatchObject({
      kind: "play-card",
      instanceId: path.instanceId,
    });
    expect("pitchInstanceIds" in choice.intent ? choice.intent.pitchInstanceIds : [])
      .not.toContain(path.instanceId);
    expect(choice.plan).toBeUndefined();
  });

  it("sharpens before a blue Edict so its threshold creates Flurry", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9332,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["MPW105", "HVY209", "PEN053"]);
    state.players[0]!.equipment.arms = {
      instanceId: state.nextInstanceId++,
      cardId: "AHA005",
      owner: 0,
    };
    const edict = state.players[0]!.hand.find((card) => card.cardId === "MPW105")!;
    const zenith = state.players[0]!.weapons[0]!;

    const decision = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(decision.intent).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.hero.instanceId,
    });
    expect(decision.plan).toBeDefined();
    expect(decision.plan?.line).toEqual([
      expect.objectContaining({
        kind: "activate-ability",
        sourceInstanceId: state.players[0]!.hero.instanceId,
      }),
      expect.objectContaining({
        kind: "play-card",
        instanceId: edict.instanceId,
      }),
      expect.objectContaining({
        kind: "activate-ability",
        sourceInstanceId: zenith.instanceId,
      }),
      expect.objectContaining({
        kind: "activate-ability",
        sourceInstanceId: zenith.instanceId,
      }),
      { kind: "close-chain" },
      { kind: "pass" },
    ]);
    expect(decision.plan?.evaluation.projectedSwordAttacks).toBe(2);
    expect(decision.plan?.evaluation.flurryAttackValue).toBeGreaterThanOrEqual(5);
    expect(decision.plan?.nodes).toBeLessThanOrEqual(72);
    expect(decision.plan?.transitions).toBeLessThanOrEqual(192);
    expect(decision.plan?.candidateTrace.rootPrepared).toBeLessThanOrEqual(5);
  });

  it("bounds planning when priority returns to Hala after the opponent closes the chain", () => {
    const levia = { ...decklists.rhinar, heroId: "MON120" };
    const state = createGame({
      decklists: [levia, halaDeck(levia)],
      cards: cardData,
      scripts,
      seed: 43_001,
      startPlayer: 1,
    });
    state.turn = 7;
    replaceHand(state, 1, ["HVY209", "PEN319", "OMN238", "MPW121"]);

    const legal = legalIntents(state, 1);
    const decision = chooseHalaIntentWithTrace({
      seat: 1,
      view: projectStateFor(state, 1),
      legal,
      cards: cardData,
      state,
    });

    expect(legal).toContainEqual(decision.intent);
    expect(decision.plan).toBeDefined();
    expect(decision.plan?.nodes).toBeLessThanOrEqual(48);
    expect(decision.plan?.transitions).toBeLessThanOrEqual(128);
  });

  it("pitches its last red payoff instead of overvaluing an empty arsenal", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9330,
      startPlayer: 0,
    });
    state.turn = 7;
    state.players[1]!.life = 30;
    replaceHand(state, 0, ["PEN048"]);
    state.players[0]!.arsenal = [];
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "MPW135",
      owner: 0,
    });
    const shine = state.players[0]!.hand[0]!;

    const early = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(early.intent).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
      pitchInstanceIds: [shine.instanceId],
    });
  });

  it.each([
    ["blue", "HVY209"],
    ["yellow", "MPW025"],
  ])("pitches its last %s card instead of forcing it into arsenal", (_color, cardId) => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9331,
      startPlayer: 0,
    });
    state.turn = 7;
    state.players[1]!.life = 30;
    replaceHand(state, 0, [cardId]);
    state.players[0]!.arsenal = [];
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "MPW135",
      owner: 0,
    });
    const pitchCard = state.players[0]!.hand[0]!;

    expect(chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    })).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
      pitchInstanceIds: [pitchCard.instanceId],
    });
  });

  it("does not spend the Flurry attack resource on Reverent Rerebrace", () => {
    let state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9312,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["HVY209", "MPW025"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "MPW030",
      owner: 0,
      faceDown: true,
    }];
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "MPW135",
      owner: 0,
    });
    const heroIntent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    state = apply(state, 0, heroIntent);
    state = advanceUntil(state, (candidate) =>
      candidate.pendingDecision?.prompt.toLowerCase().includes("reverent rerebrace") === true
    );
    expect(state.pendingDecision).toMatchObject({
      player: 0,
      kind: "optional-effect",
      options: expect.arrayContaining(["no"]),
    });

    const choice = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(choice).toMatchObject({ kind: "choose", optionId: "no" });
  });

  it("pays Reverent only when its counter crosses the resolving card's threshold", () => {
    expect(chooseRerebracePayment({ counters: 2, resolvingCardId: "MPW105" }))
      .toEqual({ kind: "choose", optionId: "paid" });
    expect(chooseRerebracePayment({ counters: 3, resolvingCardId: "MPW105" }))
      .toEqual({ kind: "choose", optionId: "no" });
    expect(chooseRerebracePayment({ counters: 2, resolvingCardId: "MPW104" }))
      .toEqual({ kind: "choose", optionId: "no" });
    expect(chooseRerebracePayment({ counters: 2, resolvingCardId: "OMN238" }))
      .toEqual({ kind: "choose", optionId: "paid" });
  });

  it("declines an already-satisfied yellow Edict from the opponent seat", () => {
    expect(chooseRerebracePayment({ counters: 2, resolvingCardId: "MPW104", seat: 1 }))
      .toEqual({ kind: "choose", optionId: "no" });
  });

  it("does not destroy Reverent for a merely held threshold card", () => {
    expect(chooseRerebracePayment({ counters: 1, heldCardId: "MPW105" }))
      .toEqual({ kind: "choose", optionId: "no" });
    expect(chooseRerebracePayment({ counters: 1, heldCardId: "MPW104" }))
      .toEqual({ kind: "choose", optionId: "no" });
  });

  it("destroys Reverent for raw damage only when that one damage is lethal", () => {
    expect(chooseRerebracePayment({ counters: 1, opponentLife: 5, attackValue: 4 }))
      .toEqual({ kind: "choose", optionId: "paid" });
    expect(chooseRerebracePayment({ counters: 1, opponentLife: 6, attackValue: 4 }))
      .toEqual({ kind: "choose", optionId: "no" });
  });

  it.each([
    [0, "stage-defenders"],
    [1, "defend"],
  ] as const)("uses Reverent's first block before a next-turn threshold line at %s counters", (
    defCounters,
    expectedKind,
  ) => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9391,
      startPlayer: 1,
    });
    state.turn = 3;
    replaceHand(state, 0, ["MPW104", "HNT117", "MPW130", "MPW132"]);
    const view = projectStateFor(state, 0);
    view.players[0].life = 20;
    const rerebrace = view.players[0].equipment.arms!;
    expect(cardData[rerebrace.cardId]?.name).toBe("Reverent Rerebrace");
    if (defCounters > 0) {
      rerebrace.defCounters = defCounters;
      rerebrace.defense = 1;
    }
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 99_391, cardId: "AOL002", owner: 1 },
      defendingCards: [],
      attackValue: 2,
      defenseValue: 0,
      damage: 2,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "stage-defenders", instanceIds: [rerebrace.instanceId] },
      { kind: "defend", instanceIds: [] },
    ];

    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }).kind).toBe(expectedKind);
  });

  it("uses only floating resources beyond the next Zenith attack on Grains of Bloodspill", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9313,
      startPlayer: 0,
    });
    state.turn = 2;
    const weaponId = state.players[0]!.weapons[0]!.instanceId;
    state.players[0]!.flags[`activated:${weaponId}`] = true;
    const view = projectStateFor(state, 0);
    const weapon = view.players[0].weapons[0]!;
    view.phase = "layer";
    view.priorityPlayer = 0;
    view.players[0].resources = 1;
    view.pendingDecision = {
      player: 0,
      kind: "optional-effect",
      prompt: "Grains of Bloodspill: Pay 1 to create Vigor?",
      options: ["decline", "pay 1"],
      resourcePayment: { cost: 1, options: [{ optionId: "pay 1", pitchInstanceIds: [] }] },
    };
    view.chain = [{
      attackingCard: weapon,
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 4,
      resolved: false,
      hit: true,
      goAgain: true,
      reactions: [],
    }];
    view.turnFacts!.players[0].weaponAttacks = 1;
    const legal: GameIntent[] = [
      { kind: "choose", optionId: "decline" },
      { kind: "choose", optionId: "pay 1" },
    ];

    expect(weapon.usedAbilityIndexes).toEqual([0]);
    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "pay 1" });

    weapon.usedAbilityIndexes = undefined;
    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "decline" });

    view.players[0].resources = 2;
    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "pay 1" });
  });

  it("uses Beckon Steel when a sharpened hit will cross its three-counter threshold", () => {
    let state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9304,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 1;
    state.players[0]!.weapons[0]!.counters = { power: 2, sharpenedTurn: 2 };
    replaceHand(state, 0, ["OMN238", "PEN048", "MPW046", "HNT117"]);
    const weaponId = state.players[0]!.weapons[0]!.instanceId;
    const attack = legalIntents(state, 0).find((candidate) =>
      candidate.kind === "activate-ability" && candidate.sourceInstanceId === weaponId &&
      candidate.pitchInstanceIds.length === 0
    );
    if (!attack) throw new Error("weapon attack was not legal");
    state = apply(state, 0, attack);
    state = advanceUntil(state, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    const intent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(intent.kind).toBe("play-card");
    if (intent.kind !== "play-card") return;
    expect(state.players[0]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId)
      .toBe("OMN238");
  });

  it("does not spend Swordmaster's Shine on an already-lethal ally attack", () => {
    let state = createGame({
      decklists: [halaDeck(gravyDeck()), gravyDeck()],
      cards: cardData,
      scripts,
      seed: 9402,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 2;
    replaceHand(state, 0, ["PEN048"]);
    const cleric = addOpponentAlly(state, "IAR084");
    const weapon = state.players[0]!.weapons[0]!;
    weapon.counters = { power: 2, sharpenedTurn: state.turn };
    const attack = legalIntents(state, 0).find((candidate) =>
      candidate.kind === "activate-ability" && candidate.sourceInstanceId === weapon.instanceId &&
      candidate.targetAllyId === cleric.instanceId && candidate.pitchInstanceIds.length === 0
    );
    if (!attack) throw new Error("ally-targeted Zenith attack was not legal");
    state = apply(state, 0, attack);
    state = advanceUntil(state, (candidate) =>
      candidate.pendingDecision?.kind === "attack-reaction" &&
      candidate.pendingDecision.player === 0
    );

    expect(chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    })).toEqual({ kind: "pass" });
  });

  it("preserves Ripple Away as the blue that converts Hala and Drawn to the Blade", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9314,
      startPlayer: 1,
    });
    state.turn = 2;
    replaceHand(state, 0, ["HVY209", "MPW025", "PEN049"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "MPW030",
      owner: 0,
      faceDown: true,
    }];
    const view = projectStateFor(state, 0);
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 9050, cardId: "AOL002", owner: 1 },
      defendingCards: [],
      attackValue: 5,
      defenseValue: 0,
      damage: 5,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      ...view.players[0].hand.map((card): GameIntent => ({
        kind: "stage-defenders",
        instanceIds: [card.instanceId],
      })),
      { kind: "defend", instanceIds: [] },
    ];

    const intent = chooseHalaIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent.kind).toBe("stage-defenders");
    if (intent.kind !== "stage-defenders") return;
    const rippleId = view.players[0].hand.find((card) => card.cardId === "HVY209")!.instanceId;
    expect(intent.instanceIds).not.toContain(rippleId);
  });

  it("keeps one Swordmaster's Path through a Sawbones block for yellow Edict's Flurry turn", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9334,
      startPlayer: 1,
    });
    state.turn = 3;
    replaceHand(state, 0, ["MPW104", "HNT117", "MPW130", "MPW130"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "MPW030",
      owner: 0,
      faceDown: true,
    }];
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "HVY242",
      owner: 0,
    });
    const view = projectStateFor(state, 0);
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 93_340, cardId: "AGB019", owner: 1 },
      defendingCards: [],
      attackValue: 6,
      defenseValue: 0,
      damage: 6,
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

    const intent = chooseHalaIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent.kind).toBe("stage-defenders");
    if (intent.kind !== "stage-defenders") return;
    const pathIds = new Set(view.players[0].hand
      .filter((card) => card.cardId === "MPW130")
      .map((card) => card.instanceId));
    expect(intent.instanceIds.filter((id) => pathIds.has(id))).toHaveLength(1);
    expect(intent.instanceIds).toHaveLength(1);
  });

  it("converts the retained Path, yellow Edict, and Vigor resource into two Zenith attacks", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9335,
      startPlayer: 0,
    });
    state.turn = 4;
    state.players[0]!.resources = 1;
    replaceHand(state, 0, ["MPW104", "HNT117", "MPW130"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "MPW030",
      owner: 0,
      faceDown: true,
    }];
    state.players[0]!.equipment.arms!.defCounters = 1;
    const path = state.players[0]!.hand.find((card) => card.cardId === "MPW130")!;
    const weaponId = state.players[0]!.weapons[0]!.instanceId;

    const decision = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(decision.intent).toMatchObject({ kind: "play-card", instanceId: path.instanceId });
    let current = state;
    const botIntents: GameIntent[] = [];
    let rerebraceCountersAtChoice: number | undefined;
    let rerebraceChoice: GameIntent | undefined;
    for (let step = 0; step < 160 && current.turn === 4; step++) {
      const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
      const legal = legalIntents(current, actor);
      let intent: GameIntent | undefined;
      if (actor === 0) {
        const view = projectStateFor(current, 0);
        intent = chooseHalaIntent({
          seat: 0,
          view,
          legal,
          cards: cardData,
          state: current,
        });
        if (
          current.pendingDecision?.prompt.toLowerCase().includes("reverent rerebrace") &&
          legal.some((candidate) => candidate.kind === "choose" && candidate.optionId === "no")
        ) {
          rerebraceCountersAtChoice = Number(
            view.players[0].weapons.find((card) => card.instanceId === weaponId)?.counters?.power ?? 0,
          );
          rerebraceChoice = intent;
        }
        botIntents.push(intent);
      } else if (current.pendingDecision?.kind === "defend") {
        intent = legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0);
      } else {
        intent = legal.find((candidate) => candidate.kind === "choose" &&
          ["no", "decline", "pass", "pay 0"].includes(candidate.optionId)) ??
          legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "close-chain") ??
          legal.find((candidate) => candidate.kind === "order-triggers");
      }
      if (!intent) throw new Error(`no test rollout intent for ${current.phase}`);
      current = apply(current, actor, intent);
    }

    expect(botIntents.filter((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId
    )).toHaveLength(2);
    const firstSwordIndex = botIntents.findIndex((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId
    );
    expect(botIntents.slice(firstSwordIndex + 1).some((intent) =>
      intent.kind === "activate-ability" &&
      intent.sourceInstanceId === state.players[0]!.hero.instanceId
    )).toBe(false);
    expect(rerebraceCountersAtChoice).toBe(3);
    expect(rerebraceChoice).toEqual({ kind: "choose", optionId: "no" });
    expect(current.log.some((entry) =>
      entry.publicText === "Hala, Bladesaint of the Vow creates Flurry"
    )).toBe(true);
    expect(current.players[0]!.equipment.arms?.cardId).toBe("AHA005");
    expect(current.log.some((entry) =>
      entry.publicText?.includes("Reverent Rerebrace sharpens") === true
    )).toBe(false);
  });

  it("converts Flurry, Vigor, and blue Sharp Incline into two Zenith attacks before Ripple Away", () => {
    const gravy = gravyDeck();
    let state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9336,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["HVY209", "MPW121"]);
    state.players[0]!.board.push(
      { instanceId: state.nextInstanceId++, cardId: "MPW135", owner: 0 },
      { instanceId: state.nextInstanceId++, cardId: "HVY242", owner: 0 },
    );

    state = advanceUntil(state, (candidate) =>
      candidate.activePlayer === 0 && candidate.phase === "action" &&
      candidate.priorityPlayer === 0 && candidate.pendingDecision === null &&
      candidate.stack.length === 0
    );
    expect(state.players[0]!.resources).toBe(1);
    expect(state.players[0]!.board.some((card) => card.cardId === "HVY242")).toBe(false);
    expect(state.log.some((entry) => entry.publicText === "Vigor is destroyed: gain {r}"))
      .toBe(true);

    const ripple = state.players[0]!.hand.find((card) => card.cardId === "HVY209")!;
    const weaponId = state.players[0]!.weapons[0]!.instanceId;
    const first = chooseHalaIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(first.intent).not.toMatchObject({ kind: "play-card", instanceId: ripple.instanceId });

    const opponentLife = state.players[1]!.life;
    const botIntents: GameIntent[] = [];
    for (let step = 0; step < 160 && state.activePlayer === 0; step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const legal = legalIntents(state, actor);
      const intent = actor === 0
        ? chooseHalaIntent({
            seat: 0,
            view: projectStateFor(state, 0),
            legal,
            cards: cardData,
            state,
          })
        : state.pendingDecision?.kind === "defend"
        ? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
        : legal.find((candidate) => candidate.kind === "choose" &&
          ["no", "decline", "pass", "pay 0"].includes(candidate.optionId)) ??
          legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "close-chain") ??
          legal.find((candidate) => candidate.kind === "order-triggers");
      if (!intent) throw new Error(`no test rollout intent for ${state.phase}`);
      if (actor === 0) botIntents.push(intent);
      state = apply(state, actor, intent);
    }

    expect(botIntents.filter((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId
    )).toHaveLength(2);
    expect(opponentLife - state.players[1]!.life).toBeGreaterThanOrEqual(8);
    expect(botIntents.some((intent) =>
      intent.kind === "play-card" && intent.instanceId === ripple.instanceId
    )).toBe(false);
  }, 10_000);

  it("blocks lethal with an ordinary blue block-three before an equivalent red attack", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9337,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["HVY209", "HVY210"]);
    const view = projectStateFor(state, 0);
    view.players[0].life = 3;
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 93_373, cardId: "AOL002", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
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

    const intent = chooseHalaIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent).toEqual({
      kind: "stage-defenders",
      instanceIds: [view.players[0].hand.find((card) => card.cardId === "HVY209")!.instanceId],
    });
  });

  it("declines Reverent in the live opponent-seat Path into yellow Edict state", () => {
    const gravy = gravyDeck();
    let state = createGame({
      decklists: [gravy, halaDeck(gravy)],
      cards: cardData,
      scripts,
      seed: 9335,
      startPlayer: 1,
    });
    state.turn = 3;
    state.players[1]!.resources = 0;
    replaceHand(state, 1, ["HNT117", "MPW130", "MPW030"]);
    state.players[1]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "MPW104",
      owner: 1,
      faceDown: true,
    }];
    state.players[1]!.equipment.arms!.defCounters = 1;

    for (let step = 0; step < 80; step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const legal = legalIntents(state, actor);
      if (
        actor === 1 &&
        state.pendingDecision?.prompt.toLowerCase().includes("reverent rerebrace") &&
        legal.some((candidate) => candidate.kind === "choose" && candidate.optionId === "no") &&
        Number(state.players[1]!.weapons[0]?.counters?.power ?? 0) === 3
      ) break;
      const intent = actor === 1
        ? chooseHalaIntent({
            seat: 1,
            view: projectStateFor(state, 1),
            legal,
            cards: cardData,
            state,
          })
        : legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "close-chain") ??
          legal.find((candidate) => candidate.kind === "order-triggers");
      if (!intent) throw new Error(`no test rollout intent for ${state.phase}`);
      state = apply(state, actor, intent);
    }

    expect(state.pendingDecision?.prompt).toContain("Reverent Rerebrace");
    const view = projectStateFor(state, 1);
    expect(view.players[1].weapons[0]?.counters?.power).toBe(3);
    expect(view.players[1].resources).toBe(2);
    expect(view.players[1].hand).toHaveLength(0);
    expect(view.players[1].arsenal).toHaveLength(0);
    const decision = chooseHalaIntentWithTrace({
      seat: 1,
      view,
      legal: legalIntents(state, 1),
      cards: cardData,
      state,
    });
    expect(decision).toEqual({ intent: { kind: "choose", optionId: "no" } });
  });

  it("uses durable armor instead of its whole hand to win a valuable wager", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9315,
      startPlayer: 1,
    });
    state.turn = 2;
    replaceHand(state, 0, ["PEN054", "HNT117", "MPW130", "MPW132"]);
    const view = projectStateFor(state, 0);
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 90_515, cardId: "MPW007", owner: 1 },
      defendingCards: [],
      attackValue: 11,
      defenseValue: 0,
      damage: 11,
      resolved: false,
      wagered: true,
      wagerRewards: ["Winner creates Courage"],
      reactions: [],
    }];
    const equipment = Object.values(view.players[0].equipment)
      .filter((card): card is CardView => card !== undefined);
    const defenders = [...view.players[0].hand, ...equipment]
      .filter((card) => (card.defense ?? 0) > 0);
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      ...defenders.map((card) => ({
        kind: "stage-defenders" as const,
        instanceIds: [card.instanceId],
      })),
    ];

    const intent = chooseHalaIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent.kind).toBe("stage-defenders");
    if (intent.kind !== "stage-defenders") return;
    const chosen = intent.instanceIds.map((id) => defenders.find((card) => card.instanceId === id)!);
    const chosenDefense = chosen.reduce((total, card) => total + (card.defense ?? 0), 0);
    const equipmentIds = new Set(equipment.map((card) => card.instanceId));
    const handIds = new Set(view.players[0].hand.map((card) => card.instanceId));

    expect(chosenDefense).toBeGreaterThanOrEqual(11);
    expect(chosen.some((card) => equipmentIds.has(card.instanceId))).toBe(true);
    expect(chosen.filter((card) => handIds.has(card.instanceId)).length)
      .toBeLessThan(view.players[0].hand.length);
    expect(chosen.every((card) => chosenDefense - (card.defense ?? 0) < 11)).toBe(true);

    view.chain[0]!.wagerRewards = ["Winner discards a card"];
    const punitiveIntent = chooseHalaIntent({ seat: 0, view, legal, cards: cardData });
    const punitiveIds = punitiveIntent.kind === "stage-defenders" ? punitiveIntent.instanceIds : [];
    const punitiveDefense = punitiveIds.reduce(
      (total, id) => total + (defenders.find((card) => card.instanceId === id)?.defense ?? 0),
      0,
    );
    expect(punitiveDefense).toBeLessThan(11);
  });

  it("does not defend with Valiant Dynamo while it already has a defense counter", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9316,
      startPlayer: 1,
    });
    state.turn = 2;
    const dynamo = state.players[0]!.equipment.legs!;
    expect(cardData[dynamo.cardId]?.name).toBe("Valiant Dynamo");
    dynamo.defCounters = 1;
    const view = projectStateFor(state, 0);
    const projectedDynamo = view.players[0].equipment.legs!;
    expect(projectedDynamo).toMatchObject({ defense: 0, defCounters: 1 });
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 90_516, cardId: "AOL002", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "stage-defenders", instanceIds: [projectedDynamo.instanceId] },
      { kind: "defend", instanceIds: [] },
    ];

    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });
  });

  it("keeps Valiant Dynamo on the opening turn when cards from hand cover the attack", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 93161,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["MPW028", "HNT117", "MPW130", "MPW132"]);
    const view = projectStateFor(state, 0);
    const dynamo = view.players[0].equipment.legs!;
    expect(cardData[dynamo.cardId]?.name).toBe("Valiant Dynamo");
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 90_5161, cardId: "AOL002", owner: 1 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 4,
      resolved: false,
      reactions: [],
    }];
    const equipment = Object.values(view.players[0].equipment)
      .filter((card): card is CardView => card !== undefined);
    const defenders = [...view.players[0].hand, ...equipment]
      .filter((card) => (card.defense ?? 0) > 0);
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      ...defenders.map((card) => ({
        kind: "stage-defenders" as const,
        instanceIds: [card.instanceId],
      })),
    ];

    const intent = chooseHalaIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent.kind).toBe("stage-defenders");
    if (intent.kind !== "stage-defenders") return;
    expect(intent.instanceIds).not.toContain(dynamo.instanceId);
    expect(intent.instanceIds.every((id) =>
      view.players[0].hand.some((card) => card.instanceId === id)
    )).toBe(true);
    expect(intent.instanceIds.reduce(
      (total, id) => total + (defenders.find((card) => card.instanceId === id)?.defense ?? 0),
      0,
    )).toBeGreaterThanOrEqual(4);
  });

  it.each([
    ["spends", ["MPW028", "HNT117", "MPW130", "MPW132"], "stage-defenders"],
    ["preserves", ["HNT117", "MPW130", "MPW132", "MPW133"], "defend"],
  ] as const)("%s fresh Valiant Dynamo only with a visible refresh line", (
    _label,
    hand,
    expectedKind,
  ) => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9317,
      startPlayer: 1,
    });
    state.turn = 2;
    replaceHand(state, 0, hand);
    const view = projectStateFor(state, 0);
    const dynamo = view.players[0].equipment.legs!;
    expect(cardData[dynamo.cardId]?.name).toBe("Valiant Dynamo");
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 90_517, cardId: "AOL002", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "stage-defenders", instanceIds: [dynamo.instanceId] },
      { kind: "defend", instanceIds: [] },
    ];

    const intent = chooseHalaIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent.kind).toBe(expectedKind);
    if (expectedKind === "stage-defenders") {
      expect(intent).toEqual({ kind: "stage-defenders", instanceIds: [dynamo.instanceId] });
    }
  });

  it("never uses Ripple Away on a wager", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9305,
      startPlayer: 1,
    });
    state.turn = 2;
    replaceHand(state, 0, ["HVY209", "MPW046"]);
    const view = projectStateFor(state, 0);
    view.phase = "layer";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.chain = [{
      attackingCard: { instanceId: 9001, cardId: "AOL002", owner: 1 },
      defendingCards: [],
      attackValue: 7,
      defenseValue: 3,
      damage: 4,
      resolved: false,
      hit: true,
      wagered: true,
      wagerRewards: ["Winner creates Courage"],
      reactions: [],
    }];
    view.stack = [{
      card: { instanceId: 9002, cardId: "AOL010", owner: 1 },
      seat: 1,
      label: "Belly Buster",
      optional: false,
    }];
    const rippleId = view.players[0].hand[0]!.instanceId;
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: rippleId, pitchInstanceIds: [] },
      { kind: "pass" },
    ];

    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData })).toEqual({ kind: "pass" });
    view.stack[0]!.label = "Resolve wager: Winner creates Courage";
    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData })).toEqual({ kind: "pass" });
  });

  it("uses one Ripple Away on deterministic token creation when the remaining hand can pitch", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9306,
      startPlayer: 1,
    });
    state.turn = 2;
    replaceHand(state, 0, ["HVY209", "MPW046"]);
    const view = projectStateFor(state, 0);
    view.phase = "layer";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.stack = [{
      card: { instanceId: 9012, cardId: "HVY192", owner: 1 },
      seat: 1,
      label: "Lead with Heart",
      optional: false,
    }];
    const rippleId = view.players[0].hand[0]!.instanceId;
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: rippleId, pitchInstanceIds: [] },
      { kind: "pass" },
    ];

    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }))
      .toMatchObject({ kind: "activate-ability", sourceInstanceId: rippleId });

    view.stack.unshift({
      card: { instanceId: rippleId, cardId: "HVY209", owner: 0 },
      seat: 0,
      label: "Reduce action-card token creation",
      optional: false,
    });
    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData })).toEqual({ kind: "pass" });
  });

  it("keeps Ripple without a future Zenith resource, but spends it with Vigor", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9307,
      startPlayer: 1,
    });
    state.turn = 2;
    replaceHand(state, 0, ["HVY209"]);
    const view = projectStateFor(state, 0);
    view.phase = "layer";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.stack = [{
      card: { instanceId: 9022, cardId: "HVY192", owner: 1 },
      seat: 1,
      label: "Lead with Heart",
      optional: false,
    }];
    const rippleId = view.players[0].hand[0]!.instanceId;
    const legal: GameIntent[] = [
      { kind: "activate-ability", sourceInstanceId: rippleId, pitchInstanceIds: [] },
      { kind: "pass" },
    ];

    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData })).toEqual({ kind: "pass" });
    view.players[0].board.push({ instanceId: 9023, cardId: "HVY242", owner: 0 });
    expect(chooseHalaIntent({ seat: 0, view, legal, cards: cardData }))
      .toMatchObject({ kind: "activate-ability", sourceInstanceId: rippleId });
  });

  it("keeps Drawn to the Blade in arsenal unless it can fund a Zenith Blade attack", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9308,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 0;
    replaceHand(state, 0, []);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "MPW030",
      owner: 0,
      faceDown: true,
    }];

    const stranded = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(stranded).toEqual({ kind: "pass" });

    replaceHand(state, 0, ["HVY209"]);
    const converting = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(converting).toMatchObject({
      kind: "play-from-arsenal",
      instanceId: state.players[0]!.arsenal[0]!.instanceId,
    });
  });

  it.each([
    ["SEA050", 3, "ally"],
    ["SEA050", 6, "ally"],
    ["SEA264", 0, "ally"],
    ["SEA264", 1, "ally"],
    ["SEA051", 0, "ally"],
    ["SEA052", 6, "hero"],
  ] as const)("routes Zenith around %s at %s counters toward the %s", (
    allyCardId,
    counters,
    expectedTarget,
  ) => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9392,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 1;
    replaceHand(state, 0, []);
    const ally = addOpponentAlly(state, allyCardId);
    if (counters > 0) {
      state.players[0]!.weapons[0]!.counters = { power: counters, sharpenedTurn: state.turn };
    }

    const intent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(intent.kind).toBe("activate-ability");
    if (intent.kind !== "activate-ability") return;
    expect(intent.targetAllyId).toBe(expectedTarget === "ally" ? ally.instanceId : undefined);
  });

  it("sends a one-shot larger Zenith swing at the hero and saves the smaller lethal swing", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9397,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 2;
    replaceHand(state, 0, []);
    const ally = addOpponentAlly(state, "SEA052", 6);
    state.players[0]!.weapons[0]!.counters = { power: 3, sharpenedTurn: state.turn };
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "AHA027",
      owner: 0,
    });
    const view = projectStateFor(state, 0);
    view.ongoing.push({
      seat: 0,
      cardId: "MPW130",
      label: "+3 attack · next attack",
    });

    const first = chooseHalaIntent({
      seat: 0,
      view,
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(first).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
    });
    expect("targetAllyId" in first ? first.targetAllyId : undefined).toBeUndefined();

    view.ongoing = [];
    const smaller = chooseHalaIntent({
      seat: 0,
      view,
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(smaller).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
      targetAllyId: ally.instanceId,
    });
  });

  it("kills Chum before Sawbones when both are legal targets", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9393,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 1;
    replaceHand(state, 0, []);
    const chum = addOpponentAlly(state, "SEA050");
    addOpponentAlly(state, "SEA264");
    state.players[0]!.weapons[0]!.counters = { power: 3, sharpenedTurn: state.turn };

    const intent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(intent).toMatchObject({ kind: "activate-ability", targetAllyId: chum.instanceId });
  });

  it("kills Sawbones before an ordinary ally at the same lethal threshold", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9400,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 1;
    replaceHand(state, 0, []);
    addOpponentAlly(state, "SEA051");
    const sawbones = addOpponentAlly(state, "SEA264");
    state.players[0]!.weapons[0]!.counters = { sharpenedTurn: state.turn };

    const intent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(intent).toMatchObject({
      kind: "activate-ability",
      targetAllyId: sawbones.instanceId,
    });
  });

  it("sends a buffed Zenith swing at the hero before using its smaller swing on Sawbones", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9401,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 2;
    replaceHand(state, 0, []);
    const sawbones = addOpponentAlly(state, "SEA264");
    state.players[0]!.weapons[0]!.counters = { sharpenedTurn: state.turn };
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "AHA027",
      owner: 0,
    });
    const view = projectStateFor(state, 0);
    view.ongoing.push({
      seat: 0,
      cardId: "MPW130",
      label: "+3 attack · next attack",
    });

    const larger = chooseHalaIntent({
      seat: 0,
      view,
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect("targetAllyId" in larger ? larger.targetAllyId : undefined).toBeUndefined();

    view.ongoing = [];
    const smaller = chooseHalaIntent({
      seat: 0,
      view,
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(smaller).toMatchObject({
      kind: "activate-ability",
      targetAllyId: sawbones.instanceId,
    });
  });

  it("preserves the Spectra clear when an ordinary ally cannot be killed efficiently", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9396,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 1;
    replaceHand(state, 0, []);
    addOpponentAlly(state, "SEA052");
    const haze = {
      instanceId: state.nextInstanceId++,
      cardId: "APR024",
      owner: 1 as const,
    };
    state.players[1]!.board.push(haze);

    const intent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(intent).toMatchObject({ kind: "activate-ability", targetAllyId: haze.instanceId });
  });

  it("attacks the hero when Chum cannot be killed this turn", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9398,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 1;
    replaceHand(state, 0, []);
    addOpponentAlly(state, "SEA050");
    state.players[0]!.weapons[0]!.counters = { sharpenedTurn: state.turn };

    const intent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(intent).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
    });
    expect("targetAllyId" in intent ? intent.targetAllyId : undefined).toBeUndefined();
  });

  it("prefers an exact ordinary-ally kill over one point of overkill", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9399,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 1;
    replaceHand(state, 0, []);
    addOpponentAlly(state, "SEA051");
    const exact = addOpponentAlly(state, "SEA052", 4);
    state.players[0]!.weapons[0]!.counters = { power: 1, sharpenedTurn: state.turn };

    const intent = chooseHalaIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(intent).toMatchObject({
      kind: "activate-ability",
      targetAllyId: exact.instanceId,
    });
  });

  it("reserves both three-power Flurry swings to kill Chum", () => {
    const gravy = gravyDeck();
    let state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9394,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.resources = 2;
    replaceHand(state, 0, []);
    const chum = addOpponentAlly(state, "SEA050");
    state.players[0]!.weapons[0]!.counters = { sharpenedTurn: state.turn };
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "AHA027",
      owner: 0,
    });
    const weaponId = state.players[0]!.weapons[0]!.instanceId;
    const attacks: GameIntent[] = [];

    for (let step = 0; step < 120 && state.players[1]!.board.some((card) =>
      card.instanceId === chum.instanceId
    ); step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const legal = legalIntents(state, actor);
      const intent = actor === 0
        ? chooseHalaIntent({
            seat: 0,
            view: projectStateFor(state, 0),
            legal,
            cards: cardData,
            state,
          })
        : state.pendingDecision?.kind === "defend"
        ? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
        : legal.find((candidate) => candidate.kind === "choose" &&
            ["no", "decline", "pass"].includes(candidate.optionId)) ??
          legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "close-chain") ??
          legal.find((candidate) => candidate.kind === "order-triggers");
      if (!intent) throw new Error(`no Chum rollout intent for ${state.phase}`);
      if (actor === 0 && intent.kind === "activate-ability" && intent.sourceInstanceId === weaponId) {
        attacks.push(intent);
      }
      state = apply(state, actor, intent);
    }

    expect(attacks).toHaveLength(2);
    expect(attacks.every((intent) =>
      intent.kind === "activate-ability" && intent.targetAllyId === chum.instanceId
    )).toBe(true);
    expect(state.players[1]!.board.some((card) => card.instanceId === chum.instanceId)).toBe(false);
  });

  it("blocks lethal without breaking the retained six-damage Chum line", () => {
    const gravy = gravyDeck();
    const state = createGame({
      decklists: [halaDeck(gravy), gravy],
      cards: cardData,
      scripts,
      seed: 9395,
      startPlayer: 1,
    });
    state.turn = 2;
    replaceHand(state, 0, ["MPW130", "MPW104", "HNT117"]);
    addOpponentAlly(state, "SEA050");
    const view = projectStateFor(state, 0);
    view.players[0].life = 3;
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 93_950, cardId: "AGB019", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
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

    const intent = chooseHalaIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent.kind).toBe("stage-defenders");
    if (intent.kind !== "stage-defenders") return;
    const pathId = view.players[0].hand.find((card) => card.cardId === "MPW130")!.instanceId;
    expect(intent.instanceIds).not.toContain(pathId);
  });

  it("makes the same choice from equivalent projected information", () => {
    const state = createGame({
      decklists: [halaDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9309,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["MPW103", "MPW046", "HNT117", "PEN048"]);
    const legal = legalIntents(state, 0);
    const a = projectStateFor(state, 0);
    const b = structuredClone(a);
    b.players[1].hand = [{ instanceId: 999_001, cardId: "PEN319", owner: 1 }];

    expect(chooseHalaIntent({ seat: 0, view: a, legal, cards: cardData }))
      .toEqual(chooseHalaIntent({ seat: 0, view: b, legal, cards: cardData }));
  });
});
