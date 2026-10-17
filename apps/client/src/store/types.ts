import type {
  BotOpponent,
  BackgroundMatchmakingStatus,
  CardPoolMode,
  ChatMessage,
  ErrorCode,
  Format,
  FriendGameInvite,
  FriendRequestSummary,
  FriendSummary,
  GameIntent,
  GameTransitionView,
  GameView,
  PlayerProfileView,
  PresentedDeck,
  PresentedArena,
  PrepView,
  PriorityWindowMode,
  PlayerBadge,
  PlayerReportReason,
  RoomInvite,
  RoomSummary,
  UndoTarget,
  EmoteMessage,
} from "@fyendal/shared";
import type {
  AccountExport,
  AccountBadgesResponse,
  ApiError,
  FixedBugReportNotification,
  DeckDetailResponse,
  DeckSummary,
  FabraryDeckPreviewResponse,
  MatchListFilters,
  MatchRecords,
  MatchSummary,
  ReplaySummary,
  ReplayServerNote,
  ReplayShareVisibility,
} from "@fyendal/protocol";
import type {
  DeckResult,
  DeleteDeckResult,
  DeleteReplayResult,
  FavoriteReplayResult,
  ReplayShareResult,
  SharedReplayOpenResult,
  BugReportResult,
  LoginResult,
  PlayerReportResult,
  RegisterResult,
} from "../auth/auth.js";
import type { FabraryPlayRoute } from "../play/route.js";

export interface PendingFabraryPlay {
  route: FabraryPlayRoute;
  status: "idle" | "loading" | "ready" | "starting" | "error";
  result: DeckResult | null;
  preview?: {
    status: "loading" | "ready" | "error";
    result: FabraryDeckPreviewResponse | ApiError | null;
  };
}

export type Screen = "lobby" | "room-loading" | "waiting" | "prep" | "game" | "replay";
export type LobbyRail = "home" | "decks" | "all" | "history" | "achievements" | "account";
export type MatchAcceptanceRole = "existing" | "joining";
export interface MatchListState {
  filters: MatchListFilters;
  matches: MatchSummary[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  /** True once the first page for the current filters has arrived. */
  loaded: boolean;
}
export interface EmoteEvent {
  id: number;
  seat: number;
  message: EmoteMessage;
}

export type OptimisticInteractionIntent = Extract<
  GameIntent,
  | { kind: "play-card" | "play-from-arsenal" | "play-from-zone" | "activate-ability" }
  | { kind: "choose" | "choose-many" | "order-triggers" }
  | { kind: "pass" }
>;

/** An interaction accepted by the socket pipeline but not yet acknowledged
 * by newer authoritative room state. This drives presentation only; GameView
 * remains the sole rules state. */
export interface PendingInteraction {
  commandId: string;
  expectedVersion: number;
  intent: OptimisticInteractionIntent;
}

export type ViewUpdateSource = "live" | "replay" | "restore";
export type ViewTransition = "forward" | "backward" | "jump" | "replace";

/** Presentation-only provenance for the latest authoritative GameView
 * replacement. Consumers use it to avoid replaying motion across initial
 * loads, reconnect snapshots, replay scrubs, and other discontinuities. */
export interface ViewUpdate {
  sequence: number;
  source: ViewUpdateSource;
  transition: ViewTransition;
  roomVersion?: number;
  replayStep?: number;
  /** Authoritative semantic edge for this exact forward/backward step. */
  gameTransition?: GameTransitionView;
}

/** The single public Zustand contract. Implementation details stay in store.ts. */
export interface StoreState {
  connected: boolean;
  /** Sticky until page reload; independent of transient errors and room state. */
  clientUpdateRequired: boolean;
  /** Delayed presentation state: brief automatic reconnects stay silent. */
  connectionIssueVisible: boolean;
  authUser: string | null;
  authToken: string | null;
  error: string | null;
  login: (username: string, password: string) => Promise<LoginResult>;
  register: (username: string, password: string) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  clearError: () => void;
  setError: (message: string) => void;
  reportBug: (description: string) => Promise<BugReportResult>;
  reportOpponent: (reason: PlayerReportReason, details: string, includeChat: boolean) => Promise<PlayerReportResult>;
  reportFriend: (
    username: string,
    reason: PlayerReportReason,
    details: string,
    includeChat: boolean,
  ) => Promise<PlayerReportResult>;
  bugReportNotifications: FixedBugReportNotification[];
  refreshBugReportNotifications: () => Promise<void>;
  dismissBugReportNotifications: () => Promise<void>;

