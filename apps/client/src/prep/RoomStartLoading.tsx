import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { useCardImagePreload } from "../game/cardImagePreload.js";
import {
  DECK_IMAGE_TIMEOUT_MS,
  deckPoolCardIds,
  PrepDeckLoading,
  PrepImageLoading,
} from "./PrepImageLoading.js";

/**
 * Bridges a room or bot start request to the prep room: the server refreshes
 * the Fabrary deck before the room exists, so the deck art downloads meanwhile
 * and the prep room's own image gate resumes from the warmed cache.
 */
export function RoomStartLoading() {
  const { prepDeck, leave } = useStore(useShallow((state) => ({
    prepDeck: state.prepDeck,
    leave: state.leave,
  })));
  const images = useCardImagePreload(
    prepDeck ? `start:${prepDeck.id}` : null,
    prepDeck ? deckPoolCardIds(prepDeck.decklist) : [],
    DECK_IMAGE_TIMEOUT_MS,
  );
  if (!prepDeck) return <PrepDeckLoading onCancel={leave} />;
  return <PrepImageLoading heroId={prepDeck.decklist.heroId} progress={images} onCancel={leave} />;
}
