import { applyIntent, projectStateFor, type GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import type { BotPolicyInput } from "./policy.js";
import { observeFaiState } from "./fai-observation.js";
import { isCleanActionDecision } from "./turn-planner.js";
import { midEnder, midForced } from "./fai-midrange-model.js";
import { midBudget, midDefenseBudget, midSandbox, planMidrange, type MidBudget, type MidPlan } from "./fai-midrange-planner.js";

export interface MidDefenseTrace {
  incoming: number;
  defense: number;
  handIds: number[];
  protectedId?: number;
  replacedEnderId?: number;
  lifeAfter: number;
  retainedDamage: number;
  netValue: number;
  complete: boolean;
}
interface Reply { life: number; plan?: MidPlan; complete: boolean; choice?: GameIntent }

/** Resolve only the already-public opposing attack/effects, then pass to the
 * next own action window. No future enemy plays or unknown refill are used.
 * Own discard choices compare whole surviving combinations. Opponent target
 * choices use the worst legal result, not knowledge of the opponent's hand. */
export function midReply(input: BotPolicyInput, budget: MidBudget = midBudget(), reservedId?: number): Reply {
  const sandbox = midSandbox(input);
  const initialLife = input.view.players[input.seat].life;
  if (!sandbox) return { life: initialLife, complete: false };
  const known = new Set(input.view.players[input.seat].hand.map((x) => x.instanceId));
  const originTurn = input.view.turn;
  let branches = 0;
  const walk = (initial: GameState, depth: number): Reply => {
    let state = initial;
    for (let step = 0; step < 180 && budget.transitions > 0; step++) {
      if (state.winner !== null) return { life: state.winner === input.seat ? state.players[input.seat].life : 0, complete: true };
      if (state.turn > originTurn && isCleanActionDecision(state, input.seat)) {
        state = { ...state, players: [...state.players] as GameState["players"] };
        state.players[input.seat] = { ...state.players[input.seat], hand: state.players[input.seat].hand.filter((x) => known.has(x.instanceId)) };
        const plan = planMidrange(observeFaiState(state, input), {
          budget, nodes: 160, defensive: true, sandboxed: true, reserveBranches: false,
          ...(state.players[input.seat].hand.some((x) => x.instanceId === reservedId) ? { reservedId } : {}),
        });
        return {
          life: state.players[input.seat].life,
          plan,
          complete: plan?.evaluation.complete ?? false,
        };
      }
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const observed = observeFaiState(state, { ...input, seat: actor });
      const prompt = observed.view.pendingDecision?.prompt ?? "";
      const choices = observed.legal.filter((x) => x.kind === "choose" && !["pass", "no", "done", "decline"].includes(x.optionId));
      if (/discard|destroy.*arsenal|equipment.*counter/i.test(prompt) && choices.length > 1 && depth < 2 && branches < 12) {
        let best: Reply | undefined;
        for (const choice of choices) {
          if (branches++ >= 12 || budget.transitions <= 0) break;
          budget.transitions--;
          const applied = applyIntent(state, actor, choice);
          if (!applied.ok) continue;
          const result = walk(applied.state, depth + 1);
          const value = result.life + (result.plan?.evaluation.damage ?? 0);
          const bestValue = best ? best.life + (best.plan?.evaluation.damage ?? 0) : 0;
          if (!best || (actor === input.seat ? value > bestValue : value < bestValue)) best = { ...result, choice };
        }
        if (best) return best;
      }
      const pass = observed.legal.find((x) => x.kind === "pass");
      // Stop the opponent's turn instead of asking their policy to invent a
      // next attack. Forced public effects still resolve through the engine.
      const intent = isCleanActionDecision(state, actor) && actor !== input.seat ? pass : midForced(observed);
      if (!intent) break;
      budget.transitions--;
      const next = applyIntent(state, actor, intent);
      if (!next.ok) break;
      state = next.state;
    }
    return { life: state.players[input.seat].life, complete: false };
  };
  return walk(sandbox, 0);
}

export function chooseMidrangeDefense(input: BotPolicyInput, budget = midDefenseBudget()): { intent: GameIntent; defense: MidDefenseTrace } | undefined {
  if (!input.state || input.view.pendingDecision?.kind !== "defend") return undefined;
  const sandbox = midSandbox(input);
  if (!sandbox) return undefined;
  const link = [...input.view.chain].reverse().find((x) => !x.resolved);
  if (!link) return undefined;
  const incoming = Math.max(0, link.attackValue - link.defenseValue);
  const staged = input.view.pendingDecision.stagedCards?.map((x) => x.instanceId) ?? [];
  const optional = [...new Set(input.legal.flatMap((x) => x.kind === "stage-defenders" ? x.instanceIds : []))].filter((id) => !staged.includes(id));
  if (optional.length > 10) return undefined;
  const hands = new Set([...input.view.players[input.seat].hand.map((x) => x.instanceId),
    ...(input.view.pendingDecision.stagedCards ?? []).filter((x) => input.cards[x.cardId]?.cardType === "action").map((x) => x.instanceId)]);
  type Candidate = { state: GameState; ids: number[]; hand: number[]; defense: number; armor: number; reply?: Reply };
  const groups = new Map<string, Candidate>();
  // Equipment first: for each hand combination retain maximal useful armor,
  // then minimize overflow and equipment count. Rules compute the actual value.
  for (let mask = 0; mask < 2 ** optional.length && budget.transitions >= 2; mask++) {
    const ids = [...staged, ...optional.filter((_x, i) => (mask & 2 ** i) !== 0)];
    budget.transitions -= 2;
    const stage = applyIntent(sandbox, input.seat, { kind: "stage-defenders", instanceIds: ids });
    if (!stage.ok) continue;
    const defense = projectStateFor(stage.state, input.seat).pendingDecision?.stagedDefense ?? 0;
    const commit = applyIntent(stage.state, input.seat, { kind: "defend", instanceIds: ids });
    if (!commit.ok) continue;
    const hand = ids.filter((id) => hands.has(id));
    const armor = ids.length - hand.length;
    const candidate = { state: commit.state, ids, hand, defense, armor };
    const key = hand.join(",");
    const old = groups.get(key);
    if (!old || Math.min(defense, incoming) > Math.min(old.defense, incoming) ||
      (Math.min(defense, incoming) === Math.min(old.defense, incoming) &&
        (defense < old.defense || (defense === old.defense && armor < old.armor)))) groups.set(key, candidate);
  }
  const candidates = [...groups.values()].sort((a, b) => a.hand.length - b.hand.length || a.hand.join(",").localeCompare(b.hand.join(",")));
  if (!candidates.length) return undefined;
  const baseline = candidates.find((x) => x.hand.length === 0);
  if (baseline) baseline.reply = midReply(observeFaiState(baseline.state, input), budget);
  let protectedId = input.view.turn === 1 || baseline?.reply?.plan?.evaluation.stranded !== 0 ? undefined : baseline.reply.plan.evaluation.arsenalId;
  for (const candidate of candidates) {
    if (!candidate.reply) candidate.reply = midReply(observeFaiState(candidate.state, input), budget, protectedId);
  }
  let replacedEnderId: number | undefined;
  let fireSwapCandidates: Candidate[] | undefined;
  const originalReserve = input.view.players[input.seat].hand.find((card) => card.instanceId === protectedId);
  if (originalReserve && midEnder(originalReserve, input) && baseline?.reply?.plan && !baseline.reply.plan.evaluation.fireDraw) {
    // Only replace the ender that the no-hand-block route actually planned to
    // store. Never sacrifice a live finisher just to manufacture a weak Fire.
    const swaps = candidates.filter((candidate) => {
      const plan = candidate.reply?.plan;
      return candidate.hand.length === 1 && candidate.hand[0] === protectedId &&
        candidate.reply?.complete && candidate.reply.life > 0 && plan?.evaluation.weakFireReserve &&
        plan.evaluation.stranded === 0 && baseline.reply!.plan!.evaluation.rawDamage - plan.evaluation.rawDamage <= 2;
    });
    if (swaps.length) {
      replacedEnderId = protectedId;
      swaps.sort((a, b) => (b.reply!.life + b.reply!.plan!.evaluation.damage) - (a.reply!.life + a.reply!.plan!.evaluation.damage));
      protectedId = swaps[0]!.reply!.plan!.evaluation.arsenalId;
      fireSwapCandidates = swaps.filter((candidate) => candidate.reply!.plan!.evaluation.arsenalId === protectedId);
    }
  }
  let eligible = fireSwapCandidates ?? candidates.filter((x) => x.reply?.complete && x.reply.life > 0);
  if (!eligible.length) {
    // Do not interpret an exhausted search as zero retained value. Preserve
    // legality and minimize currently visible damage as an explicit fallback.
    eligible = candidates.filter((x) => input.view.players[input.seat].life > Math.max(0, incoming - x.defense));
    if (!eligible.length) eligible = candidates;
    eligible.sort((a, b) => Math.min(incoming, b.defense) - Math.min(incoming, a.defense) || a.hand.length - b.hand.length);
  } else {
    // A legal one-card reserve protects the duplicate finisher. Lethal and
    // actual public disruption take precedence: a missing reserve after the
    // no-hand-block resolution cannot receive this protection.
    if (protectedId !== undefined && eligible.some((x) => !x.hand.includes(protectedId))) {
      eligible = eligible.filter((x) => !x.hand.includes(protectedId));
    }
    const value = (x: Candidate) => x.reply!.life + (x.reply!.plan?.evaluation.damage ?? 0);
    if (input.view.turn === 1) eligible.sort((a, b) => b.reply!.life - a.reply!.life || value(b) - value(a) || a.hand.length - b.hand.length);
    else eligible.sort((a, b) => value(b) - value(a) || a.hand.length - b.hand.length || a.ids.join(",").localeCompare(b.ids.join(",")));
  }
  const best = eligible[0]!;
  const already = best.ids.length === staged.length && best.ids.every((id) => staged.includes(id));
  const actual = input.legal.find((x) => (x.kind === (already ? "defend" : "stage-defenders")) &&
    "instanceIds" in x && x.instanceIds.length === best.ids.length && x.instanceIds.every((id) => best.ids.includes(id)));
  // stage-defenders supports complete sets even when legalIntents advertises
  // individual additions. Validate through applyIntent above before returning.
  const intent: GameIntent = actual ?? { kind: already ? "defend" : "stage-defenders", instanceIds: best.ids };
  return { intent, defense: { incoming, defense: best.defense, handIds: best.hand,
    ...(protectedId !== undefined ? { protectedId } : {}),
    ...(replacedEnderId !== undefined ? { replacedEnderId } : {}), lifeAfter: best.reply?.life ?? input.view.players[input.seat].life,
    retainedDamage: best.reply?.plan?.evaluation.damage ?? 0,
    netValue: (best.reply?.life ?? 0) + (best.reply?.plan?.evaluation.damage ?? 0),
    complete: best.reply?.complete ?? false } };
}
