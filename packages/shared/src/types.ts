import type { ClientBotTask, BotSubmission, BotSubmissionResult } from "./botTasks.js";
// ── Card static data ────────────────────────────────────────────────────────

/** Play formats. Each uses either a saved user deck or a shared format-legal
 *  preconstructed deck. */
export type Format = "cc" | "silver-age";

/** Constructed card eligibility selected for a room. */
export type CardPoolMode = "legal" | "future" | "open";

/** Waiting searchers in one format, keyed by the card pool each queued under
 * and then by the strictest pool its deck is legal in. A pairing plays in the
 * stricter of both queued pools, and both decks must be legal there. */
export type QueuePoolCounts = Record<CardPoolMode, Record<CardPoolMode, number>>;

/** Stable identities for the supported practice opponents. */
export type BotOpponent = "bravo" | "briar" | "kayo" | "cindra" | "ira" | "hala" | "jarl" | "levia" | "starvo" | "boltyn";

/** Numeric resources produced when pitched. Colored cards use their red/
 * yellow/blue/purple color value (1/2/3/4). */
export type Pitch = 1 | 2 | 3 | 4;

export type CardColor = 1 | 2 | 3 | 4;

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
  /** Printed color when it differs from pitch, such as an unpitchable yellow card. */
  color?: CardColor;
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
  /** Main-deck card ids, duplicates repeated (60+ for cc, exactly 40 for silver-age);
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
  /** All registered weapon-zone cards: weapons, off-hands, and quivers. */
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

/** A pick that keeps a card's standard art while highest rarity is on. */
export const STANDARD_CARD_ART = "standard";

/** Cosmetic art choices for a saved deck. Opponents and spectators see them. */
export interface DeckArt {
  /** Show each card's highest-rarity image unless it has its own pick. */
  highestRarity: boolean;
  /** printing id -> Fabrary image id, or STANDARD_CARD_ART */
  picks: Record<string, string>;
}

/** The cards a player brings into one game, chosen from their `DeckPool`. */
export interface PresentedArena {
  /** Weapon-zone cards selected from pool.weaponIds (at most two objects). */
  weaponIds: string[];
  /** slot -> cardId, each ⊆ pool equipmentPool and legal for that slot
   *  (matching subtype, or any equipment slot for Modular equipment) */
  equipment: Partial<Record<EquipmentSlot, string>>;
}

/** Arena cards that have been revealed; null identifies a Cloaked card. */
export interface RevealedArena {
  weaponIds: (string | null)[];
  equipment: Partial<Record<EquipmentSlot, string | null>>;
}

