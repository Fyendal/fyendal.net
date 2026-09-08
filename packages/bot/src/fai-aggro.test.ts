import { cardData, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import type { BotPolicyInput } from "./policy.js";
import { faiAggroPresentation } from "./sideboard.js";
import { FaiAggroMemory, faiOnHit, faiAggroStage, faiRole, nextWavePressure, ownDraconicLinks } from "./fai-aggro-model.js";
import { forcedAggroIntent, planFaiRoute, aggroSandbox } from "./fai-aggro-planner.js";
import { chooseFaiAggroDefense } from "./fai-aggro-defense.js";
import { createFaiAggroSession } from "./fai-aggro-policy.js";
import { decodeFaiAggroPolicyState } from "./fai-policy-state.js";

function game(): GameState {
  const deck = { heroId: precon("bot-fai")!.pool.heroId, ...faiAggroPresentation() };
  let state = createGame({ decklists: [deck, deck], cards: cardData, scripts, seed: 101, startPlayer: 1 });
  for (let i = 0; i < 20 && state.pendingDecision; i++) {
    const seat = state.pendingDecision.player as 0 | 1;
    state = apply(state, seat, forcedAggroIntent(input(state, seat)));
  }
  return state;
}
function input(state: GameState, seat: 0 | 1 = 0): BotPolicyInput {
  return { state, seat, cards: cardData, view: projectStateFor(state, seat), legal: legalIntents(state, seat) };
}
function apply(state: GameState, seat: 0 | 1, intent: GameIntent): GameState {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(`${intent.kind}: ${result.error}`);
  return result.state;
}
function hand(state: GameState, ids: string[], seat: 0 | 1 = 0): number[] {
  state.players[seat].hand = ids.map((cardId) => ({ cardId, owner: seat, instanceId: state.nextInstanceId++ }));
  return state.players[seat].hand.map((card) => card.instanceId);
}
function action(turn = 2): GameState {
  const state = game();
  state.turn = turn; state.activePlayer = 0; state.priorityPlayer = 0; state.phase = "action"; state.pendingDecision = null;
  state.players[0].actionPoints = 1;
  state.gameStats.turns = Array.from({ length: turn }, (_, index) => ({
    turn: index + 1, activePlayer: (index + 1) % 2, attacks: [0, 0], threatened: [0, 0],
    blocked: [0, 0], damageDealt: [0, 0],
  }));
  return state;
}
function defending(turn = 1): GameState {
  let state = game();
  state.turn = turn; state.activePlayer = 1; state.priorityPlayer = 1; state.phase = "action"; state.pendingDecision = null;
  state.gameStats.turns = Array.from({ length: turn }, (_, index) => ({
    turn: index + 1, activePlayer: (index + 1) % 2, attacks: [0, 0], threatened: [0, 0],
    blocked: [0, 0], damageDealt: [0, 0],
  }));
  const attack = hand(state, ["SFA023"], 1)[0]!;
  state = apply(state, 1, { kind: "play-card", instanceId: attack, pitchInstanceIds: [] });
  for (let i = 0; i < 20 && state.pendingDecision?.kind !== "defend"; i++) {
    const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    state = apply(state, actor, forcedAggroIntent(input(state, actor)));
  }
  return state;
}

function settle(state: GameState): GameState {
  for (let step = 0; step < 80; step++) {
    if (state.phase === "action" && state.priorityPlayer === 0 && !state.pendingDecision && !state.stack.length) return state;
    const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    state = apply(state, seat, forcedAggroIntent(input(state, seat)));
  }
  throw new Error("action did not settle");
}

function lateHoodState(draconicCount = 3): GameState {
  let state = action(4);
  state.players[0].equipment = { head: state.players[0].equipment.head };
  state.players[0].weapons = [];
  state.players[1].life = 40;
  const rabble = Object.values(cardData).find((card) => card.name === "Ravenous Rabble" && card.pitch === 1)!.id;
  const prefix = hand(state, [rabble, ...Array<string>(draconicCount).fill("SFA023")]);
  for (const id of prefix) state = settle(apply(state, 0, { kind: "play-card", instanceId: id, pitchInstanceIds: [] }));
  state.players[0].graveyard = state.players[0].graveyard.filter((card) => cardData[card.cardId]?.name !== "Phoenix Flame");
  state.players[0].life = 5;
  state.players[1].life = 2;
  state.players[1].hand = state.players[1].hand.slice(0, 3);
  return state;
}

describe("Hood finisher alternatives", () => {
  it("does not empty-burn Hood when the choice opens in a fresh policy session", () => {
    let state = lateHoodState();
    const [flame] = hand(state, ["SFA021", "SFA019"]);
    const hood = input(state).legal.find((intent) => intent.kind === "activate-ability" &&
      intent.sourceInstanceId === state.players[0].equipment.head?.instanceId);
    expect(hood).toBeDefined();
    state = apply(state, 0, hood!);
    for (let step = 0; step < 12 && state.pendingDecision?.promptMessage?.id !== "card.wtr.hood.shuffle"; step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      state = apply(state, actor, forcedAggroIntent(input(state, actor)));
    }
    expect(state.pendingDecision?.promptMessage?.id).toBe("card.wtr.hood.shuffle");
    const fresh = createFaiAggroSession();
    const first = fresh.chooseIntent(input(state));
    expect(first).toEqual({ kind: "choose", optionId: String(flame) });
    state = apply(state, 0, first);
    const finish = createFaiAggroSession().chooseIntent(input(state));
    expect(finish).toEqual({ kind: "choose", optionId: "done" });
    state = apply(state, 0, finish);
    expect(state.players[0].hand).toHaveLength(2);
    expect(projectStateFor(state, 0).logEntries).toContainEqual(expect.objectContaining({
      message: expect.objectContaining({ id: "card.log.wtr.hood.shuffle.draw", values: expect.objectContaining({ amount: 1 }) }),
    }));
  });

  it("washes Salt with Flame when a free arsenal finisher replaces it (20260912)", () => {
    let state = lateHoodState();
    const [salt, flame, anger] = hand(state, ["CRU073", "SFA021", "HNT151"]);
    state.players[0].arsenal = [state.players[0].hand.pop()!];
    expect(ownDraconicLinks(input(state))).toBe(3);
    expect(input(state).legal).toContainEqual(expect.objectContaining({
      kind: "play-from-arsenal", instanceId: anger, pitchInstanceIds: [], pitchRequired: 0,
    }));
    const session = createFaiAggroSession();
    const choice = session.chooseWithTrace(input(state));
    expect(choice.rule).toBe("H-T2-A002/003/004/005");
    expect(choice.plan!.evaluation.damage).toBe(6); // Salt is stronger than the 5-power arsenal ender.
    expect(choice.hood!.instanceIds).toEqual([salt, flame]);
    expect(choice.hood!.instanceIds).not.toContain(anger);
    state = apply(state, 0, choice.intent);
    const returned: number[] = [];
    for (let step = 0; step < 20; step++) {
      if (!state.pendingDecision && !state.stack.length && state.priorityPlayer === 0) break;
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const next = actor === 0 ? session.chooseIntent(input(state)) : forcedAggroIntent(input(state, actor));
      if (next.kind === "choose" && [salt, flame].includes(Number(next.optionId))) returned.push(Number(next.optionId));
      state = apply(state, actor, next);
    }
    expect(returned).toEqual([salt, flame]);
    expect(state.players[0].arsenal[0]?.instanceId).toBe(anger);
  });

  it("keeps the same multi-step Hood route after serialized session restarts", () => {
    const run = (restartAfterEveryDecision: boolean) => {
      let state = lateHoodState();
      const [salt, flame, anger] = hand(state, ["CRU073", "SFA021", "HNT151"]);
      state.players[0].arsenal = [state.players[0].hand.pop()!];
      let session = createFaiAggroSession();
      const ownIntents: GameIntent[] = [];
      const returned: number[] = [];
      const choose = (): GameIntent => {
        const intent = session.chooseIntent(input(state));
        ownIntents.push(intent);
        if (intent.kind === "choose" && [salt, flame].includes(Number(intent.optionId))) {
          returned.push(Number(intent.optionId));
        }
        if (restartAfterEveryDecision) {
          const persisted = JSON.parse(JSON.stringify(session.snapshot())) as unknown;
          const restored = decodeFaiAggroPolicyState(persisted);
          if (!restored) throw new Error("serialized Fai Aggro policy state did not decode");
          session = createFaiAggroSession(restored);
        }
        return intent;
      };

      state = apply(state, 0, choose());
      for (let step = 0; step < 20; step++) {
        if (!state.pendingDecision && !state.stack.length && state.priorityPlayer === 0) break;
        const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
        state = apply(state, actor, actor === 0 ? choose() : forcedAggroIntent(input(state, actor)));
      }
      return {
        ownIntents,
        returned,
        expectedReturned: [salt, flame],
        arsenalId: state.players[0].arsenal[0]?.instanceId,
        expectedArsenalId: anger,
      };
    };

    const restarted = run(true);
    expect(restarted.returned).toEqual(restarted.expectedReturned);
    expect(restarted.arsenalId).toBe(restarted.expectedArsenalId);
    expect(restarted).toEqual(run(false));
  });

  it("keeps the only usable hand ender when arsenal still requires pitch", () => {
    const state = lateHoodState(2);
    const [salt, flame] = hand(state, ["CRU073", "SFA021", "HNT151"]);
    state.players[0].arsenal = [state.players[0].hand.pop()!];
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.rule).toBe("H-T2-A002/003/004/005");
    expect(choice.hood!.instanceIds).toEqual([flame]);
    expect(choice.hood!.instanceIds).not.toContain(salt);
  });

  it("allows either hand ender to be replaced while retaining one usable finisher", () => {
    const state = lateHoodState();
    const [salt, flame, lava] = hand(state, ["CRU073", "SFA021", "SFA019"]);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    const swaps = choice.hood!.instanceIds;
    expect(swaps).toContain(flame);
    expect([salt, lava].filter((id) => swaps.includes(id!))).toHaveLength(1);
    expect(applyIntent(state, 0, choice.intent).ok).toBe(true);
  });

  it("chooses the same finisher swap without using the real deck order or opponent hand", () => {
    const state = lateHoodState();
    hand(state, ["CRU073", "SFA021", "HNT151"]);
    state.players[0].arsenal = [state.players[0].hand.pop()!];
    const before = createFaiAggroSession().chooseWithTrace(input(state));
    state.players[0].deck.reverse();
    state.players[1].hand.forEach((card) => { card.cardId = "SFA019"; });
    const after = createFaiAggroSession().chooseWithTrace(input(state));
    expect(after.hood).toEqual(before.hood);
    expect(after.intent).toEqual(before.intent);
  });
});

