import type { GameMessage } from "@fyendal/shared";
import { scriptOf } from "./cardProperties.js";
import { gameLogMessage, logCardValue, logPublic, nameOf, triggerLogMessage } from "./gameLog.js";
import type { TriggerDef } from "./scripts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, PlayerState, StackLayer } from "./state.js";
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
  if (layer.engineEffect?.kind === "on-enter-arsenal-hook") {
    return { id: "engine.term.enter.arsenal" };
  }
  if (layer.triggerIndex < 0) return undefined;
  const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? layer.triggerSource;
  if (!source) return undefined;
  return scriptOf(state, source.cardId, source)?.triggers?.[layer.triggerIndex]?.labelMessage;
}

export interface TriggerAnnouncement {
  text: string;
  message?: GameMessage;
}

/** The public "<source> triggers: <effect>" announcement. A face-down source
 * is named only by its controller's hero. */
export function triggerAnnouncement(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
  trigger: TriggerDef,
): TriggerAnnouncement {
  const text = card.faceDown
    ? `${nameOf(state, player.heroCardId)}'s face-down card triggers: ${trigger.label}`
    : trigger.publicLog ?? `${nameOf(state, card.cardId)} triggers: ${trigger.label}`;
  const message = card.faceDown && trigger.labelMessage
    ? triggerLogMessage(text, player.heroCardId, trigger.labelMessage, 1, "engine.log.trigger.facedown").message
    : trigger.publicLogMessage
      ? {
          ...trigger.publicLogMessage,
          values: {
            ...trigger.publicLogMessage.values,
            triggerSource: logCardValue(card.cardId),
            occurrences: 1,
          },
        }
      : !trigger.publicLog && trigger.labelMessage
        ? triggerLogMessage(text, card.cardId, trigger.labelMessage).message
        : undefined;
  return { text, ...(message ? { message } : {}) };
}

export function logTriggerAnnouncement(
  state: GameStateInternal,
  announcement: TriggerAnnouncement,
  occurrences: number,
): void {
  const fallback = `${announcement.text}${occurrences > 1 ? ` ×${occurrences}` : ""}`;
  if (!announcement.message) {
    logPublic(state, gameLogMessage(fallback, "engine.log.trigger.generic", { occurrences }));
    return;
  }
  logPublic(state, {
    fallback,
    message: {
      ...announcement.message,
      values: { ...announcement.message.values, occurrences },
    },
  });
}
