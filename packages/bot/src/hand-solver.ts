/**
 * Exact, memoized search over one action phase from a known set of cards.
 *
 * Every number is a damage equivalent (the "expressed value" of a card): one
 * point of damage threatened, one point prevented, or the equivalent value of
 * a card held, arsenaled, or drawn. Hero rules enter only through card hooks
 * and flags; the search itself is hero-agnostic.
 *
 * Moves: play an attack/action/instant/attack reaction from hand or arsenal
 * (paying by pitching hand cards), swing a weapon (once per turn), activate
 * an equipment piece, or stop. At the end, leftovers are valued: the card left
 * in (or put into) arsenal at its arsenal value, every other held card at its
 * held value. Damage is counted as imposed (before blocks); on-hit value is
 * scaled by the configured hit chance.
 */

export type SolverCardKind =
  | "attack"
  | "weapon"
  | "action"
  | "attack-reaction"
  | "instant"
  | "defense-reaction"
  | "block"
  | "equipment"
  | "other";

/** `banish`: a card playable from the banished zone this turn only. It cannot
 * be pitched and has no leftover value. `ability`: a hero activated ability,
 * modelled like an equipment activation that is not consumed. */
export type SolverZone = "hand" | "arsenal" | "banish" | "weapon" | "equipment" | "ability";

export type SolverFlags = Readonly<Record<string, number>>;

/** Read-only snapshot passed to card hooks. `links` and flags describe the
 * turn *before* the card being evaluated is played. */
export interface SolverView {
  readonly flags: SolverFlags;
  readonly links: number;
  readonly lastAttack?: SolverCard;
  /** Hand and arsenal cards not yet used this turn (including any card
   * currently being evaluated). */
  readonly held: readonly SolverCard[];
  flag(name: string): number;
  /** Trait test that honours a card's dynamic `traitsIn` hook. */
  hasTrait(card: SolverCard, trait: string): boolean;
}

/** A continuous "next card/attack" effect waiting to be consumed. */
export interface PendingEffect {
  /** Stable identity used in memo keys; include the source card id. */
  readonly key: string;
  /** Remaining applications; Infinity for a whole-turn effect. */
  readonly uses: number;
  readonly power?: number;
  readonly costReduction?: number;
  readonly grantsGoAgain?: boolean;
  /** Damage-equivalent on-hit value added to the consuming attack. */
  readonly onHit?: number;
  /** Power applies only if the consuming attack ends up with go again. */
  readonly requiresGoAgain?: boolean;
  /** Conditional go-again grant evaluated against the consuming card. */
  goAgainFor?(card: SolverCard, view: SolverView): boolean;
  /** Which kinds of plays consume it. Defaults to the next attack only. */
  readonly scope?: "attack" | "card";
  appliesTo?(card: SolverCard, view: SolverView): boolean;
}

export interface SolverEffect {
  /** Absolute flag values to set after this play. */
  readonly flags?: Readonly<Record<string, number>>;
  readonly pending?: readonly PendingEffect[];
  readonly resources?: number;
  readonly actionPoints?: number;
}

export interface SolverCard {
  readonly instanceId: number;
  readonly cardId: string;
  readonly name: string;
  readonly kind: SolverCardKind;
  readonly zone: SolverZone;
  readonly cost: number;
  readonly pitch: number;
  readonly power: number;
  readonly defense: number;
  readonly goAgain: boolean;
  /** Lowercase subtypes, classes, talents and color ("red"/"yellow"/"blue"). */
  readonly traits: readonly string[];
  /** Damage-equivalent value of this attack's on-hit effects if it hits. */
  readonly onHit: number;
  /** Power an attack reaction adds to the current attack. */
  readonly reactionPower?: number;
  /** Damage-equivalent value gained when played that is not damage: a card
   * drawn, a token, a mark. Not scaled by hit chance. */
  bonusIn?(view: SolverView): number;
  /** Value lost by using this source (e.g. destroying equipment). */
  readonly consumeCost?: number;
  /** Equipment activation speed; action speed needs an action point. */
  readonly speed?: "action" | "instant";
  /** Arsenal value of this card for the following turn (card-ev). */
  readonly arsenalValue: number;
  /** Value of this card if held in hand through the turn (card-ev). */
  readonly heldValue: number;
  canPlay?(view: SolverView, self: SolverCard): boolean;
  costIn?(view: SolverView): number;
  powerIn?(view: SolverView): number;
  goAgainIn?(view: SolverView): boolean;
  onHitIn?(view: SolverView): number;
  traitsIn?(view: SolverView): readonly string[];
  /** Attack reactions: whether this reaction can target the current attack. */
  reactionTarget?(attack: SolverCard, view: SolverView): boolean;
  after?(view: SolverView): SolverEffect | undefined;
  /** Pitch trigger. Cards with this hook may be pitched beyond the minimum. */
  onPitch?(view: SolverView): SolverEffect | undefined;
}

