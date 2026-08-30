import { create } from "zustand";
import type {
  BotOpponent,
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
import { decodeServerMessage } from "@fyendal/protocol";
import {
  AUTH_STORAGE_KEY,
  DEFAULT_LOBBY_SETTINGS,
  LOBBY_SETTINGS_STORAGE_KEY,
  loadRejectedMatchRoomsForChoice,
  loadLobbySettings,
  pruneRejectedMatchRooms,
  rememberRejectedMatchRoom,
  ROOM_SESSION_STORAGE_KEY,
  saveLobbySettings,
} from "./storage.js";
import {
  loadRoomSession,
  loadStoredAuth,
  saveRoomSession,
  saveStoredAuth,
} from "./store/sessionStorage.js";
import type {
  CardPlayIntent,
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
  apiRegister,
  apiRoomReplay,
} from "./auth/auth.js";
import { createAccountActions } from "./store/accountActions.js";
import { createReplayActions } from "./store/replayActions.js";
import { replayViewerProjection, snapshotBeforeReplay } from "./store/replayView.js";
import { createErrorController } from "./store/errorController.js";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let emoteSequence = 0;
let viewUpdateSequence = 0;
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
  orphaned?.close();
});

/** deck chosen for the current cc/silver-age prep session (queue or hosted room) */
let prepDeckId: string | null = null;
/** hero picked for the current classic-battles prep session (queue or hosted room) */
let prepHero: HeroId | null = null;

