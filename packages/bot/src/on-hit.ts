import type { OnHitImpactView } from "@fyendal/shared";
import { DEFAULT_DRAW_VALUE, DEFAULT_HIT_CHANCE } from "./card-ev.js";

/**
 * Damage-equivalent value of public on-hit effects, from the defender's point
 * of view: what stopping the hit denies the attacker. Effects are classified
 * into categories, ordered from the most damaging to the defender to the
 * least:
 *
 * 1. informed disruption — the attacker sees the hand and takes the best card
 *    (Surgical Extraction, Bonds of Agony);
 * 2. random hand disruption, then arsenal destruction;
 * 3. card advantage for the attacker (draws, tutors);
 * 4. a hand card the defender chooses to lose;
 * 5. damage, debuff tokens, equipment or other permanent removal, next-turn
 *    locks, life gain and resource tokens;
 * 6. tempo, setup, pumps, marks and deck milling;
 * 7. self-destruction (Dig for Souls' zombie), which favors the defender.
 *
 * Values are anchored to the value of one card (`DEFAULT_DRAW_VALUE`). Only
 * public text is read; a hidden card identity is never inferred.
 */

export type OnHitCategory =
  | "informed-disruption"
  | "random-disruption"
  | "arsenal-disruption"
  | "card-advantage"
  | "forced-discard"
  | "damage"
  | "debuff-token"
  | "equipment-damage"
  | "permanent-removal"
  | "lock"
  | "life-gain"
  | "resource-token"
  | "setup"
  | "tempo"
  | "pump"
  | "deck-disruption"
  | "mark"
  | "neutral"
  | "self-destruction"
  | "unclassified";

/** The least on-hit value that justifies wearing equipment to stop it. */
export const SIGNIFICANT_ON_HIT_VALUE = 2;

/** The attacker picks the best card after seeing the whole hand. */
const INFORMED_DISRUPTION_VALUE = DEFAULT_DRAW_VALUE + 1.5;
/** A random card is an average card. */
const RANDOM_DISRUPTION_VALUE = DEFAULT_DRAW_VALUE;
/** The defender gives up the worst card in hand. */
const FORCED_DISCARD_VALUE = DEFAULT_DRAW_VALUE * 0.75;
/** Cards a whole-hand discard is assumed to take. */
const WHOLE_HAND_CARDS = 3;
/** Extra copies banished from deck or graveyard by a named-card effect. */
const NAMED_COPY_VALUE = 1;
/** An occupied arsenal holds a card the defender chose to keep. */
const ARSENAL_DISRUPTION_VALUE = 4;
const TUTOR_VALUE = 3;
/** A card the attacker may play from a created, milled or returned copy. */
const PLAYABLE_CARD_VALUE = 2;
const EQUIPMENT_DAMAGE_VALUE = 2;
const PERMANENT_REMOVAL_VALUE = 3;
const TOKEN_REMOVAL_VALUE = 2;
const BOARD_WIPE_VALUE = 4;
/** A restriction on the defender's next turn (can't play, loses abilities). */
const LOCK_VALUE = 2;
/** A small defensive handicap, such as -1{d} on the next defense. */
const MINOR_LOCK_VALUE = 1;
const GAME_LOSS_VALUE = 40;
const RESOURCE_TOKEN_VALUE = 2;
/** Attacker-side setup (soul, opt, counters). */
const SETUP_VALUE = 1;
const TEMPO_VALUE = 1;
const MILLED_CARD_VALUE = 0.5;
const MARK_VALUE = 0.5;
/** A self-destroying attacker hands the defender a removed threat. */
const SELF_DESTRUCTION_VALUE = -1;
/** Unrecognized text is assumed to be a modest benefit to the attacker. */
const UNCLASSIFIED_VALUE = 2;

const DEBUFF_TOKEN_VALUE: Readonly<Record<string, number>> = {
  "bloodrot pox": 2,
  inertia: 2,
  frailty: 1.5,
  frostbite: 1,
};

export interface PublicOnHitEffect {
  text: string;
  impact?: OnHitImpactView;
}

export interface OnHitValueContext {
  effects: readonly PublicOnHitEffect[];
  sourceText?: string;
  attackerCanContinue: boolean;
  attackerCanArsenal: boolean;
  defenderHasHand: boolean;
  defenderHasArsenal: boolean;
}

export interface OnHitEvaluation {
  value: number;
  categories: readonly OnHitCategory[];
  cardDraw: number;
  delayedDamage: number;
  handCardsLost: number;
  destroysOccupiedArsenal: boolean;
  equipmentDamage: boolean;
  tokenCreation: boolean;
}

