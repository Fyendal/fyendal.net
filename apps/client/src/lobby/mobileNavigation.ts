import type { ConstructedFormat } from "../domain.js";
import type { LobbyRail } from "../store/types.js";

export type MobileLobbyDestination = "home" | "decks" | "all" | "replays" | "more";

export function mobileLobbyDestinationSelected(
  destination: MobileLobbyDestination,
  rail: LobbyRail,
): boolean {
  if (destination === "decks") return rail === "cc" || rail === "silver-age";
  if (destination === "more") return rail === "account";
  return destination === rail;
}

export function mobileDeckDestination(lastFormat: ConstructedFormat): ConstructedFormat {
  return lastFormat;
}
