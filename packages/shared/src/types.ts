// ── Card static data ────────────────────────────────────────────────────────

/** Heroes the platform supports for the preconstructed Classic Battles format. */
export type HeroId = "dorinthea" | "rhinar";

/** Play formats. classic-battles uses fixed box decks; cc and silver-age use
 *  either a saved user deck or a shared format-legal preconstructed deck. */
export type Format = "classic-battles" | "cc" | "silver-age";

/** Stable identities for the supported practice opponents. */
export type BotOpponent = "bravo" | "briar" | "cindra" | "ira" | "hala" | "jarl";

/** Numeric resources produced when pitched. Most cards use their red/yellow/
 * blue color value (1/2/3); colorless resource gems may pitch for 4. */
export type Pitch = 1 | 2 | 3 | 4;

export type CardColor = 1 | 2 | 3;

export type CardType =
  | "hero"
  | "weapon"
  | "equipment"
  | "action" // non-attack action or attack action, see subtypes
  | "attack-reaction"
  | "defense-reaction"
  | "instant"
  | "block" // block cards (e.g. Turning Point); cannot be played
  | "resource" // pitch-only cards (e.g. Titanium Bauble); cannot be played
  | "token" // created in play (e.g. Quicken); never in deck
  | "mentor"; // ordinary deck card (e.g. Chief Ruk'utan); cannot be played

/** Pure static card data — no behavior. Behavior lives in @fyendal/engine CardScript. */
export interface CardData {
  /** Stable id, e.g. "WTR004". */
  id: string;
  name: string;
  pitch?: Pitch;
  cost?: number;
  cardType: CardType;
  /** e.g. ["attack"], ["sword","1h"], ["head"], ["club","2h"] */
  subtypes?: string[];
  /** e.g. ["warrior"], ["brute"], ["generic"] */
  classes?: string[];
  attack?: number;
  defense?: number;
  /** Raw keyword names present on the card, e.g. ["Go again"]. Informational; behavior is scripted. */
  keywords?: string[];
  /** Rules text as printed. */
  text: string;
  /** Double-faced cards (Transcend): the back face's card id (e.g. "FAB232"
   *  Inner Chi). A flipped instance uses the back face's data while in hand. */
  backId?: string;
  /** Hero stats */
  intellect?: number;
  life?: number;
  /** Set/rarity info, informational */
  set?: string;
}

export interface Decklist {
  heroId: string;
  weaponIds: string[];
  /** slot -> cardId */
  equipment: Partial<Record<EquipmentSlot, string>>;
  /** Main-deck card ids, duplicates repeated (40 for classic-battles, 60+ for cc);
   *  the mentor is an ordinary deck card */
  deck: string[];
  /** Parsed but not used in-game yet */
  sideboard?: string[];
  /** Cards brought to the game but not in starting zones. Effects may equip
   * or otherwise select these cards without exposing the private list. */
  inventory?: string[];
}

export type EquipmentSlot = "head" | "chest" | "arms" | "legs";

/**
 * A saved user deck as registered (cc: up to 80 cards, silver-age: 55) — the
 * pool a player sideboards from before each game. Not what the engine consumes:
 * at game start each seat presents a `Decklist` derived from this pool.
 */
export interface DeckPool {
  heroId: string;
  /** All registered weapons (presentation picks up to 2) */
  weaponIds: string[];
  /** All registered equipment, any slot mix (presentation picks ≤1 per slot) */
  equipmentPool: string[];
  /** Cards that must begin in inventory and cannot be presented in another
   * starting zone (for example Levia's demi-hero card). */
  inventoryPool?: string[];
  /** Main-deck-eligible pool; presentation draws the ≥60/40 main deck from deck+sideboard */
  deck: string[];
  sideboard?: string[];
}

/** The cards a player brings into one game, chosen from their `DeckPool`. */
export interface PresentedDeck {
  /** ⊆ pool weaponIds, max 2 */
  weaponIds: string[];
  /** slot -> cardId, each ⊆ pool equipmentPool and legal for that slot
   *  (matching subtype, or any equipment slot for Modular equipment) */
  equipment: Partial<Record<EquipmentSlot, string>>;
  /** ⊆ pool deck+sideboard, at least the format's minimum main-deck size */
  deck: string[];
}

// ── Game view (server -> client projection) ────────────────────────────────

export type Phase = "start" | "action" | "layer" | "reaction" | "defend" | "end" | "game-over";