/** Main-deck selection made after arena cards are committed and revealed. */
export interface PresentedDeck extends PresentedArena {
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

/** Every kind of rules counter a card can carry. Counters exist only on
 * objects in the arena: a card that leaves it becomes a new object
 * (CR 3.0.9) and loses all of them. Script bookkeeping and engine statuses
 * never belong here; they live in the card's private script state. */
export type CounterKind =
  | "aim"
  | "balance"
  | "bind"
  | "defense"
  | "doom"
  | "endurance"
  | "energy"
  | "flow"
  | "frost"
  | "haunt"
  | "holo"
  | "lessons"
  | "power"
  | "rust"
  | "sand"
  | "stain"
  | "steam"
  | "storm"
  | "suspense"
  | "verse";

export type CardCounters = Partial<Record<CounterKind, number>>;

export type TurnTriggerEvent = "start-of-turn" | "begin-action-phase" | "end-of-turn";

export interface TurnTriggerView {
  /** When in the turn structure the trigger fires. */
  event: TurnTriggerEvent;
  label: string;
  labelMessage?: GameMessage;
  /** The trigger asks its controller whether to use it. */
  optional?: boolean;
  /** Repeating choices standing orders may answer. */
  choices?: TurnTriggerChoiceView[];
}

export interface TurnTriggerChoiceView {
  hook: string;
  options: TurnTriggerChoiceOption[];
}

export interface TurnTriggerChoiceOption {
  value: string;
  message: GameMessage;
}

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
  /** Stable zero-based arsenal zone index while this card is in arsenal. */
  arsenalSlot?: number;
  /** Face-down banished card returning to hand at the upcoming end phase.
   *  Public status: both players see the marker, only the owner sees the identity. */
  intimidated?: boolean;
  /** Tapped permanent (arena zones only). */
  tapped?: boolean;
  /** Frozen arena or arsenal card. Public status. */
  frozen?: boolean;
  /** First turn a timed freeze no longer applies; absent while the freeze
   *  lasts as long as another object. */
  frozenUntilTurn?: number;
  /** -1 defense counters on the card (Battleworn/Temper) — `defense` already
   *  reflects them; this is for rendering the counter badge. */
  defCounters?: number;
  /** Rules counters on an arena card, plus its public engine statuses
   *  (marked, attacked, arcane bonus, sharpened this turn, fused, frostbite
   *  zone). */
  counters?: Record<string, number>;
  /** Card whose ability currently permits this card to be played from its zone.
   *  Projected only to the player entitled to use that permission. */
  playableFromSourceCardId?: string;
  /** Zero-based indexes of once-per-turn activated abilities already used this
   *  turn. Public arena status used to distinguish otherwise identical cards. */
  usedAbilityIndexes?: number[];
  /** Uses remaining this turn for each activated ability. Projected only while
   * a multi-use ability has at least one activation remaining. */
  remainingAbilityActivations?: number[];
  /** Labels for sources with multiple activated abilities. Derived by the
   * authoritative engine so clients do not load executable card scripts. */
  activatedAbilityLabels?: string[];
  /** Turn-structure triggers (start of turn, action phase, end of turn) this
   * arena card puts on the stack every turn, so clients can offer standing
   * orders before the first one fires. Derived by the engine, like
   * `activatedAbilityLabels`. */
  turnTriggers?: TurnTriggerView[];
  /** Zero-based activated abilities that declare an attack. Presentation data
   * for showing their pending attack in the combat chain. */
  attackAbilityIndexes?: number[];
  /** Zero-based activated abilities that tap this card as a cost. */
  tapAbilityIndexes?: number[];
  /** Additional names currently granted to this object. */
  grantedNames?: string[];
  /** Public card name chosen for this object by a resolving effect. */
  chosenName?: string;
  /** Arena permanent this visible card is currently bound to. */
  boundToInstanceId?: number;
  /** Additional classes/subtypes currently granted to this object. */
  grantedTypes?: string[];
  /** Current red/yellow/blue/purple color override (1/2/3/4). */
  grantedColor?: CardColor;
  /** Current life of a living permanent (allies — CR 8.2.8: dealt damage
   *  reduces it, it resets to base during the end phase, at 0 the ally dies).
   *  Base life comes from cardData. */
  life?: number;
  /** Identity is secret to this viewer (e.g. a card the opponent banished face down).
   *  cardId is blanked; render as a card back. */
  hidden?: boolean;
}

/** An attack waiting in the attack queue for its turn on the combat chain. */
export interface AttackQueueEntryView {
  card: CardView;
  /** Controller of the attack */
  seat: number;
}

/** A card or ability presented on the stack while awaiting resolution. */
export interface StackLayerView {
  /** The represented card or source; null if it is unavailable or hidden. */
  card: CardView | null;
  /** Controller of the trigger */
  seat: number;
  /** Short description, e.g. "Turn face up?" */
  label: string;
  /** Semantic label used by localized clients; `label` remains the stable
   * English fallback for older clients and replays. */
  labelMessage?: GameMessage;
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
  /** The attack layer is waiting for priority to pass. The combat chain link
   *  already exists, but the Attack Step has not begun. */
  onStack?: boolean;
  hit?: boolean;
  /** Effective keywords of the attack: printed or granted by modifiers.
   *  Snapshotted at resolution (chain-link modifiers expire with the link) */
  goAgain?: boolean;
  /** The unresolved attack can't gain go again, e.g. after Blizzard. */
  goAgainBlocked?: true;
  /** Defense reactions can't be played from hand to this unresolved link. */
  defenseReactionsBlockedFromHand?: true;
  /** Defense reactions can't be played from arsenal to this unresolved link. */
  defenseReactionsBlockedFromArsenal?: true;
  /** This attack has wagered on its current chain link. */
  wagered?: boolean;
  /** Public reward description for each wager completed on this chain link. */
  wagerRewards?: string[];
  dominate?: boolean;
  overpower?: boolean;
  /** The attack can't be defended by more than 1 card of each color. */
  veil?: boolean;
  /** Maximum number of defending cards other than block cards that may be
   * declared for this attack. Omitted when there is no such restriction. */
  maxNonBlockDefenders?: number;
  /** Resolved attack/defense reaction cards and activated-ability sources
   *  applied to this link. */
  reactions: CardView[];
  /** When the attack-target is an ally rather than the hero (CR 8.2.8d):
   *  its name, for display. */
  targetAllyName?: string;
  /** Public targeted ally state, rendered in the defender position. Omitted if
   *  the target left the game before this link was projected. */
  targetAlly?: CardView;
  /** Opposing allies this attack also targets beyond its primary target.
   *  They cannot be defended. Targets that left the arena are omitted; the
   *  field is omitted when none remain. */
  additionalTargets?: ChainAdditionalTargetView[];
}

