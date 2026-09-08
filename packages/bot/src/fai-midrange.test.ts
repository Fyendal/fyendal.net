import { cardData, precon, scripts, validatePresentation } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import type { BotPolicyInput } from "./policy.js";
import { faiMidrangePresentation } from "./sideboard.js";
import { createFaiMidrangeSession } from "./fai-midrange-policy.js";
import { decodeFaiMidrangePolicyState } from "./fai-policy-state.js";
import { midAllowed, midForced, resourceOrigin, tigerFloating, type MidLimits } from "./fai-midrange-model.js";
import { MIDRANGE_DEFENSE_SEARCH_NODES, midBudget, planMidrange } from "./fai-midrange-planner.js";
import { chooseMidrangeDefense, midReply } from "./fai-midrange-defense.js";
function input(state: GameState, seat: 0 | 1 = 0): BotPolicyInput {
 return { state, seat, cards: cardData, view: projectStateFor(state, seat), legal: legalIntents(state, seat), knownOwnDeck: faiMidrangePresentation().deck };
}
function apply(state: GameState, seat: 0 | 1, intent: GameIntent): GameState {
 const result = applyIntent(state, seat, intent); if (!result.ok) throw new Error(`${JSON.stringify(intent)}: ${result.error}`); return result.state;
}
function hand(state: GameState, ids: string[], seat: 0 | 1 = 0): number[] {
 state.players[seat].hand = ids.map((cardId) => ({ cardId, owner: seat, instanceId: state.nextInstanceId++ })); return state.players[seat].hand.map((card) => card.instanceId);
}
function action(turn = 2): GameState {
 const deck = { heroId: precon("bot-fai")!.pool.heroId, ...faiMidrangePresentation() };
 let state = createGame({ decklists: [deck, deck], cards: cardData, scripts, seed: 101, startPlayer: 0 });
 for (let i = 0; i < 20 && state.pendingDecision; i++) { const actor = state.pendingDecision.player as 0 | 1; state = apply(state, actor, midForced(input(state, actor))); }
 state.turn = turn; state.activePlayer = 0; state.priorityPlayer = 0; state.phase = "action"; state.pendingDecision = null; state.players[0].actionPoints = 1;
 state.gameStats.turns = Array.from({ length: turn }, (_, index) => ({ turn: index + 1, activePlayer: index % 2, attacks: [0, 0], threatened: [0, 0], blocked: [0, 0], damageDealt: [0, 0] })); return state;
}
function settle(state: GameState): GameState {
 for (let i = 0; i < 80; i++) { if (state.phase === "action" && state.priorityPlayer === 0 && !state.pendingDecision && !state.stack.length) return state; const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1; state = apply(state, actor, midForced(input(state, actor))); } throw new Error("did not settle");
}
function limits(state: GameState): MidLimits { return { opening: false, closing: false, tools: true, paidAnger: false, origin: resourceOrigin(input(state)) }; }
describe("Midrange reviewed policy", () => {
 it("uses the legal 40-card Helm / two Fire / two Potion presentation", () => {
  const deck = faiMidrangePresentation(); expect(validatePresentation(precon("bot-fai")!.pool, deck, "silver-age").ok).toBe(true); expect(deck.deck).toHaveLength(40); expect(deck.deck.filter((id) => id === "SFA016")).toHaveLength(2); expect(deck.deck.filter((id) => id === "SFA035")).toHaveLength(2); expect(deck.weaponIds).toEqual(["SFA002"]); expect(deck.equipment.head).toBe("SBA004");
 });
 it("rejects red pitches and expensive Fai", () => {
  const state = action(); const [red] = hand(state, ["SFA023"]); expect(midAllowed({ kind: "activate-ability", sourceInstanceId: state.players[0].weapons[0]!.instanceId, pitchInstanceIds: [red!] }, input(state), limits(state))).toBe(false); expect(midAllowed({ kind: "activate-ability", sourceInstanceId: input(state).view.players[0].heroInstanceId, pitchInstanceIds: [] }, input(state), limits(state))).toBe(false);
 });
 it("excludes fresh Tiger money from Anger even with the waste exception", () => {
  let state = action(); const tigerId = Object.values(cardData).find((c) => c.name === "Crouching Tiger")!.id; const prefix = hand(state, [tigerId, "SFA023", "SFA023"]); for (const id of prefix) state = settle(apply(state, 0, { kind: "play-card", instanceId: id, pitchInstanceIds: [] }));
  const [anger] = hand(state, ["HNT151"]); const bound = limits(state); const chest = input(state).legal.find((x) => x.kind === "activate-ability" && x.sourceInstanceId === state.players[0].equipment.chest!.instanceId)!; state = settle(apply(state, 0, chest));
  expect(tigerFloating(input(state), bound.origin)).toBe(1); expect(midAllowed({ kind: "play-card", instanceId: anger!, pitchInstanceIds: [] }, input(state), { ...bound, paidAnger: true })).toBe(false);
 });
 it("deploys Potion and keeps an opening reserve", () => {
  const state = action(1); const [potion] = hand(state, ["SFA035", "SFA023", "SFA019", "SFA021"]); const plan = planMidrange(input(state)); expect(plan?.line).toContainEqual(expect.objectContaining({ kind: "play-card", instanceId: potion })); expect(plan?.evaluation.potionDeployed).toBe(true); expect(plan?.evaluation.arsenalId).toBeDefined();
 });
 it("reserves a card before maximizing opening attacks without Potion", () => {
  const state = action(1); const ids = hand(state, ["SFA023", "SFA023"]); const plan = planMidrange(input(state)); expect(plan?.evaluation.arsenalId).toBeDefined(); expect(plan?.line.filter((x) => x.kind === "play-card" && ids.includes(x.instanceId))).toHaveLength(1);
 });
 it("always stores the least costly card on the opening turn", () => {
  const state = action(1); const [, , enflame] = hand(state, ["SFA012", "SFA018", "SFA014", "SFA030"]); const plan = planMidrange(input(state)); expect(plan?.evaluation.arsenalId).toBe(enflame);
 });
 it("keeps an opening reserve for the reported all-starter hand", () => {
  const state = action(1); const ids = hand(state, ["SFA022", "SFA015", "SFA023", "SFA024"]); const plan = planMidrange(input(state)); expect(plan?.evaluation.arsenalId).toBeDefined(); expect(ids).toContain(plan?.evaluation.arsenalId);
 });
 it("never arsenals Flame", () => {
  let state = action(); hand(state, ["SFA021"]); state.players[0].actionPoints = 0; const session = createFaiMidrangeSession();
  for (let i = 0; i < 20 && state.turn === 2; i++) { const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1; state = apply(state, actor, actor === 0 ? session.chooseIntent(input(state)) : midForced(input(state, actor))); } expect(state.players[0].arsenal).toHaveLength(0);
 });
 it("ignores real deck order and hidden opposing cards", () => {
  const state = action(); hand(state, ["SFA023", "SFA019", "HNT151", "SFA035"]); const before = createFaiMidrangeSession().chooseWithTrace(input(state)); state.players[0].deck.reverse(); state.players[1].hand.forEach((x) => { x.cardId = "SFA019"; }); const after = createFaiMidrangeSession().chooseWithTrace(input(state)); expect(after.intent).toEqual(before.intent); expect(after.plan?.evaluation).toEqual(before.plan?.evaluation);
 });
});

