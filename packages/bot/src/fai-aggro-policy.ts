import type { GameIntent } from "@fyendal/shared";
import { ownCards, intentCard, type BotPolicyInput } from "./policy.js";
import { isCleanActionDecision } from "./turn-planner.js";
import { FaiAggroMemory, faiAggroStage, faiRole, nameOf, nextWavePressure, zeroPitchAggroIntent } from "./fai-aggro-model.js";
import { chooseFaiAggroDefense, type FaiDefenseTrace } from "./fai-aggro-defense.js";
import { chooseFaiHoodSubset, type FaiHoodEstimate } from "./fai-aggro-hood.js";
import { canContinueFaiAction, forcedAggroIntent, planFaiRoute, type FaiRoutePlan } from "./fai-aggro-planner.js";
import { improveFaiRouteWithFealty, type FaiFealtyTrace } from "./fai-aggro-fealty.js";
import { chooseFaiArcaneDefense, type FaiArcaneTrace } from "./fai-aggro-arcane.js";
import {
  decodeFaiAggroPolicyState,
  initialFaiAggroPolicyState,
  type FaiAggroPolicyStateV1,
} from "./fai-policy-state.js";

export interface FaiAggroDecision {
  intent: GameIntent;
  rule: string;
  plan?: FaiRoutePlan;
  defense?: FaiDefenseTrace;
  hood?: FaiHoodEstimate;
  fealty?: FaiFealtyTrace;
  arcane?: FaiArcaneTrace;
}

export interface FaiAggroStatefulDecision {
  decision: FaiAggroDecision;
  nextState: FaiAggroPolicyStateV1;
}

function hoodChoice(input: BotPolicyInput, memory: FaiAggroMemory): GameIntent {
  const selected = input.legal.find((intent) => intent.kind === "choose" &&
    memory.hoodSwap.includes(Number(intent.optionId)));
  if (selected?.kind === "choose") {
    memory.hoodSwap = memory.hoodSwap.filter((id) => id !== Number(selected.optionId));
    return selected;
  }
  const firstChoice = input.view.pendingDecision?.promptMessage?.id === "card.wtr.hood.shuffle" ||
    (/Hope Merchant's Hood: shuffle a card/i.test(input.view.pendingDecision?.prompt ?? "") &&
      !/another card/i.test(input.view.pendingDecision?.prompt ?? ""));
  if (firstChoice) {
    const me = input.view.players[input.seat];
    const legalCards = me.hand.filter((card) => input.legal.some((intent) =>
      intent.kind === "choose" && intent.optionId === String(card.instanceId)));
    const fallback = legalCards.sort((left, right) => {
      const value = (card: typeof left): number => {
        if (nameOf(card, input) === "phoenix flame") return 0;
        const role = faiRole(card, input);
        const roleValue = role === "ender" ? 1 : role === "extender" ? 2 : 3;
        return roleValue * 100 + (input.cards[card.cardId]?.attack ?? 0);
      };
      return value(left) - value(right) || left.instanceId - right.instanceId;
    })[0];
    if (fallback) return { kind: "choose", optionId: String(fallback.instanceId) };
  }
  return input.legal.find((intent) => intent.kind === "choose" && intent.optionId === "done") ??
    forcedAggroIntent(input);
}

/** First-player Turn1 commits Tiger/Kunai, without a threat score or a
 * turn-start Hood activation. Instant setup does not consume the attack AP;
 * actual attacks keep the planner's ordering unless it would end the turn
 * before an available Tiger/weapon can be used. */
function fixedFirstBurst(input: BotPolicyInput, plan?: FaiRoutePlan): GameIntent | undefined {
  const me = input.view.players[input.seat];
  if (me.actionPoints <= 0) return undefined;
  const own = ownCards(input);
  const usable = input.legal.filter((intent) => zeroPitchAggroIntent(intent, input));
  const find = (name: string) => usable.find((intent) => {
    const card = intentCard(intent, own);
    return card && nameOf(card, input) === name;
  });
  const paws = find("pouncing paws");
  const tiger = find("crouching tiger");
  const shuko = find("tearing shuko");
  if (shuko && (paws || tiger)) return shuko;
  if (paws) return paws;
  const kunai = me.weapons.find((card) => nameOf(card, input) === "kunai of retribution");
  const alreadyAttacked = kunai && input.view.chain.some((link) => link.attackingCard.instanceId === kunai.instanceId);
  const blood = find("blood scent");
  if (blood && kunai && !alreadyAttacked && me.resources === 0) return blood;
  if (!plan || !canContinueFaiAction(input, plan.intent)) return tiger ?? find("kunai of retribution");
  return undefined;
}