export type Zone =
  | "hand"
  | "deck"
  | "arsenal"
  | "pitch"
  | "graveyard"
  | "banish"
  | "chain"
  | "hero"
  | "weapon1"
  | "weapon2"
  | EquipmentSlot;

export interface CardView {
  /** Unique per game instance */
  instanceId: number;
  cardId: string;
  /** Authoritative printed name for a visible card. Lets clients present cards
   *  introduced by a compatible server even before their local catalog updates. */
  name?: string;
  owner: number;
  /** Number of times this physical card has been pitched during the game.
   *  Projected only when the card itself is visible to the viewer. */
  pitchCount?: number;
  /** Public cards underneath this top-card (transform/material). */
  subcards?: CardView[];
  /** Effective (modified) values when relevant, else printed */
  attack?: number;
  defense?: number;
  /** Face-down arsenal cards (e.g. an unflipped mentor). Only ever set on own zones. */
  faceDown?: boolean;
  /** Face-down banished card returning to hand at the upcoming end phase.
   *  Public status: both players see the marker, only the owner sees the identity. */
  intimidated?: boolean;
  /** Tapped permanent (arena zones only). */
  tapped?: boolean;
  /** -1 defense counters on the card (Battleworn/Temper) — `defense` already
   *  reflects them; this is for rendering the counter badge. */
  defCounters?: number;
  /** Named counters on the card (e.g. lesson counters on a mentor). */
  counters?: Record<string, number>;
  /** Card whose ability currently permits this card to be played from its zone.
   *  Projected only to the player entitled to use that permission. */
  playableFromSourceCardId?: string;
  /** Zero-based indexes of once-per-turn activated abilities already used this
   *  turn. Public arena status used to distinguish otherwise identical cards. */
  usedAbilityIndexes?: number[];
  /** Labels for sources with multiple activated abilities. Derived by the
   * authoritative engine so clients do not load executable card scripts. */
  activatedAbilityLabels?: string[];
  /** Additional names currently granted to this object. */
  grantedNames?: string[];
  /** Additional classes/subtypes currently granted to this object. */
  grantedTypes?: string[];
  /** Current red/yellow/blue color override (1/2/3). */
  grantedColor?: CardColor;
  /** Current life of a living permanent (allies — CR 8.2.8: dealt damage
   *  reduces it, it resets to base during the end phase, at 0 the ally dies).
   *  Base life comes from cardData. */
  life?: number;
  /** Identity is secret to this viewer (e.g. a card the opponent banished face down).
   *  cardId is blanked; render as a card back. */
  hidden?: boolean;
}

/** A triggered ability waiting on the stack (mentor flip, start/end-of-turn triggers, …) */
export interface StackLayerView {
  /** The card that triggered; null if it left play before resolution */
  card: CardView | null;
  /** Controller of the trigger */
  seat: number;
  /** Short description, e.g. "Turn face up?" */
  label: string;
  /** Controller may decline when the layer resolves */
  optional: boolean;
  /** Number of mechanically interchangeable trigger occurrences represented
   * by this authoritative stack entry. Omitted for one occurrence. */
  count?: number;
}

export interface ChainLinkView {
  attackingCard: CardView;
  defendingCards: CardView[];
  attackValue: number;
  defenseValue: number;
  /** Numeric modifiers currently contributing to the attack value. */
  attackModifiers?: CombatValueModifierView[];
  /** Numeric modifiers currently contributing to the defense value. */
  defenseModifiers?: CombatValueModifierView[];
  /** Triggered effects that will be created if this attack hits. */
  onHitEffects?: OnHitEffectView[];
  /** Total remaining combat prevention already established for the defending
   *  hero during the active attack, including mandatory Ward. */
  damageToPrevent?: number;
  /** Source-attributed contributions to `damageToPrevent`. */
  preventionModifiers?: CombatValueModifierView[];
  damage: number;
  resolved: boolean;
  /** The attack is declared but still on the stack (attack-declared priority
   *  window open): the UI shows it in the stack window and only starts the
   *  combat chain link once the attack resolves into the defend step */
  onStack?: boolean;
  hit?: boolean;
  /** Effective keywords of the attack: printed or granted by modifiers.
   *  Snapshotted at resolution (chain-link modifiers expire with the link) */
  goAgain?: boolean;
  /** This attack has wagered on its current chain link. */
  wagered?: boolean;
  /** Public reward description for each wager completed on this chain link. */
  wagerRewards?: string[];
  dominate?: boolean;
  overpower?: boolean;
  /** Resolved attack/defense reaction cards and activated-ability sources
   *  applied to this link. */
  reactions: CardView[];
  /** When the attack-target is an ally rather than the hero (CR 8.2.8d):
   *  its name, for display. */
  targetAllyName?: string;
  /** Public targeted ally state, rendered in the defender position. Omitted if
   *  the target left the game before this link was projected. */
  targetAlly?: CardView;
}

