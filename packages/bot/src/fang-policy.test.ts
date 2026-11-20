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

interface TurnLog {
  state: Game;
  swings: number;
  played: string[];
  pitched: string[];
}

/** Fang plays turn 2 against a passive opponent. */
function playTurn(state: Game): TurnLog {
  const own = (id: number) => [...state.players[0]!.hand, ...state.players[0]!.arsenal]
    .find((card) => card.instanceId === id)?.cardId;
  const log: TurnLog = { state, swings: 0, played: [], pitched: [] };
  for (let step = 0; step < 120 && state.turn === 2 && state.winner === null; step++) {
    const seat = actor(state);
    const intent = seat === 0 ? choose(state) : passive(state, 1);
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
});
