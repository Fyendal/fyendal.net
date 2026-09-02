import type {
  EquipmentSlot,
  GameStatsView,
  MeldSide,
  PendingDecision,
  Phase,
  PlayableZone,
} from "@fyendal/shared";
import type { TokenCreationContext } from "./eventTypes.js";

export interface CardInstance {
  instanceId: number;
  cardId: string;
  owner: number;
  /** Persistent public history for strategies and effects that care whether
   * this physical card has already travelled through the pitch zone. */
  pitchCount?: number;
  /** Public cards underneath this top-card. Sub-cards are not independently
   * in a zone or arena, but move with their top-card while it remains the same
   * object. The nested representation is JSON-safe and preserves ordering. */
  subcards?: CardInstance[];
  /** Face-down in arsenal (e.g. an unflipped mentor). Face-down cards are inert:
   *  their hooks don't fire and they can't be played, but their triggers can. */
  faceDown?: boolean;
  /** This face-down banished card was intimidated out of its owner's hand; it
   *  returns to hand at the beginning of the upcoming end phase. */
  intimidated?: true;
  /** Turn number whose beginning-of-end-phase returns this face-down banished
   *  card to its owner's hand (scheduled face-down banishes). */
  returnToHandAtTurn?: number;
  /** Tapped permanent ({t} costs, tap effects). Only meaningful in the arena
   *  (hero/weapons/equipment/board); persists until the card leaves play or is
   *  untapped — the turn player untaps in their end phase (APUD). */
  tapped?: boolean;
  /** -1 defense counters (Battleworn/Temper); persist until the card leaves play */
  defCounters?: number;
  /** Named counters on the card (e.g. lesson counters on a mentor); unlike
   *  player flags these persist across turns, until the card leaves play */
  counters?: Record<string, number>;
  /** Public name chosen for an active name-prohibition effect. */
  chosenName?: string;
  /** Extra zones this card may be played from, granted by an effect (e.g. a
   *  searched card banished face up with "you may play it this turn").
   *  Cleared at end of turn. */
  playableFrom?: PlayableZone[];
  /** Card whose effect granted the temporary play-from-zone permission. */
  playableFromSourceCardId?: string;
  /** When present, the play-from-zone permission belongs to this seat rather
   * than the card's owner (e.g. Nuu playing an opponent-owned banished card). */
  playableBySeat?: number;
  /** When set, the playableFrom/playCostReduction grants expire at the end of
   *  the cleanup for this turn number instead of the current one ("you may
   *  play it until the start of your next turn" — granted during its
   *  controller's end phase, survives that cleanup, expires at the next). */
  playableFromExpiry?: number;
  /** End-of-turn expiry for permissions that last through the controller's
   * next turn (as opposed to the start-of-turn duration above). */
  playableFromEndTurnExpiry?: number;
  /** Seat-relative duration boundaries, robust to extra turns. */
  playableFromUntilStartOfSeatTurn?: number;
  playableFromUntilEndOfSeatTurn?: number;
  playableFromGrantedTurn?: number;
  /** The attached play-from-zone permission expires when the currently open
   * combat chain closes (for example, Mirage defense reactions). */
  playableFromUntilChainClose?: boolean;
  /** Resource-cost discount on playing this card, granted alongside a
   *  play-from-zone permission ("it costs {r} less to play"). Cleared at end
   *  of turn. */
  playCostReduction?: number;
  /** Restricts the attached play-cost reduction to one acting seat. */
  playCostReductionSeat?: number;
  /** Classes/subtypes granted to this card for the current play by an effect
   *  ("the next card you play this turn is Draconic"): the card counts as
   *  having these tags in addition to its printed types. Persists on the card
   *  as last-known info once it leaves play. */
  grantedTypes?: string[];
  /** Red/yellow/blue color granted to this object (1/2/3). */
  grantedColor?: 1 | 2 | 3;
  /** Additional names granted to this object (Be Like Water / Mask of Many
   * Faces). Cleared when the combat chain closes or at end-of-turn cleanup. */
  grantedNames?: string[];
  /** Original hero identity and turn boundary for a temporary transformation. */
  temporaryHeroOriginalCardId?: string;
  temporaryHeroUntilTurn?: number;
  /** Hero identity presented at game start. Stable across permanent or
   * temporary transformations so effects can return to the correct age. */
  originalHeroCardId?: string;
  /** Base abilities inherited from another card for the current chain link. */
  grantedBaseAbilitiesCardId?: string;
  /** Additional base-ability sources inherited simultaneously. Entries are
   * not deduplicated because distinct objects may grant duplicate abilities. */
  grantedBaseAbilitiesCardIds?: string[];
  /** Original identity retained while this object is temporarily a copy. */
  copyOriginalCardId?: string;
  /** Keywords granted to this card until end of turn by an effect ("it gains
   *  dominate until end of turn"); consulted alongside the printed keywords
   *  for attacks (dominate, go again). Cleared at end of turn. */
  grantedKeywords?: string[];
  /** Keywords suppressed until end of turn; suppression wins over grants. */
  suppressedKeywords?: string[];
  /** Power granted to this card until end of turn by an effect ("it gets
   *  +2{p} this turn" — per-instance, unlike a +1{p} counter). Cleared at end
   *  of turn. */
  tempPower?: number;
  /** Defense granted to this card until the combat chain closes ("target
   *  card defending … gets -2{d} this combat chain" — per-instance). Cleared
   *  when the chain closes and at end of turn. */
  tempDefense?: number;
  /** An equipment temporarily functioning as an ally until cleanup. */
  temporaryAlly?: { power: number; life: number };
  /** Meld split cards: the side(s) announced when the card was played
   *  (client-side choice riding the play intent); read by the script's onPlay.
   *  Persists on the card as last-known info once it leaves play. */
  meldSide?: MeldSide;
  /** Current life of a living permanent (allies — CR 8.2.8): stamped with the
   *  card's base life when it enters the arena, reduced by damage dealt to
   *  it, reset to base during the end phase; the ally dies at 0. */
  life?: number;
  /** "Prevent the next N damage dealt to <hero> this turn by this source"
   *  (Oasis Respite): stamped on the SOURCE object — when it deals damage,
   *  deduct to a minimum of 0. A later copy of the same-named card is not
   *  covered. Cleared at end of turn. */
  damagePrevented?: { targetSeat: number; amount: number };
  /** Transcend: the card's back face is active (its data comes from
   *  CardData.backId). Once set, this persists for the remainder of the game,
   *  including when the card moves between zones (CR 9.1.5b). */
  flipped?: boolean;
  /** Card target announced for this play. It rides the object through stack
   * resolution so scripts can resolve against the declared target. */
  playTargetInstanceId?: number;
  /** Stable index of the arsenal zone holding this card. */
  arsenalSlot?: number;
  /** Card-scoped, turn-limited replacement granted by another effect. */
  temporaryGraveyardReplacement?: "banish";
  /** This non-attack action may be played as though it were an instant until
   * the current turn's cleanup. */
  playableAsInstant?: boolean;
}

