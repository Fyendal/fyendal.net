import type { CardData, CardView } from "@fyendal/shared";
import {
  arsenalValue,
  averageDrawValue,
  defaultCardUses,
  DEFAULT_HIT_CHANCE,
  disruptionDiscount,
  hasStaticGoAgain,
  heldValue,
  type CardUses,
} from "./card-ev.js";
import {
  HandSolver,
  type PendingEffect,
  type SolverCard,
  type SolverEffect,
  type SolverFlags,
  type SolverView,
  type SolverZone,
} from "./hand-solver.js";
import type { BotPolicyInput } from "./policy.js";
import { evaluateOnHit } from "./value.js";

/** Shared context for building solver cards for one decision. */
export interface ModelContext {
  readonly input: BotPolicyInput;
  readonly hitChance: number;
  readonly discount: number;
  readonly averageDraw: number;
  readonly rules: HeroSolverRules;
}

/** Fields a hero rule may replace on the default card model. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type PatchableField = Exclude<keyof SolverCard, "instanceId" | "cardId" | "zone" | "arsenalValue" | "heldValue">;

export type SolverCardPatch = Partial<Mutable<Pick<SolverCard, PatchableField>>> & {
  /** Refinements to the static uses that drive arsenal and held value. */
  uses?: Partial<CardUses>;
  /** A patched `after` normally runs in addition to the effects parsed from
   * printed text; set this when the rule restates those effects itself. */
  replaceAfter?: boolean;
};

export function combineEffects(
  left: SolverEffect | undefined,
  right: SolverEffect | undefined,
): SolverEffect | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    flags: { ...(left.flags ?? {}), ...(right.flags ?? {}) },
    pending: [...(left.pending ?? []), ...(right.pending ?? [])],
    resources: (left.resources ?? 0) + (right.resources ?? 0),
    actionPoints: (left.actionPoints ?? 0) + (right.actionPoints ?? 0),
  };
}

/**
 * Hero-specific rules. Everything is optional: printed text supplies the
 * defaults, and rules only describe what text parsing cannot (conditional go
 * again, cost reductions, flags, equipment activations).
 */
export interface HeroSolverRules {
  readonly name: string;
  /** Traits whose played/link counts the rules read (default: all). */
  readonly trackedTraits?: readonly string[];
  /** Flags in force at the start of the evaluated action phase. */
  startFlags?(input: BotPolicyInput, nextTurn: boolean): SolverFlags;
  startPending?(input: BotPolicyInput, nextTurn: boolean): readonly PendingEffect[];
  /** Extra resources at the start of the evaluated action phase (e.g. Vigor). */
  startResources?(input: BotPolicyInput, nextTurn: boolean): number;
  /** Patch a hand/arsenal/weapon card's model. */
  card?(data: CardData, card: CardView, context: ModelContext): SolverCardPatch | undefined;
  /** Model an equipment activation; omit for passive or block-only pieces. */
  equipment?(data: CardData, card: CardView, context: ModelContext): SolverCardPatch | undefined;
  /** Hero activated abilities as solver sources (zone "ability"). */
  abilities?(context: ModelContext, nextTurn: boolean): readonly SolverCard[];
}

const NO_HERO_RULES: HeroSolverRules = { name: "generic" };
const PITCH_COLORS: Readonly<Record<number, string>> = { 1: "red", 2: "yellow", 3: "blue" };

/** Lowercase subtypes, classes, color and any types granted to this card. */
export function cardTraits(data: CardData, card?: Pick<CardView, "grantedTypes">): string[] {
  const color = data.color ?? PITCH_COLORS[Number(data.pitch ?? 0)];
  return [...new Set([
    ...(data.subtypes ?? []),
    ...(data.classes ?? []),
    ...(typeof color === "string" ? [color] : []),
    ...(card?.grantedTypes ?? []),
  ].map((value) => value.toLowerCase()))];
}

/** Resource cost of a weapon's attack ability: the {r} symbols before ":". */
export function weaponCost(data: CardData): number {
  const ability = /Action\s*-\s*([^:]*):/i.exec(data.text)?.[1] ?? "";
  return (ability.match(/\{r\}/g) ?? []).length;
}

/** On-hit clause, including Crush ("When this deals 4 or more damage to a
 * hero, ..."), which a connecting attack of that size triggers. */