export const EMPTY_ON_HIT_EVALUATION: OnHitEvaluation = {
  value: 0,
  categories: [],
  cardDraw: 0,
  delayedDamage: 0,
  handCardsLost: 0,
  destroysOccupiedArsenal: false,
  equipmentDamage: false,
  tokenCreation: false,
};

const COUNT = "(a|an|one|two|three|four|\\d+)";

function count(word: string | undefined): number {
  switch (word) {
    case undefined: case "a": case "an": case "one": return 1;
    case "two": return 2;
    case "three": return 3;
    case "four": return 4;
    default: {
      const value = Number(word);
      return Number.isSafeInteger(value) && value >= 0 ? value : 1;
    }
  }
}

function part(
  category: OnHitCategory,
  value: number,
  fields: Partial<Omit<OnHitEvaluation, "value" | "categories">> = {},
): OnHitEvaluation {
  return { ...EMPTY_ON_HIT_EVALUATION, ...fields, value, categories: [category] };
}

function combine(left: OnHitEvaluation, right: OnHitEvaluation): OnHitEvaluation {
  return {
    value: left.value + right.value,
    categories: [...new Set([...left.categories, ...right.categories])],
    cardDraw: left.cardDraw + right.cardDraw,
    delayedDamage: left.delayedDamage + right.delayedDamage,
    handCardsLost: left.handCardsLost + right.handCardsLost,
    destroysOccupiedArsenal: left.destroysOccupiedArsenal || right.destroysOccupiedArsenal,
    equipmentDamage: left.equipmentDamage || right.equipmentDamage,
    tokenCreation: left.tokenCreation || right.tokenCreation,
  };
}

function sum(parts: readonly (OnHitEvaluation | undefined)[]): OnHitEvaluation | undefined {
  const present = parts.filter((entry): entry is OnHitEvaluation => entry !== undefined);
  return present.length > 0 ? present.reduce(combine, EMPTY_ON_HIT_EVALUATION) : undefined;
}

/** Drawn cards are worth more when the attacker can still use them this turn. */
function drawn(cards: number, context: OnHitValueContext): OnHitEvaluation {
  const conversion = context.attackerCanContinue || context.attackerCanArsenal ? 1 : 0;
  return part("card-advantage", cards * (3 + conversion), { cardDraw: cards });
}

function handLoss(
  category: OnHitCategory,
  cards: number,
  value: number,
  context: OnHitValueContext,
): OnHitEvaluation {
  const lost = context.defenderHasHand ? cards : 0;
  return part(category, lost * value, { handCardsLost: lost });
}

/** At most one reading of what leaves the defender's hand. */
function handDisruption(text: string, context: OnHitValueContext): OnHitEvaluation | undefined {
  const informed = new RegExp(
    "look at (?:their|the defending hero's|target hero's) hand|reveals? their hand" +
      "|choose a card (?:from|in) their hand",
  );
  if (informed.test(text)) {
    const copies = /banish up to (\w+) cards with the same name/.exec(text);
    const extra = copies ? Math.max(0, count(copies[1]) - 1) * NAMED_COPY_VALUE : 0;
    return combine(
      handLoss("informed-disruption", 1, INFORMED_DISRUPTION_VALUE, context),
      part("informed-disruption", extra),
    );
  }
  if (/discards? (?:their hand|all but 1 card from their hand)/.test(text)) {
    return handLoss("random-disruption", WHOLE_HAND_CARDS, RANDOM_DISRUPTION_VALUE, context);
  }
  const random = new RegExp(`discards? ${COUNT} random cards?|${COUNT} random cards? from their hand`).exec(text);
  if (random) return handLoss("random-disruption", count(random[1] ?? random[2]), RANDOM_DISRUPTION_VALUE, context);
  const forced = new RegExp(
    `(?:discards?|banish(?:es)?(?: face-down)?|puts?) ${COUNT} cards?(?: from their hand)?` +
      "|put a card from their hand on top",
  ).exec(text);
  if (forced && /discard|from their hand/.test(text) && !/from your hand/.test(text)) {
    return handLoss("forced-discard", count(forced[1]), FORCED_DISCARD_VALUE, context);
  }
  return undefined;
}

function arsenalDisruption(text: string, context: OnHitValueContext): OnHitEvaluation | undefined {
  if (!/(?:destroy|banish)[^.]{0,60}\barsenal\b|put[^.]{0,60}\btheir arsenal\b/.test(text)) return undefined;
  if (!context.defenderHasArsenal) return part("arsenal-disruption", 0);
  // Some effects only take a particular kind of arsenal card.
  const conditional = new RegExp(
    "turn a card in their arsenal face[- ]up|defense reaction in their arsenal" +
      "|attack action card in their arsenal with",
  ).test(text);
  return part(
    "arsenal-disruption",
    conditional ? ARSENAL_DISRUPTION_VALUE / 2 : ARSENAL_DISRUPTION_VALUE,
    { destroysOccupiedArsenal: true },
  );
}

