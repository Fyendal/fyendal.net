import type { CardView, PlayerView } from "@fyendal/shared";
import type { OptimisticInteractionIntent } from "../store/types.js";

/** Hide only costs whose departure is knowable from the submitted interaction.
 * The server still owns every rules transition and the authoritative view. */
export function optimisticInteractionHiddenIds(
  intent: OptimisticInteractionIntent | null,
  player: PlayerView,
  deckTop?: CardView,
): ReadonlySet<number> | null {
  if (!intent || (
    intent.kind !== "play-card"
    && intent.kind !== "play-from-arsenal"
    && intent.kind !== "play-from-zone"
    && intent.kind !== "activate-ability"
  )) return null;
  if (intent.kind !== "activate-ability" && intent.deferPlayPresentation) return null;
  if (intent.kind === "activate-ability") {
    return new Set([
      ...intent.pitchInstanceIds,
      ...(intent.alternativeCostCardInstanceIds ?? []),
    ]);
  }
  const card = intent.kind === "play-card"
    ? player.hand.find((candidate) => candidate.instanceId === intent.instanceId)
    : intent.kind === "play-from-arsenal"
      ? player.arsenal.find((candidate) => candidate.instanceId === intent.instanceId)
      : intent.zone === "banish"
        ? player.banish.find((candidate) => candidate.instanceId === intent.instanceId)
        : intent.zone === "graveyard"
          ? player.graveyard.find((candidate) => candidate.instanceId === intent.instanceId)
          : deckTop?.instanceId === intent.instanceId ? deckTop : undefined;
  const hiddenIds = [
    ...(card ? [intent.instanceId] : []),
    ...intent.pitchInstanceIds,
    ...(intent.alternativeCostCardInstanceIds ?? []),
  ];
  return hiddenIds.length > 0 ? new Set(hiddenIds) : null;
}
