import type { PendingDecision } from "@fyendal/shared";
import { useState } from "react";
import { useFloatDrag } from "./useFloatDrag.js";
import { bloodModeAllocation } from "./decisionPresentation.js";
import type { LethalPassRisk } from "./lethalPass.js";
import type { Sel } from "./useActionAnnouncement.js";
import { ActionAnnouncementPanel } from "./decision/ActionAnnouncementPanel.js";
import type {
  ActionAnnouncementModel,
  PendingDecisionModel,
} from "./decision/DecisionModels.js";
import { PendingDecisionPanel, pendingDecisionPanelShown } from "./decision/PendingDecisionPanel.js";
import { ChoiceHotkeysEnabled } from "./decision/choiceHotkeys.js";
import { EndTurnConfirmation, LethalPassConfirmation } from "./decision/ActionConfirmations.js";
import { DecisionSheetMinimize, DecisionSheetRestore } from "./decision/DecisionSheet.js";

export type { ActionAnnouncementModel, PendingDecisionModel } from "./decision/DecisionModels.js";

/** Stable for one displayed decision, different when a new float should spawn. */
export function decisionFloatDragKey(
  decision: PendingDecision | null,
  sel: Sel,
  autoCommitPending: boolean,
): string {
  if (sel.kind !== "none" && !autoCommitPending) {
    switch (sel.kind) {
      case "activate":
        return `action:activate:${sel.sourceInstanceId}`;
      case "play-zone":
        return `action:play-zone:${sel.zone}:${sel.instanceId}`;
      default:
        return `action:${sel.kind}:${sel.instanceId}`;
    }
  }
  if (!decision) return "hidden";
  const bloodAllocation = bloodModeAllocation(decision);
  if (bloodAllocation) {
    return `pending:blood-mode:${decision.player}:${bloodAllocation.required}:${bloodAllocation.weapons.map((weapon) => weapon.card.instanceId).join(",")}`;
  }
  return `pending:${JSON.stringify([
    decision.player,
    decision.kind,
    decision.promptMessage ?? decision.prompt,
    decision.options ?? [],
    decision.optionMessages ?? [],
  ])}`;
}

/** Draggable frame composing independent server-decision and local-action variants. */
export function DecisionFloat({
  pending,
  action,
  viewerSeat,
  pitchFocused = false,
  optionHotkeys = false,
  endTurnConfirmation = null,
  lethalConfirmation = null,
}: {
  pending: PendingDecisionModel;
  action: ActionAnnouncementModel;
  viewerSeat: number;
  pitchFocused?: boolean;
  optionHotkeys?: boolean;
  /** Present while the player confirms ending the turn with an unused action point. */
  endTurnConfirmation?: { onConfirm: () => void; onCancel: () => void } | null;
  /** Present while the player confirms a pass or block that would defeat them. */
  lethalConfirmation?: {
    risk: LethalPassRisk;
    action: "pass" | "confirm-blocks" | "confirm-no-blocks";
    onConfirm: () => void;
    onCancel: () => void;
  } | null;
}) {
  const resetKey = lethalConfirmation
    ? "lethal-confirmation"
    : endTurnConfirmation
      ? "end-turn-confirmation"
      : decisionFloatDragKey(
          pending.decision,
          action.sel,
          action.autoCommitPending,
        );
  const decisionFloat = useFloatDrag({ resetKey });
  const [minimizedKey, setMinimizedKey] = useState<string | null>(null);
  const minimized = minimizedKey === resetKey;
  if (
    !lethalConfirmation &&
    !endTurnConfirmation &&
    !pendingDecisionPanelShown(pending) &&
    (action.sel.kind === "none" || action.autoCommitPending)
  ) {
    return null;
  }

  return (
    <div
      className={`float decision-float${pitchFocused ? " decision-float-pitch" : ""}${
        minimized ? " decision-float-minimized" : ""
      }`}
      style={pitchFocused ? undefined : decisionFloat.style}
      {...(pitchFocused ? {} : decisionFloat.dragProps)}
    >
      {minimized ? <DecisionSheetRestore onRestore={() => setMinimizedKey(null)} /> : null}
      <DecisionSheetMinimize.Provider value={() => setMinimizedKey(resetKey)}>
        <ChoiceHotkeysEnabled.Provider value={optionHotkeys}>
          {lethalConfirmation ? (
            <div className="decision decision-options decision-choice decision-lethal">
              <LethalPassConfirmation {...lethalConfirmation} />
            </div>
          ) : endTurnConfirmation ? (
            <div className="decision decision-options decision-choice">
              <EndTurnConfirmation
                onConfirm={endTurnConfirmation.onConfirm}
                onCancel={endTurnConfirmation.onCancel}
              />
            </div>
          ) : (
            <>
              <PendingDecisionPanel model={pending} viewerSeat={viewerSeat} />
              <ActionAnnouncementPanel model={action} viewerSeat={viewerSeat} />
            </>
          )}
        </ChoiceHotkeysEnabled.Provider>
      </DecisionSheetMinimize.Provider>
    </div>
  );
}
