import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";

import { continueStack, passWindow } from "./triggers.js";
import { scriptOf } from "./cardProperties.js";
import { answerArcaneBarrier } from "./damageResolution.js";
import { findCardAnywhere } from "./zoneQueries.js";

type RunechantSkipStep = "pass" | "decline" | "pay 0";

/** Whether the current stack resolution still belongs to one continuous
 * Runechant run. Damage-prevention decisions can outlive the Runechant's
 * stack layer, so the tagged arcane-damage continuation is authoritative in
 * that case. Once neither condition holds, a server shortcut must expire
 * before it can affect a later priority window or Runechant trigger. */
export function runechantSequenceActive(state: GameStateInternal): boolean {
  if (state.pendingDecision?.arcane?.sourceIsRunechant === true) return true;
  const layer = state.stack[0];
  if (!layer) return false;
  const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? layer.triggerSource;
  return !!source && scriptOf(state, source.cardId, source)?.runechantToken === true;
}

/** The one safe automatic answer for the current Runechant step. Mandatory
 * prevention choices (such as Ward) deliberately return no answer. */
export function runechantSkipStep(
  state: GameStateInternal,
  seat: number,
): RunechantSkipStep | null {
  const decision = state.pendingDecision;
  if (!decision || decision.player !== seat) return null;
  if (decision.kind === "priority-window") {
    const layer = state.stack[0];
    const source = layer ? findCardAnywhere(state, layer.sourceInstanceId)?.card : undefined;
    return source && scriptOf(state, source.cardId, source)?.runechantToken === true
      ? "pass"
      : null;
  }
  if (!decision.arcane?.sourceIsRunechant) return null;
  if (decision.chooseHook === "arcane-barrier" && decision.options?.includes("pay 0")) {
    return "pay 0";
  }
  if (
    ["discard-damage-prevention", "optional-damage-prevention", "quell", "spellvoid"]
      .includes(decision.chooseHook ?? "") &&
    decision.options?.includes("decline")
  ) {
    return "decline";
  }
  return null;
}

export function skipRunechantStep(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
): string | undefined {
  const step = runechantSkipStep(state, seat);
  if (step === null) return "no Runechant step to skip";
  if (step === "pass") return passWindow(state, runtime, seat);

  const resume = state.pendingDecision?.resume;
  const error = answerArcaneBarrier(state, runtime, seat, step);
  if (error) return error;
  if (resume && state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume = resume;
  } else if (resume?.kind === "continue-stack") {
    continueStack(state, runtime, resume.seat);
  }
  return undefined;
}
