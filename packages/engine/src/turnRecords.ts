import type { CardColor } from "@fyendal/shared";
import type { PlayerState } from "./state.js";

/** Per-turn play and pitch tallies. They live in `player.flags` under
 *  engine-private keys, so `turn.ts` wipes them with the other turn flags and
 *  persisted state keeps its existing shape. Scripts read them through the
 *  typed `ScriptCtx` queries, never by key. */

export type CardColorName = "red" | "yellow" | "blue" | "purple";

const COLOR_NUMBERS: Record<CardColorName, CardColor> = { red: 1, yellow: 2, blue: 3, purple: 4 };

export type PitchedFilter =
  | { readonly color: CardColorName }
  | { readonly subtype: "chi" };

const pitchedColorKey = (color: CardColor | 0) => `pitchedPitch:${color}`;
const playedColorKey = (color: CardColor | 0) => `playedPitch:${color}`;
const PITCHED_CHI_KEY = "pitchedChiCount";
const ARCANE_DAMAGE_CARDS_PLAYED_KEY = "arcaneDamageCardsPlayedThisTurn";

function readCount(player: PlayerState, key: string): number {
  return Number(player.flags[key]) || 0;
}

function bump(player: PlayerState, key: string): void {
  player.flags[key] = readCount(player, key) + 1;
}

export function recordPitched(player: PlayerState, color: CardColor | 0, chi: boolean): void {
  bump(player, pitchedColorKey(color));
  if (chi) bump(player, PITCHED_CHI_KEY);
}

export function recordPlayed(player: PlayerState, color: CardColor | 0, arcaneDamage: boolean): void {
  if (arcaneDamage) bump(player, ARCANE_DAMAGE_CARDS_PLAYED_KEY);
  bump(player, playedColorKey(color));
}

/** Cards of one color, or with the chi subtype, pitched this turn. */
export function pitchedThisTurn(player: PlayerState, filter: PitchedFilter): number {
  return "subtype" in filter
    ? readCount(player, PITCHED_CHI_KEY)
    : readCount(player, pitchedColorKey(COLOR_NUMBERS[filter.color]));
}

/** Cards of the given color played this turn, including the card now being
 *  played once its play has been recorded. */
export function playedThisTurn(player: PlayerState, color: CardColorName): number {
  return readCount(player, playedColorKey(COLOR_NUMBERS[color]));
}

export function arcaneDamageCardsPlayedThisTurn(player: PlayerState): number {
  return readCount(player, ARCANE_DAMAGE_CARDS_PLAYED_KEY);
}
