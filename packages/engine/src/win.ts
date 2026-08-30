import type { GameStateInternal } from "./runtimeState.js";
import { logPublic, nameOf } from "./gameLog.js";

import { opponent } from "./zoneQueries.js";

export function checkWin(state: GameStateInternal): boolean {
  if (state.winner !== null) return true;
  for (const player of state.players) {
    if (player.life > 0) continue;
    state.winner = opponent(player.seat);
    state.phase = "game-over";
    state.pendingDecision = null;
    logPublic(
      state,
      `${nameOf(state, state.players[state.winner]?.heroCardId ?? "")} wins the game!`,
    );
    return true;
  }
  return false;
}
