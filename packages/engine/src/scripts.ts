import type { CardData, CardType, EquipmentSlot, PlayableZone } from "@fyendal/shared";
import type {
  CardInstance,
  ChainLinkState,
  GameLogEntry,
  GameState,
  Modifier,
  PlayerState,
  StackLayer,
} from "./state.js";
import type { TokenCreationContext, TriggerEvent, TriggerEventContext } from "./eventTypes.js";
export type { TokenCreationContext, TriggerEvent, TriggerEventContext } from "./eventTypes.js";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/** Helpers handed to card scripts. `state` is the engine's working copy — scripts mutate via these helpers. */
export interface ScriptCtx {
  /** Read-only rules observation. Mutations must use commands below. */
  readonly state: DeepReadonly<GameState>;
  /** Controller of the card the script belongs to */
  seat: number;
  /** The card instance the script belongs to */
  self: DeepReadonly<CardInstance>;
  /** Static data of self */
  data: DeepReadonly<CardData>;
  /** Current chain link, when relevant */
  link?: DeepReadonly<ChainLinkState>;
  /** Whether this card was played from arsenal (for stack-card layers / direct plays). */
  fromArsenal?: boolean;
  /** The current leave-arena hook was generated while this object paid its
   * own activated-ability movement cost. */
  leavingArenaAsActivationCost?: boolean;
  /** Card target announced when this object was played, if its script declares
   * card-target options. */
  playTargetInstanceId?: number;
  /** Add a modifier sourced by this card. If `appliesToInstanceId` names an
   *  attack on the combat chain and `seat` is omitted, the modifier applies
   *  to that attack's controller. */
  addModifier(
    m: Omit<Modifier, "id" | "sourceInstanceId" | "sourceCardId" | "seat"> & { seat?: number },
    source?: DeepReadonly<CardInstance>,
  ): void;
  /** Read one player's state. The result is deeply readonly. */
  player(targetSeat: number): DeepReadonly<PlayerState>;
  /** Add or spend floating resources/chi or action points through bounded commands. */
  changeResources(targetSeat: number, delta: number): void;
  changeChi(targetSeat: number, delta: number): void;
  changeActionPoints(targetSeat: number, delta: number): void;
  /** Permit a permanent's once-per-turn ability to be activated `count`
   * additional times this turn. */
  grantAdditionalActivation(instanceId: number, count?: number): void;
  /** Set the shared total activation limit of a permanent's attack abilities
   * for this turn. Repeated effects setting the same limit are not additive. */
  setAttackActivationLimit(instanceId: number, limit: number): void;
  /** Permit non-attack activated abilities of permanents with this class or
   * subtype to be activated as though they were instants this turn. */
  allowAbilitiesAsInstant(type: string): void;
  getPlayerFlag(targetSeat: number, key: string): number | boolean;
  setPlayerFlag(targetSeat: number, key: string, value: number | boolean): void;
  /** Until end of turn, grant every instant card owned by this player an
   * instant ability to discard itself and prevent the next `amount` damage. */
  grantOwnedInstantDiscardPrevention(amount: number): void;
  /** Treat the target hero's text box as empty through the end of that hero's
   * next turn. The seat-bound duration survives intervening extra turns. */
  suppressHeroAbilitiesThroughNextTurn(targetSeat: number): void;
  /** Permanently treat a hero's text box as empty. */
  suppressHeroAbilitiesPermanently(targetSeat: number): void;
  /** End the game with the opposing hero as winner. */
  loseGame(targetSeat: number): void;
  /** Schedule the chosen seat to take an extra turn after the current turn. */
  takeExtraTurn(targetSeat: number): void;
  /** During the target hero's next turn, treat every card that hero owns as
   * having no abilities, regardless of its zone or current controller. */
  suppressOwnedCardAbilitiesNextTurn(targetSeat: number): void;
  /** Seeded randomness and deterministic deck mutation. */
  randomInt(maxExclusive: number): number;
  /** Roll a seeded die and record the result for "if you have rolled N this turn" effects. */
  rollDie(sides?: number): number;
  /** Roll a die and deliver its final result through onDieRollResolved. This
   * pauses for any active optional die-roll replacement. */
  requestDieRoll(hook: string, sides?: number): void;
  /** Reveal a public group from any zone and notify reveal observers once for
   * the event. The cards do not move. Returns false when reveals are
   * prohibited or no requested card exists. */
  revealCards(instanceIds: number[], revealingSeat?: number): boolean;
  /** Whether a deck-search effect is currently permitted. */
  canSearchDeck(targetSeat?: number): boolean;
  shuffleDeck(targetSeat?: number): void;
  /** Narrow zone/permanent commands used by card implementations. */
  /** Destroy an arena permanent. `destroyingSeat` attributes effects that
   * instruct a different hero to perform the destruction. */
  destroyPermanent(instanceId: number, destroyingSeat?: number): boolean;
  /** Pay Usurp's mandatory-if-able additional cost by destroying a controlled
   * Runechant and applying that Runechant's usurped effect to the named attack. */
  usurpRunechant(instanceId: number, attackingInstanceId: number): boolean;
  /** Destroy the current attacking card. Action cards leave the chain;
   * permanent attack sources leave the arena. */
  destroyAttackingCard(): boolean;
  /** Destroy a card currently defending on the combat chain. Equipment is
   * destroyed as an arena permanent; non-equipment defenders leave the chain. */
  destroyDefendingCard(instanceId: number): boolean;
  /** Destroy the top public sub-card retained under an arena permanent. */
  destroySubcard(instanceId: number): boolean;
  /** Banish the top public sub-card retained under an arena permanent. */
  banishSubcard(instanceId: number, subcardInstanceId?: number): boolean;
  /** Move this resolving card from the stack under a permanent controlled by
   * this hero. The card becomes a public sub-card and won't enter its default
   * post-resolution zone. */
  putSelfUnder(instanceId: number): boolean;
  /** Public shared objects supplied by the current rules configuration. */
  globalCards(): readonly DeepReadonly<CardInstance>[];
  /** Remove a declared public shared object from the game. */
  destroyGlobal(instanceId: number): boolean;
  moveToGraveyard(instanceId: number, from?: string): boolean;
  moveToHand(instanceId: number): boolean;
  /** Move one card retained in this hero's private inventory into their hand. */
  moveInventoryToHand(instanceId: number): boolean;
  pitchCard(instanceId: number): boolean;
  settleCard(instanceId: number, opts?: { allowCrank?: boolean; controllerSeat?: number }): boolean;
  setCardFaceDown(instanceId: number, faceDown: boolean): boolean;
  addCardTempPower(instanceId: number, delta: number): boolean;
  /** Grant an additional name to a card object for subsequent name checks. */
  grantCardName(instanceId: number, name: string): boolean;
  /** Store a public name chosen for this source's continuous effect. */
  setChosenName(name: string): void;
  /** Grant an additional class or subtype to a card object. */
  grantCardType(instanceId: number, type: string): boolean;
  /** Remove one previously granted class or subtype from a card object. */
  removeCardType(instanceId: number, type: string): boolean;
  /** Set a card object's effective red/yellow/blue color. */
  setCardColor(instanceId: number, color: 1 | 2 | 3): boolean;
  /** Give an attack another card's base abilities for the current chain link. */
  grantBaseAbilities(instanceId: number, sourceCardId: string): boolean;
  /** Make an active attack a copy of another card until it leaves the chain. */
  becomeCardCopy(instanceId: number, sourceCardId: string): boolean;
  /** Remove an unresolved card layer from the priority stack and put that
   * card into its owner's graveyard without resolving it. */
  negateStackCard(instanceId: number): boolean;
  addCardTempDefense(instanceId: number, delta: number): boolean;
  /** Set a defending card's base defense for the active chain link. */
  setCardBaseDefenseForLink(instanceId: number, defense: number): boolean;
  addCardDefenseCounters(instanceId: number, delta: number): boolean;
  grantCardKeyword(instanceId: number, keyword: string): boolean;
  /** Suppress a keyword until end of turn. Suppression wins over later grants. */
  suppressCardKeyword(instanceId: number, keyword: string): boolean;
  /** The active attack loses and cannot gain abilities for this chain link. */
  suppressAttackAbilities(): boolean;
  consumeModifier(modifierId: number): boolean;
  /** Effective power queries that require engine staging internals. */
  basePower(card: number | DeepReadonly<CardInstance>): number;
  /** Current power while a card is defending, including temporary and
   * opposing continuous modifiers. */
  currentPower(card: number | DeepReadonly<CardInstance>): number;
  /** Full current power of the active attack, including base changes,
   * counters, continuous modifiers, and opposing effects. */
  currentAttackPower(): number;
  /** Whether the active attack currently has dominate from any rules source. */
  currentAttackHasDominate(): boolean;
  /** Whether the active attack currently has overpower from any rules source. */
  currentAttackHasOverpower(): boolean;
  /** The largest unresolved damage event currently aimed at a hero, from an
   * attack or a source on the priority stack. The amount is evaluated before
   * prevention. */
  incomingDamage(targetSeat: number):
    | { readonly sourceInstanceId: number; readonly amount: number }
    | undefined;
  /** Preview a positive arcane effect-damage event after source-side bonuses
   *  (including a bonus bound to the source card and Amp), but before target
   *  replacement/prevention. This observation does not consume anything. */
  previewArcaneDamage(n: number, opts?: { sourceInstanceId?: number }): number;
  attackBonusAboveBase(excludeSourceId?: number): number;
  chainLinksControlled(targetSeat?: number, type?: string): number;
  currentAttackHasType(type: string): boolean;
  hitsThisCombatChain(targetSeat?: number): number;
  currentChainLinkNumber(): number;
  /** Deal effect damage to a hero. Arcane damage offers the target's active
   *  Arcane Barrier permanents and any active prevention shield; both damage
   *  types respect prevention shields.
   *  With `targetAllyId` the damage is dealt to that ally permanent instead
   *  (CR 8.2.8): it reduces the ally's life and destroys it at 0 — no
   *  prevention shields, Ward, Arcane Barrier or Spellvoid apply to allies,
   *  and the ally's controller is not considered to have been dealt damage.
   *  A non-ally source's controller still counts as having dealt the damage.
   *  `targetSeat` is ignored. `sourceInstanceId` makes another object
   *  the damage's source instead of this card ("target dagger … deals 1
   *  damage").
   *  Returns the damage actually dealt (after prevention; 0 if the ally is gone). */
  dealDamage(targetSeat: number, n: number, opts?: {
    arcane?: boolean;
    /** This damage event cannot be prevented. */
    unpreventable?: boolean;
    targetAllyId?: number;
    sourceInstanceId?: number;
    /** If damage is dealt to a hero, the source counts as having hit. */
    countsAsHit?: boolean;
    /** Destroy the damage source after the event finishes resolving. */
    destroySourceAfterDamage?: boolean;
  }): number;
  gainLife(targetSeat: number, n: number): void;
  /** Lose life without creating a damage event. */
  loseLife(targetSeat: number, n: number): void;
  /** Grant the controller 1 action point (go again on a resolving layer).
   *  Fails for the non-turn player (CR 8.5.7b). */
  gainActionPoint(): void;
  drawCards(targetSeat: number, n: number): void;
  /** Seeded random discard from hand; returns the discarded cards */
  discardRandom(targetSeat: number, n: number): DeepReadonly<CardInstance>[];
  /** Banish one seeded-random hand card face down until the beginning of the
   *  target hero's end phase on `returnTurn` (marked `returnToHandAtTurn`). */
  banishRandomFromHandUntilEndPhase(
    targetSeat: number,
    returnTurn: number,
  ): DeepReadonly<CardInstance> | undefined;
  /** Discard a specific hand card (by instance id); returns it if found */
  discardCard(targetSeat: number, instanceId: number): DeepReadonly<CardInstance> | undefined;
  /** Intimidate a hero. Defaults to the opposing hero once. */
  intimidate(targetSeat?: number, count?: number): void;
  /** Give the current attack, or a specified attack still on the combat
   * chain, go again. Granting it to an already-resolved link does not resolve
   * that link again or retroactively grant an action point. */
  grantGoAgain(targetAttackInstanceId?: number): void;
  /** The crowd boos a hero: sets their `booedThisTurn` flag and fires their
   *  hero's onBooed hook. Has no other material effect on its own (SUP notes). */
  crowdBoo(targetSeat: number): void;
  /** The crowd cheers a hero: sets their `cheeredThisTurn` flag and fires
   *  their hero's onCheered hook. */
  crowdCheer(targetSeat: number): void;
  /** Clash with another hero (8.5.45). The result is delivered to this
   *  script's `onClashResult` hook, allowing replacement decisions to pause
   *  and resume the procedure without resolving the originating effect early. */
  requestClash(withSeat: number, resultHook: string): void;
  /** Wager with another hero on the current attack (CR 8.5.46). This marks
   *  the attack as having wagered immediately; its hit/miss result determines
   *  the winner and awards the listed reward tokens when the link resolves.
   *  Non-token rewards supply their public tooltip description explicitly. */
  wager(withSeat: number, rewardCardIds: readonly string[], rewardLabel?: string): void;
  /** Compare two heroes' life: 1 = a has more, -1 = a has less, 0 = tied.
   *  Tiebreak permanents (lifeTiebreak script marker) make ties count as
   *  more/less for their controller. */
  compareLife(aSeat: number, bSeat: number): number;
  /** Tap a permanent in the arena by instance id (effect — not a cost). Returns
   *  false (effect fails) when the target isn't an in-arena permanent or is
   *  already tapped. */
  tap(instanceId: number): boolean;
  /** Untap a permanent in the arena by instance id. Returns false (effect
   *  fails) when the target isn't an in-arena permanent or isn't tapped. */
  untap(instanceId: number): boolean;
  /** Schedule an in-arena permanent to be destroyed at the beginning of the
   *  upcoming end phase (e.g. Scuttle Toes). Returns false when the target
   *  isn't an in-arena permanent. */
  destroyAtEndPhase(instanceId: number): boolean;
  /** Schedule one of this script's delayed hooks for the current turn's end
   * phase. The source is snapshotted, so moving it later does not cancel it. */
  scheduleEndOfTurnTrigger(hook: string, label: string, subjectSeat?: number): void;
  /** Let the controller privately look at a card (e.g. the top of their deck)
   *  — its identity is logged to the controller only. */
  lookAt(instanceId: number): void;
  /** Let a specified hero privately look at a card. */
  lookAtForSeat(instanceId: number, lookingSeat: number): void;
  /** Gain control of an opposing board permanent (ally/item/aura/token).
   *  The default duration is the current action phase; `indefinite` persists
   *  until the permanent leaves play or another effect changes control. */
  steal(instanceId: number, opts?: { duration?: "action-phase" | "indefinite" }): boolean;
  /** Give control of a board permanent this hero controls to another hero.
   * Ownership does not change. The control change persists until the object
   * leaves play or another effect changes control. */
  giveControl(instanceId: number, targetSeat: number): boolean;
  /** Until the end of this hero's next turn, prevent `targetSeat` from playing
   * face-up arsenal cards and let this card's controller play them instead. */
  annexFaceUpArsenalThroughNextTurn(targetSeat: number): void;
  /** Announce that a controlled trap's trigger condition was satisfied while
   *  its resolving layer is still on the stack. Matching triggered abilities
   *  are appended behind that layer and receive an ordinary priority window. */
  notifyTrapTriggered(): void;
  /** Turn a face-down card (e.g. a mentor in arsenal) face up */
  flipFaceUp(): void;
  /** Transcend (MST): put self into its owner's hand flipped, with its back
   *  face active for the remainder of the game, and set the owner's per-turn
   *  `transcendedThisTurn` flag. The card leaves the stack-resolution flow
   *  (returnSelfToHand precedent — it does NOT also go to the graveyard).
   *  No-op when self is nowhere movable. */
  transcend(): void;
  /** Destroy self (permanent or face-up attack); moves to graveyard and fires onDestroyed. */
  destroySelf(): void;
  /** Charge the controller's hero's soul: move the chosen card from their hand
   *  into the soul zone, set the per-turn charge flags (`chargedThisTurn`,
   *  `chargedPitch:<n>`), and fire the charged card's onCharged hook (Solflare).
   *  Returns the charged card, or undefined when it is not in hand. */
  charge(instanceId: number): DeepReadonly<CardInstance> | undefined;
  /** Move a card from any of its owner's zones into its owner's soul (face up).
   *  Sets the per-turn "put into soul" flags (`soulThisTurn`, `soulPitch:<n>`)
   *  but does NOT fire onCharged — only charging does. */
  putIntoSoul(instanceId: number): boolean;
  /** Equip an equippable card from its owner's graveyard into a free matching
   * zone. Used by Retrieve and graveyard-equipping effects. */
  equipFromGraveyard(instanceId: number): boolean;
  /** Equip an equippable card from this hero's banished zone into a free slot. */
  equipFromBanish(instanceId: number): boolean;
  /** Equip a card retained in this player's private presented inventory. */
  equipFromInventory(instanceId: number): boolean;
  /** Move an opposing equipped equipment card into this hero's matching empty
   * equipment zone. The card keeps its owner while changing controller. */
  equipOpposingEquipment(instanceId: number): boolean;
  /** Move a controlled equipment object from its current equipment slot to a
   * different empty slot. The object does not leave the arena. */
  moveEquipmentToZone(instanceId: number, slot: EquipmentSlot): boolean;
  /** Banish a card from any of its owner's zones (hand/soul/equipment/board/…).
   *  `faceDown` overrides the card's face state in the banished zone; omit it
   *  to keep the state the card already had. */
  banish(instanceId: number, opts?: { faceDown?: boolean }): boolean;
  /** Mark every card currently defending on the open combat chain to be
   *  banished by the ordinary chain-close settlement flow. */
  banishAllDefendingCardsOnChainClose(): void;
  /** Return self from the graveyard / chain / resolving list to its owner's
   *  hand (Roaring Beam). Returns false when self is nowhere movable. */
  returnSelfToHand(): boolean;
  /** Add `delta` to a named counter on any card (e.g. +1{p} counters put on
   *  weapons by Sharpen/Glisten). Negative deltas remove. */
  addCounter(instanceId: number, key: string, delta: number): void;
  /** Set a named counter on any card exactly. Unlike addCounter, zero remains
   *  explicit so state-based "when this has no counters" checks can observe it. */
  setCardCounter(instanceId: number, key: string, value: number): void;
  /** Set the current life of a living permanent, bounded at zero. */
  setPermanentLife(instanceId: number, value: number): boolean;
  /** Make a hero's first attack during their next turn cost additional
   *  resources. Multiple delayed effects for that turn stack. */
  increaseFirstAttackCostNextTurn(targetSeat: number, amount: number): void;
  /** Prevent the target hero from creating aura tokens during their next turn. */
  preventAuraTokenCreationNextTurn(targetSeat: number): void;
  /** Create a token/aura; returns the created instance, or undefined when a
   *  replacement effect prevents its creation. Defaults to the
   *  controller's board — pass `seat` to create it for another player
   *  (e.g. Test of Strength's clash winner). */
  createToken(cardId: string, seat?: number): DeepReadonly<CardInstance> | undefined;
  /** Create a token copy of a public arena object, preserving its copiable
   * granted characteristics but not counters or temporary modifiers. */
  createTokenCopy(instanceId: number): DeepReadonly<CardInstance> | undefined;
  /** Create one token batch. Replacement effects that change "one or more"
   * token creation events observe the batch once, before any token enters. */
  createTokens(cardId: string, count: number, seat?: number): DeepReadonly<CardInstance>[];
  /** Create a new card object directly in a player's hand. The created card's
   * identity is public because the generating effect names it. */
  createCardInHand(cardId: string, seat?: number): DeepReadonly<CardInstance>;
  /** Create a new public card object directly in a player's banished zone. */
  createCardInBanish(cardId: string, seat?: number): DeepReadonly<CardInstance>;
  /** Transform one or more arena objects into a permanent. With
   * `existingPermanentInstanceId`, that permanent changes to `cardId`; without
   * it, a new token permanent is created. Every transformed object becomes a
   * public sub-card atomically, or the effect fails without moving anything. */
  transformInto(
    cardId: string,
    transformedInstanceIds: number[],
    existingPermanentInstanceId?: number,
  ): DeepReadonly<CardInstance> | undefined;
  /** Turn an equipped object into an ally with the supplied base properties
   * until end of turn. */
  becomeAllyUntilEndOfTurn(instanceId: number, power: number, life: number): boolean;
  /** Look up static data for any card id */
  cardData(cardId: string): CardData;
  /** Whether this object currently has a card-type keyword. Melded split cards
   *  have the card types of both declared sides. */
  hasCardType(card: DeepReadonly<CardInstance>, cardType: CardType): boolean;
  /** Effective classes and subtypes, including all-zone and granted types. */
  cardTypes(card: DeepReadonly<CardInstance>): readonly string[];
  /** Count equipped cards with this effective class/subtype, including active
   * sources that explicitly count as additional equipped objects of that type. */
  countEquipped(type: string, targetSeat?: number): number;
  /** Effective names, including grants and temporary name suppression. */
  cardNames(card: DeepReadonly<CardInstance>): readonly string[];
  /** Find registered printings with the given card name. */
  cardIdsNamed(name: string): readonly string[];
  /** Effective red/yellow/blue color of a card (1/2/3), or 0 when it has no
   * color. Color is independent from the card's pitch value. */
  cardColor(card: DeepReadonly<CardInstance>): number;
  /** Whether this card has an X value for its printed play cost. */
  hasVariablePlayCost(card: DeepReadonly<CardInstance>): boolean;
  getFlag(scope: "player" | "link", key: string): number | boolean;
  setFlag(scope: "player" | "link", key: string, value: number | boolean): void;
  /** Whether this source's public once-per-turn triggered effect has already
   * been consumed this turn. */
  oncePerTurnEffectUsed(): boolean;
  /** Mark this source's public once-per-turn triggered effect as consumed. */
  markOncePerTurnEffectUsed(): void;
  /** Read a persistent named counter on self (survives end-of-turn cleanup) */
  getCounter(key: string): number;
  /** Set a persistent named counter on self */
  setCounter(key: string, n: number): void;
  /** Queue a scripted choice; resolved by a "choose" intent routed back to onChoose with the same hook key.
   *  `cardOptions` (parallel to `options`) tags the live card instance or
   *  registered card definition each option refers to so clients can render
   *  card images; projected only to the deciding player. */
  requestChoice(
    hook: string,
    prompt: string,
    options: string[],
    seat?: number,
    cardOptions?: (number | string | null)[],
    /** Option selected by Space in the client; must be present in `options`. */
    defaultOption?: string,
  ): void;
  /** Like requestChoice, but number options denote card instances — they are
   *  projected to clients as resolved card views (string options stay literal).
   *  onChoose still receives the option as a string (String(instanceId)). */
  requestCardChoice(
    hook: string,
    prompt: string,
    options: (number | string)[],
    seat?: number,
    /** Complete public reveal group when only a subset is selectable. */
    revealedCardIds?: number[],
    /** Additional cards shown privately to the deciding player as
     * non-selectable context, such as every card in searched hidden zones. */
    lookedCardIds?: number[],
  ): void;
  /** Ask for a bounded subset of card instances, submitted atomically. */
  requestCardChoices(
    hook: string,
    prompt: string,
    options: number[],
    minimumSelections: number,
    maximumSelections: number,
    seat?: number,
    /** Complete public reveal group when only a subset is selectable. */
    revealedCardIds?: number[],
    /** Additional cards shown privately as non-selectable context. */
    lookedCardIds?: number[],
  ): void;
  /** Ask for an arbitrary registered card name without projecting the entire
   * card catalog as a giant option list. */
  requestNameChoice(hook: string, prompt: string, seat?: number): void;
  /** Offer a resource payment during a resolving effect or trigger. Legal
   *  options include floating pools and pitchable cards from the paying
   *  player's hand. Returns false when the player cannot pay, otherwise queues
   *  a decision whose onChoose result is normalized to "paid" or "declined". */
  requestPayment(hook: string, prompt: string, cost: number, seat?: number): boolean;
  /** Offer a payment whose follow-up hook belongs to another active source. */
  requestPaymentFrom(sourceInstanceId: number, hook: string, prompt: string, cost: number, seat?: number): boolean;
  /** Declare X, then pay the resulting resource cost while playing a card.
   *  `resourcesPerX` supports printed costs such as XX. The resulting
   *  onChoose option is `x:<number>`. */
  requestXPayment(
    hook: string,
    prompt: string,
    seat?: number,
    maximum?: number,
    resourcesPerX?: number,
  ): void;
  /** Prevent the next `amount` damage dealt to a hero this turn.
   *  `sourceInstanceId` restricts it to damage from that specific object ("a
   *  source of your choice" — Oasis Respite); a later copy of the same-named
   *  card is not covered. */
  preventNextDamage(targetSeat: number, amount: number, sourceInstanceId?: number): void;
  /** Prevent the next event no larger than `maximumEventAmount`; an oversized
   * event is ignored and does not consume this turn-long replacement. */
  preventNextDamageAtMost(targetSeat: number, amount: number, maximumEventAmount: number): void;
  /** Prevent the next damage event from a source with the given class or
   * subtype. Non-matching events leave the replacement ready. */
  preventNextDamageFromType(targetSeat: number, amount: number, sourceType: string): void;
  /** Prevent `amount` from each of the next `events` positive damage events
   * that would be dealt to the target hero this turn. */
  preventNextDamageEvents(targetSeat: number, amount: number, events: number): void;
  /** Redirect the next damage event from one hero to another and prevent part
   * of the redirected damage. */
  redirectNextHeroDamage(fromSeat: number, toSeat: number, prevent: number): void;
  /** Prevent up to `amount` physical damage from the next physical damage
   *  event dealt to a hero this turn. Any unused amount expires after that event. */
  preventNextPhysicalDamage(targetSeat: number, amount: number): void;
  /** Prevent the next `amount` arcane damage dealt to a hero this turn.
   *  Physical damage does not activate or reduce this shield. */
  preventNextArcaneDamage(targetSeat: number, amount: number): void;
  /** Let the controller play a specific card from a zone it normally can't be
   *  played from, this turn (e.g. a searched card banished face up with "you
   *  may play it this turn"). Cleared at end of turn. `costReduction`
   *  discounts the card's play cost ("it costs {r} less to play").
   *  `untilNextTurn` stretches the permission to the start of the
   *  controller's next turn (it survives this end phase's cleanup).
   *  `untilChainClose` keeps it only while the current combat chain remains
   *  open.
   *  `forSeat` grants the permission to that player even when another player
   *  owns the card. */
  allowPlayFrom(instanceId: number, zone: PlayableZone, opts?: {
    costReduction?: number;
    untilNextTurn?: boolean;
    untilEndOfNextTurn?: boolean;
    untilChainClose?: boolean;
    forSeat?: number;
    graveyardReplacement?: "banish";
    asInstant?: boolean;
  }): void;
  /** Put one of the controller's cards (from hand, deck, or graveyard, by instance id)
   *  into their arsenal face up, firing onEnterArsenal hooks (the entering
   *  card's own and the controller's permanents'). `from` names the source
   *  zone ("hand" / "deck") for triggers that care ("from your deck").
   *  Returns false when the card isn't in hand or deck. */
  putIntoArsenal(instanceId: number, from: "hand" | "deck" | "graveyard", opts?: { faceUp?: boolean }): boolean;
  /** Move a card from its owner's deck directly onto the current chain link as
   *  a defending card, firing its ordinary onDefend hook. */
  addDefenderFromDeck(instanceId: number): boolean;
  /** Move an action card from its owner's arsenal directly onto the current
   * chain link as a defending card, revealing it and firing onDefend. */
  addDefenderFromArsenal(instanceId: number): boolean;
  /** Move a card from a defending hero's hand directly onto the chain link. */
  addDefenderFromHand(instanceId: number): boolean;
  /** Add this equipment to the active chain link as a defending card without
   * moving it out of its equipment slot, then fire its ordinary onDefend hook. */
  addSelfAsDefender(): boolean;
  /** Remove an attack action from the controller's deck and declare it as an
   * attack without playing it or paying its printed cost. */
  attackFromDeck(instanceId: number): boolean;
  /** Generate an attack with a controlled weapon or ally without activating
   * its printed attack ability or paying that ability's costs. The attack
   * target is chosen when the effect generates the attack, and attacks made
   * during combat wait in FIFO order for the current chain link to resolve. */
  attackWithPermanent(instanceId: number): boolean;
  /** Atomically bottom the current attack action and replace it with an
   * eligible attack action from hand, without play or attack-declared events. */
  replaceAttackFromHand(instanceId: number, maximumCost: number): boolean;
  /** Atomically bottom the current attack action and replace it with an
   * eligible face-up attack action from banish, without play or attack-declared events. */
  replaceAttackFromBanish(instanceId: number, maximumCost: number): boolean;
  /** Turn a face-down arsenal card face up and fire its face-up arsenal hooks. */
  turnArsenalFaceUp(instanceId: number): boolean;
  /** Put a card (by instance id, from any of its owner's zones) on top of its
   *  owner's deck — unless the deck's owner has the per-turn `topDeckToBottom`
   *  replacement set ("if one or more cards would be put on top of a deck,
   *  instead they're put on the bottom"), which sends it to the bottom. */
  putOnDeckTop(instanceId: number): boolean;
  /** Insert a card into its owner's deck at an exact one-based depth from the
   *  top. If the deck is shorter, put it on the bottom. */
  putOnDeckAtDepth(instanceId: number, depth: number): boolean;
  /** Put a card (by instance id, from any of its owner's zones) on the bottom
   *  of its owner's deck. */
  putOnDeckBottom(instanceId: number): boolean;
  /** Put several cards on the bottom of their owner's deck in the deciding
   *  player's chosen order. When more than one card is supplied, this opens a
   *  private card-order decision and moves the cards only after the complete
   *  order has been determined (CR 8.5.15c). */
  putOnDeckBottomInChosenOrder(instanceIds: number[], prompt?: string): void;
  /** Create a weapon/equipment token and equip it to its zone (CR 8.5.41):
   *  weapon-subtype cards to a weapon slot (max 2), equipment to its named
   *  free slot. Returns the instance, or undefined when there is no room —
   *  the equip fails and nothing is created. */
  equipToken(cardId: string, seat?: number): DeepReadonly<CardInstance> | undefined;
  /** Transform the controller's hero into another card ("you become …",
   *  "return to the brood"): swaps the hero card id (life/intellect are
   *  player-level and carry over) and fires the new hero's onBecomeHero. */
  becomeHero(cardId: string): void;
  /** Transform using a hero card retained in inventory. The current hero is
   * put into its soul and the new hero starts at its printed life/intellect. */
  becomeHeroFromInventory(instanceId: number): boolean;
  /** Transform until the start of this hero's next turn, preserving life. */
  becomeHeroUntilNextTurn(cardId: string): void;
  /** Log information that is public to both players and spectators. */
  logPublic(text: string): void;
  /** Log a private identity/detail for one seat, optionally with a redacted
   * public fallback. With no publicText, other audiences see nothing. */
  logPrivate(seat: number, privateText: string, publicText?: string): void;
  /** Append an explicitly classified per-audience entry. */
  logForSeats(entry: GameLogEntry): void;
}

