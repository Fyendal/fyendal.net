import type { EngineRuntime } from "./runtimePorts.js";
import { instanceDataOf, scriptOf } from "./cardProperties.js";
import { basePowerOf, computeAttack, currentPowerOf } from "./combatValues.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, PlayerState } from "./state.js";
import { currentLink, opponent } from "./zoneQueries.js";

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
  const until = Number(player.hero.counters?.attackActionBasePowerLimitUntilTurn ?? 0);
  if (until !== state.turn) return false;
  const limit = Number(player.hero.counters?.attackActionBasePowerLimit ?? -1);
  return basePowerOf(state, runtime, player.seat, card, data.attack ?? 0) <= limit;
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
