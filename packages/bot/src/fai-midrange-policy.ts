import type { GameIntent } from "@fyendal/shared";
import type { BotPolicyInput } from "./policy.js";
import { isCleanActionDecision } from "./turn-planner.js";
import { chooseMidrangeDefense, midReply, type MidDefenseTrace } from "./fai-midrange-defense.js";
import { midBudget, midDefenseBudget, planMidrange, type MidPlan } from "./fai-midrange-planner.js";
import { FIRE, FLAME, MIDRANGE_VERSION, midForced, midName, midSource, resourceOrigin, tigerFloating, type MidResourceOrigin } from "./fai-midrange-model.js";
import {
  decodeFaiMidrangePolicyState,
  decodeMidrangeResourceOrigin,
  encodeMidrangeResourceOrigin,
  initialFaiMidrangePolicyState,
  type FaiMidrangePolicyStateV1,
} from "./fai-policy-state.js";

export interface FaiMidrangeDecision {
  strategy: "midrange";
  version: typeof MIDRANGE_VERSION;
  intent: GameIntent;
  rule: string;
  plan?: MidPlan;
  defense?: MidDefenseTrace;
  search: { nodes: number; transitions: number; exhausted: boolean };
}

export interface FaiMidrangeStatefulDecision {
  decision: FaiMidrangeDecision;
  nextState: FaiMidrangePolicyStateV1;
}

