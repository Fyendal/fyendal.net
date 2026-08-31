import { expect } from "vitest";
import type { Decklist, EquipmentSlot, GameIntent, MeldSide, PlayableZone } from "@fyendal/shared";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { CardInstance, EngineTransitionMove, GameState } from "@fyendal/engine";
import { functionalKeyOf } from "../functional.js";
import { cardData, decklists, scripts } from "../index.js";

function visibleLogText(text: string): string {
  return text.replace(/⟦[A-Z0-9]+⟧/g, "");
}

function formatLog(log: GameState["log"]): string {
  return log.map((entry) => entry.publicText
    ?? entry.seatText?.filter((text): text is string => text !== null).join(" / ")
    ?? "(private)").map(visibleLogText).join(" | ");
}

/**
 * Scenario harness for per-card tests.
 *
 * Setup is explicit (exact hands, deck order, life, equipment, mentors) and is
 * the only place state is touched directly. Everything after setup is driven
 * exclusively through `legalIntents` + `applyIntent`, exactly like a client —
 * a scenario can never do anything the rules engine would reject. When a verb
 * matches no legal intent it throws, failing the test loudly.
 *
 * Conventions:
 * - Cards are referenced by functional key ("wild ride|1") or printing id.
 * - `deck` is top-first; `mentor: true` starts the hero's real mentor face
 *   down in the arsenal (flip it with endTurn() cycles + chooseOption).
 * - Most verbs auto-`settle()`: priority windows are passed, end-phase
 *   arsenal decisions declined. settle() STOPS at defend decisions and at
 *   scripted choices — answer those with blockWith()/chooseOption().
 * - End-of-turn "draw up to intellect" still happens per the rules; keep
 *   hands at 4 cards or decks empty where extra draws would pollute a test.
 */

export type HeroName = keyof typeof decklists;

/** The hero's mentor (an ordinary deck card; the mentor option places it
 *  face down in the arsenal as a valid mid-game state). */
const MENTOR_OF: Record<HeroName, string> = {
  rhinar: "chief ruk'utan|0",
  dorinthea: "hala goldenhelm|0",
};

export interface SeatSpec {
  hero: HeroName;
  /** Override the hero card (functional key or printing id) — for heroes with
   *  no registered decklist (e.g. precon heroes under test). */
  heroKey?: string;
  life?: number;
  hand?: string[];
  /** Top-first. */
  deck?: string[];
  /** Face-up cards in arsenal (mentor is separate). */
  arsenal?: string[];
  /** Face-down cards in arsenal for setup-only mid-game scenarios. */
  arsenalFaceDown?: string[];
  graveyard?: string[];
  /** Face-up cards starting in the hero's banished zone. */
  banish?: string[];
  /** Face-down cards starting in the hero's banished zone (inert: no
   *  properties, not playable, not countable unless an effect says face-down). */
  banishFaceDown?: string[];
  pitch?: string[];
  /** Cards starting in the hero's soul. */
  soul?: string[];
  /** Cards retained privately outside starting zones. */
  inventory?: string[];
  /** Board-state cards (allies, items, tokens) already in the arena. */
  board?: string[];
  /** Floating resources at game start (e.g. to pay a "when this defends" cost). */
  resources?: number;
  /** Start the hero's real mentor face down in the arsenal. */
  mentor?: boolean;
  /** Override the hero's default weapons. */
  weapons?: string[];
  /** Override single equipment slots (null removes the slot). */
  equipment?: Partial<Record<EquipmentSlot, string | null>>;
}

export interface ScenarioOpts {
  seed?: number;
  seats: [SeatSpec, SeatSpec];
  /** Seat that starts in a clean action phase (default 0). */
  active?: 0 | 1;
  /** Rule-defined global objects supplied by the scenario's format. */
  globals?: string[];
}

export type ZoneName =
  | "hand"
  | "deck"
  | "arsenal"
  | "graveyard"
  | "pitch"
  | "banish"
  | "soul"
  | "board";

const FILLER = "RNR020"; // Raging Onslaught — vanilla, inert for setup purposes

/** Resolve a functional key ("wild ride|1") or printing id to a printing id. */
export function printingId(key: string): string {
  if (cardData[key]) return key;
  const found = Object.values(cardData).filter((c) => functionalKeyOf(c) === key);
  if (found.length === 0) throw new Error(`unknown card key "${key}"`);
  return found[0]!.id;
}

export class Scenario {
  state: GameState;
  lastEvents: EngineTransitionMove[] = [];
  transitionEvents: EngineTransitionMove[] = [];

