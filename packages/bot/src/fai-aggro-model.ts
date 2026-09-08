import type { CardView, GameIntent, GameView, OnHitEffectView } from "@fyendal/shared";
import { functionalKey, type BotPolicyInput } from "./policy.js";

export type FaiAggroStage = "first-turn0-attack" | "first-turn1-defense" | "first-turn1-attack" | "turn0-defense" | "turn1-attack" |
  "turn2-defense" | "turn2-attack" | "later-defense" | "later-attack";

/** Hand waves, not seats. Prefer the recorded first turn to parity (extra turns). */
export function faiAggroStage(view: GameView, seat: 0 | 1): FaiAggroStage {
  const turns = view.gameStats?.turns ?? [];
  const first = turns.find((turn) => turn.turn === 1)?.activePlayer ??
    (view.turn % 2 === 1 ? view.activePlayer : 1 - view.activePlayer);
  if (first === seat) {
    if (view.turn === 1) return "first-turn0-attack";
    const ownTurns = turns.filter((turn) => turn.activePlayer === seat).length || Math.ceil(view.turn / 2);
    if (view.activePlayer === seat) return ownTurns === 2 ? "first-turn1-attack" : "later-attack";
    return ownTurns === 1 ? "first-turn1-defense" : "later-defense";
  }
  if (view.turn === 1) return "turn0-defense";
  const ownTurns = turns.filter((turn) => turn.activePlayer === seat).length;
  const wave = ownTurns || Math.floor(view.turn / 2);
  if (view.activePlayer === seat) return wave === 1 ? "turn1-attack" :
    wave === 2 ? "turn2-attack" : "later-attack";
  return wave === 1 ? "turn2-defense" : "later-defense";
}

export function draconic(card: CardView, input: BotPolicyInput): boolean {
  return [...(input.cards[card.cardId]?.subtypes ?? []), ...(card.grantedTypes ?? [])]
    .some((type) => type.toLowerCase() === "draconic");
}

export function ownDraconicLinks(input: BotPolicyInput): number {
  return input.view.chain.filter((link) =>
    link.attackingCard.owner === input.seat && draconic(link.attackingCard, input)).length;
}

export function nameOf(card: CardView, input: BotPolicyInput): string {
  return input.cards[card.cardId]?.name.toLowerCase() ?? "";
}

export type FaiCardRole = "starter" | "extender" | "ender";
const STARTERS = new Set(["ronin renegade", "brand with cinderclaw", "fire tenet: strike first",
  "growl", "ravenous rabble", "rising resentment"]);
const ENDERS = new Set(["salt the wound", "lava burst", "compounding anger", "snatch"]);

/** Role preferences, never damage values. Engine rollout determines conversion. */
export function faiRole(card: CardView, input: BotPolicyInput): FaiCardRole {
  const name = nameOf(card, input);
  if (ENDERS.has(name)) return "ender";
  if (STARTERS.has(name)) return "starter";
  if (name === "scar for a scar") return input.view.players[input.seat].life <
    input.view.players[1 - input.seat]!.life ? "starter" : "ender";
  return "extender";
}

export function faiOnHit(effects: readonly OnHitEffectView[]): { value: number; immediateDamage: number } {
  const immediateDamage = effects.reduce((sum, effect) => sum + (effect.impact?.damage ?? 0), 0);
  return { immediateDamage, value: immediateDamage + effects.reduce((sum, effect) =>
    sum + (effect.impact?.delayedDamage ?? 0) + 3 * (effect.impact?.drawCards ?? 0), 0) };
}

export function nextWavePressure(view: GameView, seat: 0 | 1): number {
  const opponent = view.players[1 - seat]!;
  return 4 * (opponent.handCount + opponent.arsenalCount);
}

