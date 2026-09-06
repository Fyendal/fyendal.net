import { create } from "zustand";
import type {
  BotOpponent,
  CardPoolMode,
  ClientMessage,
  EmoteMessage,
  HeroId,
  ReplayFile,
  ServerMessage,
} from "@fyendal/shared";
import {
  parseReplayFile,
  removeUnsupportedLocalReplays,
} from "./replay/recorder.js";
import { savedReplayIdFromPath } from "./replay/route.js";
import { RoomVersionGate } from "./versionGate.js";
import {
  decodeServerMessage,
  MAX_REPLAY_NOTE_LENGTH,
  replayFileNotes,
  type ReplayServerNote,
} from "@fyendal/protocol";
import {
  AUTH_STORAGE_KEY,
  DEFAULT_LOBBY_SETTINGS,
  LOBBY_SETTINGS_STORAGE_KEY,
  loadRejectedMatchRoomsForChoice,
  loadLobbySettings,
  pruneRejectedMatchRooms,
  rememberRejectedMatchRoom,
  saveLobbySettings,
} from "./storage.js";
import {
  loadRoomSession,
  loadStoredAuth,
  clearRoomSessions,
  removeRoomSession,
  saveRoomSession,
  saveStoredAuth,
} from "./store/sessionStorage.js";
import type {
  OptimisticInteractionIntent,
  PreReplaySnapshot,
  StoreState,
  ViewTransition,
  ViewUpdate,
} from "./store/types.js";
import { createReplayRuntime, downloadReplayFile } from "./store/replayRuntime.js";
import {
  clearedRoomProjection,
  initialStoreProjection,
  matchmakingChoiceKey,
  roomCodeFromLocation,
} from "./store/storeHelpers.js";
import type { ConstructedFormat } from "./domain.js";
import {
  apiDeck,
  apiLogin,
  apiLogout,
  apiReplayNotes,
  apiRegister,
  apiRoomReplay,
  apiSaveReplayNote,
} from "./auth/auth.js";
import { createAccountActions } from "./store/accountActions.js";
import { createReplayActions } from "./store/replayActions.js";
import { replayViewerProjection, snapshotBeforeReplay } from "./store/replayView.js";
import { createErrorController } from "./store/errorController.js";
import { withReplayNotes } from "./replay/replayFileNotes.js";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectNoticeTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_NOTICE_GRACE_MS = 5_000;
let reconnectAttempts = 0;
let emoteSequence = 0;
let viewUpdateSequence = 0;
const friendInviteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const SOCIAL_ERROR_CODES = new Set([
  "USER_NOT_FOUND",
  "INVALID_FRIEND_REQUEST",
  "FRIEND_REQUEST_CONFLICT",
  "FRIEND_REQUIRED",
  "FRIEND_UNAVAILABLE",
  "MESSAGE_BOUNDS",
  "MESSAGE_RATE_LIMITED",
]);
const roomVersions = new RoomVersionGate();
const replayRuntime = createReplayRuntime(localStorage);

function nextViewUpdate(
  update: Omit<ViewUpdate, "sequence">,
): ViewUpdate {
  return { sequence: ++viewUpdateSequence, ...update };
}

// Local recordings are reload fallbacks, not a compatibility surface. Remove
// pre-launch entries before any room can attempt to resume one.
removeUnsupportedLocalReplays(localStorage);

// Vite HMR re-runs this module on every client edit — drop the orphaned
// socket (nulling ws first makes its onclose a no-op, so the dead module
// never schedules a reconnect) or dev sessions pile connections up against
// the server's per-IP cap (WS_MAX_PER_IP)
import.meta.hot?.dispose(() => {
  const orphaned = ws;
  ws = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (reconnectNoticeTimer) clearTimeout(reconnectNoticeTimer);
  reconnectNoticeTimer = null;
  orphaned?.close();
});

/** deck chosen for the current cc/silver-age prep session (queue or hosted room) */
let prepDeckId: string | null = null;
/** hero picked for the current classic-battles prep session (queue or hosted room) */
let prepHero: HeroId | null = null;

/** store snapshot taken when a replay opens from the game screen; restored on close */
let preReplay: PreReplaySnapshot | null = null;
/** Database target for edits in a server-backed replay; imported files use null. */
let activeReplayNoteServerTarget: { replayId: string } | { roomCode: string } | null = null;
/** Prevent an older note fetch from replacing a newer local edit. */
let replayNoteMutationEpoch = 0;

function replaceReplayNote(
  notes: readonly ReplayServerNote[],
  frame: number,
  text: string,
  roomVersion?: number,
): ReplayServerNote[] {
  return notes
    .filter((note) => note.frame !== frame)
    .concat(text ? [{ frame, text, ...(roomVersion === undefined ? {} : { roomVersion }) }] : [])
    .sort((a, b) => a.frame - b.frame);
}

