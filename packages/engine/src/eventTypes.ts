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
  | "damage-dealt";

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
  /** Last-known combat status of a card that left the arena by leaving the
   * combat chain while attacking or defending (CR 3.1.1, 7.0.5a). */
  readonly combatRole?: "attacking" | "defending";
  readonly to?: "arsenal" | "banish" | "soul" | "hand" | "arena" | "graveyard" | "pitch" | "deck" | "subcard" | "cease-to-exist";
  /** A hero or ally was dealt positive damage after prevention. */
  readonly damage?: DamageEventContext;
}

/** Facts of a "damage-dealt" event. The event's subject is the source's
 * controller and its event card is the source. Ordinals are 1-based, count
 * events of the whole turn including those before a trigger's source existed
 * (CR 6.6.5d), and only count damage the controller deals (`byController`). */
export interface DamageEventContext {
  readonly sourceSeat: number;
  /** The damaged hero, or the controller of the damaged ally. */
  readonly targetSeat: number;
  /** Present when an ally rather than a hero was dealt the damage. */
  readonly targetAllyInstanceId?: number;
  readonly amount: number;
  readonly arcane: boolean;
  readonly combat: boolean;
  /** The controller (their hero) counts as dealing this damage. Ally sources
   * deal damage themselves (CR 8.2.8e, 8.5.3a). */
  readonly byController: boolean;
  /** Among the damage the controller dealt to opposing heroes this turn. */
  readonly opposingHeroOrdinal?: number;
  /** Among the arcane damage the controller dealt to any target this turn. */
  readonly arcaneOrdinal?: number;
  /** Among the damage opposing heroes dealt to the target hero this turn. */
  readonly fromOpposingHeroOrdinal?: number;
}

/** Why a token batch is being created. */
export interface TokenCreationContext {
  readonly kind: "effect" | "wager";
  readonly sourceCardId?: string;
}