export interface OnHitEffectView {
  /** Source card id; blank only when the source is hidden from this viewer. */
  sourceCardId: string;
  /** The relevant on-hit rules text or an engine-derived effect summary. */
  text: string;
  /** Structured public tactical impact. Consumers should prefer this over
   * reparsing display text; omitted when the effect has no recognized impact. */
  impact?: OnHitImpactView;
}

export interface OnHitImpactView {
  damage?: number;
  delayedDamage?: number;
  drawCards?: number;
  discardCards?: number;
  destroysArsenal?: true;
  damagesEquipment?: true;
  createsToken?: true;
  grantsTempo?: true;
}

export interface CombatValueModifierView {
  /** Source card id; blank only when the source is hidden from this viewer. */
  sourceCardId: string;
  amount: number;
}

export interface PlayerView {
  seat: number;
  heroCardId: string;
  /** Real instance id of the hero permanent (ability activation source) */
  heroInstanceId: number;
  /** Set when the hero is tapped ({t} costs, e.g. Lyath) */
  heroTapped?: boolean;
  /** Named counters on the hero itself (e.g. Blaze's energy counters) */
  heroCounters?: Record<string, number>;
  /** Public -1 defense counters on a hero that is also equipment. */
  heroDefCounters?: number;
  /** Public cards retained underneath a transformed hero. */
  heroSubcards?: CardView[];
  heroName: string;
  life: number;
  actionPoints: number;
  resources: number;
  /** Floating chi points (pitched from chi-subtype cards; spent before resources) */
  chi?: number;
  /** Own hand during play; both hands are revealed after the game ends. */
  hand: CardView[];
  handCount: number;
  deckCount: number;
  /** Remaining deck in draw order (index 0 is next), exposed only after game end. */
  deck?: CardView[];
  arsenal: CardView[]; // own face-down arsenal visible to self; empty for opponent
  arsenalCount: number;
  pitch: CardView[]; // own pitch zone; opponent sees count only
  pitchCount: number;
  graveyard: CardView[];
  banish: CardView[];
  /** The hero's soul (Charge effects): face-up and public to both players. */
  soul: CardView[];
  /** A continuously visible top deck card, projected only to its owner. */
  visibleDeckTop?: CardView;
  /** Labels for a hero with multiple activated abilities. */
  heroAbilityLabels?: string[];
  equipment: Partial<Record<EquipmentSlot, CardView>>;
  weapons: CardView[];
  /** Board-state cards in play: tokens/auras (e.g. Quicken), items, allies */
  board: CardView[];
}

