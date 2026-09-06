import type { CardPoolMode, Format, HeroId } from "@fyendal/shared";
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
    connectionIssueVisible: false,
    roomCode: null,
    yourSeat: null,
    spectating: false,
    spectatorCount: 0,
    spectatorUsernames: [],
    spectatorKicked: false,
    botGame: false,
    playerProfiles: null,
    view: null,
    viewUpdate: { sequence: 0, source: "restore" as const, transition: "replace" as const },
    legal: [],
    actionCandidates: [],
    roomCommandPending: false,
    pendingInteraction: null,
    pendingDefenderStageIds: null,
    lastActionAt: null,
    replayFrames: 0,
    replayViews: null,
    replayTransitions: null,
    replayStep: 0,
    replayNotes: [],
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
    backgroundMatchmaking: { state: "inactive" as const },
    pendingBotStart: false,
    matchAcceptanceRole: null,
    decks: [],
    decksLoading: auth !== null,
    bugReportNotifications: [],
    friends: [],
    friendRequests: [],
    friendGameInvites: [],
    socialOpen: false,
    socialError: null,
    activeChat: null,
    incomingChatToast: null,
    chatMessages: {},
    chatHasMore: {},
    friendInviteTarget: null,
    prepDeck: null,
    prep: null,
    cardPoolModes: lobbySettings.cardPoolModes,
    lastPlayedDecks: lobbySettings.lastPlayedDecks,
  };
}

export function matchmakingChoiceKey(
  format: Format,
  choice: { hero?: HeroId; deckId?: string },
  cardPoolMode: CardPoolMode = "legal",
): string {
  return format === "classic-battles"
    ? `${format}:hero:${choice.hero ?? "none"}`
    : `${format}:${cardPoolMode}:deck:${choice.deckId ?? "none"}`;
}

export function clearedRoomProjection(): Pick<
  StoreState,
  | "screen"
  | "roomCode"
  | "yourSeat"
  | "spectating"
  | "spectatorCount"
  | "spectatorUsernames"
  | "spectatorKicked"
  | "botGame"
  | "playerProfiles"
  | "view"
  | "viewUpdate"
  | "legal"
  | "actionCandidates"
  | "roomCommandPending"
  | "pendingInteraction"
  | "pendingDefenderStageIds"
  | "lastActionAt"
  | "opponentConnected"
  | "latestEmote"
  | "replayFrames"
  | "replayViews"
  | "replayTransitions"
  | "replayStep"
  | "replayNotes"
  | "activeSavedReplayId"
  | "rooms"
  | "inviteRoom"
  | "queuedFormat"
  | "matchmakingActive"
  | "backgroundMatchmaking"
  | "pendingBotStart"
  | "matchAcceptanceRole"
  | "prep"
  | "prepDeck"
  | "error"
  | "connectionIssueVisible"
> {
  return {
    screen: "lobby",
    roomCode: null,
    yourSeat: null,
    spectating: false,
    spectatorCount: 0,
    spectatorUsernames: [],
    spectatorKicked: false,
    botGame: false,
    playerProfiles: null,
    view: null,
    viewUpdate: { sequence: 0, source: "restore", transition: "replace" },
    legal: [],
    actionCandidates: [],
    roomCommandPending: false,
    pendingInteraction: null,
    pendingDefenderStageIds: null,
    lastActionAt: null,
    opponentConnected: true,
    latestEmote: null,
    replayFrames: 0,
    replayViews: null,
    replayTransitions: null,
    replayStep: 0,
    replayNotes: [],
    activeSavedReplayId: null,
    rooms: [],
    inviteRoom: null,
    queuedFormat: null,
    matchmakingActive: false,
    backgroundMatchmaking: { state: "inactive" },
    pendingBotStart: false,
    matchAcceptanceRole: null,
    prep: null,
    prepDeck: null,
    error: null,
    connectionIssueVisible: false,
  };
}

export function roomCodeFromLocation(pathname: string): string | null {
  const match = /^\/([0-9A-Za-z]{6})\/?$/.exec(pathname);
  return match ? match[1]!.toUpperCase() : null;
}
