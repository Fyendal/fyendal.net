import type { CardView, PlayerView } from "@fyendal/shared";
import type { CardPlayIntent } from "../store/types.js";

/** Project only the immediately knowable part of a submitted card play. The
 * server still owns every rules transition and the authoritative GameView. */
export function optimisticCardPlayHiddenIds(
  intent: CardPlayIntent | null,
  player: PlayerView,
  deckTop?: CardView,
): ReadonlySet<number> | null {
  if (!intent) return null;
  const card = intent.kind === "play-card"
    ? player.hand.find((candidate) => candidate.instanceId === intent.instanceId)
    : intent.kind === "play-from-arsenal"
      ? player.arsenal.find((candidate) => candidate.instanceId === intent.instanceId)
      : intent.zone === "banish"
        ? player.banish.find((candidate) => candidate.instanceId === intent.instanceId)
        : intent.zone === "graveyard"
          ? player.graveyard.find((candidate) => candidate.instanceId === intent.instanceId)
          : deckTop?.instanceId === intent.instanceId ? deckTop : undefined;
  if (!card) return null;
  return new Set([
    intent.instanceId,
    ...intent.pitchInstanceIds,
    ...(intent.alternativeCostCardInstanceIds ?? []),
  ]);
}
