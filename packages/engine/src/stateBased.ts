import type { EngineRuntime } from "./runtimePorts.js";
import { scriptOf } from "./cardProperties.js";
import type { GameStateInternal } from "./runtimeState.js";
import { enforceUnique } from "./unique.js";
import { destroyPermanent } from "./zoneMoves.js";

/**
 * State-based actions, checked at intent boundaries (alongside checkWin):
 * destroy board permanents whose destroyAtZeroCounter-named counter was
 * explicitly reduced to 0 (Suspense's "when this has no suspense counters"),
 * then clear Unique conflicts.
 */
export function checkStateBased(state: GameStateInternal, runtime: EngineRuntime): void {
  // A leave-arena choice from a destroyed permanent replaces an open layer priority
  // window. Resume the stack for the same holder once that choice is answered.
  const priorityWindow = state.pendingDecision?.kind === "priority-window" ? state.pendingDecision : undefined;
  for (const p of state.players) {
    for (const c of [...p.board]) {
      const marker = scriptOf(state, c.cardId, c)?.destroyAtZeroCounter;
      if (!marker) continue;
      const n = c.counters?.[marker];
      if (n === undefined || n > 0) continue;
      destroyPermanent(state, runtime, p.seat, c);
    }
  }
  enforceUnique(state, runtime);
  const raised = state.pendingDecision;
  if (priorityWindow && raised !== priorityWindow && raised?.chooseHook) {
    raised.resume ??= { kind: "continue-stack", seat: priorityWindow.player };
  }
}
