import { cardData, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import type { BotPolicyInput } from "./policy.js";
import { faiAggroPresentation } from "./sideboard.js";
import { FaiAggroMemory, faiAggroStage } from "./fai-aggro-model.js";
import { forcedAggroIntent } from "./fai-aggro-planner.js";
import { createFaiAggroSession } from "./fai-aggro-policy.js";

function input(state: GameState, seat: 0 | 1 = 0): BotPolicyInput {
  return { state, seat, cards: cardData, view: projectStateFor(state, seat), legal: legalIntents(state, seat) };
}
function apply(state: GameState, seat: 0 | 1, intent: GameIntent): GameState {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(`${intent.kind}: ${result.error}`);
  return result.state;
}
function hand(state: GameState, cards: string[], seat: 0 | 1 = 0): number[] {
  state.players[seat].hand = cards.map((cardId) => ({ cardId, owner: seat, instanceId: state.nextInstanceId++ }));
  return state.players[seat].hand.map((card) => card.instanceId);
}
function first(turn = 1): GameState {
  const deck = { heroId: precon("bot-fai")!.pool.heroId, ...faiAggroPresentation() };
  let state = createGame({ decklists: [deck, deck], cards: cardData, scripts, seed: 101, startPlayer: 0 });
  for (let step = 0; step < 20 && state.pendingDecision; step++) {
    const actor = state.pendingDecision.player as 0 | 1;
    state = apply(state, actor, forcedAggroIntent(input(state, actor)));
  }
  state.turn = turn;
  state.activePlayer = (turn - 1) % 2 as 0 | 1;
  state.priorityPlayer = state.activePlayer;
  state.players[state.activePlayer]!.actionPoints = 1;
  state.gameStats.turns = Array.from({ length: turn }, (_, index) => ({
    turn: index + 1, activePlayer: index % 2, attacks: [0, 0], threatened: [0, 0],
    blocked: [0, 0], damageDealt: [0, 0],
  }));
  return state;
}
function runTurn(initial: GameState) {
  const session = createFaiAggroSession();
  const actions: GameIntent[] = [];
  let state = initial;
  for (let step = 0; step < 240 && state.turn === initial.turn && state.winner === null; step++) {
    const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    const intent = actor === 0 ? session.chooseIntent(input(state)) : forcedAggroIntent(input(state, actor));
    if (actor === 0) actions.push(intent);
    state = apply(state, actor, intent);
  }
  expect(state.turn > initial.turn || state.winner !== null).toBe(true);
  return { state, actions };
}
function defending(life = 20): GameState {
  let state = first(2);
  state.players[0].life = life;
  const [id] = hand(state, ["SFA023"], 1);
  state = apply(state, 1, { kind: "play-card", instanceId: id!, pitchInstanceIds: [] });
  for (let step = 0; step < 30 && state.pendingDecision?.kind !== "defend"; step++) {
    const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    state = apply(state, actor, forcedAggroIntent(input(state, actor)));
  }
  expect(state.pendingDecision?.kind).toBe("defend");
  return state;
}

describe("first-player fixed Turn1 burst", () => {
  it("separates opening, first defense, burst and later stages independently of seat", () => {
    for (const [turn, expected] of [[1, "first-turn0-attack"], [2, "first-turn1-defense"],
      [3, "first-turn1-attack"], [4, "later-defense"], [5, "later-attack"]] as const) {
      const view = input(first(turn)).view;
      expect(faiAggroStage(view, 0)).toBe(expected);
      view.activePlayer = (1 - view.activePlayer) as 0 | 1;
      view.gameStats!.turns.forEach((entry) => { entry.activePlayer = 1 - entry.activePlayer; });
      expect(faiAggroStage(view, 1)).toBe(expected);
    }
  });
  it("uses preparation memory only on Turn0, not on the five-card burst", () => {
    const memory = new FaiAggroMemory();
    memory.observe(input(first()));
    expect(memory.target).toBe(3);
    const burst = first(3);
    hand(burst, ["SFA023", "SFA029", "SFA013", "SFA019", "SFA023"]);
    burst.players[0].arsenal = [burst.players[0].hand.pop()!];
    memory.observe(input(burst));
    expect(memory.turn1).toBe(false);
    expect(memory.target).toBe(5);
  });
  it("opens naturally and stores one card without spending equipment", () => {
    const initial = first();
    const ids = hand(initial, ["SFA023", "SFA029", "SFA013", "SFA019"]);
    const { state, actions } = runTurn(initial);
    const equipment = [...Object.values(initial.players[0].equipment), ...initial.players[0].weapons]
      .flatMap((card) => card ? [card.instanceId] : []);
    expect(actions.some((intent) => intent.kind === "activate-ability" && equipment.includes(intent.sourceInstanceId))).toBe(false);
    expect(state.players[0].arsenal).toHaveLength(1);
    expect(ids).toContain(state.players[0].arsenal[0]!.instanceId);
    expect(state.players[0].hand).toHaveLength(4);
  });
  it("always stores the least costly card on Turn0, including unique roles", () => {
    const initial = first();
    const [, , enflame] = hand(initial, ["SFA012", "SFA018", "SFA014", "SFA030"]);
    const { state } = runTurn(initial);
    expect(state.players[0].arsenal).toHaveLength(1);
    expect(state.players[0].arsenal[0]?.instanceId).toBe(enflame);
    expect(state.players[0].hand).toHaveLength(4);
  });
  it("keeps an opening reserve for the reported all-starter hand", () => {
    const initial = first();
    const ids = hand(initial, ["SFA022", "SFA015", "SFA023", "SFA024"]);
    const { state } = runTurn(initial);
    expect(state.players[0].arsenal).toHaveLength(1);
    expect(ids).toContain(state.players[0].arsenal[0]?.instanceId);
    expect(state.players[0].hand).toHaveLength(4);
  });
  it("never rescues a broken Turn0 with any equipment or proactive pitch", () => {
    const initial = first();
    hand(initial, ["HNT151", "HNT151", "SFA019", "CRU073"]);
    const { state, actions } = runTurn(initial);
    expect(actions.some((intent) => intent.kind === "activate-ability")).toBe(false);
    expect(actions.some((intent) => "pitchInstanceIds" in intent && (intent.pitchInstanceIds?.length ?? 0) > 0)).toBe(false);
    expect(state.players[0].equipment).toEqual(initial.players[0].equipment);
    expect(state.players[0].weapons).toEqual(initial.players[0].weapons);
    expect(state.players[0].arsenal).toHaveLength(1);
  });
  it("does not store the only starter when it can start the opening route", () => {
    const state = first();
    const [starter] = hand(state, ["SFA023", "SFA018", "SFA019", "SFA019"]);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.plan!.line).toContainEqual(expect.objectContaining({ kind: "play-card", instanceId: starter }));
    expect(choice.plan!.evaluation.arsenalId).not.toBe(starter);
  });
  it("blocks with all three useful armor points, keeping nonlethal hand cards", () => {
    const state = defending();
    const ids = hand(state, ["SFA023", "SFA019", "SFA019"]);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.defense?.defense).toBe(3);
    expect(choice.rule).toBe("F-T1-D001");
    expect("instanceIds" in choice.intent && choice.intent.instanceIds.some((id) => ids.includes(id))).toBe(false);
    apply(state, 0, choice.intent);
  });
  it("uses an ender to survive real first-wave lethal when armor cannot save it", () => {
    const state = defending(1);
    const [, ender] = hand(state, ["SFA023", "SFA019"]);
    state.players[0].equipment = {}; state.players[0].weapons = [];
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.intent).toMatchObject({ instanceIds: [ender] });
    apply(state, 0, choice.intent);
  });
  it("commits Tiger and Kunai in Turn1 even against a healthy nonblocking opponent", () => {
    const initial = first(3);
    hand(initial, ["SFA023", "SFA029", "SFA013", "SFA019", "SFA018"]);
    initial.players[0].arsenal = [initial.players[0].hand.pop()!];
    initial.players[1].life = 100;
    initial.players[1].hand = [];
    const kunai = initial.players[0].weapons.find((card) => card.cardId === "HNT056")!.instanceId;
    const { state, actions } = runTurn(initial);
    expect(actions).toContainEqual(expect.objectContaining({ kind: "activate-ability", sourceInstanceId: kunai }));
    expect(state.players[0].equipment.arms).toBeUndefined();
    expect(state.players[0].equipment.legs).toBeUndefined();
    expect(state.players[0].equipment.head).toBeDefined(); // Fixed burst is not automatic Hood.
    expect(actions.some((intent) => "pitchInstanceIds" in intent && (intent.pitchInstanceIds?.length ?? 0) > 0)).toBe(false);
  }, 20_000);
  it.each([2, 3])("keeps the latest 4n Flame threshold in the burst (%i opponent cards)", (cards) => {
    const state = first(3);
    const [flame] = hand(state, ["SFA021", "SFA019"]);
    state.players[0].equipment = { head: state.players[0].equipment.head };
    state.players[0].weapons = [];
    state.players[0].life = 12;
    state.players[1].hand = state.players[1].hand.slice(0, cards);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(Boolean(choice.hood)).toBe(cards === 3);
    if (cards === 3) expect(choice.hood!.instanceIds).toContain(flame);
    else expect(choice.intent).toMatchObject({ kind: "play-card", instanceId: flame });
    apply(state, 0, choice.intent);
  });
  it("does not burn burst equipment after the last action point is gone", () => {
    const state = first(3);
    state.players[0].actionPoints = 0;
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.intent.kind).not.toBe("activate-ability");
  });
});