export interface ChainAdditionalTargetView {
  /** Public state of the targeted ally. */
  ally: CardView;
  /** Combat damage this target would be dealt before prevention, or the
   *  damage it was dealt once the link resolved. */
  damage: number;
  /** Damage currently set to be prevented for this target, omitted when none. */
  damageToPrevent?: number;
  preventionModifiers?: CombatValueModifierView[];
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
  /** Own arsenal; opponents receive only face-up cards. */
  arsenal: CardView[];
  arsenalCount: number;
  /** Currently usable arsenal zones. Optional for older replay projections. */
  arsenalCapacity?: number;
  /** Arsenal zones the player has, including an additional zone that is
   * currently unusable. Optional for older replay projections. */
  arsenalZones?: number;
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
  /** Attack ability indexes for the hero's arena presentation. */
  heroAttackAbilityIndexes?: number[];
  /** Hero ability indexes that tap the hero as a cost. */
  heroTapAbilityIndexes?: number[];
  /** Zero-based indexes of the hero's limited activated abilities with no
   * activation left this turn, like `CardView.usedAbilityIndexes`. */
  heroUsedAbilityIndexes?: number[];
  equipment: Partial<Record<EquipmentSlot, CardView>>;
  weapons: CardView[];
  /** Board-state cards in play: tokens/auras (e.g. Quicken), items, allies */
  board: CardView[];
}

/** A locale-independent player-facing message. Values stay deliberately
 * shallow so protocol and persisted-state decoders can validate them exactly. */
export interface GameMessage {
  id: string;
  values?: Record<string, GameMessageValue>;
}

export type GameMessageValue =
  | string
  | number
  | boolean
  | { kind: "card"; cardId: string }
  | { kind: "player"; seat: number }
  /** Reference another catalog message using the enclosing message's values.
   * This composes semantic fragments such as a localized trigger effect into
   * a larger sentence without nesting unbounded wire data. */
  | { kind: "term"; id: string };

export type GameLogZone =
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
  | "chain"
  | "inventory";

/** Machine-readable metadata for client behavior that must not depend on
 * localized prose. This deliberately covers only established log consumers;
 * new variants must be added to the exact protocol and persistence decoders. */
export type GameLogEvent =
  | {
      kind: "card-moved";
      cardId?: string;
      ownerSeat: number;
      from: GameLogZone;
      to: GameLogZone;
      faceDown?: true;
    }
  | {
      kind: "cards-revealed";
      cards: { cardId: string; ownerSeat: number }[];
      sourceZone: "hand" | "deck" | "inventory";
    }
  | {
      kind: "damage";
      targetSeat: number;
      amount: number;
      damageType: "physical" | "arcane";
      sourceCardId?: string;
    }
  | { kind: "turn-start"; turn: number; activeSeat: number }
  | { kind: "shuffle"; seat: number }
  | { kind: "roll"; result: number; seat?: number; sides?: number }
  | { kind: "numbers-revealed"; sourceCardId: string; choices: { seat: number; number: number }[] };

/** Locale-independent presentation attached to an audience-safe log entry.
 * The English fallback keeps older clients, replays, exports, and diagnostics
 * readable while producers migrate incrementally. */
export interface GameLogPayload {
  fallback: string;
  message: GameMessage;
  event?: GameLogEvent;
}

/** A projected log line. Legacy lines contain only `fallback`; structured
 * lines also carry a stable sequence and semantic presentation. */
