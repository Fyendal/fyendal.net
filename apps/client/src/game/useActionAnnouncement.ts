import { useCallback, useEffect, useReducer } from "react";
import type { CardView, EquipmentSlot, GameIntent, MeldSide, PlayableZone } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import {
  actionSelectionVariants,
  intentBoostCount,
  paidActionCandidates,
  actionPaymentProgress,
  selectedActionIntent,
} from "./legalSelection.js";

export type Sel =
  | { kind: "none" }
  | { kind: "choose-hand-action"; instanceId: number }
  | { kind: "play-hand"; instanceId: number }
  | { kind: "play-arsenal"; instanceId: number }
  | { kind: "play-zone"; instanceId: number; zone: PlayableZone }
  | { kind: "activate"; sourceInstanceId: number; abilityIndex?: number };

export type ActionStep =
  | "method"
  | "ability"
  | "payment"
  | "boost"
  | "target"
  | "close-chain"
  | "confirm";
export type PlayMethod = "action" | "instant";

export interface AnnouncementState {
  sel: Sel;
  pitchSel: number[];
  meldSide: MeldSide | null;
  targetAllyId: number | null | undefined;
  targetCardInstanceId: number | null;
  boostCount: number | null;
  playMethod: PlayMethod | null;
  chainCloseConfirmed: boolean;
  commitConfirmed: boolean;
  /** An arena drop confirms the play once its required choices are complete. */
  playConfirmedByDrop: boolean;
  alternativeCostCardInstanceIds: number[] | null | undefined;
  additionalCostConfirmed: boolean;
}

export type AnnouncementAction =
  | { type: "reset" }
  | { type: "select"; sel: Sel }
  | { type: "play-hand-from-drop"; instanceId: number }
  | { type: "toggle-pitch"; instanceId: number }
  | { type: "clear-pitch" }
  | { type: "select-ability"; abilityIndex: number }
  | { type: "select-meld"; meldSide: MeldSide }
  | { type: "select-play-method"; playMethod: PlayMethod }
  | { type: "select-ally-target"; targetAllyId: number | null }
  | { type: "select-card-target"; targetCardInstanceId: number }
  | { type: "select-boost"; boostCount: number }
  | { type: "confirm-chain-close" }
  | { type: "confirm-action" }
  | { type: "select-alternative-cost"; instanceIds: number[] | null }
  | {
      type: "toggle-additional-cost-card";
      instanceId: number;
      selectionSource: "alternative" | "payment";
    }
  | { type: "confirm-additional-cost" };

export const INITIAL_ANNOUNCEMENT: AnnouncementState = {
  sel: { kind: "none" },
  pitchSel: [],
  meldSide: null,
  targetAllyId: undefined,
  targetCardInstanceId: null,
  boostCount: null,
  playMethod: null,
  chainCloseConfirmed: false,
  commitConfirmed: false,
  playConfirmedByDrop: false,
  alternativeCostCardInstanceIds: undefined,
  additionalCostConfirmed: false,
};

export function committedActionIntent(
  intent: GameIntent | null,
  paymentReady: boolean,
  commitConfirmed: boolean,
  chainCloseConfirmationRequired: boolean,
  chainCloseConfirmed: boolean,
): GameIntent | null {
  if (
    !intent ||
    !paymentReady ||
    !commitConfirmed ||
    (chainCloseConfirmationRequired && !chainCloseConfirmed)
  ) return null;
  return intent;
}

export function isAnnouncementPaymentReady(
  paidVariantCount: number,
  hasAlternativeCosts: boolean,
  hasStagedCardCost: boolean,
  cardCostConfirmed: boolean,
  alternativeCostSelected: boolean,
): boolean {
  if (paidVariantCount === 0) return false;
  if (hasStagedCardCost) return cardCostConfirmed;
  return !hasAlternativeCosts || alternativeCostSelected;
}

function clearChoices(state: AnnouncementState): AnnouncementState {
  return {
    ...state,
    boostCount: null,
    chainCloseConfirmed: false,
    commitConfirmed: false,
    targetAllyId: undefined,
    targetCardInstanceId: null,
  };
}