function defendWith(ids: string[], attackCard = "SFA023", life = 20): GameState {
 let state = action(3); hand(state, ids); state.players[0].equipment = {}; state.players[0].weapons = []; state.players[0].life = life;
 state.activePlayer = 1; state.priorityPlayer = 1;
 const [attack] = hand(state, [attackCard], 1); state.players[1].resources = 10; state.players[1].actionPoints = 1;
 state = apply(state, 1, { kind: "play-card", instanceId: attack!, pitchInstanceIds: [] });
 for (let i = 0; i < 40 && state.pendingDecision?.kind !== "defend"; i++) { const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1; state = apply(state, actor, midForced(input(state, actor))); }
 return state;
}
describe("Midrange retained-hand decisions and Fire", () => {
 it("does not treat a partial retained-hand plan as a complete defense reply", () => {
  const state = defendWith(["SFA023", "SFA023", "SFA019", "SFA019"]);
  const committed = apply(state, 0, { kind: "defend", instanceIds: [] });
  const reply = midReply(input(committed), { nodes: 1, transitions: 1_000 });
  expect(reply.plan).toBeDefined();
  expect(reply.plan?.evaluation.complete).toBe(false);
  expect(reply.complete).toBe(false);
 });
 it("protects a spare finisher that can be arsenaled", () => {
  const state = defendWith(["SFA023", "SFA023", "SFA019", "SFA019"]);
  state.players[0].arsenal = [{cardId: "SFA023", owner: 0, instanceId: state.nextInstanceId++}];
  const choice = chooseMidrangeDefense(input(state));
  expect(choice?.defense.complete).toBe(true);
  expect(choice?.defense.protectedId).toBeDefined();
  expect(choice?.defense.handIds).not.toContain(choice?.defense.protectedId);
  expect(choice?.defense.handIds).toHaveLength(0);
 });
 it("blocks with a surplus finisher when more cards remain than arsenal can hold", () => {
  const state = defendWith(["SFA023", "SFA019", "SFA019", "SFA019"]);
  const choice = chooseMidrangeDefense(input(state));
  expect(choice?.defense.complete).toBe(true);
  expect(choice?.defense.handIds).toHaveLength(1);
 });
 it("reconstructs and commits staged defense in a fresh policy session", () => {
  let state = defendWith(["SFA023", "SFA019"], "SFA023", 1);
  const selected = createFaiMidrangeSession().chooseWithTrace(input(state));
  expect(selected.intent.kind).toBe("stage-defenders");
  state = apply(state, 0, selected.intent);
  const committed = createFaiMidrangeSession().chooseWithTrace(input(state));
  expect(committed.intent).toMatchObject({
   kind: "defend",
   instanceIds: selected.defense?.handIds,
  });
  expect(applyIntent(state, 0, committed.intent).ok).toBe(true);
 });
 it("overrides reserve protection to survive", () => {
  const state = defendWith(["SFA019", "SFA019"], "SFA023", 1);
  const choice = chooseMidrangeDefense(input(state));
  expect(choice?.defense.handIds.length).toBeGreaterThan(0);
  expect(choice?.defense.lifeAfter).toBeGreaterThan(0);
 });
 it("values a usable Salt at 3.5 during defense and dynamically on the active turn", () => {
  let state = action(); const prefix = hand(state, ["SFA023", "SFA023", "SFA023"]);
  state.players[0].equipment = {}; state.players[0].weapons = [];
  for (const id of prefix) state = settle(apply(state, 0, { kind: "play-card", instanceId: id, pitchInstanceIds: [] }));
  hand(state, ["CRU073"]); state.players[0].graveyard = [];
  expect(planMidrange(input(state), { defensive: true, reserveBranches: false })?.evaluation.damage).toBe(3.5);
  expect(planMidrange(input(state), { reserveBranches: false })?.evaluation.damage).toBe(5);
 });
 it("responds to the third Draconic Fire link with free Fai, then discards Flame and replans the draw", () => {
  let state = action(); state.players[0].equipment = {}; state.players[0].weapons = [];
  const prefix = hand(state, ["SFA023", "SFA023"]);
  for (const id of prefix) state = settle(apply(state, 0, { kind: "play-card", instanceId: id, pitchInstanceIds: [] }));
  const [fire] = hand(state, ["SFA016", "SFA019"]); state.players[0].resources = 1;
  const session = createFaiMidrangeSession();
  const first = session.chooseWithTrace(input(state));
  expect(first.intent).toMatchObject({ kind: "play-card", instanceId: fire });
  expect(first.plan?.evaluation.damage).toBe(9); // Fire 4 + known Lava Burst 5; unknown draw has no score.
  expect(first.plan?.evaluation.fireDraw).toBe(true);
  expect(first.plan?.evaluation.complete).toBe(false);
  state = apply(state, 0, first.intent);
  let recovered = false; let discarded = false;
  for (let step = 0; step < 40; step++) {
   const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
   const next = actor === 0 ? session.chooseIntent(input(state)) : midForced(input(state, actor));
   if (actor === 0 && next.kind === "activate-ability" && next.sourceInstanceId === input(state).view.players[0].heroInstanceId) recovered = true;
   if (/Fire that Burns Within/i.test(state.pendingDecision?.prompt ?? "") && next.kind === "choose" && next.optionId !== "pass") discarded = true;
   state = apply(state, actor, next);
   if (discarded) break;
  }
  expect(recovered).toBe(true); expect(discarded).toBe(true);
 });
});

