import type { GameIntent } from "@fyendal/shared";

/** Defender staging sends the full selection, including cards staged on an
 * earlier observation. Only newly added cards need a current advertisement. */
export function isAdvertisedBotIntent(
  intent: GameIntent,
  legal: readonly GameIntent[],
  stagedIds: readonly number[] = [],
): boolean {
  if (intent.kind !== "stage-defenders") {
    return legal.some((candidate) => JSON.stringify(candidate) === JSON.stringify(intent));
  }
  const advertised = new Set(legal.flatMap((candidate) =>
    candidate.kind === "stage-defenders" ? candidate.instanceIds : []));
  const staged = new Set(stagedIds);
  return intent.instanceIds.length > staged.size
    && new Set(intent.instanceIds).size === intent.instanceIds.length
    && stagedIds.every((id) => intent.instanceIds.includes(id))
    && intent.instanceIds.every((id) => staged.has(id) || advertised.has(id));
}