export type TokenCreationReplacementKind = "global" | "friendly" | "optional-friendly";

export interface TokenCreationReplacementRef {
  instanceId: number;
  kind: TokenCreationReplacementKind;
}

export interface TokenCreationRequest {
  seat: number;
  cardId: string;
  count: number;
  cause: TokenCreationContext;
}

export interface TokenCreationReplacementBatch extends TokenCreationRequest {
  remainingReplacements: TokenCreationReplacementRef[];
  /** Controllers in the order their replacement effects must be applied. */
  controllerSeats?: number[];
}

/** A triggered ability or a played card (instant / reaction) waiting on the stack. */
export interface StackLayer {
  sourceInstanceId: number;
  /** Controller of the layer */
  seat: number;
  /** Index into the card script's triggers array (-1 for card layers) */
  triggerIndex: number;
  /** Remaining mechanically interchangeable trigger occurrences represented
   * by this layer. Each occurrence still resolves separately. */
  triggerCount?: number;
  /** At least one occurrence of this counted layer has resolved, so the
   * remaining occurrences continue without another priority round. */
  triggerBatchStarted?: true;
  /** Last-known source object captured when a script trigger was generated.
   * Triggered layers exist independently of their source after creation. */
  triggerSource?: CardInstance;
  /** Last-known event object captured for trigger effects that refer to the
   * card which caused the event (for example, Berserk's discarded card). */
  triggerEventCard?: CardInstance;
  label: string;
  optional: boolean;
  /** Space default snapshotted from the trigger definition when queued. */
  defaultOption?: "yes" | "no";
  /** Optional triggers: set once the controller accepted the trigger (the
   *  trigger itself has resolved; its effect still awaits stack resolution) */
  accepted?: boolean;
  /** Card layers (played cards — actions, instants, attack/defense reactions):
   *  the card rides the stack — it left its zone when played — and its onPlay
   *  effect runs only when the layer resolves, i.e. both players passed in
   *  succession (CR 5.3.2). Newer card layers go on top (index 0 resolves
   *  first). */
  card?: CardInstance;
  /** Instant and non-attack action card/ability layers: go again was announced
   *  when the layer was created; the action point is granted when it resolves. */
  goAgain?: boolean;
  /** Activated-ability layers (non-attack action, instant, and reaction
   * abilities): the ability rides the stack — its onActivate runs only when
   * the layer resolves. */
  ability?: boolean;
  /** Last-known source object for an activated ability. Costs can make a
   *  token cease to exist before its layer resolves, so the layer must retain
   *  enough public source data to resolve independently of the source zone. */
  abilityCard?: CardInstance;
  /** Which of the source's activated abilities this layer resolves (index into
   *  the script's activated array; absent = 0) */
  abilityIndex?: number;
  /** A reaction-timed ability has begun resolving successfully. Its source is
   *  recorded on the chain only when this layer finishes any scripted choice. */
  resolvedReactionAbility?: true;
  /** Card layers: played from hand (vs arsenal) — Dominate checks this when a
   *  defense reaction resolves into a defending card (CR 7.4.2d) */
  fromHand?: boolean;
  /** Melded split cards resolve their layer twice (right half, priority, then
   *  left half — Rules Reprise 21): stage 1 = right half resolving, stage 2 =
   *  left half; absent for non-melded cards. The layer stays on the stack
   *  between the two resolutions. */
  meldStage?: 1 | 2;
  /** Card-agnostic rules and delayed effects that need their own respondable
   *  stack layer. */
  engineEffect?:
    | { kind: "gain-action-points"; amount: number }
    | { kind: "lose-life"; amount: number }
    | { kind: "phantasm-destroy" }
    | { kind: "spectra-destroy" }
    | { kind: "watery-grave" }
    /** A wager delayed until the current chain link resolves. */
    | { kind: "wager-result"; wagerIndex: number }
    /** A hit-triggered script hook. The source is snapshotted when the hit
     * event occurs so the triggered layer remains independent if its source
     * leaves the arena before resolution. */
    | { kind: "on-hit-hook"; source: CardInstance }
    /** A non-combat effect explicitly made its source hit a hero. */
    | { kind: "on-effect-hit-hook"; source: CardInstance; targetSeat: number }
    /** An arena source observed another controlled object hit via an effect. */
    | {
        kind: "on-friendly-effect-hit-hook";
        source: CardInstance;
        hitSource: CardInstance;
        targetSeat: number;
        targetWasMarked: boolean;
      }
    /** Legacy defend-event hooks represented as proper triggered layers. */
    | { kind: "on-defend-hook"; source: CardInstance }
    | { kind: "on-friendly-defended-hook"; source: CardInstance; defendedFromHand: boolean }
    /** A defend trigger granted to the attack by a serializable modifier. */
    | { kind: "on-defended-modifier"; modifier: Modifier }
    /** One Fragment trigger generated by a qualifying defender. */
    | { kind: "fragment"; source: CardInstance }
    /** A card's "whenever this fragments" trigger, generated when Fragment resolves. */
    | { kind: "on-fragment-hook"; source: CardInstance }
    /** A script-scheduled event whose source may since have changed zones. */
    | { kind: "delayed-trigger"; source: CardInstance; hook: string }
    /** A granted on-hit effect (for example, "when this hits, draw a card").
     * Snapshotting the modifier preserves the generated effect after its
     * source or the live modifier leaves play. */
    | { kind: "on-hit-modifier"; modifier: Modifier };
}