describe("Midrange resource and disruption boundaries", () => {
 it("bounds a wide Cartilage Crush defense search without changing the reviewed block", () => {
  const crush = Object.values(cardData).find((card) => card.name === "Cartilage Crush")!.id;
  const state = action(5);
  hand(state, ["TCC086", "HNT084", "HNT084", "SFA019"]);
  state.players[0].arsenal = [{cardId:"SFA016",owner:0,instanceId:state.nextInstanceId++}];
  state.activePlayer = 1; state.priorityPlayer = 1;
  const [attack] = hand(state, [crush], 1); state.players[1].resources = 10; state.players[1].actionPoints = 1;
  let defending = apply(state, 1, {kind:"play-card",instanceId:attack!,pitchInstanceIds:[]});
  for (let step = 0; step < 40 && defending.pendingDecision?.kind !== "defend"; step++) {
   const actor = (defending.pendingDecision?.player ?? defending.priorityPlayer) as 0 | 1;
   defending = apply(defending, actor, midForced(input(defending, actor)));
  }
  const decision = createFaiMidrangeSession().chooseWithTrace(input(defending));
  const reviewed = chooseMidrangeDefense(input(defending), midBudget());
  expect(decision.rule).toBe("MID-defend-marginal-reserve");
  expect(decision.search.nodes).toBeLessThanOrEqual(MIDRANGE_DEFENSE_SEARCH_NODES);
  expect(decision.intent).toEqual(reviewed?.intent);
  expect(decision.defense).toMatchObject({ incoming: 7, complete: true });
 }, 15_000);

 it("uses one blue for Emberblade plus one-resource Fai", () => {
  const state = action(); state.players[0].equipment = {}; hand(state, ["SFA023", "SFA035", "SFA019"]);
  const plan = planMidrange(input(state));
  expect(plan?.evaluation.damage).toBe(12);
  expect(plan?.line.filter((x) => x.kind === "activate-ability")).toEqual(expect.arrayContaining([
   expect.objectContaining({sourceInstanceId: state.players[0].weapons[0]!.instanceId}),
   expect.objectContaining({sourceInstanceId: input(state).view.players[0].heroInstanceId}),
  ]));
 });
 it("allows leftover resources for Anger but no dedicated pitch without waste", () => {
  let state = action(); const prefix = hand(state, ["SFA023", "SFA023"]);
  for (const id of prefix) state = settle(apply(state, 0, {kind:"play-card",instanceId:id,pitchInstanceIds:[]}));
  const [anger, blue] = hand(state, ["HNT151", "SFA035"]); state.players[0].resources = 1;
  expect(midAllowed({kind:"play-card", instanceId:anger!,pitchInstanceIds:[]}, input(state), limits(state))).toBe(true);
  expect(midAllowed({kind:"play-card", instanceId:anger!,pitchInstanceIds:[blue!]}, input(state), limits(state))).toBe(false);
 });
 it("deploys a Potion when no finisher can be used and does not consume it without an outlet", () => {
  const state = action(); state.players[0].equipment = {}; state.players[0].weapons = []; hand(state, ["SFA023", "SFA035"]);
  const plan = planMidrange(input(state)); expect(plan?.evaluation.potionDeployed).toBe(true); expect(plan?.evaluation.damage).toBe(3);
  expect(plan?.line.some((x) => x.kind === "activate-ability")).toBe(false);
 });
 it("continues with Blaze after Rise / Flame / close-chain", () => {
  let state = action(); state.players[0].equipment = {}; state.players[0].weapons = [];
  const riseId = Object.values(cardData).find((c) => c.name === "Rise from the Ashes" && c.pitch === 1)!.id;
  const blazeId = Object.values(cardData).find((c) => c.name === "Blaze Headlong" && c.pitch === 1)!.id;
  const [rise, blaze] = hand(state, [riseId, blazeId]);
  state = settle(apply(state, 0, {kind:"play-card",instanceId:rise!,pitchInstanceIds:[]}));
  const flame = state.players[0].hand.find((x) => cardData[x.cardId]?.name === "Phoenix Flame")!;
  state = settle(apply(state, 0, {kind:"play-card",instanceId:flame.instanceId,pitchInstanceIds:[]}));
  state = apply(state, 0, {kind:"close-chain"});
  const plan = planMidrange(input(state)); expect(plan?.intent).toMatchObject({kind:"play-card",instanceId:blaze}); expect(plan?.evaluation.damage).toBe(4);
  expect(state.players[0].graveyard.some((x) => x.instanceId === flame.instanceId)).toBe(true);
 });
 it("accounts for the public Crippling Crush discard instead of treating it as plain damage", () => {
  const crush = Object.values(cardData).find((c) => c.name === "Crippling Crush")!.id;
  const state = defendWith(["SFA023", "SFA023", "SFA023", "SFA019"], crush);
  const noBlock = midReply(input(apply(state,0,{kind:"defend",instanceIds:[]})));
  const choice = chooseMidrangeDefense(input(state));
  expect(noBlock.complete).toBe(true); expect(noBlock.plan?.evaluation.damage).toBeLessThan(15);
  expect(choice?.defense.complete).toBe(true); expect(choice?.defense.netValue).toBeGreaterThanOrEqual(noBlock.life + (noBlock.plan?.evaluation.damage ?? 0));
 });
});