describe("Fealty damage and free-Flame supplement", () => {
  it("turns a non-Draconic starter into a real Draconic link and increases route damage", () => {
    let state = action(4); hand(state, ["TCC086", "SFA013", "SFA018"]);
    state.players[0].equipment = {}; state.players[0].weapons = [];
    const fealtyId = state.nextInstanceId++;
    state.players[0].board.push({ instanceId: fealtyId, cardId: "SFA037", owner: 0 });
    const session = createFaiAggroSession();
    const choice = session.chooseWithTrace(input(state));
    expect(choice.intent).toMatchObject({ kind: "activate-ability", sourceInstanceId: fealtyId });
    expect(choice.fealty!.marginalDamage).toBeGreaterThan(0);
    state = settle(apply(state, 0, choice.intent));
    expect(ownDraconicLinks(input(state))).toBe(0); // The token itself is not an attack/link.
    const starter = session.chooseIntent(input(state));
    expect(starter).toMatchObject({ kind: "play-card", instanceId: state.players[0].hand.find((card) => card.cardId === "TCC086")!.instanceId });
    state = settle(apply(state, 0, starter));
    expect(ownDraconicLinks(input(state))).toBe(1);
  });
  it("does not spend Fealty just to recover a Flame that cannot be played or washed after an ender", () => {
    let state = action(4); const ids = hand(state, ["SFA023", "SFA023", "CRU073"]);
    state.players[0].equipment = {}; state.players[0].weapons = [];
    const fealtyId = state.nextInstanceId++;
    state.players[0].board.push({ instanceId: fealtyId, cardId: "SFA037", owner: 0 });
    for (const id of ids.slice(0, 2)) state = settle(apply(state, 0, { kind: "play-card", instanceId: id, pitchInstanceIds: [] }));
    expect(ownDraconicLinks(input(state))).toBe(2);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.intent).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: fealtyId });
    expect(choice.fealty).toBeUndefined();
  });
  it("preserves Fealty when changing the only attack adds neither damage nor a hero return", () => {
    const state = action(4); hand(state, ["TCC086"]);
    state.players[0].equipment = {}; state.players[0].weapons = [];
    const fealtyId = state.nextInstanceId++;
    state.players[0].board.push({ instanceId: fealtyId, cardId: "SFA037", owner: 0 });
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.fealty).toBeUndefined();
    expect(choice.intent).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: fealtyId });
  });
});

