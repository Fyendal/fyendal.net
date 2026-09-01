import type { EngineRuntime } from "./runtimePorts.js";
import { instanceDataOf, scriptOf, wardValueOf } from "./cardProperties.js";
import { basePowerOf, computeAttack, currentPowerOf, grantsAuraAttackMarker } from "./combatValues.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, PlayerState } from "./state.js";
import { currentLink, opponent } from "./zoneQueries.js";

/** Whether a turn-scoped effect prohibits this player from attacking with
 * weapons. Callers still identify whether the proposed attack source is a
 * weapon, including objects temporarily made into weapons. */
export function weaponAttacksProhibited(player: PlayerState): boolean {
  return player.flags.cannotAttackWithWeaponsThisTurn === true;
}

/** A delayed effect may prohibit attack action cards up to a base-power
 * threshold during a specific turn (Crush the Weak). The turn stamp lives on
 * the affected hero so it survives the intervening end-phase cleanup. */
export function attackActionPlayRestricted(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  card: CardInstance,
): boolean {
  const data = instanceDataOf(state, card);
  if (data.cardType !== "action" || !(data.subtypes ?? []).includes("attack")) return false;
  if (attackBasePowerRestricted(state, runtime, player.seat, card)) return true;
  const until = Number(player.hero.counters?.attackActionBasePowerLimitUntilTurn ?? 0);
  if (until !== state.turn) return false;
  const limit = Number(player.hero.counters?.attackActionBasePowerLimit ?? -1);
  return basePowerOf(state, runtime, player.seat, card, data.attack ?? 0) <= limit;
}

/** Whether a delayed effect prohibits playing or activating this attack based
 * on its base power. The restriction applies to attack action cards, weapons,
 * allies, and granted aura attacks, but never to non-attack actions. */
export function attackBasePowerRestricted(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
): boolean {
  const minimum = state.modifiers.reduce((required, modifier) =>
    modifier.seat === seat &&
    !modifier.consumed &&
    modifier.minimumAttackBasePower !== undefined
      ? Math.max(required, modifier.minimumAttackBasePower)
      : required, 0);
  if (minimum <= 0) return false;
  const player = state.players[seat] as PlayerState;
  const data = instanceDataOf(state, card);
  const auraAttack = grantsAuraAttackMarker(state, player, card);
  const rawPower = data.attack ?? auraAttack?.basePower ?? wardValueOf(data) ?? 0;
  return basePowerOf(state, runtime, seat, card, rawPower) < minimum;
}

/** Exude-style combat restriction after defenders are committed. */
export function defendingHeroCannotRespondBelowPower(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
): boolean {
  const link = currentLink(state);
  if (!link || seat !== opponent(link.attacker)) return false;
  if (scriptOf(state, link.attackingCard.cardId, link.attackingCard)?.defendingHeroCannotRespondBelowPower !== true) {
    return false;
  }
  const attackPower = computeAttack(state, runtime, link);
  return !link.defendingCards.some((card) => currentPowerOf(state, runtime, card, link) >= attackPower);
}