/** What to do once the stack is empty and both players have passed. */
export type StackResume =
  | "begin-action"
  | "begin-action-phase"
  | "grant-turn-action"
  /** Both players were passing an empty stack to end the action phase. */
  | "end-action-phase"
  /** The unresolved attack-layer is waiting to enter the Attack Step. */
  | "start-attack-step"
  /** Attack-step triggers are resolving before the Defend Step begins. */
  | "continue-attack"
  | "start-reaction-step"
  | "finish-link-resolution"
  | "end-phase";

export interface PlayerState {
  seat: number;
  hero: CardInstance;
  heroCardId: string;
  life: number;
  intellect: number;
  hand: CardInstance[];
  deck: CardInstance[]; // index 0 = top
  arsenal: CardInstance[]; // max 1
  pitch: CardInstance[]; // pitched this turn, in pitch order
  graveyard: CardInstance[];
  banish: CardInstance[];
  /** The hero's soul: face-up public zone, filled by Charge effects ("put the
   *  top card of your deck into your hero's soul") and "put into your soul"
   *  moves. Cards stay until an effect banishes them. */
  soul: CardInstance[];
  /** Private cards brought to the game but not placed in a starting zone. */
  inventory?: CardInstance[];
  equipment: Partial<Record<EquipmentSlot, CardInstance>>;
  weapons: CardInstance[];
  /** Board-state cards in play: tokens/auras (e.g. Quicken), items, allies */
  board: CardInstance[];
  resources: number; // floating
  /** Floating chi points (CR 1.13.5): gained by pitching chi-subtype cards,
   *  spent before resource points; resets wherever resources resets */
  chi: number;
  actionPoints: number;
  flags: Record<string, number | boolean>;
}

export interface ChainLinkState {
  attacker: number;
  attackingCard: CardInstance;
  /** "ally": an ally on the board attacking via its tap ability; like a weapon
   *  attack it stays in play when the chain closes. */
  attackCardType: "action" | "weapon" | "ally";
  /** Cards defending from hand (actions / defense reactions) */
  defendingCards: CardInstance[];
  /** Equipment used to defend (Blade Break destroyed at resolution) */
  defendingEquipment: CardInstance[];
  /** Reaction cards played onto this link */
  reactions: CardInstance[];
  /** Last-known sources of activated attack/defense reaction abilities that
   *  resolved on this link. Display provenance only: unlike reaction cards,
   *  these objects stay in (or have already left) their normal arena zone and
   *  do not participate in combat hooks or close-chain settlement. */
  resolvedReactionAbilitySources?: CardInstance[];
  goAgain: boolean;
  damage: number;
  hit: boolean;
  /** Resolved links stay on the chain (cards on them move to the graveyard
   *  only when the combat chain closes) */
  resolved: boolean;
  /** Attack/defense snapshotted at resolution — chain-link modifiers expire
   *  with the link, so past links must not be recomputed live */
  finalAttack?: number;
  finalDefense?: number;
  /** Numeric modifier provenance snapshotted with resolved combat values. */
  finalAttackModifiers?: CombatValueModifier[];
  finalDefenseModifiers?: CombatValueModifier[];
  /** Attack-target when it is an opposing ally rather than the hero (CR
   *  8.2.8d): the controller is the defending hero, but no defending cards
   *  may be declared and no defense reactions played; damage is dealt to the
   *  ally, not the hero. Absent = the attack targets the hero. */
  targetAllyId?: number;
  /** nextInstanceId stamped at declaration: permanents created by on-declare
   *  hooks (Flock of the Feather Walkers' Quicken token) did not exist when
   *  the attack was declared, so their attack-declared triggers must not fire
   *  for it — trigger collection skips instanceIds >= this stamp. */
  declaredAtNextId?: number;
  /** Public reward description for each wager completed on this link. */
  wagerRewards?: string[];
  /** Wagers generated on this link. Their winners and prizes are resolved
   * after hit/miss is known at chain-link resolution (CR 8.5.46). */
  wagers?: PendingWager[];
  flags: Record<string, number | boolean>;
}

interface PendingWager {
  /** Last-known source of the effect that generated the wager. */
  source: CardInstance;
  controllerSeat: number;
  opposingSeat: number;
  rewardCardIds: string[];
  rewardLabel: string;
}

export interface CombatValueModifier {
  sourceInstanceId: number;
  sourceCardId: string;
  amount: number;
}

