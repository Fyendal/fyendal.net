import type { GameLogEvent, GameLogPayload, GameMessage } from "./types.js";

type FlagValue = number | boolean;
export type PlayFromZoneOwner = "own" | "opponent" | "both";
export interface PersistedCardInstanceV1 {
  instanceId: number;
  cardId: string;
  owner: number;
  pitchCount?: number;
  subcards?: PersistedCardInstanceV1[];
  faceDown?: boolean;
  intimidated?: true;
  returnToHandAtTurn?: number;
  tapped?: boolean;
  defCounters?: number;
  counters?: Record<string, number>;
  chosenName?: string;
  playableFrom?: ("banish" | "graveyard" | "deck")[];
  playableFromSourceCardId?: string;
  playableFromSingleUseGroup?: string;
  playableBySeat?: number;
  playableFromExpiry?: number;
  playableFromEndTurnExpiry?: number;
  playableFromUntilStartOfSeatTurn?: number;
  playableFromUntilEndOfSeatTurn?: number;
  playableFromGrantedTurn?: number;
  playableFromUntilChainClose?: boolean;
  playCostReduction?: number;
  playCostReductionSeat?: number;
  playTargetInstanceId?: number;
  boundToInstanceId?: number;
  grantedTypes?: string[];
  grantedColor?: 1 | 2 | 3 | 4;
  grantedNames?: string[];
  originalHeroCardId?: string;
  temporaryHeroOriginalCardId?: string;
  temporaryHeroUntilTurn?: number;
  grantedBaseAbilitiesCardId?: string;
  grantedBaseAbilitiesCardIds?: string[];
  copyOriginalCardId?: string;
  grantedKeywords?: string[];
  suppressedKeywords?: string[];
  tempPower?: number;
  tempDefense?: number;
  temporaryAlly?: { power: number; life: number };
  meldSide?: "left" | "right" | "both";
  life?: number;
  damagePrevented?: { targetSeat: number; amount: number };
  flipped?: boolean;
  arsenalSlot?: number;
  temporaryGraveyardReplacement?: "banish";
  playableAsInstant?: boolean;
}

export interface PersistedStackLayerV1 {
  sourceInstanceId: number;
  seat: number;
  triggerIndex: number;
  triggerCount?: number;
  triggerBatchStarted?: true;
  triggerSource?: PersistedCardInstanceV1;
  triggerEventCard?: PersistedCardInstanceV1;
  label: string;
  optional: boolean;
  defaultOption?: "yes" | "no";
  accepted?: boolean;
  card?: PersistedCardInstanceV1;
  goAgain?: boolean;
  ability?: boolean;
  abilityCard?: PersistedCardInstanceV1;
  abilityIndex?: number;
  targetCardInstanceId?: number;
  resolvedReactionAbility?: true;
  fromHand?: boolean;
  meldStage?: 1 | 2;
  engineEffect?:
    | { kind: "gain-action-points"; amount: number }
    | { kind: "lose-life"; amount: number }
    | { kind: "phantasm-destroy" }
    | { kind: "spectra-destroy" }
    | { kind: "watery-grave" }
    | { kind: "wager-result"; wagerIndex: number }
    | { kind: "on-hit-hook"; source: PersistedCardInstanceV1 }
    | { kind: "on-effect-hit-hook"; source: PersistedCardInstanceV1; targetSeat: number }
    | { kind: "on-friendly-effect-hit-hook"; source: PersistedCardInstanceV1; hitSource: PersistedCardInstanceV1; targetSeat: number; targetWasMarked: boolean }
    | { kind: "on-defend-hook"; source: PersistedCardInstanceV1 }
    | { kind: "on-friendly-defended-hook"; source: PersistedCardInstanceV1; defendedFromHand: boolean }
    | { kind: "on-defended-modifier"; modifier: PersistedModifierV1 }
    | { kind: "fragment"; source: PersistedCardInstanceV1 }
    | { kind: "on-fragment-hook"; source: PersistedCardInstanceV1 }
    | { kind: "delayed-trigger"; source: PersistedCardInstanceV1; hook: string }
    | { kind: "on-hit-modifier"; modifier: PersistedModifierV1 };
}

export interface PersistedDelayedTriggerV1 {
  source: PersistedCardInstanceV1;
  seat: number;
  subjectSeat: number;
  event: "start-of-turn" | "end-of-turn";
  turn: number;
  hook: string;
  label: string;
  labelMessage?: GameMessage;
}

