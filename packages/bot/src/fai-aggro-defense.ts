import { applyIntent, projectStateFor } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { ownCards, type BotPolicyInput } from "./policy.js";
import { compareTuple, faiOnHit, faiAggroStage, faiRole, nameOf } from "./fai-aggro-model.js";
import { observedAggro, planFaiRoute, retainedHandActionState } from "./fai-aggro-planner.js";

export interface FaiDefenseTrace {
  rule: string;
  incoming: number;
  defense: number;
  onHitValue: number;
  retainedDamage: number;
  marginalLoss: number;
  complete: boolean;
}

/** Enumerate stage sets and ask the engine for actual combined defense and
 * legality. No manual recreation of Dominate, shield conditions, or armor wear. */
export function chooseFaiAggroDefense(input: BotPolicyInput): { intent: GameIntent; defense: FaiDefenseTrace } | undefined {
  if (input.view.pendingDecision?.kind !== "defend" || !input.state) return undefined;
  const link = [...input.view.chain].reverse().find((candidate) => !candidate.resolved);
  if (!link) return undefined;
  const me = input.view.players[input.seat];
  const stage = faiAggroStage(input.view, input.seat);
  const turn0 = stage === "turn0-defense";
  const turn2 = stage === "turn2-defense" || stage === "first-turn1-defense";
  const hit = faiOnHit(link.onHitEffects ?? []);
  const hasOnHit = (link.onHitEffects?.length ?? 0) > 0;
  const incoming = Math.max(0, link.attackValue - link.defenseValue);
  const staged = input.view.pendingDecision.stagedCards?.map((card) => card.instanceId) ?? [];
  const own = ownCards(input);
  const optional = [...new Set(input.legal.flatMap((intent) =>
    intent.kind === "stage-defenders" ? intent.instanceIds : []))].filter((id) => {
      if (staged.includes(id)) return false;
      const card = own.get(id);
      // Hope Merchant's Hood is legally selectable but contributes no defense.
      // Do not destroy a live activated ability for a zero-value block.
      return !(card && nameOf(card, input) === "hope merchant's hood" &&
        (card.defense ?? input.cards[card.cardId]?.defense ?? 0) <= 0);
    });
  // The fixed Aggro list has at most four hand cards and four armor pieces.
  // Pathological larger states fall back instead of silently truncating choices.
  if (optional.length > 12) return undefined;
  const handIds = new Set(me.hand.map((card) => card.instanceId));
  const legalHandIds = [...new Set([...staged, ...optional])].filter((id) => handIds.has(id));
  const starterIds = legalHandIds.filter((id) => faiRole(own.get(id)!, input) === "starter");
  const enderIds = legalHandIds.filter((id) => faiRole(own.get(id)!, input) === "ender");
  const response = retainedHandActionState(input);
  const values = new Map<string, { damage: number; complete: boolean }>();
  const valueAfter = (ids: readonly number[]): { damage: number; complete: boolean } => {
    const removed = ids.filter((id) => handIds.has(id)).sort((a, b) => a - b);
    const key = removed.join(",");
    const cached = values.get(key);
    if (cached) return cached;
    if (!response?.state) return { damage: 0, complete: false };
    const state = { ...response.state, players: [...response.state.players] as typeof response.state.players };
    state.players[input.seat] = { ...state.players[input.seat],
      hand: state.players[input.seat].hand.filter((card) => !removed.includes(card.instanceId)) };
    const plan = planFaiRoute(observedAggro(state, response), {
      equipment: !turn0, arsenal: !turn0, sandboxed: true, nodes: 160,
    });
    const result = { damage: plan?.evaluation.damage ?? 0, complete: plan?.evaluation.complete ?? false };
    values.set(key, result);
    return result;
  };
  const base = valueAfter([]);
  type Candidate = { ids: number[]; defense: number; hand: number[]; armor: number;
    survives: boolean; stops: boolean; violations: number; loss: number; retained: number; complete: boolean };
  const candidates: Candidate[] = [];
  for (let mask = 0; mask < 2 ** optional.length; mask++) {
    const ids = [...staged, ...optional.filter((_id, index) => (mask & 2 ** index) !== 0)];
    const applied = applyIntent(input.state, input.seat, { kind: "stage-defenders", instanceIds: ids });
    if (!applied.ok) continue;
    const commit = applyIntent(applied.state, input.seat, { kind: "defend", instanceIds: ids });
    if (!commit.ok) continue;
    const defense = projectStateFor(applied.state, input.seat).pendingDecision?.stagedDefense ?? 0;
    const hand = ids.filter((id) => handIds.has(id));
    const armor = ids.filter((id) => !handIds.has(id)).reduce((total, id) => total + (own.get(id)?.defense ?? 0), 0);
    const stops = defense >= incoming;
    const survives = Math.max(0, incoming - defense) + (stops ? 0 : hit.immediateDamage) < me.life;
    if (turn0 && armor > 0 && !(hasOnHit && armor === 1 && defense === incoming)) continue;
    const lostLastStarter = starterIds.length > 0 && starterIds.every((id) => hand.includes(id)) &&
      legalHandIds.some((id) => !hand.includes(id));
    const skippedEnder = enderIds.some((id) => !hand.includes(id)) &&
      hand.some((id) => !enderIds.includes(id));
    candidates.push({ ids, defense, hand, armor, survives, stops,
      violations: Number(lostLastStarter) * 2 + Number(skippedEnder),
      loss: 0, retained: 0, complete: false });
  }
  if (!candidates.length) return undefined;
  let eligible = candidates.filter((candidate) => candidate.survives);
  if (!eligible.length) eligible = candidates;
  const lethal = incoming + hit.immediateDamage >= me.life;
  // After the opening refill, marginal value chooses WHICH cards defend; it
  // must never trigger hand defense against a nonlethal attack (even on-hit).
  if (!turn0 && !lethal) eligible = eligible.filter((candidate) => candidate.hand.length === 0);
  if (!eligible.length) return undefined;
  // Surviving with armor alone takes priority over sacrificing any hand card.
  if (!turn0 && eligible.some((candidate) => candidate.survives && !candidate.hand.length)) {
    eligible = eligible.filter((candidate) => !candidate.hand.length);
  }
  if (turn0 && hasOnHit && eligible.some((candidate) => candidate.stops)) {
    eligible = eligible.filter((candidate) => candidate.stops);
  } else if (!hasOnHit && eligible.some((candidate) => candidate.defense <= incoming)) {
    eligible = eligible.filter((candidate) => candidate.defense <= incoming);
  }
  const minimumViolations = Math.min(...eligible.map((candidate) => candidate.violations));
  eligible = eligible.filter((candidate) => candidate.violations === minimumViolations);
  for (const candidate of eligible) {
    const value = valueAfter(candidate.hand);
    candidate.retained = value.damage;
    candidate.loss = base.damage - value.damage;
    candidate.complete = base.complete && value.complete;
  }
  const tuple = (candidate: Candidate): number[] => {
    const prevented = Math.min(incoming, candidate.defense);
    const overflow = Math.max(0, candidate.defense - incoming);
    const starters = candidate.hand.filter((id) => starterIds.includes(id)).length;
    if (turn0 && hasOnHit) return [Number(candidate.stops), -candidate.hand.length,
      -candidate.loss, -starters, -overflow, -candidate.ids.length];
    if (turn0) return [prevented, -candidate.loss, -starters, -candidate.hand.length];
    if (turn2) return [-candidate.hand.length, prevented, -candidate.loss, -starters, -overflow];
    // HIT-002 only ranks choices AFTER the lethal/armor-only gates above.
    // Equal net value preserves cards. Overflow itself earns no value.
    return [prevented + (candidate.stops ? hit.value : 0) - candidate.loss,
      -candidate.hand.length, -starters, -overflow, -candidate.ids.length];
  };
  eligible.sort((a, b) => -compareTuple(tuple(a), tuple(b)) || a.ids.join(",").localeCompare(b.ids.join(",")));
  const best = eligible[0]!;
  const alreadyStaged = best.ids.length === staged.length && best.ids.every((id) => staged.includes(id));
  return { intent: { kind: alreadyStaged ? "defend" : "stage-defenders", instanceIds: best.ids },
    defense: { rule: turn0 ? hasOnHit ? "H-T0-004" : "H-T0-003" : stage === "first-turn1-defense" ? "F-T1-D001" : turn2 ? "H-T2-D001/003" : "HIT-002",
      incoming, defense: best.defense, onHitValue: hit.value, retainedDamage: best.retained,
      marginalLoss: best.loss, complete: best.complete } };
}
