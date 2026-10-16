import type { OngoingEffectView, PlayerView } from "@fyendal/shared";
import { createContext, useContext } from "react";
import type { IntlShape } from "react-intl";

/** A seat's hero as lingering effects present it. */
export interface EffectHero {
  seat: number;
  heroCardId: string;
  /** Hero name, qualified by the player when both heroes share a name. */
  label: string;
}

export const EffectHeroesContext = createContext<readonly EffectHero[]>([]);

export const useEffectHeroes = (): readonly EffectHero[] => useContext(EffectHeroesContext);

export function effectHeroes(
  intl: IntlShape,
  players: readonly Pick<PlayerView, "seat" | "heroCardId" | "heroName">[],
  usernames: readonly (string | null | undefined)[],
): EffectHero[] {
  const mirror = players.length === 2 && players[0]!.heroName === players[1]!.heroName;
  return players.map((player) => ({
    seat: player.seat,
    heroCardId: player.heroCardId,
    label: mirror
      ? intl.formatMessage({ id: "game.effects.heroOfPlayer" }, {
        hero: player.heroName,
        player: usernames[player.seat] ??
          intl.formatMessage({ id: "game.effects.seatPlayer" }, { seat: player.seat + 1 }),
      })
      : player.heroName,
  }));
}

/** The hero whose effect this is, when it has no source card of its own. */
export function effectSourceHero(
  effect: OngoingEffectView,
  heroes: readonly EffectHero[],
): EffectHero | undefined {
  if (effect.cardId || effect.sourceHidden || effect.sourceSeat === undefined) return undefined;
  return heroes.find((hero) => hero.seat === effect.sourceSeat);
}
