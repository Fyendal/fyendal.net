import type { CardData } from "@fyendal/shared";
import type { SolverCardKind } from "./hand-solver.js";
import {
  averageOver,
  probabilityAtLeastOne,
  totalCount,
  unseenCounts,
} from "./deck-knowledge.js";
import type { BotPolicyInput } from "./policy.js";

/**
 * Per-card expressed value (EV) in damage equivalents, following the FaBrain
 * card-value model: an attack is worth the damage it imposes, a block the
 * damage it actually stops, and pitch only what it funds.
 */

/** Arsenal value of an attack without go again, relative to its attack value.
 * It competes with next turn's hand for the single terminal attack slot. */
export const ARSENAL_TERMINAL_FACTOR = 0.6;
export const DISRUPTION_BASE = 0.05;
export const DISRUPTION_CAP = 0.3;
/** Chance an opposing arsenal-disrupting attack connects, given it is held. */
export const DISRUPTION_HIT_CHANCE = 0.5;
/** Defense reactions are spent during the same opposing turn disruption
 * would arrive, so they carry half the discount. */
export const DEFENSE_REACTION_DISCOUNT_SHARE = 0.5;
/** FaBrain's per-card benchmark for a solid limited deck; used only when the
 * bot's own decklist is unknown. */
export const DEFAULT_DRAW_VALUE = 3.25;
/** Typical opposing attack size a held card would block. */
export const TYPICAL_INCOMING = 4;
/** Share of held blocking value expected to be used on the opposing turn. */
export const BLOCK_USE_RATE = 0.75;
/** Damage a pitched resource funds when it is actually spent. */
export const PITCH_FUNDING_RATE = 0.75;
export const DEFAULT_HIT_CHANCE = 0.6;

/** Static description of a card's possible uses, independent of turn state. */
export interface CardUses {
  kind: SolverCardKind;
  power: number;
  defense: number;
  pitch: number;
  onHit: number;
  /** Printed go again, or conditional go again the hero model expects to hold. */
  reliableGoAgain: boolean;
  /** A terminal attack the hero model expects to end this turn's chain with,
   * so it does not compete for a later hand's terminal slot. */
  finisher?: boolean;
  /** Pump value: power an attack reaction or "next attack" effect adds. */
  pump: number;
  /** Extra value of pump riders, such as granting go again. */
  pumpRider?: number;
  /** Ambush: can defend from arsenal like a card in hand. */
  ambush?: boolean;
  /** A blue card that is still worth playing out of arsenal: printed
   * "played from arsenal" bonuses, or set by hero rules. */
  arsenalPlay?: boolean;
  /** Damage-equivalent value of a mode usable only from hand, outside its
   * attack, block or pitch: printed damage prevention, or a hero-rule effect
   * such as banishing the card for a lasting one. */
  alternative?: number;
}

/** A card that can never leave arsenal (a block or other unplayable card)
 * wastes the slot: about one card's worth for as long as it sits there. */
export const DEAD_ARSENAL_COST = DEFAULT_DRAW_VALUE;
/** A blue card pitches for 3 or blocks from hand. Face down in arsenal it can
 * do neither, and playing it is usually below rate, so it costs about a card
 * on top of its play value. Defense reactions and Ambush cards still defend
 * from arsenal and are exempt, as are cards marked `arsenalPlay`. */
export const BLUE_ARSENAL_COST = DEAD_ARSENAL_COST;

/** Offensive value: an attack's damage (a terminal attack competes for the
 * single last slot, so it counts at a discount) or a pump's added power.
 * `offenseRate` is the share of threatened offense expected to land after the
 * opponent's response; blocking, pitch and prevention values are unaffected. */
export function offenseValue(uses: CardUses, hitChance: number, offenseRate = 1): number {
  if (uses.kind === "attack") {
    const value = uses.power + uses.onHit * hitChance;
    return (uses.reliableGoAgain || uses.finisher ? value : value * ARSENAL_TERMINAL_FACTOR) * offenseRate;
  }
  return (uses.pump + (uses.pumpRider ?? 0)) * offenseRate;
}

