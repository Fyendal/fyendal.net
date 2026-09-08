import { applyIntent, type GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import type { BotPolicyInput } from "./policy.js";
import { createFaiSandbox, observeFaiState } from "./fai-observation.js";
import { faiMidrangePresentation } from "./sideboard.js";
import { planTurn, isCleanActionDecision, type TurnPlan } from "./turn-planner.js";
import { ANGER, FIRE, FLAME, POTION, midAllowed, midEnder, midForced, midName,
  midSource, midStarter, reserveRank, resourceOrigin, tigerFloating, type MidLimits } from "./fai-midrange-model.js";

export interface MidBudget { nodes: number; transitions: number }
export const MIDRANGE_SEARCH_NODES = 4_000;
export const MIDRANGE_DEFENSE_SEARCH_NODES = 4_000;
export const MIDRANGE_SEARCH_TRANSITIONS = 60_000;
export function midBudget(nodes = MIDRANGE_SEARCH_NODES): MidBudget {
  return { nodes, transitions: MIDRANGE_SEARCH_TRANSITIONS };
}
export function midDefenseBudget(): MidBudget {
  return midBudget(MIDRANGE_DEFENSE_SEARCH_NODES);
}
export interface MidEvaluation {
  score: number;
  complete: boolean;
  damage: number;
  rawDamage: number;
  fireDraw: boolean;
  stranded: number;
  arsenalId?: number;
  retainedArsenalIds: number[];
  reserveRank: number;
  resources: number;
  pitched: number;
  equipmentUsed: number;
  fealty: number;
  potionDeployed: boolean;
  potionsUsed: number;
  weakFireReserve?: { instanceId: number; marginalDamage: number };
}
export type MidPlan = TurnPlan<MidEvaluation>;
export interface MidPlanOptions {
  budget?: MidBudget;
  nodes?: number;
  sandboxed?: boolean;
  defensive?: boolean;
  opening?: boolean;
  reservedId?: number;
  tiger?: number;
  tools?: boolean;
  paidAnger?: boolean;
  reserveBranches?: boolean;
  closing?: boolean;
  preparePotion?: boolean;
  continuationDepth?: number;
  preserveFealty?: boolean;
  /** Fire instances whose route already consumed dedicated equipment support.
   * They cannot be reclassified as weak reserves after that support is sunk;
   * another Fire in the same hand remains eligible for the normal comparison. */
  supportedFireIds?: ReadonlySet<number>;
}
export function midSandbox(input: BotPolicyInput): GameState | undefined {
  return createFaiSandbox(input, input.knownOwnDeck ?? faiMidrangePresentation().deck);
}
function compare(a: MidEvaluation, b: MidEvaluation, prepare = false, opening = false): number {
  const av = [...(opening ? [Number(a.arsenalId !== undefined)] : []), Number(a.fireDraw), ...(prepare ? [Number(a.potionDeployed)] : []), a.damage,
    -a.stranded, a.reserveRank, -a.pitched, -a.equipmentUsed, -a.potionsUsed, a.fealty, -a.resources, Number(a.complete)];
  const bv = [...(opening ? [Number(b.arsenalId !== undefined)] : []), Number(b.fireDraw), ...(prepare ? [Number(b.potionDeployed)] : []), b.damage,
    -b.stranded, b.reserveRank, -b.pitched, -b.equipmentUsed, -b.potionsUsed, b.fealty, -b.resources, Number(b.complete)];
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return av[i]! - bv[i]!;
  return 0;
}
function order(intent: GameIntent, input: BotPolicyInput): number {
  const name = midSource(intent, input);
  if (name === "rise from the ashes") return 0;
  if (name === "tearing shuko") return 1;
  if (name === "pouncing paws") return 2;
  if (name === FIRE) return 3;
  if (name === "blood scent" || name === "fealty") return 4;
  if (name === "searing emberblade") return 6;
  if (name === "fai" || name === FLAME) return 7;
  if (intent.kind === "close-chain") return 12;
  if (intent.kind === "pass") return 14;
  if (name === POTION) return 13;
  return [ANGER, "salt the wound", "lava burst"].includes(name) ? 11 : 5;
}

/** Existing bounded search; no Aggro evaluation, roles, conversion memory or
 * hidden-hand model is reused. Unknown draws are an explicit stopping rule:
 * prefer a successful Fire exchange, then replan on the actual observation.
 * No numerical value or representative identity is assigned to the new card. */
function searchMidrange(input: BotPolicyInput, options: MidPlanOptions = {}): MidPlan | undefined {
  const budget = options.budget ?? midBudget();
  if (budget.nodes <= 0 || budget.transitions <= 0) return undefined;
  const sandbox = options.sandboxed ? input.state : midSandbox(input);
  if (!sandbox || !isCleanActionDecision(sandbox, input.seat)) return undefined;
  // The exact candidate pool has no absolute-life attack bonuses. Both life
  // totals receive the same measuring buffer; real defense never uses it.
  const state: GameState = { ...sandbox, players: [
    { ...sandbox.players[0], life: sandbox.players[0].life + 10_000 },
    { ...sandbox.players[1], life: sandbox.players[1].life + 10_000 },
  ] };
  const start = observeFaiState(state, input);
  const me = start.view.players[input.seat];
  const held = [...me.hand, ...me.arsenal];
  const opening = options.opening ?? (input.view.turn === 1 && input.view.activePlayer === input.seat);
  const closing = options.closing ?? input.view.players[1 - input.seat]!.life <= 2;
  const fireIds = new Set(held.filter((x) => midName(x, input) === FIRE).map((x) => x.instanceId));
  const prepare = opening || options.preparePotion === true || !held.some((x) => midEnder(x, input));
  const origin = resourceOrigin(start, options.tiger);
  const limits: MidLimits = { opening, closing, tools: options.tools ?? (!opening && (closing || fireIds.size > 0)),
    paidAnger: options.paidAnger ?? false, reservedId: options.reservedId, origin };
  const rootEquipment = Object.values(me.equipment).flatMap((x) => x ? [x.instanceId] : []);
  const rootHandIds = new Set(me.hand.map((x) => x.instanceId));
  const rootPotions = new Set(me.board.filter((x) => midName(x, start) === POTION).map((x) => x.instanceId));
  const nodeLimit = Math.min(options.nodes ?? 400, budget.nodes);
  const transitionLimit = Math.min(nodeLimit * 12, budget.transitions);
  // Reserve this search's allowance before nested known-card continuations.
  budget.nodes -= nodeLimit;
  budget.transitions -= transitionLimit;
  const plan = planTurn(start, {
    completeAfterForcedTurnAdvance: true,
    maxSearchNodes: nodeLimit, maxTransitions: transitionLimit, maxRootCandidates: 24,
    maxActionDepth: 24, cardOpportunity: () => 0,
    chooseForced: (observed) => midForced(observed, limits),
    prepareCandidates(candidates, observed) {
      const own = observed.view.players[observed.seat];
      const eligible = candidates.filter((intent) => {
        if (!midAllowed(intent, observed, limits)) return false;
        const name = midSource(intent, observed);
        if (name === "fealty" && options.preserveFealty) return false;
        if (options.defensive && intent.kind === "close-chain" && observed.view.chain.some((link) => link.resolved && midName(link.attackingCard, observed) === "salt the wound")) return false;
        // A reserved Fire cannot authorize spending its support equipment.
        if (["tearing shuko", "pouncing paws", "blood scent"].includes(name) && !closing &&
          ![...own.hand, ...own.arsenal].some((x) => fireIds.has(x.instanceId) && x.instanceId !== options.reservedId)) return false;
        if (name === "blood scent" && !closing && own.resources > 0) return false;
        if (name === POTION && intent.kind === "activate-ability" && (opening || options.tools === false || own.actionPoints === 0)) return false;
        if (name === "fai" && own.actionPoints === 0) return false;
        return true;
      });
      // Always retain an allowed pass: planner fallback must not reintroduce
      // prohibited red pitches when every offensive candidate was filtered.
      return eligible.sort((a, b) => order(a, observed) - order(b, observed));
    },
    rankCandidate: (intent, observed) => -order(intent, observed),
    evaluateEnd(_state, observed, root, complete) {
      const end = observed.view.players[input.seat];
      const knownHand = end.hand.filter((x) => !root.deckIds.has(x.instanceId));
      const draw = observed.view.turn === root.turn && end.hand.some((x) => root.deckIds.has(x.instanceId));
      const current = [...observed.view.chain].reverse().find((x) => !x.resolved && x.attackingCard.owner === input.seat);
      // At Fire's draw boundary, its attack is publicly known but has not yet
      // dealt damage. Account for that attack without inspecting the draw.
      let damage = Math.max(0, root.opponentLife - observed.view.players[1 - input.seat]!.life) +
        (draw && current ? Math.max(0, current.attackValue - current.defenseValue) : 0);
      const prefixDamage = damage;
      let continuation: MidPlan | undefined;
      if (draw && (options.continuationDepth ?? 0) < 2 && budget.nodes > 0) {
        let tail: GameState = { ..._state, players: [..._state.players] as GameState["players"] };
        tail.players[input.seat] = { ...tail.players[input.seat], hand: tail.players[input.seat].hand.filter((x) => !root.deckIds.has(x.instanceId)) };
        for (let step = 0; step < 48 && budget.transitions > 0 && tail.turn === root.turn && tail.winner === null; step++) {
          if (isCleanActionDecision(tail, input.seat)) {
            continuation = searchMidrange(observeFaiState(tail, input), { ...options, budget,
              nodes: 100, sandboxed: true, reserveBranches: false, opening, closing,
              tiger: tigerFloating(observeFaiState(tail, input), origin),
              continuationDepth: (options.continuationDepth ?? 0) + 1 });
            break;
          }
          const actor = (tail.pendingDecision?.player ?? tail.priorityPlayer) as 0 | 1;
          const nextInput = observeFaiState(tail, { ...input, seat: actor });
          const nextIntent = midForced(nextInput, actor === input.seat ? limits : undefined);
          budget.transitions--;
          const next = applyIntent(tail, actor, nextIntent);
          if (!next.ok) break;
          tail = next.state;
        }
        damage += continuation?.evaluation.damage ?? 0;
      }
      const rawDamage = prefixDamage + (continuation?.evaluation.rawDamage ?? 0);
      if (options.defensive) {
        for (const link of observed.view.chain) {
          if (link.attackingCard.owner === input.seat && midName(link.attackingCard, observed) === "salt the wound" && link.resolved && !start.view.chain.some((prior) => prior.resolved && prior.attackingCard.instanceId === link.attackingCard.instanceId)) {
            const resolved = _state.chain.find((actual) => actual.attackingCard.instanceId === link.attackingCard.instanceId);
            damage += 3.5 - (resolved?.damage ?? 0);
          }
        }
      }
      const candidates = end.arsenalCount === 0 ? knownHand.filter((x) => midName(x, observed) !== FLAME) : [];
      const reserved = candidates.find((x) => x.instanceId === options.reservedId) ??
        candidates.sort((a, b) => reserveRank(b, observed) - reserveRank(a, observed) || a.instanceId - b.instanceId)[0];
      const reserve = reserved ? reserveRank(reserved, observed) : 0;
      const currentEquipment = new Set(Object.values(end.equipment).flatMap((x) => x ? [x.instanceId] : []));
      return { score: damage, damage, rawDamage, complete: complete && !draw,
        retainedArsenalIds: continuation?.evaluation.retainedArsenalIds ?? end.arsenal.map((card) => card.instanceId),
        fireDraw: draw && current !== undefined && midName(current.attackingCard, observed) === FIRE,
        stranded: continuation?.evaluation.stranded ?? Math.max(0, knownHand.length - Number(reserved !== undefined)),
        ...(continuation ? (continuation.evaluation.arsenalId !== undefined ? { arsenalId: continuation.evaluation.arsenalId } : {}) : reserved ? { arsenalId: reserved.instanceId } : {}), reserveRank: continuation?.evaluation.reserveRank ?? reserve,
        resources: continuation?.evaluation.resources ?? end.resources, pitched: end.pitch.filter((x) => rootHandIds.has(x.instanceId)).length + (continuation?.evaluation.pitched ?? 0),
        equipmentUsed: rootEquipment.filter((id) => !currentEquipment.has(id)).length + (continuation?.evaluation.equipmentUsed ?? 0),
        fealty: continuation?.evaluation.fealty ?? end.board.filter((x) => midName(x, observed) === "fealty").length,
        potionsUsed: [...rootPotions].filter((id) => !end.board.some((card) => card.instanceId === id)).length + (continuation?.evaluation.potionsUsed ?? 0),
        potionDeployed: continuation?.evaluation.potionDeployed === true || end.board.some((x) => midName(x, observed) === POTION && !rootPotions.has(x.instanceId)),
      };
    },
    compareEvaluations: (a, b) => compare(a, b, prepare, opening),
  });
  budget.nodes += nodeLimit - (plan?.nodes ?? nodeLimit);
  budget.transitions += transitionLimit - (plan?.transitions ?? transitionLimit);
  let best = opening && plan?.evaluation.arsenalId === undefined ? undefined : plan;
  if (options.reserveBranches !== false && options.reservedId === undefined && me.arsenalCount === 0) {
    const starters = me.hand.filter((x) => midStarter(x, input)).length;
    for (const card of me.hand) {
      if (midName(card, input) === FLAME || (!opening && midStarter(card, input) && starters < 2)) continue;
      const reserved = searchMidrange(input, { ...options, budget, nodes: Math.min(options.nodes ?? 160, 160),
        reservedId: card.instanceId, reserveBranches: false });
      if (reserved && (!best || compare(reserved.evaluation, best.evaluation, prepare, opening) > 0)) best = reserved;
    }
  }
  // Only a waste state opens the exception for paying Anger. Its pitches are
  // still yellow/blue, and Tiger money remains excluded by midAllowed.
  if (options.paidAnger === undefined && best && best.evaluation.stranded > 0 && held.some((x) => midName(x, input) === ANGER)) {
    const payable = searchMidrange(input, { ...options, budget, paidAnger: true, reserveBranches: false });
    if (payable && compare(payable.evaluation, best.evaluation, prepare, opening) > 0) best = payable;
  }
  // A printed finisher that cannot participate in the selected legal route
  // must not suppress the preparation rule merely by sitting in the hand.
  if (!prepare && best && !best.evaluation.fireDraw && held.some((x) => midName(x, input) === POTION) &&
    !best.line.some((intent) => (intent.kind === "play-card" || intent.kind === "play-from-arsenal") &&
      held.some((card) => card.instanceId === intent.instanceId && midEnder(card, input)))) {
    const preparation = searchMidrange(input, { ...options, budget, preparePotion: true, reserveBranches: false });
    if (preparation?.evaluation.potionDeployed) best = preparation;
  }
  // The bounded tree may search an early Fealty branch more deeply than the
  // equivalent direct attack. Require a separate preservation comparison at
  // the actual activation decision; equal output keeps the token.
  if (best && midSource(best.intent, input) === "fealty" && !options.preserveFealty) {
    const preserved = searchMidrange(input, { ...options, budget, preserveFealty: true, reserveBranches: false });
    if (preserved && (compare(preserved.evaluation, best.evaluation, prepare, opening) >= 0 ||
      (preserved.evaluation.fireDraw === best.evaluation.fireDraw &&
        preserved.evaluation.damage >= best.evaluation.damage &&
        preserved.evaluation.stranded <= best.evaluation.stranded))) best = preserved;
  }
  return best ?? plan;
}


/** User rule: a non-drawing Fire worth at most two extra damage is a
 * one-card arsenal reserve. Compare complete retained-hand routes so pitch,
 * rupture, Salt and hero/weapon unlocks are included in that marginal value.
 * A reserve is accepted only if the real arsenal slot can be freed and no
 * other known hand card is stranded. Defense separately handles a spare ender.
 */
export function planMidrange(input: BotPolicyInput, options: MidPlanOptions = {}): MidPlan | undefined {
  const budget = options.budget ?? midBudget();
  const baseline = searchMidrange(input, { ...options, budget });
  if (!baseline || options.reservedId !== undefined || baseline.evaluation.fireDraw) return baseline;
  const me = input.view.players[input.seat];
  let best: MidPlan | undefined;
  for (const card of [...me.hand, ...me.arsenal]) {
    if (midName(card, input) !== FIRE || options.supportedFireIds?.has(card.instanceId) || budget.nodes <= 0) continue;
    // If this Fire is already the spare card, the ordinary route suffices.
    const played = baseline.line.some((intent) => (intent.kind === "play-card" || intent.kind === "play-from-arsenal") && intent.instanceId === card.instanceId);
    if (!played && baseline.evaluation.arsenalId !== card.instanceId) continue;
    const held = searchMidrange(input, { ...options, budget, reservedId: card.instanceId, reserveBranches: false });
    if (!held || (held.evaluation.arsenalId !== card.instanceId && !held.evaluation.retainedArsenalIds.includes(card.instanceId)) || held.evaluation.stranded !== 0 ||
      !held.evaluation.complete || !baseline.evaluation.complete) continue;
    const marginalDamage = baseline.evaluation.rawDamage - held.evaluation.rawDamage;
    if (marginalDamage > 2) continue;
    const candidate = { ...held, evaluation: { ...held.evaluation, arsenalId: card.instanceId,
      weakFireReserve: { instanceId: card.instanceId, marginalDamage } } };
    if (!best || candidate.evaluation.damage > best.evaluation.damage) best = candidate;
  }
  return best ?? baseline;
}