  friends: FriendSummary[];
  friendRequests: FriendRequestSummary[];
  friendGameInvites: FriendGameInvite[];
  socialOpen: boolean;
  socialError: ErrorCode | null;
  activeChat: string | null;
  incomingChatToast: ChatMessage | null;
  chatMessages: Record<string, ChatMessage[]>;
  chatHasMore: Record<string, boolean>;
  friendInviteTarget: string | null;
  setSocialOpen: (open: boolean) => void;
  clearSocialError: () => void;
  sendFriendRequest: (username: string) => void;
  respondFriendRequest: (username: string, accept: boolean) => void;
  cancelFriendRequest: (username: string) => void;
  removeFriend: (username: string) => void;
  openChat: (username: string) => void;
  closeChat: () => void;
  dismissIncomingChatToast: () => void;
  loadEarlierChat: (username: string) => void;
  sendChatMessage: (username: string, text: string) => void;
  markChatRead: (username: string) => void;
  beginFriendInvite: (username: string) => void;
  cancelFriendInvite: () => void;
  createFriendRoom: (username: string, format: Format, deckId: string) => void;
  dismissFriendGameInvite: (inviteId: string) => void;
  acceptFriendGameInvite: (inviteId: string) => void;

  decks: DeckSummary[];
  decksLoading: boolean;
  pendingFabraryPlay: PendingFabraryPlay | null;
  resolveFabraryPlay: (refresh?: boolean) => Promise<void>;
  previewFabraryPlay: () => Promise<void>;
  dismissFabraryPlay: () => void;
  startFabraryPlay: (choice: { kind: "player" } | { kind: "bot"; bot: BotOpponent; searchForPlayer: boolean }) => void;
  refreshDecks: (silent?: boolean) => Promise<void>;
  importDeck: (input: {
    name: string;
    format: Format;
    url?: string;
    text?: string;
  }) => Promise<DeckResult>;
  updateDeck: (input: { id: string; name: string; url?: string; text?: string }) => Promise<DeckResult>;
  deleteDeck: (id: string) => Promise<DeleteDeckResult>;
  exportAccount: () => Promise<{ ok: true; export: AccountExport } | ApiError>;
  getAccountBadges: () => Promise<AccountBadgesResponse | ApiError>;
  selectAccountBadge: (badge: PlayerBadge | null) => Promise<AccountBadgesResponse | ApiError>;
  deleteAccount: (password: string) => Promise<{ ok: true } | ApiError>;
  prepDeck: DeckDetailResponse["deck"] | null;
  selectPrepMatchup: (matchupId: string | null) => Promise<string | null>;