export interface ActivatedEffectCardCost {
  zone: "hand" | "graveyard" | "arsenal" | "arena";
  move: "banish" | "discard" | "destroy" | "put-on-deck-bottom" | "tap" | "remove-counter" | "turn-face-up";
  count: number;
  /** Banish the selected card face down, keeping its identity private. */
  faceDown?: boolean;
  pitch?: number;
  class?: string;
  subtype?: string;
  keyword?: string;
  /** Every listed class or subtype must be present. */
  types?: string[];
  name?: string;
  /** Only cards without this named counter are eligible. */
  withoutCounter?: string;
  counter?: { key: string; amount: number };
  prompt: string;
}

export interface ActivatedAbility {
  cost: number;
  /** Printed variable resource component of this activation cost. The engine
   * declares X before pitching and stores it on the source before resolution. */
  variableCost?: {
    base: number;
    counterKey: string;
    resourcesPerX?: number;
    maximum?: number;
    prompt?: string;
  };
  /** Chi point cost ({c}) in addition to `cost` (CR 1.14.2c/d): only chi
   *  points may pay it — while paying, only chi-subtype cards may be pitched,
   *  and the payment needs chi pool >= chiCost. */
  chiCost?: number;
  isAttack: boolean;
  goAgain: boolean;
  /** Short label for the client when a card has several activated abilities
   *  (e.g. "Attack" / "Next ally +1{p}"). */
  label?: string;
  oncePerTurn?: boolean;
  /** Printed per-turn activation limit when it is greater than one (for
   *  example, "Twice per Turn"). The limit is consumed when the activation
   *  is announced and its costs are paid, not when its stack layer resolves. */
  activationsPerTurn?: number;
  /** The ability taps the permanent it's on as part of the activation cost
   *  ({t}). A tapped permanent can't be tapped again for a cost; it untaps in
   *  its controller's end phase. Distinct from oncePerTurn. */
  tap?: boolean;
  /** This source is destroyed / banished as part of the activation cost. */
  destroySelfCost?: boolean;
  banishSelfCost?: boolean;
  putSelfOnDeckBottomCost?: boolean;
  /** Return this source from its owner's banished zone to their hand as an
   * activation cost. */
  returnSelfToHandCost?: boolean;
  /** Destroy the top public sub-card retained under this source as part of the cost. */
  destroySubcardCost?: boolean;
  /** Remove named counters from this source as part of the activation cost. */
  removeCounterCost?: { key: string; amount: number };
  /** Tap the controller's hero as part of the activation cost. */
  tapHeroCost?: boolean;
  /** Banish this many cards from the controller's hero soul as an activation
   *  cost. The engine opens a private pre-activation card choice. */
  banishSoulCost?: number;
  /** Choose X, then banish exactly X cards from the controller's hero soul as
   *  an activation cost. The chosen value is stored on the source so the
   *  resolving effect can use it. */
  variableBanishSoulCost?: {
    counterKey: string;
    maximum?: number;
    prompt?: string;
  };
  /** Select public cards and move them as effect-costs before the activated
   * layer is created. Groups are paid in order and may constrain the source
   * zone, pitch, subtype, or name without embedding card-specific engine behavior. */
  effectCardCosts?: ActivatedEffectCardCost[];
  /** Card costs offered as an alternative to this ability's printed resource
   * cost. Legal intents enumerate the exact cards so the client can present
   * them alongside the ordinary resource-payment option. */
  alternativeEffectCardCosts?: ActivatedEffectCardCost[];
  /** Optional stable hook label for the engine-owned cost decision. */
  effectCardCostChoiceHook?: string;
  /** The ability's activation cost includes discarding cards from hand. The
   *  engine requests this choice separately from any resource payment.
   *  `classes` restricts what may be discarded ("discard an Assassin card"). */
  discardCost?: {
    count: number;
    classes?: string[];
    cardTypes?: string[];
    /** Match any effective class or subtype (for example, an Earth card). */
    types?: string[];
  };
  /** The ability turns its (face-down, Cloaked) source face up as part of the
   *  activation cost — the ONLY kind of ability usable while the permanent is
   *  face-down (CR 8.3.36). Once face up, everything functions normally. */
  turnsFaceUp?: boolean;
  /** The ability functions while its source is face-down without turning the
   * source face-up (for Cloaked abilities whose destruction is the cost). */
  usableWhileFaceDown?: boolean;
  /** When the ability may be activated: "action" (default) costs an action
   *  point in your action phase; "instant" is free and usable in any priority
   *  window; "attack-reaction" is usable in the attack-reaction window while
   *  you are the attacker. */
  timing?: "action" | "instant" | "attack-reaction" | "defense-reaction";
  /** The ability is usable while the card is in hand (instant timing only):
   *  moving the card is the activation cost. It discards by default (Amp);
   *  cards that explicitly banish themselves set fromHandMove. Enumerated in
   *  priority windows alongside permanent abilities. */
  fromHand?: boolean;
  fromHandMove?: "discard" | "banish";
  /** The ability functions only from its owner's graveyard (instant timing). */
  fromGraveyard?: boolean;
  /** The ability functions only from its owner's banished zone. */
  fromBanish?: boolean;
  /** The ability functions only from its owner's arsenal. */
  fromArsenal?: boolean;
  /** Extra legality beyond cost/AP (e.g. "only if you attacked with a weapon this turn") */
  canActivate?(ctx: ScriptCtx): boolean;
  /** Dynamic resource cost of the ability ("this ability costs {r} less for
   *  each …"): consulted in enumeration AND validation — must be pure. */
  modifyCost?(ctx: ScriptCtx, baseCost: number): number;
  /** Runs immediately after the activation cost is paid, with the exact cards
   * used to pay its resource/discard component. */
  onCostPaid?(ctx: ScriptCtx, paidCards: DeepReadonly<CardInstance>[]): void;
  /** Runs when the ability resolves (non-attack abilities); attack abilities open a chain link instead. */
  onActivate?(ctx: ScriptCtx): void;
}

