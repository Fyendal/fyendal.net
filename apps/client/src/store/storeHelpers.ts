import type { CardPoolMode, Format } from "@fyendal/shared";
import type { StoreState } from "./types.js";
import type { LobbySettings } from "../storage.js";
import { initialHistoryState } from "./historyActions.js";

export function initialStoreProjection(
  auth: { token: string; username: string } | null,
  lobbySettings: LobbySettings,
) {
  return {
    screen: "lobby" as const,
    lobbyRail: "home" as const,
    connected: false,
    clientUpdateRequired: false,
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
    ...initialHistoryState(),
    error: null,
    opponentConnected: true,
    latestEmote: null,
    authUser: auth?.username ?? null,
    authToken: auth?.token ?? null,
    rooms: [],
    inviteRoom: null,
    queueCounts: { cc: 0, "silver-age": 0 },
    queuedFormat: null,
    matchmakingActive: false,
    backgroundMatchmaking: { state: "inactive" as const },
    declinedBackgroundHero: null,
    pendingBotStart: false,
    botMatchTransition: null,
    matchAcceptanceRole: null,
    decks: [],
    decksLoading: auth !== null,
    pendingFabraryPlay: null,
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
    deckPlayedAt: {},
  };
}

export function matchmakingChoiceKey(
  format: Format,
  deckId: string | undefined,
  cardPoolMode: CardPoolMode = "legal",
): string {
  return `${format}:${cardPoolMode}:deck:${deckId ?? "none"}`;
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
  | "declinedBackgroundHero"
  | "pendingBotStart"
  | "botMatchTransition"
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
    declinedBackgroundHero: null,
    pendingBotStart: false,
    botMatchTransition: null,
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
