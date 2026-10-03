import type { CombatPresentation } from "../attackLayerPresentation.js";
import type { MotionBatchQueue } from "./motionBatchQueue.js";
import { motionPresentationKey } from "./motionTypes.js";

/** Float changes follow animationstart, after the flight's CSS delay, rather
 * than the server update or the beginning of a multi-phase motion batch. */
export function motionCombatPresentation(
  current: CombatPresentation,
  queue: MotionBatchQueue,
  startedFlightIds: ReadonlySet<string>,
): CombatPresentation & { deferChain: boolean; deferStack: boolean } {
  const batches = queue.active ? [queue.active, ...queue.pending] : [];
  const flights = batches.flatMap((batch) => batch.flights);
  const arrivingAttack = current.chain.at(-1)?.attackingCard.instanceId;
  const chainKey = arrivingAttack === undefined ? undefined : motionPresentationKey(
    { kind: "chain-attack", link: current.chain.length - 1 }, arrivingAttack,
  );
  const chainFlight = chainKey === undefined ? undefined
    : flights.find((flight) => flight.destinationPresentationKey === chainKey);
  let waiting: CombatPresentation | undefined;
  if (!chainFlight || !startedFlightIds.has(chainFlight.id)) {
    const hasAttackOnStack = (presentation: CombatPresentation | undefined) => (
      arrivingAttack !== undefined && presentation
      && !presentation.chain.some((link) => link.attackingCard.instanceId === arrivingAttack)
      && presentation.stack.some((layer) => layer.card?.instanceId === arrivingAttack)
    );
    for (const batch of batches) {
      if (hasAttackOnStack(batch.combatPresentation)) {
        waiting = batch.combatPresentation;
        break;
      }
      // Retain the outgoing stack through any payment/reflow delay in the
      // resolution batch, until this exact stack-to-chain flight departs.
      if (chainFlight && batch.flights.includes(chainFlight)
        && hasAttackOnStack(batch.sourceCombatPresentation)) {
        waiting = batch.sourceCombatPresentation;
        break;
      }
    }
  }
  const stack = waiting?.stack ?? current.stack;
  const deferStack = stack.length > 0 && stack.every((layer, index) => {
    if (!layer.card) return false;
    const key = motionPresentationKey({ kind: "stack-layer", index }, layer.card.instanceId);
    const entry = flights.find((flight) => flight.destinationPresentationKey === key);
    return entry !== undefined && !startedFlightIds.has(entry.id);
  });
  return {
    ...current,
    ...(waiting ? { stack, context: waiting.context } : {}),
    deferChain: waiting !== undefined || (chainFlight !== undefined && !startedFlightIds.has(chainFlight.id)),
    deferStack,
  };
}