export interface SolverConfig {
  startResources?: number;
  startActionPoints?: number;
  startFlags?: SolverFlags;
  startPending?: readonly PendingEffect[];
  /** Chain links already opened this turn (mid-turn evaluation). */
  startLinks?: number;
  /** Traits counted into `played:<trait>` / `links:<trait>` flags. Only the
   * traits hero rules read are tracked, keeping memo keys small. */
  trackedTraits?: readonly string[];
  /** Probability used to scale on-hit value. */
  hitChance?: number;
  /** Safety cap on explored states; the search is exact below it. */
  maxStates?: number;
}

export type SolverStepKind = "play" | "weapon" | "activate" | "react";

export interface SolverStep {
  readonly kind: SolverStepKind;
  readonly instanceId: number;
  readonly pitchIds: readonly number[];
  readonly damage: number;
  readonly goAgain: boolean;
}

export interface SolverResult {
  /** damage + onHit + leftoverValue − consumedValue */
  readonly value: number;
  readonly damage: number;
  /** Hit-scaled on-hit value plus non-damage play bonuses. */
  readonly onHit: number;
  readonly leftoverValue: number;
  readonly consumedValue: number;
  readonly line: readonly SolverStep[];
  /** Hand card the line leaves for arsenal, when the slot ends empty. */
  readonly arsenalInstanceId?: number;
}

interface TurnState {
  readonly remaining: number;
  readonly used: number;
  readonly resources: number;
  readonly actionPoints: number;
  readonly links: number;
  readonly lastAttack: number;
  readonly flags: SolverFlags;
  readonly pending: readonly PendingEffect[];
}

/** Persistent singly linked line; converted to an array once per solve. */
interface LineNode {
  readonly step: SolverStep;
  readonly next: LineNode | null;
}

interface Outcome {
  readonly value: number;
  readonly damage: number;
  readonly onHit: number;
  readonly leftoverValue: number;
  readonly consumedValue: number;
  readonly line: LineNode | null;
  readonly arsenalInstanceId: number | undefined;
}

const EPSILON = 1e-9;
const EMPTY_FLAGS: SolverFlags = Object.freeze({});

function pendingKey(pending: readonly PendingEffect[]): string {
  if (pending.length === 0) return "";
  if (pending.length === 1) return `${pending[0]!.key}x${pending[0]!.uses}`;
  return pending.map((effect) => `${effect.key}x${effect.uses}`).sort().join(",");
}

class TurnView implements SolverView {
  private heldCache: SolverCard[] | undefined;
  private readonly cards: readonly SolverCard[];
  private readonly remaining: number;
  readonly flags: SolverFlags;
  readonly links: number;
  readonly lastAttack: SolverCard | undefined;

  constructor(cards: readonly SolverCard[], flags: SolverFlags, links: number, remaining: number, lastAttack: number) {
    this.cards = cards;
    this.flags = flags;
    this.links = links;
    this.remaining = remaining;
    this.lastAttack = lastAttack >= 0 ? cards[lastAttack] : undefined;
  }

  get held(): readonly SolverCard[] {
    if (!this.heldCache) {
      const held: SolverCard[] = [];
      for (let index = 0; index < this.cards.length; index++) {
        const card = this.cards[index]!;
        if ((card.zone === "hand" || card.zone === "arsenal") && (this.remaining & (1 << index)) !== 0) {
          held.push(card);
        }
      }
      this.heldCache = held;
    }
    return this.heldCache;
  }

  flag(name: string): number {
    return this.flags[name] ?? 0;
  }

  hasTrait(card: SolverCard, trait: string): boolean {
    return (card.traitsIn ? card.traitsIn(this) : card.traits).includes(trait);
  }
}