export type GameLogViewEntry =
  | { fallback: string }
  | (GameLogPayload & { sequence: number });

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
  /** Semantic prompt used by localized clients. `prompt` remains during the
   * card-script migration and is the deterministic legacy fallback. */
  promptMessage?: GameMessage;
  /** For choose-target / optional-effect: engine-defined option ids */
  options?: string[];
  /** Bounded multi-choice decisions submit a unique subset of `options` in
   * one atomic intent. Both bounds are present together. */
  minimumSelections?: number;
  maximumSelections?: number;
  /** Bounded selections may not include two cards that share a name. */
  distinctCardNames?: boolean;
  /** Option selected by the board's Space shortcut. Card scripts set this
   * explicitly when one choice is the expected/common path. */
  defaultOption?: string;
  /** Parallel display text for ordering/choice options whose ids are
   *  engine-owned and not suitable as player-facing labels. */
  optionLabels?: string[];
  /** Parallel localized presentation for literal options. Null entries use a
   * card view or the legacy option/optionLabels presentation. */
  optionMessages?: (GameMessage | null)[];
  /** Modes already selected earlier in the same multi-mode choice. Display
   * only: they are no longer in `options`. Values are the English fallback;
   * `chosenOptionMessages` is parallel localized presentation. */
  chosenOptions?: string[];
  chosenOptionMessages?: (GameMessage | null)[];
  /** Parallel count for consolidated trigger-order options. Null entries are
   * ordinary single-source options. */
  optionCounts?: (number | null)[];
  /** Parallel to `options`: resolved card views for live card-instance
   * options, trigger sources, or registered card definitions (such as
   * transform token choices). Null entries are plain literal options. Live
   * cards secret to the viewer are projected hidden. */
  optionCards?: (CardView | null)[];
  /** Present a single-pick choose-target as rows of source card plus effect
   * label (replacement-effect choices) instead of the card grid. */
  optionLayout?: "effect-list";
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
  /** Number of staged defenders still in the defending player's hand.
   * Public presentation metadata; staging does not move cards between zones. */
  stagedHandCount?: number;
  /** Combined defense of the staged cards — projected as 0 to anyone but the
   *  defender so face-down hand cards leak nothing before the commit */
  stagedDefense?: number;
  /** Attack value of the current link with the staged defenders this viewer
   *  can identify declared beside it; face-down hand or arsenal defenders are
   *  excluded for everyone but the defender */
  stagedAttack?: number;
  /** Attack modifiers of the current link priced with the same staged set */
  stagedAttackModifiers?: CombatValueModifierView[];
  /** Defend decisions, projected only to the defender: the defense each legal
   *  defender adds to the staged set (for a staged card, the defense unstaging
   *  it removes). Unlike `CardView.defense`, it includes delayed "next time
   *  they defend" effects applied at the defend event (Spider's Bite). */
  defenderDefense?: DefenderDefenseView[];
  /** A declared resource cost waiting for ordinary hand-card pitching. Only
   *  projected to the paying player. Option ids remain engine-owned; clients
   *  select cards and submit the matching option unchanged. */
  resourcePayment?: {
    cost: number;
    options: { optionId: string; pitchInstanceIds: number[] }[];
    /** Source of a scripted payment; clients resolve it against visible cards. */
    sourceInstanceId?: number;
  };
  /** Arena source of an optional trigger choice (yes/no), projected only to
   * the deciding player so clients can attach the choice to that card. */
  sourceInstanceId?: number;
  /** Publicly announced card or arena ability whose play/activation is paused
   * on a declaration, resource payment, or additional-cost choice before its
   * new stack layer is ready. Arena sources remain in place unless a cost moves them.
   * The original zone does not grant visibility to any other cards there. */
  preStackSource?: {
    card: CardView;
    zone: "hand" | "arsenal" | PlayableZone | "hero" | "equipment" | "weapon" | "board";
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
  /** Damage dealt by an opponent to this seat's allies. Absent in older games. */
  allyAbsorbed?: [number, number];
  /** Life gained and non-damage life lost, for end-game value. Absent in older games. */
  lifeGained?: [number, number];
  lifeLost?: [number, number];
}

export interface GameStatsView {
  turns: GameTurnStatsView[];
}

/** View-visible facts for rules and policies that depend on events earlier in the
 * current turn. These are projected from engine flags so consumers never need
 * to reconstruct rules state from combat-chain retention or human logs. */
export interface PlayerTurnFactsView {
  attacks: number;
  weaponAttacks: number;
  /** Whether this player has banished a card with at least six power this turn.
   * Visible only to that player; optional in opponent views and older replays. */
  banishedSixPlusThisTurn?: boolean;
  /** Public: times this player has charged their hero's soul this turn.
   * Omitted when zero. */
  chargesThisTurn?: number;
  /** Public: a yellow card was put into this player's soul this turn.
   * Omitted when false. */
  yellowSoulThisTurn?: boolean;
  /** Public: cards banished from this player's soul during the open combat
   * chain. Omitted when zero. */
  soulBanishedThisChain?: number;
  /** Public: a turn-scoped effect (Kabuto) prohibits this player's weapon
   * attacks. Omitted when false. */
  weaponAttacksProhibited?: boolean;
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
  /** Attacks waiting to move onto the combat chain, first attack first.
   * Omitted when no attack is queued. */
  attackQueue?: AttackQueueEntryView[];
  /** Lingering effects (next attack / until end of turn) and the seat they affect */
  ongoing: OngoingEffectView[];
  pendingDecision: PendingDecision | null;
  /** Absent only on legacy replay files recorded before match stats existed. */
  gameStats?: GameStatsView;
  /** Absent only on legacy replay files recorded before typed turn facts. */
  turnFacts?: TurnFactsView;
  /** Null during play and after a draw; phase distinguishes the two. */
  winner: number | null;
  /** Seat with an unanswered offer to end this game in a draw. */
  drawOfferSeat?: number;
  /** Recent human-readable log lines, newest last */
  log: string[];
  /** Structured equivalents aligned one-to-one with `log`. Absent for legacy
   * rooms and replay frames that contain no semantic log entries. */
  logEntries?: GameLogViewEntry[];
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
  /** Historical room version whose projected state is restored. Present only
   * for replacement edges so replay recorders can discard invalidated frames
   * without recording the rollback as another frame. */
  restoreVersion?: number;
  events: GameTransitionMove[];
}

