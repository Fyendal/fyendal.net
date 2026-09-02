import type { GameMessage } from "@fyendal/shared";
import { scriptOf } from "./cardProperties.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { StackLayer } from "./state.js";
import { findCardAnywhere } from "./zoneQueries.js";

/** Resolve semantic trigger metadata from the process-local script registry so
 * translations never become part of persisted room state. */
export function triggerLabelMessage(
  state: GameStateInternal,
  layer: StackLayer,
): GameMessage | undefined {
  if (layer.triggerIndex < 0) return undefined;
  const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? layer.triggerSource;
  if (!source) return undefined;
  return scriptOf(state, source.cardId, source)?.triggers?.[layer.triggerIndex]?.labelMessage;
}
