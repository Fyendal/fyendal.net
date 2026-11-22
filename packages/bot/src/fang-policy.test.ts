import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseFangIntent } from "./fang-policy.js";
import { fangPresentationFor } from "./sideboard.js";

type Game = ReturnType<typeof createGame>;

const FEALTY = "HNT167";

function fangDeck(opponent: Decklist): Decklist {
  const pool = precon("bot-fang-dracai")!.pool;
  return { heroId: pool.heroId, ...fangPresentationFor(opponent) };
}

/** Fang (seat 0) against Rhinar, past the opening turn. */
function newGame(seed: number): Game {
  const state = createGame({
    decklists: [fangDeck(decklists.rhinar), decklists.rhinar],
    cards: cardData,
    scripts,
    seed,
    startPlayer: 0,
  });
  state.turn = 2;
  return state;
}

function replaceHand(state: Game, seat: 0 | 1, cardIds: readonly string[]): void {
  state.players[seat]!.hand = cardIds.map((cardId) => ({ instanceId: state.nextInstanceId++, cardId, owner: seat }));
}

function addFealty(state: Game, count: number): void {
  for (let index = 0; index < count; index++) {
    state.players[0]!.board.push({ instanceId: state.nextInstanceId++, cardId: FEALTY, owner: 0 });
  }
}

function markOpponent(state: Game): void {
  const hero = state.players[1]!.hero;
  hero.scriptState = { ...(hero.scriptState ?? {}), marked: 1 };
}

function fealtyCount(state: Game): number {
  return state.players[0]!.board.filter((card) => cardData[card.cardId]?.name === "Fealty").length;
}

function choose(state: Game): GameIntent {
  const legal = legalIntents(state, 0).filter((intent) =>
    intent.kind !== "concede" && !intent.kind.endsWith("-draw")
  );
  return chooseFangIntent({ seat: 0, view: projectStateFor(state, 0), legal, cards: cardData, state });
}

/** The opponent never blocks or responds. */
function passive(state: Game, seat: 0 | 1): GameIntent {
  const legal = legalIntents(state, seat);
  return legal.find((intent) => intent.kind === "defend" && intent.instanceIds.length === 0) ??
    legal.find((intent) => intent.kind === "pass") ?? legal[0]!;
}

