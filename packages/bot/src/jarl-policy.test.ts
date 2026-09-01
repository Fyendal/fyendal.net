import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { CardView, Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseJarlIntent } from "./jarl-policy.js";
import { jarlPresentationFor } from "./sideboard.js";

function jarlDeck(opponent: Decklist = decklists.dorinthea): Decklist {
  const pool = precon("bot-jarl")!.pool;
  return { heroId: pool.heroId, ...jarlPresentationFor(opponent) };
}

function gravyDeck(): Decklist {
  const pool = precon("precon-sgb")!.pool;
  return {
    heroId: pool.heroId,
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
  cardIds: readonly string[],
): void {
  state.players[0]!.hand = cardIds.map((cardId) => ({
    instanceId: state.nextInstanceId++,
    cardId,
    owner: 0,
  }));
}

function inputFor(
  state: ReturnType<typeof createGame>,
  legal: readonly GameIntent[] = legalIntents(state, 0),
) {
  return {
    seat: 0 as const,
    view: projectStateFor(state, 0),
    legal,
    cards: cardData,
    state,
  };
}

function apply(
  state: ReturnType<typeof createGame>,
  intent: GameIntent,
  seat: 0 | 1 = 0,
): ReturnType<typeof createGame> {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function reachEnlightenedStrikeMode(
  state: ReturnType<typeof createGame>,
  bottomInstanceId: number,
): ReturnType<typeof createGame> {
  const enlightenedStrike = state.players[0]!.hand.find((card) => card.cardId === "PEN320")!;
  const choosingBottom = apply(state, {
    kind: "play-card",
    instanceId: enlightenedStrike.instanceId,
    pitchInstanceIds: [],
  });
  return apply(choosingBottom, { kind: "choose", optionId: String(bottomInstanceId) });
}

describe("Jarl policy", () => {
  it("uses Imposing Visage for a turn-zero Crumble setup in a non-aggro matchup", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_101,
      startPlayer: 0,
    });
    replaceHand(state, ["EVR022", "AJV018", "AJV014", "ELE146"]);
    const imposing = state.players[0]!.hand[0]!;

    expect(chooseJarlIntent(inputFor(state))).toMatchObject({
      kind: "play-card",
      instanceId: imposing.instanceId,
    });
  });

  it("targets Channel Lake Frigid with Imposing Visage into aggro and Crumble otherwise", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_102,
      startPlayer: 0,
    });
    const view = projectStateFor(state, 0);
    const channel: CardView = { instanceId: 80_001, cardId: "ELE146", owner: 0 };
    const crumble: CardView = { instanceId: 80_002, cardId: "AJV018", owner: 0 };
    view.players[1].heroName = "Cindra, Dracai of Retribution";
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose an aura with cost 2 or less",
      options: [String(channel.instanceId), String(crumble.instanceId)],
      optionCards: [channel, crumble],
    };
    view.priorityPlayer = 0;
    const legal: GameIntent[] = [
      { kind: "choose", optionId: String(channel.instanceId) },
      { kind: "choose", optionId: String(crumble.instanceId) },
    ];
    expect(chooseJarlIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: String(channel.instanceId) });

    view.players[1].heroName = "Dorinthea Ironsong";
    expect(chooseJarlIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: String(crumble.instanceId) });
  });

  it("blocks with expendable blues while preserving an Oaken and Pulse two-card line", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_103,
      startPlayer: 1,
    });
    replaceHand(state, ["ELE005", "ELE114", "AJV014", "AJV020"]);
    const view = projectStateFor(state, 0);
    const [oaken, pulse, autumn, frozen] = view.players[0].hand;
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 81_001, cardId: "WTR123", owner: 1 },
      defendingCards: [],
      attackValue: 6,
      defenseValue: 0,
      damage: 6,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [oaken!.instanceId, autumn!.instanceId] },
      { kind: "defend", instanceIds: [pulse!.instanceId, autumn!.instanceId] },
      { kind: "defend", instanceIds: [autumn!.instanceId, frozen!.instanceId] },
    ];

    expect(chooseJarlIntent({ seat: 0, view, legal, cards: cardData })).toEqual({
      kind: "defend",
      instanceIds: [autumn!.instanceId, frozen!.instanceId],
    });
  });

  it.each([
    [40, "defend"],
    [20, "stage-defenders"],
  ] as const)("times two-block Temper armor at %s life", (life, expectedKind) => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_102 + life,
      startPlayer: 1,
    });
    state.turn = 3;
    const view = projectStateFor(state, 0);
    view.players[0].life = life;
    const gauntlets = view.players[0].equipment.arms!;
    expect(cardData[gauntlets.cardId]?.name).toBe("Gauntlets of the Boreal Domain");
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 81_002, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 2,
      defenseValue: 0,
      damage: 2,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "stage-defenders", instanceIds: [gauntlets.instanceId] },
    ];

    expect(chooseJarlIntent({ seat: 0, view, legal, cards: cardData }).kind).toBe(expectedKind);
  });

  it("reserves Stalagmite for an attack with go again", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_104,
      startPlayer: 1,
    });
    const view = projectStateFor(state, 0);
    const stalagmite = view.players[0].weapons.find((card) => card.cardId === "EVR018")!;
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 82_001, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [stalagmite.instanceId] },
    ];
    expect(chooseJarlIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });

    view.chain[0]!.goAgain = true;
    expect(chooseJarlIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [stalagmite.instanceId] });
  });

  it("does not destroy fresh Boots of Omnis Ward without pending damage", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_107,
      startPlayer: 1,
    });
    const view = projectStateFor(state, 0);
    const boots = view.players[0].equipment.legs!;
    view.phase = "layer";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Play an instant or pass" };
    view.stack = [];
    const activate: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: boots.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseJarlIntent({ seat: 0, view, legal: [activate, { kind: "pass" }], cards: cardData }))
      .toEqual({ kind: "pass" });
  });

  it("destroys Boots of Omnis Ward to prevent visible Flick Knives damage", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_108,
      startPlayer: 1,
    });
    const view = projectStateFor(state, 0);
    const boots = view.players[0].equipment.legs!;
    view.phase = "reaction";
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "defense-reaction",
      prompt: "Play a defense reaction or pass",
    };
    view.stack = [{
      card: { instanceId: 83_001, cardId: "OUT139", owner: 1 },
      seat: 1,
      label: "Flick Knives",
      optional: false,
    }];
    const activate: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: boots.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseJarlIntent({ seat: 0, view, legal: [activate, { kind: "pass" }], cards: cardData }))
      .toEqual(activate);
  });

  it("cashes in damaged Boots only after defense leaves follow-up attack damage", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_109,
      startPlayer: 1,
    });
    const view = projectStateFor(state, 0);
    const boots = view.players[0].equipment.legs!;
    boots.defCounters = 1;
    view.phase = "reaction";
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "defense-reaction",
      prompt: "Play a defense reaction or pass",
    };
    view.chain = [{
      attackingCard: { instanceId: 84_001, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 3,
      damage: 1,
      resolved: false,
      reactions: [],
    }];
    const activate: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: boots.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseJarlIntent({ seat: 0, view, legal: [activate, { kind: "pass" }], cards: cardData }))
      .toEqual(activate);
  });

  it("does not stack Sink Below over Rootbound Carapace to prevent only one damage", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_109_1,
      startPlayer: 1,
    });
    replaceHand(state, ["ROS042", "ASR018"]);
    const view = projectStateFor(state, 0);
    const [rootbound, sinkBelow] = view.players[0].hand;
    view.players[0].hand = [sinkBelow!];
    view.phase = "reaction";
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "defense-reaction",
      prompt: "Play a defense reaction or pass",
    };
    view.chain = [{
      attackingCard: { instanceId: 84_002, cardId: "MON293", owner: 1 },
      defendingCards: [],
      attackValue: 5,
      defenseValue: 1,
      damage: 4,
      resolved: false,
      reactions: [],
    }];
    view.stack = [{
      card: rootbound!,
      seat: 0,
      label: "Rootbound Carapace",
      optional: false,
    }];
    const playSink: GameIntent = {
      kind: "play-card",
      instanceId: sinkBelow!.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseJarlIntent({
      seat: 0,
      view,
      legal: [playSink, { kind: "pass" }],
      cards: cardData,
    })).toEqual({ kind: "pass" });

    view.players[0].life = 1;
    expect(chooseJarlIntent({
      seat: 0,
      view,
      legal: [playSink, { kind: "pass" }],
      cards: cardData,
    })).toEqual(playSink);
  });

  it("gives Enlightened Strike go again to convert a three-card hand into a hammer attack", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_110,
      startPlayer: 0,
    });
    replaceHand(state, ["PEN320", "ASR018", "AJV014"]);
    const bottom = state.players[0]!.hand.find((card) => card.cardId === "ASR018")!;
    const choosingMode = reachEnlightenedStrikeMode(state, bottom.instanceId);

    expect(choosingMode.pendingDecision?.chooseHook).toBe("estrike-mode");
    expect(chooseJarlIntent(inputFor(choosingMode)))
      .toEqual({ kind: "choose", optionId: "go again" });
  });

  it("gives Enlightened Strike go again for an affordable follow-up attack card", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_111,
      startPlayer: 0,
    });
    replaceHand(state, ["PEN320", "ASR018", "PEN319", "AJV014"]);
    const bottom = state.players[0]!.hand.find((card) => card.cardId === "ASR018")!;
    const choosingMode = reachEnlightenedStrikeMode(state, bottom.instanceId);

    expect(chooseJarlIntent(inputFor(choosingMode)))
      .toEqual({ kind: "choose", optionId: "go again" });
  });

  it("takes Enlightened Strike's +2 mode when no follow-up attack is affordable and never draws", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_112,
      startPlayer: 0,
    });
    replaceHand(state, ["PEN320", "ASR018", "PEN319", "SUP261"]);
    const bottom = state.players[0]!.hand.find((card) => card.cardId === "ASR018")!;
    const choosingMode = reachEnlightenedStrikeMode(state, bottom.instanceId);

    expect(chooseJarlIntent(inputFor(choosingMode)))
      .toEqual({ kind: "choose", optionId: "+2" });
  });

  it("uses a full-fatigue block plan into Gravy Bones", () => {
    const opponent = gravyDeck();
    const state = createGame({
      decklists: [jarlDeck(opponent), opponent],
      cards: cardData,
      scripts,
      seed: 12_113,
      startPlayer: 1,
    });
    replaceHand(state, ["PEN319", "AJV014", "AJV020", "SIY033"]);
    const view = projectStateFor(state, 0);
    const [command, autumn] = view.players[0].hand;
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 85_001, cardId: "WTR123", owner: 1 },
      defendingCards: [],
      attackValue: 6,
      defenseValue: 0,
      damage: 6,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [command!.instanceId, autumn!.instanceId] },
    ];

    expect(chooseJarlIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [command!.instanceId, autumn!.instanceId] });
  });

  it("targets a Gravy Bones ally with an attack that can kill it", () => {
    const opponent = gravyDeck();
    const state = createGame({
      decklists: [jarlDeck(opponent), opponent],
      cards: cardData,
      scripts,
      seed: 12_114,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, ["PEN319", "AJV014", "AJV020", "SIY033"]);
    const ally = {
      instanceId: state.nextInstanceId++,
      cardId: "SGB016",
      owner: 1,
      life: 4,
    };
    state.players[1]!.board.push(ally);

    const chosen = chooseJarlIntent(inputFor(state));
    expect(chosen).toMatchObject({
      kind: "play-card",
      targetAllyId: ally.instanceId,
    });
  });

  it("plays Crumble immediately and marks Gravy Bones' Compass", () => {
    const opponent = gravyDeck();
    let state = createGame({
      decklists: [jarlDeck(opponent), opponent],
      cards: cardData,
      scripts,
      seed: 12_115,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, ["AJV018", "PEN319", "AJV014", "SIY033"]);
    const crumble = state.players[0]!.hand.find((card) => card.cardId === "AJV018")!;
    const enemyCompass = state.players[1]!.weapons.find((card) => card.cardId === "SGB002")!;

    const play = chooseJarlIntent(inputFor(state));
    expect(play).toMatchObject({ kind: "play-card", instanceId: crumble.instanceId });
    state = apply(state, play);
    for (let step = 0; step < 4 && state.pendingDecision?.chooseHook !== "crumble-counter"; step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      state = apply(state, { kind: "pass" }, actor);
    }
    expect(chooseJarlIntent(inputFor(state)))
      .toEqual({ kind: "choose", optionId: String(enemyCompass.instanceId) });
  });

  it("prioritizes a fused Frozen to Death when Gravy Bones' Compass is marked", () => {
    const opponent = gravyDeck();
    const state = createGame({
      decklists: [jarlDeck(opponent), opponent],
      cards: cardData,
      scripts,
      seed: 12_116,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, ["AJV020", "AJV014", "AJV018", "PEN319"]);
    state.players[1]!.weapons.find((card) => card.cardId === "SGB002")!.defCounters = 1;
    const frozen = state.players[0]!.hand.find((card) => card.cardId === "AJV020")!;

    expect(chooseJarlIntent(inputFor(state))).toMatchObject({
      kind: "play-card",
      instanceId: frozen.instanceId,
    });
  });

  it("sends Mangle at Gravy Bones instead of an ally while Compass is marked", () => {
    const opponent = gravyDeck();
    const state = createGame({
      decklists: [jarlDeck(opponent), opponent],
      cards: cardData,
      scripts,
      seed: 12_117,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, ["AJV011", "AJV014", "AJV020", "SIY033"]);
    state.players[1]!.weapons.find((card) => card.cardId === "SGB002")!.defCounters = 1;
    state.players[1]!.board.push({
      instanceId: state.nextInstanceId++,
      cardId: "SGB015",
      owner: 1,
      life: 3,
    });
    const mangle = state.players[0]!.hand.find((card) => card.cardId === "AJV011")!;

    const chosen = chooseJarlIntent(inputFor(state));
    expect(chosen).toMatchObject({
      kind: "play-card",
      instanceId: mangle.instanceId,
    });
    expect("targetAllyId" in chosen ? chosen.targetAllyId : undefined).toBeUndefined();
  });

  it("discards Fruits of the Forest from a three-card hand when life is missing", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_105,
      startPlayer: 0,
    });
    state.turn = 2;
    state.players[0]!.life = 30;
    replaceHand(state, ["ROS057", "AJV014", "PEN319"]);
    const fruits = state.players[0]!.hand[0]!;

    expect(chooseJarlIntent(inputFor(state))).toMatchObject({
      kind: "activate-ability",
      sourceInstanceId: fruits.instanceId,
    });
  });

  it("arsenals Pulse or Sow but never Crumble or another ordinary blue", () => {
    const state = createGame({
      decklists: [jarlDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 12_106,
      startPlayer: 0,
    });
    replaceHand(state, ["AJV018", "AJV014", "ELE142", "ELE114"]);
    const view = projectStateFor(state, 0);
    view.phase = "end";
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "arsenal",
      prompt: "Choose a card to arsenal",
      options: ["pass", ...view.players[0].hand.map((card) => String(card.instanceId))],
      optionCards: [null, ...view.players[0].hand],
    };
    const legal: GameIntent[] = view.pendingDecision.options!.map((optionId) => ({
      kind: "choose",
      optionId,
    }));
    const pulse = view.players[0].hand.find((card) => card.cardId === "ELE114")!;

    expect(chooseJarlIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: String(pulse.instanceId) });
  });
});
