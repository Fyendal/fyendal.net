import type { CardView, PlayableZone } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";

type GhostZone = Exclude<PlayableZone, "deck">;

function zoneLabel(zone: GhostZone): string {
  return zone === "graveyard" ? "graveyard" : "banished zone";
}

export function playableZoneTooltip(card: CardView, zone: GhostZone): string {
  const sourceName = card.playableFromSourceCardId
    ? cardData[card.playableFromSourceCardId]?.name
    : undefined;
  if (!sourceName) {
    return `An active card effect allows this card to be played from your ${zoneLabel(zone)}.`;
  }
  const possessive = sourceName.endsWith("s") ? `${sourceName}’` : `${sourceName}’s`;
  return `${possessive} ability allows this card to be played from your ${zoneLabel(zone)}.`;
}
