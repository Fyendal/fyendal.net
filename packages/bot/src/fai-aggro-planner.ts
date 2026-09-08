import { applyIntent, type GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import type { BotPolicyInput } from "./policy.js";
import { faiAggroPresentation } from "./sideboard.js";
import { isCleanActionDecision, planTurn } from "./turn-planner.js";
import { faiRole, nameOf } from "./fai-aggro-model.js";

import { knownRemainingFaiDeck, createFaiSandbox, observeFaiState } from "./fai-observation.js";
import { compareAggroRoutes, createFaiAggroRouteConfig, type FaiRouteOptions, type FaiRoutePlan } from "./fai-aggro-route-policy.js";
export type { FaiRouteEvaluation, FaiRouteOptions, FaiRoutePlan } from "./fai-aggro-route-policy.js";

export function forcedAggroIntent(input: BotPolicyInput): GameIntent {
  const legal = input.legal.filter((intent) => intent.kind !== "concede");
  const prompt = input.view.pendingDecision?.prompt ?? "";
  if (/deal .*damage|Art of the Dragon: Fire/i.test(prompt)) {
    const opponent = input.view.players[1 - input.seat]!.heroInstanceId;
    const target = legal.find((intent) => intent.kind === "choose" && intent.optionId === String(opponent));
    if (target) return target;
  }
  if (/return a Phoenix Flame/i.test(prompt)) {
    const flameIds = input.view.players[input.seat].graveyard
      .filter((card) => nameOf(card, input) === "phoenix flame").map((card) => String(card.instanceId));
    const flame = legal.find((intent) => intent.kind === "choose" && flameIds.includes(intent.optionId));
    if (flame) return flame;
  }
  const yes = legal.find((intent) => intent.kind === "choose" && intent.optionId === "yes");
  if (yes && /Fai|Phoenix Flame|Rise from the Ashes/i.test(prompt)) return yes;
  return legal.find((intent) => intent.kind === "defend" && !intent.instanceIds.length) ??
    legal.find((intent) => intent.kind === "choose" && ["no", "done", "pass", "decline", "pay 0"].includes(intent.optionId)) ??
    legal.find((intent) => intent.kind === "pass") ??
    legal.find((intent) => intent.kind === "close-chain") ?? legal[0]!;
}

/** Existing Aggro callers keep their historical default. Shared observation
 * helpers require an explicit presentation and never choose a strategy. */
export function knownFaiDeck(input: BotPolicyInput): string[] {
  return knownRemainingFaiDeck(input, input.knownOwnDeck ?? faiAggroPresentation().deck);
}

export function aggroSandbox(input: BotPolicyInput): GameState | undefined {
  return createFaiSandbox(input, input.knownOwnDeck ?? faiAggroPresentation().deck);
}

/** Existing internal call sites keep their name; implementation is shared. */
export const observedAggro = observeFaiState;

/** Advance a no-further-actions counterfactual through real cleanup/reset.
 * Turn-0 refill is deliberately excluded from retained-known-hand valuation. */
export function retainedHandActionState(input: BotPolicyInput): BotPolicyInput | undefined {
  let state = aggroSandbox(input);
  if (!state) return undefined;
  const retained = new Set(input.view.players[input.seat].hand.map((card) => card.instanceId));
  const life = input.view.players[input.seat].life;
  state.players[input.seat].life = 1_000;
  for (let steps = 0; steps < 180; steps++) {
    if (state.turn > input.view.turn && isCleanActionDecision(state, input.seat)) {
      state.players[input.seat].life = life;
      state.players[input.seat].hand = state.players[input.seat].hand.filter((card) => retained.has(card.instanceId));
      return observedAggro(state, input);
    }
    if (state.winner !== null) return undefined;
    const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    const observation = observedAggro(state, { ...input, seat: actor });
    const intent = forcedAggroIntent(observation);
    if (!intent) return undefined;
    const applied = applyIntent(state, actor, intent);
    if (!applied.ok) return undefined;
    state = applied.state;
  }
  return undefined;
}

/** Bot-only damage measuring sandbox, NOT a live rules change. This fixed Aggro
 * pool compares relative life (Scar), so add the same buffer to both heroes:
 * damage and life comparisons stay intact without a low-life dummy dying
 * halfway through the line. Real decisions/defense/4n retain real life totals. */
function fullRouteState(state: GameState): GameState {
  return { ...state, players: [
    { ...state.players[0], life: state.players[0].life + 10_000 },
    { ...state.players[1], life: state.players[1].life + 10_000 },
  ] };
}

/** Resolve the next action through legal flow to check the last usable Hood
 * window. Dynamic go again matters here: March/Scar are not always extenders. */
export function canContinueFaiAction(input: BotPolicyInput, intent: GameIntent): boolean {
  if (intent.kind === "pass" || intent.kind === "close-chain") return false;
  const sandbox = aggroSandbox(input);
  if (!sandbox) return false;
  const applied = applyIntent(fullRouteState(sandbox), input.seat, intent);
  if (!applied.ok) return false;
  let state = applied.state;
  for (let step = 0; step < 160 && state.turn === input.view.turn && state.winner === null; step++) {
    if (isCleanActionDecision(state, input.seat)) return state.players[input.seat].actionPoints > 0;
    if (state.pendingDecision?.kind === "arsenal") return false;
    const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    const next = applyIntent(state, actor, forcedAggroIntent(observedAggro(state, { ...input, seat: actor })));
    if (!next.ok) return false;
    state = next.state;
  }
  return false;
}

export function planFaiRoute(input: BotPolicyInput, options: FaiRouteOptions): FaiRoutePlan | undefined {
  // Explicit hold-one roots keep bounded DFS from spending every branch on
  // attacks and never reaching the user's play-three/store-one alternatives.
  if (options.objective === "turn1" && !options.reserveBranchesDone &&
    input.view.players[input.seat].arsenalCount === 0) {
    const common = { ...options, reserveBranchesDone: true };
    const unrestricted = planFaiRoute(input, common);
    let best = options.openingReserveRequired && unrestricted?.evaluation.arsenalId === undefined
      ? undefined
      : unrestricted;
    for (const card of input.view.players[input.seat].hand) {
      if (nameOf(card, input) === "phoenix flame") continue;
      if (!options.openingReserveRequired && faiRole(card, input) === "starter" &&
        (options.memory?.originalStarters ?? 0) < 2) continue;
      const reserved = planFaiRoute(input, { ...common, nodes: Math.max(120, Math.floor((options.nodes ?? 400) / 2)),
        excludeIds: new Set([...(options.excludeIds ?? []), card.instanceId]) });
      if (reserved && (!best || compareAggroRoutes(reserved.evaluation, best.evaluation, "turn1",
        options.memory?.conversionTarget(input) ?? 3, options.openingReserveRequired) > 0)) best = reserved;
    }
    return best ?? unrestricted;
  }
  const sandbox = options.sandboxed ? input.state : aggroSandbox(input);
  if (!sandbox || !isCleanActionDecision(sandbox, input.seat)) return undefined;
  const state = fullRouteState(sandbox);
  const start = observedAggro(state, input);
  return planTurn(start, createFaiAggroRouteConfig(input, start, options, {
    chooseForced: forcedAggroIntent,
    knownDrawPool: input.faiDrawReserveTiebreak ? knownFaiDeck(input) : [],
  }));
}
