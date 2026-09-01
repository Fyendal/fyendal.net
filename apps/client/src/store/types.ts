import type {
  BotOpponent,
  Format,
  GameIntent,
  GameTransitionView,
  GameView,
  PlayerProfileView,
  HeroId,
  PresentedDeck,
  PrepView,
  PriorityWindowMode,
  PlayerBadge,
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
  ReplaySummary,
} from "@fyendal/protocol";
import type {
  DeckResult,
  DeleteDeckResult,
  DeleteReplayResult,
  BugReportResult,
  LoginResult,
  RegisterResult,
} from "../auth/auth.js";
import type { ConstructedFormat } from "../domain.js";

export type Screen = "lobby" | "room-loading" | "waiting" | "prep" | "game" | "replay";
export type LobbyRail = "home" | "all" | "cc" | "silver-age" | "replays" | "account";
export type MatchAcceptanceRole = "existing" | "joining";
export interface EmoteEvent {
  id: number;
  seat: number;
  message: EmoteMessage;
}

export type OptimisticInteractionIntent = Extract<
  GameIntent,
  | { kind: "play-card" | "play-from-arsenal" | "play-from-zone" | "activate-ability" }
  | { kind: "choose" | "order-triggers" }
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
  authUser: string | null;
  authToken: string | null;
  error: string | null;
  login: (username: string, password: string) => Promise<LoginResult>;
  register: (username: string, password: string) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  clearError: () => void;
  setError: (message: string) => void;
  reportBug: (description: string) => Promise<BugReportResult>;
  bugReportNotifications: FixedBugReportNotification[];
  refreshBugReportNotifications: () => Promise<void>;
  dismissBugReportNotifications: () => Promise<void>;

  decks: DeckSummary[];
  decksLoading: boolean;
  refreshDecks: () => Promise<void>;
  importDeck: (input: {
    name: string;
    format: ConstructedFormat;
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
  allowFutureCards: Record<ConstructedFormat, boolean>;
  lastPlayedDecks: Record<ConstructedFormat, string | null>;
  setAllowFutureCards: (format: ConstructedFormat, allow: boolean) => void;
  roomCode: string | null;
  yourSeat: number | null;
  spectating: boolean;
  spectatorCount: number;
  botGame: boolean;
  playerProfiles: [PlayerProfileView, PlayerProfileView] | null;
  view: GameView | null;
  viewUpdate: ViewUpdate;
  legal: GameIntent[];
  actionCandidates: GameIntent[];
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
  matchAcceptanceRole: MatchAcceptanceRole | null;
  prep: PrepView | null;
  createRoom: (
    format: Format,
    choice: { hero?: HeroId; deckId?: string },
    visibility?: "private" | "public",
  ) => void;
  createBotRoom: (format: ConstructedFormat, deckId: string, bot?: BotOpponent) => void;
  playBotFromPrep: (format: ConstructedFormat, deckId: string, bot?: BotOpponent) => void;
  joinRoom: (code: string, deckId?: string, spectate?: boolean, hero?: HeroId) => void;
  inspectRoom: (code: string) => void;
  dismissInvite: (resetUrl?: boolean) => void;
  listRooms: () => void;
  queueJoin: (format: Format, choice: { hero?: HeroId; deckId?: string }) => void;
  queueLeave: () => void;
  acceptMatch: () => void;
  declineMatch: () => void;
  presentDeck: (deck: PresentedDeck) => void;
  prepUnready: () => void;
  chooseFirst: (first: boolean) => void;
  /** True when the command was sent or intentionally queued. */
  sendIntent: (intent: GameIntent) => boolean;
  sendPriorityMode: (mode: PriorityWindowMode) => void;
  sendRunechantSkip: (enabled: boolean) => void;
  sendEmote: (message: EmoteMessage) => void;
  undo: (target?: UndoTarget) => void;
  claimVictory: () => void;
  leave: () => void;

  replayFrames: number;
  replayViews: GameView[] | null;
  replayTransitions: Array<Omit<GameTransitionView, "fromVersion"> | null> | null;
  replayStep: number;
  activeSavedReplayId: string | null;
  savedReplays: ReplaySummary[];
  replaysLoading: boolean;
  refreshReplays: () => Promise<void>;
  watchSavedReplay: (id: string) => Promise<string | null>;
  exportSavedReplay: (id: string) => Promise<string | null>;
  deleteSavedReplay: (id: string) => Promise<DeleteReplayResult>;
  watchReplay: () => Promise<void>;
  downloadReplay: () => void;
  getRecordedViews: () => GameView[];
  openReplayText: (text: string) => string | null;
  setReplayStep: (step: number) => void;
  closeReplay: () => void;
}

export interface PreReplaySnapshot {
  view: GameView | null;
  legal: GameIntent[];
  actionCandidates: GameIntent[];
  yourSeat: number | null;
  spectating: boolean;
  spectatorCount: number;
  playerProfiles: [PlayerProfileView, PlayerProfileView] | null;
}