describe("Midrange equipment gates", () => {
 it("saves Tiger equipment without Fire when the opponent is above two life", () => {
  const state = action(); hand(state, ["SFA023", "SFA023", "SFA019"]);
  const plan = planMidrange(input(state)); expect(plan?.evaluation.equipmentUsed).toBe(0);
 });
 it("can use Tiger equipment to fund Fire without pitching red", () => {
  const state = action(); hand(state, ["SFA016", "SFA023", "SFA023", "SFA019"]);
  const plan = planMidrange(input(state));
  expect(plan?.evaluation.fireDraw).toBe(true);
  expect(plan?.evaluation.equipmentUsed).toBeGreaterThan(0);
  expect(plan?.line.every((x) => !("pitchInstanceIds" in x) || !x.pitchInstanceIds?.length)).toBe(true);
 });
});


it("keeps a deployed Potion across fresh decisions when no resources can be used (20260906)", () => {
 let state = action(); state.players[0].equipment = {}; state.players[0].weapons = []; hand(state, ["SFA035"]);
 const session = createFaiMidrangeSession();
 state = settle(apply(state, 0, session.chooseIntent(input(state))));
 expect(state.players[0].board.some((x) => x.cardId === "SFA035")).toBe(true);
 expect(session.chooseIntent(input(state)).kind).toBe("pass");
 state.players[0].actionPoints = 1;
 expect(createFaiMidrangeSession().chooseIntent(input(state)).kind).toBe("pass");
});

