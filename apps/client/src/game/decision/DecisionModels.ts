import type { CardView, GameIntent, MeldSide, PendingDecision } from "@fyendal/shared";
import type { ActionStep, PlayMethod, Sel } from "../useActionAnnouncement.js";
import type { ActionTargetChoice } from "./CardChoices.js";

export interface PendingDecisionModel {
  decision: PendingDecision | null;
  isMine: boolean;
  decidingName: string;
  canPass: boolean;
  defendPitchIds: ReadonlySet<number>;
  hand: CardView[];
  defendSel: number[];
  selectedPitchIds: number[];
  onTogglePitch: (instanceId: number) => void;
  resourcePaymentSelected: number;
  resourcePaymentRequired: number;
  confirmSkipArsenal: boolean;
  onRequestPass: () => void;
  onDisableGuidance: () => void;
  onConfirmSkipArsenal: () => void;
  onCancelSkipArsenal: () => void;
  /** Present only when this bounded card choice is staged directly from the
   * player's hand instead of rendered again in the decision float. */
  boundedChoiceSelectedOptionIds?: readonly string[];
  onConfirmBoundedChoice?: () => void;
  onSend: (intent: GameIntent) => void;
}

export interface ActionAnnouncementModel {
  sel: Sel;
  selCardId: string | undefined;
  step: ActionStep;
  autoCommitPending: boolean;
  abilityChoices: { index: number; label: string }[];
  onSelectAbility: (index: number) => void;
  onChooseHandPlay: (instanceId: number) => void;
  onChooseHandAbility: (instanceId: number) => void;
  meldChoices: { side: MeldSide; label: string }[];
  meldSide: MeldSide | null;
  onSelectMeldSide: (side: MeldSide) => void;
  playMethod: PlayMethod | null;
  playMethodChoiceRequired: boolean;
  onSelectPlayMethod: (method: PlayMethod) => void;
  targetChoices: ActionTargetChoice[];
  targetAllyId: number | null | undefined;
  onSelectTarget: (id: number | null) => void;
  cardTargetChoices: ActionTargetChoice[];
  targetCardInstanceId: number | null;
  onSelectCardTarget: (id: number) => void;
  boostCount: number | null;
  boostOptions: number[];
  onSelectBoost: (boostCount: number) => void;
  onConfirmChainClose: () => void;
  onConfirmAction: () => void;
  normalCostPayableWithoutPitch: boolean;
  alternativeCostChoices: {
    key: string;
    instanceIds: number[];
    cards: Array<CardView | undefined>;
  }[];
  alternativeCostCardInstanceIds: number[] | null | undefined;
  onSelectAlternativeCost: (instanceIds: number[] | null) => void;
  stagedAdditionalCost: {
    cardLabel: string;
    modes: {
      mode: "destroy" | "discard";
      maximum: number;
      cards: CardView[];
    }[];
  } | undefined;
  additionalCostConfirmed: boolean;
  canConfirmAdditionalCost: boolean;
  onToggleAdditionalCostCard: (instanceId: number) => void;
  onConfirmAdditionalCost: () => void;
  pitchSel: number[];
  paymentProgress: {
    kind: "resource" | "discard";
    selected: number;
    required: number;
  };
  onCancel: () => void;
}