/** When a lingering effect ends, ordered from soonest to never:
 * consumed by the next matching event, the combat chain closing, the end of
 * this turn or action phase, a later turn, or never (rest of the game). */
export type EffectLifetime = "once" | "chain" | "turn" | "later" | "game";

export interface DefenderDefenseView {
  instanceId: number;
  defense: number;
  /** Attack value of the current link once this card (with the staged set)
   *  defends, so defenders that change the attack's power are priced before
   *  the commit */
  attack: number;
}

export interface OngoingEffectView {
  /** Seat the effect applies to */
  seat: number;
  /** Source card id; "" when its identity is secret to the viewer or the
   * effect has no source card */
  cardId: string;
  /** English fallback combining summary and duration, e.g.
   * "+2 attack · next attack". Retained for clients and replays that predate
   * the structured fields below. */
  label: string;
  /** The source card exists but is face down to this viewer. Without it, an
   * empty `cardId` means the effect has no source card. */
  sourceHidden?: true;
  /** Seat controlling the source, when known. Differs from `seat` when the
   * effect was imposed by the opponent. */
  sourceSeat?: number;
  /** English effect text without its duration, e.g. "+2 attack". */
  summary?: string;
  summaryMessage?: GameMessage;
  lifetime?: EffectLifetime;
  /** English duration, e.g. "next attack" or "each of their end phases". */
  duration?: string;
  durationMessage?: GameMessage;
  /** A rest-of-game effect that triggers repeatedly. */
  recurring?: true;
  /** Still listed for clarity, but it will not apply this turn, e.g. a
   * first-damage prevention after the hero was already dealt damage. */
  inactive?: true;
  /** Rules values of a modifier-backed effect, summed over the modifiers it
   * groups, for consumers that must not parse English (practice bots).
   * Present on every modifier-backed effect, even when empty; absent on
   * trigger and counter effects and in views that predate it. */
  facts?: OngoingEffectFacts;
}

export interface OngoingEffectFacts {
  /** Power granted, including a conditional bonus. */
  power?: number;
  /** Reduction to the cost of playing a matching card; negative costs more. */
  playCostReduction?: number;
  /** Reduction to the cost of activating a matching ability. */
  activationCostReduction?: number;
  /** Unconditional go again; conditional grants appear only in the summary. */
  goAgain?: true;
  dominate?: true;
  /** Cards drawn when the affected attack hits. */
  onHitDraw?: number;
  /** Damage the effect prevents from the next matching damage. */
  preventDamage?: number;
  /** Consumed by the next matching attack. */
  nextAttack?: true;
}

// ── Player intents (client -> server, validated against legal actions) ──────

/** Zones a card may be played from when an effect permits it (card-scoped via
 *  CardInstance.playableFrom, or player-scoped via a "playZone:<zone>" flag). */
export type PlayableZone = "banish" | "graveyard" | "deck";

/** Which side(s) of a Meld split card were announced when it was played —
 *  chosen by the player at play time (client-side picker); "both" costs twice
 *  the base cost (CR 8.3.38). Required when the played card has Meld. */
export type MeldSide = "left" | "right" | "both";

/** Presentation metadata for a card cost chosen before resources are paid.
 * The engine remains authoritative for the exact legal card sets. */
export interface CardCostSelection {
  kind: "choose-card-cost";
  cardLabel: string;
  minimum: number;
  maximum: number;
  modes: Array<{
    kind: "destroy" | "discard" | "banish";
    maximum: number;
  }>;
}

/** Token runs whose consecutive priority windows a seat may skip at once. */
export type TokenSkipKind = "runechant" | "seismic-surge";