export interface PendingDecision {
  player: number;
  kind:
    | "defend" // choose defending cards for current attack
    | "attack-reaction" // attacker reaction window
    | "defense-reaction" // defender reaction window
    | "priority-window" // stack/layer window — play an instant or pass
    | "arsenal" // choose a hand card to put into arsenal at end of turn
    | "choose-target" // scripted choice, see options
    | "choose-name" // validated free-form card-name choice
    | "order-triggers" // arrange simultaneous triggered layers by resolution order
    | "optional-effect"; // yes/no scripted choice
  /** Human-readable prompt for the UI */
  prompt: string;
  /** For choose-target / optional-effect: engine-defined option ids */
  options?: string[];
  /** Option selected by the board's Space shortcut. Card scripts set this
   * explicitly when one choice is the expected/common path. */
  defaultOption?: string;
  /** Parallel display text for ordering/choice options whose ids are
   *  engine-owned and not suitable as player-facing labels. */
  optionLabels?: string[];
  /** Parallel count for consolidated trigger-order options. Null entries are
   * ordinary single-source options. */
  optionCounts?: (number | null)[];
  /** Parallel to `options`: resolved card views for live card-instance
   * options, trigger sources, or registered card definitions (such as
   * transform token choices). Null entries are plain literal options. Live
   * cards secret to the viewer are projected hidden. */
  optionCards?: (CardView | null)[];
  /** Public cards revealed for this decision. Unlike `optionCards`, this is
   *  the complete presented group; only cards whose instance ids also appear
   *  in `options` are selectable. */
  revealedCards?: CardView[];
  /** Privately looked-at cards floated alongside this decision (look-at
   *  effects). Non-interactive context images, projected only to the deciding
   *  player. */
  lookedCards?: CardView[];
  /** Defend decisions: the staged (uncommitted) defenders, visible to both
   *  players — the defender sees the real cards, everyone else sees hand
   *  cards face-down (staged equipment stays face-up) */
  stagedCards?: CardView[];
  /** Combined defense of the staged cards — projected as 0 to anyone but the
   *  defender so face-down hand cards leak nothing before the commit */
  stagedDefense?: number;
  /** A declared resource cost waiting for ordinary hand-card pitching. Only
   *  projected to the paying player. Option ids remain engine-owned; clients
   *  select cards and submit the matching option unchanged. */
  resourcePayment?: {
    cost: number;
    options: { optionId: string; pitchInstanceIds: number[] }[];
  };
  /** Card whose play is paused on a declaration or additional-cost choice
   * before it becomes a stack layer. Private to the deciding player. */
  preStackSource?: {
    card: CardView;
    zone: "hand" | "arsenal" | PlayableZone;
  };
}

/** Public, authoritative match counters recorded by the engine as events
 * happen. Each entry belongs to one engine turn; values are indexed by seat. */
export interface GameTurnStatsView {
  turn: number;
  activePlayer: number;
  attacks: [number, number];
  threatened: [number, number];
  blocked: [number, number];
  damageDealt: [number, number];
}

export interface GameStatsView {
  turns: GameTurnStatsView[];
}

/** Public facts for rules and policies that depend on events earlier in the
 * current turn. These are projected from engine flags so consumers never need
 * to reconstruct rules state from combat-chain retention or human logs. */
export interface PlayerTurnFactsView {
  attacks: number;
  weaponAttacks: number;
  playedSubtypes: string[];
  /** Public permanent instance ids whose once-per-turn triggered effects have
   * already been consumed this turn. */
  usedOncePerTurnEffectSourceIds: number[];
  dealtDamage: boolean;
  physicalDamageDealt: boolean;
  arcaneDamageDealt: boolean;
  damageTaken: boolean;
  physicalDamageTaken: boolean;
  arcaneDamageTaken: boolean;
}

export interface TurnFactsView {
  players: [PlayerTurnFactsView, PlayerTurnFactsView];
}

export interface GameView {
  gameId: string;
  turn: number;
  phase: Phase;
  /** Seat whose turn it is */
  activePlayer: number;
  /** Seat that currently holds priority / must act (also implied by pendingDecision) */
  priorityPlayer: number;
  /** The active player passed from an empty action phase and is waiting for
   * the opponent's final priority before the turn can proceed to its end phase. */
  endTurnPassPending?: true;
  players: [PlayerView, PlayerView];
  chain: ChainLinkView[];
  /** Triggered ability layers awaiting resolution (top of stack first) */
  stack: StackLayerView[];
  /** Rules context for the visible stack, e.g. Damage Step hit triggers. */
  stackContext?: string;
  /** Lingering effects (next attack / until end of turn) and the seat they affect */
  ongoing: OngoingEffectView[];
  pendingDecision: PendingDecision | null;
  /** Absent only on legacy replay files recorded before match stats existed. */
  gameStats?: GameStatsView;
  /** Absent only on legacy replay files recorded before typed turn facts. */
  turnFacts?: TurnFactsView;
  winner: number | null;
  /** Recent human-readable log lines, newest last */
  log: string[];
}

// ── Ordered presentation transitions ──────────────────────────────────────────

/** A canonical card location used by semantic transition playback. Unlike
 * client motion anchors, this contains no DOM/presentation indexes. */
export interface GameTransitionZone {
  kind:
    | "hand"
    | "deck"
    | "arsenal"
    | "pitch"
    | "graveyard"
    | "banish"
    | "soul"
    | "board"
    | "equipment"
    | "weapon"
    | "stack"
    | "chain";
  seat: number;
  /** Known position within a deck. Omitted for other zones and when an exact
   * deck depth is not presentation-relevant. */
  position?: "top" | "bottom";
}

