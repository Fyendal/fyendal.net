import type { TokenSkipKind } from "@fyendal/shared";
import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { StackLayer } from "./state.js";

import { continueStack, passWindow } from "./triggers.js";
import { scriptOf } from "./cardProperties.js";
import { answerArcaneBarrier } from "./damageResolution.js";
import { findCardAnywhere } from "./zoneQueries.js";

type TokenSkipStep = "pass" | "decline" | "pay 0";

export const TOKEN_SKIP_INTENTS = {
  runechant: "skip-runechant",
  "seismic-surge": "skip-seismic-surge",
} as const satisfies Record<TokenSkipKind, string>;

function layerSkipKind(state: GameStateInternal, layer: StackLayer | undefined): TokenSkipKind | null {
  if (!layer) return null;
  const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? layer.triggerSource;
  if (!source) return null;
  const script = scriptOf(state, source.cardId, source);
  if (script?.runechantToken === true) return "runechant";
  if (script?.seismicSurgeToken === true) return "seismic-surge";
  return null;
}

/** Whether the current stack resolution still belongs to one continuous run
 * of this token kind. Damage-prevention decisions can outlive a Runechant's
 * stack layer, so the tagged arcane-damage continuation is authoritative in
 * that case. Once neither condition holds, a server shortcut must expire
 * before it can affect a later priority window or token trigger. */
export function tokenSkipSequenceActive(state: GameStateInternal, kind: TokenSkipKind): boolean {
  if (kind === "runechant" && state.pendingDecision?.arcane?.sourceIsRunechant === true) return true;
  return layerSkipKind(state, state.stack[0]) === kind;
}

/** The token run this seat may skip now, with the one safe automatic answer
 * for its current step. Mandatory prevention choices (such as Ward)
 * deliberately return no answer. */
export function currentTokenSkip(
  state: GameStateInternal,
  seat: number,
): { kind: TokenSkipKind; step: TokenSkipStep } | null {
  const decision = state.pendingDecision;
  if (!decision || decision.player !== seat) return null;
  if (decision.kind === "priority-window") {
    const kind = layerSkipKind(state, state.stack[0]);
    return kind ? { kind, step: "pass" } : null;
  }
  if (!decision.arcane?.sourceIsRunechant) return null;
  if (decision.chooseHook === "arcane-barrier" && decision.options?.includes("pay 0")) {
    return { kind: "runechant", step: "pay 0" };
  }
  if (
    ["discard-damage-prevention", "optional-damage-prevention", "quell", "spellvoid"]
      .includes(decision.chooseHook ?? "") &&
    decision.options?.includes("decline")
  ) {
    return { kind: "runechant", step: "decline" };
  }
  return null;
}

export function skipTokenStep(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  kind: TokenSkipKind,
): string | undefined {
  const skip = currentTokenSkip(state, seat);
  if (skip?.kind !== kind) return `no ${kind} step to skip`;
  const { step } = skip;
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
