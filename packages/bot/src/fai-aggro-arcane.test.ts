import { cardData, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import type { BotPolicyInput } from "./policy.js";
import { faiAggroPresentation } from "./sideboard.js";
import { forcedAggroIntent } from "./fai-aggro-planner.js";
import { chooseFaiArcaneDefense } from "./fai-aggro-arcane.js";
import { createFaiAggroSession } from "./fai-aggro-policy.js";

function input(state: GameState, seat: 0 | 1 = 0): BotPolicyInput {
  return { state, seat, cards: cardData, view: projectStateFor(state, seat), legal: legalIntents(state, seat) };
}
function apply(state: GameState, seat: 0 | 1, intent: GameIntent): GameState {
  expect(legalIntents(state, seat)).toContainEqual(intent);
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function hand(state: GameState, ids: string[], seat: 0 | 1 = 0): number[] {
  state.players[seat].hand = ids.map((cardId) => ({ cardId, owner: seat, instanceId: state.nextInstanceId++ }));
  return state.players[seat].hand.map((card) => card.instanceId);
}
function advance(state: GameState, until: (state: GameState) => boolean): GameState {
  for (let step = 0; step < 80 && !until(state); step++) {
    const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    state = apply(state, seat, forcedAggroIntent(input(state, seat)));
  }
  expect(until(state)).toBe(true);
  return state;
}
function game(active: 0 | 1): GameState {
  const deck = { heroId: precon("bot-fai")!.pool.heroId, ...faiAggroPresentation() };
  const state = advance(createGame({ decklists: [deck, deck], cards: cardData, scripts,
    seed: 101, startPlayer: 1 }), (state) => !state.pendingDecision);
  state.turn = active === 0 ? 4 : 3;
  state.phase = "action"; state.activePlayer = active; state.priorityPlayer = active;
  state.players[active].actionPoints = 1;
  state.players[0].equipment = {}; // Isolate hand value from one-use equipment.
  state.players[0].weapons = state.players[0].weapons.filter((card) => card.cardId === "SLY003");
  state.players[0].graveyard = [];
  state.gameStats.turns = Array.from({ length: state.turn }, (_, index) => ({
    turn: index + 1, activePlayer: (index + 1) % 2, attacks: [0, 0], threatened: [0, 0],
    blocked: [0, 0], damageDealt: [0, 0],
  }));
  return state;
}
const barrier = (state: GameState) => state.pendingDecision?.prompt.startsWith("Arcane Barrier:") === true;
function path(handIds: string[], life = 1, resources = 0): GameState {
  let state = game(1);
  hand(state, handIds);
  state.players[0].life = life; state.players[0].resources = resources;
  state.players[1].resources = 3;
  const [attack] = hand(state, ["SBA016"], 1);
  const play = legalIntents(state, 1).find((intent) => intent.kind === "play-card" && intent.instanceId === attack)!;
  state = apply(state, 1, play);
  return advance(state, barrier);
}
function pitchWindow(state: GameState): GameState {
  const choice = chooseFaiArcaneDefense(input(state))!;
  expect(choice.intent).toMatchObject({ kind: "choose", optionId: "pay 1" });
  state = apply(state, 0, choice.intent);
  expect(state.pendingDecision?.prompt).toMatch(/^Pitch cards to pay 1 for Arcane Barrier/);
  return state;
}

describe("Fai Arcane Lantern survival", () => {
  it("declines nonlethal arcane damage even with floating resources", () => {
    const state = path(["SFA019"], 2, 1);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.intent).toMatchObject({ kind: "choose", optionId: "pay 0" });
    expect(apply(state, 0, choice.intent).players[0].life).toBe(1);
  });

  it("uses floating resources to survive without pitching a card", () => {
    const state = path(["SFA019"], 1, 1);
    const choice = chooseFaiArcaneDefense(input(state))!;
    expect(choice.intent).toMatchObject({ kind: "choose", optionId: "pay 1" });
    const after = apply(state, 0, choice.intent);
    expect(after.players[0].life).toBe(1);
    expect(after.players[0].resources).toBe(0);
    expect(after.players[0].hand).toEqual(state.players[0].hand);
    expect(after.players[0].pitch).toHaveLength(0);
  });

  it("does not spend a card when the offered prevention cannot save the current packet", () => {
    const visible = input(path(["SFA019"]));
    // Payment gate depends only on the visible packet and legal offered totals.
    visible.view.pendingDecision!.prompt = visible.view.pendingDecision!.prompt.replace("1 arcane", "2 arcane");
    expect(chooseFaiArcaneDefense(visible)!.intent).toMatchObject({ kind: "choose", optionId: "pay 0" });
  });

  it("pitches a red ender before a yellow starter and resolves the lethal packet legally", () => {
    const state = pitchWindow(path(["SFA019", "SFA029"]));
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.arcane?.pitchedId).toBe(state.players[0].hand[0]!.instanceId);
    const after = apply(state, 0, choice.intent);
    expect(after.players[0].life).toBe(1);
    expect(after.players[0].pitch.map((card) => card.cardId)).toEqual(["SFA019"]);
  });

  it("preserves the last starter when only starters and extenders are available", () => {
    const state = pitchWindow(path(["SFA023", "SFA013"]));
    const choice = chooseFaiArcaneDefense(input(state))!;
    expect(choice.arcane.pitchedId).toBe(state.players[0].hand[1]!.instanceId);
    apply(state, 0, choice.intent);
  });

  it("pitches yellow first when both role and retained hand damage tie", () => {
    const state = pitchWindow(path(["SFA019", "SFA019", "CRU073"]));
    const choice = chooseFaiArcaneDefense(input(state))!;
    expect(choice.arcane.pitchedId).toBe(state.players[0].hand[2]!.instanceId);
    expect(choice.arcane.retainedDamage).toBe(2);
    expect(choice.arcane.complete).toBe(true);
    expect(apply(state, 0, choice.intent).players[0].resources).toBe(1);
  });

  it("values the current attack continuation before color and ignores hidden identities", () => {
    let state = game(0);
    state.players[1].life = 40;
    const attacks = hand(state, Array<string>(5).fill("SFA023"));
    for (const id of attacks.slice(0, 4)) {
      const play = legalIntents(state, 0).find((intent) => intent.kind === "play-card" && intent.instanceId === id)!;
      state = advance(apply(state, 0, play), (state) => state.phase === "action" &&
        state.priorityPlayer === 0 && !state.pendingDecision && !state.stack.length);
    }
    const last = legalIntents(state, 0).find((intent) => intent.kind === "play-card" && intent.instanceId === attacks[4])!;
    state = apply(state, 0, last);
    hand(state, ["SFA019", "CRU073"]);
    state.players[0].life = 1;
    const [sigil] = hand(state, ["SBA023"], 1);
    state.players[1].resources = 1;
    state = advance(state, (state) => legalIntents(state, 1).some((intent) =>
      intent.kind === "play-card" && intent.instanceId === sigil));
    const reaction = legalIntents(state, 1).find((intent) => intent.kind === "play-card" && intent.instanceId === sigil)!;
    state = pitchWindow(advance(apply(state, 1, reaction), barrier));
    const before = chooseFaiArcaneDefense(input(state))!;
    expect(before.arcane.pitchedId).toBe(state.players[0].hand[0]!.instanceId);
    expect(before.arcane.retainedDamage).toBeGreaterThan(5); // Keep Salt; current chain has four hits.
    state.players[0].deck.reverse();
    state.players[1].hand.forEach((card) => { card.cardId = "SFA019"; });
    const after = chooseFaiArcaneDefense(input(state))!;
    expect(after).toEqual(before);
    apply(state, 0, after.intent);
  });
});