describe("Fai second-player hand-wave rules", () => {
  it("uses recorded turn order rather than seat number", () => {
    expect(faiAggroStage(input(game()).view, 0)).toBe("turn0-defense");
    expect(faiAggroStage(input(game(), 1).view, 1)).toBe("first-turn0-attack");
    expect(faiAggroStage(input(action()).view, 0)).toBe("turn1-attack");
    expect(faiAggroStage(input(defending(3)).view, 0)).toBe("turn2-defense");
    expect(faiAggroStage(input(action(4)).view, 0)).toBe("turn2-attack");
    expect(faiAggroStage(input(defending(5)).view, 0)).toBe("later-defense");
  });
  it("values only on-hit damage and three per drawn card", () => {
    expect(faiOnHit([{ sourceCardId: "", text: "test", impact: {
      damage: 1, delayedDamage: 2, drawCards: 1, discardCards: 2, destroysArsenal: true,
    } }])).toEqual({ value: 6, immediateDamage: 1 });
  });
  it("uses 4n including arsenal and does not subtract a possible shield", () => {
    const observed = input(action(4));
    observed.view.players[1].handCount = 2;
    observed.view.players[1].arsenalCount = 1;
    observed.view.players[0].life = 12;
    expect(nextWavePressure(observed.view, 0)).toBe(12);
  });
  it("tracks all starting cards and counts an arsenal play after arsenal empties without imposing a Hood quota", () => {
    const state = action(4);
    hand(state, ["SFA023", "SFA023", "SFA013", "SFA019", "SFA023"]);
    state.players[0].arsenal = [state.players[0].hand.pop()!];
    const id = state.players[0].arsenal[0]!.instanceId;
    const memory = new FaiAggroMemory();
    const before = input(state);
    memory.observe(before);
    const intent: GameIntent = { kind: "play-from-arsenal", instanceId: id, pitchInstanceIds: [] };
    memory.record(before, intent);
    memory.observe(input(apply(state, 0, intent)));
    expect(memory.target).toBe(5);
    expect(memory.conversionTarget(input(apply(state, 0, intent)))).toBe(5);
    expect(memory.playedIds.has(id)).toBe(true);
  });
  it("does not count a newly recovered Flame or generated Tiger as a real hand card", () => {
    const state = action(4);
    hand(state, ["SFA023"]);
    const memory = new FaiAggroMemory(); memory.observe(input(state));
    const flameId = state.nextInstanceId++;
    state.players[0].hand.push({ instanceId: flameId, cardId: "SFA021", owner: 0 });
    memory.observe(input(state));
    expect(memory.realIds.has(flameId)).toBe(false);
  });
  it("counts a real Flame redrawn by Hood, but does not credit shuffling as a play", () => {
    const state = action(4); hand(state, ["SFA023"]);
    const memory = new FaiAggroMemory(); const before = input(state); memory.observe(before);
    before.view.pendingDecision = { player: 0, kind: "choose-target", prompt: "Hope Merchant's Hood: shuffle another card?" };
    memory.record(before, { kind: "choose", optionId: "done" });
    const [id] = hand(state, ["SFA021"]); memory.observe(input(state));
    expect(memory.realIds.has(id!)).toBe(true);
    expect(memory.playedIds.size).toBe(0);
  });
  it("does not count a previously played physical Flame twice after recovering it", () => {
    const state = action(4); const [flame] = hand(state, ["SFA021"]);
    state.players[0].equipment = {}; state.players[0].weapons = [];
    const memory = new FaiAggroMemory(); memory.observe(input(state));
    memory.playedIds.add(flame!); // Same physical Flame has returned to hand.
    expect(memory.conversionTarget(input(state))).toBe(1);
    const plan = planFaiRoute(input(state), { equipment: false, objective: "conversion", memory })!;
    expect(plan.evaluation.converted).toBe(1);
  });
});

