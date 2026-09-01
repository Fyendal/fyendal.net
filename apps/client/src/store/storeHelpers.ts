import type { Format, HeroId } from "@fyendal/shared";
import type { StoreState } from "./types.js";
import type { LobbySettings } from "../storage.js";

export function initialStoreProjection(
  auth: { token: string; username: string } | null,
  lobbySettings: LobbySettings,
) {
  return {
    screen: "lobby" as const,
    lobbyRail: "home" as const,
    connected: false,
    roomCode: null,
    yourSeat: null,
    spectating: false,
    spectatorCount: 0,
    botGame: false,
    playerProfiles: null,
    view: null,
    viewUpdate: { sequence: 0, source: "restore" as const, transition: "replace" as const },
    legal: [],
    actionCandidates: [],
    pendingInteraction: null,
    pendingDefenderStageIds: null,
    lastActionAt: null,
    replayFrames: 0,
    replayViews: null,
    replayTransitions: null,
    replayStep: 0,
    activeSavedReplayId: null,
    savedReplays: [],
    replaysLoading: false,
    error: null,
    opponentConnected: true,
    latestEmote: null,
    authUser: auth?.username ?? null,
    authToken: auth?.token ?? null,
    rooms: [],
    inviteRoom: null,
    queueCounts: { "classic-battles": 0, cc: 0, "silver-age": 0 },
    queuedFormat: null,
    matchmakingActive: false,
    matchAcceptanceRole: null,
    decks: [],
    decksLoading: auth !== null,
    prepDeck: null,
    prep: null,
    allowFutureCards: lobbySettings.allowFutureCards,
    lastPlayedDecks: lobbySettings.lastPlayedDecks,
  };
}

export function matchmakingChoiceKey(
  format: Format,
  choice: { hero?: HeroId; deckId?: string },
): string {
  return format === "classic-battles"
    ? `${format}:hero:${choice.hero ?? "none"}`
    : `${format}:deck:${choice.deckId ?? "none"}`;
}

export function clearedRoomProjection(): Pick<
  StoreState,
  | "screen"
  | "roomCode"
  | "yourSeat"
  | "spectating"
  | "spectatorCount"
  | "botGame"
  | "playerProfiles"
  | "view"
  | "viewUpdate"
  | "legal"
  | "actionCandidates"
  | "pendingInteraction"
  | "pendingDefenderStageIds"
  | "lastActionAt"
  | "opponentConnected"
  | "latestEmote"
  | "replayFrames"
  | "replayViews"
  | "replayTransitions"
  | "replayStep"
  | "activeSavedReplayId"
  | "rooms"
  | "inviteRoom"
  | "queuedFormat"
  | "matchmakingActive"
  | "matchAcceptanceRole"
  | "prep"
  | "prepDeck"
  | "error"
> {
  return {
    screen: "lobby",
    roomCode: null,
    yourSeat: null,
    spectating: false,
    spectatorCount: 0,
    botGame: false,
    playerProfiles: null,
    view: null,
    viewUpdate: { sequence: 0, source: "restore", transition: "replace" },
    legal: [],
    actionCandidates: [],
    pendingInteraction: null,
    pendingDefenderStageIds: null,
    lastActionAt: null,
    opponentConnected: true,
    latestEmote: null,
    replayFrames: 0,
    replayViews: null,
    replayTransitions: null,
    replayStep: 0,
    activeSavedReplayId: null,
    rooms: [],
    inviteRoom: null,
    queuedFormat: null,
    matchmakingActive: false,
    matchAcceptanceRole: null,
    prep: null,
    prepDeck: null,
    error: null,
  };
}

export function roomCodeFromLocation(pathname: string): string | null {
  const match = /^\/([0-9A-Za-z]{6})\/?$/.exec(pathname);
  return match ? match[1]!.toUpperCase() : null;
}