export interface PersistedPlayerV1 {
  seat: number;
  hero: PersistedCardInstanceV1;
  heroCardId: string;
  life: number;
  intellect: number;
  hand: PersistedCardInstanceV1[];
  deck: PersistedCardInstanceV1[];
  arsenal: PersistedCardInstanceV1[];
  pitch: PersistedCardInstanceV1[];
  graveyard: PersistedCardInstanceV1[];
  banish: PersistedCardInstanceV1[];
  soul: PersistedCardInstanceV1[];
  inventory?: PersistedCardInstanceV1[];
  equipment: Partial<Record<"head" | "chest" | "arms" | "legs", PersistedCardInstanceV1>>;
  weapons: PersistedCardInstanceV1[];
  board: PersistedCardInstanceV1[];
  resources: number;
  chi: number;
  actionPoints: number;
  flags: Record<string, FlagValue>;
}

export interface PersistedChainLinkV1 {
  attacker: number;
  attackingCard: PersistedCardInstanceV1;
  attackCardType: "action" | "weapon" | "ally";
  defendingCards: PersistedCardInstanceV1[];
  defendingEquipment: PersistedCardInstanceV1[];
  reactions: PersistedCardInstanceV1[];
  resolvedReactionAbilitySources?: PersistedCardInstanceV1[];
  goAgain: boolean;
  damage: number;
  hit: boolean;
  resolved: boolean;
  finalAttack?: number;
  finalDefense?: number;
  finalAttackModifiers?: PersistedCombatValueModifierV1[];
  finalDefenseModifiers?: PersistedCombatValueModifierV1[];
  targetAllyId?: number;
  declaredAtNextId?: number;
  wagerRewards?: string[];
  wagers?: PersistedWagerV1[];
  flags: Record<string, FlagValue>;
}

export interface PersistedWagerV1 {
  source: PersistedCardInstanceV1;
  controllerSeat: number;
  opposingSeat: number;
  rewardCardIds: string[];
  rewardLabel: string;
}

export interface PersistedCombatValueModifierV1 {
  sourceInstanceId: number;
  sourceCardId: string;
  amount: number;
}