function isPersistent(card: SolverCard): boolean {
  return card.zone === "weapon" || card.zone === "equipment" || card.zone === "ability";
}

function lineArray(line: LineNode | null): SolverStep[] {
  const steps: SolverStep[] = [];
  for (let node = line; node; node = node.next) steps.push(node.step);
  return steps;
}

export class HandSolver {
  private readonly cards: readonly SolverCard[];
  private readonly startResources: number;
  private readonly startActionPoints: number;
  private readonly startFlags: SolverFlags;
  private readonly startPending: readonly PendingEffect[];
  private readonly startLinks: number;
  private readonly hitChance: number;
  private readonly maxStates: number;
  private readonly tracked: ReadonlySet<string> | undefined;
  private readonly memo = new Map<string, Outcome>();
  /** Flag names in first-seen order: canonical keys without sorting. */
  private readonly flagNames: string[] = [];
  private readonly flagIds = new Map<string, number>();
  private readonly flagKeys = new WeakMap<object, string>();
  private readonly paymentCache = new Map<string, readonly (readonly number[])[]>();
  private readonly arsenalIndex: number;
  private readonly handMask: number;
  private readonly arsenalMask: number;
  /** Index of an earlier interchangeable copy (same card, same zone). */
  private readonly twinOf: readonly number[];
  private states = 0;

  constructor(cards: readonly SolverCard[], config: SolverConfig = {}) {
    if (cards.length > 30) throw new Error("hand solver supports at most 30 sources");
    this.cards = cards;
    this.startResources = config.startResources ?? 0;
    this.startActionPoints = config.startActionPoints ?? 1;
    this.startFlags = config.startFlags ?? EMPTY_FLAGS;
    this.startPending = config.startPending ?? [];
    this.startLinks = config.startLinks ?? 0;
    this.hitChance = config.hitChance ?? 0.6;
    this.maxStates = config.maxStates ?? 200_000;
    this.tracked = config.trackedTraits ? new Set(config.trackedTraits) : undefined;
    this.arsenalIndex = cards.findIndex((card) => card.zone === "arsenal");
    let handMask = 0;
    let arsenalMask = 0;
    cards.forEach((card, index) => {
      if (card.zone === "hand") handMask |= 1 << index;
      if (card.zone === "arsenal") arsenalMask |= 1 << index;
    });
    this.handMask = handMask;
    this.arsenalMask = arsenalMask;
    // Copies built by the same rules behave identically; instance-keyed
    // state (pending keys, extra weapon uses) only distinguishes used copies.
    this.twinOf = cards.map((card, index) => cards.findIndex((other, otherIndex) =>
      otherIndex < index && other.cardId === card.cardId && other.zone === card.zone &&
      other.arsenalValue === card.arsenalValue && other.heldValue === card.heldValue &&
      other.power === card.power && other.defense === card.defense
    ));
  }

  get sources(): readonly SolverCard[] {
    return this.cards;
  }

  /** Best line using only the cards whose instance ids are in `available`
   * (default: every card). Weapons, equipment and abilities are always
   * available. */
  solve(available?: ReadonlySet<number>): SolverResult {
    let remaining = 0;
    this.cards.forEach((card, index) => {
      if (isPersistent(card) || !available || available.has(card.instanceId)) remaining |= 1 << index;
    });
    return this.result(this.solveMask(remaining));
  }

  /** Value of every subset of the given hand cards, keyed by bitmask over
   * `handIds`; other sources are always available. Subproblems share the memo,
   * so the whole table costs little more than one solve. */
  subsetValues(handIds: readonly number[]): Map<number, SolverResult> {
    const bits = handIds.map((id) => 1 << this.cards.findIndex((card) => card.instanceId === id));
    const always = ~this.handMask & ((1 << this.cards.length) - 1);
    const table = new Map<number, SolverResult>();
    for (let mask = 0; mask < 1 << handIds.length; mask++) {
      const remaining = bits.reduce((total, bit, index) => (mask & (1 << index)) !== 0 ? total | bit : total, always);
      table.set(mask, this.result(this.solveMask(remaining)));
    }
    return table;
  }