function cardAdvantage(text: string, context: OnHitValueContext): OnHitEvaluation | undefined {
  // "they draw" refills the defender, so it is not the attacker's advantage.
  const draw = new RegExp(`(?:^|[^y] )draws? ${COUNT} cards?`).exec(text);
  if (draw) return drawn(count(draw[1]), context);
  if (/search your deck[^.]*(?:into|to) your hand/.test(text)) return part("card-advantage", TUTOR_VALUE);
  const tigers = new RegExp(`create ${COUNT} crouching tigers?`).exec(text);
  if (tigers) return part("card-advantage", count(tigers[1]) * PLAYABLE_CARD_VALUE);
  return undefined;
}

function damage(text: string): OnHitEvaluation | undefined {
  if (/they lose the game/.test(text)) return part("damage", GAME_LOSS_VALUE);
  const match = /(?:deal|deals|loses?)\D{0,24}(\d+)\s*(?:arcane\s+)?(?:damage|life|\{h\})/.exec(text);
  if (!match || /\byou lose\b/.test(text)) return undefined;
  const amount = Number(match[1]);
  const delayed = /(?:end phase|beginning of|next turn)/.test(text) ? amount : 0;
  return part("damage", amount, { delayedDamage: delayed });
}

function tokens(text: string): OnHitEvaluation | undefined {
  const debuff = /create (?:a |an |\d+ )?(bloodrot pox|inertia|frailty|frostbite)/.exec(text);
  if (debuff) {
    const value = DEBUFF_TOKEN_VALUE[debuff[1]!] ?? 1;
    return part("debuff-token", value, {
      tokenCreation: true,
      delayedDamage: debuff[1] === "bloodrot pox" ? value : 0,
    });
  }
  const runechants = new RegExp(`create ${COUNT} (?:runechant|embodiment of (?:earth|lightning))`).exec(text);
  if (runechants) return part("resource-token", count(runechants[1]), { tokenCreation: true });
  if (/creates? (?:a |an |\d+ |two )?(?:gold|agility|might|vigor|copper|silver|quicken)/.test(text)) {
    return part("resource-token", RESOURCE_TOKEN_VALUE, { tokenCreation: true });
  }
  if (/create[^.]*\btokens?\b/.test(text)) return part("resource-token", 1, { tokenCreation: true });
  return undefined;
}

function equipmentDamage(text: string): OnHitEvaluation | undefined {
  if (!/equipment (?:they|the defending hero) controls?|defending equipment/.test(text)) return undefined;
  const value = /destroy[^.]{0,30}equipment/.test(text) ? PERMANENT_REMOVAL_VALUE : EQUIPMENT_DAMAGE_VALUE;
  return part("equipment-damage", value, { equipmentDamage: true });
}

function permanentRemoval(text: string): OnHitEvaluation | undefined {
  const target = "(?:aura|item|ally|weapon|permanent)";
  if (new RegExp(`destroy all [^.]*${target}s? they control`).test(text)) {
    return part("permanent-removal", BOARD_WIPE_VALUE);
  }
  const removal = new RegExp(
    `(?:destroy|banish|steal|gain control of|return)[^.]{0,40}${target}s?(?: tokens?)?` +
      "[^.]{0,20}(?:they|the defending hero) (?:control|own)",
  );
  if (!removal.test(text)) return undefined;
  return part("permanent-removal", /token/.test(text) ? TOKEN_REMOVAL_VALUE : PERMANENT_REMOVAL_VALUE);
}

function lock(text: string): OnHitEvaluation | undefined {
  const weakened = /their first attack during their next turn has -(\d+)\{p\}/.exec(text);
  if (weakened) return part("lock", Number(weakened[1]) * DEFAULT_HIT_CHANCE);
  if (new RegExp(
    "(?:they|that hero|cards they own|attacks they control) (?:can't|lose all|lose and can't)" +
      "|costs? an additional \\{r\\}|is halved",
  ).test(text)) {
    return part("lock", LOCK_VALUE);
  }
  if (/-\d+\{d\}(?: while defending| until end of turn)|\{t\} (?:them|their hero)/.test(text)) {
    return part("lock", MINOR_LOCK_VALUE);
  }
  return undefined;
}

function lifeGain(text: string): OnHitEvaluation | undefined {
  const gained = /gain (?:life )?(\d+)\{h\}/.exec(text);
  return gained ? part("life-gain", Number(gained[1])) : undefined;
}