export interface Modifier {
  id: number;
  sourceInstanceId: number;
  /** Source identity snapshotted for delayed effect provenance and projection.
   * Token sources cease to exist when they leave the arena, so their instance
   * cannot always be resolved later. */
  sourceCardId?: string;
  /** Player the effect applies to. Defaults to the targeted attack's
   *  controller for an instance-targeted attack modifier, otherwise to the
   *  source card's controller. Debuffs like Debilitate set this explicitly. */
  seat: number;
  /** "combat-chain": applies to matching attacks while the combat chain is
   *  open (cleared by closeChain). "next-play": consumed by the next card the
   *  seat player plays this turn (cleared at end of turn). */
  scope: "chain-link" | "next-attack" | "until-end-of-turn" | "static" | "combat-chain" | "next-play";
  /** Keep an until-end-of-turn modifier through intervening cleanups, then
   * remove it before start-of-turn triggers on this turn number. */
  expiresAtStartOfTurn?: number;
  /** Keep this modifier until the named turn's end-phase cleanup. */
  expiresAtEndOfTurn?: number;
  /** Seat-relative duration boundaries, robust to extra turns. */
  expiresAtStartOfSeatTurn?: number;
  expiresAtEndOfSeatTurn?: number;
  createdTurn?: number;
  /** Base power stamped onto the next matching card when it is played.
   * Multiplication, division, and ordinary power adjustments apply later. */
  basePower?: number;
  attack?: number;
  /** Add this much to each matching positive power-gain event after other
   * replacements. With `once`, consume this modifier after the first event. */
  powerGainBonus?: number;
  /** Resource reduction for matching weapon/aura attack activations. */
  attackActivationCostReduction?: number;
  /** Resource reduction for matching activated abilities, including hero and
   * weapon abilities. This is distinct from play-cost reduction because an
   * effect may apply to plays only, activations only, or both. */
  activationCostReduction?: number;
  /** Resource reduction for the next matching attack, whether played as a
   * card or activated from a permanent. */
  attackCostReduction?: number;
  /** Static Piercing value granted to each matching attack. It contributes
   * power only while that attack is defended by equipment. */
  piercing?: number;
  defense?: number;
  /** Defense applies to equipment defenders rather than non-equipment cards. */
  appliesToEquipment?: boolean;
  /** A defense modifier applies only to the first matching non-equipment
   * defender committed to a link (Toughness token). */
  appliesToFirstDefenderOnly?: boolean;
  /** Replacement bonus applied when a matching action card would deal a
   * positive amount of combat or effect damage. Multiple bonuses stack. */
  damage?: number;
  /** Matching damage dealt by the affected attack cannot be prevented. */
  damageUnpreventable?: boolean;
  goAgain?: boolean;
  dominate?: boolean;
  overpower?: boolean;
  intimidate?: number;
  /** granted: matching attacks count as having this class/subtype in addition
   *  to their printed types ("your next attack is Draconic"); stamped on the
   *  chain link as a `grantedType:<tag>` flag when the attack is declared, so
   *  resolved links keep counting */
  grantType?: string;
  /** Name granted to the matching attack object when this modifier attaches. */
  grantName?: string;
  /** One-shot prevention which only applies when the original damage event is
   * no larger than the threshold (Brush Off). Oversized events leave it ready. */
  preventNextDamageAmount?: number;
  /** Remaining contribution from this source to a generic or source-filtered
   * prevention shield. Damage resolution remains authoritative on the hero
   * flag / source object; this tracks the source and remaining amount for
   * public lingering-effect projection. */
  preventNextDamagePool?: number;
  /** Repeating event prevention (Calming Breeze). */
  preventDamagePerEvent?: number;
  preventDamageEventsRemaining?: number;
  /** Optional per-event replacement: discard a matching card to prevent
   * damage and draw. The modifier remains available for later events. */
  discardDamagePreventionCardType?: string;
  discardDamagePreventionAmount?: number;
  discardDamagePreventionDraw?: number;
  /** One-shot optional prevention for a lethal damage event. Applying it
   * banishes a card with this exact printed name from hand or arsenal and
   * prevents the entire event. */
  preventLethalDamageByBanishingNamedCard?: string;
  /** Prevent the next damage event from a source with this printed pitch
   * value. The whole event is prevented and the modifier is consumed. */
  preventNextDamageFromPitch?: number;
  /** Prevent every damage event from the specifically affected source for
   * this modifier's duration. With no shielded object, this follows CR
   * 6.4.10e and applies regardless of what that source would damage. */
  preventAllDamageFromSource?: boolean;
  /** After this modifier actually prevents damage, banish the affected
   * source face-down if it has this class or subtype. */
  banishPreventedDamageSourceFaceDownIfType?: string;
  maxDamageEventAmount?: number;
  /** When this next-event prevention applies, deal the amount actually
   * prevented to this hero. */
  reflectPreventedDamageToSeat?: number;
  reflectPreventedDamageUnpreventable?: boolean;
  /** Class or subtype required on the damage source. */
  appliesToDamageSourceType?: string;
  /** Also let this next-event shield protect a controlled permanent with the
   * matching class/subtype. The same modifier is consumed if it protects the
   * controller first. */
  appliesToDamageRecipientType?: string;
  /** Replace the next damage event aimed at one hero with an event aimed at
   * another hero, then prevent part of the redirected event (Yoji). */
  redirectDamageFromSeat?: number;
  redirectDamageToSeat?: number;
  redirectDamagePrevent?: number;
  /** Keyword granted/suppressed on a matching attack at declaration. */
  grantKeyword?: string;
  suppressKeyword?: string;
  /** granted: "when this hits, it gets go again" (e.g. Warrior's Valor) */
  onHitGoAgain?: boolean;
  /** granted: "the next time you hit this turn, gain N{h}" (Solflare) — consumed
   *  on the first hit */
  onHitGainLife?: number;
  /** granted: the next time the controller hits this turn, gain resources */
  onHitGainResources?: number;
  /** granted: when the affected attack hits, create `count` copies of a token */
  onHitCreateToken?: { cardId: string; count: number };
  /** granted: draw cards when the affected attack hits its target. */
  onHitDraw?: number;
  /** A card name prohibited from being played while this modifier is live. */
  prohibitsName?: string;
  /** A named card gains this class/subtype while this modifier is live. */
  grantsTypeToName?: string;
  grantsType?: string;
  /** Owned objects of the affected seat lose the named property. */
  suppressesHeroAbilities?: boolean;
  suppressesOwnedNames?: boolean;
  suppressesOwnedClassTalentTypes?: boolean;
  /** Per-turn action-card play caps carried by this temporal effect. */
  attackActionCardCap?: number;
  nonAttackActionCardCap?: number;
  /** Restrict action card plays and action-ability activations by action kind.
   * Instants and instant abilities remain unaffected. */
  restrictActionsToWeaponOrAttack?: boolean;
  restrictActionsToNonWeaponNonAttack?: boolean;
  /** Defense reactions whose effective name occurs in the affected hero's
   * graveyard cannot be played. */
  prohibitsDefenseReactionNamesInGraveyard?: boolean;
  /** The affected attack gains go again once an attack action card defends it. */
  goAgainIfDefendedByAttackAction?: boolean;
  /** The affected attack has go again while its controller has played or
   * created a card with this subtype during the current turn. */
  goAgainIfPlayedOrCreatedSubtype?: string;
  /** The affected attack has go again while its current power meets this threshold. */
  goAgainIfAttackPowerAtLeast?: number;
  /** Granted trigger: when the affected attack is defended by one or more
   * cards, deal this much damage to the defending hero. */
  onDefendedDealDamage?: number;
  /** granted: when the affected attack hits a hero, that hero loses life */
  onHitLoseLife?: number;
  /** suppress the next matching attack-action hit's triggered effects; a miss
   * does not consume this until-end-of-turn modifier */
  suppressHitEffects?: boolean;
  /** defense adjustment to defending cards of one pitch value */
  defendingPitchDefenseAdjustment?: { pitch: number; amount: number; requiresAimCounter?: boolean };
  /** granted: draw this many cards if the affected attack is destroyed. */
  onDestroyedDraw?: number;
  /** Granted on-hit zone redirects for the affected attack action. */
  onHitToSoul?: boolean;
  onHitBottomDeck?: boolean;
  /** Re-enable the attacking permanent's once-per-turn attack ability on hit. */
  onHitReenableAttacker?: boolean;
  /** Re-enable only if the defending hero was marked when the hit occurred. */
  onHitReenableAttackerIfMarked?: boolean;
  /** Mark the defending hero when the affected attack hits that hero. */
  onHitMark?: boolean;
  /** one-shot: when this player next pays a Boost cost, that attack gets +N */
  onBoostAttack?: number;
  /** one-shot: when this player next pays a Boost cost, that attack gains dominate. */
  onBoostDominate?: boolean;
  /** Delayed trigger: the next action card with at least `minCost` printed
   *  cost grants this many action points when this layer resolves. */
  onActionPlayedGainActionPoints?: number;
  /** Delayed trigger installed on a hero: whenever that hero activates an
   * ability, create this token under their control. */
  onFriendlyActivateCreateToken?: string;
  /** Roll this many additional dice for a die-roll event and ignore the same
   * number of lowest results. */
  extraDiceIgnoreLowest?: number;
  /** When the affected attack hits a hero, schedule that hero to discard
   * their hand and destroy their arsenal at their next end phase. */
  onHitClearHandAndArsenalAtEndPhase?: boolean;
  /** The affected attack deals this much additional physical damage on hit. */
  onHitDealDamage?: number;
  /** When the affected attack deals at least `minimumDamage` combat damage to
   * a hero, destroy up to `count` cards from the top of that hero's deck. */
  onHitDestroyTopDeckCards?: { count: number; minimumDamage: number };
  /** When the affected attack hits, the granting card's script runs
   *  `onGrantedHit` with this hook key — for granted hit effects with their
   *  own choices (Shadow Puppetry's look-and-banish, Dead Eye's look-and-
   *  discard). `label` is the projected on-hit text; `heroOnly` implements
   *  "hits a hero" wording; `requiresAttackCounter` requires the attacking
   *  card to carry the named counter (Dead Eye's aim condition). */
  onHitScriptHook?: { hook: string; label: string; heroOnly?: boolean; requiresAttackCounter?: string };
  /** Replace combat damage from the affected weapon with optional destruction
   * of one defending equipment whose defense is less than that damage. */
  replaceCombatDamageWithDefendingEquipment?: boolean;
  /** For each positive damage event dealt by the affected attack, create this
   * many named tokens per point under the damaged hero's control. */
  onDamageDealtCreateTokenPerPoint?: string;
  /** granted alongside a prevention shield: "if you prevent damage this way,
   *  create token <cardId>" (Toe the Line) — consumed when the generic shield
   *  first absorbs damage */
  onPreventCreateToken?: string;
  /** attack bonus applies only while defended by fewer than N non-equipment cards (Barraging Beatdown) */
  defendedLessThanNonEquip?: number;
  appliesTo?: "any" | "attack" | "weapon" | "sword" | "attack-action";
  /** class filter (e.g. "guardian") */
  appliesToClass?: string;
  /** printed cost filters */
  minCost?: number;
  maxCost?: number;
  /** printed base-power filter ("your next attack with 3 or less base {p}") */
  maxBasePower?: number;
  /** printed base-power floor ("your next attack with 6 or more base {p}") */
  minBasePower?: number;
  /** While active, attacks with less than this base power cannot be played or
   * activated. Non-attack plays and activations are unaffected. */
  minimumAttackBasePower?: number;
  /** keyword filter for defending cards / auras (e.g. "combo") */
  appliesToKeyword?: string;
  /** subtype filter (e.g. "lightning" for "your next Lightning attack");
   *  an array matches any of the listed subtypes ("Lightning or Elemental") */
  appliesToSubtype?: string | string[];
  /** class-OR-subtype filter: matches when the card has ANY of the listed
   *  tags as a class or subtype ("the next Draconic or Ninja attack action") */
  appliesToType?: string[];
  /** card-name filter (lowercase), e.g. "the next Crouching Tiger you play" */
  appliesToName?: string;
  /** Restrict the modifier to one specific card instance. */
  appliesToInstanceId?: number;
  /** Restrict an attack modifier to attacks targeting a hero with this
   *  class/subtype; attacks targeting allies do not match. */
  appliesToTargetType?: string;
  /** Restrict an attack modifier to a hero whose name starts with this value;
   * attacks targeting allies do not match. */
  appliesToTargetNamePrefix?: string;
  /** Restrict an attack modifier to attacks targeting a currently marked hero. */
  appliesToMarkedHero?: boolean;
  /** negative subtype filter (e.g. "attack" for "'non-attack' action cards") */
  excludesSubtype?: string;
  /** card-type filter (e.g. "action" to exclude defense reactions) */
  appliesToCardType?: string;
  /** While active, the affected player may only play cards with this class or
   * subtype. Activated abilities are unaffected. */
  restrictCardPlaysToType?: string;
  /** Public summary for a lingering modifier whose rules state is otherwise
   * not self-describing in the ongoing-effects projection. */
  ongoingLabel?: string;
  /** While active, matching cards may be played from this otherwise
   * unavailable zone. This is a card-classifying permission, so it also
   * applies to matching objects that enter the zone later in the duration. */
  grantsPlayFromZone?: PlayableZone;
  /** Whole-word phrase required in one of the card's effective names for a
   * grantsPlayFromZone permission. */
  grantsPlayFromNameContains?: string;
  /** The named object's activated abilities cannot be activated. */
  suppressesActivatedAbilitiesOfInstanceId?: number;
  /** The named equipment object cannot be declared as a defender. */
  cannotDefendWithInstanceId?: number;
  /** printed pitch/color filter (1 red, 2 yellow, 3 blue) */
  appliesToPitch?: number;
  /** Reduction applied while this modifier matches a card being played. */
  playCostReduction?: number;
  /** Number of matching plays or activations this cost modifier may affect.
   * When omitted, `once` consumes it after one match and persistent modifiers
   * remain active for their full duration. */
  remainingCostUses?: number;
  /** only matches attacks declared from the arsenal ("the next attack action
   *  card you play from arsenal this turn") — reads the link's fromArsenal flag */
  appliesToFromArsenal?: boolean;
  /** Only matches an attack played through Rune Gate. */
  appliesToRuneGated?: boolean;
  /** Only matches an attack whose play paid Charge's optional additional cost. */
  appliesToCharged?: boolean;
  /** while this modifier is on the link, defense reactions can't be played
   *  from the arsenal ("this chain link") */
  noDefenseReactionsFromArsenal?: boolean;
  /** while this modifier is on the link, defense reactions can't be played
   *  from hand (Increase the Tension). */
  noDefenseReactionsFromHand?: boolean;
  /** attack can't be defended by more than N non-block cards (Confidence token) */
  maxNonBlockDefenders?: number;
  /** If defended by an attack action, put this many +1{p} counters on the
   *  attacking permanent when the link resolves. */
  onDefendedByAttackActionPowerCounters?: number;
  /** remove after it is first applied to a defending card */
  once?: boolean;
  /** A pending next-attack modifier with this marker expires unused when the
   *  current combat chain closes. */
  expiresOnChainClose?: boolean;
  /** internal: marked for removal after a once-modifier has applied */
  consumed?: boolean;
}

