import type { GameIntent } from "@fyendal/shared";
import type { BotPolicyInput } from "./policy.js";
import { createFaiAggroSession, type FaiAggroDecision } from "./fai-aggro-policy.js";
import { createFaiMidrangeSession, type FaiMidrangeDecision } from "./fai-midrange-policy.js";
import type { FaiPolicyStateV1 } from "./fai-policy-state.js";
import type { FaiStrategy } from "./sideboard.js";

export type FaiProductionDecision = FaiAggroDecision | FaiMidrangeDecision;

export interface FaiProductionSession {
  strategy: FaiStrategy;
  chooseIntent(input: BotPolicyInput): GameIntent;
  chooseWithTrace(input: BotPolicyInput): FaiProductionDecision;
  snapshot(): FaiPolicyStateV1;
}

export interface FaiProductionStatefulDecision {
  strategy: FaiStrategy;
  decision: FaiProductionDecision;
  nextState: FaiPolicyStateV1;
}

/** The selected presentation is durable game state. Infer the matching policy
 * from Fai's equipped weapon so worker restarts never need a separate routing
 * flag: the two-handed Searing Emberblade uniquely identifies Midrange. */
export function faiStrategyFromInput(input: BotPolicyInput): FaiStrategy {
  const weaponNames = input.view.players[input.seat].weapons.map((weapon) =>
    input.cards[weapon.cardId]?.name.trim().toLowerCase() ?? ""
  );
  return weaponNames.includes("searing emberblade") ? "midrange" : "aggro";
}

export function createFaiProductionSession(
  input: BotPolicyInput,
  initialState?: FaiPolicyStateV1,
): FaiProductionSession {
  const strategy = faiStrategyFromInput(input);
  if (initialState && initialState.strategy !== strategy) {
    throw new Error(`Fai ${strategy} presentation cannot restore ${initialState.strategy} policy state`);
  }
  const session = strategy === "midrange"
    ? createFaiMidrangeSession(initialState?.strategy === "midrange" ? initialState : undefined)
    : createFaiAggroSession(initialState?.strategy === "aggro" ? initialState : undefined);
  return { strategy, ...session };
}

export function chooseFaiProductionWithState(
  input: BotPolicyInput,
  previousState?: FaiPolicyStateV1,
): FaiProductionStatefulDecision {
  const session = createFaiProductionSession(input, previousState);
  const decision = session.chooseWithTrace(input);
  return { strategy: session.strategy, decision, nextState: session.snapshot() };
}
