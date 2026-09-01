import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor, rngNext } from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseBriarIntent, chooseBriarIntentWithTrace } from "./briar-policy.js";
import { briarPresentationFor } from "./sideboard.js";

function briarDeck(opponent: Decklist): Decklist {
  const pool = precon("bot-briar-broccoli")!.pool;
  return { heroId: pool.heroId, ...briarPresentationFor(opponent) };
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

function resolveToAction(state: ReturnType<typeof createGame>): ReturnType<typeof createGame> {
  let current = state;
  for (let step = 0; step < 20; step++) {
    if (
      current.phase === "action" &&
      current.activePlayer === 0 &&
      current.priorityPlayer === 0 &&
      current.pendingDecision === null &&
      current.stack.length === 0
    ) return current;
    const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
    const pass = legalIntents(current, actor).find((intent) => intent.kind === "pass");
    if (!pass) throw new Error(`no pass while resolving ${current.phase}`);
    const result = applyIntent(current, actor, pass);
    if (!result.ok) throw new Error(result.error);
    current = result.state;
  }
  throw new Error("setup action did not resolve");
}

describe("Briar policy", () => {
  it("passes on the opening turn, then arsenals for a five-card setup turn", () => {
    let state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 701,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["SBA012", "SBA015", "SBA029", "SBA023"]);

    const opening = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(opening).toEqual({ intent: { kind: "pass" } });

    const ended = applyIntent(state, 0, opening.intent);
    expect(ended.ok, ended.ok ? "" : ended.error).toBe(true);
    if (!ended.ok) return;
    state = ended.state;
    const arsenalChoice = chooseBriarIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(arsenalChoice.kind).toBe("choose");

    const arsenaled = applyIntent(state, 0, arsenalChoice);
    expect(arsenaled.ok, arsenaled.ok ? "" : arsenaled.error).toBe(true);
    if (!arsenaled.ok) return;
    expect(arsenaled.state.players[0]!.arsenal).toHaveLength(1);
    expect(arsenaled.state.players[0]!.arsenal[0]?.cardId).toBe("SBA015");
    expect(arsenaled.state.players[0]!.hand).toHaveLength(4);
    expect(arsenaled.state.turn).toBe(2);
  });

  it("sends a 0-for-4 instead of passing with two non-go-again attacks", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7011,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA011", "SBA022"]);

    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });

    expect(decision.intent.kind).toBe("play-card");
    expect(decision.plan?.evaluation.damage).toBeGreaterThanOrEqual(4);
    expect(decision.plan?.evaluation.intelligencePenalty).toBe(0);
  });

  it("plans a go-again attack into the remaining 0-for-4", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7012,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA013", "SBA021"]);
    const [fry, snatch] = state.players[0]!.hand;

    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    const played = decision.plan?.line.flatMap((intent) =>
      intent.kind === "play-card" || intent.kind === "play-from-arsenal"
        ? [intent.instanceId]
        : []
    ) ?? [];

    expect(decision.intent).toMatchObject({ kind: "play-card", instanceId: fry!.instanceId });
    expect(played).toContain(fry!.instanceId);
    expect(played).toContain(snatch!.instanceId);
    expect(decision.plan?.evaluation.damage).toBeGreaterThanOrEqual(7);
    expect(decision.plan?.evaluation.intelligencePenalty).toBe(0);
  });

  it("uses Star Fall to consume a Lightning setup before the generic attack", () => {
    let state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7013,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA027", "SBA021"]);
    const [sizzle] = state.players[0]!.hand;
    const playSizzle = legalIntents(state, 0).find((intent) =>
      intent.kind === "play-card" && intent.instanceId === sizzle!.instanceId
    )!;
    const played = applyIntent(state, 0, playSizzle);
    expect(played.ok, played.ok ? "" : played.error).toBe(true);
    if (!played.ok) return;
    state = resolveToAction(played.state);

    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(decision.intent).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.equipment.chest!.instanceId,
    });
    expect(decision.plan?.line).toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
    }));
  });

  it("plans an arsenal Lightning Surge into a hand attack", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7014,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA021"]);
    const snatch = state.players[0]!.hand[0]!;
    const surge = {
      instanceId: state.nextInstanceId++,
      cardId: "SBA015",
      owner: 0 as const,
      faceDown: true,
    };
    state.players[0]!.arsenal = [surge];

    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    const played = decision.plan?.line.flatMap((intent) =>
      intent.kind === "play-card" || intent.kind === "play-from-arsenal"
        ? [intent.instanceId]
        : []
    ) ?? [];

    expect(decision.intent).toMatchObject({ kind: "play-from-arsenal", instanceId: surge.instanceId });
    expect(played).toContain(surge.instanceId);
    expect(played).toContain(snatch.instanceId);
  });

  it("does not play Weave Lightning without a Lightning or Elemental attack follow-up", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 702,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA029", "SEA201"]);

    const intent = chooseBriarIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(intent.kind).toBe("play-card");
    if (intent.kind !== "play-card") return;
    expect(state.players[0]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId)
      .toBe("SEA201");
  });

  it("plays Weave Lightning when an eligible attack can consume its effect", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 703,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA029", "SBA012"]);

    const intent = chooseBriarIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(intent.kind).toBe("play-card");
    if (intent.kind !== "play-card") return;
    expect(state.players[0]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId)
      .toBe("SBA029");
  });

  it("keeps Quick Succession when only one Lightning attack can use it", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 70301,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.weapons = [];
    replaceHand(state, 0, ["OMN083", "SBA012"]);

    const intent = chooseBriarIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(intent.kind).toBe("play-card");
    if (intent.kind !== "play-card") return;
    expect(state.players[0]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId)
      .toBe("SBA012");
  });

  it("arsenals Evergreen for the fatigue plan's recurring attack", () => {
    let state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 70302,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["ELE119", "SBA015", "SBA017", "SBA020"]);
    const ended = applyIntent(state, 0, { kind: "pass" });
    expect(ended.ok, ended.ok ? "" : ended.error).toBe(true);
    if (!ended.ok) return;
    state = ended.state;
    while (state.pendingDecision?.kind !== "arsenal") {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const pass = legalIntents(state, actor).find((intent) => intent.kind === "pass");
      if (!pass) throw new Error("could not advance to the arsenal decision");
      const advanced = applyIntent(state, actor, pass);
      if (!advanced.ok) throw new Error(advanced.error);
      state = advanced.state;
    }

    const choice = chooseBriarIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(choice.kind).toBe("choose");
    const arsenaled = applyIntent(state, 0, choice);
    expect(arsenaled.ok, arsenaled.ok ? "" : arsenaled.error).toBe(true);
    if (!arsenaled.ok) return;
    expect(arsenaled.state.players[0]!.arsenal[0]?.cardId).toBe("ELE119");
  });

  it("sets a first-cycle Burn Up pitch stack in the fatigue plan", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 703021,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA025", "OMN085"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "ELE119",
      owner: 0,
      faceDown: true,
    }];
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "SIY035",
      owner: 0,
    });
    delete state.players[0]!.equipment.chest;
    const burn = state.players[0]!.hand[0]!;
    const blue = state.players[0]!.hand[1]!;

    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    const evergreen = decision.plan?.line.find((intent) =>
      intent.kind === "play-from-arsenal"
    );
    expect(evergreen).toMatchObject({
      kind: "play-from-arsenal",
      pitchInstanceIds: [burn.instanceId, blue.instanceId],
    });
    expect(decision.plan?.evaluation.firstCycleBurnsPitched).toBe(1);
  });

  it("uses a returned Burn Up meld instead of pitching it again", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 703022,
      startPlayer: 0,
    });
    state.turn = 8;
    replaceHand(state, 0, ["SBA025", "SBA012"]);
    const burn = state.players[0]!.hand[0]!;
    burn.pitchCount = 1;

    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(decision.intent).toMatchObject({
      kind: "play-card",
      instanceId: burn.instanceId,
      meldSide: "both",
    });
    expect(decision.plan?.line).not.toContainEqual(expect.objectContaining({
      pitchInstanceIds: expect.arrayContaining([burn.instanceId]),
    }));
    expect(decision.plan?.nodes).toBeLessThanOrEqual(42);
    expect(decision.plan?.transitions).toBeLessThanOrEqual(124);
    expect(decision.plan?.candidateTrace.rootPrepared).toBeLessThanOrEqual(2);
  });

  it("swings Star Fall during each reachable fatigue turn", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 703023,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA013", "OMN085"]);

    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(decision.plan?.line).toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
    }));
    expect(decision.plan?.evaluation.starFallAttacks).toBe(1);
  });

  it("keeps Evergreen for arsenal instead of playing it from hand", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 703024,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["ELE119", "OMN085"]);
    const evergreen = state.players[0]!.hand[0]!;

    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(decision.plan?.line).not.toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: evergreen.instanceId,
    }));
    expect(decision.plan?.evaluation.evergreenPreservedForArsenal).toBe(true);
  });

  it("plays Evergreen from arsenal and permits hand play for lethal", () => {
    const arsenalState = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 703025,
      startPlayer: 0,
    });
    arsenalState.turn = 2;
    replaceHand(arsenalState, 0, ["OMN085"]);
    const arsenaledEvergreen = {
      instanceId: arsenalState.nextInstanceId++,
      cardId: "ELE119",
      owner: 0 as const,
      faceDown: true,
    };
    arsenalState.players[0]!.arsenal = [arsenaledEvergreen];
    const arsenalDecision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(arsenalState, 0),
      legal: legalIntents(arsenalState, 0),
      cards: cardData,
      state: arsenalState,
    });
    expect(arsenalDecision.plan?.line).toContainEqual(expect.objectContaining({
      kind: "play-from-arsenal",
      instanceId: arsenaledEvergreen.instanceId,
    }));
    expect(arsenalDecision.plan?.evaluation.evergreenPlayedFromArsenal).toBe(1);

    const lethalState = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 703026,
      startPlayer: 0,
    });
    lethalState.turn = 2;
    lethalState.players[1]!.life = 7;
    replaceHand(lethalState, 0, ["ELE119", "OMN085"]);
    const handEvergreen = lethalState.players[0]!.hand[0]!;
    const lethalDecision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(lethalState, 0),
      legal: legalIntents(lethalState, 0),
      cards: cardData,
      state: lethalState,
    });
    expect(lethalDecision.plan?.line).toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: handEvergreen.instanceId,
    }));
  });

  it("preserves attack-pump equipment when Star Fall remains available", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7031,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.flags["playedName:nimblism"] = true;
    replaceHand(state, 0, ["SBA023"]);
    state.players[0]!.equipment.arms = {
      instanceId: state.nextInstanceId++,
      cardId: "SBA008",
      owner: 0,
    };
    state.players[0]!.equipment.legs = {
      instanceId: state.nextInstanceId++,
      cardId: "SBA010",
      owner: 0,
    };
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "SIY035",
      owner: 0,
    });

    const legal = legalIntents(state, 0);
    const activationSources = legal.flatMap((intent) =>
      intent.kind === "activate-ability" ? [intent.sourceInstanceId] : []
    );
    expect(activationSources).toContain(state.players[0]!.equipment.arms.instanceId);
    expect(activationSources).toContain(state.players[0]!.equipment.legs.instanceId);
    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal,
      cards: cardData,
      state,
    });
    expect(decision.intent).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.equipment.chest!.instanceId,
    });
    expect(decision.plan?.line).toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
    }));
  });

  it("uses pump equipment under Frostbite when its pitch leaves a playable attack", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7032,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.flags["playedName:nimblism"] = true;
    replaceHand(state, 0, ["SBA023", "SBA011"]);
    state.players[0]!.equipment.arms = {
      instanceId: state.nextInstanceId++,
      cardId: "SBA008",
      owner: 0,
    };
    state.players[0]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "SIY035",
      owner: 0,
    });

    const intent = chooseBriarIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });
    expect(intent.kind).toBe("activate-ability");
    if (intent.kind !== "activate-ability") return;
    expect(intent.sourceInstanceId).toBe(state.players[0]!.equipment.arms.instanceId);
    expect(intent.pitchInstanceIds).toEqual([state.players[0]!.hand[0]!.instanceId]);

    const activated = applyIntent(state, 0, intent);
    expect(activated.ok, activated.ok ? "" : activated.error).toBe(true);
    if (!activated.ok) return;
    const actionState = resolveToAction(activated.state);
    expect(legalIntents(actionState, 0).some((candidate) =>
      candidate.kind === "play-card" &&
      actionState.players[0]!.hand.find((card) => card.instanceId === candidate.instanceId)?.cardId === "SBA011"
    )).toBe(true);
  });

  it("follows active Weave and Sizzle with Second Strike instead of passing or playing Ravenous Rabble", () => {
    let state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 704,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA029", "SBA027", "SBA017", "SBA020"]);

    for (const expectedCardId of ["SBA029", "SBA027"] as const) {
      const intent = chooseBriarIntent({
        seat: 0,
        view: projectStateFor(state, 0),
        legal: legalIntents(state, 0),
        cards: cardData,
      });
      expect(intent.kind).toBe("play-card");
      if (intent.kind !== "play-card") return;
      expect(state.players[0]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId)
        .toBe(expectedCardId);
      const result = applyIntent(state, 0, intent);
      expect(result.ok, result.ok ? "" : result.error).toBe(true);
      if (!result.ok) return;
      state = resolveToAction(result.state);
    }

    const attack = chooseBriarIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
    });
    expect(attack.kind).toBe("play-card");
    if (attack.kind !== "play-card") return;
    expect(state.players[0]!.hand.find((card) => card.instanceId === attack.instanceId)?.cardId)
      .toBe("SBA020");
  });

  it("preserves an offensive Briar hand instead of making a nonlethal partial block", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 705,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["SBA017", "SBA018", "SBA027", "SBA020"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "SBA029",
      owner: 0,
      faceDown: true,
    }];
    const handIds = state.players[0]!.hand.map((card) => card.instanceId);
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = {
      player: 0,
      kind: "defend",
      prompt: "Choose defending cards",
    };
    view.chain = [{
      attackingCard: { instanceId: 999, cardId: "", owner: 1 },
      defendingCards: [],
      attackValue: 9,
      defenseValue: 0,
      damage: 9,
      resolved: false,
      reactions: [],
    }];

    expect(chooseBriarIntent({
      seat: 0,
      view,
      legal: [
        { kind: "defend", instanceIds: [] },
        ...handIds.map((instanceId) => ({ kind: "defend" as const, instanceIds: [instanceId] })),
      ],
      cards: cardData,
    })).toEqual({ kind: "defend", instanceIds: [] });
  });

  it("stages required equipment before committing defense", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 70501,
      startPlayer: 1,
    });
    const view = projectStateFor(state, 0);
    const equipment = Object.values(view.players[0].equipment).find((card) =>
      card && cardData[card.cardId]?.cardType === "equipment"
    )!;
    const handCard = view.players[0].hand[0]!;
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defending cards" };
    view.chain = [{
      attackingCard: { instanceId: 99_901, cardId: "EVR073", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    const staging: GameIntent[] = [
      { kind: "stage-defenders", instanceIds: [handCard.instanceId] },
      { kind: "stage-defenders", instanceIds: [equipment.instanceId] },
      { kind: "concede" },
    ];

    expect(chooseBriarIntent({ seat: 0, view, legal: staging, cards: cardData }))
      .toEqual({ kind: "stage-defenders", instanceIds: [equipment.instanceId] });

    view.pendingDecision.stagedCards = [equipment];
    const commit: GameIntent = { kind: "defend", instanceIds: [equipment.instanceId] };
    const addHand = chooseBriarIntent({ seat: 0, view, legal: [commit, ...staging], cards: cardData });
    expect(addHand).toEqual({
      kind: "stage-defenders",
      instanceIds: [equipment.instanceId, handCard.instanceId],
    });

    view.pendingDecision.stagedCards = [equipment, handCard];
    const fullCommit: GameIntent = {
      kind: "defend",
      instanceIds: [equipment.instanceId, handCard.instanceId],
    };
    expect(chooseBriarIntent({ seat: 0, view, legal: [fullCommit, ...staging], cards: cardData }))
      .toEqual(fullCommit);
  });

  it("stages a Lava Burst block that survives lethal and maximizes next-turn damage", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 70502,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBA012", "SEA201", "SBA017", "SBA020"]);
    state.players[0]!.life = 5;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defending cards" };
    view.chain = [{
      attackingCard: { instanceId: 99_905, cardId: "SFA019", owner: 1 },
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

    const intent = chooseBriarIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent.kind).toBe("stage-defenders");
    if (intent.kind !== "stage-defenders") return;
    expect(intent.instanceIds).toHaveLength(1);
    const blocker = view.players[0].hand.find((card) =>
      card.instanceId === intent.instanceIds[0]
    );
    expect(blocker?.cardId).toBe("SEA201");
    expect(blocker?.defense).toBeGreaterThan(0);
  });

  it("stages and commits enough cards when surviving lethal needs multiple blockers", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 70503,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBA012", "SEA201", "SBA017", "SBA020"]);
    state.players[0]!.life = 2;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defending cards" };
    view.chain = [{
      attackingCard: { instanceId: 99_907, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 6,
      defenseValue: 0,
      damage: 6,
      resolved: false,
      reactions: [],
    }];
    const stageable: GameIntent[] = view.players[0].hand.map((card) => ({
      kind: "stage-defenders",
      instanceIds: [card.instanceId],
    }));

    const stage = chooseBriarIntent({
      seat: 0,
      view,
      legal: [{ kind: "defend", instanceIds: [] }, ...stageable],
      cards: cardData,
    });
    expect(stage.kind).toBe("stage-defenders");
    if (stage.kind !== "stage-defenders") return;
    const stagedCards = view.players[0].hand.filter((card) =>
      stage.instanceIds.includes(card.instanceId)
    );
    expect(stagedCards.reduce((total, card) => total + (card.defense ?? 0), 0))
      .toBeGreaterThanOrEqual(5);

    view.pendingDecision.stagedCards = stagedCards;
    const commit: GameIntent = { kind: "defend", instanceIds: stage.instanceIds };
    expect(chooseBriarIntent({
      seat: 0,
      view,
      legal: [commit, ...stageable],
      cards: cardData,
    })).toEqual(commit);
  });

  it("blocks as much as possible when Briar goes second on the first turn", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7051,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBA017", "SBA018", "SBA027", "SBA020"]);
    const handIds = state.players[0]!.hand.map((card) => card.instanceId);
    const view = projectStateFor(state, 0);
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = {
      player: 0,
      kind: "defend",
      prompt: "Choose defending cards",
    };
    view.chain = [{
      attackingCard: { instanceId: 999, cardId: "", owner: 1 },
      defendingCards: [],
      attackValue: 9,
      defenseValue: 0,
      damage: 9,
      resolved: false,
      reactions: [],
    }];

    expect(view.turn).toBe(1);
    expect(view.activePlayer).toBe(1);
    expect(chooseBriarIntent({
      seat: 0,
      view,
      legal: [
        { kind: "defend", instanceIds: [] },
        ...handIds.map((instanceId) => ({ kind: "defend" as const, instanceIds: [instanceId] })),
        { kind: "defend", instanceIds: handIds },
      ],
      cards: cardData,
    })).toEqual({ kind: "defend", instanceIds: handIds });
  });

  it("reserves a covering defense reaction and stops reacting once lethal is prevented", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 70511,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBA023", "SBA020"]);
    const blocker = state.players[0]!.hand[1]!;
    const view = projectStateFor(state, 0);
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defending cards" };
    view.chain = [{
      attackingCard: { instanceId: 999, cardId: "", owner: 1 },
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

    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });

    view.players[0].life = 3;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "defense-reaction", prompt: "Play a defense reaction or pass" };
    view.chain[0]!.attackValue = 4;
    view.chain[0]!.defenseValue = 2;
    view.chain[0]!.damage = 2;
    const reaction: GameIntent = {
      kind: "play-card",
      instanceId: state.players[0]!.hand[0]!.instanceId,
      pitchInstanceIds: [],
    };
    expect(chooseBriarIntent({
      seat: 0,
      view,
      legal: [{ kind: "pass" }, reaction],
      cards: cardData,
    })).toEqual({ kind: "pass" });
  });

  it("survives lethal with the block that preserves the strongest offense", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 70512,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBA012", "SEA201"]);
    state.players[0]!.life = 3;
    const [blockTwo, blockThree] = state.players[0]!.hand;
    const view = projectStateFor(state, 0);
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defending cards" };
    view.chain = [{
      attackingCard: { instanceId: 998, cardId: "", owner: 1 },
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

    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [blockThree!.instanceId] });
  });

  it("holds Arcane Seeds // Life on the opponent's nonlethal priority window", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7053,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBA024"]);
    const seeds = state.players[0]!.hand[0]!;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "layer";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    const legal: GameIntent[] = [
      { kind: "pass" },
      { kind: "play-card", instanceId: seeds.instanceId, pitchInstanceIds: [], meldSide: "right" },
    ];

    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("plays both sides of Arcane Seeds // Life during Briar's action phase", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7054,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA024"]);
    const seeds = state.players[0]!.hand[0]!;

    expect(chooseBriarIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    })).toMatchObject({
      kind: "play-card",
      instanceId: seeds.instanceId,
      meldSide: "both",
    });
  });

  it("uses Life for immediate lethal only when no barrier or prevention remains", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7055,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBA024"]);
    const seeds = state.players[0]!.hand[0]!;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "layer";
    view.players[0]!.life = 1;
    view.players[0]!.equipment.chest = {
      instanceId: 99_001,
      cardId: "SBL006",
      owner: 0,
    };
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.stack = [{
      card: null,
      seat: 1,
      label: "Runechant: 1 arcane damage to the opposing hero",
      optional: false,
    }];
    const life: GameIntent = {
      kind: "play-card",
      instanceId: seeds.instanceId,
      pitchInstanceIds: [],
      meldSide: "right",
    };
    const legal: GameIntent[] = [{ kind: "pass" }, life];

    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });

    view.players[0]!.equipment = {};
    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData })).toEqual(life);
  });

  it("keeps Burn Up // Shock when its attack line is worth more than the prevented damage", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 706,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["SBA025", "SBA018"]);
    const burn = state.players[0]!.hand[0]!;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defending cards" };
    view.chain = [{
      attackingCard: { instanceId: 999, cardId: "", owner: 1 },
      defendingCards: [],
      attackValue: 6,
      defenseValue: 0,
      damage: 6,
      resolved: false,
      reactions: [],
    }];

    expect(chooseBriarIntent({
      seat: 0,
      view,
      legal: [
        { kind: "defend", instanceIds: [] },
        { kind: "defend", instanceIds: [burn.instanceId] },
      ],
      cards: cardData,
    })).toEqual({ kind: "defend", instanceIds: [] });
  });

  it("reserves Cloud Cover and plans hand blocks around its 3 prevention", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 70601,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["SBA031", "SBA027"]);
    const sizzle = state.players[0]!.hand[1]!;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defending cards" };
    view.chain = [{
      attackingCard: { instanceId: 999, cardId: "", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [sizzle.instanceId] },
    ];

    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });

    // Cloud Cover handles the first 3; blocks are still used for damage above
    // that amount rather than treating its shield as unlimited prevention.
    view.chain[0]!.attackValue = 5;
    view.chain[0]!.damage = 5;
    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [sizzle.instanceId] });
  });

  it("plays Cloud Cover for an opponent's arcane damage or useful combat damage", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 70602,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBA031"]);
    const cloudCover = state.players[0]!.hand[0]!;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "layer";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.chain = [{
      attackingCard: { instanceId: 999, cardId: "", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    const play: GameIntent = {
      kind: "play-card",
      instanceId: cloudCover.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [{ kind: "pass" }, play];

    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });

    view.stack = [{
      card: null,
      seat: 1,
      label: "Destroy Runechant: 1 arcane damage to the opposing hero",
      optional: false,
    }];
    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData })).toEqual(play);

    view.stack = [];
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "defense-reaction", prompt: "Play a defense reaction or pass" };
    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData })).toEqual(play);
  });

  it("does not spend Cloud Cover during Briar's proactive turn plan", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 706021,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA031", "SBA027", "SBA013"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "SBA023",
      owner: 0,
      faceDown: true,
    }];
    const cloudCoverId = state.players[0]!.hand[0]!.instanceId;
    const sizzleId = state.players[0]!.hand[1]!.instanceId;

    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });

    expect(decision.intent).toMatchObject({ kind: "play-card", instanceId: sizzleId });
    expect(decision.plan?.line).not.toContainEqual(expect.objectContaining({
      kind: "play-card", instanceId: cloudCoverId,
    }));
  });

  it("plays Lightning Press only as an attack reaction", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 70603,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["SBA032"]);
    const lightningPress = state.players[0]!.hand[0]!;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 0;
    view.priorityPlayer = 0;
    view.phase = "layer";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.chain = [{
      attackingCard: { instanceId: 999, cardId: "SBA013", owner: 0 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    const play: GameIntent = {
      kind: "play-card",
      instanceId: lightningPress.instanceId,
      pitchInstanceIds: [],
    };
    const legal: GameIntent[] = [{ kind: "pass" }, play];

    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });

    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Play an attack reaction or pass" };
    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData })).toEqual(play);
  });

  it("plays both halves of Burn Up // Shock before a large setup hand can expose Shock alone", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7061,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA025", "SBA029", "SBA027", "SBA012"]);
    const burn = state.players[0]!.hand[0]!;
    burn.pitchCount = 1;

    const decision = chooseBriarIntentWithTrace({
      seat: 0,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    });

    expect(decision.intent).toEqual({
      kind: "play-card",
      instanceId: burn.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
      meldSide: "both",
    });
    expect(decision.plan?.line[0]).toEqual(decision.intent);
    expect(decision.plan?.candidateTrace.rootPrepared).toBe(1);
  });

  it("does not spend Shock alone in a priority window unless its damage is lethal", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 7062,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBA025"]);
    state.players[0]!.life = 10;
    state.players[1]!.life = 10;
    const burn = state.players[0]!.hand[0]!;
    const view = projectStateFor(state, 0);
    view.turn = 2;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "layer";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.log.push(
      "Briar takes 1 arcane damage (10 life left)",
      "Briar plays Burn Up // Shock in response",
      "Embodiment of Earth triggers: Destroy Embodiment of Earth",
    );
    const legal: GameIntent[] = [
      { kind: "pass" },
      { kind: "play-card", instanceId: burn.instanceId, pitchInstanceIds: [], meldSide: "right" },
    ];

    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "pass" });

    view.players[1]!.life = 1;
    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({
        kind: "play-card",
        instanceId: burn.instanceId,
        pitchInstanceIds: [],
        meldSide: "right",
      });
  });

  it("declines Arcane Barrier for nonlethal damage to preserve its next turn", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["SBA011", "SBA027", "SBA029"]);
    const view = projectStateFor(state, 0);
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Arcane Barrier: you would be dealt 2 arcane damage — pay {r} to prevent that much?",
      options: ["pay 0", "pay 1"],
    };
    const legal = [
      { kind: "choose", optionId: "pay 0" },
      { kind: "choose", optionId: "pay 1" },
      { kind: "concede" },
    ] as const;
    expect(chooseBriarIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "pay 0" });
  });

  it("pitches a setup card instead of its only attack for lethal Arcane Barrier", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 11,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["SBA011", "SBA027", "SBA029"]);
    const view = projectStateFor(state, 0);
    const [attack, sizzle, weave] = view.players[0]!.hand;
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Pitch cards to pay 1 for Arcane Barrier (1 more needed)",
      options: [String(attack!.instanceId), String(sizzle!.instanceId), String(weave!.instanceId)],
      optionCards: [attack!, sizzle!, weave!],
    };
    const legal = [attack!, sizzle!, weave!].map((card) => ({
      kind: "choose" as const,
      optionId: String(card.instanceId),
    }));

    const choice = chooseBriarIntent({ seat: 0, view, legal, cards: cardData });
    expect(choice).not.toEqual({ kind: "choose", optionId: String(attack!.instanceId) });
  });

  it("only returns authoritative legal intents during a seeded playout", () => {
    let state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 8102,
      startPlayer: 0,
    });
    const random = { rngState: 441 };
    for (let step = 0; step < 600 && state.winner === null; step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const legal = legalIntents(state, actor).filter((intent) => intent.kind !== "concede");
      expect(legal.length).toBeGreaterThan(0);
      const intent = actor === 0
        ? chooseBriarIntent({ seat: 0, view: projectStateFor(state, 0), legal, cards: cardData, state })
        : legal[Math.floor(rngNext(random) * legal.length)]!;
      const advertisedStageIds = new Set(legal.flatMap((candidate) =>
        candidate.kind === "stage-defenders" ? candidate.instanceIds : []
      ));
      expect(
        legal.some((candidate) => JSON.stringify(candidate) === JSON.stringify(intent)) ||
        (intent.kind === "stage-defenders" &&
          intent.instanceIds.every((id) => advertisedStageIds.has(id))),
      ).toBe(true);
      const result = applyIntent(state, actor, intent);
      expect(result.ok, result.ok ? "" : result.error).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }
  }, 15_000);

  it("cannot distinguish changes to the opponent's hidden hand and deck order", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 88,
      startPlayer: 0,
    });
    const { cardsRef: _cardsRef, scriptsRef: _scriptsRef, ...serializable } = state;
    const altered = JSON.parse(JSON.stringify(serializable)) as typeof state;
    // Runtime registries are deliberately not cloneable state; reattach the
    // same trusted registries after changing only hidden card positions.
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
    expect(chooseBriarIntent({ seat: 0, view: a, legal, cards: cardData, state }))
      .toEqual(chooseBriarIntent({ seat: 0, view: b, legal, cards: cardData, state: altered }));
  });

  it("cannot distinguish changes to its unseen deck order while planning", () => {
    const state = createGame({
      decklists: [briarDeck(decklists.dorinthea), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 881,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBA013", "SBA021"]);
    const { cardsRef: _cardsRef, scriptsRef: _scriptsRef, ...serializable } = state;
    const altered = JSON.parse(JSON.stringify(serializable)) as typeof state;
    altered.cardsRef = cardData;
    altered.scriptsRef = scripts;
    const deck = altered.players[0]!.deck;
    [deck[0], deck[1]] = [deck[1]!, deck[0]!];

    const legal = legalIntents(state, 0);
    expect(chooseBriarIntent({
      seat: 0,
      view: projectStateFor(state, 0),
      legal,
      cards: cardData,
      state,
    })).toEqual(chooseBriarIntent({
      seat: 0,
      view: projectStateFor(altered, 0),
      legal,
      cards: cardData,
      state: altered,
    }));
  });
});