export interface PersistedModifierV1 {
  id: number;
  sourceInstanceId: number;
  sourceCardId?: string;
  seat: number;
  scope: "chain-link" | "next-attack" | "until-end-of-turn" | "static" | "combat-chain" | "next-play";
  expiresAtStartOfTurn?: number;
  expiresAtEndOfTurn?: number;
  expiresAtStartOfSeatTurn?: number;
  expiresAtEndOfSeatTurn?: number;
  createdTurn?: number;
  basePower?: number;
  attack?: number;
  powerGainBonus?: number;
  attackActivationCostReduction?: number;
  activationCostReduction?: number;
  attackCostReduction?: number;
  piercing?: number;
  defense?: number;
  appliesToEquipment?: boolean;
  appliesToFirstDefenderOnly?: boolean;
  damage?: number;
  damageUnpreventable?: boolean;
  goAgain?: boolean;
  dominate?: boolean;
  overpower?: boolean;
  overpowerIfNameContains?: string;
  intimidate?: number;
  grantType?: string;
  grantName?: string;
  preventNextDamageAmount?: number;
  preventNextDamagePool?: number;
  preventDamagePerEvent?: number;
  preventDamageEventsRemaining?: number;
  discardDamagePreventionCardType?: string;
  discardDamagePreventionAmount?: number;
  discardDamagePreventionDraw?: number;
  preventLethalDamageByBanishingNamedCard?: string;
  preventNextDamageFromPitch?: number;
  preventAllDamageFromSource?: boolean;
  banishPreventedDamageSourceFaceDownIfType?: string;
  maxDamageEventAmount?: number;
  reflectPreventedDamageToSeat?: number;
  reflectPreventedDamageUnpreventable?: boolean;
  appliesToDamageSourceType?: string;
  appliesToDamageRecipientType?: string;
  redirectDamageFromSeat?: number;
  redirectDamageToSeat?: number;
  redirectDamagePrevent?: number;
  grantKeyword?: string;
  suppressKeyword?: string;
  onHitGoAgain?: boolean;
  onHitGainLife?: number;
  onHitGainResources?: number;
  onHitCreateToken?: { cardId: string; count: number };
  onHitDraw?: number;
  prohibitsName?: string;
  grantsTypeToName?: string;
  grantsType?: string;
  suppressesHeroAbilities?: boolean;
  suppressesHeroAbilitiesDuringActionPhase?: boolean;
  suppressesOwnedNames?: boolean;
  suppressesOwnedClassTalentTypes?: boolean;
  attackActionCardCap?: number;
  nonAttackActionCardCap?: number;
  restrictActionsToWeaponOrAttack?: boolean;
  restrictActionsToNonWeaponNonAttack?: boolean;
  prohibitsDefenseReactionNamesInGraveyard?: boolean;
  goAgainIfDefendedByAttackAction?: boolean;
  goAgainIfPlayedOrCreatedSubtype?: string;
  goAgainIfAttackPowerAtLeast?: number;
  onDefendedDealDamage?: number;
  onHitLoseLife?: number;
  suppressHitEffects?: boolean;
  defendingPitchDefenseAdjustment?: { pitch: number; amount: number; requiresAimCounter?: boolean };
  onDestroyedDraw?: number;
  onHitToSoul?: boolean;
  onHitBottomDeck?: boolean;
  onHitReenableAttacker?: boolean;
  onHitReenableAttackerIfMarked?: boolean;
  onHitMark?: boolean;
  onBoostAttack?: number;
  onBoostDominate?: boolean;
  onActionPlayedGainActionPoints?: number;
  onAttackActionPlayedFromBanishCreateToken?: { cardId: string; count: number };
  onFriendlyActivateCreateToken?: string;
  extraDiceIgnoreLowest?: number;
  onHitClearHandAndArsenalAtEndPhase?: boolean;
  onHitDealDamage?: number;
  onHitScriptHook?: {
    hook: string;
    label: string;
    heroOnly?: boolean;
    requiresAttackCounter?: string;
    requiresAttackNameContains?: string;
  };
  onHitDestroyTopDeckCards?: { count: number; minimumDamage: number };
  replaceCombatDamageWithDefendingEquipment?: boolean;
  onDamageDealtCreateTokenPerPoint?: string;
  onPreventCreateToken?: string;
  defendedLessThanNonEquip?: number;
  appliesTo?: "any" | "attack" | "weapon" | "sword" | "attack-action";
  appliesToClass?: string;
  minCost?: number;
  maxCost?: number;
  maxBasePower?: number;
  minBasePower?: number;
  minimumAttackBasePower?: number;
  appliesToKeyword?: string;
  appliesToSubtype?: string | string[];
  appliesToType?: string[];
  appliesToName?: string;
  appliesToInstanceId?: number;
  appliesToTargetType?: string;
  appliesToTargetNamePrefix?: string;
  appliesToMarkedHero?: boolean;
  excludesSubtype?: string;
  appliesToCardType?: string;
  restrictCardPlaysToType?: string;
  ongoingLabel?: string;
  grantsPlayFromZone?: "banish" | "graveyard" | "deck";
  grantsPlayFromZoneOwner?: PlayFromZoneOwner;
  playBaseCostOverride?: number;
  grantsPlayFromNameContains?: string;
  suppressesActivatedAbilitiesOfInstanceId?: number;
  cannotDefendWithInstanceId?: number;
  appliesToPitch?: number;
  playCostReduction?: number;
  remainingCostUses?: number;
  appliesToFromArsenal?: boolean;
  appliesToRuneGated?: boolean;
  appliesToCharged?: boolean;
  noDefenseReactionsFromArsenal?: boolean;
  noDefenseReactionsFromHand?: boolean;
  maxNonBlockDefenders?: number;
  onDefendedByAttackActionPowerCounters?: number;
  once?: boolean;
  expiresOnChainClose?: boolean;
  consumed?: boolean;
}

export interface PersistedPendingArcaneV1 {
  sourceInstanceId: number;
  sourceSeat: number;
  sourceIsAlly?: boolean;
  sourceIsRunechant?: true;
  targetSeat: number;
  amount: number;
  arcane: boolean;
  countsAsHit?: boolean;
  destroySourceAfterDamage?: true;
  targetWasMarked?: boolean;
  targetAllyId?: number;
  combat?: boolean;
  combatDamageEquipmentReplacementIds?: number[];
  unpreventable?: boolean;
  payTotal?: number;
  arcaneBarrierResolved?: true;
  usedQuellSourceIds?: number[];
  usedDiscardDamagePreventionModifierIds?: number[];
  usedSoulDamagePreventionSourceIds?: number[];
  soulDamagePreventionSourceInstanceId?: number;
  lethalDamagePreventionModifierId?: number;
  quellSourceInstanceId?: number;
  queue?: PersistedPendingArcaneV1[];
}

