import type { PlayableZone } from "@fyendal/shared";
import { nameOf } from "./gameLog.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, PlayerState } from "./state.js";

export type CardPlayOrigin = "hand" | "arsenal" | PlayableZone;
/** Stable numeric codes for play origins kept in JSON-safe player flags. */
export const CARD_PLAY_ORIGINS: readonly CardPlayOrigin[] = ["hand", "arsenal", "banish", "graveyard", "deck"];

const attackLayerOriginKey = (instanceId: number) => `attackLayerOrigin:${instanceId}`;

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
  opts?: { abilityIndex?: number; triggerIndex?: number; optional?: boolean; goAgain?: boolean; targetCardInstanceId?: number },
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
    ...(opts?.targetCardInstanceId !== undefined
      ? { targetCardInstanceId: opts.targetCardInstanceId }
      : {}),
  });
}

/** Push an attack card played at instant speed. Its layer has no go again of
 * its own (that belongs to the chain link it later becomes), and its play
 * origin is kept until the layer resolves into the attack queue. */
export function pushAttackCardLayer(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
  origin: CardPlayOrigin,
): void {
  (state.players[seat] as PlayerState).flags[attackLayerOriginKey(card.instanceId)] =
    CARD_PLAY_ORIGINS.indexOf(origin) + 1;
  pushCardLayer(state, seat, card, { fromHand: origin === "hand" });
}

/** Read and clear the play origin recorded by `pushAttackCardLayer`. */
export function takeAttackLayerOrigin(
  state: GameStateInternal,
  seat: number,
  instanceId: number,
): CardPlayOrigin {
  const flags = (state.players[seat] as PlayerState).flags;
  const code = Number(flags[attackLayerOriginKey(instanceId)] ?? 0);
  delete flags[attackLayerOriginKey(instanceId)];
  return CARD_PLAY_ORIGINS[code - 1] ?? "hand";
}
