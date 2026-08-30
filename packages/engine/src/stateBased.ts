import type { EngineRuntime } from "./runtimePorts.js";
import { scriptOf } from "./cardProperties.js";
import type { GameStateInternal } from "./runtimeState.js";
import { destroyPermanent } from "./zoneMoves.js";

/**
 * State-based actions, checked at intent boundaries (alongside checkWin):
 * destroy board permanents whose destroyAtZeroCounter-named counter was
 * explicitly reduced to 0 (Suspense's "when this has no suspense counters").
 */
export function checkStateBased(state: GameStateInternal, runtime: EngineRuntime): void {
  for (const p of state.players) {
    for (const c of [...p.board]) {
      const marker = scriptOf(state, c.cardId, c)?.destroyAtZeroCounter;
      if (!marker) continue;
      const n = c.counters?.[marker];
      if (n === undefined || n > 0) continue;
      destroyPermanent(state, runtime, p.seat, c);
    }
  }
}