export type PersistedDecisionResumeV1 =
  | { kind: "stack-card"; seat: number; card: PersistedCardInstanceV1 }
  | { kind: "continue-play-after-declaration"; seat: number; instanceId: number; pitchInstanceIds: number[]; from: "hand" | "arsenal" | "banish" | "graveyard" | "deck"; meldSide?: "left" | "right" | "both"; targetAllyId?: number; boost?: boolean; boostCount?: number; asInstant?: boolean; alternativeCostCardInstanceIds?: number[]; targetCardInstanceId?: number; declaredVariableX?: number }
  | { kind: "finish-play"; seat: number; card: PersistedCardInstanceV1; from: "hand" | "arsenal" | "banish" | "graveyard" | "deck"; targetAllyId?: number; boost?: boolean; boostCount?: number; asInstant?: boolean }
  | { kind: "finish-reaction"; seat: number; card: PersistedCardInstanceV1; from: "hand" | "arsenal" | "banish" | "graveyard" | "deck" }
  | { kind: "finish-window-instant"; seat: number; card: PersistedCardInstanceV1; from: "hand" | "arsenal" | "banish" | "graveyard" | "deck" }
  | { kind: "after-declare" }
  | { kind: "start-reaction-step" }
  | { kind: "after-resolution" }
  | { kind: "continue-stack"; seat?: number }
  | { kind: "finish-wager-result"; wagerIndex: number }
  | { kind: "continue-wager-loss-replacements"; wagerIndex: number; remainingSourceInstanceIds: number[] }
  | { kind: "continue-wager-prizes"; wagerIndex: number }
  | { kind: "reopen-reaction"; seat: number }
  | { kind: "game-setup"; nextSeat: number };

export interface PersistedPendingDecisionV1 {
  player: number;
  kind: "defend" | "attack-reaction" | "defense-reaction" | "priority-window" | "arsenal" | "choose-target" | "choose-name" | "order-triggers" | "optional-effect";
  prompt: string;
  promptMessage?: GameMessage;
  options?: string[];
  minimumSelections?: number;
  maximumSelections?: number;
  defaultOption?: string;
  optionLabels?: string[];
  optionMessages?: (GameMessage | null)[];
  optionCounts?: (number | null)[];
  sourceInstanceId?: number;
  scriptSourceSnapshot?: { seat: number; card: PersistedCardInstanceV1 };
  chooseHook?: string;
  followUpDecisions?: PersistedPendingDecisionV1[];
  tokenCreationCause?: { kind: "effect" | "wager"; sourceCardId?: string };
  cardOptions?: (number | string | null)[];
  revealedCardIds?: number[];
  lookedCardIds?: number[];
  payment?: { pitchOptions: Record<string, { cost: number; pitchIds: number[]; result: string }> };
  resourcePayment?: {
    cost: number;
    options: { optionId: string; pitchInstanceIds: number[] }[];
  };
  xPayment?: { choices: Record<string, { cost: number; result: string }> };
  variablePlayCost?: {
    mode: "action" | "reaction" | "window";
    seat: number;
    instanceId: number;
    from: "hand" | "arsenal" | "banish" | "graveyard" | "deck";
    choices?: Record<string, { x: number; cost: number }>;
    declaredX?: number;
    paymentOptions?: Record<string, { pitchInstanceIds: number[] }>;
    meldSide?: "left" | "right" | "both";
    targetAllyId?: number;
    targetCardInstanceId?: number;
    boost?: boolean;
    boostCount?: number;
    asInstant?: boolean;
    alternativeCostCardInstanceIds?: number[];
  };
  variableActivationCost?: {
    mode: "action" | "window";
    seat: number;
    sourceInstanceId: number;
    abilityIndex: number;
    choices?: Record<string, { x: number; cost: number }>;
    declaredX?: number;
    paymentOptions?: Record<string, { pitchInstanceIds: number[] }>;
  };
  tokenCreationReplacement?: {
    seat: number;
    cardId: string;
    count: number;
    cause: { kind: "effect" | "wager"; sourceCardId?: string };
    initialCounters?: Record<string, number>;
    remainingReplacements: { instanceId: number; kind: "global" | "friendly" | "optional-friendly" }[];
    controllerSeats?: number[];
  };
  tokenCreationReplacementOrder?: {
    seat: number;
    cardId: string;
    count: number;
    cause: { kind: "effect" | "wager"; sourceCardId?: string };
    initialCounters?: Record<string, number>;
    remainingReplacements: { instanceId: number; kind: "global" | "friendly" | "optional-friendly" }[];
    controllerSeats?: number[];
  };
  wagerLossReplacementOrder?: {
    wagerIndex: number;
    remainingSourceInstanceIds: number[];
  };
  activationCost?: {
    mode: "action" | "window";
    seat: number;
    sourceInstanceId: number;
    abilityIndex: number;
    pitchInstanceIds: number[];
    targetAllyId?: number;
    soulInstanceIds?: number[];
    discardInstanceIds?: number[];
    effectCostInstanceIds?: number[];
    alternativeCostCardInstanceIds?: number[];
  };
  clash?: {
    request: { sourceSeat: number; sourceInstanceId: number; opposingSeat: number; resultHook: string };
    attempt: { winner: number; revealed: { seat: number; instanceId: number }[] };
    replacementSeats: number[];
    replacementIndex: number;
    stage: "offer" | "bottom" | "winner-choice";
    chosenReplacementSeat?: number;
    queue: { sourceSeat: number; sourceInstanceId: number; opposingSeat: number; resultHook: string }[];
  };
  arcane?: PersistedPendingArcaneV1;
  triggerOrder?: {
    remaining: PersistedStackLayerV1[];
    later: { seat: number; layers: PersistedStackLayerV1[] }[];
    baseStack?: PersistedStackLayerV1[];
  };
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
  staged?: number[];
  resume?: PersistedDecisionResumeV1;
}

