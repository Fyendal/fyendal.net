import { applyIntent } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { ownCards, type BotPolicyInput } from "./policy.js";
import { compareTuple, faiRole } from "./fai-aggro-model.js";
import { forcedAggroIntent, observedAggro, planFaiRoute, aggroSandbox } from "./fai-aggro-planner.js";
import { isCleanActionDecision } from "./turn-planner.js";

export interface FaiArcaneTrace {
  phase: "payment" | "pitch";
  incoming?: number;
  payment: number;
  pitchedId?: number;
  retainedDamage?: number;
  complete?: boolean;
}

/** Value the whole remaining hand after paying, at this turn's next action
 * window or the next own turn when defending. All unknown draws/opponent
 * identities are sanitized; no physical-combat defense rule is changed. */
function valueAfterPitch(input: BotPolicyInput, intent: GameIntent): { damage: number; complete: boolean } {
  let state = aggroSandbox(input);
  if (!state) return { damage: 0, complete: false };
  const knownIds = new Set(ownCards(input).keys());
  // Survive queued effects while measuring a continuation. Equal buffers
  // preserve Scar's relative-life condition, as in the normal route planner.
  const buffer = 10_000;
  for (const player of state.players) player.life += buffer;
  const paid = applyIntent(state, input.seat, intent);
  if (!paid.ok) return { damage: 0, complete: false };
  state = paid.state;
  for (let step = 0; step < 180 && state.winner === null; step++) {
    if (input.view.activePlayer === input.seat && state.turn > input.view.turn) {
      return { damage: 0, complete: true };
    }
    if (isCleanActionDecision(state, input.seat)) {
      for (const player of state.players) player.life -= buffer;
      const me = state.players[input.seat];
      me.hand = me.hand.filter((card) => knownIds.has(card.instanceId));
      const plan = planFaiRoute(observedAggro(state, input), { equipment: true, nodes: 160, sandboxed: true });
      return { damage: plan?.evaluation.damage ?? 0, complete: plan?.evaluation.complete ?? false };
    }
    const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    const next = applyIntent(state, actor, forcedAggroIntent(observedAggro(state, { ...input, seat: actor })));
    if (!next.ok) break;
    state = next.state;
  }
  return { damage: 0, complete: false };
}

/** CR 8.3.8: https://rules.fabtcg.com/en/cr/08-keywords/
 * The engine offers payable totals; Lantern's Barrier 1 needs at most one
 * pitch card. Only the visible current packet opens the survival exception. */
export function chooseFaiArcaneDefense(input: BotPolicyInput): {
  intent: GameIntent; rule: string; arcane: FaiArcaneTrace;
} | undefined {
  const decision = input.view.pendingDecision;
  if (!decision || decision.player !== input.seat) return undefined;
  const incomingMatch = /^Arcane Barrier: you would be dealt (\d+) arcane damage/i.exec(decision.prompt);
  if (incomingMatch) {
    const incoming = Number(incomingMatch[1]);
    const minimum = incoming - input.view.players[input.seat].life + 1;
    const payments = input.legal.flatMap((intent) => {
      if (intent.kind !== "choose" || !/^pay \d+$/.test(intent.optionId)) return [];
      return [{ intent, payment: Number(intent.optionId.slice(4)) }];
    });
    const surviving = minimum > 0 ? payments.filter((choice) => choice.payment >= minimum)
      .sort((a, b) => a.payment - b.payment)[0] : undefined;
    const chosen = surviving ?? payments.find((choice) => choice.payment === 0);
    return chosen ? { intent: chosen.intent, rule: "ARC-LETHAL-001",
      arcane: { phase: "payment", incoming, payment: chosen.payment } } : undefined;
  }
  const pitchMatch = /^Pitch cards to pay (\d+) for Arcane Barrier/i.exec(decision.prompt);
  if (!pitchMatch) return undefined;
  const hand = input.view.players[input.seat].hand;
  const choices = input.legal.flatMap((intent) => {
    if (intent.kind !== "choose") return [];
    const card = hand.find((card) => String(card.instanceId) === intent.optionId);
    return card ? [{ intent, card, role: faiRole(card, input) }] : [];
  });
  const starters = choices.filter((choice) => choice.role === "starter");
  const hasEnder = choices.some((choice) => choice.role === "ender");
  // Same role gates as physical defense: enders first, the last starter last.
  // Among equal role choices, maximize the whole paid continuation (minimum
  // marginal loss from a common pre-payment hand). Yellow is only a final tie.
  const ranked = choices.map((choice) => {
    const lastStarter = choice.role === "starter" && starters.length === 1 && choices.length > 1;
    const violations = Number(lastStarter) * 2 + Number(hasEnder && choice.role !== "ender");
    return { ...choice, violations };
  });
  const leastViolations = Math.min(...ranked.map((choice) => choice.violations));
  const candidates = ranked.filter((choice) => choice.violations === leastViolations).map((choice) => ({
    ...choice, value: valueAfterPitch(input, choice.intent),
  }));
  const tuple = (choice: typeof candidates[number]) => [choice.value.damage,
    -Number(choice.role === "starter"), Number(input.cards[choice.card.cardId]?.pitch === 2)];
  candidates.sort((a, b) => -compareTuple(tuple(a), tuple(b)) || a.card.instanceId - b.card.instanceId);
  const best = candidates[0];
  return best ? { intent: best.intent, rule: "ARC-PITCH-001", arcane: {
    phase: "pitch", payment: Number(pitchMatch[1]), pitchedId: best.card.instanceId,
    retainedDamage: best.value.damage, complete: best.value.complete,
  } } : undefined;
}
