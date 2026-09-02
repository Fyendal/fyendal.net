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

/** Keep Pass beside priority guidance as well as in the persistent status
 * float. A playable instant prevents auto-pass, and separating the only
 * escape from the explanatory prompt can make the game look stalled. */
export function shouldShowDecisionPass(
  decision: PendingDecision | null,
  canPass: boolean,
): boolean {
  if (!canPass) return false;
  if (decision?.kind === "arsenal") return false;
  if (decision?.kind !== "optional-effect") return true;
  return !(decision.options ?? []).some((option) => option.trim().toLowerCase() === "no");
}