/** store snapshot taken when a replay opens from the game screen; restored on close */
let preReplay: PreReplaySnapshot | null = null;

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
  /** A bot-room request waiting for the retained matchmaking room to release
   *  this socket. WebSocket commands stay ordered by waiting for `left`. */
  let pendingBotRoom: { format: ConstructedFormat; deckId: string; bot?: BotOpponent } | null = null;
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
    if (get().pendingCardPlay !== null) set({ pendingCardPlay: null });
  }

  function resetRoomVersionState(): void {
    roomVersions.reset();
    resetRoomCommandPipeline();
  }

  function closeCurrentSocket(): void {
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
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
    localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
    closeCurrentSocket();
    history.replaceState(null, "", "/");
    replayRuntime.discard();
    prepDeckId = null;
    prepHero = null;
    preReplay = null;
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
    localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
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
    set({
      ...clearedRoomProjection(),
      connected: false,
      authToken: null,
      authUser: null,
      decks: [],
      decksLoading: false,
      savedReplays: [],
      replaysLoading: false,
      queueCounts: { "classic-battles": 0, cc: 0, "silver-age": 0 },
      lobbyRail: "home",
      allowFutureCards: { ...DEFAULT_LOBBY_SETTINGS.allowFutureCards },
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
      reconnectAttempts = 0;
      set({ connected: true });
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
      if (roomEntryPending && roomEntryRetryable) {
        scheduleReconnect();
        return;
      }
      if (failPendingRoomEntry("connection to room failed")) return;
      scheduleReconnect();
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
    const code = get().roomCode;
    if (!code) return; // in the lobby — nothing to rejoin
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 10_000) + Math.random() * 500;
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      get().joinRoom(code);
    }, delay);
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

  /** Board clicks are based on the last rendered (authoritative) set. Apply
   *  that click's add/remove delta to the desired set so rapid A-then-B clicks
   *  coalesce to [A, B], even before A's state projection arrives. */
  function mergedDefenderStageIds(requestedIds: readonly number[]): number[] {
    const authoritative = new Set(authoritativeStagedDefenderIds());
    const requested = new Set(requestedIds);
    const desired = new Set(
      queuedDefenderStageIds
      ?? inFlightRoomCommand?.defenderStageIds
      ?? authoritative,
    );
    for (const id of authoritative) {
      if (!requested.has(id)) desired.delete(id);
    }
    for (const id of requested) {
      if (!authoritative.has(id)) desired.add(id);
    }
    return [...desired];
  }

  function sendVersionedRoomCommand(
    createMessage: (command: { commandId: string; expectedVersion: number }) => ClientMessage,
    defenderStageIds?: number[],
    pendingCardPlay?: CardPlayIntent,
  ): boolean {
    if (inFlightRoomCommand) return false;
    const command = roomCommand();
    if (!send(createMessage(command))) return false;
    inFlightRoomCommand = defenderStageIds === undefined
      ? { expectedVersion: command.expectedVersion }
      : { expectedVersion: command.expectedVersion, defenderStageIds };
    if (pendingCardPlay) {
      set({ pendingCardPlay: { ...command, intent: pendingCardPlay } });
    }
    return true;
  }

  function queueOrSendDefenderStage(requestedIds: readonly number[]): boolean {
    const desiredIds = mergedDefenderStageIds(requestedIds);
    if (inFlightRoomCommand) {
      queuedDefenderStageIds = inFlightRoomCommand.defenderStageIds
        && sameInstanceIds(desiredIds, inFlightRoomCommand.defenderStageIds)
        ? null
        : desiredIds;
      return true;
    }
    queuedDefenderStageIds = null;
    return sendVersionedRoomCommand(
      (command) => ({
        type: "intent",
        intent: { kind: "stage-defenders", instanceIds: desiredIds },
        ...command,
      }),
      desiredIds,
    );
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
    localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
    history.replaceState(null, "", "/");
    replayRuntime.discard(get().roomCode);
    resetRoomVersionState();
    set(clearedRoomProjection());
    get().createBotRoom(pending.format, pending.deckId, pending.bot);
  }

  function syncCompletedReplay(code: string): Promise<ReplayFile | null> {
    if (completedReplaySync?.code === code) return completedReplaySync.promise;
    const token = get().authToken;
    if (!token) return Promise.resolve(null);
    const request = authRequest(token);
    const promise = (async () => {
      const result = await apiRoomReplay(token, code, request.signal);
      if (!isCurrentAuth(request) || get().roomCode !== code || !result.ok) return null;
      const frames = replayRuntime.replace(code, result.replay);
      set({ replayFrames: frames });
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
          inviteRoom: null,
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
          inviteRoom: null,
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
        });
        break;
      case "state": {
        roomEntryPending = false;
        roomEntryRetryable = false;
        joiningRoomCode = null;
        // keep recording frames even while watching a replay of this room
        const code = get().roomCode;
        const frames = code
          ? replayRuntime.recordFrame(code, msg.view, msg.yourSeat)
          : get().replayFrames;
        const commandState = acceptRoomCommandState(msg.version, msg);
        if (get().screen === "replay") {
          if (commandState.acknowledged) set({ pendingCardPlay: null });
          break; // replay viewer owns the screen
        }
        const current = get();
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
          }),
          legal: msg.legal,
          actionCandidates: msg.actionCandidates ?? msg.legal,
          pendingCardPlay: commandState.acknowledged ? null : get().pendingCardPlay,
          playerProfiles: msg.playerProfiles,
          yourSeat: msg.yourSeat,
          spectatorCount: msg.spectators ?? 0,
          botGame: msg.botGame === true,
          lastActionAt: msg.lastActionAt,
          screen: "game",
          replayFrames: frames,
        });
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
      case "match-timeout":
        localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
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
          });
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
          if (ws) ws.close();
          else scheduleReconnect();
          if (staleVersion) errors.clear();
          else errors.show(msg.message);
          break;
        }
        // The authoritative room no longer exists: drop only its stored
        // membership and return to the lobby instead of retrying forever.
        if (msg.code === "ROOM_NOT_FOUND") {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = null;
          localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
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
      version: 3,
      allowFutureCards: get().allowFutureCards,
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
    setLobbyRail: (lobbyRail) => set({ lobbyRail }),
    setAllowFutureCards: (format, allow) => {
      const allowFutureCards = { ...get().allowFutureCards, [format]: allow };
      set({ allowFutureCards });
      persistLobbySettings({
        version: 3,
        allowFutureCards,
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
        allowFutureCards: accountLobbySettings.allowFutureCards,
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
          ...(format !== "classic-battles" && get().allowFutureCards[format]
            ? { allowFutureCards: true }
            : {}),
        });
      });
    },
    createBotRoom: (format, deckId, bot) => {
      roomEntryPending = false;
      rememberPlayedDeck(format, deckId);
      prepDeckId = deckId;
      prepHero = null;
      set({ prep: null, prepDeck: null, botGame: true, matchmakingActive: false });
      connect(() => {
        send({
          type: "create-bot-room",
          format,
          deckId,
          ...(bot ? { bot } : {}),
          ...(get().allowFutureCards[format] ? { allowFutureCards: true } : {}),
        });
      });
    },
    playBotFromPrep: (format, deckId, bot) => {
      if (pendingBotRoom || !get().matchmakingActive) return;
      pendingBotRoom = { format, deckId, ...(bot ? { bot } : {}) };
      if (get().roomCode) {
        send({ type: "leave-room" });
      } else if (get().queuedFormat) {
        send({ type: "queue-leave" });
      } else {
        pendingBotRoom = null;
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
      const session = loadRoomSession(localStorage);
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
        const currentSession = loadRoomSession(localStorage);
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
    queueJoin: (format, choice) => {
      roomEntryPending = false;
      pendingBotRoom = null;
      const choiceKey = matchmakingChoiceKey(format, choice);
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
          ...(format !== "classic-battles" && get().allowFutureCards[format]
            ? { allowFutureCards: true }
            : {}),
        });
      });
    },
    queueLeave: () => send({ type: "queue-leave" }),
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
            })
          : "legacy");
        rememberRejectedMatchRoom(localStorage, username, code, Date.now(), choiceKey);
      }
      get().leave();
    },
    prepUnready: () => send({ type: "prep-unready" }),
    chooseFirst: (first) => send({ type: "choose-first", first }),
    sendIntent: (intent) => {
      get().clearError();
      if (intent.kind === "stage-defenders") {
        return queueOrSendDefenderStage(intent.instanceIds);
      }
      const pendingCardPlay =
        intent.kind === "play-card"
        || intent.kind === "play-from-arsenal"
        || intent.kind === "play-from-zone"
          ? intent
          : undefined;
      return sendVersionedRoomCommand(
        (command) => ({ type: "intent", intent, ...command }),
        undefined,
        pendingCardPlay,
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      reconnectAttempts = 0;
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
      localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
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
          openReplay(file);
        } else {
          errors.show("Replay finalization did not complete. Try again.");
        }
        return;
      }
      const file = replayRuntime.getFile();
      if (file) openReplay(file);
    },
    getRecordedViews: replayRuntime.getViews,
    downloadReplay: () => {
      const views = get().replayViews;
      const file: ReplayFile | null =
        get().screen === "replay" && views
          ? { version: 1, seat: get().yourSeat, views }
          : replayRuntime.getFile();
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
        viewUpdate: nextViewUpdate({ source: "replay", transition, replayStep: n }),
      });
    },
    closeReplay: () => {
      const snap = preReplay;
      const savedReplayId = get().activeSavedReplayId;
      preReplay = null;
      const base = { replayViews: null, replayStep: 0, activeSavedReplayId: null };
      if (savedReplayIdFromPath(location.pathname) === savedReplayId) {
        history.replaceState(null, "", "/");
      }
      // back to the live game if the room is still there, else to the lobby
      if (snap && get().roomCode) {
        set({
          ...base,
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
function openReplay(file: ReplayFile, savedReplayId: string | null = null): void {
  const s = useStore.getState();
  preReplay = snapshotBeforeReplay(s);
  useStore.setState({
    ...replayViewerProjection(file, savedReplayId),
    viewUpdate: nextViewUpdate({
      source: "replay",
      transition: "replace",
      replayStep: 0,
    }),
  });
}

/** Reconnect helper: returns the saved session code, if any. */
export function savedRoomCode(): string | null {
  return loadRoomSession(localStorage)?.code ?? null;
}

/** Room code from the URL path (/ABC123), if present and well-formed. */
export function roomCodeFromUrl(): string | null {
  return roomCodeFromLocation(location.pathname);
}
