import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { ScriptCtx, TriggerDef, TriggerEventContext, TriggerTarget } from "./scripts.js";
import type { CardInstance, StackLayer } from "./state.js";
import { scriptOf } from "./cardProperties.js";
import { gameLogMessage, logCardValue, logPublic, nameOf } from "./gameLog.js";
import { currentLink, findCardAnywhere } from "./zoneQueries.js";

/** Event facts a triggered layer persisted for its resolution effect. */
export function triggerLayerEventContext(layer: StackLayer): TriggerEventContext | undefined {
  return layer.triggerDamage ? { damage: layer.triggerDamage } : undefined;
}

/** The script trigger behind a triggered layer and the object its effect
 * reads. Card, ability, and engine-effect layers have none. */
function layerTrigger(
  state: GameStateInternal,
  layer: StackLayer,
): { def: TriggerDef; contextSource: CardInstance } | undefined {
  if (layer.triggerIndex < 0 || layer.card || layer.ability || layer.engineEffect) return undefined;
  const found = findCardAnywhere(state, layer.sourceInstanceId);
  const definitionSource = layer.triggerSource ?? found?.card;
  const contextSource = found?.card ?? definitionSource;
  if (!definitionSource || !contextSource) return undefined;
  const def = scriptOf(state, definitionSource.cardId, definitionSource)?.triggers?.[layer.triggerIndex];
  return def ? { def, contextSource } : undefined;
}

/** The target a triggered layer declares as it is added to the stack, and
 * the object whose context evaluates it: a script trigger's `target`, or the
 * `onHitTarget` / `onDefendTarget` / `onEnterArsenalTarget` of an engine hook
 * layer. */
export function layerTargetSpec(
  state: GameStateInternal,
  layer: StackLayer,
): { target: TriggerTarget; contextSource: CardInstance } | undefined {
  const effect = layer.engineEffect;
  if (
    effect?.kind === "on-hit-hook" ||
    effect?.kind === "on-defend-hook" ||
    effect?.kind === "on-enter-arsenal-hook"
  ) {
    const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? effect.source;
    const script = scriptOf(state, source.cardId, source);
    const target = effect.kind === "on-hit-hook"
      ? script?.onHitTarget
      : effect.kind === "on-defend-hook" ? script?.onDefendTarget : script?.onEnterArsenalTarget;
    return target ? { target, contextSource: source } : undefined;
  }
  const trigger = layerTrigger(state, layer);
  return trigger?.def.target ? { target: trigger.def.target, contextSource: trigger.contextSource } : undefined;
}

export function layerTargetOptions(
  state: GameStateInternal,
  runtime: EngineRuntime,
  layer: StackLayer,
  target: TriggerTarget,
  contextSource: CardInstance,
  ctx: ScriptCtx = runtime.makeCtx(state, layer.seat, contextSource, currentLink(state)),
): readonly number[] {
  return target.options(ctx, layer.triggerEventCard, triggerLayerEventContext(layer));
}

/** Whether a resolving layer may apply its effect: true unless it declared a
 * target that is no longer legal, in which case the effect fails (CR 1.8.9). */
export function declaredLayerTargetLegal(
  state: GameStateInternal,
  runtime: EngineRuntime,
  layer: StackLayer,
): boolean {
  const declared = layer.targetCardInstanceId;
  if (declared === undefined) return true;
  const spec = layerTargetSpec(state, layer);
  if (!spec) return true;
  if (layerTargetOptions(state, runtime, layer, spec.target, spec.contextSource).includes(declared)) return true;
  logPublic(state, gameLogMessage(
    `${nameOf(state, spec.contextSource.cardId)}'s triggered ability fails (its target is no longer legal)`,
    "engine.log.trigger.target.illegal",
    { card: logCardValue(spec.contextSource.cardId) },
  ));
  return false;
}