  constructor(opts: ScenarioOpts) {
    const seats = opts.seats;
    const state = createGame({
      globalCardIds: (opts.globals ?? []).map(printingId),
      decklists: seats.map((spec) => {
        const base = decklists[spec.hero];
        const zoned = [
          ...(spec.hand ?? []),
          ...(spec.deck ?? []),
          ...(spec.arsenal ?? []),
          ...(spec.arsenalFaceDown ?? []),
          ...(spec.graveyard ?? []),
          ...(spec.banish ?? []),
          ...(spec.banishFaceDown ?? []),
          ...(spec.pitch ?? []),
          ...(spec.soul ?? []),
          ...(spec.board ?? []),
        ].map(printingId);
        const equipment = { ...base.equipment };
        for (const [slot, key] of Object.entries(spec.equipment ?? {})) {
          if (key === null) delete equipment[slot as EquipmentSlot];
          else equipment[slot as EquipmentSlot] = printingId(key);
        }
        return {
          heroId: spec.heroKey ? printingId(spec.heroKey) : base.heroId,
          weaponIds: (spec.weapons ?? base.weaponIds).map(printingId),
          equipment,
          deck: [...zoned, ...Array(Math.max(0, 12 - zoned.length)).fill(FILLER)],
        };
      }) as [Decklist, Decklist],
      seed: opts.seed ?? 1,
      cards: cardData,
      scripts,
    });
    this.state = state;

    // Rebuild every zone from the spec with fresh instances, then normalize
    // to a clean action phase for `active` (setup, not play — see header).
    const active = opts.active ?? 0;
    seats.forEach((spec, seat) => {
      const p = state.players[seat]!;
      const mk = (key: string): CardInstance => ({
        instanceId: state.nextInstanceId++,
        cardId: printingId(key),
        owner: seat,
      });
      p.hand = (spec.hand ?? []).map(mk);
      p.deck = (spec.deck ?? []).map(mk);
      p.graveyard = (spec.graveyard ?? []).map(mk);
      p.pitch = (spec.pitch ?? []).map(mk);
      p.banish = [
        ...(spec.banish ?? []).map(mk),
        ...(spec.banishFaceDown ?? []).map((key) => ({ ...mk(key), faceDown: true })),
      ];
      p.soul = (spec.soul ?? []).map(mk);
      p.inventory = (spec.inventory ?? []).map(mk);
      p.board = (spec.board ?? []).map(mk);
      // living permanents (allies) start at their base life — mirrors the
      // engine's entering-the-arena stamping
      for (const c of p.board) {
        const life = cardData[c.cardId]?.life;
        if (life !== undefined) c.life = life;
      }
      const mentors = spec.mentor
        ? [{ ...mk(MENTOR_OF[spec.hero]), faceDown: true }]
        : [];
      p.arsenal = [
        ...mentors,
        ...(spec.arsenal ?? []).map(mk),
        ...(spec.arsenalFaceDown ?? []).map((key) => ({ ...mk(key), faceDown: true })),
      ];
      if (spec.weapons) p.weapons = spec.weapons.map(mk);
      if (spec.equipment) {
        for (const [slot, key] of Object.entries(spec.equipment)) {
          if (key === null) delete p.equipment[slot as EquipmentSlot];
          else {
            const eq = mk(key);
            // Cloaked equipment enters the arena face-down (mirrors createGame)
            if ((cardData[eq.cardId]?.keywords ?? []).some((k) => k.toLowerCase() === "cloaked")) {
              eq.faceDown = true;
            }
            p.equipment[slot as EquipmentSlot] = eq;
          }
        }
      }
      p.life = spec.life ?? cardData[p.heroCardId]?.life ?? 20;
      p.resources = spec.resources ?? 0;
      p.actionPoints = seat === active ? 1 : 0;
      p.flags = {};
    });
    state.turn = 1;
    state.activePlayer = active;
    state.priorityPlayer = active;
    state.phase = "action";
    state.pendingDecision = null;
    state.stack = [];
    state.stackResume = null;
    state.stackPasses = 0;
    state.reactionPasses = 0;
    state.chain = [];
    state.resolving = [];
    state.modifiers = [];
    state.winner = null;
    state.log = [];
  }

  // ── driving (legalIntents + applyIntent only) ────────────────────────────

  private actor(): number {
    return this.state.pendingDecision?.player ?? this.state.priorityPlayer;
  }

