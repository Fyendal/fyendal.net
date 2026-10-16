import type { PendingDecision } from "@fyendal/shared";

export function isPriorityGuidanceDecision(decision: PendingDecision | null): boolean {
  return decision?.kind === "priority-window" ||
    decision?.kind === "attack-reaction" ||
    decision?.kind === "defense-reaction";
}

/** Priority/reaction decisions are operated through highlighted cards and the
 * persistent status Pass button. Their floating panel is guidance only. */
export function shouldHidePriorityGuidance(
  decision: PendingDecision | null,
  options: {
    isMine: boolean;
    lessGuidance: boolean;
    mobileHandIsHidden: boolean;
  },
): boolean {
  if (!options.isMine || (!options.lessGuidance && !options.mobileHandIsHidden)) return false;
  return isPriorityGuidanceDecision(decision);
}

/** Priority/reaction guidance relies on the persistent status-float Pass
 * control. Other decisions may still need a Pass action in their panel. */
export function shouldShowDecisionPass(
  decision: PendingDecision | null,
  canPass: boolean,
): boolean {
  if (!canPass) return false;
  if (isPriorityGuidanceDecision(decision)) return false;
  if (decision?.kind === "arsenal") return false;
  if (decision?.kind !== "optional-effect") return true;
  return explicitDeclineOption(decision) === null;
}

/** The optional decision's own decline button ("no" for yes/no choices,
 * "decline" for engine use-or-decline offers), which a separate Pass would
 * duplicate. */
export function explicitDeclineOption(decision: PendingDecision): string | null {
  return (decision.options ?? []).find((option) =>
    ["no", "decline"].includes(option.trim().toLowerCase())) ?? null;
}