describe("Fai legal damage routes", () => {
  // Review cases 20260906/163 and 20260915/304: measure the full line,
  // not the prefix that happens to kill a nonblocking low-life opponent.
  it("retains positive full-hand marginal value when a low-life opponent can block the lone arsenal attack", () => {
    const state = action(6);
    state.players[0].equipment = {}; state.players[0].weapons = [];
    state.players[0].life = 14; state.players[1].life = 1;
    const printing = (name: string) => Object.values(cardData).find((card) => card.name === name && card.pitch === 1)!.id;
    hand(state, [printing("Rising Resentment"), printing("Rising Resentment"),
      printing("Lava Vein Loyalty"), printing("Hot on Their Heels")]);
    state.players[0].arsenal = [{ instanceId: state.nextInstanceId++, owner: 0,
      cardId: printing("Scar for a Scar") }];
    const full = planFaiRoute(input(state), { equipment: false })!;
    state.players[0].hand = [];
    const empty = planFaiRoute(input(state), { equipment: false })!;
    expect(full.evaluation.damage).toBeGreaterThan(empty.evaluation.damage);
  });
  it("starts a legal multi-attack line instead of a no-go-again finisher against a one-life opponent", () => {
    const state = action(12);
    state.players[0].equipment = {}; state.players[0].weapons = [];
    state.players[0].life = 2; state.players[1].life = 1;
    const printing = (name: string) => Object.values(cardData).find((card) => card.name === name && card.pitch === 1)!.id;
    const [growl] = hand(state, [printing("Growl"), printing("March of Loyalty")]);
    const brand = state.nextInstanceId++;
    state.players[0].arsenal = [{ instanceId: brand, owner: 0, cardId: printing("Brand with Cinderclaw") }];
    const choice = createFaiAggroSession().chooseIntent(input(state));
    expect("instanceId" in choice && [growl, brand].includes(choice.instanceId)).toBe(true);
  });
  it("does not credit a retained recovered Flame when Hood swaps other cards", () => {
    const state = action(4); hand(state, ["SFA023"]);
    const memory = new FaiAggroMemory(); memory.observe(input(state));
    const id = state.nextInstanceId++;
    state.players[0].hand.push({ instanceId: id, cardId: "SFA021", owner: 0 });
    const before = input(state);
    before.view.pendingDecision = { player: 0, kind: "choose-target", prompt: "Hope Merchant's Hood: shuffle another card?" };
    memory.record(before, { kind: "choose", optionId: "done" });
    memory.observe(input(state));
    expect(memory.realIds.has(id)).toBe(false);
  });
  it("counts actual combined route damage, including a legal free Fai return", () => {
    const state = action();
    hand(state, ["SFA023", "SFA029", "SFA013", "SFA019"]);
    const plan = planFaiRoute(input(state), { equipment: false, arsenal: false, nodes: 800 });
    expect(plan).toBeDefined();
    expect(plan!.evaluation.damage).toBeGreaterThanOrEqual(13);
    expect(plan!.line.some((intent) => intent.kind === "activate-ability" &&
      intent.sourceInstanceId === state.players[0].hero.instanceId)).toBe(true);
    expect(plan!.line.every((intent) => !("pitchInstanceIds" in intent) || !intent.pitchInstanceIds?.length)).toBe(true);
    const equipment = new Set([...Object.values(state.players[0].equipment), ...state.players[0].weapons]
      .flatMap((card) => card ? [card.instanceId] : []));
    expect(plan!.line.some((intent) => intent.kind === "activate-ability" &&
      equipment.has(intent.sourceInstanceId))).toBe(false);
  });
  it("assigns no invented value to a second unconvertible ender", () => {
    const state = action();
    hand(state, ["SFA023", "SFA019", "SFA019"]);
    const full = planFaiRoute(input(state), { equipment: false, arsenal: false, nodes: 400 })!;
    state.players[0].hand.pop();
    const reduced = planFaiRoute(input(state), { equipment: false, arsenal: false, nodes: 400 })!;
    expect(full.evaluation.damage).toBe(reduced.evaluation.damage);
  });
  it("does not depend on hidden opponent identities or real deck order", () => {
    const state = action(); hand(state, ["SFA023", "SFA029", "SFA013"]);
    const before = planFaiRoute(input(state), { equipment: false, nodes: 160 })!;
    state.players[0].deck.reverse();
    state.players[1].hand.forEach((card) => { card.cardId = "SFA019"; });
    state.players[1].deck.reverse();
    const after = planFaiRoute(input(state), { equipment: false, nodes: 160 })!;
    expect(after.line).toEqual(before.line);
    expect(after.evaluation).toEqual(before.evaluation);
    expect(aggroSandbox(input(state))!.players[1].hand.every((card) => card.cardId === "__fai_rollout_unknown__")).toBe(true);
  });
});

