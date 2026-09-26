import type { GameIntent } from "@fyendal/shared";

/** Defender staging may combine the individually advertised card options. */
export function isAdvertisedBotIntent(intent: GameIntent, legal: readonly GameIntent[]): boolean {
  if (legal.some((candidate) => JSON.stringify(candidate) === JSON.stringify(intent))) return true;
  if (intent.kind !== "stage-defenders") return false;
  const advertised = new Set(legal.flatMap((candidate) =>
    candidate.kind === "stage-defenders" ? candidate.instanceIds : []));
  return intent.instanceIds.length > 0
    && new Set(intent.instanceIds).size === intent.instanceIds.length
    && intent.instanceIds.every((id) => advertised.has(id));
}