function onHitText(text: string): string | undefined {
  return /when (?:this|it) hits(?: a hero)?,?\s*([^.]*(?:\.[^.]*?draw[^.]*)?)/i.exec(text)?.[1] ??
    /crush - (?:when|if) [^,]*? deals 4 or more damage to a hero, ([^.]*)/i.exec(text)?.[1];
}

const TARGET_PHRASE =
  /\b(?:[Tt]arget|[Nn]ext) ((?:[A-Z][a-z]+,? (?:or )?)*)attack( action card)?(?:[^.]*?with cost (\d+) or less)?/;

/** Trait words required of a pump's target, parsed from "target X attack" or
 * "next X attack" phrasing (e.g. Ninja, Draconic, Lightning or Elemental). */
function targetFilter(text: string): ((card: SolverCard, view: SolverView) => boolean) | undefined {
  const phrase = TARGET_PHRASE.exec(text);
  if (!phrase) return undefined;
  const words = (phrase[1] ?? "").trim();
  const alternatives = words ? words.toLowerCase().split(/,\s*(?:or\s+)?|\s+or\s+/).filter(Boolean) : [];
  const actionOnly = phrase[2] !== undefined;
  const maxCost = phrase[3] === undefined ? undefined : Number(phrase[3]);
  if (alternatives.length === 0 && !actionOnly && maxCost === undefined) return undefined;
  return (card, view) => {
    if (actionOnly && card.kind !== "attack") return false;
    if (maxCost !== undefined && card.cost > maxCost) return false;
    return alternatives.length === 0 || alternatives.some((trait) => view.hasTrait(card, trait));
  };
}

function defaultPending(data: CardData, uses: CardUses, card: CardView): PendingEffect[] {
  if (uses.kind !== "action" && uses.kind !== "instant") return [];
  const sentences = data.text.split(/(?<=\.)\s+|\n/);
  const effects: PendingEffect[] = [];
  sentences.forEach((sentence, index) => {
    if (!/\bnext\b/i.test(sentence)) return;
    const power = Number(/\+(\d+)\{p\}/.exec(sentence)?.[1] ?? 0);
    const grantsGoAgain = /gets? go again/i.test(sentence);
    const costReduction = /costs? \{r\} less/i.test(sentence) ? 1 : 0;
    if (power === 0 && !grantsGoAgain && costReduction === 0) return;
    const filter = targetFilter(sentence);
    effects.push({
      key: `${card.cardId}#${card.instanceId}.${index}`,
      uses: 1,
      ...(power ? { power } : {}),
      ...(grantsGoAgain ? { grantsGoAgain } : {}),
      ...(costReduction ? { costReduction } : {}),
      ...(filter ? { appliesTo: filter } : {}),
    });
  });
  return effects;
}

export function cardUses(data: CardData, input: BotPolicyInput, card?: CardView): CardUses {
  const base = defaultCardUses(data, card?.attack ?? data.attack ?? 0, card?.defense ?? data.defense ?? 0);
  const text = onHitText(data.text);
  const onHit = text
    ? evaluateOnHit({
      effects: [{ text }],
      attackerCanContinue: base.reliableGoAgain,
      attackerCanArsenal: true,
      defenderHasHand: true,
      defenderHasArsenal: input.view.players[1 - input.seat]!.arsenalCount > 0,
    }).value
    : 0;
  return { ...base, onHit };
}

export function modelContext(
  input: BotPolicyInput,
  rules: HeroSolverRules = NO_HERO_RULES,
  hitChance = DEFAULT_HIT_CHANCE,
): ModelContext {
  return {
    input,
    hitChance,
    rules,
    discount: disruptionDiscount(input),
    averageDraw: averageDrawValue(input, (data) => cardUses(data, input)),
  };
}