/** One ordered, viewer-safe card movement. `instanceId` is omitted when the
 * movement is private to another player; the client renders a card back. */
export interface GameTransitionMove {
  kind: "move";
  from: GameTransitionZone | null;
  to: GameTransitionZone | null;
  count: number;
  instanceId?: number;
}

export interface GameTransitionView {
  /** The authoritative room version this edge starts at. */
  fromVersion: number;
  /** Undo/restoration edges settle immediately and contain no invented path. */
  kind: "forward" | "replace";
  events: GameTransitionMove[];
}

export interface OngoingEffectView {
  /** Seat the effect applies to */
  seat: number;
  /** Source card id; "" when its identity is secret to the viewer */
  cardId: string;
  /** Short effect summary, e.g. "+2 attack · next attack" */
  label: string;
}

// ── Player intents (client -> server, validated against legal actions) ──────

/** Zones a card may be played from when an effect permits it (card-scoped via
 *  CardInstance.playableFrom, or player-scoped via a "playZone:<zone>" flag). */
export type PlayableZone = "banish" | "graveyard" | "deck";

/** Which side(s) of a Meld split card were announced when it was played —
 *  chosen by the player at play time (client-side picker); "both" costs twice
 *  the base cost (CR 8.3.38). Required when the played card has Meld. */
export type MeldSide = "left" | "right" | "both";

/** Presentation metadata for a play cost whose arena and hand cards are
 * declared in separate groups before resources are paid. The engine remains
 * authoritative for the exact legal card sets. */
export interface AdditionalPlayCostSelection {
  kind: "destroy-controlled-and-or-discard-hand";
  cardLabel: string;
  maximumDestroyed: number;
  maximumDiscarded: number;
}

export type GameIntent =
  | { kind: "play-card"; instanceId: number; pitchInstanceIds: number[]; pitchRequired?: number; meldSide?: MeldSide; targetAllyId?: number; targetCardInstanceId?: number; boost?: true; boostCount?: number; asInstant?: true; alternativeCostCardInstanceIds?: number[]; additionalCostSelection?: AdditionalPlayCostSelection; /** Presentation hint: this announcement may pause on a pre-stack choice. */ deferPlayPresentation?: true }
  | { kind: "play-from-arsenal"; instanceId: number; pitchInstanceIds: number[]; pitchRequired?: number; meldSide?: MeldSide; targetAllyId?: number; targetCardInstanceId?: number; boost?: true; boostCount?: number; asInstant?: true; alternativeCostCardInstanceIds?: number[]; additionalCostSelection?: AdditionalPlayCostSelection; deferPlayPresentation?: true }
  | { kind: "play-from-zone"; zone: PlayableZone; instanceId: number; pitchInstanceIds: number[]; pitchRequired?: number; meldSide?: MeldSide; targetAllyId?: number; targetCardInstanceId?: number; boost?: true; boostCount?: number; asInstant?: true; alternativeCostCardInstanceIds?: number[]; additionalCostSelection?: AdditionalPlayCostSelection; deferPlayPresentation?: true }
  | { kind: "activate-ability"; sourceInstanceId: number; pitchInstanceIds: number[]; pitchRequired?: number; abilityIndex?: number; targetAllyId?: number; alternativeCostCardInstanceIds?: number[] }
  | { kind: "pass" }
  | { kind: "defend"; instanceIds: number[]; pitchInstanceIds?: number[] }
  | { kind: "stage-defenders"; instanceIds: number[] }
  | { kind: "choose"; optionId: string }
  | { kind: "order-triggers"; optionIds: string[] }
  | { kind: "skip-runechant" }
  | { kind: "close-chain" }
  | { kind: "concede" };

// ── Replays ────────────────────────────────────────────────────────────────

/**
 * A complete game recording, as downloadable JSON. A replay is a sequence of
 * immutable `GameView` frames re-rendered by the UI. Server-retained frames
 * reveal both players' hidden zones for post-game study; `seat` controls board
 * orientation, not replay visibility.
 */
export interface ReplayFileV1 {
  version: 1;
  /** Board orientation seat, or null for a spectator recording. */
  seat: number | null;
  views: GameView[];
}

export interface ReplayFrameV2 {
  view: GameView;
  /** Null for the initial frame and discontinuous/restored frames. */
  transition: Omit<GameTransitionView, "fromVersion"> | null;
}