/** Normalize the single-or-array `activated` field. */
export function abilityList(script: CardScript | undefined): ActivatedAbility[] {
  if (!script?.activated) return [];
  return Array.isArray(script.activated) ? script.activated : [script.activated];
}

/** Per-turn flag key for an ability's once-per-turn use. Index 0 keeps the
 * historic persisted key; further abilities get a per-index key. Scripts use
 * the activation-limit commands rather than mutating these flags directly. */
export function activatedFlagKey(instanceId: number, abilityIndex: number): string {
  return abilityIndex === 0 ? `activated:${instanceId}` : `activated:${instanceId}:${abilityIndex}`;
}

export const ONCE_PER_TURN_EFFECT_FLAG_PREFIX = "oncePerTurnEffectUsed:";

export function oncePerTurnEffectFlagKey(instanceId: number): string {
  return `${ONCE_PER_TURN_EFFECT_FLAG_PREFIX}${instanceId}`;
}

/** A triggered ability definition on a card script. */
export interface TriggerDef {
  /** Which event queues this trigger */
  event: TriggerEvent;
  /** Shared identity for simultaneous triggers whose source and ordering are
   * mechanically interchangeable. Matching keys become one counted stack
   * layer and combine identical public announcements; each occurrence still
   * resolves separately and may pause on a choice. */
  simultaneousKey?: string;
  /** "subject": only fires for the player the event belongs to (turn player /
   *  attacker). "any": fires for either player (e.g. "whenever a hero attacks"). */
  whose?: "subject" | "any";
  /** Zone the source must occupy when the event occurs. Defaults to an arena
   *  permanent (including face-up/mentor arsenal where applicable). */
  sourceZone?: "arena" | "hand" | "banish" | "graveyard" | "pitch" | "self" | "any";
  /** Extra condition (e.g. "while face down in arsenal"). Card-played
   * triggers also receive the card that caused the event. */
  condition?(
    ctx: ScriptCtx,
    eventCard?: DeepReadonly<CardInstance>,
    eventContext?: TriggerEventContext,
  ): boolean;
  /** If true, the controller chooses yes/no before the ability goes on the stack */
  optional?: boolean;
  /** Space-bar default for an optional trigger choice. */
  defaultOption?: "yes" | "no";
  /** Short description shown in the stack window, e.g. "Turn face up?" */
  label: string;
  /** Exact public trigger announcement. Defaults to "<source> triggers: <label>". */
  publicLog?: string;
  /** Runs when the trigger condition is met and its layer is created. Use for
   * consuming trigger limits; resolution effects belong in `effect`. */
  onTrigger?(
    ctx: ScriptCtx,
    eventCard?: DeepReadonly<CardInstance>,
    eventContext?: TriggerEventContext,
  ): void;
  /** Runs when the controller accepts an optional trigger — the trigger itself
   *  resolving (e.g. turning a mentor face up), before any priority window. */
  onAccept?(ctx: ScriptCtx): void;
  /** Runs when the layer resolves off the stack (after acceptance, when optional).
   * `eventCard` is last-known information captured when the trigger was made. */
  effect?(ctx: ScriptCtx, eventCard?: DeepReadonly<CardInstance>): void;
}

