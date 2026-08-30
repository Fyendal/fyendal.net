import type { GameStateInternal } from "./runtimeState.js";
import type { GameTurnStatsView } from "@fyendal/shared";

function addForSeat(values: [number, number], seat: number, amount: number): void {
  if (seat === 0) values[0] += amount;
  else values[1] += amount;
}

/** Ensure even a quiet turn appears in the end-game round breakdown. */
export function beginStatsTurn(state: GameStateInternal): GameTurnStatsView {
  const current = state.gameStats.turns.at(-1);
  if (current?.turn === state.turn) return current;
  const row: GameTurnStatsView = {
    turn: state.turn,
    activePlayer: state.activePlayer,
    attacks: [0, 0],
    threatened: [0, 0],
    blocked: [0, 0],
    damageDealt: [0, 0],
  };
  state.gameStats.turns.push(row);
  return row;
}

export function recordAttackStats(
  state: GameStateInternal,
  attacker: number,
  defender: number,
  threatened: number,
  blocked: number,
): void {
  const row = beginStatsTurn(state);
  addForSeat(row.attacks, attacker, 1);
  addForSeat(row.threatened, attacker, Math.max(0, threatened));
  addForSeat(row.blocked, defender, Math.max(0, blocked));
}

export function recordEffectThreat(
  state: GameStateInternal,
  sourceSeat: number,
  amount: number,
): void {
  if (amount <= 0) return;
  addForSeat(beginStatsTurn(state).threatened, sourceSeat, amount);
}

export function recordHeroDamage(
  state: GameStateInternal,
  sourceSeat: number,
  amount: number,
): void {
  if (amount <= 0) return;
  addForSeat(beginStatsTurn(state).damageDealt, sourceSeat, amount);
}