export const useStore = create<StoreState>((set, get) => {
  const errors = createErrorController(set);
  /** callbacks waiting for the in-flight connection attempt to open */
  let pendingOpen: (() => void)[] = [];
  /** the token the live socket has authenticated with (null = anonymous) */
  let authedToken: string | null = null;
  /** True until a URL inspection resolves or a player join receives the first
   *  usable room projection. A `joined` acknowledgement alone is insufficient:
   *  loading the authoritative room can still fail immediately afterwards. */
  let roomEntryPending = false;
  /** A stored room credential is an existing membership, so a connection
   *  failure while restoring it is an outage to retry, not a failed new join
   *  that should erase the credential and room URL. */
  let roomEntryRetryable = false;
  /** Coalesces React Strict Mode and other overlapping attempts to restore the
   *  same room before its first authoritative projection arrives. */
  let joiningRoomCode: string | null = null;
  /** Visibility controls when retries run, but does not define socket health. */
  let pageActive = true;
  let reconnectOnActive = false;
  /** A bot-room request waiting for the retained matchmaking room to release
   *  this socket. WebSocket commands stay ordered by waiting for `left`. */
  let pendingBotRoom: { format: ConstructedFormat; deckId: string; bot?: BotOpponent; searchForPlayer?: boolean } | null = null;
  /** Choice associated with the current/most recent matchmaking request. */
  let activeMatchmakingChoiceKey: string | null = null;
  /** In-memory monotonic race fences for callbacks that outlive the
   *  connection/account that created them. These are not storage or token
   *  versions. An AbortController reduces wasted work; the fence check is
   *  still authoritative because a fetch implementation may ignore abort. */
  let connectionEpoch = 0;
  let authEpoch = 0;
  let authRequests = new AbortController();
  let completedReplaySync: { code: string; promise: Promise<ReplayFile | null> } | null = null;
  /** Game mutations use optimistic versions, so only one state-producing
   *  command may be in flight per socket. Defender staging is the exception
   *  users commonly click through: retain its latest desired set and send it
   *  after the authoritative state. */
  let inFlightRoomCommand: { expectedVersion: number; defenderStageIds?: number[] } | null = null;
  let queuedDefenderStageIds: number[] | null = null;

  function advanceAuthEpoch(): { epoch: number; signal: AbortSignal } {
    authEpoch += 1;
    authRequests.abort();
    authRequests = new AbortController();
    return { epoch: authEpoch, signal: authRequests.signal };
  }

  function authRequest(token: string): { epoch: number; token: string; signal: AbortSignal } {
    return { epoch: authEpoch, token, signal: authRequests.signal };
  }

  function isCurrentAuth(request: { epoch: number; token: string }): boolean {
    return request.epoch === authEpoch && request.token === get().authToken;
  }

  function resetRoomCommandPipeline(): void {
    inFlightRoomCommand = null;
    queuedDefenderStageIds = null;
    const state = get();
    if (
      state.roomCommandPending
      || state.pendingInteraction !== null
      || state.pendingDefenderStageIds !== null
    ) {
      set({
        roomCommandPending: false,
        pendingInteraction: null,
        pendingDefenderStageIds: null,
      });
    }
  }

  function resetRoomVersionState(): void {
    roomVersions.reset();
    resetRoomCommandPipeline();
  }

  function clearReconnectNotice(): void {
    if (reconnectNoticeTimer) clearTimeout(reconnectNoticeTimer);
    reconnectNoticeTimer = null;
    if (get().connectionIssueVisible) set({ connectionIssueVisible: false });
  }

  function cancelReconnect(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
    clearReconnectNotice();
  }

  function scheduleReconnectNotice(): void {
    if (reconnectNoticeTimer || get().connectionIssueVisible || !get().roomCode) return;
    reconnectNoticeTimer = setTimeout(() => {
      reconnectNoticeTimer = null;
      if (!get().connected && get().roomCode) set({ connectionIssueVisible: true });
    }, RECONNECT_NOTICE_GRACE_MS);
  }

  function closeCurrentSocket(): void {
    cancelReconnect();
    const socket = ws;
    ws = null;
    connectionEpoch += 1;
    socket?.close();
    pendingOpen = [];
    authedToken = null;
    joiningRoomCode = null;
    resetRoomCommandPipeline();
  }

  /** A failed initial room load must not leave the lobby associated with the
   *  room URL/session (or keep a socket attached server-side). */
  function abandonPendingRoomEntry(): void {
    const reopenLobby = get().authUser !== null;
    roomEntryPending = false;
    roomEntryRetryable = false;
    joiningRoomCode = null;
    removeRoomSession(localStorage, get().roomCode ?? roomCodeFromLocation(location.pathname));
    closeCurrentSocket();
    history.replaceState(null, "", "/");
    replayRuntime.discard();
    prepDeckId = null;
    prepHero = null;
    preReplay = null;
    activeReplayNoteServerTarget = null;
    resetRoomVersionState();
    set({ ...clearedRoomProjection(), connected: false });
    // The lobby component may already be mounted, so its auth-dependent effect
    // will not necessarily run again after this reset.
    if (reopenLobby) get().listRooms();
  }

  function failPendingRoomEntry(message: string): boolean {
    if (!roomEntryPending) return false;
    abandonPendingRoomEntry();
    errors.show(message);
    return true;
  }

  function clearAuthenticatedState(): void {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    clearRoomSessions(localStorage);
    roomEntryPending = false;
    roomEntryRetryable = false;
    joiningRoomCode = null;
    closeCurrentSocket();
    history.replaceState(null, "", "/");
    replayRuntime.discard();
    prepDeckId = null;
    prepHero = null;
    preReplay = null;
    resetRoomVersionState();
    for (const timer of friendInviteTimers.values()) clearTimeout(timer);
    friendInviteTimers.clear();
    set({
      ...clearedRoomProjection(),
      connected: false,
      authToken: null,
      authUser: null,
      decks: [],
      decksLoading: false,
      bugReportNotifications: [],
      friends: [],
      friendRequests: [],
      friendGameInvites: [],
      socialOpen: false,
      socialError: null,
      activeChat: null,
      chatMessages: {},
      chatHasMore: {},
      friendInviteTarget: null,
      savedReplays: [],
      replaysLoading: false,
      queueCounts: { "classic-battles": 0, cc: 0, "silver-age": 0 },
      lobbyRail: "home",
      cardPoolModes: { ...DEFAULT_LOBBY_SETTINGS.cardPoolModes },
      lastPlayedDecks: { ...DEFAULT_LOBBY_SETTINGS.lastPlayedDecks },
    });
  }

  /** Authenticate the live socket if it hasn't seen the current token yet —
   *  covers logging in while already connected (no reconnect happens then). */
  function authSocketIfNeeded(): void {
    const token = get().authToken;
    if (token && token !== authedToken) {
      authedToken = token;
      send({ type: "auth", token });
    }
  }

  function connect(onOpen: () => void): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      authSocketIfNeeded();
      return onOpen();
    }
    pendingOpen.push(onOpen);
    if (ws && ws.readyState === WebSocket.CONNECTING) return; // attach to the in-flight attempt
    ws?.close();
    const apiOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined) ?? "";
    const url = apiOrigin
      ? apiOrigin.replace(/^http(s?):\/\//, "ws$1://")
      : `ws://${location.hostname}:8080`;
    const socket = new WebSocket(url);
    ws = socket;
    const epoch = ++connectionEpoch;
    socket.onopen = () => {
      if (ws !== socket || connectionEpoch !== epoch) return; // superseded by a newer socket
      cancelReconnect();
      set({ connected: true, connectionIssueVisible: false });
      // authenticate the socket before anything else, when we have a token
      authSocketIfNeeded();
      const cbs = pendingOpen;
      pendingOpen = [];
      for (const cb of cbs) cb();
    };
    socket.onclose = () => {
      if (ws !== socket || connectionEpoch !== epoch) return; // superseded by a newer socket
      ws = null;
      connectionEpoch += 1;
      pendingOpen = [];
      authedToken = null;
      joiningRoomCode = null;
      resetRoomCommandPipeline();
      set({ connected: false });
      if (roomEntryPending && !roomEntryRetryable) {
        failPendingRoomEntry("connection to room failed");
        return;
      }
      if (!pageActive || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
        pageActive = false;
        reconnectOnActive = true;
        clearReconnectNotice();
        return;
      }
      reconnectWithBackoff();
    };
    socket.onerror = () => {
      if (ws !== socket || connectionEpoch !== epoch) return; // a superseded socket failing is not news
      // The close event owns retrying a persisted room recovery. Clearing it
      // here would turn a transient restart into a manual lobby rejoin.
      if (roomEntryPending && roomEntryRetryable) return;
      if (failPendingRoomEntry("connection to room failed")) return;
      // in a room the close handler retries quietly — don't spam toasts
      if (!get().roomCode) errors.show("connection failed — is the server running?");
    };
    socket.onmessage = (ev) => {
      if (ws !== socket || connectionEpoch !== epoch) return;
      try {
        const message = decodeServerMessage(JSON.parse(String(ev.data)));
        if (message) handleMessage(message);
        else failPendingRoomEntry("room state could not be loaded");
      } catch {
        // A bad unrelated frame must not kill a working game, but during room
        // entry it means there is no usable projection to render.
        failPendingRoomEntry("room state could not be loaded");
      }
    };
  }

  /**
   * Cloud Run recycles WebSocket connections (request timeout, instance
   * replacement); rejoin the room with the stored seat token. Backoff:
   * 1s, 2s, 4s … capped at 10s, plus jitter.
   */
  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    if (!get().roomCode && !get().authToken) return;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 10_000) + Math.random() * 500;
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      restoreConnection();
    }, delay);
  }

  function restoreConnection(): void {
    const code = get().roomCode;
    if (code) get().joinRoom(code);
    else connect(() => send({ type: "list-rooms" }));
  }

  function reconnectWithBackoff(): void {
    scheduleReconnectNotice();
    scheduleReconnect();
  }

  /** Visibility changes do not imply a disconnect. Keep a browser-reported
   * OPEN/CONNECTING socket, and only accelerate recovery of a socket whose
   * close event has already run. */
  function setConnectionActive(active: boolean): void {
    pageActive = active;

    if (!active) {
      if (reconnectTimer) {
        reconnectOnActive = true;
        cancelReconnect();
      }
      return;
    }

    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
      reconnectOnActive = false;
      clearReconnectNotice();
      return;
    }

    // A brand-new room entry still needs its original deck/hero parameters.
    // Its own socket callbacks remain authoritative until membership exists.
    if (joiningRoomCode !== null && !get().roomCode) return;

    const shouldRestore = reconnectOnActive
      || reconnectTimer !== null
      || ws !== null
      || get().roomCode !== null;
    if (!shouldRestore) return;

    reconnectOnActive = false;
    closeCurrentSocket();
    set({ connected: false });
    restoreConnection();
  }

  function send(msg: ClientMessage): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  function roomCommand(): { commandId: string; expectedVersion: number } {
    const expectedVersion = roomVersions.current();
    const commandId = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-command`;
    return { commandId, expectedVersion };
  }

  function sameInstanceIds(left: readonly number[], right: readonly number[]): boolean {
    if (left.length !== right.length) return false;
    const ids = new Set(left);
    return right.every((id) => ids.has(id));
  }

  function authoritativeStagedDefenderIds(): number[] {
    const decision = get().view?.pendingDecision;
    return decision?.kind === "defend"
      ? (decision.stagedCards ?? []).map((card) => card.instanceId)
      : [];
  }

  /** Apply the latest rendered add/remove delta to the command pipeline's
   * desired set. The rendered set may be optimistic while an earlier staging
   * command is still awaiting authoritative room state. */
  function mergedDefenderStageIds(requestedIds: readonly number[]): number[] {
    const authoritative = new Set(authoritativeStagedDefenderIds());
    const requested = new Set(requestedIds);
    const presented = new Set(get().pendingDefenderStageIds ?? authoritative);
    const desired = new Set(
      get().pendingDefenderStageIds
      ?? queuedDefenderStageIds
      ?? inFlightRoomCommand?.defenderStageIds
      ?? authoritative,
    );
    for (const id of presented) {
      if (!requested.has(id)) desired.delete(id);
    }
    for (const id of requested) {
      if (!presented.has(id)) desired.add(id);
    }
    return [...desired];
  }

  function sendVersionedRoomCommand(
    createMessage: (command: { commandId: string; expectedVersion: number }) => ClientMessage,
    defenderStageIds?: number[],
    pendingInteractionIntent?: OptimisticInteractionIntent,
  ): boolean {
    if (inFlightRoomCommand) return false;
    const command = roomCommand();
    if (!send(createMessage(command))) return false;
    inFlightRoomCommand = defenderStageIds === undefined
      ? { expectedVersion: command.expectedVersion }
      : { expectedVersion: command.expectedVersion, defenderStageIds };
    set({
      roomCommandPending: true,
      ...(pendingInteractionIntent
        ? { pendingInteraction: { ...command, intent: pendingInteractionIntent } }
        : {}),
    });
    return true;
  }

  function queueOrSendDefenderStage(requestedIds: readonly number[]): boolean {
    const desiredIds = mergedDefenderStageIds(requestedIds);
    if (inFlightRoomCommand) {
      queuedDefenderStageIds = inFlightRoomCommand.defenderStageIds
        && sameInstanceIds(desiredIds, inFlightRoomCommand.defenderStageIds)
        ? null
        : desiredIds;
      set({ pendingDefenderStageIds: desiredIds });
      return true;
    }
    queuedDefenderStageIds = null;
    const accepted = sendVersionedRoomCommand(
      (command) => ({
        type: "intent",
        intent: { kind: "stage-defenders", instanceIds: desiredIds },
        ...command,
      }),
      desiredIds,
    );
    if (accepted) set({ pendingDefenderStageIds: desiredIds });
    return accepted;
  }

  /** A newer state is the acknowledgement for the one outstanding mutation.
   * Revalidate coalesced staging against that projection before flushing it
   * after the authoritative view has been installed. */
  function acceptRoomCommandState(
    version: number,
    message: Extract<ServerMessage, { type: "state" }>,
  ): { acknowledged: boolean; defenderStageIds: number[] | null } {
    const command = inFlightRoomCommand;
    if (!command || version <= command.expectedVersion) {
      return { acknowledged: false, defenderStageIds: null };
    }
    inFlightRoomCommand = null;
    const desiredIds = queuedDefenderStageIds;
    queuedDefenderStageIds = null;
    if (!desiredIds || get().screen === "replay") {
      return { acknowledged: true, defenderStageIds: null };
    }
    const decision = message.view.pendingDecision;
    const stageable = new Set(message.legal.flatMap((intent) =>
      intent.kind === "stage-defenders" ? intent.instanceIds : []
    ));
    if (
      decision?.kind !== "defend"
      || decision.player !== message.yourSeat
      || !desiredIds.every((id) => stageable.has(id))
    ) return { acknowledged: true, defenderStageIds: null };
    const authoritativeIds = (decision.stagedCards ?? []).map((card) => card.instanceId);
    return {
      acknowledged: true,
      defenderStageIds: sameInstanceIds(desiredIds, authoritativeIds) ? null : desiredIds,
    };
  }

  /** Fetch the full registered pool for the prep room (idempotent per deck). */
  async function loadPrepDeck(id: string): Promise<void> {
    const token = get().authToken;
    if (!token || get().prepDeck?.id === id) return;
    const request = authRequest(token);
    // hardcoded precons have no DB row — synthesize locally
    if (id.startsWith("precon-")) {
      const { preconPrepDeck } = await import("./prep/prepDeck.js");
      const deck = preconPrepDeck(id);
      if (deck && prepDeckId === id && isCurrentAuth(request)) set({ prepDeck: deck });
      return;
    }
    const r = await apiDeck(token, id, request.signal);
    if (!isCurrentAuth(request)) return;
    if (r.ok && prepDeckId === id) {
      set({ prepDeck: r.deck });
    } else if (!r.ok) {
      // surface the failure — otherwise the prep room shows "Loading your deck…"
      // forever; the user can get back with the Cancel button there
      errors.show(r.error);
    }
  }

  /** Route to the prep screen with whatever pool this session uses. */
  function loadClassicPrepDeck(hero: HeroId): void {
    void import("./prep/prepDeck.js").then(({ classicBattlesPrepDeck }) => {
      if (prepHero === hero) set({ prepDeck: classicBattlesPrepDeck(hero) });
    });
  }

  function enterPrep() {
    if (prepDeckId) {
      set({ screen: "prep" });
      void loadPrepDeck(prepDeckId);
    } else if (prepHero) {
      const hero = prepHero;
      set({ screen: "prep", prepDeck: null });
      loadClassicPrepDeck(hero);
    }
  }

  function launchPendingBotRoom(): void {
    const pending = pendingBotRoom;
    if (!pending) return;
    pendingBotRoom = null;
    removeRoomSession(localStorage, get().roomCode);
    history.replaceState(null, "", "/");
    replayRuntime.discard(get().roomCode);
    resetRoomVersionState();
    set(clearedRoomProjection());
    get().createBotRoom(pending.format, pending.deckId, pending.bot, pending.searchForPlayer);
  }

  function syncCompletedReplay(code: string): Promise<ReplayFile | null> {
    if (completedReplaySync?.code === code) return completedReplaySync.promise;
    const token = get().authToken;
    if (!token) return Promise.resolve(null);
    const request = authRequest(token);
    const noteMutationAtRequest = replayNoteMutationEpoch;
    const promise = (async () => {
      const result = await apiRoomReplay(token, code, request.signal);
      if (!isCurrentAuth(request) || get().roomCode !== code || !result.ok) return null;
      const noteResult = await apiReplayNotes(token, { roomCode: code }, request.signal);
      if (!isCurrentAuth(request) || get().roomCode !== code) return null;
      if (!noteResult.ok) return null;
      const frames = replayRuntime.replace(code, result.replay);
      set({
        replayFrames: frames,
        replayNotes: replayNoteMutationEpoch === noteMutationAtRequest
          ? noteResult.notes
          : get().replayNotes,
      });
      return result.replay;
    })().finally(() => {
      if (completedReplaySync?.promise === promise) completedReplaySync = null;
    });
    completedReplaySync = { code, promise };
    return promise;
  }

  function handleMessage(msg: ServerMessage): void {
    if (msg.type === "room-created" || msg.type === "joined") resetRoomVersionState();
    if ("version" in msg && !roomVersions.accept(msg.type, msg.version)) return;
    switch (msg.type) {
      case "authed":
        saveStoredAuth(localStorage, { token: get().authToken ?? "", username: msg.username });
        set({ authUser: msg.username });
        void get().refreshDecks();
        void get().refreshReplays();
        // logging in while on the lobby: re-list so "Your Games" flags appear
        if (get().screen === "lobby") get().listRooms();
        break;
      case "social-snapshot": {
        const friendKeys = new Set(msg.snapshot.friends.map((friend) => friend.username.toLowerCase()));
        const chatMessages = Object.fromEntries(
          Object.entries(get().chatMessages).filter(([key]) => friendKeys.has(key)),
        );
        const chatHasMore = Object.fromEntries(
          Object.entries(get().chatHasMore).filter(([key]) => friendKeys.has(key)),
        );
        const activeChat = get().activeChat;
        const incomingChatToast = get().incomingChatToast;
        set({
          friends: msg.snapshot.friends,
          friendRequests: msg.snapshot.requests,
          chatMessages,
          chatHasMore,
          activeChat: activeChat && friendKeys.has(activeChat.toLowerCase()) ? activeChat : null,
          incomingChatToast: incomingChatToast
            && friendKeys.has(incomingChatToast.friendUsername.toLowerCase())
            ? incomingChatToast
            : null,
        });
        break;
      }
      case "friend-presence":
        set({
          friends: get().friends.map((friend) => friend.username.toLowerCase() === msg.username.toLowerCase()
            ? { ...friend, presence: msg.presence }
            : friend),
        });
        break;
      case "chat-history": {
        const key = msg.username.toLowerCase();
        const current = get().chatMessages[key] ?? [];
        const byId = new Map([...msg.messages, ...current].map((message) => [message.id, message]));
        const messages = [...byId.values()].sort((a, b) => a.sentAt - b.sentAt || Number(a.id) - Number(b.id));
        set({
          chatMessages: { ...get().chatMessages, [key]: messages },
          chatHasMore: { ...get().chatHasMore, [key]: msg.hasMore },
        });
        const latest = messages.at(-1);
        if (latest && get().activeChat?.toLowerCase() === key && document.visibilityState === "visible") {
          send({ type: "chat-read", username: msg.username, throughId: latest.id });
        }
        break;
      }
      case "chat-message": {
        const key = msg.message.friendUsername.toLowerCase();
        const current = get().chatMessages[key] ?? [];
        const alreadyReceived = current.some((message) => message.id === msg.message.id);
        const messages = alreadyReceived
          ? current.map((message) => message.id === msg.message.id ? msg.message : message)
          : [...current, msg.message];
        const isIncoming = msg.message.senderUsername.toLowerCase() !== get().authUser?.toLowerCase();
        const conversationIsOpen = get().activeChat?.toLowerCase() === key;
        set({
          chatMessages: { ...get().chatMessages, [key]: messages },
          ...(isIncoming && !conversationIsOpen && !alreadyReceived
            ? { incomingChatToast: msg.message }
            : {}),
        });
        if (get().activeChat?.toLowerCase() === key && document.visibilityState === "visible") {
          send({ type: "chat-read", username: msg.message.friendUsername, throughId: msg.message.id });
        }
        break;
      }
      case "friend-game-invite": {
        const remainingMs = 15 * 60 * 1000 - (Date.now() - msg.invite.sentAt);
        if (remainingMs <= 0) break;
        const previousTimer = friendInviteTimers.get(msg.invite.inviteId);
        if (previousTimer) clearTimeout(previousTimer);
        set({
          friendGameInvites: [
            ...get().friendGameInvites.filter((invite) => invite.inviteId !== msg.invite.inviteId),
            msg.invite,
          ],
        });
        friendInviteTimers.set(msg.invite.inviteId, setTimeout(() => {
          friendInviteTimers.delete(msg.invite.inviteId);
          set({ friendGameInvites: get().friendGameInvites.filter((invite) => invite.inviteId !== msg.invite.inviteId) });
        }, remainingMs));
        break;
      }
      case "friend-game-invite-dismissed": {
        const timer = friendInviteTimers.get(msg.inviteId);
        if (timer) clearTimeout(timer);
        friendInviteTimers.delete(msg.inviteId);
        set({ friendGameInvites: get().friendGameInvites.filter((invite) => invite.inviteId !== msg.inviteId) });
        break;
      }
      case "auth-failed":
        // The server rejected this account context. Abort its HTTP work and
        // clear every private/account-owned projection before reconnecting.
        advanceAuthEpoch();
        clearAuthenticatedState();
        break;
      case "room-created": {
        const fromMatchmaking = get().queuedFormat !== null || get().matchmakingActive;
        roomEntryPending = false;
        roomEntryRetryable = false;
        joiningRoomCode = null;
        saveRoomSession(localStorage, { code: msg.code, token: msg.token });
        history.replaceState(null, "", `/${msg.code}`);
        set({
          roomCode: msg.code,
          yourSeat: msg.seat,
          spectating: false,
          spectatorKicked: false,
          inviteRoom: null,
          friendInviteTarget: null,
          error: null,
          queuedFormat: null,
          matchmakingActive: fromMatchmaking,
          matchAcceptanceRole: fromMatchmaking ? "existing" : null,
        });
        // hosts land on the prep room once the room exists
        if (prepDeckId || prepHero) {
          enterPrep();
        } else {
          set({ screen: "waiting" });
        }
        break;
      }
      case "joined": {
        const fromMatchmaking = get().queuedFormat !== null || get().matchmakingActive;
        saveRoomSession(localStorage, { code: msg.code, token: msg.token });
        history.replaceState(null, "", `/${msg.code}`);
        set({
          roomCode: msg.code,
          yourSeat: msg.seat,
          spectating: msg.spectator === true,
          spectatorKicked: false,
          inviteRoom: null,
          friendInviteTarget: null,
          error: null,
          queuedFormat: null,
          matchmakingActive: fromMatchmaking,
          matchAcceptanceRole: fromMatchmaking ? "joining" : null,
        });
        // Matchmade joiners accept from a focused holding screen. Manual joins
        // can enter prep immediately; prep-state arrives right after either.
        if (fromMatchmaking && !msg.spectator) set({ screen: "waiting" });
        else if ((prepDeckId || prepHero) && !msg.spectator) enterPrep();
        // a spectator joining before the game starts gets a holding screen;
        // the first state message flips it to the game board
        else if (
          msg.spectator
          && (get().screen === "lobby" || get().screen === "room-loading")
        ) set({ screen: "waiting" });
        // Spectators legitimately receive no state while a game is still in
        // prep, so the acknowledgement completes their room entry.
        if (msg.spectator) {
          roomEntryPending = false;
          roomEntryRetryable = false;
          joiningRoomCode = null;
        }
        break;
      }
      case "room-info":
        roomEntryPending = false;
        roomEntryRetryable = false;
        set({ inviteRoom: msg.room, error: null });
        break;
      case "game-started":
        // Cluster sync broadcasts announce that an authoritative game state
        // exists, including after ordinary in-game mutations. Only the first
        // announcement starts a new local recording; later ones are refreshes.
        if (get().view !== null || get().screen === "replay") break;
        // a new game in this room — drop any stale recording
        replayRuntime.discard(get().roomCode);
        prepDeckId = null;
        prepHero = null;
        set({
          screen: "game",
          replayFrames: 0,
          prep: null,
          prepDeck: null,
          opponentConnected: true,
          latestEmote: null,
          matchmakingActive: false,
          matchAcceptanceRole: null,
          replayNotes: [],
        });
        break;
      case "state": {
        roomEntryPending = false;
        roomEntryRetryable = false;
        joiningRoomCode = null;
        // keep recording frames even while watching a replay of this room
        const code = get().roomCode;
        const frames = code
          ? replayRuntime.recordFrame(code, msg.version, msg.view, msg.yourSeat, msg.transition)
          : get().replayFrames;
        const commandState = acceptRoomCommandState(msg.version, msg);
        if (get().screen === "replay") {
          if (commandState.acknowledged) {
            set({
              roomCommandPending: false,
              pendingInteraction: null,
              pendingDefenderStageIds: null,
            });
          }
          break; // replay viewer owns the screen
        }
        const current = get();
        const restoreVersion = msg.transition?.kind === "replace"
          ? msg.transition.restoreVersion ?? null
          : null;
        const replayNotes = current.replayNotes.filter((note) =>
          note.frame < frames
          && (restoreVersion === null
            || note.roomVersion === undefined
            || note.roomVersion <= restoreVersion));
        if (code && current.replayFrames === 0 && current.authToken) {
          const notesCode = code;
          const notesToken = current.authToken;
          const noteMutationAtRequest = replayNoteMutationEpoch;
          void apiReplayNotes(notesToken, { roomCode: notesCode }).then((result) => {
            if (result.ok && get().authToken === notesToken
              && get().roomCode === notesCode && get().screen === "game"
              && replayNoteMutationEpoch === noteMutationAtRequest) {
              set({
                replayNotes: result.notes.filter((note) => note.frame < get().replayFrames),
              });
            }
          });
        }
        const previousLiveVersion = current.viewUpdate.source === "live"
          ? current.viewUpdate.roomVersion
          : undefined;
        const continuousLiveState = current.view?.gameId === msg.view.gameId
          && previousLiveVersion !== undefined
          && msg.version === previousLiveVersion + 1;
        set({
          view: msg.view,
          viewUpdate: nextViewUpdate({
            source: "live",
            transition: continuousLiveState ? "forward" : "replace",
            roomVersion: msg.version,
            ...(continuousLiveState && msg.transition?.fromVersion === previousLiveVersion
              ? { gameTransition: msg.transition }
              : {}),
          }),
          legal: msg.legal,
          actionCandidates: msg.actionCandidates ?? msg.legal,
          roomCommandPending: commandState.acknowledged
            ? false
            : current.roomCommandPending,
          pendingInteraction: commandState.acknowledged ? null : get().pendingInteraction,
          pendingDefenderStageIds: commandState.acknowledged
            ? commandState.defenderStageIds
            : get().pendingDefenderStageIds,
          playerProfiles: msg.playerProfiles,
          yourSeat: msg.yourSeat,
          spectatorCount: msg.spectators ?? 0,
          botGame: msg.botGame === true,
          lastActionAt: msg.lastActionAt,
          screen: "game",
          replayFrames: frames,
          replayNotes,
          ...(msg.botGame === true ? { pendingBotStart: false } : {}),
        });
        if (msg.botGame === true) send({ type: "background-matchmaking-status" });
        if (commandState.defenderStageIds) {
          queueOrSendDefenderStage(commandState.defenderStageIds);
        }
        if (msg.view.winner !== null && get().authToken) {
          if (code) void syncCompletedReplay(code);
          void get().refreshReplays();
        }
        break;
      }
      case "spectators":
        set({ spectatorCount: msg.count });
        break;
      case "spectator-list":
        set({ spectatorUsernames: msg.usernames });
        break;
      case "rooms":
        if (get().authUser) {
          pruneRejectedMatchRooms(
            localStorage,
            get().authUser!,
            new Set(msg.rooms.map((room) => room.code.toUpperCase())),
          );
        }
        set({ rooms: msg.rooms });
        break;
      case "queue-status":
        set({ queueCounts: msg.counts });
        break;
      case "queued":
        set({ queuedFormat: msg.format, matchmakingActive: true });
        // queueing lives on the prep screen (sideboard while waiting)
        enterPrep();
        break;
      case "queue-left":
        set({ queuedFormat: null, matchmakingActive: false });
        launchPendingBotRoom();
        break;
      case "background-matchmaking":
        set(msg.status.state === "pending"
          ? { backgroundMatchmaking: { state: "inactive" }, pendingBotStart: true }
          : { backgroundMatchmaking: msg.status, pendingBotStart: false });
        break;
      case "match-timeout":
        removeRoomSession(localStorage, get().roomCode);
        history.replaceState(null, "", "/");
        replayRuntime.discard(get().roomCode);
        prepDeckId = null;
        prepHero = null;
        resetRoomVersionState();
        set(clearedRoomProjection());
        errors.show("Match cancelled because you missed the pre-game deadline.");
        get().listRooms();
        break;
      case "prep-state": {
        roomEntryPending = false;
        roomEntryRetryable = false;
        joiningRoomCode = null;
        const current = get();
        const currentSeat = msg.prep.seats[msg.prep.yourSeat];
        if (current.matchmakingActive || msg.prep.deadlinePhase !== undefined) {
          activeMatchmakingChoiceKey = matchmakingChoiceKey(msg.prep.format, {
            hero: currentSeat?.hero,
            deckId: msg.prep.yourDeckId,
          }, msg.prep.cardPoolMode ?? "legal");
        }
        const accepting = msg.prep.deadlinePhase === "accept";
        const matchAcceptanceRole = accepting
          ? current.matchAcceptanceRole ?? "existing"
          : null;
        const screen = accepting && matchAcceptanceRole === "joining" && currentSeat?.accepted !== true
          ? "waiting" as const
          : "prep" as const;
        set({
          prep: msg.prep,
          botGame: msg.prep.botGame === true,
          queuedFormat: null,
          matchAcceptanceRole,
        });
        // reconnect path: recover the pool from the seat's deck id
        if (msg.prep.yourDeckId) {
          prepDeckId = msg.prep.yourDeckId;
          void loadPrepDeck(msg.prep.yourDeckId);
        } else if (msg.prep.format === "classic-battles") {
          // no saved deck — the pool is the seat's fixed box list
          const hero = msg.prep.seats[msg.prep.yourSeat]?.hero;
          if (hero) {
            prepHero = hero;
            if (get().prepDeck?.id !== `classic-battles-${hero}`) {
              loadClassicPrepDeck(hero);
            }
          }
        }
        if (get().screen !== "game" && get().screen !== "replay") set({ screen });
        break;
      }
      case "left":
        // Normal exits reset optimistically in leave(). A queue-to-bot handoff
        // waits for this acknowledgement before reusing the socket.
        launchPendingBotRoom();
        break;
      case "spectator-kicked":
        cancelReconnect();
        removeRoomSession(localStorage, get().roomCode);
        history.replaceState(null, "", "/");
        replayRuntime.discard(get().roomCode);
        prepDeckId = null;
        prepHero = null;
        resetRoomVersionState();
        set({ ...clearedRoomProjection(), spectatorKicked: true });
        get().listRooms();
        break;
      case "opponent-disconnected":
        set({ opponentConnected: false });
        break;
      case "opponent-reconnected":
        set({ opponentConnected: true });
        break;
      case "emote":
        set({ latestEmote: { id: ++emoteSequence, seat: msg.seat, message: msg.message } });
        break;
      case "error": {
        pendingBotRoom = null;
        joiningRoomCode = null;
        if (SOCIAL_ERROR_CODES.has(msg.code)) {
          set({ socialError: msg.code });
          break;
        }
        if (failPendingRoomEntry(msg.message)) break;
        resetRoomCommandPipeline();
        const staleVersion = msg.message === "stale room version";
        const legacyStaleVersion = msg.code === "CONFLICT" && staleVersion;
        if (msg.code === "RESYNC_REQUIRED" || legacyStaleVersion) {
          // Keep only the current room credential needed for an authoritative
          // rejoin. All room projections and version assumptions are stale.
          resetRoomVersionState();
          set({
            connected: false,
            screen: "room-loading",
            view: null,
            legal: [],
            actionCandidates: [],
            playerProfiles: null,
            lastActionAt: null,
            prep: null,
            prepDeck: null,
            spectatorCount: 0,
            opponentConnected: true,
          });
          closeCurrentSocket();
          reconnectWithBackoff();
          // Recovery is automatic. Keep both expected stale-version reloads
          // and post-commit resyncs quiet unless the reconnect grace expires.
          errors.clear();
          break;
        }
        // The authoritative room no longer exists: drop only its stored
        // membership and return to the lobby instead of retrying forever.
        if (msg.code === "ROOM_NOT_FOUND") {
          cancelReconnect();
          removeRoomSession(localStorage, get().roomCode);
          history.replaceState(null, "", "/");
          replayRuntime.discard();
          prepDeckId = null;
          prepHero = null;
          // watching a replay of the finished game — let the user keep watching
          if (get().screen === "replay") {
            preReplay = null;
            set({ roomCode: null, prep: null, prepDeck: null, opponentConnected: true });
          } else {
            set(clearedRoomProjection());
          }
        }
        errors.show(msg.message);
        break;
      }
    }
  }

  const stored = loadStoredAuth(localStorage);
  // A browser-wide legacy value can only be attributed safely while its owner
  // is still authenticated. Otherwise discard it rather than leak it to the
  // next account that signs in on this browser.
  if (!stored) localStorage.removeItem(LOBBY_SETTINGS_STORAGE_KEY);
  const lobbySettings = stored
    ? loadLobbySettings(localStorage, stored.username, { migrateLegacy: true })
    : DEFAULT_LOBBY_SETTINGS;

  const persistLobbySettings = (settings: typeof DEFAULT_LOBBY_SETTINGS) => {
    const username = get().authUser;
    if (username) saveLobbySettings(localStorage, username, settings);
  };

  const rememberPlayedDeck = (format: ConstructedFormat, deckId: string) => {
    const lastPlayedDecks = { ...get().lastPlayedDecks, [format]: deckId };
    set({ lastPlayedDecks });
    persistLobbySettings({
      version: 4,
      cardPoolModes: get().cardPoolModes,
      lastPlayedDecks,
    });
  };

  const accountActions = createAccountActions({ set, get, authRequest, isCurrentAuth });
  const replayActions = createReplayActions({
    set,
    get,
    authRequest,
    isCurrentAuth,
    openReplay,
    showError: errors.show,
  });

  return {
    ...initialStoreProjection(stored, lobbySettings),
    ...accountActions,
    ...replayActions,
    setSocialOpen: (socialOpen) => set({ socialOpen }),
    clearSocialError: () => set({ socialError: null }),
    sendFriendRequest: (username) => {
      set({ socialError: null });
      send({ type: "friend-request", username });
    },
    respondFriendRequest: (username, accept) => {
      set({ socialError: null });
      send({ type: "friend-request-respond", username, accept });
    },
    cancelFriendRequest: (username) => {
      set({ socialError: null });
      send({ type: "friend-request-cancel", username });
    },
    removeFriend: (username) => {
      set({ socialError: null });
      send({ type: "friend-remove", username });
    },
    openChat: (username) => {
      const canonical = get().friends.find((friend) =>
        friend.username.toLowerCase() === username.toLowerCase())?.username ?? username;
      const key = canonical.toLowerCase();
      const toastBelongsToConversation = get().incomingChatToast?.friendUsername.toLowerCase() === key;
      set({
        activeChat: canonical,
        socialOpen: false,
        socialError: null,
        ...(toastBelongsToConversation ? { incomingChatToast: null } : {}),
      });
      send({ type: "chat-history", username: canonical });
      const latest = get().chatMessages[key]?.at(-1);
      if (latest) send({ type: "chat-read", username: canonical, throughId: latest.id });
    },
    closeChat: () => set({ activeChat: null }),
    dismissIncomingChatToast: () => set({ incomingChatToast: null }),
    loadEarlierChat: (username) => {
      const first = get().chatMessages[username.toLowerCase()]?.[0];
      send({ type: "chat-history", username, ...(first ? { beforeId: first.id } : {}) });
    },
    sendChatMessage: (username, text) => {
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 1_000) return;
      set({ socialError: null });
      send({
        type: "chat-send",
        username,
        text: trimmed,
        clientMessageId: globalThis.crypto?.randomUUID?.()
          ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-chat`,
      });
    },
    markChatRead: (username) => {
      const latest = get().chatMessages[username.toLowerCase()]?.at(-1);
      if (latest) send({ type: "chat-read", username, throughId: latest.id });
    },
    beginFriendInvite: (username) => {
      if (get().roomCode || get().screen !== "lobby") return;
      set({ socialError: null });
      set({ friendInviteTarget: username, socialOpen: false });
    },
    cancelFriendInvite: () => set({ friendInviteTarget: null }),
    createFriendRoom: (username, format, deckId) => {
      if (get().roomCode || get().screen !== "lobby") {
        set({ friendInviteTarget: null });
        return;
      }
      rememberPlayedDeck(format, deckId);
      prepDeckId = deckId;
      prepHero = null;
      roomEntryPending = false;
      set({
        prep: null,
        prepDeck: null,
        botGame: false,
        socialError: null,
      });
      connect(() => send({
        type: "create-friend-room",
        username,
        format,
        deckId,
        ...(get().cardPoolModes[format] === "legal" ? {} : { cardPoolMode: get().cardPoolModes[format] }),
      }));
    },
    dismissFriendGameInvite: (inviteId) => {
      const timer = friendInviteTimers.get(inviteId);
      if (timer) clearTimeout(timer);
      friendInviteTimers.delete(inviteId);
      set({ friendGameInvites: get().friendGameInvites.filter((invite) => invite.inviteId !== inviteId) });
      send({ type: "friend-game-invite-dismiss", inviteId });
    },
    acceptFriendGameInvite: (inviteId) => {
      const invite = get().friendGameInvites.find((candidate) => candidate.inviteId === inviteId);
      if (!invite) return;
      get().dismissFriendGameInvite(inviteId);
      if (get().roomCode || get().screen !== "lobby") {
        window.open(`/${invite.room.code}`, "_blank", "noopener,noreferrer");
      } else {
        set({ inviteRoom: invite.room, socialOpen: false });
      }
    },
    setLobbyRail: (lobbyRail) => set({ lobbyRail }),
    setCardPoolMode: (format, mode) => {
      const cardPoolModes = { ...get().cardPoolModes, [format]: mode };
      set({ cardPoolModes });
      persistLobbySettings({
        version: 4,
        cardPoolModes,
        lastPlayedDecks: get().lastPlayedDecks,
      });
    },
    selectPrepMatchup: async (matchupId) => {
      const token = get().authToken;
      const id = prepDeckId;
      if (!token || !id || id.startsWith("precon-")) return "matchup options are not available";
      const request = authRequest(token);
      const result = await apiDeck(token, id, request.signal, matchupId ?? undefined);
      if (!isCurrentAuth(request) || prepDeckId !== id) return "deck request was superseded";
      if (!result.ok) return result.error;
      set({ prepDeck: result.deck });
      return null;
    },
    login: async (username, password) => {
      const loginRequest = advanceAuthEpoch();
      const res = await apiLogin(username, password, loginRequest.signal);
      if (loginRequest.epoch !== authEpoch) {
        return { ok: false, error: "login request was superseded" };
      }
      if (!res.ok) return res;
      // A socket authenticated as the previous account must never receive a
      // late acknowledgement after the store switches identities.
      closeCurrentSocket();
      saveStoredAuth(localStorage, { token: res.token, username: res.username });
      const accountLobbySettings = loadLobbySettings(localStorage, res.username);
      set({
        authToken: res.token,
        authUser: res.username,
        decks: [],
        decksLoading: true,
        bugReportNotifications: [],
        cardPoolModes: accountLobbySettings.cardPoolModes,
        lastPlayedDecks: accountLobbySettings.lastPlayedDecks,
      });
      // proactively open the socket so ws auth happens without needing to
      // create/join a room first
      connect(() => {});
      return res;
    },
    register: async (username, password) => {
      const result = await apiRegister(username, password);
      if (!result.ok) return result;
      // Registration is an onboarding action, not a separate account-management
      // step. Issue the first session immediately so invitees can continue from
      // account creation to their room without having to enter the same
      // credentials a second time.
      const loginResult = await get().login(username, password);
      return loginResult.ok ? { ok: true } : loginResult;
    },
    logout: async () => {
      const token = get().authToken;
      advanceAuthEpoch();
      clearAuthenticatedState();
      if (token) await apiLogout(token);
    },
    createRoom: (format, choice, visibility = "private") => {
      roomEntryPending = false;
      pendingBotRoom = null;
      if (format !== "classic-battles" && choice.deckId) {
        rememberPlayedDeck(format, choice.deckId);
      }
      // hosts land on the prep room once the room exists
      prepDeckId = format === "classic-battles" ? null : (choice.deckId ?? null);
      prepHero = format === "classic-battles" ? (choice.hero ?? null) : null;
      if (prepDeckId || prepHero) {
        set({ prep: null, prepDeck: null, botGame: false, matchmakingActive: false });
      }
      connect(() => {
        send({
          type: "create-room",
          format,
          hero: choice.hero,
          deckId: choice.deckId,
          private: visibility === "private",
          ...(format !== "classic-battles" && get().cardPoolModes[format] !== "legal"
            ? { cardPoolMode: get().cardPoolModes[format] }
            : {}),
        });
      });
    },
    createBotRoom: (format, deckId, bot, searchForPlayer = false) => {
      roomEntryPending = false;
      rememberPlayedDeck(format, deckId);
      prepDeckId = deckId;
      prepHero = null;
      const cardPoolMode = get().cardPoolModes[format];
      const choiceKey = matchmakingChoiceKey(format, { deckId }, cardPoolMode);
      activeMatchmakingChoiceKey = choiceKey;
      const username = get().authUser;
      const avoidRoomCodes = searchForPlayer && username
        ? loadRejectedMatchRoomsForChoice(localStorage, username, choiceKey)
        : [];
      set({
        prep: null,
        prepDeck: null,
        botGame: true,
        matchmakingActive: searchForPlayer,
        backgroundMatchmaking: { state: "inactive" },
        pendingBotStart: searchForPlayer,
      });
      connect(() => {
        send({
          type: "create-bot-room",
          format,
          deckId,
          ...(bot ? { bot } : {}),
          ...(searchForPlayer ? { searchForPlayer: true } : {}),
          ...(avoidRoomCodes.length > 0 ? { avoidRoomCodes } : {}),
          ...(get().cardPoolModes[format] !== "legal"
            ? { cardPoolMode: get().cardPoolModes[format] }
            : {}),
        });
      });
    },
    playBotFromPrep: (format, deckId, bot, searchForPlayer = true) => {
      if (pendingBotRoom || !get().matchmakingActive || !get().roomCode) return;
      if (searchForPlayer) {
        get().createBotRoom(format, deckId, bot, true);
      } else {
        pendingBotRoom = { format, deckId, ...(bot ? { bot } : {}), searchForPlayer: false };
        send({ type: "leave-room" });
      }
    },
    joinRoom: (code, deckId, spectate, hero) => {
      pendingBotRoom = null;
      const upperCode = code.toUpperCase();
      if (deckId) {
        const room = get().rooms.find((candidate) => candidate.code.toUpperCase() === upperCode) ??
          (get().inviteRoom?.code.toUpperCase() === upperCode ? get().inviteRoom : undefined);
        if (room && room.format !== "classic-battles") rememberPlayedDeck(room.format, deckId);
      }
      // App startup effects can run twice in development, and multiple UI
      // paths can converge while a socket is still opening. One recovery
      // request is enough; a second would hit ALREADY_IN_ROOM after the first
      // succeeds on the same socket.
      if (joiningRoomCode === upperCode) return;
      if (joiningRoomCode !== null) closeCurrentSocket();
      joiningRoomCode = upperCode;
      const session = loadRoomSession(localStorage, upperCode);
      const restoresSavedMembership = session?.code === upperCode;
      // Automatic reconnects of an already-rendered room retain their normal
      // retry behavior. Lobby/URL entry remains pending through first state.
      if (get().screen === "lobby" || get().roomCode?.toUpperCase() !== upperCode) {
        roomEntryPending = true;
        roomEntryRetryable = restoresSavedMembership;
        if (restoresSavedMembership) {
          // Give the close handler a stable room to schedule while the server
          // is restarting. Authoritative state still replaces this shell.
          set({ roomCode: upperCode, screen: "room-loading", inviteRoom: null });
        }
      }
      set({ botGame: false });
      // a deck id means a player seat in a cc/silver-age room → prep room;
      // without one (spectate or token reconnect) keep the current session
      if (deckId) {
        prepDeckId = deckId;
        set({ prep: null, prepDeck: null });
      }
      connect(() => {
        const currentSession = loadRoomSession(localStorage, upperCode);
        const token = currentSession?.code === upperCode ? currentSession.token : undefined;
        send({ type: "join-room", code, token, deckId, hero, spectate });
      });
    },
    inspectRoom: (code) => {
      roomEntryPending = true;
      connect(() => send({ type: "inspect-room", code }));
    },
    dismissInvite: (resetUrl = true) => {
      roomEntryPending = false;
      if (resetUrl) history.replaceState(null, "", "/");
      set({ inviteRoom: null });
    },
    listRooms: () =>
      connect(() => {
        send({ type: "list-rooms" });
      }),
    setConnectionActive,
    queueJoin: (format, choice) => {
      roomEntryPending = false;
      pendingBotRoom = null;
      const cardPoolMode: CardPoolMode = format === "classic-battles"
        ? "legal"
        : get().cardPoolModes[format];
      const choiceKey = matchmakingChoiceKey(format, choice, cardPoolMode);
      activeMatchmakingChoiceKey = choiceKey;
      if (format !== "classic-battles" && choice.deckId) {
        rememberPlayedDeck(format, choice.deckId);
      }
      prepDeckId = format === "classic-battles" ? null : (choice.deckId ?? null);
      prepHero = format === "classic-battles" ? (choice.hero ?? null) : null;
      if (prepDeckId || prepHero) {
        set({ prep: null, prepDeck: null, matchmakingActive: true });
      }
      connect(() => {
        if (activeMatchmakingChoiceKey !== choiceKey) return;
        const username = get().authUser;
        const avoidRoomCodes = username
          ? loadRejectedMatchRoomsForChoice(localStorage, username, choiceKey)
          : [];
        send({
          type: "queue-join",
          format,
          hero: choice.hero,
          deckId: choice.deckId,
          ...(avoidRoomCodes.length > 0 ? { avoidRoomCodes } : {}),
          ...(cardPoolMode !== "legal"
            ? { cardPoolMode }
            : {}),
        });
      });
    },
    queueLeave: () => send({ type: "queue-leave" }),
    stopBackgroundMatchmaking: () => {
      send({ type: "background-matchmaking-leave" });
      set({ backgroundMatchmaking: { state: "inactive" } });
    },
    acceptBackgroundMatch: () => {
      const status = get().backgroundMatchmaking;
      if (status.state === "offer") {
        send({ type: "background-match-accept", roomCode: status.roomCode });
      }
    },
    declineBackgroundMatch: () => {
      const status = get().backgroundMatchmaking;
      if (status.state !== "offer") return;
      const username = get().authUser;
      if (username && activeMatchmakingChoiceKey) {
        rememberRejectedMatchRoom(
          localStorage,
          username,
          status.roomCode,
          Date.now(),
          activeMatchmakingChoiceKey,
        );
      }
      send({ type: "background-match-decline", roomCode: status.roomCode });
      set({ backgroundMatchmaking: { state: "searching", format: status.format } });
    },
    presentDeck: (deck) => {
      get().clearError();
      send({ type: "present-deck", deck });
    },
    acceptMatch: () => send({ type: "accept-match" }),
    declineMatch: () => {
      const username = get().authUser;
      const code = get().roomCode;
      if (username && code) {
        const prep = get().prep;
        const currentSeat = prep?.seats[prep.yourSeat];
        const choiceKey = activeMatchmakingChoiceKey ?? (prep
          ? matchmakingChoiceKey(prep.format, {
              hero: currentSeat?.hero,
              deckId: prep.yourDeckId,
            }, prep.cardPoolMode ?? "legal")
          : "legacy");
        rememberRejectedMatchRoom(localStorage, username, code, Date.now(), choiceKey);
      }
      if (get().pendingBotStart && code) {
        send({ type: "decline-pending-bot-match", roomCode: code });
      } else {
        get().leave();
      }
    },
    prepUnready: () => send({ type: "prep-unready" }),
    chooseFirst: (first) => send({ type: "choose-first", first }),
    sendIntent: (intent) => {
      get().clearError();
      if (intent.kind === "stage-defenders") {
        return queueOrSendDefenderStage(intent.instanceIds);
      }
      const pendingInteractionIntent: OptimisticInteractionIntent | undefined =
        intent.kind === "play-card"
        || intent.kind === "play-from-arsenal"
        || intent.kind === "play-from-zone"
        || intent.kind === "activate-ability"
        || intent.kind === "choose"
        || intent.kind === "choose-many"
        || intent.kind === "order-triggers"
        || (intent.kind === "pass" && get().view?.pendingDecision?.kind === "arsenal")
          ? intent
          : undefined;
      return sendVersionedRoomCommand(
        (command) => ({ type: "intent", intent, ...command }),
        undefined,
        pendingInteractionIntent,
      );
    },
    sendPriorityMode: (mode) => {
      // Preference-only updates can be version-neutral and produce no state
      // acknowledgement, so they must not occupy the state-command gate.
      send({ type: "priority-mode", mode, ...roomCommand() });
    },
    sendRunechantSkip: (enabled) => {
      send({ type: "runechant-skip", enabled, ...roomCommand() });
    },
    sendEmote: (message: EmoteMessage) => send({ type: "emote", message }),
    kickSpectator: (username) => send({ type: "kick-spectator", username }),
    undo: (target = "last-action") => {
      get().clearError();
      sendVersionedRoomCommand((command) => ({ type: "undo", target, ...command }));
    },
    claimVictory: () => {
      get().clearError();
      sendVersionedRoomCommand((command) => ({ type: "claim-victory", ...command }));
    },
    clearError: errors.clear,
    setError: errors.show,
    leave: () => {
      // An explicit Leave click wins over an in-flight practice handoff.
      pendingBotRoom = null;
      cancelReconnect();
      roomEntryPending = false;
      roomEntryRetryable = false;
      joiningRoomCode = null;
      // pre-game rooms get an explicit leave so the server frees the seat and
      // re-queues the opponent; mid-game leaving stays a plain disconnect
      const preGame = get().screen === "prep" || get().screen === "waiting";
      const endBotGame = get().botGame && !get().spectating;
      const serverLeave = !!get().roomCode && (preGame || endBotGame);
      if (serverLeave) {
        send({ type: "leave-room", ...(endBotGame ? { endGame: true } : {}) });
      } else if (!get().roomCode && get().queuedFormat) {
        send({ type: "queue-leave" });
      }
      removeRoomSession(localStorage, get().roomCode);
      history.replaceState(null, "", "/");
      prepDeckId = null;
      prepHero = null;
      if (serverLeave) {
        // keep the socket: the lobby needs it and "left" is on its way
        set({ queuedFormat: null });
      } else {
        closeCurrentSocket();
      }
      if (preGame || endBotGame) replayRuntime.discard(get().roomCode);
      else replayRuntime.detach();
      preReplay = null;
      set(clearedRoomProjection());
    },
    watchReplay: async () => {
      const before = get();
      const code = before.roomCode;
      if (code && before.authToken && !before.spectating && before.view?.winner !== null) {
        const file = await syncCompletedReplay(code);
        const current = get();
        if (current.roomCode !== code || current.screen !== "game") return;
        if (file) {
          openReplay(file, null, get().replayNotes, { roomCode: code });
        } else {
          errors.show("Replay or notes could not be loaded. Try again.");
        }
        return;
      }
      const file = replayRuntime.getFile();
      if (file) {
        openReplay(
          file,
          null,
          get().replayNotes,
          code ? { roomCode: code } : null,
        );
      }
    },
    getRecordedViews: replayRuntime.getViews,
    downloadReplay: () => {
      const views = get().replayViews;
      const transitions = get().replayTransitions;
      const notes = get().replayNotes;
      const frames = views?.map((view, index) => ({
        view,
        transition: transitions?.[index] ?? null,
      }));
      const baseFile: ReplayFile | null =
        get().screen === "replay" && frames
          ? { version: 2, seat: get().yourSeat, frames }
          : replayRuntime.getFile();
      const file = baseFile ? withReplayNotes(baseFile, notes) : null;
      if (!file) return;
      downloadReplayFile(file);
    },
    openReplayText: (text) => {
      const r = parseReplayFile(text);
      if (!r.ok) return r.error;
      openReplay(r.file);
      return null;
    },
    setReplayStep: (step) => {
      const views = get().replayViews;
      const transitions = get().replayTransitions;
      if (!views || views.length === 0) return;
      const n = Math.max(0, Math.min(step, views.length - 1));
      const currentStep = get().replayStep;
      if (n === currentStep) return;
      const delta = n - currentStep;
      const transition: ViewTransition = delta === 1
        ? "forward"
        : delta === -1
          ? "backward"
          : "jump";
      set({
        replayStep: n,
        view: views[n]!,
        viewUpdate: nextViewUpdate({
          source: "replay",
          transition,
          replayStep: n,
          ...((delta === 1 || delta === -1) && transitions?.[Math.max(n, currentStep)]
            ? {
                gameTransition: {
                  fromVersion: Math.min(n, currentStep),
                  ...transitions[Math.max(n, currentStep)]!,
                },
              }
            : {}),
        }),
      });
    },
    setReplayNote: (frame, text) => {
      const state = get();
      const frameCount = state.replayViews?.length
        ?? (state.screen === "game" ? state.replayFrames : 0);
      if (!Number.isSafeInteger(frame) || frame < 0 || frame >= frameCount) {
        return;
      }
      const normalized = text.trim().slice(0, MAX_REPLAY_NOTE_LENGTH);
      const currentNote = state.replayNotes.find((note) => note.frame === frame);
      const notes = replaceReplayNote(
        state.replayNotes,
        frame,
        normalized,
        currentNote?.roomVersion,
      );
      replayNoteMutationEpoch += 1;
      set({ replayNotes: notes });
      const token = state.authToken;
      const target = activeReplayNoteServerTarget
        ? "replayId" in activeReplayNoteServerTarget
          ? { ...activeReplayNoteServerTarget, frame }
          : {
              ...activeReplayNoteServerTarget,
              frame,
              ...(currentNote?.roomVersion === undefined
                ? {}
                : { roomVersion: currentNote.roomVersion }),
            }
        : null;
      if (token && target) {
        void apiSaveReplayNote(token, { ...target, text: normalized }).then((result) => {
          if (!result.ok) {
            if (get().replayNotes === notes) {
              replayNoteMutationEpoch += 1;
              set({ replayNotes: state.replayNotes });
            }
            errors.show(result.error);
          }
        });
      }
    },
    setLiveReplayNote: (roomVersion, frame, text) => {
      const state = get();
      if (!state.roomCode || !state.authToken || !Number.isSafeInteger(roomVersion)) return;
      const normalized = text.trim().slice(0, MAX_REPLAY_NOTE_LENGTH);
      const replayNotes = replaceReplayNote(state.replayNotes, frame, normalized, roomVersion);
      replayNoteMutationEpoch += 1;
      set({ replayNotes });
      void apiSaveReplayNote(state.authToken, {
        roomCode: state.roomCode,
        roomVersion,
        frame,
        text: normalized,
      }).then((result) => {
        if (!result.ok) {
          if (get().replayNotes === replayNotes) {
            replayNoteMutationEpoch += 1;
            set({ replayNotes: state.replayNotes });
          }
          errors.show(result.error);
        }
      });
    },
    closeReplay: () => {
      const snap = preReplay;
      const savedReplayId = get().activeSavedReplayId;
      const replayNotes = get().replayNotes;
      preReplay = null;
      activeReplayNoteServerTarget = null;
      const base = {
        replayViews: null,
        replayTransitions: null,
        replayStep: 0,
        replayNotes: [],
        activeSavedReplayId: null,
      };
      if (savedReplayIdFromPath(location.pathname) === savedReplayId) {
        history.replaceState(null, "", "/");
      }
      // back to the live game if the room is still there, else to the lobby
      if (snap && get().roomCode) {
        set({
          ...base,
          replayNotes: replayNotes.filter((note) =>
            note.frame < replayRuntime.getViews().length),
          screen: "game",
          ...snap,
          viewUpdate: nextViewUpdate({ source: "restore", transition: "replace" }),
        });
      } else {
        set({
          ...base,
          screen: "lobby",
          view: null,
          viewUpdate: nextViewUpdate({ source: "restore", transition: "replace" }),
          legal: [],
          actionCandidates: [],
          yourSeat: null,
          spectating: false,
        });
      }
    },
  };
});

/** Switch the screen to the replay viewer for the given recording. */
function openReplay(
  file: ReplayFile,
  savedReplayId: string | null = null,
  serverNotes?: ReplayServerNote[],
  serverTarget: { replayId: string } | { roomCode: string } | null = null,
): void {
  const s = useStore.getState();
  preReplay = snapshotBeforeReplay(s);
  activeReplayNoteServerTarget = serverTarget;
  const replayNotes = (serverNotes ?? replayFileNotes(file)).slice().sort(
    (a, b) => a.frame - b.frame,
  );
  useStore.setState({
    ...replayViewerProjection(file, savedReplayId),
    replayNotes,
    viewUpdate: nextViewUpdate({
      source: "replay",
      transition: "replace",
      replayStep: 0,
    }),
  });
}

/** Reconnect helper: returns the saved session code, if any. */
export function hasSavedRoomSession(code: string): boolean {
  return loadRoomSession(localStorage, code) !== null;
}

/** Room code from the URL path (/ABC123), if present and well-formed. */
export function roomCodeFromUrl(): string | null {
  return roomCodeFromLocation(location.pathname);
}