export type GameIntent =
  | { kind: "play-card"; instanceId: number; pitchInstanceIds: number[]; pitchRequired?: number; meldSide?: MeldSide; targetAllyId?: number; targetCardInstanceId?: number; boost?: true; boostCount?: number; asInstant?: true; alternativeCostCardInstanceIds?: number[]; cardCostSelection?: CardCostSelection; /** Presentation hint: this announcement may pause on a pre-stack choice. */ deferPlayPresentation?: true }
  | { kind: "play-from-arsenal"; instanceId: number; pitchInstanceIds: number[]; pitchRequired?: number; meldSide?: MeldSide; targetAllyId?: number; targetCardInstanceId?: number; boost?: true; boostCount?: number; asInstant?: true; alternativeCostCardInstanceIds?: number[]; cardCostSelection?: CardCostSelection; deferPlayPresentation?: true }
  | { kind: "play-from-zone"; zone: PlayableZone; instanceId: number; pitchInstanceIds: number[]; pitchRequired?: number; meldSide?: MeldSide; targetAllyId?: number; targetCardInstanceId?: number; boost?: true; boostCount?: number; asInstant?: true; alternativeCostCardInstanceIds?: number[]; cardCostSelection?: CardCostSelection; deferPlayPresentation?: true }
  | { kind: "activate-ability"; sourceInstanceId: number; pitchInstanceIds: number[]; pitchRequired?: number; abilityIndex?: number; targetAllyId?: number; targetCardInstanceId?: number; alternativeCostCardInstanceIds?: number[]; cardCostSelection?: CardCostSelection; /** Presentation hint: wait for the authoritative result instead of projecting this activation. */ deferActivationPresentation?: true }
  | { kind: "pass" }
  | { kind: "defend"; instanceIds: number[]; pitchInstanceIds?: number[] }
  | { kind: "stage-defenders"; instanceIds: number[] }
  | { kind: "choose"; optionId: string }
  | { kind: "choose-many"; optionIds: string[] }
  | { kind: "order-triggers"; optionIds: string[] }
  | { kind: "skip-runechant" }
  | { kind: "skip-seismic-surge" }
  | { kind: "close-chain" }
  | { kind: "concede" }
  | { kind: "offer-draw" }
  | { kind: "accept-draw" }
  | { kind: "decline-draw" }
  | { kind: "withdraw-draw" };

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

/** A private review note attached to one zero-based replay frame. */
export interface ReplayNote {
  frame: number;
  text: string;
}

/** Portable annotated replay. Server-retained board payloads remain version 2;
 * private account notes are combined with them only for the owner's export. */
export interface ReplayFileV3 {
  version: 3;
  /** Board orientation seat, or null for a spectator recording. */
  seat: number | null;
  frames: ReplayFrameV2[];
  notes: ReplayNote[];
}

export type ReplayFile = ReplayFileV1 | ReplayFileV2 | ReplayFileV3;

// ── Room / lobby wire protocol ──────────────────────────────────────────────

/** A player who hasn't applied any game intent for this long is considered
 *  idle — the opponent may claim victory. Checked client-side (toast) and
 *  enforced server-side (claim validation). */
export const IDLE_VICTORY_MS = 2 * 60 * 1000;

/** Where a report was filed: against a game opponent, or from a friend chat. */
export type PlayerReportSource = "game" | "chat";

/** Why a player reports another account's conduct. Game reports use the
 * gameplay reasons; chat reports use the messaging reasons. */
export type PlayerReportReason =
  | "stalling"
  | "emote-spam"
  | "cheating"
  | "harassment"
  | "spam"
  | "offensive-name"
  | "other";

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
  ready: boolean;
  arenaLocked: boolean;
  /** Present only after both players commit their arena cards. */
  arena?: RevealedArena;
  connected: boolean;
  /** Matchmade rooms only: this player acknowledged the pairing. */
  accepted?: boolean;
}

export type MatchPrepPhase = "accept" | "choose-first" | "select-arena" | "select-deck";
export type PrepPhase = "waiting" | MatchPrepPhase;

/** Pre-game prep room state: sideboarding, die roll and first-player pick. */
export interface PrepView {
  format: Format;
  phase: PrepPhase;
  /** Owner-only committed arena selection, including Cloaked identities. */
  yourArena?: PresentedArena;
  /** Owner-only main deck already presented, for reconnect/edit recovery. */
  yourPresentedDeck?: string[];
  /** Omitted for the tournament-legal default. */
  cardPoolMode?: Exclude<CardPoolMode, "legal">;
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
  /** Omitted for the tournament-legal default. */
  cardPoolMode?: Exclude<CardPoolMode, "legal">;
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
  /** Omitted for the tournament-legal default. */
  cardPoolMode?: Exclude<CardPoolMode, "legal">;
  /** Both player seats are occupied, so the invite can only spectate. */
  spectateOnly?: boolean;
  /** The requesting account already owns a seat and can rejoin directly. */
  yours?: boolean;
}

export type UndoTarget = "last-action" | "current-turn" | "previous-turn";

export type BackgroundMatchmakingStatus =
  | { state: "inactive" }
  | { state: "pending"; format: Format }
  | { state: "searching"; format: Format }
  | {
      state: "offer";
      format: Format;
      roomCode: string;
      deadlineAt: number;
      opponent: { username: string; heroId: string; heroName: string };
      acceptedByYou: boolean;
      opponentAccepted: boolean;
    };

