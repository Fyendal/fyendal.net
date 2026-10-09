import { cardData, decklists, findPrinting, precon, scripts } from "@fyendal/cards";
import { createGame, projectStateFor } from "@fyendal/engine";
import { describe, expect, it } from "vitest";
import {
  arsenalValue,
  ARSENAL_TERMINAL_FACTOR,
  defaultCardUses,
  DISRUPTION_BASE,
  DISRUPTION_CAP,
  disruptionDiscount,
  disruptsArsenal,
  hasStaticGoAgain,
  heldValue,
} from "./card-ev.js";
import { buildHandSolver, modelContext } from "./card-model.js";
import { cindraSolverRules } from "./cindra-rules.js";
import { decklistsFromState, probabilityAtLeastOne, totalCount, unseenCounts } from "./deck-knowledge.js";
import { cindraPresentationFor } from "./sideboard.js";

function game() {
  const pool = precon("bot-cindra-head-jabs")!.pool;
  const presentation = cindraPresentationFor({ heroId: "SDO001", weaponIds: [], equipment: {} });
  const state = createGame({
    decklists: [{ heroId: pool.heroId, ...presentation }, decklists.dorinthea],
    cards: cardData, scripts, seed: 5, startPlayer: 0,
  });
  return { state, presentation };
}

describe("deck knowledge", () => {
  it("recovers both main decks from state without weapons, equipment or tokens", () => {
    const { state, presentation } = game();
    const lists = decklistsFromState(state, 0);
    expect(lists.own).toEqual([...presentation.deck].sort());
    expect(lists.opponent).toEqual([...decklists.dorinthea.deck].sort());
  });

  it("subtracts known own cards and public opposing cards, never splitting hand from deck", () => {
    const { state } = game();
    const me = state.players[0]!;
    me.hand = me.deck.splice(0, 4);
    const opponent = state.players[1]!;
    opponent.hand = opponent.deck.splice(0, 4);
    opponent.graveyard = opponent.deck.splice(0, 2);
    const input = {
      seat: 0 as const, view: projectStateFor(state, 0), legal: [], cards: cardData,
      decklists: decklistsFromState(state, 0),
    };
    const own = unseenCounts(input, "own")!;
    expect(totalCount(own)).toBe(me.deck.length);
    const theirs = unseenCounts(input, "opponent")!;
    // Their hand stays unseen: only the graveyard is removed.
    expect(totalCount(theirs)).toBe(opponent.deck.length + opponent.hand.length);
  });

  it("computes hypergeometric draw odds", () => {
    expect(probabilityAtLeastOne(0, 40, 4)).toBe(0);
    expect(probabilityAtLeastOne(40, 40, 1)).toBe(1);
    expect(probabilityAtLeastOne(1, 40, 4)).toBeCloseTo(0.1, 5);
    expect(probabilityAtLeastOne(3, 40, 4)).toBeCloseTo(1 - (37 * 36 * 35 * 34) / (40 * 39 * 38 * 37), 6);
  });
});

describe("card values", () => {
  it("treats only a standalone Go again sentence as unconditional", () => {
    expect(hasStaticGoAgain(findPrinting("Ronin Renegade", 1)!)).toBe(true);
    expect(hasStaticGoAgain(findPrinting("Buckwild", 1)!)).toBe(false);
    expect(hasStaticGoAgain(findPrinting("Wild Ride", 1)!)).toBe(false);
    expect(hasStaticGoAgain(findPrinting("Star Fall")!)).toBe(false);
  });

  it("values arsenal: go-again attack at full value, terminal attack at a discount, pumps at pump value", () => {
    const ronin = defaultCardUses(findPrinting("Ronin Renegade", 1)!);
    expect(arsenalValue(ronin, 0)).toBe(3);
    expect(arsenalValue(ronin, 0.2)).toBeCloseTo(2.4);
    const hunter = defaultCardUses(findPrinting("Hunt the Hunter", 1)!);
    expect(arsenalValue(hunter, 0)).toBeCloseTo(5 * ARSENAL_TERMINAL_FACTOR);
    const sizzle = defaultCardUses(findPrinting("Sizzle", 1)!);
    expect(arsenalValue(sizzle, 0)).toBe(3);
    const sprout = defaultCardUses(findPrinting("Sprout Strength", 1)!);
    expect(arsenalValue(sprout, 0)).toBe(3);
    const block = defaultCardUses(findPrinting("Crash and Bash", 1)!);
    expect(arsenalValue(block, 0)).toBe(0);
  });

  it("values a held card only by its margin over an average draw", () => {
    const ronin = defaultCardUses(findPrinting("Ronin Renegade", 1)!);
    expect(heldValue(ronin, 10)).toBe(0);
    expect(heldValue(ronin, 2)).toBeGreaterThan(0);
  });

  it("detects arsenal disruption and clamps the discount", () => {
    expect(disruptsArsenal(findPrinting("Breaking Point", 1))).toBe(true);
    expect(disruptsArsenal(findPrinting("Disable", 3))).toBe(true);
    expect(disruptsArsenal(findPrinting("Ronin Renegade", 1))).toBe(false);
    const { state } = game();
    const input = {
      seat: 1 as const, view: projectStateFor(state, 1), legal: [], cards: cardData,
      decklists: decklistsFromState(state, 1),
    };
    const discount = disruptionDiscount(input);
    expect(discount).toBeGreaterThanOrEqual(DISRUPTION_BASE);
    expect(discount).toBeLessThanOrEqual(DISRUPTION_CAP);
    expect(disruptionDiscount({ ...input, decklists: undefined })).toBe(DISRUPTION_BASE);
  });
});

describe("solver latency", () => {
  it("builds a full opponent-turn subset table well inside a frame", () => {
    const { state } = game();
    state.turn = 3;
    state.activePlayer = 1;
    state.priorityPlayer = 1;
    const me = state.players[0]!;
    me.hand = ["Ronin Renegade", "Ignite", "Hot on Their Heels", "Hunt the Hunter", "Draco Fire"]
      .map((name) => ({ instanceId: state.nextInstanceId++, cardId: findPrinting(name, 1)!.id, owner: 0 }));
    me.arsenal = [{ instanceId: state.nextInstanceId++, cardId: findPrinting("Blood Runs Deep", 1)!.id, owner: 0 }];
    const input = {
      seat: 0 as const, view: projectStateFor(state, 0), legal: [], cards: cardData, state,
      decklists: decklistsFromState(state, 0),
    };
    const started = performance.now();
    const solver = buildHandSolver(modelContext(input, cindraSolverRules(input)));
    const table = solver.subsetValues(me.hand.map((card) => card.instanceId));
    const elapsed = performance.now() - started;
    expect(table.size).toBe(32);
    expect(elapsed).toBeLessThan(250);
    // Monotone: removing a card never increases the hand's value by more
    // than that card's held value would have cost.
    expect(table.get(31)!.value).toBeGreaterThanOrEqual(table.get(0)!.value);
  });
});
