import { cardData, decklists, scripts } from "@fyendal/cards";
import { createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  BOT_OBSERVATION_KEY_LENGTH,
  boundedRootCandidates,
  botObservationKey,
  cloneStateForBotSimulation,
  DEFAULT_MAX_SEARCH_NODES,
  DEFAULT_MAX_SEARCH_TRANSITIONS,
  evaluateOpponentResponse,
  isBotObservationKey,
  MAX_ROOT_CANDIDATES,
  planTurn,
  type TurnPlannerRoot,
} from "./turn-planner.js";

function forcedIntent(legal: readonly GameIntent[]): GameIntent {
  return legal.find((intent) => intent.kind === "defend" && intent.instanceIds.length === 0)
    ?? legal.find((intent) => intent.kind === "pass")
    ?? legal.find((intent) => intent.kind !== "concede")!;
}

describe("bounded turn planning", () => {
  it("removes presentation history from simulation clones without mutating live state", () => {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 75,
      startPlayer: 0,
    });
    state.log = [];
    state.gameStats.turns = [];
    for (let index = 1; index <= 100; index++) {
      state.log.push({ publicText: `${index}:${"x".repeat(1_000)}` });
      state.gameStats.turns.push({
        turn: index,
        activePlayer: index % 2,
        attacks: [index, 0],
        threatened: [index, 0],
        blocked: [0, index],
        damageDealt: [index, 0],
      });
    }
    const originalBytes = JSON.stringify(state, (key, value) =>
      key === "cardsRef" || key === "scriptsRef" ? undefined : value
    ).length;

    const simulation = cloneStateForBotSimulation(state, "compact-simulation");
    const simulationBytes = JSON.stringify(simulation, (key, value) =>
      key === "cardsRef" || key === "scriptsRef" ? undefined : value
    ).length;

    expect(simulation.log).toEqual([]);
    expect(simulation.gameStats.turns).toEqual([state.gameStats.turns.at(-1)]);
    expect(simulation.cardsRef).toBe(state.cardsRef);
    expect(simulation.scriptsRef).toBe(state.scriptsRef);
    expect(state.log).toHaveLength(100);
    expect(state.gameStats.turns).toHaveLength(100);
    expect(simulationBytes).toBeLessThan(originalBytes / 4);
  });

  it("ignores completed-turn history but retains current statistics in observation keys", () => {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 76,
      startPlayer: 0,
    });
    const view = projectStateFor(state, 0);
    const current = {
      turn: view.turn,
      activePlayer: view.activePlayer,
      attacks: [1, 0] as [number, number],
      threatened: [3, 0] as [number, number],
      blocked: [0, 0] as [number, number],
      damageDealt: [2, 0] as [number, number],
    };
    view.gameStats = {
      turns: [{ ...current, turn: view.turn - 1 }, current],
    };
    const legal = legalIntents(state, 0);
    const withHistory = botObservationKey({ view, legal });
    expect(withHistory).toHaveLength(BOT_OBSERVATION_KEY_LENGTH);
    expect(isBotObservationKey(withHistory)).toBe(true);
    expect(isBotObservationKey(withHistory.toUpperCase())).toBe(false);
    view.log = [];
    view.logEntries = [];
    expect(botObservationKey({ view, legal })).toBe(withHistory);
    view.gameStats = { turns: [current] };
    expect(botObservationKey({ view, legal })).toBe(withHistory);

    view.gameStats.turns[0]!.threatened[0]++;
    expect(botObservationKey({ view, legal })).not.toBe(withHistory);
  });

  it("discounts goldfish damage with a public-information block model", () => {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 76,
      startPlayer: 0,
    });
    const view = projectStateFor(state, 0);
    const startingLife = view.players[1].life;
    view.players[1].life -= 10;
    view.gameStats = {
      turns: [{
        turn: view.turn,
        activePlayer: view.activePlayer,
        attacks: [1, 0],
        threatened: [10, 0],
        blocked: [0, 0],
        damageDealt: [10, 0],
      }],
    };
    const root: TurnPlannerRoot = {
      seat: 0,
      turn: view.turn,
      life: view.players[0].life,
      opponentLife: startingLife,
      opponentHandCount: 4,
      opponentEquipmentDefense: 2,
      threatenedAtRoot: 0,
      equipmentIds: new Set(),
      deckIds: new Set(),
      expectedDrawValue: 0,
      cards: cardData,
    };
    const response = evaluateOpponentResponse({ seat: 0, view, legal: [], cards: cardData }, root);
    expect(response.rawDamage).toBe(10);
    expect(response.expectedPrevention).toBeGreaterThan(0);
    expect(response.expectedDamage).toBeLessThan(response.rawDamage);
    expect(response.hitRate).toBeGreaterThanOrEqual(0);
    expect(response.hitRate).toBeLessThan(1);
  });

  it("retains no more than forty-eight prepared root candidates", () => {
    const candidates = Array.from({ length: 80 }, (_, option) => option);
    expect(boundedRootCandidates(candidates)).toEqual(candidates.slice(0, MAX_ROOT_CANDIDATES));
    expect(boundedRootCandidates(candidates, 12)).toEqual(candidates.slice(0, 12));
  });

  it("never exceeds the configured global node budget", () => {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 77,
      startPlayer: 0,
    });
    const input = {
      seat: 0 as const,
      view: projectStateFor(state, 0),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    };
    expect(input.legal.length).toBeGreaterThan(1);
    const config = {
      chooseForced: (forced: typeof input) => forcedIntent(forced.legal),
      cardOpportunity: () => 0,
      evaluateEnd: (_state: typeof state, _observed: typeof input, _root: unknown, complete: boolean) => ({
        score: 0,
        complete,
      }),
      maxSearchNodes: 2,
      recordCheckpoints: true,
    };

    const first = planTurn(input, config);
    const second = planTurn(input, config);
    expect(first?.nodes).toBeLessThanOrEqual(2);
    expect(first?.transitions).toBeLessThanOrEqual(DEFAULT_MAX_SEARCH_TRANSITIONS);
    expect(first?.candidateTrace.rootPrepared).toBeLessThanOrEqual(2);
    expect(first?.checkpoints[0]).toEqual({
      observationKey: botObservationKey(input),
      intent: first?.intent,
    });
    expect(second).toEqual(first);
  });

  it("counts forced engine applications against the deterministic transition budget", () => {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 79,
      startPlayer: 0,
    });
    const input = {
      seat: 0 as const,
      view: projectStateFor(state, 0, "transition-budget"),
      legal: legalIntents(state, 0),
      cards: cardData,
      state,
    };
    const plan = planTurn(input, {
      chooseForced: (forced) => forcedIntent(forced.legal),
      cardOpportunity: () => 0,
      evaluateEnd: (_state, _observed, _root, complete) => ({ score: 0, complete }),
      maxSearchNodes: 8,
      maxTransitions: 1,
      recordCheckpoints: true,
    });
    expect(plan?.transitions).toBe(1);
    expect(plan?.checkpoints[0]?.observationKey).toBe(botObservationKey(input));
  });

  it("ranks root candidates before applying a one-node cap", () => {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 78,
      startPlayer: 0,
    });
    const legal = legalIntents(state, 0).filter((intent) => intent.kind !== "concede");
    const pass = legal.find((intent) => intent.kind === "pass")!;
    const action = legal.find((intent) => intent.kind !== "pass")!;
    const input = {
      seat: 0 as const,
      view: projectStateFor(state, 0),
      legal: [pass, action],
      cards: cardData,
      state,
    };
    const plan = planTurn(input, {
      chooseForced: (forced) => forcedIntent(forced.legal),
      cardOpportunity: () => 0,
      rankCandidate: (intent) => intent === action ? 100 : 0,
      evaluateEnd: (_state, _observed, _root, complete) => ({ score: 0, complete }),
      maxSearchNodes: 1,
    });
    expect(plan?.intent).toBe(action);
  });

  it("keeps the production fallback strictly bounded", () => {
    expect(DEFAULT_MAX_SEARCH_NODES).toBe(64);
    expect(DEFAULT_MAX_SEARCH_TRANSITIONS).toBe(512);
  });
});