/** Short, predefined table messages. They are broadcast live and never persisted. */
export type EmoteMessage =
  | "Hello!"
  | "Good luck, have fun!"
  | "Good game!"
  | "Thanks!"
  | "Sorry!"
  | "No problem!"
  | "Nice play!"
  | "Thinking..."
  | "Oops!";

// ── Friends and one-to-one chat ───────────────────────────────────────────

export type FriendPresence = "online" | "offline";

export interface FriendSummary {
  username: string;
  presence: FriendPresence;
  friendsSince: number;
  unreadCount: number;
}

export interface FriendRequestSummary {
  username: string;
  direction: "incoming" | "outgoing";
  createdAt: number;
}

export interface SocialSnapshot {
  friends: FriendSummary[];
  requests: FriendRequestSummary[];
}

export interface ChatMessage {
  /** PostgreSQL bigint represented as a decimal string on the wire. */
  id: string;
  friendUsername: string;
  senderUsername: string;
  text: string;
  sentAt: number;
  readAt: number | null;
}

/** Live-only invitation. It is never restored after all recipient sockets disconnect. */
export interface FriendGameInvite {
  inviteId: string;
  fromUsername: string;
  room: RoomInvite;
  sentAt: number;
}

/** How a seat wants empty priority/reaction windows handled. */
export type PriorityWindowMode = "auto-pass" | "always-pause";

/** `chooseHook` → option value; "ask" is absence. */
export type SeatStandingOrder = Record<string, string>;

export type SeatStandingOrders = Record<string, SeatStandingOrder>;

export type ClientMessage =
  | { type: "bot-ready"; runtimeId: string }
  | BotSubmission
  | { type: "auth"; token: string }
  | { type: "social-sync" }
  | { type: "friend-request"; username: string }
  | { type: "friend-request-respond"; username: string; accept: boolean }
  | { type: "friend-request-cancel"; username: string }
  | { type: "friend-remove"; username: string }
  | { type: "chat-history"; username: string; beforeId?: string }
  | { type: "chat-send"; username: string; text: string; clientMessageId: string }
  | { type: "chat-read"; username: string; throughId: string }
  | { type: "create-friend-room"; username: string; format: Format; deckId: string; cardPoolMode?: CardPoolMode }
  | { type: "friend-game-invite-dismiss"; inviteId: string }
  /** Takes your seat in a league match's room, creating the room on first entry. */
  | { type: "enter-league-room"; matchId: string; deckId: string }
  /** deckId of a saved deck or format precon */
  | { type: "create-room"; format: Format; deckId: string; private?: boolean; cardPoolMode?: CardPoolMode }
  /** Create a dedicated constructed room with the selected AI opponent. */
  | { type: "create-bot-room"; format?: Format; deckId: string; bot?: BotOpponent; cardPoolMode?: CardPoolMode; searchForPlayer?: boolean; avoidRoomCodes?: string[] }
  /** deckId required to take a player seat; omit to spectate. spectate
   *  forces a spectator slot even when a player seat is free */
  | { type: "join-room"; code: string; token?: string; deckId?: string; spectate?: boolean }
  /** Resolve an invite URL before asking the player for a deck or hero. */
  | { type: "inspect-room"; code: string }
  | { type: "list-rooms" }
  | { type: "queue-join"; format: Format; deckId: string; cardPoolMode?: CardPoolMode; avoidRoomCodes?: string[] }
  | { type: "queue-leave" }
  | { type: "background-matchmaking-status" }
  | { type: "background-matchmaking-leave" }
  | { type: "background-match-accept"; roomCode: string }
  | { type: "background-match-decline"; roomCode: string }
  /** Skip this hero for the rest of the current background search. */
  | { type: "background-match-avoid-hero"; heroId: string }
  | { type: "decline-pending-bot-match"; roomCode: string }
  /** Matchmade prep room: decline this pairing and keep searching. */
  | { type: "decline-match"; roomCode: string }
  /** Matchmade prep room: acknowledge the pairing before sideboarding. */
  | { type: "accept-match" }
  /** prep room: commit arena cards before either player sees the other selection */
  | { type: "present-arena"; arena: PresentedArena }
  /** prep room: after arena reveal, present a deck and set ready */
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
  /** The seat's standing orders by functional card key; the server applies
   *  them in the commit that reaches the question. */
  | { type: "standing-orders"; orders: SeatStandingOrders; commandId?: string; expectedVersion?: number }
  /** Temporary per-seat shortcut for only the current consecutive Runechant
   *  resolution. The server expires it at the first non-Runechant boundary. */
  | { type: "runechant-skip"; enabled: boolean; commandId?: string; expectedVersion?: number }
  /** The same one-shot shortcut for a consecutive Seismic Surge resolution. */
  | { type: "seismic-surge-skip"; enabled: boolean; commandId?: string; expectedVersion?: number }
  | { type: "undo"; target?: UndoTarget; commandId?: string; expectedVersion?: number }
  /** Broadcast a predefined, ephemeral message to the current room. */
  | { type: "emote"; message: EmoteMessage }
  /** Seated players may remove every live spectator session owned by this account. */
  | { type: "kick-spectator"; username: string }
  /** end the game as winner because the opponent has been idle (IDLE_VICTORY_MS) */
  | { type: "claim-victory"; commandId?: string; expectedVersion?: number };

