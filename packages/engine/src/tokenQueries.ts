import type { GameStateInternal } from "./runtimeState.js";
import type { TokenCreationContext } from "./eventTypes.js";
import type { Modifier } from "./state.js";
import { findCardAnywhere } from "./zoneQueries.js";

/** Preserve the effect that generated a delayed token-creation modifier. */
export function tokenCreationCauseForModifier(
  state: GameStateInternal,
  modifier: Modifier,
): TokenCreationContext {
  const sourceCardId = modifier.sourceCardId ??
    findCardAnywhere(state, modifier.sourceInstanceId)?.card.cardId;
  return {
    kind: "effect",
    ...(sourceCardId ? { sourceCardId } : {}),
  };
}
