import type { GameStateInternal } from "./runtimeState.js";
import type { PendingDecisionState } from "./state.js";

/** Preserve a later decision from the same resolving effect behind Crank. */
export function queueDecisionBehindCrank(
  state: GameStateInternal,
  decision: PendingDecisionState,
): boolean {
  const current = state.pendingDecision;
  if (current?.chooseHook !== "engine-crank") return false;
  (current.followUpDecisions ??= []).push(decision);
  return true;
}

/** Continue decisions that were deferred behind a resolved Crank prompt. */
export function continueFollowUpDecisions(
  state: GameStateInternal,
  followUps: PendingDecisionState[] | undefined,
): void {
  if (!followUps?.length) return;
  const current = state.pendingDecision;
  if (current) {
    (current.followUpDecisions ??= []).push(...followUps);
    return;
  }
  const [next, ...remaining] = followUps;
  if (!next) return;
  if (remaining.length) {
    next.followUpDecisions = [...(next.followUpDecisions ?? []), ...remaining];
  }
  state.pendingDecision = next;
}