/** Arcane damage awaiting an Arcane Barrier decision (chooseHook
 *  "arcane-barrier": pick a payable total; "arcane-barrier-pitch": pitch
 *  cards to cover the chosen total). */
export interface PendingArcane {
  sourceInstanceId: number;
  /** Controller of the damage source when the effect was generated. */
  sourceSeat: number;
  /** Last-known source identity for CR 8.2.8e attribution after an ally source
   * leaves the arena before its damage is applied. False/absent = non-ally. */
  sourceIsAlly?: boolean;
  /** Last-known source identity for the explicit Runechant skip shortcut. */
  sourceIsRunechant?: true;
  targetSeat: number;
  /** damage before barrier prevention */
  amount: number;
  /** arcane damage packets offer an Arcane Barrier decision */
  arcane: boolean;
  /** Damage dealt by this packet makes its source count as having hit. */
  countsAsHit?: boolean;
  /** Finish the effect by destroying its source after this damage event is
   * applied, including when prevention reduces the damage to 0. */
  destroySourceAfterDamage?: true;
  /** Snapshot before an effect hit removes the target's marked condition. */
  targetWasMarked?: boolean;
  /** Ally target (CR 8.2.8): effect damage dealt to an ally permanent instead
   *  of a hero — no prevention shields, no Ward, no Arcane Barrier/Spellvoid,
   *  and its controller is not considered to have been dealt damage. */
  targetAllyId?: number;
  /** combat damage packets (Ward paused the chain-link resolution): when the
   *  prevention decisions finish, the link resolution resumes with the
   *  remaining amount */
  combat?: boolean;
  /** Defending equipment eligible for a source-side replacement of this
   * combat-damage event. Offered before redirection and prevention. */
  combatDamageEquipmentReplacementIds?: number[];
  /** Damage whose prevention is prohibited skips Quell, Ward, and shields. */
  unpreventable?: boolean;
  /** chosen payment total (set once the pitch phase begins) */
  payTotal?: number;
  /** This event's Arcane Barrier step has been resolved. Arcane Barrier is
   * evaluated before Ward; choosing pay 0 or having no payable option closes
   * it for the rest of the original damage event. */
  arcaneBarrierResolved?: true;
  /** Quell sources already paid for during this damage event. */
  usedQuellSourceIds?: number[];
  /** Discard-prevention modifiers already applied during this damage event. */
  usedDiscardDamagePreventionModifierIds?: number[];
  /** Soul-banish prevention sources already applied to this original event. */
  usedSoulDamagePreventionSourceIds?: number[];
  /** Source currently awaiting its controller's soul-card selection. */
  soulDamagePreventionSourceInstanceId?: number;
  /** Turn-scoped modifier currently awaiting its controller's named-card
   * selection for a lethal-damage prevention replacement. */
  lethalDamagePreventionModifierId?: number;
  /** Quell source selected while its resource payment is being completed. */
  quellSourceInstanceId?: number;
  /** further packets queued behind this one (several sources can deal arcane
   *  damage in a single hook sweep; choices resolve one at a time) */
  queue?: PendingArcane[];
}