  private cardIdOf(instanceId: number): string | undefined {
    for (const p of this.state.players) {
      const zones = [p.hand, p.deck, p.arsenal, p.pitch, p.graveyard, p.banish, p.soul, p.board];
      for (const z of zones) {
        const c = z.find((x) => x.instanceId === instanceId);
        if (c) return c.cardId;
      }
      for (const c of Object.values(p.equipment)) if (c?.instanceId === instanceId) return c.cardId;
      const w = p.weapons.find((x) => x.instanceId === instanceId);
      if (w) return w.cardId;
      if (p.hero.instanceId === instanceId) return p.hero.cardId;
    }
    for (const link of this.state.chain) {
      if (link.attackingCard.instanceId === instanceId) return link.attackingCard.cardId;
      for (const c of [...link.defendingCards, ...link.defendingEquipment, ...link.reactions]) {
        if (c.instanceId === instanceId) return c.cardId;
      }
    }
    return undefined;
  }

  private do(intent: GameIntent): void {
    const seat = this.actor();
    const r = applyIntent(this.state, seat, intent);
    if (!r.ok) {
      throw new Error(
        `intent ${JSON.stringify(intent)} rejected: ${r.error}\n` +
          `last log: ${formatLog(this.state.log.slice(-5))}`,
      );
    }
    this.lastEvents = r.events;
    this.transitionEvents.push(...r.events);
    this.state = r.state;
  }

  /** Send a raw intent, bypassing legalIntents for explicit rejection and
   * edge-path specifications. */
  doRaw(intent: GameIntent): this {
    this.do(intent);
    return this;
  }

  /** Pass windows/arsenal decisions until the game needs a real choice:
   *  a defend decision, a scripted choice, or a clean action phase.
   *  Simultaneous-trigger ordering is auto-answered in board order — tests
   *  that care about the order drive it with chooseOption/settle:false. */
  settle(): this {
    for (let guard = 0; guard < 60 && this.state.winner === null; guard++) {
      const pd = this.state.pendingDecision;
      if (!pd && this.state.phase === "action") return this;
      if (pd?.chooseHook === "trigger-order") {
        this.do({ kind: "choose", optionId: pd.options![0]! });
        continue;
      }
      // look-at floats are acknowledgments, not real choices: pass through them
      if (pd?.chooseHook === "engine-look") {
        this.do({ kind: "choose", optionId: "pass" });
        continue;
      }
      // Pitch ordering is strategically relevant in live play. Scenario tests
      // that do not inspect it retain the cards' existing pitch-zone order.
      if (pd?.chooseHook === "engine-end-phase-pitch-order") {
        this.do({ kind: "choose", optionId: pd.options![0]! });
        continue;
      }
      if (pd && (pd.kind === "defend" || pd.kind === "optional-effect" || pd.kind === "choose-target" || pd.kind === "choose-name")) {
        return this;
      }
      this.do({ kind: "pass" });
    }
    if (this.state.winner === null) throw new Error("settle() did not converge");
    return this;
  }

  private handInstances(seat: number, keys: string[]): number[] {
    const hand = this.state.players[seat]!.hand;
    const used = new Set<number>();
    return keys.map((key) => {
      const id = printingId(key);
      const c = hand.find((x) => x.cardId === id && !used.has(x.instanceId));
      if (!c) throw new Error(`no "${key}" in seat ${seat}'s hand to pitch/discard`);
      used.add(c.instanceId);
      return c.instanceId;
    });
  }

  private alternativeCostInstances(seat: number, keys: string[]): number[] {
    const player = this.state.players[seat]!;
    const pool = [
      ...player.hand,
      ...player.board,
      ...player.weapons,
      ...Object.values(player.equipment).filter(
        (card): card is NonNullable<typeof card> => card !== undefined,
      ),
    ];
    const used = new Set<number>();
    return keys.map((key) => {
      const id = printingId(key);
      const card = pool.find(
        (candidate) => candidate.cardId === id && !used.has(candidate.instanceId),
      );
      if (!card) throw new Error(`no "${key}" controlled by seat ${seat} for an alternative cost`);
      used.add(card.instanceId);
      return card.instanceId;
    });
  }

  private sameInstanceIds(actual: readonly number[] | undefined, wanted: readonly number[]): boolean {
    if (!actual || actual.length !== wanted.length) return false;
    const a = [...actual].sort((x, y) => x - y);
    const b = [...wanted].sort((x, y) => x - y);
    return a.every((id, index) => id === b[index]);
  }

  private pitchMatches(intentPitches: number[], keys: string[] | undefined, seat: number): boolean {
    if (!keys) return true;
    const wanted = this.handInstances(seat, keys).sort((a, b) => a - b);
    const got = [...intentPitches].sort((a, b) => a - b);
    return wanted.length === got.length && wanted.every((v, i) => v === got[i]);
  }

