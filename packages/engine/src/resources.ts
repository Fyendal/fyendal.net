import type { EngineRuntime } from "./runtimePorts.js";
import { cardColorOf, instanceDataOf, isChiCard, scriptOf } from "./cardProperties.js";
import { hookSources } from "./sourceQueries.js";

import { logNameOf, logPublic, nameOf } from "./gameLog.js";
import { enumeratePitchSequences } from "./pitchSequences.js";
import type { GameStateInternal } from "./runtimeState.js";

import type { CardInstance, PlayerState } from "./state.js";
import { cardProhibitedByChosenName } from "./restrictions.js";

/** Pitch value of a card instance (back face while flipped — a flipped card
 *  pitches as Inner Chi for 3). */
export function pitchValueOfInstance(state: GameStateInternal, card: CardInstance): number {
  return instanceDataOf(state, card).pitch ?? 0;
}

/** Whether a delayed effect currently prohibits this player from pitching
 * this card. Color restrictions apply only to pitching, never to discarding,
 * revealing, or other additional costs. */
export function pitchProhibitedByEffect(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
): boolean {
  if (cardProhibitedByChosenName(state, card)) return true;
  const prohibitedColors = Number(player.hero.counters?.pitchColorsProhibitedMask ?? 0);
  const throughTurn = Number(player.hero.counters?.pitchColorProhibitedThroughTurn ?? 0);
  const color = cardColorOf(state, card);
  return prohibitedColors > 0 && color > 0 && state.turn <= throughTurn &&
    (prohibitedColors & (1 << (color - 1))) !== 0;
}

/** Record a pitch in the pitcher's per-turn flags: `pitchedPitch:<n>` counts
 *  (pitch 3 = blue, for "if you've pitched a blue card this turn"). */
export function notePitch(state: GameStateInternal, player: PlayerState, card: CardInstance): void {
  card.pitchCount = (card.pitchCount ?? 0) + 1;
  const color = cardColorOf(state, card);
  player.flags[`pitchedPitch:${color}`] = (Number(player.flags[`pitchedPitch:${color}`]) || 0) + 1;
  if (isChiCard(state, card)) {
    player.flags.pitchedChiCount = (Number(player.flags.pitchedChiCount) || 0) + 1;
  }
}

/** Add a pitched card's value to the right floating pool: chi-subtype cards
 *  gain chi points INSTEAD of resource points (CR 1.13.5). Transcended cards
 *  retain their Inner Chi back face for the remainder of the game (CR 9.1.5b). */
export function pitchIntoPool(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  card: CardInstance,
  pitch: number,
): void {
  const chi = isChiCard(state, card);
  const activeCardId = instanceDataOf(state, card).id;
  if (chi) {
    player.chi += pitch;
    logPublic(state, `${nameOf(state, player.heroCardId)} pitches ${logNameOf(state, activeCardId)} (${pitch} chi)`);
  } else {
    let gained = pitch;
    for (const source of hookSources(state, player.seat, { board: true, equipment: true, weapons: true })) {
      const replacement = scriptOf(state, source.cardId, source)?.replacePitchResources?.(
        runtime.makeCtx(state, player.seat, source),
        card,
        gained,
      );
      if (replacement !== undefined) gained = Math.max(0, Math.floor(replacement));
    }
    player.resources += gained;
    logPublic(state, `${nameOf(state, player.heroCardId)} pitches ${logNameOf(state, activeCardId)}`);
  }
  runtime.events.queueTriggeredEvent(
    state,
    "card-pitched",
    player.seat,
    card,
    { to: "pitch", causedBySeat: player.seat },
  );
}

/** Pay `amount` from the floating pools: chi points must be spent before
 *  resource points (CR 1.14.2c). */
export function payFromPools(player: PlayerState, amount: number): void {
  const fromChi = Math.min(player.chi, amount);
  player.chi -= fromChi;
  player.resources -= amount - fromChi;
}

/** Whether the announced play leaves enough cards in hand for its mandatory
 * scripted additional cost. The source, pitches, and other announced
 * hand-card costs cannot also pay this cost. */
export function canPayRequiredHandCardsForAdditionalCost(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
  unavailableInstanceIds: readonly number[] = [],
): boolean {
  const required = Math.max(
    0,
    Math.floor(scriptOf(state, card.cardId, card)?.requiredHandCardsForAdditionalCost ?? 0),
  );
  if (required === 0) return true;
  const unavailable = new Set([card.instanceId, ...unavailableInstanceIds]);
  return state.players[seat]!.hand.filter((candidate) =>
    !unavailable.has(candidate.instanceId)
  ).length >= required;
}

/** Enumerate legal hand-card payments for a scripted resource cost. The
 * labels are presentation-only option ids; the attached card ids remain the
 * authority used when the choice is applied. */
export function scriptedPaymentOptions(
  state: GameStateInternal,
  paying: PlayerState,
  cost: number,
  result: string,
  excludeInstanceIds: readonly number[] = [],
): Record<string, { cost: number; pitchIds: number[]; result: string }> {
  const available = paying.resources + paying.chi;
  const pitchable = paying.hand.filter(
    (card) => !excludeInstanceIds.includes(card.instanceId) &&
      pitchValueOfInstance(state, card) > 0 &&
      !pitchProhibitedByEffect(state, paying, card),
  );
  const options: Record<string, { cost: number; pitchIds: number[]; result: string }> = {};
  const describe = (ids: number[]): string => {
    if (ids.length === 0) return `pay ${cost}`;
    const names = ids.map((id) => {
      const card = paying.hand.find((candidate) => candidate.instanceId === id);
      return card ? nameOf(state, card.cardId) : String(id);
    });
    const base = `pay ${cost} — pitch ${names.join(" + ")}`;
    return options[base] === undefined ? base : `${base} (${ids.join(",")})`;
  };
  const add = (ids: number[]): void => {
    options[describe(ids)] = { cost, pitchIds: ids, result };
  };
  for (const ids of enumeratePitchSequences(
    pitchable.map((card) => ({
      instanceId: card.instanceId,
      value: pitchValueOfInstance(state, card),
    })),
    available,
    cost,
    48,
  )) add(ids);
  return options;
}
