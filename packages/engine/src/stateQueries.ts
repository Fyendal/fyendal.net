import type { GameStateInternal } from "./runtimeState.js";
import type { PlayerState } from "./state.js";

/** Whether this hero's text box is currently treated as empty. */
export function heroAbilitiesDisabled(state: GameStateInternal, seat: number): boolean {
  const player = state.players[seat] as PlayerState | undefined;
  if (!player) return false;
  return (
    player.flags.disableHeroAbilities === true ||
    player.hero.counters?.abilitiesDisabledPermanently === 1 ||
    Number(player.hero.counters?.abilitiesDisabledUntilTurn ?? 0) >= state.turn ||
    state.modifiers.some((modifier) =>
      modifier.seat === seat && modifier.suppressesHeroAbilities === true
    )
  );
}