  private result(outcome: Outcome): SolverResult {
    return {
      value: outcome.value,
      damage: outcome.damage,
      onHit: outcome.onHit,
      leftoverValue: outcome.leftoverValue,
      consumedValue: outcome.consumedValue,
      line: lineArray(outcome.line),
      ...(outcome.arsenalInstanceId !== undefined ? { arsenalInstanceId: outcome.arsenalInstanceId } : {}),
    };
  }

  private solveMask(remaining: number): Outcome {
    return this.search({
      remaining,
      used: 0,
      resources: this.startResources,
      actionPoints: this.startActionPoints,
      links: this.startLinks,
      lastAttack: -1,
      flags: this.startFlags,
      pending: this.startPending,
    });
  }

  private flagsKey(flags: SolverFlags): string {
    let key = this.flagKeys.get(flags);
    if (key !== undefined) return key;
    for (const name in flags) {
      if (!this.flagIds.has(name)) {
        this.flagIds.set(name, this.flagNames.length);
        this.flagNames.push(name);
      }
    }
    key = "";
    for (let id = 0; id < this.flagNames.length; id++) {
      const value = flags[this.flagNames[id]!];
      if (value) key += `${id}:${value},`;
    }
    this.flagKeys.set(flags, key);
    return key;
  }

  private key(state: TurnState): string {
    return `${state.remaining}|${state.used}|${state.resources}|${state.actionPoints}|${state.links}|` +
      `${state.lastAttack}|${this.flagsKey(state.flags)}|${pendingKey(state.pending)}`;
  }

  private terminal(state: TurnState): Outcome {
    let held = 0;
    let bestGain = 0;
    let arsenalInstanceId: number | undefined;
    const arsenalStays = this.arsenalIndex >= 0 && (state.remaining & (1 << this.arsenalIndex)) !== 0;
    const live = state.remaining & (this.handMask | this.arsenalMask);
    for (let index = 0; index < this.cards.length; index++) {
      if ((live & (1 << index)) === 0) continue;
      const card = this.cards[index]!;
      if (card.zone === "hand") {
        held += card.heldValue;
        const gain = card.arsenalValue - card.heldValue;
        if (!arsenalStays && gain > bestGain + EPSILON) {
          bestGain = gain;
          arsenalInstanceId = card.instanceId;
        }
      } else {
        held += card.arsenalValue;
      }
    }
    const leftoverValue = held + bestGain;
    return {
      value: leftoverValue, damage: 0, onHit: 0, leftoverValue, consumedValue: 0, line: null, arsenalInstanceId,
    };
  }

  private search(state: TurnState): Outcome {
    const key = this.key(state);
    const cached = this.memo.get(key);
    if (cached) return cached;
    this.states++;
    let best = this.terminal(state);
    if (this.states < this.maxStates) {
      const view = new TurnView(this.cards, state.flags, state.links, state.remaining, state.lastAttack);
      for (let index = 0; index < this.cards.length; index++) {
        if ((state.remaining & (1 << index)) === 0) continue;
        const twin = this.twinOf[index]!;
        // An unused earlier copy already explores every line this one would.
        if (twin >= 0 && (state.remaining & (1 << twin)) !== 0 && (state.used & (1 << twin)) === 0 &&
          (state.used & (1 << index)) === 0) continue;
        best = this.bestMove(state, view, index, this.cards[index]!, best);
      }
    }
    this.memo.set(key, best);
    return best;
  }

