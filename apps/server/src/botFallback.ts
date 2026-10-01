import { requiredEquipmentStageIntent, type BotPolicyInput } from "@fyendal/bot";
import type { GameIntent } from "@fyendal/shared";
/** Conservative progress fallback for a failed policy. Selection stays within
 * the authoritative observation and never reads a hidden zone. */
export function fallbackBotIntent(input: BotPolicyInput): GameIntent | undefined {
  if (input.view.pendingDecision?.kind === "defend") {
    const requiredEquipment = requiredEquipmentStageIntent(input);
    if (requiredEquipment) return requiredEquipment;
    const stagedIds = input.view.pendingDecision.stagedCards?.map((card) => card.instanceId) ?? [];
    const commit = input.legal.find((intent) =>
      intent.kind === "defend" && intent.instanceIds.length > 0
    );
    const me = input.view.players[input.seat];
    const visible = new Map([
      ...me.hand,
      ...me.arsenal,
      ...Object.values(me.equipment).flatMap((card) => card ? [card] : []),
    ].map((card) => [card.instanceId, card]));
    const handIds = new Set(me.hand.map((card) => card.instanceId));
    const equipmentIds = new Set(
      Object.values(me.equipment).flatMap((card) => card ? [card.instanceId] : []),
    );
    const link = [...input.view.chain].reverse().find((candidate) => !candidate.resolved);
    const incoming = link ? Math.max(0, link.attackValue - link.defenseValue) : 0;
    if (commit && (input.view.pendingDecision.stagedDefense ?? 0) >= incoming) return commit;
    const candidates = input.legal.flatMap((intent) =>
      intent.kind === "stage-defenders" ? intent.instanceIds : []
    ).filter((id) => !stagedIds.includes(id));
    const allowed = (id: number): boolean => {
      const ids = [...stagedIds, id];
      if (link?.dominate && ids.filter((candidate) => handIds.has(candidate)).length > 1) return false;
      if (link?.overpower) {
        const actions = ids.filter((candidate) =>
          !equipmentIds.has(candidate) &&
          input.cards[visible.get(candidate)?.cardId ?? ""]?.cardType === "action"
        ).length;
        if (actions > 1) return false;
      }
      if (link?.maxNonBlockDefenders !== undefined) {
        const nonBlockDefenders = ids.filter((candidate) =>
          input.cards[visible.get(candidate)?.cardId ?? ""]?.cardType !== "block"
        ).length;
        if (nonBlockDefenders > link.maxNonBlockDefenders) return false;
      }
      return true;
    };
    const next = candidates
      .filter(allowed)
      .map((id, index) => ({
        id,
        index,
        defense: visible.get(id)?.defense ?? input.cards[visible.get(id)?.cardId ?? ""]?.defense ?? 0,
      }))
      .sort((left, right) => right.defense - left.defense || left.index - right.index)[0];
    if (next) return { kind: "stage-defenders", instanceIds: [...stagedIds, next.id] };
    if (commit) return commit;
    const noBlock = input.legal.find((intent) =>
      intent.kind === "defend" && intent.instanceIds.length === 0
    );
    if (noBlock) return noBlock;
  }
  const defaultOption = input.view.pendingDecision?.defaultOption;
  if (defaultOption !== undefined) {
    const choice = input.legal.find((intent) =>
      intent.kind === "choose" && intent.optionId === defaultOption
    );
    if (choice) return choice;
  }
  // A policy timeout or crash must not turn an already-funded weapon attack
  // into an end-turn pass. Prefer the no-pitch hero-targeted activation in a
  // clean action window; it spends no hidden card and still comes directly
  // from the authoritative legal-intent set.
  if (
    input.view.phase === "action" && input.view.pendingDecision === null &&
    input.view.activePlayer === input.seat && input.view.priorityPlayer === input.seat
  ) {
    const weaponIds = new Set(
      input.view.players[input.seat].weapons.map((card) => card.instanceId),
    );
    const weaponAttacks = input.legal.filter((intent) =>
      intent.kind === "activate-ability" && weaponIds.has(intent.sourceInstanceId) &&
      intent.pitchInstanceIds.length === 0
    );
    const heroAttack = weaponAttacks.find((intent) =>
      intent.kind === "activate-ability" && intent.targetAllyId === undefined
    );
    if (heroAttack) return heroAttack;
    if (weaponAttacks[0]) return weaponAttacks[0];
  }
  return input.legal.find((intent) => intent.kind === "pass")
    ?? input.legal.find((intent) => intent.kind !== "concede");
}
