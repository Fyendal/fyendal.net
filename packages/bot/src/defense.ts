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

/** Decline an optional "+N{d}" payment once the attack is already stopped,
 * counting the printed defense of a defense reaction still resolving. */
export function unneededDefenseBoostIntent(
  input: BotPolicyInput,
): Extract<GameIntent, { kind: "choose" }> | undefined {
  const decision = input.view.pendingDecision;
  if (decision?.kind !== "optional-effect" || !decision.resourcePayment) return undefined;
  if (!/\+\d+(?:\{d\}| defense)/.test(decision.prompt)) return undefined;
  if (!input.legal.some((intent) => intent.kind === "choose" && intent.optionId === "no")) return undefined;
  const link = [...input.view.chain].reverse().find((candidate) => !candidate.resolved);
  if (!link || link.attackingCard.owner === input.seat) return undefined;
  const resolving = input.view.stack.find((layer) =>
    layer.seat === input.seat && layer.card?.instanceId === decision.resourcePayment?.sourceInstanceId
  )?.card;
  return link.damage - (resolving?.defense ?? 0) <= 0 ? { kind: "choose", optionId: "no" } : undefined;
}
