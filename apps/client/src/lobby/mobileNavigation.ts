import type { LobbyRail } from "../store/types.js";

export type MobileLobbyDestination = "home" | "decks" | "all" | "replays" | "more";

export function mobileLobbyDestinationSelected(
  destination: MobileLobbyDestination,
  rail: LobbyRail,
): boolean {
  if (destination === "more") return rail === "account";
  return destination === rail;
}