export function compareTuple(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

export const FAI_AGGRO_MEMORY_SCHEMA_VERSION = 1;

export interface FaiAggroLastObservationV1 {
  turn: number;
  hoodPrompt: boolean;
  handIds: number[];
  hoodChoiceId?: number;
  playedCandidate?: {
    instanceId: number;
    role: FaiCardRole;
  };
}

export interface FaiAggroMemoryStateV1 {
  schemaVersion: typeof FAI_AGGRO_MEMORY_SCHEMA_VERSION;
  turn: number;
  startedWithArsenal: boolean;
  turn1: boolean;
  initialCardCount: number;
  originalStarters: number;
  originalEnders: number;
  realIds: number[];
  playedIds: number[];
  playedStarterIds: number[];
  playedEnderIds: number[];
  hoodSwap: number[];
  reservedId?: number;
  lastObservation?: FaiAggroLastObservationV1;
}

export function initialFaiAggroMemoryState(): FaiAggroMemoryStateV1 {
  return {
    schemaVersion: FAI_AGGRO_MEMORY_SCHEMA_VERSION,
    turn: -1,
    startedWithArsenal: false,
    turn1: false,
    initialCardCount: 0,
    originalStarters: 0,
    originalEnders: 0,
    realIds: [],
    playedIds: [],
    playedStarterIds: [],
    playedEnderIds: [],
    hoodSwap: [],
  };
}

/** Per-match, per-seat observer; no global cache and no hidden state. */
export class FaiAggroMemory {
  turn: number;
  startedWithArsenal: boolean;
  turn1: boolean;
  initialCardCount: number;
  originalStarters: number;
  originalEnders: number;
  realIds: Set<number>;
  playedIds: Set<number>;
  playedStarterIds: Set<number>;
  playedEnderIds: Set<number>;
  hoodSwap: number[];
  reservedId: number | undefined;
  private lastObservation: FaiAggroLastObservationV1 | undefined;

  constructor(state: FaiAggroMemoryStateV1 = initialFaiAggroMemoryState()) {
    this.turn = state.turn;
    this.startedWithArsenal = state.startedWithArsenal;
    this.turn1 = state.turn1;
    this.initialCardCount = state.initialCardCount;
    this.originalStarters = state.originalStarters;
    this.originalEnders = state.originalEnders;
    this.realIds = new Set(state.realIds);
    this.playedIds = new Set(state.playedIds);
    this.playedStarterIds = new Set(state.playedStarterIds);
    this.playedEnderIds = new Set(state.playedEnderIds);
    this.hoodSwap = [...state.hoodSwap];
    this.reservedId = state.reservedId;
    this.lastObservation = state.lastObservation ? {
      ...state.lastObservation,
      handIds: [...state.lastObservation.handIds],
      ...(state.lastObservation.playedCandidate
        ? { playedCandidate: { ...state.lastObservation.playedCandidate } }
        : {}),
    } : undefined;
  }

  get target(): number { return this.turn1 ? Math.min(3, this.initialCardCount) : this.initialCardCount; }

  /** After Hood, count the actual remaining cards, not returned copies or a
   * stale play-four/store-one threshold. Turn1 alone retains its reserve plan. */
  conversionTarget(input: BotPolicyInput): number {
    const me = input.view.players[input.seat];
    const available = this.playedIds.size + [...me.hand, ...me.arsenal]
      .filter((card) => this.realIds.has(card.instanceId) && !this.playedIds.has(card.instanceId)).length;
    return this.turn1 ? Math.min(this.target, available) : available;
  }

  refreshRoles(input: BotPolicyInput): void {
    const cards = [...input.view.players[input.seat].hand, ...input.view.players[input.seat].arsenal];
    this.originalStarters = cards.filter((card) => faiRole(card, input) === "starter").length + this.playedStarterIds.size;
    this.originalEnders = cards.filter((card) => faiRole(card, input) === "ender").length + this.playedEnderIds.size;
  }

  observe(input: BotPolicyInput): void {
    if (input.view.activePlayer !== input.seat) return;
    const me = input.view.players[input.seat];
    if (this.turn !== input.view.turn) {
      this.turn = input.view.turn;
      this.startedWithArsenal = me.arsenalCount > 0;
      // Preparation means second-player Turn1 OR first-player Turn0. The
      // first player's Turn1 is a burst, not a play-three/reserve turn.
      const stage = faiAggroStage(input.view, input.seat);
      this.turn1 = stage === "turn1-attack" || stage === "first-turn0-attack";
      const offensive = [...me.hand, ...me.arsenal];
      this.initialCardCount = offensive.length;
      this.realIds = new Set(offensive.map((card) => card.instanceId));
      this.playedIds.clear();
      this.playedStarterIds.clear();
      this.playedEnderIds.clear();
      this.hoodSwap = [];
      this.reservedId = undefined;
      this.refreshRoles(input);
      this.lastObservation = undefined;
    }
    // New genuine cards drawn by Hood qualify; a recovered Flame and generated
    // Tiger do not acquire a real-card credit merely by entering the hand.
    const afterHood = this.lastObservation?.hoodPrompt ?? false;
    const previousHand = new Set(this.lastObservation?.handIds ?? []);
    for (const card of me.hand) {
      const redrawn = afterHood && (!previousHand.has(card.instanceId) ||
        this.lastObservation?.hoodChoiceId === card.instanceId);
      if (nameOf(card, input) !== "crouching tiger" && (redrawn || nameOf(card, input) !== "phoenix flame")) {
        this.realIds.add(card.instanceId);
      }
    }
    const played = this.lastObservation?.playedCandidate;
    if (played && this.lastObservation?.turn === input.view.turn &&
      this.realIds.has(played.instanceId) &&
      ![...me.hand, ...me.arsenal, ...me.banish].some((card) => card.instanceId === played.instanceId)) {
      this.playedIds.add(played.instanceId);
      if (played.role === "starter") this.playedStarterIds.add(played.instanceId);
      if (played.role === "ender") this.playedEnderIds.add(played.instanceId);
    }
    if (afterHood) this.refreshRoles(input);
  }

  record(input: BotPolicyInput, intent: GameIntent): void {
    const me = input.view.players[input.seat];
    const playedCard = (
      intent.kind === "play-card" ||
      intent.kind === "play-from-arsenal" ||
      intent.kind === "play-from-zone"
    ) ? [...me.hand, ...me.arsenal, ...me.banish]
      .find((card) => card.instanceId === intent.instanceId) : undefined;
    const hoodChoiceId = intent.kind === "choose" && /^\d+$/.test(intent.optionId)
      ? Number(intent.optionId)
      : undefined;
    this.lastObservation = {
      turn: input.view.turn,
      hoodPrompt: /Hope Merchant's Hood/i.test(input.view.pendingDecision?.prompt ?? ""),
      handIds: me.hand.map((card) => card.instanceId),
      ...(hoodChoiceId === undefined ? {} : { hoodChoiceId }),
      ...(playedCard ? {
        playedCandidate: {
          instanceId: playedCard.instanceId,
          role: faiRole(playedCard, input),
        },
      } : {}),
    };
  }

  snapshot(): FaiAggroMemoryStateV1 {
    const sorted = (ids: ReadonlySet<number>): number[] =>
      [...ids].sort((left, right) => left - right);
    return {
      schemaVersion: FAI_AGGRO_MEMORY_SCHEMA_VERSION,
      turn: this.turn,
      startedWithArsenal: this.startedWithArsenal,
      turn1: this.turn1,
      initialCardCount: this.initialCardCount,
      originalStarters: this.originalStarters,
      originalEnders: this.originalEnders,
      realIds: sorted(this.realIds),
      playedIds: sorted(this.playedIds),
      playedStarterIds: sorted(this.playedStarterIds),
      playedEnderIds: sorted(this.playedEnderIds),
      hoodSwap: [...this.hoodSwap],
      ...(this.reservedId === undefined ? {} : { reservedId: this.reservedId }),
      ...(this.lastObservation ? {
        lastObservation: {
          ...this.lastObservation,
          handIds: [...this.lastObservation.handIds],
          ...(this.lastObservation.playedCandidate
            ? { playedCandidate: { ...this.lastObservation.playedCandidate } }
            : {}),
        },
      } : {}),
    };
  }
}

export function zeroPitchAggroIntent(intent: GameIntent, input: BotPolicyInput): boolean {
  if ("pitchInstanceIds" in intent && intent.pitchInstanceIds?.length) return false;
  if ("pitchRequired" in intent && (intent.pitchRequired ?? 0) > 0) return false;
  const card = intent.kind === "activate-ability"
    ? [...Object.values(input.view.players[input.seat].equipment), ...input.view.players[input.seat].weapons]
      .find((candidate) => candidate?.instanceId === intent.sourceInstanceId)
    : "instanceId" in intent
      ? [...input.view.players[input.seat].hand, ...input.view.players[input.seat].arsenal,
        ...input.view.players[input.seat].banish].find((candidate) => candidate.instanceId === intent.instanceId)
      : undefined;
  const needsThree = (intent.kind === "activate-ability" &&
    intent.sourceInstanceId === input.view.players[input.seat].heroInstanceId) ||
    (card && functionalKey(input.cards[card.cardId]) === "compounding anger|1");
  return !needsThree || ownDraconicLinks(input) >= 3;
}