export interface PendingDecisionState extends PendingDecision {
  /** Card instance whose script owns a "choose-target"/"optional-effect" decision */
  sourceInstanceId?: number;
  /** Hook key routed back to the owning script's choice callback. */
  chooseHook?: string;
  /** Ordered decisions deferred while an entering permanent's Crank choice
   * is being answered. Internal only; projection exposes the current choice. */
  followUpDecisions?: PendingDecisionState[];
  /** Token-effect provenance inherited when one card delegates a scripted
   * choice to another card, such as Edict of Steel using Reverent Rerebrace. */
  tokenCreationCause?: TokenCreationContext;
  /** Parallel to options: a live card instance id or registered card id to
   *  render for that option, null for literal string options. */
  cardOptions?: (number | string | null)[];
  /** Cards a look-at effect floats for the deciding player (chooseHook
   *  "engine-look"), or the surviving look context carried into a follow-up
   *  scripted choice. Rendered as non-interactive card images; projected only
   *  to the deciding player. */
  lookedCardIds?: number[];
  /** Complete public card group presented alongside a narrower card choice. */
  revealedCardIds?: number[];
  /** Scripted mid-resolution resource payment. Option ids map to the hand
   *  cards pitched for that payment; "no" declines. */
  payment?: {
    pitchOptions: Record<string, { cost: number; pitchIds: number[]; result: string }>;
  };
  /** First stage of a variable-cost payment: option id → declared result and
   *  the resource cost that declaration creates. */
  xPayment?: {
    choices: Record<string, { cost: number; result: string }>;
  };
  /** Engine-owned two-stage declaration/payment for a printed variable card
   * cost. The card remains in its source zone until payment is selected. */
  variablePlayCost?: {
    mode: "action" | "reaction" | "window";
    seat: number;
    instanceId: number;
    from: "hand" | "arsenal" | PlayableZone;
    choices?: Record<string, { x: number; cost: number }>;
    declaredX?: number;
    paymentOptions?: Record<string, { pitchInstanceIds: number[] }>;
    meldSide?: MeldSide;
    targetAllyId?: number;
    targetCardInstanceId?: number;
    boost?: boolean;
    boostCount?: number;
    asInstant?: boolean;
    alternativeCostCardInstanceIds?: number[];
  };
  /** Engine-owned declaration/payment flow for a variable activated ability. */
  variableActivationCost?: {
    mode: "action" | "window";
    seat: number;
    sourceInstanceId: number;
    abilityIndex: number;
    choices?: Record<string, { x: number; cost: number }>;
    declaredX?: number;
    paymentOptions?: Record<string, { pitchInstanceIds: number[] }>;
  };
  /** A token batch paused on an optional replacement decision. */
  tokenCreationReplacement?: TokenCreationReplacementBatch;
  /** A token batch with two or more applicable replacement effects. */
  tokenCreationReplacementOrder?: TokenCreationReplacementBatch;
  /** Active wager-loss replacements awaiting their controller's ordering. */
  wagerLossReplacementOrder?: {
    wagerIndex: number;
    remainingSourceInstanceIds: number[];
  };
  /** Pre-activation soul-cost choice. Costs have not been paid and no ability
   *  layer exists until this decision is answered. */
  activationCost?: {
    mode: "action" | "window";
    seat: number;
    sourceInstanceId: number;
    abilityIndex: number;
    pitchInstanceIds: number[];
    targetAllyId?: number;
    /** Cards already selected for the ability's banish-from-soul cost. */
    soulInstanceIds?: number[];
    /** Cards already selected for the ability's discard effect-cost. */
    discardInstanceIds?: number[];
    declaredVariableX?: number;
    /** Cards already selected for ordered effect-card cost groups. Presence
     * marks an engine-owned effect-cost choice rather than a soul choice. */
    effectCostInstanceIds?: number[];
    /** Exact cards announced for an alternative activated-ability cost. */
    alternativeCostCardInstanceIds?: number[];
  };
  /** Engine-owned clash procedure paused for a failed-clash replacement. */
  clash?: {
    request: {
      sourceSeat: number;
      sourceInstanceId: number;
      opposingSeat: number;
      resultHook: string;
    };
    attempt: {
      winner: number;
      revealed: { seat: number; instanceId: number }[];
    };
    replacementSeats: number[];
    replacementIndex: number;
    stage: "offer" | "bottom" | "winner-choice";
    chosenReplacementSeat?: number;
    queue: {
      sourceSeat: number;
      sourceInstanceId: number;
      opposingSeat: number;
      resultHook: string;
    }[];
  };
  /** Arcane Barrier payment state (chooseHook "arcane-barrier*") */
  arcane?: PendingArcane;
  /** Simultaneous-trigger ordering (chooseHook "trigger-order"): the deciding
   *  player arranges their queued trigger layers in resolution order, then the
   *  other seat's `later` groups are placed. */
  triggerOrder?: {
    remaining: StackLayer[];
    later: { seat: number; layers: StackLayer[] }[];
    /** Existing lower stack retained while newly pending triggers are ordered. */
    baseStack?: StackLayer[];
  };
  /** Engine-owned private ordering decision (chooseHook
   *  "engine-deck-bottom-order"). Cards remain in their original zones until
   *  all but the implicit final position have been chosen. */
  deckBottomOrder?: {
    ordered: number[];
    remaining: number[];
  };
  dieRoll?: {
    rollingSourceInstanceId: number;
    rollingSeat: number;
    hook: string;
    sides: number;
    result: number;
    extraDiceIgnoreLowest?: number;
    replacementInstanceId: number;
  };
  /** Defend decisions: the defender's staged (uncommitted) defender instance
   *  ids. Cosmetic — the cards stay in their zones until the defend intent
   *  commits them; projected to the opponent with hand cards hidden. */
  staged?: number[];
  /** What to do after the decision is answered */
  resume?:
    | { kind: "stack-card"; seat: number; card: CardInstance }
    | { kind: "finish-play"; seat: number; card: CardInstance; from: "hand" | "arsenal" | PlayableZone; targetAllyId?: number; boost?: boolean; boostCount?: number; asInstant?: boolean }
  | { kind: "finish-reaction"; seat: number; card: CardInstance; from: "hand" | "arsenal" | PlayableZone }
  | { kind: "finish-window-instant"; seat: number; card: CardInstance; from: "hand" | "arsenal" | PlayableZone }
    | { kind: "after-declare" }
    | { kind: "start-reaction-step" }
    | { kind: "after-resolution" }
    | { kind: "continue-stack"; seat?: number }
    | { kind: "finish-wager-result"; wagerIndex: number }
    | { kind: "continue-wager-loss-replacements"; wagerIndex: number; remainingSourceInstanceIds: number[] }
    | { kind: "continue-wager-prizes"; wagerIndex: number }
    | { kind: "reopen-reaction"; seat: number }
    | { kind: "game-setup"; nextSeat: number };
}

