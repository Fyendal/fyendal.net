import { nameOf } from "./gameLog.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance } from "./state.js";

/** Push a played card onto the stack (instants, actions, reactions). */
export function pushCardLayer(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
  opts?: {
    fromHand?: boolean;
    goAgain?: boolean;
    label?: string;
    triggerIndex?: number;
    optional?: boolean;
  },
): void {
  state.stack.unshift({
    sourceInstanceId: card.instanceId,
    seat,
    triggerIndex: opts?.triggerIndex ?? -1,
    label: opts?.label ?? nameOf(state, card.cardId),
    optional: opts?.optional ?? false,
    card,
    fromHand: opts?.fromHand ?? false,
    ...(opts?.goAgain ? { goAgain: true } : {}),
  });
}

/** Push an activated-ability layer onto the stack. */
export function pushAbilityLayer(
  state: GameStateInternal,
  seat: number,
  source: CardInstance,
  label: string,
  opts?: { abilityIndex?: number; triggerIndex?: number; optional?: boolean; goAgain?: boolean },
): void {
  state.stack.unshift({
    sourceInstanceId: source.instanceId,
    seat,
    triggerIndex: opts?.triggerIndex ?? -1,
    label,
    optional: opts?.optional ?? false,
    ability: true,
    abilityCard: source,
    ...(opts?.abilityIndex && opts.abilityIndex > 0 ? { abilityIndex: opts.abilityIndex } : {}),
    ...(opts?.goAgain ? { goAgain: true } : {}),
  });
}
