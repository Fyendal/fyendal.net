import type { CardView, PlayerView } from "@fyendal/shared";

type DeckVisibilityView = Pick<PlayerView, "visibleDeckTop">;

/** A continuous top-deck look ability projects that card in the deck zone.
 * Keep it facedown until an active shuffle animation has completed. */
export function visibleDeckTop(
  player: DeckVisibilityView,
  deckShuffling = false,
): CardView | undefined {
  return deckShuffling ? undefined : player.visibleDeckTop;
}
