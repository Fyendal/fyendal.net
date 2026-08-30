import type { GameStateInternal } from "./runtimeState.js";
import type { PendingDecisionState } from "./state.js";
import { opponent } from "./zoneQueries.js";

/**
 * The pass/play protocol of a priority window (reaction step, layer window):
 * passing bumps the pass counter — two consecutive passes advance the game,
 * otherwise priority flips and the window reopens for the next player;
 * playing a card resets the counter and keeps priority with the player.
 */
export interface PriorityWindow {
  phase: "layer" | "reaction";
  passField: "stackPasses" | "reactionPasses";
  noWindowError: string;
  buildDecision(state: GameStateInternal, player: number): PendingDecisionState;
  onBothPass(state: GameStateInternal): void;
}

export function passPriorityWindow(
  state: GameStateInternal,
  seat: number,
  window: PriorityWindow,
): string | undefined {
  if (state.phase !== window.phase) return window.noWindowError;
  if (state.priorityPlayer !== seat) return "not your priority";
  state[window.passField]++;
  if (state[window.passField] >= 2) {
    window.onBothPass(state);
    return undefined;
  }
  state.priorityPlayer = opponent(seat);
  state.pendingDecision = window.buildDecision(state, state.priorityPlayer);
  return undefined;
}

/** After a play: the priority holder keeps priority and may play more; priority only passes when they pass. */
export function holdPriorityWindow(
  state: GameStateInternal,
  seat: number,
  window: PriorityWindow,
): void {
  state[window.passField] = 0;
  state.priorityPlayer = seat;
  state.pendingDecision = window.buildDecision(state, seat);
}