/** Damage a defense reaction (or, at a lower use rate, a blocker) stops. */
function blockValue(uses: CardUses): number {
  return Math.min(uses.defense, TYPICAL_INCOMING) * (uses.kind === "defense-reaction" ? 0.9 : BLOCK_USE_RATE);
}

/** Arsenal value for the next turn: go-again attacks at full attack value,
 * terminal attacks discounted, pumps at their pump value, defense reactions
 * (and Ambush cards, if better) at the damage they stop; all reduced by the
 * disruption discount. A card that cannot be played from arsenal only blocks
 * the slot, and a blue card that cannot defend from there pays
 * BLUE_ARSENAL_COST. */
export function arsenalValue(
  uses: CardUses,
  discount: number,
  hitChance = DEFAULT_HIT_CHANCE,
  offenseRate = 1,
): number {
  let value: number;
  switch (uses.kind) {
    case "attack":
    case "attack-reaction":
    case "action":
    case "instant":
      value = offenseValue(uses, hitChance, offenseRate) || uses.pitch * 0.25;
      if (uses.ambush) value = Math.max(value, blockValue(uses));
      break;
    case "defense-reaction":
      value = blockValue(uses);
      break;
    default:
      return -DEAD_ARSENAL_COST;
  }
  const share = uses.kind === "defense-reaction" ? DEFENSE_REACTION_DISCOUNT_SHARE : 1;
  const stranded = uses.pitch >= 3 && uses.kind !== "defense-reaction" && !uses.ambush && !uses.arsenalPlay;
  return value * (1 - discount * share) - (stranded ? BLUE_ARSENAL_COST : 0);
}

/** Best single use of a card drawn into a fresh hand. */
export function standaloneValue(uses: CardUses, hitChance = DEFAULT_HIT_CHANCE, offenseRate = 1): number {
  return Math.max(
    offenseValue(uses, hitChance, offenseRate), blockValue(uses), uses.pitch * PITCH_FUNDING_RATE,
    uses.alternative ?? 0,
  );
}

/** A card kept in hand displaces one draw, so it is worth only its margin.
 * Price `averageDraw` at the same `offenseRate`. */
export function heldValue(
  uses: CardUses,
  averageDraw: number,
  hitChance = DEFAULT_HIT_CHANCE,
  offenseRate = 1,
): number {
  return Math.max(0, standaloneValue(uses, hitChance, offenseRate) - averageDraw);
}

const STATIC_GO_AGAIN = /(?:^|[.\n:]\s*)Go again\s*(?:[.\n]|$)/;

/** Printed, unconditional go again, including weapon abilities ("Attack. Go
 * again"). Card keyword lists also name conditional go again ("this gets go
 * again"), so only a standalone sentence counts. */
export function hasStaticGoAgain(data: CardData): boolean {
  return STATIC_GO_AGAIN.test(data.text);
}

/** Default uses parsed from printed data. Hero rules refine conditional cards. */
export function defaultCardUses(data: CardData, power = data.attack ?? 0, defense = data.defense ?? 0): CardUses {
  const subtypes = (data.subtypes ?? []).map((subtype) => subtype.toLowerCase());
  const kind: CardUses["kind"] = data.cardType === "action"
    ? subtypes.includes("attack") ? "attack" : "action"
    : data.cardType === "weapon" || data.cardType === "attack-reaction" || data.cardType === "instant" ||
        data.cardType === "defense-reaction" || data.cardType === "block" || data.cardType === "equipment"
    ? data.cardType
    : "other";
  const prevented = handPrevention(data);
  const pumpMatch = /\+(\d+)\{p\}/.exec(data.text);
  const pumpCount = (data.text.match(/next attack[^.]*\+(\d+)\{p\}/gi) ?? []).length;
  const pump = kind === "attack" || kind === "weapon"
    ? 0
    : pumpMatch ? Number(pumpMatch[1]) * Math.max(1, pumpCount) : 0;
  return {
    kind,
    power: Math.max(0, power),
    defense: Math.max(0, defense),
    pitch: Number(data.pitch ?? 0),
    onHit: 0,
    reliableGoAgain: hasStaticGoAgain(data),
    pump,
    pumpRider: /next [^.]*attack[^.]*gets? go again/i.test(data.text) && kind !== "attack" ? 2 : 0,
    ...(data.keywords?.includes("Ambush") || /^Ambush\b/m.test(data.text) ? { ambush: true } : {}),
    // Cards with a bonus for being played from arsenal (e.g. Sow Tomorrow).
    ...(/\bplayed from (?:your )?arsenal\b/i.test(data.text) ? { arsenalPlay: true } : {}),
    ...(prevented > 0 ? { alternative: Math.min(prevented, TYPICAL_INCOMING) * BLOCK_USE_RATE } : {}),
  };
}

