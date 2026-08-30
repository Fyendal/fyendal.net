import { cardData, decklists, scripts } from "@fyendal/cards";
import { createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  boundedRootCandidates,
  botObservationKey,
  DEFAULT_MAX_SEARCH_NODES,
  DEFAULT_MAX_SEARCH_TRANSITIONS,
  evaluateOpponentResponse,
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
