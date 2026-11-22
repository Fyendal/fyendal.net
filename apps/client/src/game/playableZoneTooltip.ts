import type { IntlShape } from "react-intl";
import type { CardView, PlayableZone } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";

type GhostZone = Exclude<PlayableZone, "deck">;

export function playableZoneTooltip(
  intl: Pick<IntlShape, "formatMessage">,
  card: CardView,
  zone: GhostZone,
): string {
  const source = card.playableFromSourceCardId
    ? cardData[card.playableFromSourceCardId]?.name
    : undefined;
  return intl.formatMessage({ id: `game.hand.playableFrom.${source ? "source" : "effect"}` }, { zone, source });
}