export type ServerMessage =
  | { type: "bot-runtime"; code: string; runtimeId: string }
  | { type: "bot-fallback-needed"; code: string; version: number; runtimeId: string; delayMs: number }
  | ClientBotTask
  | BotSubmissionResult
  | { type: "authed"; username: string }
  | { type: "auth-failed" }
  | { type: "social-snapshot"; snapshot: SocialSnapshot }
  | { type: "friend-presence"; username: string; presence: FriendPresence }
  | { type: "chat-history"; username: string; messages: ChatMessage[]; hasMore: boolean }
  | { type: "chat-message"; message: ChatMessage }
  | { type: "friend-game-invite"; invite: FriendGameInvite }
  | { type: "friend-game-invite-dismissed"; inviteId: string }
  /** Something in one of the account's leagues changed; reload them. */
  | { type: "league-updated" }
  | { type: "room-created"; code: string; seat: number; token: string; version: number }
  | { type: "joined"; code: string; seat: number | null; token: string; spectator?: boolean; resumed?: true; version: number }
  | { type: "room-info"; room: RoomInvite }
  | { type: "game-started"; version: number }
  | { type: "state"; version: number; view: GameView; transition?: GameTransitionView; playerProfiles: [PlayerProfileView, PlayerProfileView]; yourSeat: number | null; legal: GameIntent[]; /** Structurally available plays/activations, including unaffordable ones. */ actionCandidates?: GameIntent[]; spectators?: number; lastActionAt: [number, number]; botGame?: boolean; /** Per-seat printing id -> image id, limited to cards this viewer can see. */ cardArt?: [Record<string, string>, Record<string, string>] }
  | { type: "spectators"; count: number; version: number }
  /** Additive companion to the legacy count message; null identifies a guest. */
  | { type: "spectator-list"; usernames: Array<string | null>; version: number }
  | { type: "opponent-disconnected"; version: number }
  | { type: "opponent-reconnected"; version: number }
  /** Ephemeral room event; intentionally carries no room version or persisted state. */
  | { type: "emote"; seat: number; message: EmoteMessage }
  | { type: "spectator-kicked" }
  | { type: "rooms"; rooms: RoomSummary[] }
  | { type: "queue-status"; counts: Record<Format, QueuePoolCounts> }
  | { type: "queued"; format: Format }
  | { type: "queue-left" }
  | { type: "background-matchmaking"; status: BackgroundMatchmakingStatus }
  /** This player lost a matchmade prep seat by missing its deadline. */
  | { type: "match-timeout" }
  /** pre-game prep room update */
  | { type: "prep-state"; prep: PrepView; version: number }
  /** your leave-room went through; back to the lobby */
  | { type: "left" }
  | { type: "error"; code: ErrorCode; message: string };

/** Full application state after socket log reconstruction. */
export type StateMessage = Extract<ServerMessage, { type: "state" }>;

/** With drop=null, state contains the complete log. Otherwise its log arrays
 * contain only the suffix to append after dropping entries from the baseline. */
export interface StateFrame {
  type: "state-frame";
  stream: string;
  sequence: number;
  drop: number | null;
  state: StateMessage;
}

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
  | "USER_NOT_FOUND"
  | "INVALID_FRIEND_REQUEST"
  | "FRIEND_REQUEST_CONFLICT"
  | "FRIEND_REQUIRED"
  | "FRIEND_UNAVAILABLE"
  | "MESSAGE_BOUNDS"
  | "MESSAGE_RATE_LIMITED"
  | "INTERNAL_ERROR";
/** Operator-authored plain text shown to every visitor. */
export interface GlobalNotice {
  id: string;
  message: string;
  expiresAt: number | null;
}
/** Operator-authored update shown once on Home for each browser account. */
export interface VersionUpdateNotice {
  id: string;
  version: string;
  markdown: string;
  /** UTC epoch milliseconds. Null only for notices published before this field existed. */
  publishedAt: number | null;
}