/** Card-declared alternative or additional effect-costs. They replace the
 * printed resource cost by default; numeric taxes still apply after it becomes
 * zero. The engine validates and performs zone changes atomically. */
type AlternativePlayCost = (
  | { kind: "put-hand-card-on-deck-top" }
  | {
      kind: "destroy-controlled-named";
      options: { name: string; count: number }[];
    }
  | { kind: "banish-hand"; min: number }
  | { kind: "discard-or-destroy-controlled-named"; name: string }
  | {
      kind: "destroy-controlled-and-or-discard-hand-subtype";
      subtype: string;
      cardLabel: string;
      maximumDestroyed: number;
      maximumDiscarded: number;
    }
) & {
  /** Additional effect-costs use the same announced-card plumbing without
   * replacing the printed resource cost. Defaults to true. */
  replacesResourceCost?: boolean;
};

/**
 * Behavior for one card id. All hooks optional — vanilla cards need no script.
 * Hooks receive the engine's mutable working copy and are called synchronously.
 */
export interface CardScript {
  /** Additional primary card types this object has in every zone. Used for
   * double-faced objects whose characteristics include more than one type. */
  additionalCardTypes?: CardType[];
  /** Additional names this face-up object has in every zone. */
  allZoneNames?: string[];
  /** Additional classes/subtypes this face-up object has in every zone. */
  allZoneTypes?: string[];
  /** This active object makes its controller count as having this many
   * additional equipped objects of each class/subtype. */
  countsAsEquipped?: Readonly<Record<string, number>>;
  /** A rule-defined object that exists for each seat without occupying a card
   * zone. Global sources must keep mutable state on serializable game objects
   * such as player flags rather than on their synthetic CardInstance. */
  global?: boolean;
  /** This source's triggered abilities continue to function while it is
   * face-down. Individual trigger conditions still decide whether they fire. */
  triggersWhileFaceDown?: boolean;
  /** This face-up arsenal object supplies observer and continuous hooks while
   * it remains there (Mentor and similar cards). */
  activeWhileFaceUpInArsenal?: boolean;
  /** This equipment is a deck-playable action object (Evo, CR 8.3.26). On
   * resolution it replaces matching base equipment and retains it underneath. */
  playableEquipment?: boolean;
  /** A live source may grant matching friendly cards permission to be played
   * from an otherwise inaccessible zone. */
  allowsFriendlyCardPlayFrom?(
    ctx: ScriptCtx,
    card: DeepReadonly<CardInstance>,
    zone: PlayableZone,
  ): boolean;
  /** A play-from-zone permission supplied by this source permits the matching
   * card only through the instant play method. */
  requiresFriendlyCardPlayAsInstant?(
    ctx: ScriptCtx,
    card: DeepReadonly<CardInstance>,
    zone: PlayableZone,
  ): boolean;
  modifyFriendlyCardPlayCost?(
    ctx: ScriptCtx,
    card: DeepReadonly<CardInstance>,
    zone: "hand" | "arsenal" | PlayableZone,
    baseCost: number,
  ): number;
  allowsFriendlyCardPlayAsInstant?(
    ctx: ScriptCtx,
    card: DeepReadonly<CardInstance>,
    zone: "hand" | "arsenal" | PlayableZone,
  ): boolean;
  /** The controller may continuously look at the top card of their deck. */
  lookAtTopDeck?: boolean;
  /** Rune Gate play-static marker (CR 8.3.27). The engine permits this card
   * from banish for a zero printed resource cost while its controller has at
   * least that many permanents carrying `runechantToken`. */
  runeGate?: boolean;
  /** Identifies a permanent as a Runechant for the generic Rune Gate count. */
  runechantToken?: boolean;
  /** This active source stops all heroes revealing cards. */
  prohibitsReveals?: boolean;
  /** This active source stops cards being drawn by resolving effects. */
  prohibitsEffectDraws?: boolean;
  /** This active source stops cards being drawn by resolving effects while
   * the game is within an action phase, including combat and layer windows. */
  prohibitsEffectDrawsDuringActionPhase?: boolean;
  /** This active source stops deck searches. */
  prohibitsDeckSearches?: boolean;
  /** If this object would move to soul, put it into the arena instead. */
  replacesSoulMoveWithArena?: boolean;
  /** This card may be declared as a defender directly from arsenal. A
   * predicate is authoritative for conditional permission such as Ambush
   * gained only after controlling a named token this turn. */
  canDefendFromArsenal?: boolean | ((ctx: ScriptCtx) => boolean);
  /** Friendly Runechant tokens have Spellvoid 1 while this source is active. */
  grantsSpellvoidToRunechants?: boolean;
  /** Non-attack action cards lose and cannot gain go again while active. */
  suppressesNonAttackActionGoAgain?: boolean;
  /** This card has a resolving effect that deals arcane damage. Used to bind
   *  "the next card you play with an arcane-damage effect gets +N" when the
   *  card is played, rather than when a later damage packet happens. */
  arcaneDamageEffect?: boolean;
  /** Damage this source's unresolved stack layer would deal to heroes if it
   * resolved now, before prevention. Used by effects that inspect a targeted
   * source prospectively (Amulet of Intervention). Must be pure. */
  prospectiveHeroDamage?(
    ctx: ScriptCtx,
    layer: DeepReadonly<StackLayer>,
  ): readonly { readonly targetSeat: number; readonly amount: number }[];
  /** Static keywords this card grants to its top-card while it is a sub-card
   * (Material). */
  materialKeywords?: string[];
  /** Game-setup effect ("you may start the game with …"), run on the hero
   *  after the decks are shuffled and before the opening hands are drawn. */
  onGameStart?(ctx: ScriptCtx): void;
  /** Extra legality for playing this card from hand/arsenal (beyond type/cost/AP). */
  canPlay?(ctx: ScriptCtx): boolean;
  /** Card instances this play may target. A script with this hook requires one
   * of the returned targets to be announced in the play intent. Must be pure. */
  playTargetOptions?(ctx: ScriptCtx): readonly number[];
  /** Optional alternative resource or additional effect cost declared when
   * this card is played. Set `replacesResourceCost: false` for an additional
   * cost that keeps the card's printed resource cost. */
  alternativePlayCost?: AlternativePlayCost;
  /** Runs immediately after the declared cost's cards change zones. */
  onAlternativeCostPaid?(
    ctx: ScriptCtx,
    paidCards: DeepReadonly<CardInstance>[],
  ): void;
  /** Numeric characteristics of this object that continuous effects and
   * counters cannot modify. This marker functions in every zone. */
  unmodifiableCharacteristics?: readonly ("cost" | "power" | "defense")[];
  /** Mandatory prevention replacement: choose and banish a card from this
   * controller's soul to prevent the stated amount from one damage event. */
  banishSoulToPreventDamage?: number;
  /** Zones this card's own static text permits it to be played from. */
  staticPlayableFrom?: PlayableZone[];
  /** This (non-instant) action card may be played as though it were an instant
   *  (Cindering Foresight, Snapback, cards unlocked by Blaze, Firemind):
   *  playable in any priority/reaction window, no action point cost. */
  playAsInstant?(ctx: ScriptCtx): boolean;
  /** Non-attack actions, instants, and reactions: effect on resolution. */
  onPlay?(ctx: ScriptCtx): void;
  /** Deferred work that begins only after this card has completed resolution,
   *  entered its post-resolution zone, and left the stack. */
  onResolved?(ctx: ScriptCtx): void;
  /** This object was declared as the current attack. */
  onAttackDeclared?(ctx: ScriptCtx): void;
  /** Deferred attack-source work after attack-declared triggered layers have
   * resolved, immediately before the defend step begins. */
  onAttackDeclaredTriggersResolved?(ctx: ScriptCtx): void;
  /** An attack was declared by this source's controller. Called once for each
   *  observing active or lingering source, including when that source is the
   *  attacking object. */
  onFriendlyAttackDeclared?(ctx: ScriptCtx): void;
  /** Resolve a trigger previously registered with scheduleEndOfTurnTrigger. */
  onDelayedTrigger?(ctx: ScriptCtx, hook: string): void;
  /** The current link's attack gained go again — at declaration or later
   *  (e.g. granted on hit). Called for the attacking card and the hero. */
  onGainGoAgain?(ctx: ScriptCtx): void;
  /** Conditional attack bonus, re-evaluated at resolution. On an attacking
   * object (including a weapon), this modifies only that object's attack;
   * observer effects belong on explicit friendly-attack/modifier hooks. */
  modifyAttack?(ctx: ScriptCtx): number;
  /** Continuous adjustment to a friendly attack while this source is active. */
  modifyFriendlyAttack?(ctx: ScriptCtx, attacking: DeepReadonly<CardInstance>): number;
  /** Replace one positive power gain applied to this face-up object. The
   * returned amount is the complete gain after replacement. */
  replacePowerGain?(ctx: ScriptCtx, amount: number): number | undefined;
  /** Continuous adjustment to an opposing attack while this source is active
   *  or is itself defending that attack. */
  modifyOpposingAttack?(ctx: ScriptCtx, attacking: DeepReadonly<CardInstance>): number;
  /** Conditional defense bonus while this card is defending (hand cards and
   *  equipment), re-evaluated at resolution (e.g. "+1{d} while defending a
   *  weapon attack"). */
  modifyDefense?(ctx: ScriptCtx): number;
  /** Continuous adjustment to an opposing card's power while it is defending. */
  modifyOpposingPower?(ctx: ScriptCtx, defending: DeepReadonly<CardInstance>): number;
  /** Adjustment to the power property of cards defending this attack (used by
   *  effects such as Herald of Triumph and checked by Phantasm). */
  modifyDefendingPower?(ctx: ScriptCtx, defending: DeepReadonly<CardInstance>): number;
  /** Adjustment to the defense property of cards defending this source's
   * attack. Active friendly permanents may also supply this hook. */
  modifyDefendingDefense?(ctx: ScriptCtx, defending: DeepReadonly<CardInstance>): number;
  /** Adjustment to an equipment card's defense while it defends this attack. */
  modifyDefendingEquipmentDefense?(ctx: ScriptCtx, defending: DeepReadonly<CardInstance>): number;
  /** Called immediately when equipment becomes a defender of this attack. */
  onDefendedByEquipment?(ctx: ScriptCtx, defending: DeepReadonly<CardInstance>): void;
  /** Continuous adjustment to equipment this source's controller uses to defend. */
  modifyFriendlyEquipmentDefense?(ctx: ScriptCtx, defending: DeepReadonly<CardInstance>): number;
  /** Replace the positive combat-damage amount after attack and defense are calculated. */
  modifyCombatDamage?(ctx: ScriptCtx, amount: number): number;
  /** Combat damage at or above this final pre-prevention amount cannot be
   * prevented. The threshold is checked after attack/defense calculation and
   * source-side damage modifications. */
  combatDamageUnpreventableAtLeast?: number;
  /** This permanent entered the arena (token created, item played). */
  onEnterArena?(ctx: ScriptCtx): void;
  /** This object was one side of a transform event. `direction` describes
   * whether this object transformed from `other` or into `other`. */
  onTransform?(
    ctx: ScriptCtx,
    direction: "from" | "into",
    other: DeepReadonly<CardInstance>,
  ): void;
  /** Another permanent entered the arena under this source's controller. */
  onFriendlyEnterArena?(ctx: ScriptCtx, entered: DeepReadonly<CardInstance>): void;
  /** This permanent left the arena for another zone. */
  onLeaveArena?(
    ctx: ScriptCtx,
    to: "graveyard" | "banish" | "soul" | "deck" | "hand" | "subcard" | "cease-to-exist",
  ): void;
  /** Effect damage this card dealt has been applied (after any prevention,
   *  including a deferred Arcane Barrier decision). `amount` is what was
   *  actually dealt. */
  onDamageDealt?(ctx: ScriptCtx, targetSeat: number, amount: number, arcane: boolean): void;
  /** This object dealt positive damage, whether effect or combat damage. */
  onDealsDamage?(ctx: ScriptCtx, targetSeat: number, amount: number, arcane: boolean): void;
  /** This in-arena object was dealt positive damage, before lethal cleanup. */
  onDealtDamage?(ctx: ScriptCtx, amount: number, arcane: boolean): void;
  /** Replace damage that would be dealt to this in-arena object. The returned
   * value is the amount that proceeds through the event. */
  replaceDamageToSelf?(ctx: ScriptCtx, amount: number, arcane: boolean): number | undefined;
  /** This source's controller was dealt positive damage by an attack or
   *  effect, after prevention. Life loss and damage reduced to 0 do not fire. */
  onHeroDealtDamage?(ctx: ScriptCtx, amount: number, arcane: boolean): void;
  /** A non-combat effect made this object hit a hero (Danger Digits). The
   * engine snapshots this as a triggered layer before calling the hook. */
  onEffectHit?(ctx: ScriptCtx, targetSeat: number): void;
  /** An object this source's controller owns hit a hero through a non-combat
   * effect. The engine snapshots this as a triggered layer. */
  onFriendlyEffectHitCondition?(
    ctx: ScriptCtx,
    source: DeepReadonly<CardInstance>,
    targetSeat: number,
    targetWasMarked: boolean,
  ): boolean;
  onFriendlyEffectHit?(
    ctx: ScriptCtx,
    source: DeepReadonly<CardInstance>,
    targetSeat: number,
    targetWasMarked: boolean,
  ): void;
  /** An object this source's controller owns dealt non-combat damage to a hero. */
  onFriendlyDamageDealt?(
    ctx: ScriptCtx,
    source: DeepReadonly<CardInstance>,
    targetSeat: number,
    amount: number,
    arcane: boolean,
  ): void;
  /** This source prevented a positive amount of damage. */
  onPreventsDamage?(ctx: ScriptCtx, amount: number, arcane: boolean): void;
  /** An attack this source's controller controls dealt combat damage to a hero. */
  onFriendlyCombatDamageDealt?(
    ctx: ScriptCtx,
    source: DeepReadonly<CardInstance>,
    targetSeat: number,
    amount: number,
  ): void;
  /** Whether this source's on-hit effect triggers for the pending hit-event.
   * Limited/ordinal triggers use this to avoid creating a stack layer after
   * their trigger condition or per-turn limit has already been consumed. */
  canTriggerOnHit?(ctx: ScriptCtx): boolean;
  /** Called when a link resolves as a hit. Unqualified "hits" include ally
   *  targets; scripts whose text says "hits a hero" must check targetAllyId. */
  onHit?(ctx: ScriptCtx): void;
  /** Runs when a granted on-hit script hook (an `onHitScriptHook` modifier
   *  this card created earlier, e.g. "your next attack gains 'when this hits,
   *  …'") resolves. The hook key disambiguates multiple grants; ctx.self is
   *  the granting card, which may since have changed zones. */
  onGrantedHit?(ctx: ScriptCtx, hook: string): void;
  /** Called instead of onHit when an effect suppresses hit triggers. Limited
   *  triggered abilities use this observer to consume an ordinal/once limit
   *  without performing the suppressed effect (CR 6.6.5f). */
  onSuppressedHit?(ctx: ScriptCtx): void;
  /** While this source is active, attack-action hit effects do not trigger. */
  suppressesAttackActionHitEffects?: boolean;
  /** Called when a link resolves without a hit. */
  onMiss?(ctx: ScriptCtx): void;
  /** Called once when the current chain link finishes resolving, after its
   * hit/miss and damage events and before cards on the link settle. */
  onAttackResolved?(ctx: ScriptCtx): void;
  /** Fires for a card participating in a combat chain link when that link
   * resolves, before close-chain movement. */
  onChainLinkResolved?(ctx: ScriptCtx): void;
  /** Weapon/equipment/hero/board activated ability — or several, for cards
   *  with more than one (intents disambiguate via `abilityIndex`). */
  activated?: ActivatedAbility | ActivatedAbility[];
  /** Ability usable while this card is defending (e.g. Rally the Rearguard); cost is discarding cards. */
  defenseAbility?: { discard: number; oncePerTurn?: boolean };
  /** Effect of the defenseAbility. */
  onDefendAbility?(ctx: ScriptCtx): void;
  /** Additional cost/effect paid when the card is played (discard random, reveal, ...). */
  additionalCost?(ctx: ScriptCtx): void;
  /** Number of other hand cards that must remain available after pitching and
   * other announced costs so this card's mandatory additional cost can be
   * paid. The hook still performs the printed cost; this marker makes play
   * legality and pitch enumeration enforce CR 1.14.4. */
  requiredHandCardsForAdditionalCost?: number;
  /** Printed variable resource cost. The engine asks for X before presenting
   * pitch choices, then pays `base + X * resourcesPerX` together with normal
   * cost increases and reductions. The declared value is stored on the card
   * under `counterKey` before its play hooks run. */
  variablePlayCost?: {
    base: number;
    counterKey: string;
    resourcesPerX?: number;
    minimum?: number;
    maximum?: number | ((ctx: ScriptCtx) => number);
    /** Extra declaration legality for target-defined X values. */
    canDeclareX?(ctx: ScriptCtx, x: number): boolean;
    prompt?: string;
  };
  /** Observe the exact cards pitched to pay this card's play cost. Called
   *  after payment and before additional costs, while the cards are in pitch. */
  onPlayCostPaid?(ctx: ScriptCtx, paidCards: DeepReadonly<CardInstance>[]): void;
  /** A card controlled by this card's owner was played (called for mentors in
   *  arsenal, the hero, and equipment). `from` names the zone it was played
   *  from ("hand", "arsenal", or a PlayableZone like "graveyard"). */
  onFriendlyPlay?(ctx: ScriptCtx, played: DeepReadonly<CardInstance>, from?: string): void;
  /** A card controlled by the opposing hero was played. Played cards are
   * public by the time this observer runs. */
  onOpponentPlay?(ctx: ScriptCtx, played: DeepReadonly<CardInstance>, from?: string): void;
  /** A card controlled by this source's controller activated an ability.
   *  Called after costs are paid, for the hero and arena permanents. */
  onFriendlyActivate?(ctx: ScriptCtx, activated: DeepReadonly<CardInstance>): void;
  /** The opposing hero activated an ability. `timing` is the announced
   * timing of that ability. */
  onOpponentActivate?(
    ctx: ScriptCtx,
    activated: DeepReadonly<CardInstance>,
    timing: "action" | "instant" | "attack-reaction" | "defense-reaction",
  ): void;
  /** Observe cards actually drawn by this source's controller. `source` is
   * present when a resolving card effect caused the draw. */
  onFriendlyDraws?(ctx: ScriptCtx, count: number, source?: DeepReadonly<CardInstance>): void;
  /** Observe one final, non-ignored die result rolled by this source's controller. */
  onFriendlyDieRollResult?(ctx: ScriptCtx, result: number): void;
  /** Observe one reveal event performed by any hero. */
  onAnyHeroReveals?(ctx: ScriptCtx, revealingSeat: number, cards: readonly DeepReadonly<CardInstance>[]): void;
  /** Observe a cog/item this source's controller successfully cranked. */
  onFriendlyCrank?(ctx: ScriptCtx, cranked: DeepReadonly<CardInstance>): void;
  /** Replace resources gained when this source's controller pitches a card. */
  replacePitchResources?(ctx: ScriptCtx, pitched: DeepReadonly<CardInstance>, amount: number): number | undefined;
  /** Replace an opponent's draw count before cards move. */
  replaceOpponentDraw?(ctx: ScriptCtx, drawingSeat: number, count: number): number | undefined;
  /** Replace this source's controller's draw count before cards move. */
  replaceFriendlyDraw?(ctx: ScriptCtx, count: number): number | undefined;
  /** Observe cards actually drawn by an opponent after replacements. */
  onOpponentDraws?(ctx: ScriptCtx, drawingSeat: number, count: number): void;
  /** Static resource increase applied to every card this source's controller
   *  plays and every ability they activate (Frostbite). Multiple sources add. */
  additionalCostToController?: number;
  /** Static resource increase applied to cards played and abilities activated
   * by opposing heroes while this source remains in the arena. */
  additionalCostToOpponents?: number;
  /** Static cap on non-attack action cards each hero may play per turn while
   * this source remains in the arena. The lowest active cap applies. */
  nonAttackActionCardLimit?: number;
  /** This active permanent is a mandatory non-hero attack target when able. */
  mandatoryAttackTarget?: boolean | ((ctx: ScriptCtx) => boolean);
  /** While this card attacks, the defending hero cannot play/activate
   * instants or defense reactions unless a defender has at least its power. */
  defendingHeroCannotRespondBelowPower?: boolean;
  /** While its controller has a face-up arsenal card, this active permanent
   * provides one additional arsenal zone. */
  additionalArsenalZoneWhileFaceUp?: boolean;
  /** A defending copy settles into its owner's soul when the chain closes. */
  settlesToSoulOnChainClose?: boolean;
  /** While this permanent's controller is the turn player, opposing players
   *  cannot play cards or activate abilities. Defending and choices are not
   *  plays or activations and remain legal. */
  opponentsCannotPlayOrActivateOnYourTurn?: boolean;
  /** While this object is attacking or represented by an unresolved card
   * layer, opposing heroes cannot play instant cards or activate instant
   * abilities. */
  opponentsCannotPlayOrActivateInstantsWhileActive?: boolean;
  /** While this face-up permanent remains active, no hero may create aura
   * tokens. */
  prohibitsAuraTokenCreation?: boolean;
  /** While active, opposing arsenal cards are frozen if their controller has
   * a Frostbite or another frozen permanent. */
  freezesOpposingArsenalConditionally?: boolean;
  /** While this permanent is active, its controller cannot play cards they
   * own or activate abilities of cards they own. Opponent-owned objects they
   * control remain usable. */
  controllerCannotPlayOrActivateOwnedCards?: boolean;
  /** Fixed arcane prevention applied to each arcane-damage event dealt to this
   *  source's controller while the source remains in the arena. */
  preventArcaneDamage?: number;
  /** Fixed arcane prevention applied while this source is attacking,
   * defending, or represented by an unresolved card layer on the stack. */
  preventArcaneDamageWhileActive?: number;
  /** Conditional Arcane Barrier value while this source remains active. */
  arcaneBarrierValue?(ctx: ScriptCtx): number;
  /** Replace preventable damage to this source's controller. The returned
   * amount is the damage that remains in the event. */
  replaceDamageToController?(ctx: ScriptCtx, amount: number, arcane: boolean): number;
  /** This active source prohibits cards matching its public chosen name from
   * being pitched, played, or used to defend. */
  prohibitsChosenName?: boolean;
  /** This active source may be destroyed to replace a die roll with a reroll. */
  dieRollReplacement?: boolean;
  /** Receive the final result from requestDieRoll after replacements. */
  onDieRollResolved?(ctx: ScriptCtx, hook: string, result: number): void;
  /** Fixed prevention replacement applied when this source's controller would
   *  be dealt damage. Additional modifications still happen when the damage
   *  can't be prevented. */
  fixedDamagePrevention?: {
    amount: number;
    destroySource?: boolean;
    banishSource?: boolean;
    /** Apply at most once each turn while this source remains in the arena. */
    oncePerTurn?: boolean;
  };
  /** Optional prevention replacement offered whenever this source's
   * controller would be dealt preventable damage. Applying it moves this
   * source out of the arena as part of the replacement. */
  optionalDamagePrevention?: {
    amount: number;
    moveSource: "destroy" | "banish";
    /** Offer this replacement only for arcane damage (Arcane Shelter). */
    arcaneOnly?: boolean;
  };
  /** Quell N — during a damage event, its controller may pay the cost to
   * prevent damage, then this source is destroyed at the next end phase. */
  quell?: { amount: number; cost: number };
  /** A card controlled by this source's controller paid Boost's optional
   *  additional cost. `boosted` is the attack and `banished` is the deck top. */
  onBoosted?(ctx: ScriptCtx, boosted: DeepReadonly<CardInstance>, banished: DeepReadonly<CardInstance>): void;
  /** Number of separate Boost abilities printed on this card. Defaults to 1
   * when the card has the Boost keyword. */
  boostCount?: number;
  /** This source's controller created a token. */
  onFriendlyTokenCreated?(ctx: ScriptCtx, token: DeepReadonly<CardInstance>): void;
  /** Replace the number of one named token created by a single effect. This is
   * consulted before the batch enters the arena (Florian). Must be pure. */
  replaceFriendlyTokenCreation?(ctx: ScriptCtx, cardId: string, count: number): number | undefined;
  /** Replace a token batch created for either player. This participates in the
   * same replacement-order protocol as friendly replacements. Must be pure. */
  globalTokenCreationReplacement?: {
    label: string;
    replace(
      ctx: ScriptCtx,
      creatingSeat: number,
      cardId: string,
      count: number,
      cause: TokenCreationContext,
    ): number | undefined;
  };
  /** Optional replacement for a friendly token batch. Accepting performs the
   * effect and prevents the entire batch; declining continues through later
   * replacement effects. */
  optionalFriendlyTokenCreationReplacement?: {
    condition(ctx: ScriptCtx, cardId: string, count: number): boolean;
    label: string;
    effect(ctx: ScriptCtx): void;
  };
  /** This source's controller gained life. */
  onHeroGainedLife?(ctx: ScriptCtx, amount: number): void;
  /** Replace a positive life-gain event for any hero. The source may return
   * zero after performing a corresponding life-loss effect. */
  replaceHeroLifeGain?(ctx: ScriptCtx, gainingSeat: number, amount: number): number | undefined;
  /** A wager generated by this card resolves. Use this for its non-token
   * prize; token prizes passed to `ctx.wager` are awarded by the engine. */
  onWagerResolved?(
    ctx: ScriptCtx,
    winner: number,
  ): void;
  /** Optional replacement offered when this source's controller would lose a
   * wager, regardless of which effect generated it. Return true when the
   * replacement handled this loss; false lets the engine try another source.
   * A scripted choice may pause resolution and set `wagerWinnerOverride` to
   * `seat + 1`. */
  onFriendlyWagerLossReplacement?(ctx: ScriptCtx): boolean;
  /** This card was banished as the top card paid for a Boost cost. */
  onBanishedForBoost?(ctx: ScriptCtx, boosted: DeepReadonly<CardInstance>): void;
  /** Replace the card movement used to pay a Boost cost. Returning true means
   * the script moved the card and ordinary banishment is skipped. */
  replaceBoostBanish?(ctx: ScriptCtx, boosted: DeepReadonly<CardInstance>, card: DeepReadonly<CardInstance>): boolean;
  /** A card was put into its owner's graveyard. Fires for the entering card's
   *  own script and for the owner's hero. `from` names the zone it came from
   *  ("hand", "deck", "arena", "stack", "chain", "arsenal"). Per-turn facts are
   *  also recorded in owner flags: `graveName:<name>`, `graveSubtype:<subtype>`
   *  (true) and `gravePitch:<n>` (counts). */
  onCardToGraveyard?(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, from: string, causedBySeat?: number): void;
  /** Extra legality for choosing this card as a defender (hand cards and
   *  equipment), consulted with ctx.link set — e.g. "this can only defend an
   *  attack with 3 or less base {p}". */
  canDefend?(ctx: ScriptCtx): boolean;
  /** Extra legality imposed by an active attack on a proposed defending card.
   *  Runs on the attacking card and its controller's active sources. */
  canBeDefendedBy?(
    ctx: ScriptCtx,
    defending: DeepReadonly<CardInstance>,
    fromHand: boolean,
  ): boolean;
  /** Attacks made with this card can't be defended by equipment. */
  cannotBeDefendedByEquipment?: boolean;
  /** When a card with greater current defense than this attack's current
   * power becomes a defender, mark the attacking permanent to be destroyed
   * when the combat chain closes. */
  destroyOnChainCloseWhenDefendedByHigherDefense?: boolean;
  /** Whether this card's onDefend effect triggers for the pending defend
   * event. Conditions belong here so an inapplicable triggered layer is not
   * created and shown on the stack. */
  canTriggerOnDefend?(ctx: ScriptCtx): boolean;
  /** This card was chosen as a defender (hand cards and equipment). */
  onDefend?(ctx: ScriptCtx): void;
  /** An attack controlled by this source's controller became defended. */
  friendlyDefendedTrigger?: {
    /** Optional event-time guard. Receives only the cards that became
     * defenders in this event, rather than every defender already present. */
    condition?(
      ctx: ScriptCtx,
      defenders: readonly DeepReadonly<CardInstance>[],
    ): boolean;
    /** Card-specific text shown in the stack and public trigger log. */
    label?: string;
  };
  onFriendlyDefended?(ctx: ScriptCtx, defendedFromHand: boolean): void;
  /** This attack's Fragment ability triggered after a 2+ defense card defended it. */
  onFragment?(ctx: ScriptCtx): void;
  /** An individual effect increased the current attack's power during the
   * reaction step. `amount` is the change caused by that one engine command,
   * not the attack's aggregate bonus. */
  onFriendlyAttackPowerGained?(ctx: ScriptCtx, amount: number): void;
  /** Legacy card-data marker retained for script compatibility. Defend costs
   * are paid by requestPayment/requestXPayment when the trigger resolves. */
  defendCost?: number;
  /** State-based destruction (Suspense's "when this has no suspense counters,
   *  destroy it"): at intent boundaries, a board permanent whose named counter
   *  was explicitly reduced to 0 is destroyed. A counter the card never
   *  received doesn't trigger it — a properly-entered permanent always got
   *  its entering counters from its ETB effect. */
  destroyAtZeroCounter?: string;
  /** This card was charged into a hero's soul (Solflare). */
  onCharged?(ctx: ScriptCtx): void;
  /** A card owned by this source's controller was put into their hero's soul.
   * `charged` distinguishes the Charge additional cost from other effects. */
  onCardPutIntoSoul?(
    ctx: ScriptCtx,
    card: DeepReadonly<CardInstance>,
    charged: boolean,
  ): void;
  /** Dynamic adjustment of this card's own play cost ("this costs {r} less
   *  to play if …"): consulted in enumeration AND validation — must be pure. */
  modifyPlayCost?(ctx: ScriptCtx, baseCost: number): number;
  /** This card became the controller's hero (an effect made their hero
   *  become this card) — fires once right after the swap ("when you become
   *  this, you may search your deck …"). */
  onBecomeHero?(ctx: ScriptCtx): void;
  /** A card was put face up into this script's controller's arsenal by an
   *  effect (`ctx.putIntoArsenal`). Fires for the entering card itself ("when
   *  this is put face-up into your arsenal") and for the controller's
   *  permanents ("whenever an arrow is put face up into your arsenal from
   *  your deck"). `from` names the zone it came from ("hand" / "deck"). */
  onEnterArsenal?(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, from: string): void;
  /** This permanent was destroyed. */
  onDestroyed?(ctx: ScriptCtx): void;
  /** This Runechant permanent was usurped by the current attack. The Usurp
   * procedure is supplied by attacking-card scripts; the aura owns its
   * resulting effect. */
  onUsurped?(ctx: ScriptCtx, attack: DeepReadonly<CardInstance>): void;
  /** A permanent this source's controller controlled was destroyed. */
  onFriendlyDestroyed?(
    ctx: ScriptCtx,
    destroyed: DeepReadonly<CardInstance>,
    destroyingSeat?: number,
  ): void;
  /** A card owned by this source's controller entered their banished zone. */
  onCardBanished?(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, from: string): void;
  /** This card entered its owner's banished zone. Unlike onCardBanished, the
   * source need not remain active after the move. */
  onSelfBanished?(ctx: ScriptCtx, from: string): void;
  /** This source's controller banished a card owned by an opposing hero. */
  onFriendlyBanishesOpponentCard?(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): void;
  /** A card owned by this source's controller left their graveyard. */
  onCardLeavesGraveyard?(
    ctx: ScriptCtx,
    card: DeepReadonly<CardInstance>,
    to: string,
  ): void;
  /** Prevent an opposing effect from destroying a friendly permanent. This
   * replacement is consulted only when the acting seat is an opponent. */
  preventsOpponentDestroyingFriendly?(
    ctx: ScriptCtx,
    target: DeepReadonly<CardInstance>,
  ): boolean;
  /** An attack this card's controller declared was lost: their attack action
   *  card was destroyed by Phantasm (`cause: "phantasm"`, card = the destroyed
   *  attack), or an ally they control died while it was the attacking card of
   *  a chain link (`cause: "ally-died"`, card = the ally). Fires on the
   *  controller's OTHER permanents (hero, equipment, board) — e.g. Silent
   *  Stilettos. */
  onFriendlyAttackLost?(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, cause: "phantasm" | "ally-died"): void;
  /** Called for each attacking object immediately before a resolved combat
   * chain closes and its chain cards settle. */
  onCombatChainClosed?(ctx: ScriptCtx): void;
  /** Called for this defending card immediately before its resolved combat
   * chain closes and the card settles. */
  onDefendingCombatChainClosed?(ctx: ScriptCtx): void;
  /** Aura attacks (Iris, Cosmo, Reality Refractor): matching ready auras get a
   *  once-per-turn attack ability. `requiresClass`, `requiresSubtype`, and
   *  `requiresWard` constrain the grant; `basePower` overrides the aura's Ward
   *  value. With `goAgain`, the granted attack ability has go again. With
   *  `goAgainWithPowerCounter`, such an attack has go again while the
   *  attacking card has a +1{p} counter (evaluated at link resolution). */
  grantsAuraAttack?: {
    cost: number;
    goAgain?: boolean;
    goAgainWithPowerCounter?: boolean;
    basePower?: number;
    requiresClass?: string;
    requiresSubtype?: string;
    requiresWard?: boolean;
  };
  /** Continuously grant Crank to matching permanents this source's controller
   * controls. Consulted as each permanent enters the arena. */
  grantsCrankToFriendly?(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean;
  /** Adjusts the resource cost of a weapon/aura attack activation (consulted
   *  on the attacking player's hero and permanents, in enumeration AND
   *  validation — must be pure; per-turn flags live in the script). */
  modifyAttackActivationCost?(ctx: ScriptCtx, attacker: DeepReadonly<CardInstance>, baseCost: number): number;
  /** Adjust any activated ability's resource cost. The ability source is
   * supplied so effects may constrain the discount to hero abilities. */
  modifyActivatedAbilityCost?(ctx: ScriptCtx, source: DeepReadonly<CardInstance>, baseCost: number): number;
  /** The crowd booed this hero (fires on the hero script after the flag is set). */
  onBooed?(ctx: ScriptCtx): void;
  /** The crowd cheered this hero (fires on the hero script after the flag is set). */
  onCheered?(ctx: ScriptCtx): void;
  /** This card was revealed for a clash. `won` is false for a loss or tie. */
  onClashRevealed?(ctx: ScriptCtx, won: boolean, opposingSeat: number): void;
  /** This revealed card replaces a failed clash result with a win. */
  failedClashBecomesWin?: { booController?: boolean };
  /** When a clash has no winner, this hero's controller chooses which
   * participating hero wins. */
  choosesFailedClashWinner?: boolean;
  /** Result of a clash requested by this source. `winner` is -1 for no winner. */
  onClashResult?(ctx: ScriptCtx, resultHook: string, winner: number): void;
  /** Declarative first-failed-clash replacement supplied by a hero script. */
  firstFailedClashReplacement?: {
    costPermanentName: string;
    choiceHook: string;
  };
  /** Continuous modification of a card's base power. Called first on the card
   *  itself for characteristic-defining abilities, then on its controller's
   *  hero for effects that apply to cards the hero controls. */
  modifyBasePower?(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, base: number): number;
  /** Stage-3 multiplication of a card's base power, after effects that set
   *  its base value and before effects that divide it. */
  multiplyBasePower?(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, base: number): number;
  /** Stage-4 division of a card's base power, after all multiplication
   *  effects. The hook owns any required rounding rule. */
  divideBasePower?(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, base: number): number;
  /** Continuous modification of a card's base defense. Called first on the
   *  card itself, then on its controller's hero. */
  modifyBaseDefense?(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, base: number): number;
  /** Ties in life comparisons count as the controller having more {h} (and the
   *  other hero less) while this permanent is in play. */
  lifeTiebreak?: boolean;
  /** While this permanent is in play, a hero who has more life than every
   *  other hero can't gain life (Reaping Blade-style static effect). */
  preventsLifeGainWhileAhead?: boolean;
  /** Dynamic Spellvoid value for equipment whose prevention amount is not a
   *  fixed number ("Spellvoid X, where X is …"): consulted whenever the
   *  equipment's Spellvoid is enumerated or applied — must be pure. */
  spellvoidValue?(ctx: ScriptCtx): number;
  /** Arcane Barrier X permits any positive payment up to the incoming damage. */
  arcaneBarrierX?: boolean;
  /** Dynamic Ward value for permanents whose prevention amount is defined by
   * counters or another changing quantity. */
  wardValue?(ctx: ScriptCtx): number;
  /** While this source is in the arena, matching permanents cannot untap. */
  preventsUntapOf?(ctx: ScriptCtx, target: DeepReadonly<CardInstance>): boolean;
  /** Meld split card (CR 8.3.38): play intents ask for a side at play time
   *  (left/right/both — both costs twice the base cost) and stamp the choice
   *  on the card (`CardInstance.meldSide`) for onPlay to read. */
  meld?: {
    leftName: string;
    rightName: string;
    leftCardType: CardType;
    rightCardType: CardType;
  };
  /** Answer to a requestChoice hook. */
  onChoose?(ctx: ScriptCtx, hook: string, optionId: string): void;
  /** Atomic answer to a bounded requestCardChoices hook. */
  onChooseMany?(ctx: ScriptCtx, hook: string, optionIds: readonly string[]): void;
  /** Triggered abilities: queued as stack layers when their event fires. */
  triggers?: TriggerDef[];
  /** Graveyard replacement applied before the card enters the graveyard. */
  graveyardReplacement?:
    | "bottom-of-deck"
    | "banish"
    | "cease-to-exist"
    | ((ctx: ScriptCtx) => "bottom-of-deck" | "banish" | "cease-to-exist" | undefined);
}