/** Payment follows the declared Boost and targets, so redeclaring them restarts it. */
function clearPayment(state: AnnouncementState): AnnouncementState {
  return {
    ...state,
    pitchSel: [],
    alternativeCostCardInstanceIds: undefined,
    additionalCostConfirmed: false,
    chainCloseConfirmed: false,
    commitConfirmed: false,
  };
}

function clearCommit(state: AnnouncementState): AnnouncementState {
  return { ...state, chainCloseConfirmed: false, commitConfirmed: false };
}

export function actionAnnouncementReducer(
  state: AnnouncementState,
  action: AnnouncementAction,
): AnnouncementState {
  switch (action.type) {
    case "reset":
      return INITIAL_ANNOUNCEMENT;
    case "select":
      return { ...INITIAL_ANNOUNCEMENT, sel: action.sel };
    case "play-hand-from-drop":
      return {
        ...(state.sel.kind === "play-hand" && state.sel.instanceId === action.instanceId
          ? state
          : INITIAL_ANNOUNCEMENT),
        sel: { kind: "play-hand", instanceId: action.instanceId },
        playConfirmedByDrop: true,
      };
    case "toggle-pitch":
      return {
        ...state,
        commitConfirmed: false,
        // When an alternative cost is available, beginning to pitch is the
        // user's declaration that they are paying the normal resource cost.
        // Preserve an explicitly selected alternative cost because it may
        // still have resource taxes of its own.
        alternativeCostCardInstanceIds:
          state.alternativeCostCardInstanceIds === undefined
            ? null
            : state.alternativeCostCardInstanceIds,
        pitchSel: state.pitchSel.includes(action.instanceId)
          ? state.pitchSel.filter((id) => id !== action.instanceId)
          : [...state.pitchSel, action.instanceId],
      };
    case "clear-pitch":
      return { ...state, pitchSel: [], commitConfirmed: false };
    case "select-ability":
      return clearChoices({
        ...state,
        sel: state.sel.kind === "activate"
          ? { ...state.sel, abilityIndex: action.abilityIndex }
          : state.sel,
        pitchSel: [],
        alternativeCostCardInstanceIds: undefined,
      });
    case "select-meld":
      return clearChoices({
        ...state,
        meldSide: action.meldSide,
        pitchSel: [],
        alternativeCostCardInstanceIds: undefined,
      });
    case "select-play-method":
      return clearChoices({
        ...state,
        playMethod: action.playMethod,
        pitchSel: [],
        alternativeCostCardInstanceIds: undefined,
      });
    case "select-ally-target":
      return clearPayment({ ...state, targetAllyId: action.targetAllyId });
    case "select-card-target":
      return clearPayment({ ...state, targetCardInstanceId: action.targetCardInstanceId });
    case "select-boost":
      return clearPayment({
        ...state,
        boostCount: action.boostCount,
        targetAllyId: undefined,
        targetCardInstanceId: null,
      });
    case "confirm-chain-close":
      return { ...state, chainCloseConfirmed: true, commitConfirmed: true };
    case "confirm-action":
      return { ...state, commitConfirmed: true };
    case "select-alternative-cost":
      return clearCommit({
        ...state,
        pitchSel: [],
        alternativeCostCardInstanceIds: action.instanceIds,
        additionalCostConfirmed: true,
      });
    case "toggle-additional-cost-card": {
      if (action.selectionSource === "payment") {
        return clearCommit({
          ...state,
          pitchSel: state.pitchSel.includes(action.instanceId)
            ? state.pitchSel.filter((id) => id !== action.instanceId)
            : [...state.pitchSel, action.instanceId],
          additionalCostConfirmed: false,
        });
      }
      const selected = Array.isArray(state.alternativeCostCardInstanceIds)
        ? state.alternativeCostCardInstanceIds
        : [];
      const next = selected.includes(action.instanceId)
        ? selected.filter((id) => id !== action.instanceId)
        : [...selected, action.instanceId];
      return clearCommit({
        ...state,
        pitchSel: [],
        alternativeCostCardInstanceIds: next.length > 0 ? next : undefined,
        additionalCostConfirmed: false,
      });
    }
    case "confirm-additional-cost":
      return { ...state, additionalCostConfirmed: true, commitConfirmed: false };
  }
}

