import { cardData, precon, scripts } from "@fyendal/cards";
import {
  applyIntent,
  createGame,
  legalIntents,
  projectStateFor,
  type GameState,
} from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import type { BotPolicyInput } from "./policy.js";
import { createFaiProductionSession, faiStrategyFromInput } from "./fai-production.js";
import {
  initialFaiAggroPolicyState,
  initialFaiMidrangePolicyState,
} from "./fai-policy-state.js";
import { forcedAggroIntent } from "./fai-aggro-planner.js";
import { midForced } from "./fai-midrange-model.js";
import { faiAggroPresentation, faiMidrangePresentation } from "./sideboard.js";

const opponent: Decklist = {
  heroId: "RNR001",
  weaponIds: [],
  equipment: {},
  deck: Array(60).fill("WTR159") as string[],
};

function inputFor(presentation: ReturnType<typeof faiAggroPresentation>): BotPolicyInput {
  const state = createGame({
    decklists: [{
      heroId: precon("bot-fai")!.pool.heroId,
      ...presentation,
    }, opponent],
    cards: cardData,
    scripts,
    seed: 9_001,
    startPlayer: 0,
  });
  state.turn = 2;
  return {
    seat: 0,
    view: projectStateFor(state, 0),
    legal: legalIntents(state, 0),
    cards: cardData,
    state,
  };
}

function policyInput(state: GameState, seat: 0 | 1, midrange: boolean): BotPolicyInput {
  return {
    seat,
    view: projectStateFor(state, seat),
    legal: legalIntents(state, seat),
    cards: cardData,
    state,
    ...(midrange ? { knownOwnDeck: faiMidrangePresentation().deck } : {}),
  };
}

function apply(state: GameState, seat: 0 | 1, intent: GameIntent): GameState {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(`${JSON.stringify(intent)}: ${result.error}`);
  return result.state;
}

function coldOpening(midrange: boolean): GameState {
  const presentation = midrange ? faiMidrangePresentation() : faiAggroPresentation();
  const deck = { heroId: precon("bot-fai")!.pool.heroId, ...presentation };
  let state = createGame({
    decklists: [deck, deck],
    cards: cardData,
    scripts,
    seed: 101,
    startPlayer: 0,
  });
  for (let step = 0; step < 20 && state.pendingDecision; step++) {
    const actor = state.pendingDecision.player as 0 | 1;
    const observed = policyInput(state, actor, midrange);
    state = apply(state, actor, midrange ? midForced(observed) : forcedAggroIntent(observed));
  }
  state.players[0].hand = ["SFA022", "SFA015", "SFA023", "SFA024"].map((cardId) => ({
    cardId,
    owner: 0,
    instanceId: state.nextInstanceId++,
  }));
  const openingTurn = state.turn;
  for (let step = 0; step < 260 && state.turn === openingTurn && state.winner === null; step++) {
    const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    const observed = policyInput(state, actor, midrange);
    const intent = actor === 0
      ? createFaiProductionSession(observed).chooseIntent(observed)
      : midrange
        ? midForced(observed)
        : forcedAggroIntent(observed);
    state = apply(state, actor, intent);
  }
  return state;
}

describe("Fai production session", () => {
  it.each([
    ["Aggro", faiAggroPresentation("shield"), "aggro"],
    ["Midrange", faiMidrangePresentation(), "midrange"],
  ] as const)("recovers the durable %s strategy from the equipped weapon", (
    _label,
    presentation,
    expected,
  ) => {
    const input = inputFor(presentation);
    expect(faiStrategyFromInput(input)).toBe(expected);
    expect(createFaiProductionSession(input).strategy).toBe(expected);
  });

  it("rejects policy state from a different durable presentation", () => {
    expect(() => createFaiProductionSession(
      inputFor(faiAggroPresentation("shield")),
      initialFaiMidrangePolicyState(),
    )).toThrow(/cannot restore midrange/);
    expect(() => createFaiProductionSession(
      inputFor(faiMidrangePresentation()),
      initialFaiAggroPolicyState(),
    )).toThrow(/cannot restore aggro/);
  });

  it.each([
    ["Aggro", false],
    ["Midrange", true],
  ] as const)("keeps the %s opening reserve when every decision starts cold", (_label, midrange) => {
    const state = coldOpening(midrange);
    expect(state.players[0].arsenal).toHaveLength(1);
    expect(state.players[0].hand).toHaveLength(4);
  });
});