it("continues the same equipment-supported Fire route after serialized restarts", () => {
 const run = (restartAfterEveryDecision: boolean): GameIntent[] => {
  let state = action(13);
  const [fire] = hand(state, ["SFA016"]);
  state.players[0].board.push({
   cardId: "SFA035",
   owner: 0,
   instanceId: state.nextInstanceId++,
  });
  state.players[1].life = 5;
  const armsInstanceId = state.players[0].equipment.arms!.instanceId;
  let session = createFaiMidrangeSession();
  const ownIntents: GameIntent[] = [];
  let played = false;
  for (let step = 0; step < 120 && state.turn === 13 && state.winner === null; step++) {
   const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
   const intent = actor === 0
    ? session.chooseIntent(input(state))
    : midForced(input(state, actor));
   if (actor === 0) {
    ownIntents.push(intent);
    if (intent.kind === "play-card" && intent.instanceId === fire) played = true;
    if (restartAfterEveryDecision) {
     const persisted = JSON.parse(JSON.stringify(session.snapshot())) as unknown;
     const restored = decodeFaiMidrangePolicyState(persisted);
     if (!restored) throw new Error("serialized Fai policy state did not decode");
     session = createFaiMidrangeSession(restored);
    }
   }
   state = apply(state, actor, intent);
  }
  expect(ownIntents[0]).toMatchObject({
   kind: "activate-ability",
   sourceInstanceId: armsInstanceId,
  });
  expect(played).toBe(true);
  return ownIntents;
 };

 expect(run(true)).toEqual(run(false));
});

