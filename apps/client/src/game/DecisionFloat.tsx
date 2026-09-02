import type { PendingDecision } from "@fyendal/shared";
import { useFloatDrag } from "./useFloatDrag.js";
import { bloodModeAllocation } from "./decisionPresentation.js";
import type { Sel } from "./useActionAnnouncement.js";
import { ActionAnnouncementPanel } from "./decision/ActionAnnouncementPanel.js";
import type {
  ActionAnnouncementModel,
  PendingDecisionModel,
} from "./decision/DecisionModels.js";
import { PendingDecisionPanel } from "./decision/PendingDecisionPanel.js";

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
}: {
  pending: PendingDecisionModel;
  action: ActionAnnouncementModel;
  viewerSeat: number;
}) {
  const decisionFloat = useFloatDrag({
    resetKey: decisionFloatDragKey(
      pending.decision,
      action.sel,
      action.autoCommitPending,
    ),
  });
  if (pending.decision === null && (action.sel.kind === "none" || action.autoCommitPending)) {
    return null;
  }

  return (
    <div className="float decision-float" style={decisionFloat.style} {...decisionFloat.dragProps}>
      <PendingDecisionPanel model={pending} viewerSeat={viewerSeat} />
      <ActionAnnouncementPanel model={action} viewerSeat={viewerSeat} />
    </div>
  );
}
