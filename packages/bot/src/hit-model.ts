import type { CardData } from "@fyendal/shared";
import { hasType } from "@fyendal/shared";
import { DEFAULT_DRAW_VALUE, type HitChanceFor } from "./card-ev.js";
import type { BotPolicyInput } from "./policy.js";

/**
 * Chance that one of the bot's attacks hits, from the opponent's public
 * defenses and the style of their decklist. The opponent is modeled as
 * blocking when what a block stops (power plus on-hit value, raised at low
 * life) beats what it costs (armor wear, or hand cards worth less to a deck
 * built to block). Only public state and decklist counts are read.
 */
export interface DefenderProfile {
  handCount: number;
  life: number;
  /** Current defense of each opposing equipment piece that can block. */
  armor: readonly number[];
  /** 0 for a deck that races and takes hits, 1 for one that blocks all it can. */
  blockPropensity: number;
  /** Mean printed defense of the opposing deck's cards. */
  cardDefense: number;
}

/** Power of an attack not yet known, for effects not tied to one attack. */
export const TYPICAL_ATTACK_POWER = 4;
export const MIN_HIT_CHANCE = 0.05;
export const MAX_HIT_CHANCE = 0.95;
const DEFAULT_CARD_DEFENSE = 3;
const DEFAULT_BLOCK_PROPENSITY = 0.5;
const ARMOR_BLOCK_COST = 0.5;
/** A blocking card costs its full draw value to a racing deck, 30% of it to one built to block. */
const BLOCKING_DECK_CARD_DISCOUNT = 0.7;
/** Defenders keep cards for their own turn, so a block must clear this margin. */
const BLOCK_RESERVE = 1.5;
/** Damage equivalents over which the block decision goes from even to likely. */
const BLOCK_SCALE = 2;
/** Each hidden card a block needs might not defend enough. */
const BLOCKER_RELIABILITY = 0.9;
/** Below this life every point of damage weighs more. */
const PRESSURE_LIFE = 15;

type DeckStyle = Pick<DefenderProfile, "blockPropensity" | "cardDefense">;

const styleCache = new WeakMap<readonly string[], DeckStyle>();

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Block propensity and mean defense from the opponent's full decklist. */
export function deckStyle(
  list: readonly string[] | undefined,
  cards: Readonly<Record<string, CardData>>,
): DeckStyle {
  if (!list || list.length === 0) {
    return { blockPropensity: DEFAULT_BLOCK_PROPENSITY, cardDefense: DEFAULT_CARD_DEFENSE };
  }
  const cached = styleCache.get(list);
  if (cached) return cached;
  let total = 0;
  let reactions = 0;
  let attacks = 0;
  let blues = 0;
  let defended = 0;
  let defense = 0;
  for (const id of list) {
    const data = cards[id];
    if (!data) continue;
    total++;
    if (hasType(data, "defense-reaction")) reactions++;
    if (hasType(data, "action") && data.subtypes?.includes("attack")) attacks++;
    if (data.pitch === 3) blues++;
    if (data.defense !== undefined) {
      defended++;
      defense += data.defense;
    }
  }
  const share = (count: number) => total > 0 ? count / total : 0;
  const cardDefense = defended > 0 ? defense / defended : DEFAULT_CARD_DEFENSE;
  // Defense reactions, blues and sturdy cards mark a blocking deck; attack density a racing one.
  const style = {
    blockPropensity: clamp(
      DEFAULT_BLOCK_PROPENSITY + 2 * (share(reactions) - 0.1) + 0.8 * (share(blues) - 0.35) -
        0.8 * (share(attacks) - 0.5) + 0.15 * (cardDefense - DEFAULT_CARD_DEFENSE),
      0,
      1,
    ),
    cardDefense,
  };
  styleCache.set(list, style);
  return style;
}

/** The opponent's defenses now, or after refilling to intellect for the bot's next turn. */
export function defenderProfile(input: BotPolicyInput, nextTurn = false): DefenderProfile {
  const opponent = input.view.players[1 - input.seat]!;
  const intellect = input.cards[opponent.heroCardId]?.intellect ?? 4;
  const armor = Object.values(opponent.equipment).flatMap((card) => {
    const defense = card ? Math.max(0, card.defense ?? input.cards[card.cardId]?.defense ?? 0) : 0;
    return defense > 0 ? [defense] : [];
  });
  return {
    handCount: nextTurn ? Math.max(opponent.handCount, intellect) : opponent.handCount,
    life: opponent.life,
    armor,
    ...deckStyle(input.decklists?.opponent, input.cards),
  };
}

export function hitChance(power: number, onHit: number, profile: DefenderProfile): number {
  if (power <= 0) return MIN_HIT_CHANCE;
  const bestArmor = profile.armor.reduce((best, defense) => Math.max(best, defense), 0);
  const fromHand = Math.max(0, power - bestArmor);
  const cards = Math.ceil(fromHand / Math.max(1, profile.cardDefense));
  // A block the hand cannot complete still lets the hit through.
  if (cards > profile.handCount) return MAX_HIT_CHANCE;
  const cardCost = DEFAULT_DRAW_VALUE * (1 - BLOCKING_DECK_CARD_DISCOUNT * profile.blockPropensity);
  const cost = cards * cardCost + (bestArmor > 0 ? ARMOR_BLOCK_COST : 0);
  const pressure = 1 + Math.max(0, PRESSURE_LIFE - profile.life) / PRESSURE_LIFE;
  const lethal = power + onHit >= profile.life;
  const margin = (power + onHit) * pressure - cost - BLOCK_RESERVE;
  const blocks = lethal ? 1 : 1 / (1 + Math.exp(-margin / BLOCK_SCALE));
  return clamp(1 - blocks * BLOCKER_RELIABILITY ** cards, MIN_HIT_CHANCE, MAX_HIT_CHANCE);
}

/** Per-attack hit chance against the opponent's current or next-turn defenses. */
export function hitChanceAgainst(input: BotPolicyInput, nextTurn = false): HitChanceFor {
  const profile = defenderProfile(input, nextTurn);
  return (power, onHit) => hitChance(power, onHit, profile);
}

/** On-hit value a typical attack carrying it is expected to land. */
export function landedOnHit(input: BotPolicyInput, onHit: number, nextTurn = false): number {
  return onHit * hitChanceAgainst(input, nextTurn)(TYPICAL_ATTACK_POWER, onHit);
}
