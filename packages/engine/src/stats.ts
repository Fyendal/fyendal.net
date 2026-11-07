import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, PlayerState } from "./state.js";
import { dataOf } from "./cardProperties.js";
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
    allyAbsorbed: [0, 0],
    lifeGained: [0, 0],
    lifeLost: [0, 0],
    cardsDisrupted: [0, 0],
  };
  state.gameStats.turns.push(row);
  return row;
}

/** Zones a card can be taken from by an opponent's effect for disruption stats. */
const DISRUPTED_ZONES: ReadonlySet<string> = new Set(["hand", "arsenal", "arena", "chain"]);

/** An opponent's effect destroyed, discarded, or banished this card; tokens
 * and the owner's own removals are not disruption. */
export function recordDisruption(
  state: GameStateInternal,
  causedBySeat: number | undefined,
  card: CardInstance,
  from: string,
): void {
  if (causedBySeat === undefined || causedBySeat === card.owner) return;
  if (!DISRUPTED_ZONES.has(from) || dataOf(state, card.cardId).cardType === "token") return;
  const row = beginStatsTurn(state);
  row.cardsDisrupted ??= [0, 0];
  addForSeat(row.cardsDisrupted, causedBySeat, 1);
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

export function recordAllyAbsorbed(
  state: GameStateInternal,
  defenderSeat: number,
  amount: number,
): void {
  if (amount <= 0) return;
  const row = beginStatsTurn(state);
  row.allyAbsorbed ??= [0, 0];
  addForSeat(row.allyAbsorbed, defenderSeat, amount);
}

export function recordLifeGained(state: GameStateInternal, seat: number, amount: number): void {
  if (amount <= 0) return;
  const row = beginStatsTurn(state);
  row.lifeGained ??= [0, 0];
  addForSeat(row.lifeGained, seat, amount);
}

/** Life loss that is not already counted as opponent damage. */
export function recordLifeLost(state: GameStateInternal, seat: number, amount: number): void {
  if (amount <= 0) return;
  const row = beginStatsTurn(state);
  row.lifeLost ??= [0, 0];
  addForSeat(row.lifeLost, seat, amount);
}

/** Per-turn `damageTakenFromType:<class/subtype>` totals for "damage dealt to them by clubs this turn". */
export function recordDamageTakenFromTypes(
  target: PlayerState,
  sourceTypes: readonly string[],
  amount: number,
): void {
  if (amount <= 0) return;
  for (const type of new Set(sourceTypes)) {
    const key = `damageTakenFromType:${type}`;
    target.flags[key] = (Number(target.flags[key]) || 0) + amount;
  }
}
