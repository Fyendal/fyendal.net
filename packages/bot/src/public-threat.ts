import type { CardData, CardView, ChainLinkView, PlayerView } from "@fyendal/shared";
import { unseenCounts } from "./deck-knowledge.js";
import type { BotPolicyInput } from "./policy.js";

/**
 * Damage the attacker can still add to the current opposing attack from
 * public sources after defenders are declared. The attacker keeps priority
 * after the defender's last reaction, so survival must be planned against
 * this worst case.
 *
 * Only public objects are read: the attacking card, the attacker's board,
 * equipment and weapons, and face-up arsenal cards. Per-turn limits come from
 * the projected ability usage, and costs from untapped/tapped subtype pools
 * (cogs), the source itself, the hero, and a resource budget. Hidden hand
 * cards never contribute an effect; they only fund `{r}` costs, each assumed
 * to pitch for the most any unseen opposing card does.
 */
export interface PublicCombatThreat {
  /** Power the attack can still gain. Blocks absorb it like printed power. */
  attackBonus: number;
  /** Damage dealt outside combat damage (Flick Knives). Blocks never stop it. */
  directDamage: number;
}

const NO_THREAT: PublicCombatThreat = { attackBonus: 0, directDamage: 0 };
/** Pitch assumed for each hidden hand card without opposing deck knowledge. */
const DEFAULT_MAX_PITCH = 3;
/** Bounds an unlimited ability whose cost pools are unbounded. */
const MAX_UNITS_PER_ABILITY = 6;

const cache = new WeakMap<object, PublicCombatThreat[]>();

/** Worst-case public follow-up to the current opposing attack. `defended`
 * adds the attack's own paid "when this is defended" pumps (Spark Spray),
 * which only a block that defends a not-yet-defended attack triggers. */
export function publicCombatThreat(input: BotPolicyInput, defended = false): PublicCombatThreat {
  const key = input.seat * 2 + Number(defended);
  const cached = cache.get(input.view)?.[key];
  if (cached) return cached;
  const threat = computeThreat(input, defended);
  const entry = cache.get(input.view) ?? [];
  entry[key] = threat;
  cache.set(input.view, entry);
  return threat;
}

/** Combat damage the current opposing attack deals before new blocks once the
 * attacker spends every public pump. */
export function threatenedCombatDamage(input: BotPolicyInput, defended = false): number {
  const link = opposingLink(input);
  return link ? pumpedDamage(link, publicCombatThreat(input, defended).attackBonus) : 0;
}

/** Combat damage plus public direct damage the current opposing attack can
 * deal before new blocks: compare against life for lethal checks. */
export function threatenedAttackDamage(input: BotPolicyInput): number {
  return threatenedCombatDamage(input) + publicCombatThreat(input).directDamage;
}

/** Current damage after the attack gains `bonus` power. Existing defenders
 * absorb pumps only up to the defense they exceed the attack by. */
function pumpedDamage(link: ChainLinkView, bonus: number): number {
  return Math.max(0, link.damage, link.attackValue + bonus - link.defenseValue);
}

function opposingLink(input: BotPolicyInput): ChainLinkView | undefined {
  const link = [...input.view.chain].reverse().find((candidate) => !candidate.resolved);
  return link && link.attackingCard.owner !== input.seat ? link : undefined;
}

interface Unit {
  gain: number;
  direct: boolean;
  resources: number;
  pools: readonly string[];
}

interface Ability {
  index: number;
  timing: string;
  limit: number;
  cost: string;
  effect: string;
}

const ABILITY_HEADER =
  /(?:\b(once|twice|thrice) per turn\s+)?\b(instant|action|attack reaction|defense reaction)\s+-\s+/gi;
const PER_TURN: Readonly<Record<string, number>> = { once: 1, twice: 2, thrice: 3 };

/** Activated abilities in printed order, which is also script ability order. */
function printedAbilities(text: string): Ability[] {
  const headers = [...text.matchAll(ABILITY_HEADER)];
  return headers.flatMap((header, index) => {
    const start = header.index! + header[0].length;
    const end = headers[index + 1]?.index ?? text.length;
    const body = text.slice(start, end);
    const colon = body.indexOf(":");
    if (colon < 0) return [];
    return [{
      index,
      timing: header[2]!.toLowerCase(),
      limit: header[1] ? PER_TURN[header[1].toLowerCase()]! : Number.POSITIVE_INFINITY,
      cost: body.slice(0, colon).trim().toLowerCase(),
      effect: body.slice(colon + 1).trim().toLowerCase(),
    }];
  });
}