it("reconsiders a reserved Fire after the actual draw supplies blue payment", () => {
 let state = action(); state.players[0].equipment = {}; state.players[0].weapons = [];
 const prefix = hand(state, ["SFA023", "SFA023"]);
 for (const id of prefix) state = settle(apply(state, 0, {kind:"play-card",instanceId:id,pitchInstanceIds:[]}));
 const fires = hand(state, ["SFA016", "SFA016", "SFA019"]).slice(0,2); state.players[0].resources = 1;
 state.players[0].deck.unshift({cardId:"SFA035",owner:0,instanceId:state.nextInstanceId++});
 const session = createFaiMidrangeSession(); const first = session.chooseWithTrace(input(state));
 expect(first.plan?.evaluation.fireDraw).toBe(true);
 expect(first.plan?.evaluation.arsenalId).toBeDefined();
 const reserved = first.plan!.evaluation.arsenalId!;
 expect(fires).toContain(reserved);
 state = settle(apply(state,0,first.intent));
 expect(state.players[0].hand.some((card) => card.cardId === "SFA035")).toBe(true);
 expect(session.chooseIntent(input(state))).toMatchObject({kind:"play-card",instanceId:reserved});
});

it("preserves Fealty before an already Draconic Enflame route", () => {
 let state = action(); state.players[0].equipment = {};
 const prefix = hand(state, ["SFA016", "SFA013"]); state.players[0].resources = 3;
 state = settle(apply(state, 0, {kind:"play-card",instanceId:prefix[0]!,pitchInstanceIds:[]}));
 state = settle(apply(state, 0, {kind:"activate-ability",sourceInstanceId:state.players[0].weapons[0]!.instanceId,pitchInstanceIds:[]}));
 state = settle(apply(state, 0, {kind:"play-card",instanceId:prefix[1]!,pitchInstanceIds:[]}));
 hand(state, ["CRU073", "SFA014"]); state.players[0].arsenal = [state.players[0].hand.pop()!];
 const fealty = state.players[0].board.find((card) => card.cardId === "SFA037")!;
 expect(fealty).toBeDefined();
 const plan = planMidrange(input(state));
 expect(plan?.line).not.toContainEqual(expect.objectContaining({kind:"activate-ability",sourceInstanceId:fealty.instanceId}));
});

it("still uses Fealty on a non-Draconic attack to unlock a free Flame", () => {
 let state = action(); state.players[0].equipment = {}; state.players[0].weapons = [];
 const prefix = hand(state, ["SFA023", "SFA023"]);
 for (const id of prefix) state = settle(apply(state, 0, {kind:"play-card",instanceId:id,pitchInstanceIds:[]}));
 const rabble = Object.values(cardData).find((card) => card.name === "Ravenous Rabble" && card.pitch === 1)!.id;
 hand(state, [rabble, "SFA019"]);
 const token = {cardId:"SFA037", owner:0,instanceId:state.nextInstanceId++}; state.players[0].board.push(token);
 const plan = planMidrange(input(state));
 const preserved = planMidrange(input(state), {preserveFealty:true});
 expect(plan?.evaluation.damage).toBeGreaterThan(preserved!.evaluation.damage);
 expect(plan?.intent).toMatchObject({kind:"activate-ability",sourceInstanceId:token.instanceId});
});