function isPlayIntent(intent: GameIntent): intent is Extract<
  GameIntent,
  { kind: "play-card" | "play-from-arsenal" | "play-from-zone" }
> {
  return intent.kind === "play-card" || intent.kind === "play-from-arsenal" ||
    intent.kind === "play-from-zone";
}

export function requiresChainCloseConfirmation(
  intent: GameIntent,
  chainClosingPlayIds: ReadonlySet<number>,
): boolean {
  if (!isPlayIntent(intent)) return false;
  return intent.asInstant !== true && chainClosingPlayIds.has(intent.instanceId);
}

const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ["head", "chest", "arms", "legs"];

/** CR 8.5.41c: equipment played over a non-base piece goes to the graveyard. */
export function blockingEquipmentByPlay(
  cards: readonly CardView[],
  equipment: Partial<Record<EquipmentSlot, CardView>>,
): ReadonlyMap<number, string> {
  const blockers = new Map<number, string>();
  for (const card of cards) {
    const data = cardData[card.cardId];
    if (data?.cardType !== "equipment") continue;
    const slot = EQUIPMENT_SLOTS.find((candidate) => (data.subtypes ?? []).includes(candidate));
    const occupant = slot ? equipment[slot] : undefined;
    if (occupant && !(cardData[occupant.cardId]?.subtypes ?? []).includes("base")) {
      blockers.set(card.instanceId, occupant.cardId);
    }
  }
  return blockers;
}

export function nonAttackActionPlayIds(cards: readonly CardView[]): ReadonlySet<number> {
  const instanceIds = new Set<number>();
  for (const card of cards) {
    const data = cardData[card.cardId];
    if (data?.cardType === "action" && !(data.subtypes ?? []).includes("attack")) {
      instanceIds.add(card.instanceId);
    }
  }
  return instanceIds;
}

function sameOptionalInstanceIds(
  actual: readonly number[] | undefined,
  selected: readonly number[] | null,
): boolean {
  if (actual === undefined || selected === null) {
    return actual === undefined && selected === null;
  }
  return actual.length === selected.length && actual.every((id) => selected.includes(id));
}

export function abilityIndexes(legal: readonly GameIntent[], sourceInstanceId: number): number[] {
  const indexes = new Set<number>();
  for (const intent of legal) {
    if (intent.kind === "activate-ability" && intent.sourceInstanceId === sourceInstanceId) {
      indexes.add(intent.abilityIndex ?? 0);
    }
  }
  return [...indexes].sort((a, b) => a - b);
}

export function requiresAbilityChoice(legal: readonly GameIntent[], sel: Sel): boolean {
  return sel.kind === "activate" && sel.abilityIndex === undefined &&
    abilityIndexes(legal, sel.sourceInstanceId).length > 1;
}

/** Choose the interaction exposed by a hand-card click. Cards such as Fruits
 * of the Forest can be either played normally or discarded to activate a
 * hidden instant ability, so that case needs an explicit method choice. */
export function handCardSelection(
  legal: readonly GameIntent[],
  instanceId: number,
): Sel | null {
  const canPlay = legal.some(
    (intent) => intent.kind === "play-card" && intent.instanceId === instanceId,
  );
  const indexes = abilityIndexes(legal, instanceId);
  if (canPlay && indexes.length > 0) return { kind: "choose-hand-action", instanceId };
  if (canPlay) return { kind: "play-hand", instanceId };
  if (indexes.length === 1) {
    return { kind: "activate", sourceInstanceId: instanceId, abilityIndex: indexes[0] };
  }
  if (indexes.length > 1) return { kind: "activate", sourceInstanceId: instanceId };
  return null;
}

/** The opt-in fast-play setting applies to card plays and activated abilities.
 * Method, ability, Boost, target, and payment choices still happen first. */