describe("Fai stage-specific defense", () => {
  it("never stages zero-defense Hope Merchant's Hood", () => {
    const state = defending(3); hand(state, []);
    const hood = state.players[0].equipment.head!.instanceId;
    const observed = input(state);
    expect(observed.legal).toContainEqual(expect.objectContaining({
      kind: "stage-defenders",
      instanceIds: [hood],
    }));
    const choice = chooseFaiAggroDefense(observed)!;
    expect("instanceIds" in choice.intent && choice.intent.instanceIds).not.toContain(hood);
    expect(applyIntent(state, 0, choice.intent).ok).toBe(true);
  });
  it("blocks turn0 without armor, spends an ender before the last starter", () => {
    const state = defending(); const [starter, ender] = hand(state, ["SFA023", "SFA019"]);
    const choice = chooseFaiAggroDefense(input(state))!;
    expect(choice).toBeDefined();
    expect(choice.intent).toMatchObject({ kind: "stage-defenders", instanceIds: [ender] });
    expect("instanceIds" in choice.intent && choice.intent.instanceIds.includes(starter!)).toBe(false);
    expect(applyIntent(state, 0, choice.intent).ok).toBe(true);
  });
  it("does not overblock an ordinary four-power turn0 attack", () => {
    const state = defending(); hand(state, ["SFA023", "SFA019", "SFA019"]);
    const observed = input(state); observed.view.chain[0]!.attackValue = 4;
    const choice = chooseFaiAggroDefense(observed)!;
    expect(choice.defense.defense).toBe(3);
  });
  it("uses one armor to bridge turn0 on-hit 3 + 1 instead of two hand cards", () => {
    const state = defending(); hand(state, ["SFA023", "SFA019", "SFA019"]);
    const observed = input(state); observed.view.chain[0]!.attackValue = 4;
    observed.view.chain[0]!.onHitEffects = [{ sourceCardId: "", text: "other on-hit", impact: { createsToken: true } }];
    const choice = chooseFaiAggroDefense(observed)!;
    expect(choice.defense.defense).toBe(4);
    const handIds = state.players[0].hand.map((card) => card.instanceId);
    expect("instanceIds" in choice.intent && choice.intent.instanceIds.filter((id) => handIds.includes(id))).toHaveLength(1);
  });
  it.each([3, 5, 7, 11])("turn %i nonlethal never spends even a redundant ender", (turn) => {
    const state = defending(turn); hand(state, ["SFA023", "SFA019", "SFA019"]);
    const choice = chooseFaiAggroDefense(input(state))!;
    const handIds = state.players[0].hand.map((card) => card.instanceId);
    expect("instanceIds" in choice.intent && choice.intent.instanceIds.some((id) => handIds.includes(id))).toBe(false);
    expect(choice.defense.defense).toBeGreaterThan(0);
  });
  it.each([3, 5, 7])("turn %i lethal uses hand cards if armor cannot save it", (turn) => {
    const state = defending(turn); const [starter, ender] = hand(state, ["SFA023", "SFA019"]);
    state.players[0].equipment = {}; state.players[0].weapons = []; state.players[0].life = 1;
    const choice = chooseFaiAggroDefense(input(state))!;
    expect(choice.intent).toMatchObject({ instanceIds: [ender] });
    expect("instanceIds" in choice.intent && choice.intent.instanceIds.includes(starter!)).toBe(false);
  });
  it.each([3, 5, 9])("turn %i ignores profitable but nonlethal on-hit hand blocks", (turn) => {
    const state = defending(turn); hand(state, ["SFA022", "SFA022", "UPR069", "SFA018"]);
    state.players[0].equipment = {}; state.players[0].weapons = []; state.players[0].life = 14;
    const observed = input(state); observed.view.chain[0]!.attackValue = 4;
    observed.view.chain[0]!.onHitEffects = [{ sourceCardId: "", text: "damage and draw", impact: { damage: 4, drawCards: 3 } }];
    const choice = createFaiAggroSession().chooseWithTrace(observed);
    expect(choice.intent).toEqual({ kind: "defend", instanceIds: [] });
    expect(choice.defense!.onHitValue).toBe(13);
    expect(applyIntent(state, 0, choice.intent).ok).toBe(true);
  });
  it.each([3, 5, 9])("turn %i includes immediate on-hit damage at the exact lethal threshold", (turn) => {
    const state = defending(turn); const [, ender] = hand(state, ["SFA023", "SFA019"]);
    state.players[0].equipment = {}; state.players[0].weapons = []; state.players[0].life = 5;
    const observed = input(state);
    observed.view.chain[0]!.onHitEffects = [{ sourceCardId: "", text: "two damage", impact: { damage: 2 } }];
    const choice = chooseFaiAggroDefense(observed)!;
    expect(choice.intent).toMatchObject({ instanceIds: [ender] });
    expect(applyIntent(state, 0, choice.intent).ok).toBe(true);
  });
  it.each([3, 5, 9])("turn %i keeps hand when armor alone survives even if blocking on-hit pays more", (turn) => {
    const state = defending(turn); const ids = hand(state, ["SFA023", "SFA019", "SFA019"]);
    state.players[0].life = 3;
    const observed = input(state); observed.view.chain[0]!.attackValue = 4;
    observed.view.chain[0]!.onHitEffects = [{ sourceCardId: "", text: "draw three", impact: { drawCards: 3 } }];
    const choice = chooseFaiAggroDefense(observed)!;
    expect("instanceIds" in choice.intent && choice.intent.instanceIds.some((id) => ids.includes(id))).toBe(false);
    expect(choice.defense.defense).toBeGreaterThanOrEqual(2);
    expect(applyIntent(state, 0, choice.intent).ok).toBe(true);
  });
  it("allows the final starter when it is the only remaining blocker", () => {
    const state = defending(); const [starter] = hand(state, ["SFA023"]);
    const choice = chooseFaiAggroDefense(input(state))!;
    expect(choice.intent).toMatchObject({ instanceIds: [starter] });
  });
  it("can overblock turn0 on-hit by two when no one-point armor bridge exists", () => {
    const state = defending(); hand(state, ["SFA023", "SFA019", "SFA019"]);
    state.players[0].equipment = {}; state.players[0].weapons = [];
    const observed = input(state); observed.view.chain[0]!.attackValue = 4;
    observed.view.chain[0]!.onHitEffects = [{ sourceCardId: "", text: "draw", impact: { drawCards: 1 } }];
    const choice = chooseFaiAggroDefense(observed)!;
    expect(choice.defense.defense).toBe(6);
  });
  it("turn0 actually refills after the opponent's turn, then replans the new hand", () => {
    let state = defending(); hand(state, ["SFA023", "SFA019", "SFA019", "SFA013"]);
    const session = createFaiAggroSession();
    const beforeDeck = state.players[0].deck.length;
    for (let steps = 0; steps < 80 && state.turn === 1; steps++) {
      const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const observed = input(state, seat);
      state = apply(state, seat, seat === 0 ? session.chooseIntent(observed) : forcedAggroIntent(observed));
    }
    expect(state.turn).toBe(2);
    expect(state.players[0].hand).toHaveLength(4);
    expect(state.players[0].deck.length).toBeLessThan(beforeDeck);
    expect(faiAggroStage(input(state).view, 0)).toBe("turn1-attack");
  });
});