/** Default solver model for a card the bot holds, then hero-patched. */
export function solverCard(card: CardView, zone: SolverZone, context: ModelContext): SolverCard | undefined {
  const { input, rules } = context;
  const data = input.cards[card.cardId];
  if (!data) return undefined;
  const patch = zone === "equipment"
    ? rules.equipment?.(data, card, context)
    : rules.card?.(data, card, context);
  if (zone === "equipment" && !patch) return undefined;
  const uses = { ...cardUses(data, input, card), ...(patch?.uses ?? {}) };
  const pending = defaultPending(data, uses, card);
  const filter = uses.kind === "attack-reaction" ? targetFilter(data.text) : undefined;
  const { uses: _uses, replaceAfter, after: patchAfter, ...overrides } = patch ?? {};
  const defaultAfter = pending.length > 0 && !replaceAfter
    ? (): SolverEffect => ({ pending })
    : undefined;
  const after = patchAfter && defaultAfter
    ? (view: SolverView) => combineEffects(defaultAfter(), patchAfter(view))
    : patchAfter ?? defaultAfter;
  const base: SolverCard = {
    instanceId: card.instanceId,
    cardId: card.cardId,
    name: data.name,
    kind: uses.kind,
    zone,
    cost: uses.kind === "weapon" ? weaponCost(data) : Math.max(0, data.cost ?? 0),
    pitch: uses.pitch,
    power: uses.power,
    defense: uses.defense,
    goAgain: hasStaticGoAgain(data),
    traits: cardTraits(data, card),
    onHit: uses.onHit,
    ...(uses.kind === "attack-reaction" ? { reactionPower: uses.pump } : {}),
    ...(filter ? { reactionTarget: filter } : {}),
    ...(after ? { after } : {}),
    arsenalValue: zone === "hand" || zone === "arsenal" ? arsenalValue(uses, context.discount, context.hitChance) : 0,
    heldValue: zone === "hand" ? heldValue(uses, context.averageDraw, context.hitChance) : 0,
  };
  return { ...base, ...overrides };
}

/** A hero activated ability as a solver source: not consumed, no card value. */
export function abilitySource(
  fields: Pick<SolverCard, "instanceId" | "cardId" | "name" | "cost"> & Partial<SolverCard>,
): SolverCard {
  return {
    kind: "equipment",
    zone: "ability",
    speed: "action",
    pitch: 0,
    power: 0,
    defense: 0,
    goAgain: false,
    traits: [],
    onHit: 0,
    arsenalValue: 0,
    heldValue: 0,
    ...fields,
  };
}

/** Turn state already on the bot's open combat chain during its own turn:
 * chain links, attacks made, and per-trait link counts (e.g. Draconic). */
export function chainStartFlags(input: BotPolicyInput): { links: number; flags: SolverFlags } {
  const flags: Record<string, number> = {};
  let links = 0;
  for (const link of input.view.chain) {
    if (link.attackingCard.owner !== input.seat) continue;
    links++;
    flags.attacks = (flags.attacks ?? 0) + 1;
    const data = input.cards[link.attackingCard.cardId];
    for (const trait of data ? cardTraits(data, link.attackingCard) : []) {
      flags[`links:${trait}`] = (flags[`links:${trait}`] ?? 0) + 1;
    }
  }
  return { links, flags };
}

/**
 * Solver over the bot's hand, arsenal, weapons and equipment. On the bot's
 * own turn it continues the current action phase (resources, action points,
 * open chain); otherwise it evaluates the bot's next action phase.
 */
export function buildHandSolver(context: ModelContext): HandSolver {
  const { input, rules } = context;
  const me = input.view.players[input.seat];
  const nextTurn = input.view.activePlayer !== input.seat;
  const chain = nextTurn ? undefined : chainStartFlags(input);
  const sources: SolverCard[] = [];
  const add = (card: CardView, zone: SolverZone) => {
    const model = solverCard(card, zone, context);
    if (model) sources.push(model);
  };
  for (const card of me.hand) add(card, "hand");
  for (const card of me.arsenal) add(card, "arsenal");
  // A permission to play a banished card lasts only for the current turn.
  if (!nextTurn) {
    for (const card of me.banish) {
      if (card.playableFromSourceCardId !== undefined && !card.faceDown) add(card, "banish");
    }
  }
  for (const weapon of me.weapons) {
    if (nextTurn || !weapon.usedAbilityIndexes?.includes(0)) add(weapon, "weapon");
  }
  for (const equipment of Object.values(me.equipment)) if (equipment) add(equipment, "equipment");
  sources.push(...(rules.abilities?.(context, nextTurn) ?? []));
  return new HandSolver(sources, {
    startResources: (nextTurn ? 0 : me.resources) + (rules.startResources?.(input, nextTurn) ?? 0),
    startActionPoints: nextTurn ? 1 : me.actionPoints,
    hitChance: context.hitChance,
    ...(rules.trackedTraits ? { trackedTraits: rules.trackedTraits } : {}),
    startFlags: { ...(chain?.flags ?? {}), ...(rules.startFlags?.(input, nextTurn) ?? {}) },
    ...(chain ? { startLinks: chain.links } : {}),
    ...(rules.startPending ? { startPending: rules.startPending(input, nextTurn) } : {}),
  });
}