export function shouldSkipPlayConfirmation(sel: Sel, enabled: boolean): boolean {
  return enabled && (
    sel.kind === "play-hand" ||
    sel.kind === "play-arsenal" ||
    sel.kind === "play-zone" ||
    sel.kind === "activate"
  );
}

export function shouldAutoCommitAnnouncement(
  sel: Sel,
  step: ActionStep,
  skipPlayConfirmation: boolean,
  playConfirmedByDrop: boolean,
): boolean {
  if (shouldSkipPlayConfirmation(sel, skipPlayConfirmation)) {
    return step === "confirm" || step === "close-chain";
  }
  // Dropping expresses intent to play, while still preserving the explicit
  // warning when a play would close an existing combat chain.
  return playConfirmedByDrop && sel.kind === "play-hand" && step === "confirm";
}

export function resolvePlayMethod(
  normalOffered: boolean,
  instantOffered: boolean,
  selected: PlayMethod | null,
): { choiceRequired: boolean; asInstant: boolean } {
  return {
    choiceRequired: normalOffered && instantOffered && selected === null,
    asInstant: instantOffered && (!normalOffered || selected === "instant"),
  };
}

export interface AnnouncementInputs {
  actionCandidates: readonly GameIntent[];
  /** Executable server-enumerated intents. Exact pitch sequences here take
   * precedence over locally calculated values from the bundled card catalog. */
  legalIntents: readonly GameIntent[];
  hand: readonly CardView[];
  chainClosingPlayIds: ReadonlySet<number>;
  blockingEquipment: ReadonlyMap<number, string>;
  skipPlayConfirmation: boolean;
}

/** CR 5.1: modes, Boost, and targets are declared before the cost is paid, so
 * payment only considers variants matching those declarations. */
