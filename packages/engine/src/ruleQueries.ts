import { dataOf, scriptOf } from "./cardProperties.js";

import { controlledPermanents } from "./sourceQueries.js";
import { logPublic, nameOf } from "./gameLog.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, PlayerState } from "./state.js";
import { currentLink } from "./zoneQueries.js";

/** Engine objects are JSON-safe; triggered layers retain independent
 * last-known snapshots when their sources leave play before resolution. */
export function snapshotSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Whether an opposing attack/stack object currently prohibits instant cards
 * and instant-speed ability activations for `seat`. */
export function opposingInstantsProhibited(
  state: GameStateInternal,
  seat: number,
): boolean {
  const link = currentLink(state);
  if (
    link &&
    link.attacker !== seat &&
    !link.resolved &&
    scriptOf(state, link.attackingCard.cardId, link.attackingCard)
      ?.opponentsCannotPlayOrActivateInstantsWhileActive === true
  ) return true;
  return state.stack.some((layer) =>
    layer.seat !== seat &&
    !!layer.card &&
    scriptOf(state, layer.card.cardId, layer.card)
      ?.opponentsCannotPlayOrActivateInstantsWhileActive === true
  );
}

/** Whether this seat is in the action phase affected by a blanket rule that
 * makes its action cards, activated abilities, and attacks lose go again. */
export function goAgainSuppressed(state: GameStateInternal, seat: number): boolean {
  const player = state.players[seat] as PlayerState | undefined;
  return !!player && state.activePlayer === seat &&
    Number(player.hero.counters?.goAgainSuppressedTurn ?? 0) === state.turn;
}

/** Resource increase on this hero's first attack during the stamped turn.
 * The effect lives on the hero so it survives the intervening cleanup. */
export function firstAttackExtraCost(
  state: GameStateInternal,
  player: PlayerState,
): number {
  if (Number(player.hero.counters?.firstAttackExtraCostTurn ?? 0) !== state.turn) return 0;
  return Math.max(0, Number(player.hero.counters?.firstAttackExtraCost ?? 0));
}

/** Consume the delayed first-attack increase after a legal attack is paid for. */
export function consumeFirstAttackExtraCost(
  state: GameStateInternal,
  player: PlayerState,
): void {
  if (firstAttackExtraCost(state, player) <= 0) return;
  delete player.hero.counters?.firstAttackExtraCost;
  delete player.hero.counters?.firstAttackExtraCostTurn;
}

/** Resource increase on this hero's first action during the stamped turn.
 * The effect lives on the hero so it survives the intervening cleanup. */
export function firstActionExtraCost(
  state: GameStateInternal,
  player: PlayerState,
): number {
  if (Number(player.hero.counters?.firstActionExtraCostTurn ?? 0) !== state.turn) return 0;
  return Math.max(0, Number(player.hero.counters?.firstActionExtraCost ?? 0));
}

/** Consume the delayed first-action increase after its cost is paid. */
export function consumeFirstActionExtraCost(
  state: GameStateInternal,
  player: PlayerState,
): void {
  if (firstActionExtraCost(state, player) <= 0) return;
  delete player.hero.counters?.firstActionExtraCost;
  delete player.hero.counters?.firstActionExtraCostTurn;
}

/** Whether a delayed cap prevents another action play or activation. */
export function actionLimitReached(state: GameStateInternal, player: PlayerState): boolean {
  const turn = Number(player.hero.counters?.actionLimitTurn ?? 0);
  const limit = Number(player.hero.counters?.actionLimit ?? 0);
  return turn === state.turn && limit > 0 &&
    Number(player.flags.actionsPlayedOrActivatedThisTurn ?? 0) >= limit;
}

/** Marked (CR 9.3): an opposing source's hit removes the marked condition as
 *  part of the hit event, before any hit-triggered effects resolve. Returns
 *  whether the target was marked when the hit occurred. */
export function removeMarkOnOpponentHit(
  state: GameStateInternal,
  sourceSeat: number,
  targetSeat: number,
): boolean {
  if (sourceSeat === targetSeat) return false;
  const hero = (state.players[targetSeat] as PlayerState).hero;
  if ((hero.counters?.marked ?? 0) <= 0) return false;
  delete hero.counters!.marked;
  logPublic(state, `${nameOf(state, hero.cardId)} is no longer marked`);
  return true;
}

/** Does this player control a life-tiebreak permanent (Line Crossers)? */
function hasLifeTiebreak(state: GameStateInternal, seat: number): boolean {
  const p = state.players[seat] as PlayerState;
  const permanents = [
    ...(Object.values(p.equipment).filter((c): c is CardInstance => !!c)),
    ...p.board,
  ];
  return permanents.some((c) => scriptOf(state, c.cardId, c)?.lifeTiebreak === true);
}

/** Compare two heroes' life totals: 1 = a has more, -1 = a has less, 0 = tied.
 *  Life-tiebreak permanents make ties count as more for their controller (and
 *  less for the other hero); tiebreaks on both sides cancel out. */
export function compareLife(state: GameStateInternal, aSeat: number, bSeat: number): number {
  const a = state.players[aSeat] as PlayerState;
  const b = state.players[bSeat] as PlayerState;
  if (a.life !== b.life) return a.life > b.life ? 1 : -1;
  const tieA = hasLifeTiebreak(state, aSeat);
  const tieB = hasLifeTiebreak(state, bSeat);
  if (tieA !== tieB) return tieA ? 1 : -1;
  return 0;
}

/** Does the player control a bow (weapon slot card with the bow subtype)? */
export function controlsBow(state: GameStateInternal, player: PlayerState): boolean {
  return player.weapons.some((w) => (dataOf(state, w.cardId).subtypes ?? []).includes("bow"));
}

/** Freeze is represented by an absolute turn counter on the object. Effects
 * that last until a start of turn use that turn as the expiry, so the object
 * is usable as soon as that turn begins. */
export function isFrozen(state: GameStateInternal, card: CardInstance): boolean {
  if (Number(card.counters?.frozenUntilTurn || 0) > state.turn) return true;
  const owner = (state.players as PlayerState[]).find((player) =>
    player.arsenal.some((candidate) => candidate.instanceId === card.instanceId)
  );
  if (!owner) return false;
  const hasCondition = controlledPermanents(state, owner.seat, { faceDownEquipment: false }).some(
    (permanent) =>
      nameOf(state, permanent.cardId).trim().toLowerCase() === "frostbite" ||
      Number(permanent.counters?.frozenUntilTurn ?? 0) > state.turn,
  );
  if (!hasCondition) return false;
  return (state.players as PlayerState[]).some((controller) =>
    controller.seat !== owner.seat &&
    controlledPermanents(state, controller.seat, { faceDownEquipment: false }).some((source) =>
      scriptOf(state, source.cardId, source)?.freezesOpposingArsenalConditionally === true
    )
  );
}