describe("Fai simulator sessions", () => {
  it("rechecks lethal in the same session after taking a nonlethal hit", () => {
    const session = createFaiAggroSession();
    const state = defending(5); const [, ender] = hand(state, ["SFA023", "SFA019"]);
    state.players[0].equipment = {}; state.players[0].weapons = []; state.players[0].life = 4;
    expect(session.chooseIntent(input(state))).toEqual({ kind: "defend", instanceIds: [] });
    // Next visible defense window has lower life; the previous empty defense
    // must not become a same-turn cached permission to take a lethal attack.
    state.players[0].life = 1;
    const choice = session.chooseIntent(input(state));
    expect(choice).toMatchObject({ kind: "stage-defenders", instanceIds: [ender] });
    expect(applyIntent(state, 0, choice).ok).toBe(true);
  });
  it("reconstructs and commits staged defense in a fresh policy session", () => {
    let state = defending(1); hand(state, ["SFA023", "SFA019", "SFA019"]);
    const session = createFaiAggroSession();
    const selected = session.chooseWithTrace(input(state));
    expect(selected.intent.kind).toBe("stage-defenders");
    state = apply(state, 0, selected.intent);
    const committed = createFaiAggroSession().chooseWithTrace(input(state));
    expect(committed.intent.kind).toBe("defend");
    expect(committed.defense).toEqual(selected.defense);
    expect(applyIntent(state, 0, committed.intent).ok).toBe(true);
  });
  it("classifies Scar as an ender until its life condition is met", () => {
    const state = action(6);
    const scar = Object.values(cardData).find((card) => card.name === "Scar for a Scar" && card.pitch === 1)!.id;
    hand(state, [scar]);
    state.players[0].life = 2; state.players[1].life = 1;
    expect(faiRole(input(state).view.players[0].hand[0]!, input(state))).toBe("ender");
    state.players[0].life = 1; state.players[1].life = 2;
    expect(faiRole(input(state).view.players[0].hand[0]!, input(state))).toBe("starter");
  });
  it("refreshes starter/ender counts from the actual Hood redraw", () => {
    const state = action(); hand(state, ["SFA019", "SFA019"]);
    const memory = new FaiAggroMemory(); const before = input(state); memory.observe(before);
    expect(memory.originalStarters).toBe(0);
    before.view.pendingDecision = { player: 0, kind: "choose-target", prompt: "Hope Merchant's Hood: shuffle another card?" };
    memory.record(before, { kind: "choose", optionId: "done" });
    hand(state, ["SFA023", "SFA029"]); memory.observe(input(state));
    expect(memory.originalStarters).toBe(2);
    expect(memory.originalEnders).toBe(0);
  });
  it("never puts Phoenix Flame in arsenal, including the fallback choice", () => {
    const state = action(); const [flame] = hand(state, ["SFA021"]);
    const observed = input(state);
    observed.view.pendingDecision = { player: 0, kind: "arsenal", prompt: "arsenal" };
    observed.legal = [{ kind: "choose", optionId: String(flame) }, { kind: "choose", optionId: "pass" }];
    expect(createFaiAggroSession().chooseIntent(observed)).toEqual({ kind: "choose", optionId: "pass" });
    const plan = planFaiRoute(input(state), { equipment: false, objective: "turn1" })!;
    expect(plan.evaluation.arsenalId).toBeUndefined();
  });
  it("does not count next-turn draws as stranded hand cards or arsenal candidates", () => {
    const state = action(4); hand(state, []);
    state.players[0].equipment = {}; state.players[0].weapons = [];
    const plan = planFaiRoute(input(state), { equipment: false, objective: "conversion" })!;
    expect(plan.evaluation).toMatchObject({ converted: 0, stranded: 0 });
    expect(plan.evaluation.arsenalId).toBeUndefined();
  });
  it("plays the convertible starter before washing a stalled remainder", () => {
    let state = action(4); const [starter] = hand(state, ["SFA023", "HNT151", "HNT151", "SFA019"]);
    state.players[0].equipment = { head: state.players[0].equipment.head }; state.players[0].weapons = [];
    const session = createFaiAggroSession();
    const first = session.chooseWithTrace(input(state));
    expect(first.intent).toMatchObject({ kind: "play-card", instanceId: starter });
    state = settle(apply(state, 0, first.intent));
    const stalled = session.chooseWithTrace(input(state));
    expect(stalled.intent).toMatchObject({ kind: "activate-ability", sourceInstanceId: state.players[0].equipment.head!.instanceId });
    expect(stalled.hood).toBeDefined();
  }, 20_000);
  it("preserves played-card accounting across a serialized restart before Hood", () => {
    const run = (restartAfterStarter: boolean) => {
      let state = action(4);
      const [starter] = hand(state, ["SFA023", "HNT151", "HNT151", "SFA019"]);
      state.players[0].equipment = { head: state.players[0].equipment.head };
      state.players[0].weapons = [];
      let session = createFaiAggroSession();
      const first = session.chooseWithTrace(input(state));
      expect(first.intent).toMatchObject({ kind: "play-card", instanceId: starter });
      if (restartAfterStarter) {
        const persisted = JSON.parse(JSON.stringify(session.snapshot())) as unknown;
        const restored = decodeFaiAggroPolicyState(persisted);
        if (!restored) throw new Error("serialized Fai Aggro policy state did not decode");
        session = createFaiAggroSession(restored);
      }
      state = settle(apply(state, 0, first.intent));
      const second = session.chooseWithTrace(input(state));
      return {
        first: first.intent,
        second: second.intent,
        secondRule: second.rule,
        playedIds: session.snapshot().memory.playedIds,
      };
    };

    const restarted = run(true);
    expect(restarted.secondRule).toBe("H-T1-005/H-T2-A006");
    expect(restarted.playedIds).toHaveLength(1);
    expect(restarted).toEqual(run(false));
  }, 20_000);
  it("does not open Hood at the start of the review-B hand before using its equipment and attacks", () => {
    const state = action(4);
    const printing = (name: string) => Object.values(cardData).find((card) => card.name === name && card.pitch === 1)!.id;
    hand(state, [printing("March of Loyalty"), printing("Compounding Anger"), printing("Ravenous Rabble"), printing("Lava Vein Loyalty")]);
    // Historical snapshot compatibility; the new policy itself cannot store Flame.
    state.players[0].arsenal = [{ instanceId: state.nextInstanceId++, owner: 0, cardId: "SFA021" }];
    state.players[0].life = 6; state.players[1].life = 8;
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.intent).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: state.players[0].equipment.head!.instanceId });
    expect(choice.plan!.evaluation.damage).toBeGreaterThan(12);
  });
  it("plays Flame and reserves an unplayable card without Hood when there is no pressure or waste", () => {
    const state = action(4); const [flame] = hand(state, ["SFA021", "SFA019", "HNT151"]);
    state.players[0].equipment = { head: state.players[0].equipment.head }; state.players[0].weapons = [];
    state.players[0].life = 12; state.players[1].hand = state.players[1].hand.slice(0, 2);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.hood).toBeUndefined();
    expect(choice.intent).toMatchObject({ kind: "play-card", instanceId: flame });
    expect(choice.plan!.evaluation.stranded).toBe(0);
  });
  it("can wash Flame together with an unconvertible non-ender when the pressure window arrives", () => {
    let state = action(4); const ids = hand(state, ["SFA023", "SFA023"]);
    state.players[0].equipment = { head: state.players[0].equipment.head }; state.players[0].weapons = [];
    for (const id of ids) state = settle(apply(state, 0, { kind: "play-card", instanceId: id, pitchInstanceIds: [] }));
    const rise = Object.values(cardData).find((card) => card.name === "Rise from the Ashes" && card.pitch === 1)!.id;
    const [flame, unplayable] = hand(state, ["SFA021", rise, "SFA019"]);
    state.players[0].life = 12; state.players[1].hand = state.players[1].hand.slice(0, 3);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.rule).toBe("H-T2-A002/003/004/005");
    expect(choice.hood!.instanceIds).toEqual(expect.arrayContaining([flame, unplayable]));
  }, 20_000);
  it("routes the first player through preparation instead of the v1 fallback", () => {
    const state = game();
    const session = createFaiAggroSession();
    const observed = input(state, 1);
    expect(session.chooseWithTrace(observed).rule).toBe("F-T0-001/002");
  });
  it("prefers a starter arsenal after converting three cards on turn1", () => {
    const state = action(); hand(state, ["SFA023", "SFA029", "SFA013", "SFA019"]);
    const observed = input(state); const memory = new FaiAggroMemory(); memory.observe(observed);
    const plan = planFaiRoute(observed, { equipment: false, objective: "turn1", memory, nodes: 800 })!;
    const reserved = state.players[0].hand.find((card) => card.instanceId === plan.evaluation.arsenalId);
    expect(plan.evaluation.converted).toBeGreaterThanOrEqual(3);
    expect(["SFA023", "SFA029"]).toContain(reserved?.cardId);
    expect(plan.evaluation.stranded).toBe(0);
  });
  it("preserves Fealty and stores a non-Draconic starter when the other three work", () => {
    const state = action(); hand(state, ["SFA023", "TCC086", "SFA018", "SFA019"]);
    state.players[0].board.push({ instanceId: state.nextInstanceId++, cardId: "SFA037", owner: 0 });
    const observed = input(state); const memory = new FaiAggroMemory(); memory.observe(observed);
    const plan = planFaiRoute(observed, { equipment: false, objective: "turn1", memory, nodes: 500 })!;
    expect(state.players[0].hand.find((card) => card.instanceId === plan.evaluation.arsenalId)?.cardId).toBe("TCC086");
    expect(plan.evaluation.retainedFealty).toBeGreaterThan(0);
  });
  it("does not reserve the only starter on turn1", () => {
    const state = action(); const [starter] = hand(state, ["SFA023", "SFA018", "SFA019", "SFA019"]);
    const observed = input(state); const memory = new FaiAggroMemory(); memory.observe(observed);
    const plan = planFaiRoute(observed, { equipment: false, objective: "turn1", memory, nodes: 500 })!;
    expect(plan.line.some((intent) => intent.kind === "play-card" && intent.instanceId === starter)).toBe(true);
    expect(plan.evaluation.arsenalId).not.toBe(starter);
  });
  it("uses Tiger/weapon rescue only when three real cards can be played", () => {
    const state = action(); hand(state, ["SFA011", "SFA018", "SFA013", "HNT151"]);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.rule).toBe("H-T1-004");
    expect(choice.plan!.evaluation.converted).toBeGreaterThanOrEqual(3);
    expect(applyIntent(state, 0, choice.intent).ok).toBe(true);
  });
  it("uses Hood before spending Tiger when the components cannot convert three enders", () => {
    const state = action(); hand(state, ["HNT151", "HNT151", "SFA019", "CRU073"]);
    const before = JSON.stringify(state);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.rule).toBe("H-T1-005/H-T2-A006");
    expect(choice.hood?.method).toBe("deterministic-sampling");
    expect(choice.hood!.instanceIds.length).toBeGreaterThan(0);
    expect(choice.intent).toMatchObject({ kind: "activate-ability", sourceInstanceId: state.players[0].equipment.head!.instanceId });
    expect(JSON.stringify(state)).toBe(before);
  }, 20_000);
  it.each([2, 3])("checks the latest public hand count (%i) before late Flame Hood", (opponentCards) => {
    const state = action(4); hand(state, ["SFA021", "SFA019"]);
    state.players[0].equipment = { head: state.players[0].equipment.head };
    state.players[0].weapons = []; state.players[0].life = 12;
    state.players[1].hand = state.players[1].hand.slice(0, opponentCards);
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.rule === "H-T2-A002/003/004/005").toBe(opponentCards === 3);
    expect(applyIntent(state, 0, choice.intent).ok).toBe(true);
  });
  it("targets the opponent for Art of the Dragon, not itself", () => {
    const observed = input(action());
    observed.view.pendingDecision = { player: 0, kind: "choose-target", prompt: "Art of the Dragon: Fire — deal 2 damage to any target" };
    observed.legal = [0, 1].map((seat) => ({ kind: "choose", optionId: String(observed.view.players[seat]!.heroInstanceId) }));
    expect(forcedAggroIntent(observed)).toEqual(observed.legal[1]);
  });
  it("uses a free Rise return instead of declining it", () => {
    const observed = input(action()); const flame = observed.view.players[0].graveyard.find((card) => card.cardId === "SFA021")!;
    observed.view.pendingDecision = { player: 0, kind: "choose-target", prompt: "Rise from the Ashes: return a Phoenix Flame from your graveyard to your hand?" };
    observed.legal = [{ kind: "choose", optionId: "pass" }, { kind: "choose", optionId: String(flame.instanceId) }];
    expect(forcedAggroIntent(observed)).toEqual(observed.legal[1]);
  });
  it("does not open an early Hood rescue after losing the final action point", () => {
    const state = action(4); hand(state, ["HNT151", "HNT151", "SFA019", "CRU073"]);
    state.players[0].actionPoints = 0;
    const choice = createFaiAggroSession().chooseWithTrace(input(state));
    expect(choice.hood).toBeUndefined();
    expect(choice.intent).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: state.players[0].equipment.head!.instanceId });
  });
});
