/** Game events that can queue triggered abilities onto the stack. */
export type TriggerEvent =
  | "start-of-turn"
  | "begin-action-phase"
  | "end-of-turn"
  | "card-entered-arena"
  | "card-played"
  | "card-pitched"
  | "card-left-arena"
  | "card-discarded"
  | "card-banished-for-boost"
  | "card-put-into-graveyard"
  | "card-moved-from-deck-by-effect"
  | "token-created"
  | "weapon-attack-activated"
  | "attack-declared"
  | "attack-defended"
  | "attack-reaction"
  | "wager-generated"
  | "wager-won"
  | "trap-triggered";

/** Event-specific facts captured when a triggered ability is generated. */
export interface TriggerEventContext {
  readonly from?: string;
  readonly causedBySeat?: number;
  readonly atRandom?: boolean;
  readonly tokenCount?: number;
  readonly to?: "arsenal" | "banish" | "soul" | "hand" | "arena" | "graveyard" | "pitch";
}

/** Why a token batch is being created. */
export interface TokenCreationContext {
  readonly kind: "effect" | "wager";
  readonly sourceCardId?: string;
}