export function deriveAnnouncement(
  state: AnnouncementState,
  {
    actionCandidates,
    legalIntents,
    hand,
    chainClosingPlayIds,
    blockingEquipment,
    skipPlayConfirmation,
  }: AnnouncementInputs,
) {
  const { sel, pitchSel, meldSide, targetAllyId, targetCardInstanceId, boostCount, playMethod,
    chainCloseConfirmed, alternativeCostCardInstanceIds, additionalCostConfirmed } = state;
  const pitchValue = (instanceId: number) => {
    const card = hand.find((candidate) => candidate.instanceId === instanceId);
    return card ? (cardData[card.cardId]?.pitch ?? 0) : 0;
  };
  const paymentCandidates = [...actionCandidates, ...legalIntents];
  const normalMethodVariants = actionSelectionVariants(paymentCandidates, sel, meldSide, false);
  const instantMethodVariants = actionSelectionVariants(paymentCandidates, sel, meldSide, true);
  const { choiceRequired: playMethodChoiceRequired, asInstant: effectiveAsInstant } =
    resolvePlayMethod(normalMethodVariants.length > 0, instantMethodVariants.length > 0, playMethod);
  const selectedAbilityIndexes = sel.kind === "activate"
    ? abilityIndexes(actionCandidates, sel.sourceInstanceId)
    : [];
  const abilityChoiceRequired = requiresAbilityChoice(actionCandidates, sel);
  const actionChoiceVariants = playMethodChoiceRequired || abilityChoiceRequired
    ? []
    : effectiveAsInstant ? instantMethodVariants : normalMethodVariants;
  const boostOptions = [...new Set(actionChoiceVariants.map(intentBoostCount))]
    .sort((a, b) => a - b);
  const boostOffered = boostOptions.some((count) => count > 0);
  const selectedBoostCount = boostOffered ? boostCount : 0;
  const targetVariants = actionChoiceVariants.filter(
    (intent) => intentBoostCount(intent) === selectedBoostCount,
  );
  const allyTargetOffered = targetVariants.some((intent) => intent.targetAllyId !== undefined);
  const cardTargetOffered = targetVariants.some(
    (intent) => intent.targetCardInstanceId !== undefined,
  );
  const targetReady =
    (!allyTargetOffered || targetAllyId !== undefined) &&
    (!cardTargetOffered || targetCardInstanceId !== null);
  const targetOffered = allyTargetOffered || cardTargetOffered;
  const declaredVariants = targetReady
    ? targetVariants.filter((intent) =>
        (intent.targetAllyId ?? null) === (targetAllyId ?? null) &&
        (intent.targetCardInstanceId ?? null) === targetCardInstanceId
      )
    : [];
  const normalCostVariants = declaredVariants.filter(
    (intent) => intent.alternativeCostCardInstanceIds === undefined,
  );
  const normalCostPayableWithoutPitch = paidActionCandidates(
    normalCostVariants,
    [],
    pitchValue,
  ).length > 0;
  const alternativeCostSets = new Map<string, number[]>();
  for (const intent of declaredVariants) {
    if (intent.alternativeCostCardInstanceIds === undefined) continue;
    const key = [...intent.alternativeCostCardInstanceIds].sort((a, b) => a - b).join(":");
    alternativeCostSets.set(key, intent.alternativeCostCardInstanceIds);
  }
  const stagedAdditionalCostIntent = declaredVariants.find(
    (intent) => intent.cardCostSelection !== undefined,
  );
  const stagedAdditionalCost = stagedAdditionalCostIntent?.cardCostSelection;
  const stagedAdditionalCostSelectionSource = stagedAdditionalCostIntent
    ? stagedAdditionalCostIntent.alternativeCostCardInstanceIds === undefined
      ? "payment" as const
      : "alternative" as const
    : undefined;
  const stagedAdditionalCostCandidateIds = new Set(
    stagedAdditionalCostSelectionSource === "payment"
      ? declaredVariants.flatMap((intent) =>
          intent.cardCostSelection ? intent.pitchInstanceIds : []
        )
      : [...alternativeCostSets.values()].flat(),
  );
  const stagedAdditionalCostSelectedIds = stagedAdditionalCostSelectionSource === "payment"
    ? pitchSel
    : Array.isArray(alternativeCostCardInstanceIds)
      ? alternativeCostCardInstanceIds
      : [];
  const selectedPaymentVariants = declaredVariants.filter(
    (intent) =>
      sameOptionalInstanceIds(
        intent.alternativeCostCardInstanceIds,
        alternativeCostCardInstanceIds ?? null,
      ),
  );
  const paidVariants = paidActionCandidates(
    selectedPaymentVariants,
    pitchSel,
    pitchValue,
  );
  const paymentReady = isAnnouncementPaymentReady(
    paidVariants.length,
    alternativeCostSets.size > 0,
    stagedAdditionalCost !== undefined,
    additionalCostConfirmed,
    alternativeCostCardInstanceIds !== undefined,
  );
  const paymentProgress = actionPaymentProgress(
    selectedPaymentVariants,
    pitchSel,
    pitchValue,
  ) ?? { kind: "resource" as const, selected: 0, required: 0 };
  const chosenActionIntent =
    targetReady
      ? selectedActionIntent(
          paymentCandidates,
          sel,
          meldSide,
          targetAllyId ?? null,
          targetCardInstanceId,
          pitchSel,
          selectedBoostCount,
          effectiveAsInstant,
          alternativeCostCardInstanceIds ?? null,
          pitchValue,
        )
      : null;
  const chainCloseConfirmationRequired = chosenActionIntent !== null &&
    requiresChainCloseConfirmation(chosenActionIntent, chainClosingPlayIds);
  const actionStep: ActionStep = playMethodChoiceRequired
    ? "method"
    : abilityChoiceRequired ? "ability"
    : boostOffered && boostCount === null ? "boost"
    : targetOffered && !targetReady ? "target"
    : !paymentReady ? "payment"
    : chainCloseConfirmationRequired && !chainCloseConfirmed
      ? "close-chain"
      : "confirm";
  const equipBlockedBy = chosenActionIntent !== null && isPlayIntent(chosenActionIntent)
    ? blockingEquipment.get(chosenActionIntent.instanceId)
    : undefined;
  const autoCommitPending =
    equipBlockedBy === undefined &&
    chosenActionIntent !== null &&
    paymentReady &&
    shouldAutoCommitAnnouncement(sel, actionStep, skipPlayConfirmation, state.playConfirmedByDrop);

  return {
    actionStep,
    chosenActionIntent,
    paymentReady,
    chainCloseConfirmationRequired,
    equipBlockedBy,
    alternativeCostSets,
    stagedAdditionalCost,
    stagedAdditionalCostCandidateIds,
    stagedAdditionalCostSelectedIds,
    stagedAdditionalCostSelectionSource,
    canConfirmAdditionalCost:
      stagedAdditionalCost !== undefined &&
      stagedAdditionalCostSelectedIds.length >= stagedAdditionalCost.minimum &&
      stagedAdditionalCostSelectedIds.length <= stagedAdditionalCost.maximum &&
      (stagedAdditionalCostSelectionSource === "payment"
        ? paidVariants.length > 0
        : stagedAdditionalCostSelectedIds.length === 0
          ? normalCostPayableWithoutPitch
          : selectedPaymentVariants.length > 0),
    normalCostPayableWithoutPitch,
    playMethodChoiceRequired,
    paymentProgress,
    selectedAbilityIndexes,
    boostOptions,
    selectedBoostCount,
    selectedPaymentVariants,
    targetVariants,
    autoCommitPending,
  };
}

