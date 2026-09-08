import type { GameMessage } from "@fyendal/shared";
import { scriptOf } from "./cardProperties.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { StackLayer } from "./state.js";
import { findCardAnywhere } from "./zoneQueries.js";

export const DESTROY_AT_END_PHASE_HOOK = "engine-destroy-at-end-phase";

/** Resolve semantic trigger metadata from the process-local script registry so
 * translations never become part of persisted room state. */
export function triggerLabelMessage(
  state: GameStateInternal,
  layer: StackLayer,
): GameMessage | undefined {
  if (
    layer.engineEffect?.kind === "delayed-trigger" &&
    layer.engineEffect.hook === DESTROY_AT_END_PHASE_HOOK
  ) {
    return {
      id: "engine.term.card.destroy",
      values: {
        card: { kind: "card", cardId: layer.engineEffect.source.cardId },
      },
    };
  }
  if (layer.triggerIndex < 0) return undefined;
  const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? layer.triggerSource;
  if (!source) return undefined;
  return scriptOf(state, source.cardId, source)?.triggers?.[layer.triggerIndex]?.labelMessage;
}