function actor(state: Game): 0 | 1 {
  return (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
}

function apply(state: Game, seat: 0 | 1, intent: GameIntent): Game {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

interface TurnAction {
  name: string;
  /** Pending decision (or phase) when Fang acted. */
  step: string;
  /** The attack on the current link was still on the stack. */
  onStack: boolean;
}

interface TurnLog {
  state: Game;
  swings: number;
  played: string[];
  pitched: string[];
  /** Every card played and ability activated, in order. */
  actions: TurnAction[];
}

/** Fang plays turn 2 against a passive opponent. */
function playTurn(state: Game): TurnLog {
  const own = (id: number) => [...state.players[0]!.hand, ...state.players[0]!.arsenal]
    .find((card) => card.instanceId === id)?.cardId;
  const log: TurnLog = { state, swings: 0, played: [], pitched: [], actions: [] };
  for (let step = 0; step < 120 && state.turn === 2 && state.winner === null; step++) {
    const seat = actor(state);
    const intent = seat === 0 ? choose(state) : passive(state, 1);
    const me = state.players[0]!;
    const id = intent.kind === "activate-ability" ? intent.sourceInstanceId
      : intent.kind === "play-card" || intent.kind === "play-from-arsenal" ? intent.instanceId : undefined;
    const source = [...me.hand, ...me.arsenal, ...me.board, ...me.weapons].find((card) => card.instanceId === id);
    if (seat === 0 && source) {
      log.actions.push({
        name: cardData[source.cardId]?.name ?? "?",
        step: state.pendingDecision?.kind ?? state.phase,
        onStack: projectStateFor(state, 0).chain.at(-1)?.onStack === true,
      });
    }
    if (seat === 0 && "pitchInstanceIds" in intent) {
      for (const id of intent.pitchInstanceIds ?? []) log.pitched.push(own(id) ?? "?");
    }
    if (seat === 0 && intent.kind === "activate-ability" &&
      state.players[0]!.weapons.some((weapon) => weapon.instanceId === intent.sourceInstanceId)) log.swings++;
    if (seat === 0 && (intent.kind === "play-card" || intent.kind === "play-from-arsenal")) {
      log.played.push(own(intent.instanceId) ?? "?");
    }
    state = apply(state, seat, intent);
  }
  return { ...log, state };
}

const names = (ids: readonly string[]) => ids.map((id) => cardData[id]?.name);

describe("Fang presentation", () => {
  const present = (heroId: string) => fangPresentationFor({ heroId, weaponIds: [], equipment: {} });
  const count = (deck: readonly string[], name: string) => deck.filter((id) => cardData[id]?.name === name).length;

  it("keeps the main list with Crown of Providence by default", () => {
    const deck = present("DYN113"); // Arakni, Huntsman
    expect(deck.weaponIds).toEqual(["HNT100", "HNT100"]);
    expect(deck.equipment).toMatchObject({ head: "PEN310", chest: "MPW010", arms: "MPW011", legs: "MPW012" });
    // Aggro and life-gain: Blaze and Sworn for Sink and Smoke, plus Parched Terrain.
    expect(deck.deck).toHaveLength(62);
    expect(count(deck.deck, "Blaze Headlong")).toBe(3);
    expect(count(deck.deck, "Sworn Vengeance")).toBe(3);
    expect(count(deck.deck, "Parched Terrain")).toBe(2);
    expect(count(deck.deck, "Sink Below")).toBe(0);
  });

  it("goes defensive with Kabuto and Fate Foreseen against Cindra", () => {
    const deck = present("HNT054");
    expect(deck.equipment.head).toBe("HNT115");
    expect(deck.deck).toHaveLength(60);
    expect(count(deck.deck, "Fate Foreseen")).toBe(3);
    expect(count(deck.deck, "Fire and Brimstone")).toBe(0);
    expect(count(deck.deck, "Imperial Intent")).toBe(0);
  });

  it("wears Arcanite Skullcap and swaps Imperial Intent for Parched Terrain against Verdance", () => {
    const deck = present("ROS013");
    expect(deck.equipment.head).toBe("EVR154");
    expect(deck.deck).toHaveLength(60);
    expect(count(deck.deck, "Parched Terrain")).toBe(2);
    expect(count(deck.deck, "Imperial Intent")).toBe(0);
  });

  it("keeps the main 60 with Balance of Justice against Rhinar", () => {
    const deck = present(decklists.rhinar.heroId);
    expect(deck.equipment.head).toBe("PEN309");
    expect(deck.deck).toEqual(precon("bot-fang-dracai")!.pool.deck);
  });
});

describe("Fang policy", () => {
  it("pitches blue to swing both Veins behind Draconic reactions while building Fealty", () => {
    let state = newGame(9101);
    // Blistering Blade, Searing Gaze, Glint the Quicksilver, Overcrowded.
    replaceHand(state, 0, ["HNT106", "HNT111", "MPW022", "SUP216"]);
    const turn = playTurn(state);
    state = turn.state;

    expect(turn.swings).toBe(2);
    expect(names(turn.played)).toEqual(expect.arrayContaining(["Blistering Blade", "Searing Gaze"]));
    expect(turn.pitched.length).toBeGreaterThan(0);
    expect(turn.pitched.every((id) => cardData[id]?.pitch === 3)).toBe(true);
    // Searing Gaze on the second Draconic link marked Rhinar for next turn's Fealty.
    expect(state.players[1]!.hero.scriptState?.marked ?? 0).toBeGreaterThan(0);
  });

  it("converts a standing mark into Fealty with its first hit", () => {
    let state = newGame(9102);
    markOpponent(state);
    // Affirm Loyalty, Blistering Blade, Provoke, Overpower.
    replaceHand(state, 0, ["HNT103", "HNT106", "HNT117", "SDO027"]);
    const turn = playTurn(state);
    state = turn.state;

    expect(turn.swings).toBe(2);
    // The marked hit and Affirm Loyalty on the second Draconic link.
    expect(fealtyCount(state)).toBeGreaterThanOrEqual(2);
  });

  it("plays Savor Bloodshed before the first swing, since a non-attack action closes the chain", () => {
    let state = newGame(9104);
    markOpponent(state);
    // Savor Bloodshed, Blistering Blade, Affirm Loyalty, Relentless Pursuit.
    replaceHand(state, 0, ["HNT198", "HNT106", "HNT103", "HNT229"]);
    const turn = playTurn(state);
    state = turn.state;

    expect(names(turn.played)[0]).toBe("Savor Bloodshed");
    expect(turn.swings).toBe(2);
    expect(names(turn.pitched)).toContain("Relentless Pursuit");
    expect(fealtyCount(state)).toBeGreaterThanOrEqual(2);
  });

  it("holds Draconic instants until the Vein's reaction step, not while the attack is on the stack", () => {
    const state = newGame(9105);
    // Tooth of the Dragon, Pledge Fealty, Glint the Quicksilver, Overcrowded.
    replaceHand(state, 0, ["HNT166", "HNT164", "MPW022", "SUP216"]);
    const instantNames = new Set(["Tooth of the Dragon", "Pledge Fealty", "Glint the Quicksilver"]);
    const instants = playTurn(state).actions.filter((action) => instantNames.has(action.name));

    expect(instants.length).toBeGreaterThan(0);
    for (const play of instants) expect(play).toMatchObject({ onStack: false, step: "attack-reaction" });
  });

  it("spends a surplus Fealty to make Blade Flurry Draconic and swing the second Vein", () => {
    const state = newGame(9106);
    addFealty(state, 5);
    // Blade Flurry, Overcrowded, Relentless Pursuit, Provoke: no Draconic card in hand.
    replaceHand(state, 0, ["MPW021", "SUP216", "HNT229", "HNT117"]);
    const turn = playTurn(state);
    const actions = turn.actions.map((action) => action.name);

    expect(turn.swings).toBe(2);
    // The Fealty resolves first, so Blade Flurry is Draconic and gives the Vein go again.
    expect(actions[actions.indexOf("Blade Flurry") - 1]).toBe("Fealty");
    expect(actions.indexOf("Blade Flurry")).toBeLessThan(actions.lastIndexOf("Obsidian Fire Vein"));
    expect(fealtyCount(turn.state)).toBeGreaterThanOrEqual(3);
  });

  it("gives the Vein go again with Tooth of the Dragon in the reaction step instead of spending Fealty", () => {
    const state = newGame(9107);
    addFealty(state, 5);
    // Tooth of the Dragon, Blade Flurry, Overcrowded, Relentless Pursuit.
    replaceHand(state, 0, ["HNT166", "MPW021", "SUP216", "HNT229"]);
    const turn = playTurn(state);
    const actions = turn.actions.map((action) => action.name);

    expect(actions).not.toContain("Fealty");
    expect(turn.swings).toBe(2);
    const tooth = actions.indexOf("Tooth of the Dragon");
    expect(turn.actions[tooth]!.step).toBe("attack-reaction");
    expect(tooth).toBeGreaterThan(actions.indexOf("Obsidian Fire Vein"));
    expect(tooth).toBeLessThan(actions.lastIndexOf("Obsidian Fire Vein"));
    expect(fealtyCount(turn.state)).toBe(5);
  });

  it("spends one of three Fealty when no Draconic card would save them at the end phase", () => {
    let state = newGame(9108);
    addFealty(state, 3);
    // Blade Flurry, Overcrowded, Relentless Pursuit, Provoke: no Draconic card in hand.
    replaceHand(state, 0, ["MPW021", "SUP216", "HNT229", "HNT117"]);
    const turn = playTurn(state);

    expect(turn.swings).toBe(2);
    // Holding all three would lose them at the end phase.
    expect(fealtyCount(turn.state)).toBeGreaterThanOrEqual(2);
  });

  it("swings both Veins for free once three Fealty stand and spends the hand on pumps", () => {
    let state = newGame(9103);
    addFealty(state, 3);
    // Hunt's End, Blistering Blade, Affirm Loyalty, Overpower.
    replaceHand(state, 0, ["HNT101", "HNT106", "HNT103", "SDO027"]);
    const lifeBefore = state.players[1]!.life;
    const turn = playTurn(state);
    state = turn.state;

    expect(turn.swings).toBe(2);
    expect(names(turn.played)).toEqual(expect.arrayContaining(["Hunt's End", "Blistering Blade", "Affirm Loyalty"]));
    // 1+1 base, +1 Vein each, +4 Hunt's End, +3 Blistering Blade, +2 Affirm Loyalty.
    expect(lifeBefore - state.players[1]!.life).toBeGreaterThanOrEqual(13);
  });

  it("room 07977C: adds a fresh Valiant Dynamo to a block because both Veins repair it", () => {
    const state = createGame({
      decklists: [fangDeck(decklists.rhinar), decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 7977,
      startPlayer: 1,
    });
    state.turn = 2;
    // Relentless Pursuit, Provoke, Pledge Fealty, Savor Bloodshed.
    replaceHand(state, 0, ["HNT229", "HNT117", "HNT164", "HNT198"]);
    state.players[0]!.life = 23;
    state.players[1]!.life = 9;
    const view = projectStateFor(state, 0);
    const dynamo = view.players[0].equipment.legs!;
    expect(cardData[dynamo.cardId]?.name).toBe("Valiant Dynamo");
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 97_977, cardId: "DYN005", owner: 1 },
      defendingCards: [],
      attackValue: 11,
      defenseValue: 0,
      damage: 11,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      ...[...view.players[0].hand, dynamo].map((card) => ({
        kind: "stage-defenders" as const,
        instanceIds: [card.instanceId],
      })),
    ];
    const chosenIds = (): readonly number[] => {
      const intent = chooseFangIntent({ seat: 0, view, legal, cards: cardData });
      return intent.kind === "stage-defenders" || intent.kind === "defend" ? intent.instanceIds : [];
    };

    expect(chosenIds()).toContain(dynamo.instanceId);

    view.players[0].equipment.legs = { ...dynamo, defense: 0, defCounters: 1 };
    expect(chosenIds()).not.toContain(dynamo.instanceId);
  });
});