function setup(text: string): OnHitEvaluation | undefined {
  if (/put it into its owner's hand/.test(text)) return part("setup", PLAYABLE_CARD_VALUE);
  if (new RegExp(
    "into your (?:hero's )?soul|\\bopt \\d|look at the top card of your deck|sharpen" +
      "|counter on (?:it|this|an item you control|a cog)|the crowd cheers you|equip a ",
  ).test(text)) {
    return part("setup", SETUP_VALUE);
  }
  return undefined;
}

function deckDisruption(text: string): OnHitEvaluation | undefined {
  const milled = new RegExp(`(?:banish|destroy) the top (?:${COUNT} )?cards? of (?:their|the defending hero's) deck`)
    .exec(text);
  if (!milled) return undefined;
  const playable = /you may play it/.test(text) ? PLAYABLE_CARD_VALUE : 0;
  return part("deck-disruption", count(milled[1]) * MILLED_CARD_VALUE + playable);
}

function minorEffects(text: string): OnHitEvaluation | undefined {
  const tempo = /go again|action points?|gain (?:\w+ )?(?:\{r\}|resources?)|attack an additional time/.test(text) &&
    !/can't (?:get|gain) go again/.test(text);
  const pump = /next [^.]*attack[^.]*\+(\d+)\{p\}/.exec(text);
  return sum([
    tempo ? part("tempo", TEMPO_VALUE) : undefined,
    pump ? part("pump", Number(pump[1]) * DEFAULT_HIT_CHANCE) : undefined,
    /\bmark (?:them|the defending hero)\b/.test(text) ? part("mark", MARK_VALUE) : undefined,
  ]);
}

/** The attacker destroys itself (or is merely recycled) when it hits. */
function selfEffect(text: string): OnHitEvaluation | undefined {
  if (/destroy this (?:zombie|ally)\b|hits?, (?:destroy|banish) (?:this|it)\W*$|the dagger has hit\. destroy the dagger/
    .test(text)) {
    return part("self-destruction", SELF_DESTRUCTION_VALUE);
  }
  if (/put (?:this|it) on the bottom of its owner's deck\W*$|the crowd boos you/.test(text)) return part("neutral", 0);
  return undefined;
}

function classifyText(rawText: string, context: OnHitValueContext): OnHitEvaluation | undefined {
  const text = rawText.trim().toLowerCase();
  return sum([
    handDisruption(text, context),
    arsenalDisruption(text, context),
    cardAdvantage(text, context),
    damage(text),
    tokens(text),
    equipmentDamage(text),
    permanentRemoval(text),
    lock(text),
    lifeGain(text),
    setup(text),
    deckDisruption(text),
    minorEffects(text),
    selfEffect(text),
  ]);
}

/** Structured engine tags, used when the display text is not recognized
 * (for example, an engine summary of a scripted effect). */
function classifyImpact(impact: OnHitImpactView, context: OnHitValueContext): OnHitEvaluation | undefined {
  const arsenal = context.defenderHasArsenal
    ? part("arsenal-disruption", ARSENAL_DISRUPTION_VALUE, { destroysOccupiedArsenal: true })
    : part("arsenal-disruption", 0);
  return sum([
    impact.damage ? part("damage", impact.damage, { delayedDamage: impact.delayedDamage ?? 0 }) : undefined,
    impact.drawCards ? drawn(impact.drawCards, context) : undefined,
    impact.discardCards
      ? handLoss("forced-discard", impact.discardCards, FORCED_DISCARD_VALUE, context)
      : undefined,
    impact.destroysArsenal ? arsenal : undefined,
    impact.damagesEquipment
      ? part("equipment-damage", EQUIPMENT_DAMAGE_VALUE, { equipmentDamage: true })
      : undefined,
    impact.createsToken ? part("resource-token", 1, { tokenCreation: true }) : undefined,
    impact.grantsTempo ? part("tempo", TEMPO_VALUE) : undefined,
  ]);
}

function evaluateEffect(effect: PublicOnHitEffect, context: OnHitValueContext): OnHitEvaluation {
  return classifyText(effect.text, context)
    ?? (effect.impact ? classifyImpact(effect.impact, context) : undefined)
    ?? part("unclassified", UNCLASSIFIED_VALUE);
}

/** Categorized damage-equivalent value of the public on-hit effects. */
export function evaluateOnHit(context: OnHitValueContext): OnHitEvaluation {
  if (context.effects.length > 0) {
    return context.effects.reduce(
      (total, effect) => combine(total, evaluateEffect(effect, context)),
      EMPTY_ON_HIT_EVALUATION,
    );
  }
  return /when (?:this|you) hits|on hit/i.test(context.sourceText ?? "")
    ? part("unclassified", UNCLASSIFIED_VALUE)
    : EMPTY_ON_HIT_EVALUATION;
}
