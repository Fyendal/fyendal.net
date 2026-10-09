import { cardData, decklists, findPrinting, precon, scripts } from "@fyendal/cards";
import { createGame, projectStateFor, type GameState } from "@fyendal/engine";
import { describe, expect, it } from "vitest";
import { briarSolverRules } from "./briar-rules.js";
import { buildHandSolver, modelContext, type HeroSolverRules } from "./card-model.js";
import { cindraSolverRules } from "./cindra-rules.js";
import { decklistsFromState } from "./deck-knowledge.js";
import { kayoSolverRules } from "./kayo-rules.js";
import type { BotPolicyInput } from "./policy.js";
import {
  bravoPresentationFor,
  briarPresentationFor,
  cindraPresentationFor,
  kayoPresentationFor,
} from "./sideboard.js";

type Named = readonly [string, number?];

interface Scenario {
  deckId: string;
  presentation: { weaponIds: string[]; equipment: Record<string, string | undefined>; deck: string[] };
  hand: readonly Named[];
  arsenal?: readonly Named[];
  board?: readonly string[];
  /** Evaluate the bot's next turn from the opponent's turn. */
  opponentTurn?: boolean;
}

function instance(state: GameState, [name, pitch]: Named) {
  const printing = findPrinting(name, pitch);
  if (!printing) throw new Error(`missing printing ${name} ${pitch}`);
  return { instanceId: state.nextInstanceId++, cardId: printing.id, owner: 0 };
}

function scenario(setup: Scenario): BotPolicyInput {
  const pool = precon(setup.deckId)!.pool;
  const state = createGame({
    decklists: [{ heroId: pool.heroId, ...setup.presentation } as never, decklists.dorinthea],
    cards: cardData, scripts, seed: 11, startPlayer: 0,
  });
  state.turn = 3;
  if (setup.opponentTurn) {
    state.activePlayer = 1;
    state.priorityPlayer = 1;
  }
  const me = state.players[0]!;
  me.hand = setup.hand.map((card) => instance(state, card));
  me.arsenal = (setup.arsenal ?? []).map((card) => instance(state, card));
  me.board = (setup.board ?? []).map((name) => instance(state, [name]));
  return {
    seat: 0,
    view: projectStateFor(state, 0),
    legal: [],
    cards: cardData,
    state,
    decklists: decklistsFromState(state, 0),
  };
}

function solve(input: BotPolicyInput, rules: HeroSolverRules) {
  return buildHandSolver(modelContext(input, rules)).solve();
}

function names(input: BotPolicyInput, ids: readonly number[]): string[] {
  const me = input.view.players[input.seat];
  const equipment = Object.values(me.equipment).flatMap((card) => card ? [card] : []);
  const all = [...me.hand, ...me.arsenal, ...me.weapons, ...equipment];
  return ids.map((id) => cardData[all.find((card) => card.instanceId === id)?.cardId ?? ""]?.name ?? `#${id}`);
}

const opponent = { heroId: "SDO001", weaponIds: [], equipment: {} };

// Each case is a hand the per-hero estimators valued wrongly; the old value is
// noted in the test name.
describe("hand solver on real hands", () => {
  it("Kayo: an Agility token on board makes next turn a two-attack turn (was one attack)", () => {
    const input = scenario({
      deckId: "bot-kayo-sage",
      presentation: kayoPresentationFor(opponent),
      hand: [["Rough Up", 1], ["High Pitched Howl", 1], ["Vigorous Smashup", 3], ["Unexpected Backhand", 3]],
      board: ["Agility"],
      opponentTurn: true,
    });
    const result = solve(input, kayoSolverRules(input));
    expect(result.damage).toBeGreaterThanOrEqual(12);
    const played = names(input, result.line.filter((step) => step.kind === "play").map((step) => step.instanceId));
    expect(played).toContain("Rough Up");
    expect(played).toContain("High Pitched Howl");
  });

  it("Briar: Star Fall extends a Lightning line (was excluded)", () => {
    const input = scenario({
      deckId: "bot-briar-broccoli",
      presentation: briarPresentationFor(opponent),
      // Only one leftover can be arsenaled, so the other spare card is
      // better pitched into Star Fall after a Lightning card.
      hand: [["Fry", 1], ["Snatch", 1], ["Quick Succession", 3], ["Sigil of Suffering", 1]],
      opponentTurn: true,
    });
    const result = solve(input, briarSolverRules(input));
    expect(names(input, result.line.map((step) => step.instanceId))).toEqual(["Fry", "Star Fall", "Snatch"]);
    expect(result.damage).toBe(9);
  });

  it("Cindra: unfunded reds are capped by the pitch they consume (was 13, ignoring cost)", () => {
    const input = scenario({
      deckId: "bot-cindra-head-jabs",
      presentation: cindraPresentationFor(opponent),
      hand: [["Ronin Renegade", 1], ["Demonstrate Devotion", 1], ["Hunt the Hunter", 1]],
      opponentTurn: true,
    });
    const result = solve(input, cindraSolverRules(input));
    // Three cost-1-or-less cards cannot all be played and fund a Kunai swing.
    expect(result.damage).toBeLessThanOrEqual(8);
    for (const step of result.line) {
      expect(result.line.filter((other) => other.pitchIds.includes(step.instanceId))).toHaveLength(0);
    }
  });

  it("Cindra: Draconic openers come first and Ignite discounts the finisher", () => {
    const input = scenario({
      deckId: "bot-cindra-head-jabs",
      presentation: cindraPresentationFor(opponent),
      hand: [["Hot on Their Heels", 1], ["Ignite", 1], ["Hunt the Hunter", 1], ["Ronin Renegade", 1]],
      opponentTurn: true,
    });
    const result = solve(input, cindraSolverRules(input));
    const order = names(input, result.line.filter((step) => step.kind !== "weapon").map((step) => step.instanceId));
    expect(order.at(-1)).toBe("Hunt the Hunter");
    expect(order[0]).not.toBe("Hot on Their Heels");
    expect(order.indexOf("Ignite")).toBe(order.length - 2);
    expect(result.damage).toBeGreaterThanOrEqual(13);
    expect(result.line.every((step) => step.pitchIds.length === 0)).toBe(true);
  });

  it("Bravo: a cost-4 attack is funded by two pitch cards (was unplayable)", () => {
    const input = scenario({
      deckId: "bot-bravo-flarvo",
      presentation: bravoPresentationFor(opponent),
      hand: [["Debilitate", 1], ["Boulder Drop", 3], ["Crash and Bash", 1]],
      opponentTurn: true,
    });
    const result = solve(input, { name: "bravo" });
    expect(result.damage).toBe(8);
    expect(names(input, result.line[0]!.pitchIds).sort()).toEqual(["Boulder Drop", "Crash and Bash"]);
  });

  it("values a leftover go-again attack as arsenal at its full attack value", () => {
    const input = scenario({
      deckId: "bot-cindra-head-jabs",
      presentation: cindraPresentationFor(opponent),
      hand: [["Hunt the Hunter", 1], ["Ronin Renegade", 1]],
      opponentTurn: true,
    });
    const context = modelContext(input, cindraSolverRules(input));
    const solver = buildHandSolver(context);
    const ronin = solver.sources.find((card) => card.name === "Ronin Renegade")!;
    expect(ronin.arsenalValue).toBeCloseTo(3 * (1 - context.discount));
    const hunter = solver.sources.find((card) => card.name === "Hunt the Hunter")!;
    expect(hunter.arsenalValue).toBeLessThan(5);
  });
});
