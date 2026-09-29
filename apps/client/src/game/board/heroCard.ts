import type { CardView, PlayerView } from "@fyendal/shared";

/** The hero is projected through PlayerView rather than an arena CardView. */
export function heroCard(player: PlayerView): CardView {
  return {
    instanceId: player.heroInstanceId,
    cardId: player.heroCardId,
    owner: player.seat,
    ...(player.heroTapped ? { tapped: true } : {}),
    ...(player.heroCounters ? { counters: player.heroCounters } : {}),
    ...(player.heroDefCounters ? { defCounters: player.heroDefCounters } : {}),
    ...(player.heroSubcards ? { subcards: player.heroSubcards } : {}),
    ...(player.heroAbilityLabels ? { activatedAbilityLabels: player.heroAbilityLabels } : {}),
    ...(player.heroAttackAbilityIndexes ? { attackAbilityIndexes: player.heroAttackAbilityIndexes } : {}),
  };
}