export interface GameState {
  seed: number;
  rngState: number;
  nextInstanceId: number;
  nextModifierId: number;
  /** Rule-defined global objects selected by the game format. */
  globalCardIds: string[];
  turn: number;
  activePlayer: number;
  priorityPlayer: number;
  phase: Phase;
  players: [PlayerState, PlayerState];
  chain: ChainLinkState[];
  /** Cards whose resolution is paused on a pending scripted choice */
  resolving: CardInstance[];
  pendingDecision: PendingDecisionState | null;
  /** Token events emitted after an earlier command suspended on a decision.
   * They resume in generation order before the suspended flow continues. */
  pendingTokenCreations: TokenCreationRequest[];
  /** consecutive passes during the reaction step */
  reactionPasses: number;
  /** Triggered abilities and played cards awaiting resolution (index 0 resolves first) */
  stack: StackLayer[];
  /** Triggered layers created during a cost or resolving effect. A game-state
   *  process moves these onto the stack before the next player gets priority. */
  pendingTriggeredLayers?: StackLayer[];
  /** consecutive passes in the current layer/priority window */
  stackPasses: number;
  /** continuation to run when the stack is empty and both players passed */
  stackResume: StackResume | null;
  modifiers: Modifier[];
  /** Script-created future event triggers, persisted independently of source zones. */
  delayedTriggers: DelayedTrigger[];
  /** Permanents scheduled to be destroyed at the beginning of the upcoming end
   *  phase (e.g. Scuttle Toes' "destroy it at the beginning of the end phase") */
  pendingDestructions: { seat: number; instanceId: number }[];
  /** Stolen permanents to return when the action phase ends ("steal it until
   *  the end of this action phase"): the card sits on `thiefSeat`'s board and
   *  goes back to `homeSeat`'s at the beginning of the end phase. */
  controlReturns: { instanceId: number; thiefSeat: number; homeSeat: number }[];
  /** Seats scheduled to take extra turns, in creation order. */
  extraTurnSeats: number[];
  gameStats: GameStatsView;
  log: GameLogEntry[];
  winner: number | null;
}

/** One audience-aware game log event. A seated viewer receives their seat
 * override when non-null; otherwise the public text. Spectators receive only
 * public text. Null text suppresses the event for that audience. */
export interface GameLogEntry {
  publicText: string | null;
  seatText?: [string | null, string | null];
}

/** A script-created trigger waiting for a future game event. The source is
 * snapshotted when scheduled so the effect survives source-zone movement. */
interface DelayedTrigger {
  source: CardInstance;
  seat: number;
  subjectSeat: number;
  event: "end-of-turn";
  turn: number;
  hook: string;
  label: string;
}