/** One instance per game and seat. All memory is derived from own observations;
 * callers must discard the session when restarting/replaying a match. */
export function createFaiAggroSession(
  initialState: FaiAggroPolicyStateV1 = initialFaiAggroPolicyState(),
) {
  const memory = new FaiAggroMemory(initialState.memory);
  let stagedDefense = initialState.stagedDefense ? {
    ...initialState.stagedDefense,
    ids: [...initialState.stagedDefense.ids],
    trace: { ...initialState.stagedDefense.trace },
  } : undefined;
  const chooseWithTrace = (input: BotPolicyInput): FaiAggroDecision => {
    const stage = faiAggroStage(input.view, input.seat);
    const opening = stage === "first-turn0-attack";
    memory.observe(input);
    const done = (decision: FaiAggroDecision): FaiAggroDecision => {
      memory.record(input, decision.intent);
      return decision;
    };
    // Turn0 forbids ALL equipment, even a Hood rescue or an arcane payment.
    const arcane = opening ? undefined : chooseFaiArcaneDefense(input);
    if (arcane) return done(arcane);
    const decision = input.view.pendingDecision;
    // Staging has no intervening opponent decision. Commit the chosen set once
    // instead of revaluing a hand whose staged cards are already projected out.
    const staged = decision?.stagedCards?.map((card) => card.instanceId) ?? [];
    if (decision?.kind === "defend" && stagedDefense?.turn === input.view.turn &&
      staged.length === stagedDefense.ids.length && staged.every((id) => stagedDefense!.ids.includes(id))) {
      const commit = input.legal.find((intent) => intent.kind === "defend" &&
        intent.instanceIds.length === staged.length && intent.instanceIds.every((id) => staged.includes(id)));
      if (commit) {
        const trace = stagedDefense.trace; stagedDefense = undefined;
        return done({ intent: commit, rule: trace.rule, defense: trace });
      }
    }
    stagedDefense = undefined;
    const defense = chooseFaiAggroDefense(input);
    if (defense) {
      if (defense.intent.kind === "stage-defenders") stagedDefense = {
        turn: input.view.turn, ids: defense.intent.instanceIds, trace: defense.defense,
      };
      return done({ ...defense, rule: defense.defense.rule });
    }
    if (decision && /Hope Merchant's Hood/i.test(decision.prompt)) {
      return done({ intent: hoodChoice(input, memory), rule: "H-T1-005" });
    }
    if (decision?.kind === "arsenal") {
      const choices = input.legal.filter((intent) => intent.kind === "choose" &&
        input.view.players[input.seat].hand.some((card) => String(card.instanceId) === intent.optionId &&
          nameOf(card, input) !== "phoenix flame"));
      return done({ intent: choices.find((intent) => intent.kind === "choose" &&
        intent.optionId === String(memory.reservedId)) ?? choices[0] ??
        input.legal.find((intent) => intent.kind === "choose" && intent.optionId === "pass") ?? forcedAggroIntent(input), rule: "VAL-003" });
    }
    if (!input.state || !isCleanActionDecision(input.state, input.seat)) {
      return done({ intent: forcedAggroIntent(input), rule: "legal-resolution" });
    }
    const turn1 = opening || stage === "turn1-attack";
    const me = input.view.players[input.seat];
    if (stage === "first-turn1-attack" && me.actionPoints <= 0) {
      return done({ intent: forcedAggroIntent(input), rule: "F-T1-A001-no-action-point" });
    }
    const hood = !opening && input.legal.find((intent) => {
      const card = intentCard(intent, ownCards(input));
      return intent.kind === "activate-ability" && card && nameOf(card, input) === "hope merchant's hood";
    });
    let plan = planFaiRoute(input, { equipment: !turn1,
      objective: turn1 ? "turn1" : "conversion", memory, openingReserveRequired: opening });
    let rule = opening ? "F-T0-001/002" : turn1 ? "H-T1-001/002/003" : stage === "first-turn1-attack" ? "F-T1-A001" : "H-T2-A001";
    if (turn1 && !opening && (plan?.evaluation.converted ?? 0) < memory.target) {
      const rescue = planFaiRoute(input, { equipment: true, objective: "conversion", memory });
      if (rescue && rescue.evaluation.converted >= memory.target) { plan = rescue; rule = "H-T1-004"; }
    }
    let fealtyResult = improveFaiRouteWithFealty(input, plan, {
      equipment: !turn1 || rule === "H-T1-004", objective: turn1 ? "turn1" : "conversion", memory,
      openingReserveRequired: opening,
    });
    plan = fealtyResult.plan;
    if (stage === "first-turn1-attack") {
      const burst = fixedFirstBurst(input, plan);
      if (burst) return done({ intent: burst, rule: "F-T1-A001-tools" });
    }
    // Reserve Flame until the last usable action window, so the pressure
    // decision observes the opponent's latest blocks rather than turn-start n.
    const flames = me.hand.filter((card) => nameOf(card, input) === "phoenix flame");
    if (!turn1 && hood && flames.length && me.actionPoints > 0) {
      const heldOptions = { equipment: true, objective: "conversion" as const, memory,
        excludeIds: new Set(flames.map((card) => card.instanceId)) };
      const heldFealty = improveFaiRouteWithFealty(input, planFaiRoute(input, heldOptions), heldOptions);
      const held = heldFealty.plan;
      const realFlames = flames.filter((card) => memory.realIds.has(card.instanceId) &&
        !memory.playedIds.has(card.instanceId)).length;
      // If Flame is needed to unlock other cards, play it in the full route
      // now; holding it must not itself manufacture a false rescue problem.
      const canHold = held && (!plan || held.evaluation.converted >= plan.evaluation.converted - realFlames);
      const lastWindow = canHold && !canContinueFaiAction(input, held.intent);
      if (lastWindow && nextWavePressure(input.view, input.seat) >= me.life) {
        const requiredIds = new Set(flames.map((card) => card.instanceId));
        const estimate = chooseFaiHoodSubset(input, memory, { requiredIds, plan: held });
        memory.hoodSwap = estimate?.instanceIds ?? [...requiredIds];
        return done({ intent: hood, rule: "H-T2-A002/003/004/005", plan: held, ...(estimate ? { hood: estimate } : {}) });
      }
      if (canHold && !lastWindow) { plan = held; fealtyResult = heldFealty; rule = "H-T2-A004-wait"; }
    }
    // First realize the useful prefix. At the last usable action window,
    // pressure (above) precedes waste: legal play + arsenal is already fine.
    const needsRescue = turn1 ? (plan?.evaluation.converted ?? 0) < memory.conversionTarget(input)
      : (plan?.evaluation.stranded ?? me.hand.length) > 0;
    if (hood && me.actionPoints > 0 && needsRescue && (!plan || !canContinueFaiAction(input, plan.intent))) {
      const requiredIds = new Set(me.hand.filter((card) => nameOf(card, input) === "phoenix flame")
        .map((card) => card.instanceId));
      const estimate = chooseFaiHoodSubset(input, memory, { requiredIds });
      if (estimate) {
        memory.hoodSwap = estimate.instanceIds;
        return done({ intent: hood, rule: "H-T1-005/H-T2-A006", ...(plan ? { plan } : {}), hood: estimate });
      }
    }
    memory.reservedId = plan?.evaluation.arsenalId;
    return done({ intent: plan?.intent ?? forcedAggroIntent(input),
      rule: fealtyResult.fealty ? `${rule}/FEALTY-001` : rule,
      ...(plan ? { plan } : {}), ...(fealtyResult.fealty ? { fealty: fealtyResult.fealty } : {}) });
  };
  return {
    chooseWithTrace,
    chooseIntent: (input: BotPolicyInput): GameIntent => chooseWithTrace(input).intent,
    snapshot: (): FaiAggroPolicyStateV1 => {
      const state: FaiAggroPolicyStateV1 = {
        schemaVersion: initialState.schemaVersion,
        strategy: "aggro",
        memory: memory.snapshot(),
        ...(stagedDefense ? {
          stagedDefense: {
            ...stagedDefense,
            ids: [...stagedDefense.ids],
            trace: { ...stagedDefense.trace },
          },
        } : {}),
      };
      const decoded = decodeFaiAggroPolicyState(JSON.parse(JSON.stringify(state)) as unknown);
      if (!decoded) throw new Error("Fai Aggro produced invalid policy state");
      return decoded;
    },
  };
}

export function chooseFaiAggroWithState(
  input: BotPolicyInput,
  previousState: FaiAggroPolicyStateV1,
): FaiAggroStatefulDecision {
  const session = createFaiAggroSession(previousState);
  const decision = session.chooseWithTrace(input);
  return { decision, nextState: session.snapshot() };
}