export interface PersistedGameLogEntryV1 {
  publicText: string | null;
  seatText?: [string | null, string | null];
  sequence?: number;
  publicPayload?: GameLogPayload;
  seatPayloads?: [GameLogPayload | null, GameLogPayload | null];
}

export interface PersistedGameTurnStatsV1 {
  turn: number;
  activePlayer: number;
  attacks: [number, number];
  threatened: [number, number];
  blocked: [number, number];
  damageDealt: [number, number];
  /** Added compatibly after the initial persisted-state baseline. */
  allyAbsorbed?: [number, number];
  lifeGained?: [number, number];
  lifeLost?: [number, number];
}

export interface PersistedGameStatsV1 {
  turns: PersistedGameTurnStatsV1[];
}

/** Frozen persistence DTO. Runtime engine types must not be substituted here:
 * adding an engine field is intentionally a compile error in the encoder. */
export interface PersistedGameStateV1 {
  seed: number;
  rngState: number;
  nextInstanceId: number;
  nextModifierId: number;
  /** Optional for rooms written before rule-defined global objects existed. */
  globalCardIds?: string[];
  turn: number;
  activePlayer: number;
  priorityPlayer: number;
  phase: "start" | "action" | "layer" | "reaction" | "defend" | "end" | "game-over";
  players: [PersistedPlayerV1, PersistedPlayerV1];
  chain: PersistedChainLinkV1[];
  resolving: PersistedCardInstanceV1[];
  pendingDecision: PersistedPendingDecisionV1 | null;
  pendingTokenCreations: {
    seat: number;
    cardId: string;
    count: number;
    cause: { kind: "effect" | "wager"; sourceCardId?: string };
    initialCounters?: Record<string, number>;
  }[];
  reactionPasses: number;
  stack: PersistedStackLayerV1[];
  /** Optional for rooms written before pending triggered layers were explicit. */
  pendingTriggeredLayers?: PersistedStackLayerV1[];
  stackPasses: number;
  stackResume: "begin-action" | "begin-action-phase" | "grant-turn-action" | "end-action-phase" | "start-attack-step" | "continue-attack" | "start-reaction-step" | "finish-link-resolution" | "end-phase" | null;
  modifiers: PersistedModifierV1[];
  /** Optional for rooms written before delayed triggers were explicit. */
  delayedTriggers?: PersistedDelayedTriggerV1[];
  pendingDestructions: { seat: number; instanceId: number }[];
  controlReturns: { instanceId: number; thiefSeat: number; homeSeat: number }[];
  /** Optional for rooms written before extra turns were represented. */
  extraTurnSeats?: number[];
  /** Optional only so rooms written before match counters were introduced can
   * hydrate safely; all newly encoded states include it. */
  gameStats?: PersistedGameStatsV1;
  /** Optional until the first structured log event is emitted. */
  nextLogSequence?: number;
  log: PersistedGameLogEntryV1[];
  /** Null during play and after a draw; phase distinguishes the two. */
  winner: number | null;
  drawOfferSeat?: number;
}


export interface BotSimulationSnapshotV1 {
  schemaVersion: 1;
  rulesetVersion: string;
  state: PersistedGameStateV1;
}
