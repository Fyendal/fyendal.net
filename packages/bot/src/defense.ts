import type { GameIntent } from "@fyendal/shared";
import type { BotPolicyInput } from "./policy.js";

/**
 * The shared policy normally chooses the complete staged defense set. Some
 * attacks make an equipment defender mandatory, however, and the engine
 * intentionally withholds the defend/commit intent until enough equipment is
 * staged. Bootstrap that mandatory selection one equipment card at a time;
 * the shared scorer can add the rest of the block on its next observation.
 */
export function requiredEquipmentStageIntent(
  input: BotPolicyInput,
): Extract<GameIntent, { kind: "stage-defenders" }> | undefined {
  const decision = input.view.pendingDecision;
  if (decision?.kind !== "defend") return undefined;
  if (input.legal.some((intent) => intent.kind === "defend")) return undefined;

  const staged = decision.stagedCards?.map((card) => card.instanceId) ?? [];
  const stagedIds = new Set(staged);
  const me = input.view.players[input.seat];
  const ownCards = new Map([
    ...me.hand,
    ...me.arsenal,
    ...Object.values(me.equipment).filter((card) => card !== undefined),
    ...me.weapons,
  ].map((card) => [card.instanceId, card]));

  for (const intent of input.legal) {
    if (intent.kind !== "stage-defenders") continue;
    const equipmentId = intent.instanceIds.find((id) => {
      const card = ownCards.get(id);
      return !stagedIds.has(id) && input.cards[card?.cardId ?? ""]?.cardType === "equipment";
    });
    if (equipmentId !== undefined) {
      return { kind: "stage-defenders", instanceIds: [...staged, equipmentId] };
    }
  }
  return undefined;
}