  private bestMove(state: TurnState, view: TurnView, index: number, card: SolverCard, best: Outcome): Outcome {
    const persistent = isPersistent(card);
    const bit = 1 << index;
    if (persistent && (state.used & bit) !== 0 && view.flag(`extraUse:${card.instanceId}`) <= 0) return best;
    if (card.canPlay && !card.canPlay(view, card)) return best;

    let kind: SolverStepKind;
    let needsActionPoint: boolean;
    let isAttack = false;
    switch (card.kind) {
      case "attack":
        kind = "play"; needsActionPoint = true; isAttack = true; break;
      case "weapon":
        kind = "weapon"; needsActionPoint = true; isAttack = true; break;
      case "action":
        kind = "play"; needsActionPoint = true; break;
      case "instant":
        kind = "play"; needsActionPoint = false; break;
      case "attack-reaction":
        if (state.lastAttack < 0) return best;
        if (card.reactionTarget && !card.reactionTarget(this.cards[state.lastAttack]!, view)) return best;
        kind = "react"; needsActionPoint = false; break;
      case "equipment":
        if (card.speed === undefined) return best;
        kind = "activate"; needsActionPoint = card.speed === "action"; break;
      default:
        return best;
    }
    if (needsActionPoint && state.actionPoints < 1) return best;

    // Pending effects that this play consumes.
    let consumes: PendingEffect[] | undefined;
    if (kind !== "react") {
      for (const effect of state.pending) {
        if ((effect.scope ?? "attack") === "attack" && !isAttack) continue;
        if (effect.appliesTo && !effect.appliesTo(card, view)) continue;
        (consumes ??= []).push(effect);
      }
    }
    const baseCost = card.costIn ? card.costIn(view) : card.cost;
    let discount = 0;
    if (consumes) for (const effect of consumes) discount += effect.costReduction ?? 0;
    const cost = Math.max(0, baseCost - discount);
    for (const pitched of this.payments(state, index, cost)) {
      const candidate = this.resolve(state, index, card, kind, needsActionPoint, isAttack, consumes, cost, pitched);
      if (candidate.value > best.value + EPSILON) best = candidate;
    }
    return best;
  }

  /** Pitch sets that pay `cost`: every card is necessary unless it has a
   * pitch trigger. Functionally identical sets are explored once. */
  private payments(state: TurnState, playedIndex: number, cost: number): readonly (readonly number[])[] {
    const need = cost - state.resources;
    if (need <= 0) return NO_PAYMENT;
    const pitchable = state.remaining & this.handMask & ~(1 << playedIndex);
    const cacheKey = `${pitchable}|${need}`;
    const cached = this.paymentCache.get(cacheKey);
    if (cached) return cached;
    const candidates: number[] = [];
    for (let index = 0; index < this.cards.length; index++) {
      if ((pitchable & (1 << index)) !== 0 && this.cards[index]!.pitch > 0) candidates.push(index);
    }
    const results: number[][] = [];
    const seen = new Set<string>();
    for (let mask = 1; mask < 1 << candidates.length; mask++) {
      const chosen = candidates.filter((_, bit) => (mask & (1 << bit)) !== 0);
      let total = 0;
      for (const index of chosen) total += this.cards[index]!.pitch;
      if (total < need) continue;
      const minimal = chosen.every((index) => {
        const card = this.cards[index]!;
        return card.onPitch !== undefined || total - card.pitch < need;
      });
      if (!minimal) continue;
      const signature = chosen.map((index) => this.cards[index]!.cardId).sort().join("+");
      if (seen.has(signature)) continue;
      seen.add(signature);
      results.push(chosen);
    }
    this.paymentCache.set(cacheKey, results);
    return results;
  }

  private count(counters: Record<string, number>, prefix: string, traits: readonly string[]): void {
    if (this.tracked?.size === 0) return;
    for (const trait of traits) {
      if (this.tracked && !this.tracked.has(trait)) continue;
      counters[`${prefix}${trait}`] = (counters[`${prefix}${trait}`] ?? 0) + 1;
    }
  }