export interface ReplayFileV2 {
  version: 2;
  /** Board orientation seat, or null for a spectator recording. */
  seat: number | null;
  frames: ReplayFrameV2[];
}

export type ReplayFile = ReplayFileV1 | ReplayFileV2;

// ── Room / lobby wire protocol ──────────────────────────────────────────────

/** A player who hasn't applied any game intent for this long is considered
 *  idle — the opponent may claim victory. Checked client-side (toast) and
 *  enforced server-side (claim validation). */
export const IDLE_VICTORY_MS = 2 * 60 * 1000;

/** Cosmetic badge selected for public display. Entitlements are private
 * account data; this field exposes only the single active choice. */
export type PlayerBadge = "early-tester";

/** Public account presentation for one player in an active game. */
export interface PlayerProfileView {
  username: string;
  badge: PlayerBadge | null;
}

/** One player's side of the pre-game prep room. */
export interface PrepSeatView {
  username: string;
  heroId: string;
  heroName: string;
  /** classic-battles: which preconstructed hero this seat plays */
  hero?: HeroId;
  ready: boolean;
  connected: boolean;
  /** Matchmade rooms only: this player acknowledged the pairing. */
  accepted?: boolean;
}

export type MatchPrepPhase = "accept" | "prepare" | "choose-first";

/** Pre-game prep room state: sideboarding, die roll and first-player pick. */
export interface PrepView {
  format: Format;
  /** The room permits implemented cards from explicitly unreleased sets. */
  allowFutureCards?: true;
  /** This room has a synthetic AI opponent and is deleted when its human ends it. */
  botGame?: boolean;
  seats: [PrepSeatView | null, PrepSeatView | null];
  yourSeat: number;
  /** your saved deck, cc/silver-age only (for loading the sideboarding pool after a reconnect) */
  yourDeckId?: string;
  /** Rolled once both seats are filled; null while waiting for an opponent */
  die: { rolls: [number, number]; winner: 0 | 1 } | null;
  /** Seat going first, picked by the die winner in PvP or the human in bot games; null until chosen */
  startPlayer: 0 | 1 | null;
  /** Matchmade rooms only: durable server deadline for the current phase. */
  deadlineAt?: number;
  /** Matchmade rooms only: action required before deadlineAt. */
  deadlinePhase?: MatchPrepPhase;
}

/** A room listed in the lobby: one with a free player seat, or a full room
 *  listed for spectators only (the seeded demo match). */
export interface RoomSummary {
  code: string;
  format: Format;
  /** The room permits implemented cards from explicitly unreleased sets. */
  allowFutureCards?: true;
  /** per-seat hero display names (null = open seat) — the lobby's vs headshots */
  heroes: [string | null, string | null];
  createdAt: number;
  /** both seats taken — joining can only ever be as a spectator */
  spectateOnly?: boolean;
  /** the game has left pre-game preparation and is now in progress */
  started?: true;
  /** the requesting account holds a seat here — offer rejoin, not join */
  yours?: boolean;
}

/** Minimal room metadata returned after someone opens an invite URL. */
export interface RoomInvite {
  code: string;
  format: Format;
  /** The room permits implemented cards from explicitly unreleased sets. */
  allowFutureCards?: true;
  /** Both player seats are occupied, so the invite can only spectate. */
  spectateOnly?: boolean;
  /** The requesting account already owns a seat and can rejoin directly. */
  yours?: boolean;
}

export type UndoTarget = "last-action" | "current-turn" | "previous-turn";

/** Short, predefined table messages. They are broadcast live and never persisted. */
export type EmoteMessage =
  | "Hello!"
  | "Good luck, have fun!"
  | "Good game!"
  | "Thanks!"
  | "Sorry!"
  | "Nice play!"
  | "Thinking..."
  | "Oops!";

/** How a seat wants empty priority/reaction windows handled. */
export type PriorityWindowMode = "auto-pass" | "always-pause";

