import type { GameIntent, PendingDecision } from "@fyendal/shared";

type KeyboardTarget = {
  closest?: (selectors: string) => unknown;
};

function sameIds(actual: readonly number[], selected: readonly number[]): boolean {
  return actual.length === selected.length && actual.every((id) => selected.includes(id));
}

/** Resolve the script-provided Space default. Legacy optional decisions retain
 * the established No default until their scripts opt into another choice. */
export function decisionSpaceOption(
  decision: PendingDecision | null,
): string | null {
  if (!decision) return null;
  const options = decision.options ?? [];
  if (decision.defaultOption && options.includes(decision.defaultOption)) {
    return decision.defaultOption;
  }
  if (decision.kind !== "optional-effect") return null;
  const no = options.find((option) => option.trim().toLowerCase() === "no") ?? null;
  return no;
}

/** Resolve Space to the exact legal completion for the current context. */
export function passHotkeyIntent(
  legal: readonly GameIntent[],
  decision: PendingDecision | null,
  pitchInstanceIds: readonly number[],
): GameIntent | null {
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
