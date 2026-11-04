import type { GameStateInternal } from "./runtimeState.js";
import type { EquipmentSlot } from "@fyendal/shared";
import type { PlayerState } from "./state.js";

/** CR 3.0.1a: a token placed in an equipment zone also keeps that zone from being empty. */
export function equipmentZoneEmpty(player: PlayerState, slot: EquipmentSlot): boolean {
  return !player.equipment[slot] && !player.board.some((card) => card.scriptState?.[`frostZone:${slot}`]);
}

/** Whether this hero's text box is currently treated as empty. */
export function heroAbilitiesDisabled(state: GameStateInternal, seat: number): boolean {
  const player = state.players[seat] as PlayerState | undefined;
  if (!player) return false;
  const withinActionPhase = ["action", "layer", "reaction", "defend"].includes(state.phase);
  return (
    player.flags.disableHeroAbilities === true ||
    player.hero.scriptState?.abilitiesDisabledPermanently === 1 ||
    Number(player.hero.scriptState?.abilitiesDisabledUntilTurn ?? 0) >= state.turn ||
    state.modifiers.some((modifier) =>
      modifier.seat === seat && (
        modifier.suppressesHeroAbilities === true ||
        (modifier.suppressesHeroAbilitiesDuringActionPhase === true &&
          state.activePlayer === seat && withinActionPhase)
      )
    )
  );
}