export function useActionAnnouncement(inputs: AnnouncementInputs & {
  sendIntent: (intent: GameIntent) => boolean;
}) {
  const { sendIntent } = inputs;
  const [state, dispatch] = useReducer(actionAnnouncementReducer, INITIAL_ANNOUNCEMENT);
  const { sel, commitConfirmed, chainCloseConfirmed } = state;
  const derived = deriveAnnouncement(state, inputs);
  const {
    chosenActionIntent,
    paymentReady,
    chainCloseConfirmationRequired,
    autoCommitPending,
    stagedAdditionalCostSelectionSource,
  } = derived;

  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const intentToSend = committedActionIntent(
    chosenActionIntent,
    paymentReady,
    commitConfirmed || autoCommitPending,
    chainCloseConfirmationRequired,
    chainCloseConfirmed || autoCommitPending,
  );
  useEffect(() => {
    if (sel.kind === "none" || !intentToSend) return;
    if (sendIntent(intentToSend)) reset();
  }, [intentToSend, reset, sel.kind, sendIntent]);

  return {
    ...state,
    ...derived,
    reset,
    select: (sel: Sel) => dispatch({ type: "select", sel }),
    playHandFromDrop: (instanceId: number) => dispatch({ type: "play-hand-from-drop", instanceId }),
    togglePitch: (instanceId: number) => dispatch({ type: "toggle-pitch", instanceId }),
    clearPitch: () => dispatch({ type: "clear-pitch" }),
    selectAbility: (abilityIndex: number) => dispatch({ type: "select-ability", abilityIndex }),
    selectMeld: (side: MeldSide) => dispatch({ type: "select-meld", meldSide: side }),
    selectPlayMethod: (method: PlayMethod) =>
      dispatch({ type: "select-play-method", playMethod: method }),
    selectAllyTarget: (id: number | null) => dispatch({ type: "select-ally-target", targetAllyId: id }),
    selectCardTarget: (id: number) => dispatch({ type: "select-card-target", targetCardInstanceId: id }),
    selectBoost: (value: number) => dispatch({ type: "select-boost", boostCount: value }),
    confirmChainClose: () => dispatch({ type: "confirm-chain-close" }),
    confirmAction: () => dispatch({ type: "confirm-action" }),
    selectAlternativeCost: (instanceIds: number[] | null) =>
      dispatch({ type: "select-alternative-cost", instanceIds }),
    toggleAdditionalCostCard: (instanceId: number) => {
      if (!stagedAdditionalCostSelectionSource) return;
      dispatch({
        type: "toggle-additional-cost-card",
        instanceId,
        selectionSource: stagedAdditionalCostSelectionSource,
      });
    },
    confirmAdditionalCost: () => dispatch({ type: "confirm-additional-cost" }),
  };
}