function ordinaryFireHand(ids: string[]): GameState {
 const state = action(); state.players[0].equipment = {}; state.players[0].weapons = [];
 state.players[0].graveyard = []; state.players[0].resources = 1; hand(state, ids); return state;
}
describe("weak Fire arsenal preference", () => {
 it("keeps the Fire route after committing Tiger equipment to support it", () => {
  let state = action(13); const [fire] = hand(state, ["SFA016"]);
  state.players[0].board.push({cardId:"SFA035",owner:0,instanceId:state.nextInstanceId++});
  state.players[1].life = 5;
  const session = createFaiMidrangeSession();
  const first = session.chooseIntent(input(state));
  expect(first).toMatchObject({kind:"activate-ability",sourceInstanceId:state.players[0].equipment.arms!.instanceId});
  state = apply(state,0,first);
  let played = false;
  for (let step = 0; step < 120 && state.turn === 13 && state.winner === null; step++) {
   const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
   const intent = actor === 0 ? session.chooseIntent(input(state)) : midForced(input(state,actor));
   if (actor === 0 && intent.kind === "play-card" && intent.instanceId === fire) played = true;
   state = apply(state,actor,intent);
  }
 expect(played).toBe(true);
 });
 it("keeps a second weak Fire eligible after equipment support commits to the first", () => {
  const state = ordinaryFireHand(["SFA023", "SFA016", "SFA016", "SFA019"]);
  const fires = state.players[0].hand.filter((card) => card.cardId === "SFA016");
  const plan = planMidrange(input(state), {
   supportedFireIds: new Set([fires[0]!.instanceId]),
  });
  expect(plan?.evaluation.weakFireReserve?.instanceId).toBe(fires[1]!.instanceId);
  expect(plan?.evaluation.arsenalId).toBe(fires[1]!.instanceId);
 });
 it("stores a non-drawing Fire when its entire marginal contribution is two", () => {
  const state = ordinaryFireHand(["SFA023", "SFA016", "SFA019"]);
  const fire = state.players[0].hand[1]!.instanceId;
  const plan = planMidrange(input(state));
  expect(plan?.evaluation.weakFireReserve).toEqual({instanceId:fire,marginalDamage:2});
  expect(plan?.evaluation.arsenalId).toBe(fire);
  expect(plan?.evaluation.damage).toBe(5);
  expect(plan?.line).not.toContainEqual(expect.objectContaining({kind:"play-card",instanceId:fire}));
 });
 it("counts Lava rupture as extra marginal value and still plays Fire", () => {
  const state = ordinaryFireHand(["SFA023", "SFA023", "SFA016", "SFA019"]);
  const fire = state.players[0].hand[2]!.instanceId;
  const plan = planMidrange(input(state));
  expect(plan?.evaluation.damage).toBe(13);
  expect(plan?.evaluation.weakFireReserve).toBeUndefined();
  expect(plan?.line).toContainEqual(expect.objectContaining({kind:"play-card",instanceId:fire}));
 });
 it("does not force a Fire reserve when another hand card would be wasted", () => {
  const state = ordinaryFireHand(["SFA023", "SFA016", "SFA019", "SFA019"]);
  const plan = planMidrange(input(state));
  expect(plan?.evaluation.weakFireReserve).toBeUndefined();
  expect(plan?.evaluation.stranded).toBe(0);
 });
 it("requires a genuinely free arsenal slot", () => {
  const state = ordinaryFireHand(["SFA023", "SFA016", "SFA019"]);
  state.players[0].arsenal = [{cardId:"HNT151",owner:0,instanceId:state.nextInstanceId++}];
  const plan = planMidrange(input(state));
  expect(plan?.evaluation.weakFireReserve).toBeUndefined();
 });
 it("blocks the originally reserved ender and protects Fire instead", () => {
  const state = defendWith(["SFA023", "SFA016", "SFA019", "SFA019"]);
  state.players[0].graveyard = [];
  state.players[0].board.push({cardId:"SFA035",owner:0,instanceId:state.nextInstanceId++});
  const fire = state.players[0].hand[1]!.instanceId;
  const enders = state.players[0].hand.slice(2).map((card) => card.instanceId);
  const choice = chooseMidrangeDefense(input(state));
  expect(choice?.defense.complete).toBe(true);
  expect(choice?.defense.protectedId).toBe(fire);
  expect(enders).toContain(choice?.defense.replacedEnderId);
  expect(choice?.defense.handIds).toEqual([choice?.defense.replacedEnderId]);
  const staged = choice!.intent.kind === "stage-defenders" ? apply(state,0,choice!.intent) : state;
  const committed = apply(staged,0,{kind:"defend",instanceIds:choice!.intent.kind === "stage-defenders" || choice!.intent.kind === "defend" ? choice!.intent.instanceIds : []});
  const reply = midReply(input(committed));
  expect(reply.plan?.evaluation.arsenalId).toBe(fire);
  expect(reply.plan?.evaluation.stranded).toBe(0);
 });
});

it("keeps an already arsenaled weak Fire instead of spending one resource for two damage", () => {
 const state = ordinaryFireHand(["SFA023", "SFA019"]);
 const fire = {cardId:"SFA016",owner:0,instanceId:state.nextInstanceId++}; state.players[0].arsenal = [fire];
 const plan = planMidrange(input(state));
 expect(plan?.evaluation.weakFireReserve).toEqual({instanceId:fire.instanceId,marginalDamage:2});
 expect(plan?.evaluation.retainedArsenalIds).toContain(fire.instanceId);
});

it("counts Salt's extra hit when classifying Fire even in a defensive 3.5 valuation", () => {
 const state = ordinaryFireHand(["SFA023", "SFA023", "SFA016", "CRU073"]);
 const plan = planMidrange(input(state), {defensive:true});
 expect(plan?.evaluation.weakFireReserve).toBeUndefined();
 expect(plan?.evaluation.rawDamage).toBeGreaterThan(plan!.evaluation.damage);
});