const PREVENT_AMOUNT = /\bprevent (?:the next )?(\d+)(?: of that)? damage/i;
const HAND_INSTANT_PREVENT = /Instant - [^:]*\b(?:discard|banish) this(?: from your hand)?:\s*Prevent the next (\d+) damage/i;

/** Fixed damage a card prevents when used from hand: a prevention instant,
 * or an instant-speed discard/banish mode (e.g. Fallen Herald). */
function handPrevention(data: CardData): number {
  const mode = HAND_INSTANT_PREVENT.exec(data.text);
  if (mode) return Number(mode[1]);
  return data.cardType === "instant" ? Number(PREVENT_AMOUNT.exec(data.text)?.[1] ?? 0) : 0;
}

const ARSENAL_DISRUPTION = new RegExp(
  "\\b(?:destroy|banish|put|turn)\\b[^.]{0,80}\\b(?:their|defending hero's|opponent's|that hero's) arsenal\\b" +
    "|\\bcards? in their arsenal\\b",
  "i",
);

export function disruptsArsenal(data: CardData | undefined): boolean {
  return !!data && ARSENAL_DISRUPTION.test(data.text);
}

/**
 * Probability the bot's arsenal card is lost before it can be used:
 * P(opponent holds a disruptor in their next hand) × P(it connects), clamped
 * to [DISRUPTION_BASE, DISRUPTION_CAP]. Without the opponent's decklist only
 * publicly seen disruptors raise the base rate.
 */
export function disruptionDiscount(input: Pick<BotPolicyInput, "view" | "seat" | "cards" | "decklists">): number {
  const opponent = input.view.players[1 - input.seat]!;
  const counts = unseenCounts(input, "opponent");
  if (!counts) {
    const seen = [...opponent.graveyard, ...opponent.banish].filter((card) =>
      disruptsArsenal(input.cards[card.cardId])
    ).length;
    return Math.min(DISRUPTION_CAP, DISRUPTION_BASE + seen * 0.1);
  }
  let disruptors = 0;
  for (const [cardId, count] of counts) if (disruptsArsenal(input.cards[cardId])) disruptors += count;
  const intellect = input.cards[opponent.heroCardId]?.intellect ?? 4;
  const chance = probabilityAtLeastOne(disruptors, totalCount(counts), intellect) * DISRUPTION_HIT_CHANCE;
  return Math.max(DISRUPTION_BASE, Math.min(DISRUPTION_CAP, chance));
}

/** Mean standalone value of a card drawn from the bot's remaining deck. */
export function averageDrawValue(
  input: Pick<BotPolicyInput, "view" | "seat" | "cards" | "decklists">,
  usesOf: (data: CardData) => CardUses = (data) => defaultCardUses(data),
  offenseRate = 1,
): number {
  const counts = unseenCounts(input, "own");
  if (!counts) return DEFAULT_DRAW_VALUE;
  return averageOver(counts, (cardId) => {
    const data = input.cards[cardId];
    return data ? standaloneValue(usesOf(data), DEFAULT_HIT_CHANCE, offenseRate) : 0;
  }) ?? DEFAULT_DRAW_VALUE;
}

/** Expected pitch value of the bot's next draw (e.g. Ravenous Rabble). */
export function expectedTopPitch(input: Pick<BotPolicyInput, "view" | "seat" | "cards" | "decklists">): number {
  const counts = unseenCounts(input, "own");
  if (!counts) return 2;
  return averageOver(counts, (cardId) => Number(input.cards[cardId]?.pitch ?? 0)) ?? 2;
}