  private resolve(
    state: TurnState,
    index: number,
    card: SolverCard,
    kind: SolverStepKind,
    needsActionPoint: boolean,
    isAttack: boolean,
    consumes: readonly PendingEffect[] | undefined,
    cost: number,
    pitched: readonly number[],
  ): Outcome {
    const bit = 1 << index;
    const persistent = isPersistent(card);
    let remaining = state.remaining;
    let resources = state.resources - cost;
    for (const pitchIndex of pitched) {
      remaining &= ~(1 << pitchIndex);
      resources += this.cards[pitchIndex]!.pitch;
    }
    if (!persistent) remaining &= ~bit;
    let flags = state.flags;
    let pending: PendingEffect[] | undefined;
    const whilePlaying = persistent ? remaining : remaining | bit;

    // Pitch triggers see the turn before this card resolves.
    for (const pitchIndex of pitched) {
      const onPitch = this.cards[pitchIndex]!.onPitch;
      if (!onPitch) continue;
      const effect = onPitch(new TurnView(this.cards, flags, state.links, whilePlaying, state.lastAttack));
      if (effect?.flags) flags = { ...flags, ...effect.flags };
      if (effect?.pending) (pending ??= [...state.pending]).push(...effect.pending);
      resources += effect?.resources ?? 0;
    }
    if (persistent && (state.used & bit) !== 0) {
      const name = `extraUse:${card.instanceId}`;
      flags = { ...flags, [name]: (flags[name] ?? 0) - 1 };
    }
    const before = new TurnView(this.cards, flags, state.links, whilePlaying, state.lastAttack);

    // Consume matched pending effects.
    let nextPending: readonly PendingEffect[] = pending ?? state.pending;
    if (consumes) {
      const consumed = new Set(consumes);
      const kept: PendingEffect[] = [];
      for (const effect of nextPending) {
        if (!consumed.has(effect)) kept.push(effect);
        else if (effect.uses > 1) kept.push({ ...effect, uses: effect.uses - 1 });
      }
      nextPending = kept;
    }

    let damage = 0;
    let onHit = 0;
    let goAgain = false;
    let actionPoints = state.actionPoints - (needsActionPoint ? 1 : 0);
    let links = state.links;
    let lastAttack = state.lastAttack;
    const traits = card.traitsIn ? card.traitsIn(before) : card.traits;
    const counters: Record<string, number> = {};

    if (isAttack) {
      goAgain = card.goAgainIn ? card.goAgainIn(before) : card.goAgain;
      let power = card.powerIn ? card.powerIn(before) : card.power;
      let effectOnHit = 0;
      if (consumes) {
        for (const effect of consumes) {
          if (effect.grantsGoAgain === true || effect.goAgainFor?.(card, before) === true) goAgain = true;
        }
        for (const effect of consumes) {
          if (!(effect.requiresGoAgain && !goAgain)) power += effect.power ?? 0;
          effectOnHit += effect.onHit ?? 0;
        }
      }
      damage = Math.max(0, power);
      onHit = ((card.onHitIn ? card.onHitIn(before) : card.onHit) + effectOnHit) * this.hitChance;
      links++;
      lastAttack = index;
      counters.attacks = 1;
      this.count(counters, "links:", traits);
    } else if (kind === "react") {
      damage = card.reactionPower ?? 0;
    } else {
      goAgain = card.goAgainIn ? card.goAgainIn(before) : card.goAgain;
      // An action-speed play happens after the previous link resolved, so
      // its reaction window is closed. Instants may still be cast inside it.
      if (needsActionPoint) lastAttack = -1;
    }
    if (goAgain && needsActionPoint) actionPoints++;
    if (!persistent) {
      counters.played = 1;
      counters[`kind:${card.kind}`] = 1;
      this.count(counters, "played:", traits);
    }
    const merged: Record<string, number> = { ...flags };
    for (const name in counters) merged[name] = (merged[name] ?? 0) + counters[name]!;
    if (isAttack) merged.lastAttackGoAgain = goAgain ? 1 : 0;
    flags = merged;
    const bonus = card.bonusIn ? card.bonusIn(before) : 0;
    const effect = card.after?.(new TurnView(this.cards, flags, state.links, remaining, state.lastAttack));
    if (effect) {
      if (effect.flags) flags = { ...flags, ...effect.flags };
      if (effect.pending && effect.pending.length > 0) nextPending = [...nextPending, ...effect.pending];
      resources += effect.resources ?? 0;
      actionPoints += effect.actionPoints ?? 0;
    }
    const consumedValue = card.consumeCost ?? 0;

    const next = this.search({
      remaining,
      used: persistent ? state.used | bit : state.used,
      resources,
      actionPoints,
      links,
      lastAttack,
      flags,
      pending: nextPending,
    });
    const step: SolverStep = {
      kind,
      instanceId: card.instanceId,
      pitchIds: pitched.map((pitchIndex) => this.cards[pitchIndex]!.instanceId),
      damage,
      goAgain,
    };
    return {
      value: next.value + damage + onHit + bonus - consumedValue,
      damage: next.damage + damage,
      onHit: next.onHit + onHit + bonus,
      leftoverValue: next.leftoverValue,
      consumedValue: next.consumedValue + consumedValue,
      line: { step, next: next.line },
      arsenalInstanceId: next.arsenalInstanceId,
    };
  }
}

const NO_PAYMENT: readonly (readonly number[])[] = [[]];
