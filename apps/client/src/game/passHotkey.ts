import type { GameIntent, PassUntilMode, PendingDecision } from "@fyendal/shared";
import { explicitDeclineOption } from "./decisionPass.js";

type KeyboardTarget = {
  closest?: (selectors: string) => unknown;
};

function sameIds(actual: readonly number[], selected: readonly number[]): boolean {
  return actual.length === selected.length && actual.every((id) => selected.includes(id));
}

/** Resolve the script-provided Space default. Other optional decisions default
 * to their own No or Decline option. */
export function decisionSpaceOption(
  decision: PendingDecision | null,
): string | null {
  if (!decision) return null;
  const options = decision.options ?? [];
  if (decision.defaultOption && options.includes(decision.defaultOption)) {
    return decision.defaultOption;
  }
  if (decision.kind !== "optional-effect") return null;
  return explicitDeclineOption(decision);
}

/** Resolve Space to the exact legal completion for the current context. */
export function passHotkeyIntent(
  legal: readonly GameIntent[],
  decision: PendingDecision | null,
  pitchInstanceIds: readonly number[],
  boundedSelection: readonly string[] = [],
): GameIntent | null {
  if (decision?.minimumSelections !== undefined && decision.maximumSelections !== undefined) {
    const count = boundedSelection.length;
    return legal.some((intent) => intent.kind === "choose-many") &&
      count >= decision.minimumSelections && count <= decision.maximumSelections
      ? { kind: "choose-many", optionIds: [...boundedSelection] }
      : null;
  }
  if (decision?.kind === "defend") {
    const defenderIds = (decision.stagedCards ?? []).map((card) => card.instanceId);
    return legal.find((intent) =>
      intent.kind === "defend" &&
      sameIds(intent.instanceIds, defenderIds) &&
      sameIds(intent.pitchInstanceIds ?? [], pitchInstanceIds)
    ) ?? null;
  }
  const decisionOption = decisionSpaceOption(decision);
  if (decision?.defaultOption === decisionOption) {
    return legal.find((intent) =>
      intent.kind === "choose" && intent.optionId === decisionOption
    ) ?? null;
  }
  return legal.find((intent) => intent.kind === "pass") ?? null;
}

export function shouldConfirmArsenalPass(
  decision: PendingDecision | null,
  intent: GameIntent,
): boolean {
  return decision?.kind === "arsenal" && intent.kind === "pass";
}

/** Space passes only when it is an unmodified, non-repeating game shortcut.
 * Buttons and links deliberately do not opt out: preventDefault in the global
 * handler must suppress their native Space-to-click behavior so a previously
 * clicked card cannot activate again when the player means to pass. Editable
 * controls retain Space for text entry and native selection behavior. */
export function shouldPassOnSpace(
  event: Pick<KeyboardEvent, "code" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target">,
): boolean {
  if (
    event.code !== "Space" ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) return false;

  const target = event.target as KeyboardTarget | null;
  return !target?.closest?.(
    "input, textarea, select, [contenteditable='true']",
  );
}

/** Shift+Space passes the chain link and F6 (unlisted, kept for habit) the
 *  turn, outside text entry. Holding Space also passes the turn. */
export function passUntilHotkey(
  event: Pick<KeyboardEvent, "code" | "key" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target">,
): PassUntilMode | null {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null;
  const target = event.target as KeyboardTarget | null;
  if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return null;
  if (event.code === "Space" && event.shiftKey) return "chain-link";
  if (event.key === "F6" && !event.shiftKey) return "turn";
  return null;
}

/** Escape, or Space when it has no window to pass, stops an armed shortcut,
 *  outside text entry. */
export function passUntilStopHotkey(
  event: Pick<KeyboardEvent, "code" | "key" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target">,
  spacePasses: boolean,
): boolean {
  if (event.key === "Escape") {
    const target = event.target as KeyboardTarget | null;
    return !event.repeat && !target?.closest?.("input, textarea, select, [contenteditable='true']");
  }
  return !spacePasses && shouldPassOnSpace(event);
}

/** How long Space must be held, after its tap passed, to pass the turn. */
export const PASS_HOLD_MS = 500;

/** Resolve Space to the primary action in a local card announcement. */
export function actionConfirmationHotkey(
  event: Parameters<typeof shouldPassOnSpace>[0],
  step: "method" | "ability" | "payment" | "boost" | "target" | "close-chain" | "confirm",
  selectionActive: boolean,
): "select-default-boost" | "confirm-chain-close" | "confirm-action" | null {
  if (!selectionActive || !shouldPassOnSpace(event)) return null;
  if (step === "boost") return "select-default-boost";
  if (step === "close-chain") return "confirm-chain-close";
  if (step === "confirm") return "confirm-action";
  return null;
}