function remainingUses(card: CardView, ability: Ability): number {
  if (card.usedAbilityIndexes?.includes(ability.index)) return 0;
  const remaining = card.remainingAbilityActivations?.[ability.index] ?? 0;
  return remaining > 0 ? remaining : ability.limit;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasType(card: CardView, data: CardData | undefined, type: string): boolean {
  return [...(data?.subtypes ?? []), ...(card.grantedTypes ?? [])]
    .some((subtype) => subtype.toLowerCase() === type);
}

interface Context {
  input: BotPolicyInput;
  link: ChainLinkView;
  attacker: PlayerView;
  attackIsAction: boolean;
  permanents: readonly CardView[];
}

/** Each cost component as a pool key, or undefined when it cannot be judged
 * from public information. A pool key `self:<id>` or `hero` has size one. */
function parseCost(
  cost: string,
  source: CardView,
  name: string,
): { resources: number; pools: string[]; limit: number } | undefined {
  let resources = 0;
  let limit = Number.POSITIVE_INFINITY;
  const pools: string[] = [];
  for (const part of cost.split(/,\s*/)) {
    const typed = /^\{([tu])\} an? ([a-z]+) you control$/.exec(part);
    if (part === "0") continue;
    if (/^(?:\{r\})+$/.test(part)) {
      resources += part.split("{r}").length - 1;
    } else if (part === "{t}") {
      pools.push(`self:${source.instanceId}`);
    } else if (part === "{t} your hero") {
      pools.push("hero");
    } else if (typed) {
      pools.push(`${typed[1] === "t" ? "untapped" : "tapped"}:${typed[2]}`);
    } else if (new RegExp(`^destroy (?:this|${name})$`).test(part)) {
      limit = 1;
    } else {
      return undefined;
    }
  }
  return { resources, pools, limit };
}

/** The ability's public effect on the current attack, if it has one. */
function abilityEffect(
  context: Context,
  source: CardView,
  name: string,
  effect: string,
): { gain: number; direct: boolean } | undefined {
  if (/in your graveyard/.test(effect)) return undefined;
  const isAttacking = source.instanceId === context.link.attackingCard.instanceId;
  const self = new RegExp(`^(?:this|this card|${name}) (?:gets|gains) \\+(\\d+)\\{p\\}`).exec(effect);
  if (self) return isAttacking ? { gain: Number(self[1]), direct: false } : undefined;
  const target = /^target attack( action card)? (?:gets|gains) \+(\d+)\{p\}/.exec(effect);
  if (target) {
    return target[1] && !context.attackIsAction ? undefined : { gain: Number(target[2]), direct: false };
  }
  const allActions = /^attack action cards you control (?:get|gain) \+(\d+)\{p\}/.exec(effect);
  if (allActions) return context.attackIsAction ? { gain: Number(allActions[1]), direct: false } : undefined;
  const direct = new RegExp(
    "^target ([a-z]+) you control( that isn['’]t on the active chain link)? deals (\\d+) damage to target hero",
  ).exec(effect);
  if (direct) {
    const available = context.permanents.some((card) =>
      hasType(card, context.input.cards[card.cardId], direct[1]!) &&
      !(direct[2] && card.instanceId === context.link.attackingCard.instanceId)
    );
    return available ? { gain: Number(direct[3]), direct: true } : undefined;
  }
  return undefined;
}

function abilityUnits(context: Context, source: CardView): Unit[] {
  const data = context.input.cards[source.cardId];
  if (!data?.text) return [];
  const name = escapeRegExp(data.name.toLowerCase());
  return printedAbilities(data.text).flatMap((ability) => {
    if (ability.timing !== "instant" && ability.timing !== "attack reaction") return [];
    const effect = abilityEffect(context, source, name, ability.effect);
    if (!effect) return [];
    const cost = parseCost(ability.cost, source, name);
    if (!cost) return [];
    const uses = Math.min(remainingUses(source, ability), cost.limit, MAX_UNITS_PER_ABILITY);
    return Array.from({ length: uses }, () => ({
      gain: effect.gain,
      direct: effect.direct,
      resources: cost.resources,
      pools: cost.pools,
    }));
  });
}

interface InstantPump {
  gain: number;
  /** Lightning Flow tokens the attacker may destroy instead of paying. */
  flowAlternative?: boolean;
  targets(attack: CardData, context: Context): boolean;
}

const anyAttack = () => true;
const lightningAttack = (attack: CardData, context: Context) =>
  hasType(context.link.attackingCard, attack, "lightning");
const cheapAttackAction = (attack: CardData, context: Context) =>
  context.attackIsAction && (attack.cost ?? 0) <= 1;
const heraldAttackAction = (attack: CardData, context: Context) =>
  context.attackIsAction && /herald/i.test(attack.name);

/** Instants that pump the current attack, keyed `name lowercase|pitch`. */
const INSTANT_PUMPS: Readonly<Record<string, InstantPump>> = {
  "lightning press|1": { gain: 3, targets: cheapAttackAction },
  "lightning press|2": { gain: 2, targets: cheapAttackAction },
  "lightning press|3": { gain: 1, targets: cheapAttackAction },
  "flow through|3": { gain: 1, targets: lightningAttack },
  "stormshard|1": { gain: 3, flowAlternative: true, targets: lightningAttack },
  // The +4 rider needs a destroyed aura this turn, which the view does not expose.
  "ominous aggression|1": { gain: 2, targets: (_, context) => context.attackIsAction },
  "crackle from afar|3": { gain: 1, targets: anyAttack },
  "the grain that tips the scale|3": { gain: 1, targets: anyAttack },
  "angelic wrath|1": { gain: 4, targets: heraldAttackAction },
  "angelic wrath|2": { gain: 3, targets: heraldAttackAction },
  "angelic wrath|3": { gain: 2, targets: heraldAttackAction },
};

function instantUnits(context: Context, data: CardData): Unit[] {
  const pump = INSTANT_PUMPS[`${data.name.toLowerCase()}|${data.pitch ?? 0}`];
  const attack = context.input.cards[context.link.attackingCard.cardId];
  if (!pump || !attack || !pump.targets(attack, context)) return [];
  const flow = pump.flowAlternative && context.permanents.some((card) =>
    context.input.cards[card.cardId]?.name === "Lightning Flow"
  );
  return [{ gain: pump.gain, direct: false, resources: flow ? 0 : Math.max(0, data.cost ?? 0), pools: [] }];
}

/** A face-up arsenal instant or attack reaction that pumps the current attack. */
function arsenalUnits(context: Context, card: CardView): Unit[] {
  const data = context.input.cards[card.cardId];
  if (data?.cardType === "instant") return instantUnits(context, data);
  if (data?.cardType !== "attack-reaction") return [];
  const sentence = (data.text ?? "").toLowerCase().split(/[.\n]/).find((part) =>
    /attack[^.]*\b(?:gets|gains) \+\d+\{p\}/.test(part) && !/next attack|counter/.test(part)
  );
  if (!sentence || /attack action card/.test(sentence) && !context.attackIsAction) return [];
  const gain = Number(/\+(\d+)\{p\}/.exec(sentence)![1]);
  return [{ gain, direct: false, resources: Math.max(0, data.cost ?? 0), pools: [] }];
}

/** Spark Spray, the only attack that pays for power when defended. */
function defendedUnits(context: Context): Unit[] {
  if (context.link.defendingCards.length > 0) return [];
  if (context.input.cards[context.link.attackingCard.cardId]?.name !== "Spark Spray") return [];
  return [{ gain: 1, direct: false, resources: 1, pools: [] }];
}

function resourceBudget(input: BotPolicyInput, attacker: PlayerView): number {
  const counts = unseenCounts(input, "opponent");
  let maxPitch = counts ? 0 : DEFAULT_MAX_PITCH;
  for (const [cardId, count] of counts ?? []) {
    if (count > 0) maxPitch = Math.max(maxPitch, Number(input.cards[cardId]?.pitch ?? 0));
  }
  return attacker.resources + attacker.handCount * maxPitch;
}

function poolSizes(context: Context): Map<string, number> {
  const sizes = new Map<string, number>();
  const add = (key: string) => sizes.set(key, (sizes.get(key) ?? 0) + 1);
  for (const card of context.permanents) {
    if (!card.tapped) add(`self:${card.instanceId}`);
    for (const subtype of [
      ...(context.input.cards[card.cardId]?.subtypes ?? []),
      ...(card.grantedTypes ?? []),
    ]) {
      add(`${card.tapped ? "tapped" : "untapped"}:${subtype.toLowerCase()}`);
    }
  }
  if (!context.attacker.heroTapped) add("hero");
  return sizes;
}

function computeThreat(input: BotPolicyInput, defended: boolean): PublicCombatThreat {
  const link = opposingLink(input);
  if (!link || link.targetAlly || link.targetAllyName) return NO_THREAT;
  const attacker = input.view.players[1 - input.seat]!;
  const attackingCard = link.attackingCard;
  const permanents = [
    ...attacker.board,
    ...attacker.weapons,
    ...Object.values(attacker.equipment).filter((card): card is CardView => card !== undefined),
  ];
  const context: Context = {
    input,
    link,
    attacker,
    attackIsAction: input.cards[attackingCard.cardId]?.cardType === "action",
    permanents,
  };
  const sources = [
    attackingCard,
    ...permanents.filter((card) => card.instanceId !== attackingCard.instanceId),
  ];
  const units = [
    ...sources.flatMap((source) => abilityUnits(context, source)),
    ...attacker.arsenal.flatMap((card) => arsenalUnits(context, card)),
    ...(defended ? defendedUnits(context) : []),
  ];
  if (units.length === 0) return NO_THREAT;

  // Free activations first, then the most damage per resource.
  units.sort((left, right) =>
    Number(left.resources > 0) - Number(right.resources > 0) ||
    right.gain / Math.max(1, right.resources) - left.gain / Math.max(1, left.resources)
  );
  const pools = poolSizes(context);
  let budget = resourceBudget(input, attacker);
  let attackBonus = 0;
  let directDamage = 0;
  for (const unit of units) {
    if (unit.resources > budget) continue;
    if (unit.pools.some((pool) => (pools.get(pool) ?? 0) <= 0)) continue;
    for (const pool of unit.pools) pools.set(pool, pools.get(pool)! - 1);
    budget -= unit.resources;
    if (unit.direct) directDamage += unit.gain;
    else attackBonus += unit.gain;
  }
  return { attackBonus, directDamage };
}