  /** Default pitch choice: fewest cards, least overpay; ties go to the card
   *  latest in hand (tests list the cards they care about first, fodder last). */
  private pickIntent<T extends { pitchInstanceIds: number[] }>(candidates: T[]): T | undefined {
    let best: T | undefined;
    let bestScore = Infinity;
    for (const i of candidates) {
      const cards = i.pitchInstanceIds.length;
      const sum = i.pitchInstanceIds.reduce(
        (s, id) => s + (cardData[this.cardIdOf(id) ?? ""]?.pitch ?? 0),
        0,
      );
      const score = cards * 100 + sum;
      if (score <= bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /** Resolve an ally key on the OPPONENT's board to its instance id (attack
   *  target for `targetAlly` options). */
  private targetAllyIdOf(seat: number, key: string): number {
    const id = printingId(key);
    const opp = this.state.players[seat === 0 ? 1 : 0]!;
    const c = opp.board.find((x) => x.cardId === id);
    if (!c) throw new Error(`no "${key}" on the opponent's board to target`);
    return c.instanceId;
  }

  /** Resolve an attacking/defending card named by a target-aware play intent. */
  private targetCardInstanceIdOf(key: string): number {
    const link = this.state.chain[this.state.chain.length - 1];
    const wanted = functionalKeyOf(cardData[printingId(key)]!);
    const card = (link ? [link.attackingCard, ...link.defendingCards] : [])
      .find((candidate) => functionalKeyOf(cardData[candidate.cardId]!) === wanted) ??
      this.state.stack.flatMap((layer) => layer.card ? [layer.card] : [])
        .find((candidate) => functionalKeyOf(cardData[candidate.cardId]!) === wanted);
    if (!card) throw new Error(`no current combat or stack card "${key}" to target`);
    return card.instanceId;
  }

  /** Resolve a public permanent named by a target-aware play intent. */
  private targetPermanentInstanceIdOf(key: string): number {
    const wanted = functionalKeyOf(cardData[printingId(key)]!);
    const card = this.state.players.flatMap((player) => [
      ...player.board,
      ...player.weapons,
      ...Object.values(player.equipment).filter((candidate): candidate is CardInstance => !!candidate),
    ]).find((candidate) => functionalKeyOf(cardData[candidate.cardId]!) === wanted);
    if (!card) throw new Error(`no public permanent "${key}" to target`);
    return card.instanceId;
  }

  /** Play a card from the active player's hand (first legal pitch combination
   *  unless `pitch` pins it). Attacks land on the defend decision. `meldSide`
   *  picks one of a Meld card's announced-side variants; `targetAlly` aims an
   *  attack at an opposing ally instead of the hero; `targetCard` announces
   *  a card target from the current combat/stack; `targetPermanent` announces
   *  a public arena target. */
  play(
    key: string,
    opts: {
      pitch?: string[];
      settle?: boolean;
      fromArsenal?: boolean;
      meldSide?: MeldSide;
      targetAlly?: string;
      targetCard?: string;
      targetPermanent?: string;
      boost?: boolean;
      boostCount?: number;
      asInstant?: boolean;
      fromZone?: PlayableZone;
      /** Pay an offered alternative cost with these controlled cards. */
      alternativeCost?: string | string[];
    } = {},
  ): this {
    const seat = this.state.activePlayer;
    const id = printingId(key);
    const alternativeCostInstanceIds = opts.alternativeCost === undefined
      ? undefined
      : this.alternativeCostInstances(
          seat,
          Array.isArray(opts.alternativeCost) ? opts.alternativeCost : [opts.alternativeCost],
        );
    const legal = legalIntents(this.state, seat).filter(
      (i): i is Extract<GameIntent, { kind: "play-card" | "play-from-arsenal" | "play-from-zone" }> => {
        if (this.cardIdOf("instanceId" in i ? i.instanceId : -1) !== id) return false;
        if (opts.fromArsenal) return i.kind === "play-from-arsenal";
        if (opts.fromZone) return i.kind === "play-from-zone" && i.zone === opts.fromZone;
        return i.kind === "play-card";
      },
    );
    const matching = legal.filter(
      (i) =>
        (opts.meldSide === undefined || i.meldSide === opts.meldSide) &&
        (opts.boost === undefined || i.boost === opts.boost) &&
        (opts.boostCount === undefined || (i.boostCount ?? (i.boost ? 1 : 0)) === opts.boostCount) &&
        (opts.asInstant === undefined || (i.asInstant ?? false) === opts.asInstant) &&
        (alternativeCostInstanceIds === undefined ||
          this.sameInstanceIds(i.alternativeCostCardInstanceIds, alternativeCostInstanceIds)) &&
        (opts.targetAlly === undefined
          ? i.targetAllyId === undefined // default: aim at the hero
          : i.targetAllyId === this.targetAllyIdOf(seat, opts.targetAlly)) &&
        (opts.targetCard === undefined ||
          i.targetCardInstanceId === this.targetCardInstanceIdOf(opts.targetCard)) &&
        (opts.targetPermanent === undefined ||
          i.targetCardInstanceId === this.targetPermanentInstanceIdOf(opts.targetPermanent)) &&
        this.pitchMatches(i.pitchInstanceIds, opts.pitch, seat),
    );
    // When both methods are legal, ordinary scenario plays default to the
    // action method; tests that exercise the alternate method opt in.
    const methodMatching =
      opts.asInstant === undefined && matching.some((i) => i.asInstant !== true)
        ? matching.filter((i) => i.asInstant !== true)
        : matching;
    const costMatching =
      alternativeCostInstanceIds === undefined &&
      methodMatching.some((i) => i.alternativeCostCardInstanceIds === undefined)
        ? methodMatching.filter((i) => i.alternativeCostCardInstanceIds === undefined)
        : methodMatching;
    const intent = opts.pitch ? costMatching[0] : this.pickIntent(costMatching);
    if (!intent) {
      throw new Error(
        `no legal intent to play "${key}" — is it actually playable in this setup?\n` +
          `last log: ${formatLog(this.state.log.slice(-5))}`,
      );
    }
    this.do(intent);
    return opts.settle === false ? this : this.settle();
  }

  /** Activate a weapon/equipment/hero ability (incl. weapon attacks and
   *  "while defending" abilities — there the pitch is the discard).
   *  `ability` selects one of several activated abilities on the same card;
   *  `targetAlly` aims an attack ability at an opposing ally. */
  activate(
    key: string,
    opts: { pitch?: string[]; settle?: boolean; ability?: number; targetAlly?: string } = {},
  ): this {
    const id = printingId(key);
    const seat = this.actor();
    const legal = legalIntents(this.state, seat).filter(
      (i): i is Extract<GameIntent, { kind: "activate-ability" }> =>
        i.kind === "activate-ability" && this.cardIdOf(i.sourceInstanceId) === id,
    );
    const matching = legal.filter(
      (i) =>
        (opts.ability === undefined || (i.abilityIndex ?? 0) === opts.ability) &&
        (opts.targetAlly === undefined
          ? i.targetAllyId === undefined // default: aim at the hero
          : i.targetAllyId === this.targetAllyIdOf(seat, opts.targetAlly)) &&
        this.pitchMatches(i.pitchInstanceIds, opts.pitch, seat),
    );
    const intent = opts.pitch ? matching[0] : this.pickIntent(matching);
    if (!intent) {
      throw new Error(`no legal intent to activate "${key}" — is it activatable in this setup?`);
    }
    this.do(intent);
    return opts.settle === false ? this : this.settle();
  }

  /** Attack with one of the active player's weapons. `targetAlly` aims the
   *  attack at an opposing ally instead of the hero. */
  attackWithWeapon(
    key?: string,
    opts: { pitch?: string[]; settle?: boolean; targetAlly?: string } = {},
  ): this {
    const seat = this.state.activePlayer;
    const weapons = new Set(this.state.players[seat]!.weapons.map((w) => w.instanceId));
    const legal = legalIntents(this.state, seat).filter(
      (i): i is Extract<GameIntent, { kind: "activate-ability" }> =>
        i.kind === "activate-ability" &&
        weapons.has(i.sourceInstanceId) &&
        (!key || this.cardIdOf(i.sourceInstanceId) === printingId(key)),
    );
    const matching = legal.filter(
      (i) =>
        (opts.targetAlly === undefined
          ? i.targetAllyId === undefined // default: aim at the hero
          : i.targetAllyId === this.targetAllyIdOf(seat, opts.targetAlly)) &&
        this.pitchMatches(i.pitchInstanceIds, opts.pitch, seat),
    );
    const intent = opts.pitch ? matching[0] : this.pickIntent(matching);
    if (!intent) {
      throw new Error(`no legal weapon attack${key ? ` with "${key}"` : ""} in this setup`);
    }
    this.do(intent);
    return opts.settle === false ? this : this.settle();
  }

  /** Declare defenders for the open defend decision (hand cards and/or
   *  equipment, by key). No keys = take the attack. */
  blockWith(...keys: string[]): this {
    const pd = this.state.pendingDecision;
    if (pd?.kind !== "defend") throw new Error("blockWith() but no defend decision is open");
    const p = this.state.players[pd.player]!;
    const used = new Set<number>();
    const ids = keys.map((key) => {
      const wanted = functionalKeyOf(cardData[printingId(key)]!);
      const matches = (card: CardInstance | undefined): card is CardInstance =>
        card !== undefined &&
        functionalKeyOf(cardData[card.cardId]!) === wanted &&
        !used.has(card.instanceId);
      const c =
        p.hand.find(matches) ??
        p.arsenal.find(matches) ??
        Object.values(p.equipment).find(matches) ??
        p.weapons.find(matches) ??
        (matches(p.hero) ? p.hero : undefined);
      if (!c) throw new Error(`no "${key}" in hand or equipment to defend with`);
      used.add(c.instanceId);
      return c.instanceId;
    });
    const staged = applyIntent(this.state, pd.player, {
      kind: "stage-defenders",
      instanceIds: ids,
    });
    if (!staged.ok) {
      throw new Error(
        `no legal defend intent for [${keys.join(", ")}] — ${staged.error}`,
      );
    }
    this.state = staged.state;
    const legal = legalIntents(this.state, pd.player).filter(
      (i): i is Extract<GameIntent, { kind: "defend" }> => i.kind === "defend",
    );
    const want = [...ids].sort((a, b) => a - b);
    const intent = legal.find((i) => {
      const got = [...i.instanceIds].sort((a, b) => a - b);
      return got.length === want.length && got.every((v, idx) => v === want[idx]);
    });
    if (!intent) {
      throw new Error(
        `no legal defend intent for [${keys.join(", ")}] — can those cards actually defend here?`,
      );
    }
    this.do(intent);
    return this;
  }

  /** Play a reaction/instant for the current priority holder. */
  react(
    key: string,
    opts: {
      pitch?: string[];
      settle?: boolean;
      meldSide?: MeldSide;
      alternativeCost?: string | string[];
      targetCard?: string;
    } = {},
  ): this {
    const seat = this.actor();
    const id = printingId(key);
    const alternativeCostInstanceIds = opts.alternativeCost === undefined
      ? undefined
      : this.alternativeCostInstances(
          seat,
          Array.isArray(opts.alternativeCost) ? opts.alternativeCost : [opts.alternativeCost],
        );
    const legal = legalIntents(this.state, seat).filter(
      (i): i is Extract<GameIntent, { kind: "play-card" | "play-from-arsenal" | "play-from-zone" }> =>
        (i.kind === "play-card" || i.kind === "play-from-arsenal" || i.kind === "play-from-zone") &&
        this.cardIdOf(i.instanceId) === id,
    );
    const matching = legal.filter((i) =>
      (opts.meldSide === undefined || i.meldSide === opts.meldSide)
      && (opts.targetCard === undefined ||
        i.targetCardInstanceId === this.targetCardInstanceIdOf(opts.targetCard))
      && (alternativeCostInstanceIds === undefined
        || this.sameInstanceIds(i.alternativeCostCardInstanceIds, alternativeCostInstanceIds))
      && this.pitchMatches(i.pitchInstanceIds, opts.pitch, seat));
    const costMatching =
      alternativeCostInstanceIds === undefined &&
      matching.some((i) => i.alternativeCostCardInstanceIds === undefined)
        ? matching.filter((i) => i.alternativeCostCardInstanceIds === undefined)
        : matching;
    const intent = opts.pitch ? costMatching[0] : this.pickIntent(costMatching);
    if (!intent) {
      throw new Error(`no legal intent to play "${key}" in this window — is it playable now?`);
    }
    this.do(intent);
    return opts.settle === false ? this : this.settle();
  }

  /** Answer the open scripted choice (option id contains `fragment`). */
  chooseOption(fragment: string): this {
    const pd = this.state.pendingDecision;
    const option = pd?.options?.find((o) => o.toLowerCase().includes(fragment.toLowerCase()));
    if (!pd || !option) {
      throw new Error(`no open choice matching "${fragment}" (pending: ${pd?.kind ?? "none"})`);
    }
    this.do({ kind: "choose", optionId: option });
    return this.settle();
  }

  /** Submit a registered card name for an open free-form name choice. */
  chooseName(name: string): this {
    const pd = this.state.pendingDecision;
    if (pd?.kind !== "choose-name") {
      throw new Error(`no open name choice (pending: ${pd?.kind ?? "none"})`);
    }
    this.do({ kind: "choose", optionId: name });
    return this.settle();
  }

  /** Answer the open scripted choice with the instance id of the deciding
   *  player's card matching `key` (functional key or printing id; searches
   *  hand, graveyard, deck, arsenal, pitch, banish, inventory, board, weapons,
   *  equipment, hero, and the combat chain). */
  chooseCard(key: string): this {
    const pd = this.state.pendingDecision;
    if (!pd?.options) {
      throw new Error(`no open choice (pending: ${pd?.kind ?? "none"})`);
    }
    const exactId = cardData[key] ? key : undefined;
    const wanted = functionalKeyOf(cardData[printingId(key)]!);
    const matches = (card: CardInstance) => exactId
      ? card.cardId === exactId
      : functionalKeyOf(cardData[card.cardId]!) === wanted;
    for (const p of this.state.players) {
      const zones = [
        p.hand,
        p.graveyard,
        p.deck,
        p.arsenal,
        p.pitch,
        p.banish,
        p.soul,
        p.inventory ?? [],
        p.board,
        p.weapons,
        Object.values(p.equipment).filter((c): c is CardInstance => !!c),
        [p.hero],
      ];
      for (const z of zones) {
        const c = z.find((x) => matches(x) && pd.options!.includes(String(x.instanceId)));
        if (c) {
          this.do({ kind: "choose", optionId: String(c.instanceId) });
          return this.settle();
        }
      }
    }
    for (const link of this.state.chain) {
      const onChain = [link.attackingCard, ...link.defendingCards, ...link.defendingEquipment, ...link.reactions];
      const c = onChain.find((x) => matches(x) && pd.options!.includes(String(x.instanceId)));
      if (c) {
        this.do({ kind: "choose", optionId: String(c.instanceId) });
        return this.settle();
      }
    }
    throw new Error(`no choice option for "${key}" (options: ${pd.options.join(", ")})`);
  }

  /** Single pass for the current actor (fine-grained window control). */
  passPriority(): this {
    this.do({ kind: "pass" });
    return this;
  }

  /** Pass the action phase and fast-forward to the next clean decision
   *  (may be a start-of-turn trigger choice, e.g. a mentor flip). */
  endTurn(): this {
    this.settle();
    const turn = this.state.turn;
    this.do({ kind: "pass" });
    this.settle();
    expect(this.state.turn, "endTurn() did not advance the turn").toBe(turn + 1);
    return this;
  }

  // ── assertions ───────────────────────────────────────────────────────────

  private zone(seat: number, zone: ZoneName): CardInstance[] {
    return this.state.players[seat]![zone];
  }

  expectLife(seat: number, n: number): this {
    expect(this.state.players[seat]!.life).toBe(n);
    return this;
  }

  expectAP(seat: number, n: number): this {
    expect(this.state.players[seat]!.actionPoints).toBe(n);
    return this;
  }

  expectResources(seat: number, n: number): this {
    expect(this.state.players[seat]!.resources).toBe(n);
    return this;
  }

  expectHandSize(seat: number, n: number): this {
    expect(this.state.players[seat]!.hand).toHaveLength(n);
    return this;
  }

  expectZoneSize(seat: number, zone: ZoneName, n: number): this {
    expect(this.zone(seat, zone)).toHaveLength(n);
    return this;
  }

  /** Face-down banished cards waiting to return to hand (intimidated or
   *  scheduled) — they sit in the banished zone with a return marker. */
  expectPendingReturn(seat: number, n: number): this {
    const pending = this.state.players[seat]!.banish.filter(
      (card) => card.intimidated === true || card.returnToHandAtTurn !== undefined,
    );
    expect(
      pending,
      `expected ${n} pending-return card(s) in seat ${seat}'s banished zone`,
    ).toHaveLength(n);
    return this;
  }

  expectInZone(seat: number, key: string, zone: ZoneName): this {
    // reprint-safe: compare functional identity, not printing id
    const target = functionalKeyOf(cardData[printingId(key)]!);
    expect(
      this.zone(seat, zone).some((c) => functionalKeyOf(cardData[c.cardId]!) === target),
      `expected "${key}" in seat ${seat}'s ${zone}`,
    ).toBe(true);
    return this;
  }

  expectNotInZone(seat: number, key: string, zone: ZoneName): this {
    const target = functionalKeyOf(cardData[printingId(key)]!);
    expect(
      this.zone(seat, zone).some((c) => functionalKeyOf(cardData[c.cardId]!) === target),
      `expected "${key}" NOT in seat ${seat}'s ${zone}`,
    ).toBe(false);
    return this;
  }

  expectDeckTop(seat: number, key: string): this {
    expect(this.state.players[seat]!.deck[0]?.cardId).toBe(printingId(key));
    return this;
  }

  expectDeckBottom(seat: number, key: string): this {
    const deck = this.state.players[seat]!.deck;
    expect(deck[deck.length - 1]?.cardId).toBe(printingId(key));
    return this;
  }

  expectFaceDown(seat: number, key: string, faceDown: boolean): this {
    const id = printingId(key);
    const c = this.state.players[seat]!.arsenal.find((x) => x.cardId === id);
    expect(c, `no "${key}" in seat ${seat}'s arsenal`).toBeTruthy();
    expect(!!c!.faceDown).toBe(faceDown);
    return this;
  }

  expectEquipped(seat: number, slot: EquipmentSlot, key: string): this {
    const equipped = this.state.players[seat]!.equipment[slot];
    const wanted = functionalKeyOf(cardData[printingId(key)]!);
    expect(equipped && functionalKeyOf(cardData[equipped.cardId]!)).toBe(wanted);
    return this;
  }

  expectNoEquipment(seat: number, slot: EquipmentSlot): this {
    expect(this.state.players[seat]!.equipment[slot]).toBeUndefined();
    return this;
  }

  /** Effective (counter-adjusted) defense of equipped gear, as projected. */
  expectEquipmentDefense(seat: number, slot: EquipmentSlot, n: number): this {
    const view = projectStateFor(this.state, seat);
    expect(view.players[seat]!.equipment[slot]?.defense).toBe(n);
    return this;
  }

  /** Attack value of the open (unresolved) chain link, as projected. */
  expectAttackValue(n: number): this {
    const view = projectStateFor(this.state, this.state.activePlayer);
    const link = [...view.chain].reverse().find((l) => !l.resolved);
    expect(link, "no open chain link").toBeTruthy();
    expect(link!.attackValue).toBe(n);
    return this;
  }

  /** Prevention already established for the open attack, as projected beside
   *  total defense in the combat-chain window. */
  expectDamageToPrevent(n: number, sourceKeys: string[] = []): this {
    const view = projectStateFor(this.state, this.state.activePlayer);
    const link = [...view.chain].reverse().find((candidate) => !candidate.resolved);
    expect(link, "no open chain link").toBeTruthy();
    expect(link!.damageToPrevent).toBe(n);
    if (sourceKeys.length > 0) {
      expect(link!.preventionModifiers?.map((modifier) => modifier.sourceCardId)).toEqual(
        expect.arrayContaining(sourceKeys.map(printingId)),
      );
    }
    return this;
  }

  /** Snapshotted attack of the most recently resolved link (reaction buffs
   *  included — chain-link modifiers expire at resolution). */
  expectFinalAttack(n: number): this {
    const link = [...this.state.chain].reverse().find((l) => l.resolved);
    expect(link, "no resolved chain link").toBeTruthy();
    expect(link!.finalAttack).toBe(n);
    return this;
  }

  expectFinalDefense(n: number): this {
    const link = [...this.state.chain].reverse().find((l) => l.resolved);
    expect(link, "no resolved chain link").toBeTruthy();
    expect(link!.finalDefense).toBe(n);
    return this;
  }

  expectLog(fragment: string): this {
    expect(
      this.state.log.some((l) => l.publicText && visibleLogText(l.publicText).includes(fragment)),
      `no log line containing "${fragment}"\nlast log: ${formatLog(this.state.log.slice(-8))}`,
    ).toBe(true);
    return this;
  }

  expectNoLog(fragment: string): this {
    expect(
      this.state.log.some((l) => l.publicText && visibleLogText(l.publicText).includes(fragment)),
      `unexpected log line containing "${fragment}"`,
    ).toBe(false);
    return this;
  }

  expectTurn(n: number): this {
    expect(this.state.turn).toBe(n);
    return this;
  }

  expectWinner(seat: number): this {
    expect(this.state.winner).toBe(seat);
    return this;
  }

  /** Assert the active player currently has NO legal play intent for `key`. */
  expectNoLegalPlay(key: string): this {
    const id = printingId(key);
    const seat = this.state.activePlayer;
    const hits = legalIntents(this.state, seat).filter(
      (i) => i.kind === "play-card" && this.cardIdOf(i.instanceId) === id,
    );
    expect(hits, `expected no legal play for "${key}"`).toEqual([]);
    return this;
  }
}

export function scenario(opts: ScenarioOpts): Scenario {
  return new Scenario(opts);
}