  screen: Screen;
  lobbyRail: LobbyRail;
  setLobbyRail: (rail: LobbyRail) => void;
  cardPoolModes: Record<Format, CardPoolMode>;
  deckPlayedAt: Record<string, number>;
  setCardPoolMode: (format: Format, mode: CardPoolMode) => void;
  roomCode: string | null;
  yourSeat: number | null;
  spectating: boolean;
  spectatorCount: number;
  spectatorUsernames: Array<string | null>;
  spectatorKicked: boolean;
  browserBotStatus: "fallback" | "refresh-required" | null;
  retryBrowserBot: () => void;
  botGame: boolean;
  playerProfiles: [PlayerProfileView, PlayerProfileView] | null;
  view: GameView | null;
  viewUpdate: ViewUpdate;
  legal: GameIntent[];
  actionCandidates: GameIntent[];
  /** A state-producing room command has been sent and is awaiting a newer
   * authoritative projection. Used to suppress duplicate UI submissions. */
  roomCommandPending: boolean;
  pendingInteraction: PendingInteraction | null;
  /** Latest locally requested defender set awaiting authoritative room state.
   * Presentation only; null means render the authoritative staged cards. */
  pendingDefenderStageIds: number[] | null;
  lastActionAt: [number, number] | null;
  opponentConnected: boolean;
  latestEmote: EmoteEvent | null;
  rooms: RoomSummary[];
  inviteRoom: RoomInvite | null;
  queueCounts: Record<Format, number>;
  queuedFormat: Format | null;
  matchmakingActive: boolean;
  backgroundMatchmaking: BackgroundMatchmakingStatus;
  /** The hero of a just-declined background offer, while the player may still
   * skip that hero for the rest of the search. */
  declinedBackgroundHero: { heroId: string; heroName: string } | null;
  pendingBotStart: boolean;
  /** Keep an accepted PvP offer distinct from its fallback to bot practice. */
  botMatchTransition: "accepted" | "fallback" | null;
  acknowledgeBotMatchFallback: () => void;
  matchAcceptanceRole: MatchAcceptanceRole | null;
  prep: PrepView | null;
  createRoom: (
    format: Format,
    deckId: string,
    visibility?: "private" | "public",
  ) => void;
  createBotRoom: (format: Format, deckId: string, bot?: BotOpponent, searchForPlayer?: boolean) => void;
  playBotFromPrep: (format: Format, deckId: string, bot?: BotOpponent, searchForPlayer?: boolean) => void;
  joinRoom: (code: string, deckId?: string, spectate?: boolean) => void;
  inspectRoom: (code: string) => void;
  dismissInvite: (resetUrl?: boolean) => void;
  listRooms: () => void;
  /** Suspend background sockets or establish one fresh active connection. */
  setConnectionActive: (active: boolean) => void;
  queueJoin: (format: Format, deckId: string) => void;
  queueLeave: () => void;
  stopBackgroundMatchmaking: () => void;
  acceptBackgroundMatch: () => void;
  declineBackgroundMatch: () => void;
  avoidDeclinedBackgroundHero: () => void;
  dismissDeclinedBackgroundHero: () => void;
  acceptMatch: () => void;
  declineMatch: () => void;
  presentArena: (arena: PresentedArena) => void;
  presentDeck: (deck: PresentedDeck) => void;
  prepUnready: () => void;
  chooseFirst: (first: boolean) => void;
  /** True when the command was sent or intentionally queued. */
  sendIntent: (intent: GameIntent) => boolean;
  sendPriorityMode: (mode: PriorityWindowMode) => void;
  sendRunechantSkip: (enabled: boolean) => void;
  sendEmote: (message: EmoteMessage) => void;
  kickSpectator: (username: string) => void;
  undo: (target?: UndoTarget) => void;
  claimVictory: () => void;
  leave: () => void;

  replayFrames: number;
  replayViews: GameView[] | null;
  replayTransitions: Array<Omit<GameTransitionView, "fromVersion"> | null> | null;
  replayStep: number;
  replayNotes: ReplayServerNote[];
  activeSavedReplayId: string | null;
  /** Set while watching someone's replay through a share link. */
  activeSharedReplay: { token: string; ownerUsername: string } | null;
  savedReplays: ReplaySummary[];
  replaysLoading: boolean;
  /** Counter rows for the history tab; summed in the client per filter. */
  matchRecords: MatchRecords | null;
  matchRecordsLoading: boolean;
  matchRecordsError: boolean;
  matchList: MatchListState;
  refreshMatchRecords: () => Promise<void>;
  loadMatches: (filters: MatchListFilters, cursor?: string | null) => Promise<void>;
  setMatchReplayFavorite: (matchId: string, replayId: string, favorite: boolean) => Promise<FavoriteReplayResult>;
  deleteMatchReplay: (matchId: string, replayId: string) => Promise<DeleteReplayResult>;
  refreshReplays: () => Promise<void>;
  watchSavedReplay: (id: string) => Promise<string | null>;
  exportSavedReplay: (id: string) => Promise<string | null>;
  setSavedReplayFavorite: (id: string, favorite: boolean) => Promise<FavoriteReplayResult>;
  deleteSavedReplay: (id: string) => Promise<DeleteReplayResult>;
  setReplayShare: (
    replayId: string,
    visibility: ReplayShareVisibility,
    includeNotes: boolean,
  ) => Promise<ReplayShareResult>;
  resetReplayShare: (replayId: string) => Promise<ReplayShareResult>;
  removeReplayShare: (replayId: string) => Promise<DeleteReplayResult>;
  watchSharedReplay: (token: string) => Promise<SharedReplayOpenResult>;
  watchReplay: () => Promise<void>;
  downloadReplay: () => void;
  getRecordedViews: () => GameView[];
  openReplayText: (text: string) => string | null;
  setReplayStep: (step: number) => void;
  setReplayNote: (frame: number, text: string) => void;
  setLiveReplayNote: (roomVersion: number, frame: number, text: string) => void;
  closeReplay: () => void;
}

export interface PreReplaySnapshot {
  view: GameView | null;
  legal: GameIntent[];
  actionCandidates: GameIntent[];
  yourSeat: number | null;
  spectating: boolean;
  spectatorCount: number;
  spectatorUsernames: Array<string | null>;
  playerProfiles: [PlayerProfileView, PlayerProfileView] | null;
}