export function chooseFaiMidrangeWithState(
  input: BotPolicyInput,
  previousState: FaiMidrangePolicyStateV1,
): FaiMidrangeStatefulDecision {
    let nextState: FaiMidrangePolicyStateV1 = {
      ...previousState,
      ...(previousState.origin ? {
        origin: {
          ...previousState.origin,
          pitchIds: [...previousState.origin.pitchIds],
          potionIds: [...previousState.origin.potionIds],
        },
      } : {}),
      supportedFireIds: [...previousState.supportedFireIds],
      observedHandIds: [...previousState.observedHandIds],
      ...(previousState.stagedDefense ? {
        stagedDefense: {
          ids: [...previousState.stagedDefense.ids],
          trace: {
            ...previousState.stagedDefense.trace,
            handIds: [...previousState.stagedDefense.trace.handIds],
          },
        },
      } : {}),
    };
    if (nextState.turn !== input.view.turn) {
      nextState = {
        ...nextState,
        turn: input.view.turn,
        origin: encodeMidrangeResourceOrigin(resourceOrigin(input)),
        supportedFireIds: [],
      };
      delete nextState.reservedId;
      delete nextState.stagedDefense;
    }
    const origin: MidResourceOrigin | undefined = nextState.origin
      ? decodeMidrangeResourceOrigin(nextState.origin)
      : undefined;
    const supportedFireIds = new Set(nextState.supportedFireIds);
    let reservedId = nextState.reservedId;
    let staged = nextState.stagedDefense;
    const observedHand = new Set(nextState.observedHandIds);
    const me = input.view.players[input.seat];
    // An equipment-funded Fire route is evaluated before spending the gear.
    // Do not reclassify the same Fire as a cheap reserve after the Tiger has
    // become a sunk contribution. Changed hands and later turns still replan.
    const heldFireIds = new Set([...me.hand, ...me.arsenal].filter((card) => midName(card,input) === FIRE).map((card) => card.instanceId));
    for (const id of supportedFireIds) if (!heldFireIds.has(id)) supportedFireIds.delete(id);
    const handIds = input.view.players[input.seat].hand.map((card) => card.instanceId);
    // Draws and returns change conversion opportunities. A previous arsenal
    // choice must not lock a card that the newly visible hand can now use.
    if (handIds.some((id) => !observedHand.has(id))) reservedId = undefined;
    nextState.observedHandIds = [...new Set(handIds)];
    nextState.supportedFireIds = [...supportedFireIds].sort((left, right) => left - right);
    if (reservedId === undefined) delete nextState.reservedId;
    else nextState.reservedId = reservedId;
    const decision = input.view.pendingDecision;
    const budget = decision?.kind === "defend" ? midDefenseBudget() : midBudget();
    const initialBudget = { ...budget };
    const done = (intent: GameIntent, rule: string, plan?: MidPlan, defense?: MidDefenseTrace): FaiMidrangeStatefulDecision => ({
      decision: {
        strategy: "midrange", version: MIDRANGE_VERSION, intent, rule,
        ...(plan ? { plan } : {}), ...(defense ? { defense } : {}),
        search: { nodes: initialBudget.nodes - budget.nodes,
          transitions: initialBudget.transitions - budget.transitions,
          exhausted: budget.nodes <= 0 || budget.transitions <= 0 },
      },
      nextState,
    });
    if (decision?.kind === "defend" && staged) {
      const ids = decision.stagedCards?.map((x) => x.instanceId) ?? [];
      if (ids.length === staged.ids.length && ids.every((id) => staged!.ids.includes(id))) {
        const commit = input.legal.find((x) => x.kind === "defend" && x.instanceIds.length === ids.length && x.instanceIds.every((id) => ids.includes(id)));
        if (commit) {
          const trace = staged.trace;
          staged = undefined;
          delete nextState.stagedDefense;
          return done(commit, "MID-defend-commit", undefined, trace);
        }
      }
    }
    staged = undefined;
    delete nextState.stagedDefense;
    const defense = chooseMidrangeDefense(input, budget);
    if (defense) {
      if (defense.intent.kind === "stage-defenders") {
        nextState.stagedDefense = {
          ids: [...defense.intent.instanceIds],
          trace: { ...defense.defense, handIds: [...defense.defense.handIds] },
        };
      }
      return done(defense.intent, "MID-defend-marginal-reserve", undefined, defense.defense);
    }
    if (decision?.kind === "arsenal") {
      const chosen = input.legal.find((x) => x.kind === "choose" && x.optionId === String(reservedId) &&
        input.view.players[input.seat].hand.some((card) => card.instanceId === reservedId && midName(card, input) !== FLAME));
      return done(chosen ?? midForced(input), "MID-arsenal");
    }
    if (decision && /discard/i.test(decision.prompt) && !/Fire that Burns Within/i.test(decision.prompt) && input.view.activePlayer !== input.seat) {
      const reply = midReply(input, budget);
      if (reply.choice && input.legal.some((x) => JSON.stringify(x) === JSON.stringify(reply.choice))) return done(reply.choice, "MID-discard-marginal");
    }
    if (!input.state || !isCleanActionDecision(input.state, input.seat)) return done(midForced(input, { opening: input.view.turn === 1, closing: input.view.players[1 - input.seat]!.life <= 2, tools: true, paidAnger: false, origin: origin ?? resourceOrigin(input) }), "MID-resolution");
    if (reservedId !== undefined && !input.view.players[input.seat].hand.some((x) => x.instanceId === reservedId)) reservedId = undefined;
    const plan = planMidrange(input, {
      budget,
      reservedId,
      supportedFireIds: new Set(supportedFireIds),
      tiger: origin ? tigerFloating(input, origin) : 0,
    });
    if (plan && input.view.players[1 - input.seat]!.life > 2 &&
      ["tearing shuko", "pouncing paws", "blood scent"].includes(midSource(plan.intent,input))) {
      const supportedFire = plan.line.find((intent) =>
        (intent.kind === "play-card" || intent.kind === "play-from-arsenal") &&
        heldFireIds.has(intent.instanceId));
      if (supportedFire && "instanceId" in supportedFire) {
        supportedFireIds.add(supportedFire.instanceId);
      }
    }
    reservedId = plan?.evaluation.arsenalId;
    nextState.supportedFireIds = [...supportedFireIds].sort((left, right) => left - right);
    if (reservedId === undefined) delete nextState.reservedId;
    else nextState.reservedId = reservedId;
    return done(plan?.intent ?? midForced(input), input.view.turn === 1 ? "MID-opening-prepare" : "MID-route", plan);
}

export function createFaiMidrangeSession(
  initialState: FaiMidrangePolicyStateV1 = initialFaiMidrangePolicyState(),
) {
  let state = initialState;
  const chooseWithTrace = (input: BotPolicyInput): FaiMidrangeDecision => {
    const result = chooseFaiMidrangeWithState(input, state);
    state = result.nextState;
    return result.decision;
  };
  return {
    chooseWithTrace,
    chooseIntent: (input: BotPolicyInput): GameIntent => chooseWithTrace(input).intent,
    snapshot: (): FaiMidrangePolicyStateV1 => {
      const decoded = decodeFaiMidrangePolicyState(JSON.parse(JSON.stringify(state)) as unknown);
      if (!decoded) throw new Error("Fai Midrange produced invalid policy state");
      return decoded;
    },
  };
}