export type ClientMessage =
  | { type: "auth"; token: string }
  /** classic-battles: hero; cc/silver-age: deckId of a saved deck */
  | { type: "create-room"; format: Format; hero?: HeroId; deckId?: string; private?: boolean; allowFutureCards?: boolean }
  /** Create a dedicated constructed room with the selected AI opponent. */
  | { type: "create-bot-room"; format?: "cc" | "silver-age"; deckId: string; bot?: BotOpponent; allowFutureCards?: boolean }
  /** deckId required to take a player seat in cc/silver-age rooms; omit to spectate.
   *  classic-battles player seats pass hero (mirrors allowed; omitted = the
   *  opposite of the seated player). spectate forces a spectator slot even
   *  when a player seat is free */
  | { type: "join-room"; code: string; token?: string; deckId?: string; hero?: HeroId; spectate?: boolean }
  /** Resolve an invite URL before asking the player for a deck or hero. */
  | { type: "inspect-room"; code: string }
  | { type: "list-rooms" }
  | { type: "queue-join"; format: Format; hero?: HeroId; deckId?: string; allowFutureCards?: boolean; avoidRoomCodes?: string[] }
  | { type: "queue-leave" }
  /** Matchmade prep room: acknowledge the pairing before sideboarding. */
  | { type: "accept-match" }
  /** prep room: after first-player choice, present a deck and set ready */
  | { type: "present-deck"; deck: PresentedDeck }
  /** prep room: withdraw readiness to edit the presented deck again */
  | { type: "prep-unready" }
  /** prep room: authorized player picks who goes first (first=true → self) */
  | { type: "choose-first"; first: boolean }
  /** Leave a pre-game room, or explicitly delete a bot game. */
  | { type: "leave-room"; endGame?: true }
  /** autoPass is a presence-only hint. The server verifies that the intent is
   *  a pass in an empty priority/reaction window before omitting its undo step. */
  | { type: "intent"; intent: GameIntent; autoPass?: true; commandId?: string; expectedVersion?: number }
  /** Per-seat priority preference, applied by the server before broadcasting:
   *  auto-pass immediately passes empty priority/reaction windows. */
  | { type: "priority-mode"; mode: PriorityWindowMode; commandId?: string; expectedVersion?: number }
  /** Temporary per-seat shortcut for only the current consecutive Runechant
   *  resolution. The server expires it at the first non-Runechant boundary. */
  | { type: "runechant-skip"; enabled: boolean; commandId?: string; expectedVersion?: number }
  | { type: "undo"; target?: UndoTarget; commandId?: string; expectedVersion?: number }
  /** Broadcast a predefined, ephemeral message to the current room. */
  | { type: "emote"; message: EmoteMessage }
  /** end the game as winner because the opponent has been idle (IDLE_VICTORY_MS) */
  | { type: "claim-victory"; commandId?: string; expectedVersion?: number };

export type ServerMessage =
  | { type: "authed"; username: string }
  | { type: "auth-failed" }
  | { type: "room-created"; code: string; seat: number; token: string; version: number }
  | { type: "joined"; code: string; seat: number | null; token: string; spectator?: boolean; resumed?: true; version: number }
  | { type: "room-info"; room: RoomInvite }
  | { type: "game-started"; version: number }
  | { type: "state"; version: number; view: GameView; transition?: GameTransitionView; playerProfiles: [PlayerProfileView, PlayerProfileView]; yourSeat: number | null; legal: GameIntent[]; /** Structurally available plays/activations, including unaffordable ones. */ actionCandidates?: GameIntent[]; spectators?: number; lastActionAt: [number, number]; botGame?: boolean }
  | { type: "spectators"; count: number; version: number }
  | { type: "opponent-disconnected"; version: number }
  | { type: "opponent-reconnected"; version: number }
  /** Ephemeral room event; intentionally carries no room version or persisted state. */
  | { type: "emote"; seat: number; message: EmoteMessage }
  | { type: "rooms"; rooms: RoomSummary[] }
  | { type: "queue-status"; counts: Record<Format, number> }
  | { type: "queued"; format: Format }
  | { type: "queue-left" }
  /** This player lost a matchmade prep seat by missing its deadline. */
  | { type: "match-timeout" }
  /** pre-game prep room update */
  | { type: "prep-state"; prep: PrepView; version: number }
  /** your leave-room went through; back to the lobby */
  | { type: "left" }
  | { type: "error"; code: ErrorCode; message: string };

/** Stable machine-readable failures. Human messages may change freely. */
export type ErrorCode =
  | "AUTH_REQUIRED"
  | "ROOM_NOT_FOUND"
  | "ROOM_BUSY"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "SESSION_REPLACED"
  | "RESYNC_REQUIRED"
  | "INVALID_PRESENTATION"
  | "INVALID_MESSAGE"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INTERNAL_ERROR";
