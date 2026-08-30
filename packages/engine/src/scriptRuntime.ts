import {
  collectCardEventTriggerLayers,
  fireCardBanished,
  fireCardLeavesGraveyard,
  fireFriendlyAttackLost,
  fireFriendlyDestroyed,
  fireFriendlyEnterArena,
  fireHeroDealtDamage,
  fireOnFriendlyActivate,
  fireOnFriendlyCrank,
  fireOnFriendlyPlay,
  grantLinkGoAgain,
  notifyPlayerGainedGoAgain,
  queueTriggeredEvent,
  runHook,
} from "./eventSources.js";
import type { EngineRuntime } from "./runtimePorts.js";
import { makeCtx, makeCtxForTokenCreation } from "./scriptContext.js";

type ScriptRuntimeBindings = Pick<
  EngineRuntime,
  "events" | "makeCtx" | "makeCtxForTokenCreation"
>;

/** Bind recursive script and event execution to one immutable runtime. */
export function createScriptRuntime(runtime: EngineRuntime): ScriptRuntimeBindings {
  const bindEvent = (fn: (...args: any[]) => any) =>
    (...args: any[]) => fn(args[0], runtime, ...args.slice(1));
  return {
    events: Object.freeze({
      collectCardEventTriggerLayers: bindEvent(collectCardEventTriggerLayers),
      fireCardBanished: bindEvent(fireCardBanished),
      fireCardLeavesGraveyard: bindEvent(fireCardLeavesGraveyard),
      fireFriendlyAttackLost: bindEvent(fireFriendlyAttackLost),
      fireFriendlyDestroyed: bindEvent(fireFriendlyDestroyed),
      fireFriendlyEnterArena: bindEvent(fireFriendlyEnterArena),
      fireHeroDealtDamage: bindEvent(fireHeroDealtDamage),
      fireOnFriendlyActivate: bindEvent(fireOnFriendlyActivate),
      fireOnFriendlyCrank: bindEvent(fireOnFriendlyCrank),
      fireOnFriendlyPlay: bindEvent(fireOnFriendlyPlay),
      grantLinkGoAgain: bindEvent(grantLinkGoAgain),
      notifyPlayerGainedGoAgain: bindEvent(notifyPlayerGainedGoAgain),
      queueTriggeredEvent: bindEvent(queueTriggeredEvent),
      runHook: bindEvent(runHook),
    }),
    makeCtx: (...args: Parameters<EngineRuntime["makeCtx"]>) =>
      makeCtx(
        args[0],
        runtime,
        ...args.slice(1) as Parameters<EngineRuntime["makeCtx"]> extends readonly [unknown, ...infer Rest]
          ? Rest
          : never
      ),
    makeCtxForTokenCreation: (
      ...args: Parameters<EngineRuntime["makeCtxForTokenCreation"]>
    ) => makeCtxForTokenCreation(
      args[0],
      runtime,
      ...args.slice(1) as Parameters<EngineRuntime["makeCtxForTokenCreation"]> extends readonly [unknown, ...infer Rest]
        ? Rest
        : never
    ),
  };
}
