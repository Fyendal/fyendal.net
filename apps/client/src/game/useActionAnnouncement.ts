import { useCallback, useEffect, useReducer } from "react";
import type { CardView, GameIntent, MeldSide, PlayableZone } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import {
  actionSelectionVariants,
  paidActionCandidates,
  pitchResourceProgress,
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
  alternativeCostCardInstanceIds: number[] | null | undefined;
  additionalCostConfirmed: boolean;
}

export type AnnouncementAction =
  | { type: "reset" }
  | { type: "select"; sel: Sel }
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
  | { type: "toggle-additional-cost-card"; instanceId: number }
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

export function actionAnnouncementReducer(
  state: AnnouncementState,
  action: AnnouncementAction,
): AnnouncementState {
  switch (action.type) {
    case "reset":
      return INITIAL_ANNOUNCEMENT;
    case "select":
      return { ...INITIAL_ANNOUNCEMENT, sel: action.sel };
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
      return { ...state, targetAllyId: action.targetAllyId, commitConfirmed: false };
    case "select-card-target":
      return { ...state, targetCardInstanceId: action.targetCardInstanceId, commitConfirmed: false };
    case "select-boost":
      return {
        ...state,
        boostCount: action.boostCount,
        commitConfirmed: false,
        chainCloseConfirmed: false,
        targetAllyId: undefined,
        targetCardInstanceId: null,
      };
    case "confirm-chain-close":
      return { ...state, chainCloseConfirmed: true, commitConfirmed: true };
    case "confirm-action":
      return { ...state, commitConfirmed: true };
    case "select-alternative-cost":
      return clearChoices({
        ...state,
        pitchSel: [],
        alternativeCostCardInstanceIds: action.instanceIds,
        additionalCostConfirmed: true,
      });
    case "toggle-additional-cost-card": {
      const selected = Array.isArray(state.alternativeCostCardInstanceIds)
        ? state.alternativeCostCardInstanceIds
        : [];
      const next = selected.includes(action.instanceId)
        ? selected.filter((id) => id !== action.instanceId)
        : [...selected, action.instanceId];
      return clearChoices({
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

export function requiresChainCloseConfirmation(
  intent: GameIntent,
  chainClosingPlayIds: ReadonlySet<number>,
): boolean {
  if (
    intent.kind !== "play-card" &&
    intent.kind !== "play-from-arsenal" &&
    intent.kind !== "play-from-zone"
  ) return false;
  return intent.asInstant !== true && chainClosingPlayIds.has(intent.instanceId);
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
 * Payment, method, ability, Boost, and target choices still happen first. */
export function shouldSkipPlayConfirmation(sel: Sel, enabled: boolean): boolean {
  return enabled && (
    sel.kind === "play-hand" ||
    sel.kind === "play-arsenal" ||
    sel.kind === "play-zone" ||
    sel.kind === "activate"
  );
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

export function useActionAnnouncement({
  actionCandidates,
  hand,
  chainClosingPlayIds,
  skipPlayConfirmation,
  sendIntent,
}: {
  actionCandidates: readonly GameIntent[];
  hand: readonly CardView[];
  chainClosingPlayIds: ReadonlySet<number>;
  skipPlayConfirmation: boolean;
  sendIntent: (intent: GameIntent) => boolean;
}) {
  const [state, dispatch] = useReducer(actionAnnouncementReducer, INITIAL_ANNOUNCEMENT);
  const { sel, pitchSel, meldSide, targetAllyId, targetCardInstanceId, boostCount, playMethod,
    chainCloseConfirmed, commitConfirmed, alternativeCostCardInstanceIds,
    additionalCostConfirmed } = state;

  const pitchValue = (instanceId: number) => {
    const card = hand.find((candidate) => candidate.instanceId === instanceId);
    return card ? (cardData[card.cardId]?.pitch ?? 0) : 0;
  };
  const normalMethodVariants = actionSelectionVariants(actionCandidates, sel, meldSide, false);
  const instantMethodVariants = actionSelectionVariants(actionCandidates, sel, meldSide, true);
  const { choiceRequired: playMethodChoiceRequired, asInstant: effectiveAsInstant } =
    resolvePlayMethod(normalMethodVariants.length > 0, instantMethodVariants.length > 0, playMethod);
  const selectedAbilityIndexes = sel.kind === "activate"
    ? abilityIndexes(actionCandidates, sel.sourceInstanceId)
    : [];
  const abilityChoiceRequired = requiresAbilityChoice(actionCandidates, sel);
  const actionChoiceVariants = playMethodChoiceRequired || abilityChoiceRequired
    ? []
    : effectiveAsInstant ? instantMethodVariants : normalMethodVariants;
  const normalCostVariants = actionChoiceVariants.filter(
    (intent) => intent.alternativeCostCardInstanceIds === undefined,
  );
  const normalCostPayableWithoutPitch = paidActionCandidates(
    normalCostVariants,
    [],
    pitchValue,
  ).length > 0;
  const alternativeCostSets = new Map<string, number[]>();
  for (const intent of actionChoiceVariants) {
    if (intent.alternativeCostCardInstanceIds === undefined) continue;
    const key = [...intent.alternativeCostCardInstanceIds].sort((a, b) => a - b).join(":");
    alternativeCostSets.set(key, intent.alternativeCostCardInstanceIds);
  }
  const stagedAdditionalCost = actionChoiceVariants.flatMap((intent) =>
    (intent.kind === "play-card" ||
      intent.kind === "play-from-arsenal" ||
      intent.kind === "play-from-zone") &&
      intent.additionalCostSelection
      ? [intent.additionalCostSelection]
      : []
  )[0];
  const selectedPaymentVariants = actionChoiceVariants.filter(
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
  const paymentReady = paidVariants.length > 0 &&
    (alternativeCostSets.size === 0 || (
      stagedAdditionalCost
        ? additionalCostConfirmed
        : alternativeCostCardInstanceIds !== undefined
    ));
  const pitchProgress = pitchResourceProgress(
    selectedPaymentVariants,
    pitchSel,
    pitchValue,
  ) ?? { selected: 0, required: 0 };
  const boostOptions = [...new Set(paidVariants.map((intent) =>
    intent.kind !== "activate-ability" && intent.boost === true
      ? (intent.boostCount ?? 1)
      : 0,
  ))].sort((a, b) => a - b);
  const boostOffered = boostOptions.some((count) => count > 0);
  const selectedBoostCount = boostOffered ? boostCount : 0;
  const targetVariants = paidVariants.filter(
    (intent) => {
      const count = intent.kind !== "activate-ability" && intent.boost === true
        ? (intent.boostCount ?? 1)
        : 0;
      return count === selectedBoostCount;
    },
  );
  const allyTargetOffered = targetVariants.some((intent) => intent.targetAllyId !== undefined);
  const cardTargetOffered = targetVariants.some(
    (intent) => intent.kind !== "activate-ability" && intent.targetCardInstanceId !== undefined,
  );
  const targetReady =
    (!allyTargetOffered || targetAllyId !== undefined) &&
    (!cardTargetOffered || targetCardInstanceId !== null);
  const chosenActionIntent =
    targetReady
      ? selectedActionIntent(
          actionCandidates,
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
  const targetOffered = allyTargetOffered || cardTargetOffered;
  const chainCloseConfirmationRequired = chosenActionIntent !== null &&
    requiresChainCloseConfirmation(chosenActionIntent, chainClosingPlayIds);
  const actionStep: ActionStep = playMethodChoiceRequired
    ? "method"
    : abilityChoiceRequired ? "ability"
    : !paymentReady ? "payment"
    : boostOffered && boostCount === null
      ? "boost"
      : targetOffered && !targetReady
        ? "target"
        : chainCloseConfirmationRequired && !chainCloseConfirmed
          ? "close-chain"
          : "confirm";
  const autoCommitPending =
    chosenActionIntent !== null &&
    paymentReady &&
    targetReady &&
    shouldSkipPlayConfirmation(sel, skipPlayConfirmation) &&
    (actionStep === "confirm" || actionStep === "close-chain");

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
    actionStep,
    alternativeCostSets,
    stagedAdditionalCost,
    canConfirmAdditionalCost:
      Array.isArray(alternativeCostCardInstanceIds) &&
      alternativeCostCardInstanceIds.length > 0 &&
      selectedPaymentVariants.length > 0,
    normalCostPayableWithoutPitch,
    playMethodChoiceRequired,
    pitchProgress,
    selectedAbilityIndexes,
    boostOptions,
    selectedBoostCount,
    selectedPaymentVariants,
    targetVariants,
    autoCommitPending,
    reset,
    select: (sel: Sel) => dispatch({ type: "select", sel }),
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
    toggleAdditionalCostCard: (instanceId: number) =>
      dispatch({ type: "toggle-additional-cost-card", instanceId }),
    confirmAdditionalCost: () => dispatch({ type: "confirm-additional-cost" }),
  };
}
