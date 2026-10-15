/** Game events that can queue triggered abilities onto the stack. */
export type TriggerEvent =
  | "start-of-turn"
  | "begin-action-phase"
  | "end-of-turn"
  | "card-entered-arena"
  | "card-played"
  | "card-pitched"
  | "card-drawn"
  | "card-left-arena"
  | "card-discarded"
  | "card-banished"
  | "card-banished-for-boost"
  | "card-boosted"
  | "card-put-into-graveyard"
  | "card-moved-from-deck-by-effect"
  | "token-created"
  | "weapon-attack-activated"
  | "attack-declared"
  | "attack-defended"
  | "attack-reaction"
  | "wager-generated"
  | "wager-won"
  | "trap-triggered"
  | "hero-damage-dealt";

/** Event-specific facts captured when a triggered ability is generated. */
export interface TriggerEventContext {
  readonly from?: string;
  readonly causedBySeat?: number;
  /** The kind of resolving effect responsible for a zone movement. */
  readonly effectSource?: "action-card" | "activated-ability" | "other";
  readonly atRandom?: boolean;
  readonly tokenCount?: number;
  /** Last controller of a permanent leaving the arena. */
  readonly controllerSeat?: number;
  /** True when the arena departure was a destruction event. */
  readonly destroyed?: boolean;
  readonly to?: "arsenal" | "banish" | "soul" | "hand" | "arena" | "graveyard" | "pitch" | "deck" | "subcard" | "cease-to-exist";
  /** A hero was dealt positive damage after prevention. */
  readonly damage?: HeroDamageEventContext;
}

/** Facts of a "hero-damage-dealt" event. The event's subject is the source's
 * controller and its event card is the source. */
export interface HeroDamageEventContext {
  readonly targetSeat: number;
  readonly amount: number;
  readonly arcane: boolean;
  readonly combat: boolean;
  /** The controller (their hero) counts as dealing this damage. Ally sources
   * deal damage themselves (CR 8.2.8e, 8.5.3a). */
  readonly byController: boolean;
  /** 1-based ordinal of this event among the damage the controller has dealt
   * to opposing heroes this turn, counting events before a trigger's source
   * existed (CR 6.6.5d). Absent unless `byController` and the target opposes. */
  readonly opposingHeroOrdinal?: number;
}

/** Why a token batch is being created. */
export interface TokenCreationContext {
  readonly kind: "effect" | "wager";
  readonly sourceCardId?: string;
}
