import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, Format, HeroId, ServerMessage } from "@fyendal/shared";
import { cardData, formatLegalityIssues } from "@fyendal/cards";
import { botDefinition } from "@fyendal/bot";
import { deleteExpiredSessions, hashSessionToken, sessionForToken, type AuthUser } from "./auth.js";
import type { Queryable } from "./db.js";
import { resolveFreshDeck } from "./decks.js";
import { createApiServer } from "./http.js";
import { createFabraryClient, type FabraryClient } from "./fabrary.js";
import { clientIp, configuredTrustedProxyHops } from "./network.js";
import { decodeClientMessage } from "@fyendal/protocol";
import { encodeWireMessage, type WireServerMessage } from "./errors.js";
import { RoomBroadcaster } from "./roomBroadcaster.js";
import { ConnectionRegistry, type ClientCtx } from "./gateway/connectionSession.js";
import { composeProductionGateway } from "./gateway/composition.js";
import { BotRunner } from "./botRunner.js";
import { WorkerBotPolicyExecutor, type BotPolicyExecutor } from "./botPolicyExecutor.js";
import { ReplayFinalizer, sweepReplays } from "./replays.js";
import { appendClusterEvent, ClusterEventConsumer, sweepClusterEvents, type ClusterEvent } from "./clusterEvents.js";
import { tryAcquireLease } from "./leases.js";
import { consoleError } from "./logging.js";
import { PgRateLimiter, sweepRateLimits } from "./rateLimits.js";
import {
  PgRoomStore,
  hashReconnectToken,
  PLAY_REQUIRES_LOGIN,
  PRESENCE_HEARTBEAT_MS,
  prepViewFor,
  sweepRoomCommands,
  stateMessage,
  type RoomRow,
  type SeatCredentials,
} from "./store.js";

/** Cap on incoming ws frames — clients send small intents; large game states
 *  only flow server→client. ws terminates sockets that exceed it. */
const WS_MAX_PAYLOAD = 64 * 1024;
const WS_MAX_BUFFERED_BYTES = 1024 * 1024;
const WS_MAX_PENDING_MESSAGES = 32;
const WS_MESSAGE_RATE_MAX = 120;
const WS_MESSAGE_RATE_WINDOW_MS = 10_000;
const WS_PING_INTERVAL_MS = 30_000;
const EMOTE_COOLDOWN_MS = 1_000;
const SESSION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const ALREADY_IN_ROOM = "leave your current room before joining another";

interface ServerDeps {
  db: Queryable;
  rooms: PgRoomStore;
  /** Number of rightmost proxy hops trusted to have appended XFF. Default 0. */
  trustedProxyHops?: number;
  /** Explicit browser origin for upgrade checks; production defaults to APP_ORIGIN. */
  allowedOrigin?: string;
  wsMaxPendingMessages?: number;
  wsMessageRateMax?: number;
  wsMessageRateWindowMs?: number;
  wsPingIntervalMs?: number;
  /** Test/UI pacing override; production defaults to a short visible pause. */
  botDelayMs?: number;
  /** Test seam; production creates one worker-backed executor per gateway. */
  botPolicyExecutor?: BotPolicyExecutor;
  /** Injectable upstream used by both HTTP deck detail and game entry. */
  fabraryClient?: FabraryClient;
  /** Unique Cloud Run container identity; generated per gateway when omitted. */
  instanceId?: string;
}

/** http server → its WebSocketServer, so shutdown can reach ws clients. */
const wssByServer = new WeakMap<http.Server, WebSocketServer>();
const replayFinalizerByServer = new WeakMap<http.Server, ReplayFinalizer>();
const clusterPublisherByServer = new WeakMap<http.Server, (event: Parameters<RoomBroadcaster<ClientCtx>["afterCommit"]>[0]) => Promise<void>>();

export function createGameServer(port: number, deps: ServerDeps): http.Server {
  const rooms = deps.rooms;
  const fabraryClient = deps.fabraryClient ?? createFabraryClient();
  const trustedProxyHops = deps.trustedProxyHops ?? configuredTrustedProxyHops();
  const configuredOrigin = deps.allowedOrigin ?? process.env.APP_ORIGIN;
  if (process.env.NODE_ENV === "production" && !configuredOrigin) {
    throw new Error("APP_ORIGIN is required in production");
  }
  const originUrl = configuredOrigin ? new URL(configuredOrigin) : null;
  if (originUrl && originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    throw new Error("APP_ORIGIN must use http or https");
  }
  const allowedOrigin = originUrl?.origin ?? null;
  const maxPendingMessages = deps.wsMaxPendingMessages ?? WS_MAX_PENDING_MESSAGES;
  const messageRateMax = deps.wsMessageRateMax ?? WS_MESSAGE_RATE_MAX;
  const messageRateWindowMs = deps.wsMessageRateWindowMs ?? WS_MESSAGE_RATE_WINDOW_MS;
  const pingIntervalMs = deps.wsPingIntervalMs ?? WS_PING_INTERVAL_MS;
  const instanceId = deps.instanceId ?? `gateway-${randomUUID()}`;
  let clusterConsumer: ClusterEventConsumer | null = null;

  async function publishClusterEvent(event: ClusterEvent): Promise<void> {
    await appendClusterEvent(deps.db, event);
    clusterConsumer?.nudge();
  }

  async function publishRoomEvent(event: Parameters<RoomBroadcaster<ClientCtx>["afterCommit"]>[0]): Promise<void> {
    await publishClusterEvent({ type: "room", event });
  }

  /** Socket delivery bindings are local; queue membership and pairing are
   * durable in Postgres and addressed back to users through cluster events. */
  const queuedUsers = new Map<number, ClientCtx>();
  const connections = new ConnectionRegistry();
  const clientsByRoom = connections.byRoom;
  const allClients = connections.all;
  const lobbyClients = connections.lobby;
  let statsCache: { value: { inGame: number; openRooms: number }; expiresAt: number } | null = null;
  const server = createApiServer({
    db: deps.db,
    fabraryClient,
    appOrigin: allowedOrigin,
    trustedProxyHops,
    rateLimiter: new PgRateLimiter(deps.db, "http-ip", 10, 10 * 60 * 1000),
    accountRateLimiter: new PgRateLimiter(deps.db, "login-account", 10, 10 * 60 * 1000),
    statsRateLimiter: new PgRateLimiter(
      deps.db,
      "stats-ip",
      Number(process.env.STATS_RATE_MAX ?? 60),
      Number(process.env.STATS_RATE_WINDOW_MS ?? 10 * 60 * 1000),
    ),
    stats: async () => {
      const now = Date.now();
      if (statsCache && statsCache.expiresAt > now) return statsCache.value;
      const value = await rooms.stats();
      statsCache = { value, expiresAt: now + 5_000 };
      return value;
    },
    // Auth/account services append their revocation and deletion events in the
    // same transaction. These callbacks only reduce remote delivery latency.
    onSessionRevoked: () => clusterConsumer?.nudge(),
    onUserSessionsRevoked: () => clusterConsumer?.nudge(),
    onRoomsDeleted: () => clusterConsumer?.nudge(),
  });
  const wss = new WebSocketServer({
    server,
    maxPayload: WS_MAX_PAYLOAD,
    verifyClient: allowedOrigin
      ? ({ origin }: { origin: string }) => origin === allowedOrigin
      : undefined,
  });
  wssByServer.set(server, wss);
  const socketAlive = new WeakMap<WebSocket, boolean>();
  const socketContexts = new WeakMap<WebSocket, ClientCtx>();
  const pingTimer = pingIntervalMs > 0
    ? setInterval(() => {
        for (const socket of wss.clients) {
          if (socket.readyState !== WebSocket.OPEN) continue;
          if (socketAlive.get(socket) === false) {
            const context = socketContexts.get(socket);
            if (context) context.closed = true;
            socket.terminate();
            continue;
          }
          socketAlive.set(socket, false);
          socket.ping();
        }
      }, pingIntervalMs)
    : null;
  server.on("close", () => {
    if (pingTimer) clearInterval(pingTimer);
  });

  async function broadcastQueueStatus(): Promise<void> {
    if (![...allClients].some((client) => client.code === null)) return;
    const msg: ServerMessage = { type: "queue-status", counts: await rooms.matchmakingCounts() };
    for (const c of [...allClients]) {
      if (c.code === null) c.send(msg);
    }
  }

  let lobbyBroadcastInFlight: Promise<void> | null = null;
  async function broadcastLobby(): Promise<void> {
    if (lobbyClients.size === 0) return;
    if (lobbyBroadcastInFlight) return lobbyBroadcastInFlight;
    lobbyBroadcastInFlight = (async () => {
      const snapshot = await deps.rooms.lobbySnapshot();
      const payloads = new Map<number | undefined, string>();
      // One DB snapshot, then personalize/canonicalize once per account in
      // memory. Multiple tabs for one account reuse the encoded payload.
      for (const c of [...lobbyClients]) {
        const userId = c.user?.id;
        let payload = payloads.get(userId);
        if (!payload) {
          payload = JSON.stringify({
            type: "rooms",
            rooms: deps.rooms.personalizeLobby(snapshot, userId),
          } satisfies ServerMessage);
          payloads.set(userId, payload);
        }
        c.sendRaw(payload);
      }
    })().finally(() => { lobbyBroadcastInFlight = null; });
    return lobbyBroadcastInFlight;
  }

  const broadcaster = new RoomBroadcaster<ClientCtx>({
    rooms,
    clientsFor: (code) => clientsByRoom.get(code) ?? [],
    authorize: authorizedProjectionSeat,
    detach: (client) => connections.detach(client),
    broadcastLobby,
    logError: consoleError,
  });
  clusterConsumer = new ClusterEventConsumer(deps.db, async (event) => {
    switch (event.type) {
      case "room":
        await broadcaster.afterCommit(event.event);
        if (event.event.kind === "sync" || event.event.kind === "state" || event.event.kind === "game-started") {
          botRunner.schedule(event.event.code);
        }
        return;
      case "queue-changed":
        await broadcastQueueStatus();
        return;
      case "queue-waiting": {
        const existing = queuedUsers.get(event.userId);
        const ctx = existing ?? [...allClients].find((client) => client.user?.id === event.userId && !client.closed);
        if (ctx) {
          queuedUsers.set(event.userId, ctx);
          ctx.send({ type: "queued", format: event.format });
        }
        return;
      }
      case "session-revoked":
        for (const ctx of [...allClients]) {
          if (!ctx.sessionToken || hashSessionToken(ctx.sessionToken) !== event.tokenHash) continue;
          ctx.user = null;
          connections.unbindSession(ctx);
          ctx.close(1008, "session revoked");
        }
        return;
      case "user-sessions-revoked":
        for (const ctx of [...allClients]) {
          if (ctx.user?.id !== event.userId) continue;
          ctx.user = null;
          connections.unbindSession(ctx);
          ctx.close(1008, "sessions revoked");
        }
        return;
      case "match-ready":
        await deliverMatch(event.userId, event.code, event.created);
        return;
      case "match-timeout":
        for (const ctx of [...allClients]) {
          if (ctx.user?.id !== event.userId || ctx.code !== event.code) continue;
          connections.detach(ctx);
          ctx.send({ type: "match-timeout" });
        }
        return;
      case "emote": {
        const room = await rooms.getRoom(event.code);
        if (!room?.state) return;
        const message: ServerMessage = { type: "emote", seat: event.seat, message: event.message };
        for (const client of [...(clientsByRoom.get(event.code) ?? [])]) {
          if (client.code === event.code && authorizedProjectionSeat(room, client) !== undefined) client.send(message);
        }
        return;
      }
    }
  }, { logError: consoleError });
  clusterPublisherByServer.set(server, publishRoomEvent);
  const replayFinalizer = new ReplayFinalizer(
    deps.db,
    consoleError,
    instanceId,
  );
  replayFinalizerByServer.set(server, replayFinalizer);
  void replayFinalizer.recoverPending().catch((error) =>
    consoleError("pending replay recovery failed", error),
  );
  const afterStateCommit = async (
    code: string,
    version: number,
    replayFinalizationId?: string,
  ): Promise<void> => {
    if (replayFinalizationId) replayFinalizer.enqueue(replayFinalizationId);
    await publishRoomEvent({ code, kind: "state", version });
  };
  const botRunner = new BotRunner({
    rooms,
    delayMs: deps.botDelayMs,
    afterCommit: afterStateCommit,
    logError: consoleError,
    claim: (code) => tryAcquireLease(deps.db, `bot:${code}`, instanceId, 30_000),
    policyExecutor: deps.botPolicyExecutor ?? new WorkerBotPolicyExecutor(),
  });
  server.on("close", () => {
    botRunner.stop();
    replayFinalizer.stop();
    clusterConsumer?.stop();
  });

  async function markAttachedPresent(ctx: ClientCtx): Promise<number> {
    if (!ctx.code || !ctx.token || !ctx.presenceLeaseId) throw new Error("socket is not attached");
    const presence = await rooms.markPresent(ctx.code, ctx.token, ctx.presenceLeaseId, ctx.seat);
    if (!presence) throw new Error("room membership disappeared during attach");
    return presence.version;
  }

  async function deliverMatch(
    userId: number,
    code: string,
    created: boolean,
    keepQueued = false,
    queuedFormat?: Format,
  ): Promise<void> {
    const ctx = queuedUsers.get(userId);
    if (!ctx || ctx.closed || ctx.user?.id !== userId) return;
    if (ctx.code !== null && ctx.code !== code) return;
    if (!keepQueued) queuedUsers.delete(userId);

    if (ctx.code === code && ctx.seat !== null) {
      const room = await rooms.getRoom(code);
      if (room && !room.state) {
        ctx.send({ type: "prep-state", prep: prepViewFor(room, ctx.seat), version: room.version });
      }
      return;
    }

    const joined = await rooms.joinRoom(code, undefined, {
      allowPlayer: true,
      username: ctx.user.username,
      userId,
      fromQueue: true,
    });
    if (!joined.ok || joined.kind !== "player") {
      queuedUsers.delete(userId);
      ctx.send({ type: "queue-left" });
      ctx.send({ type: "error", message: joined.ok ? "matchmaking failed" : joined.error });
      return;
    }
    connections.attach(ctx, code, joined.seat, joined.token);
    const version = await markAttachedPresent(ctx);
    // Do not announce a durable queue opener until its socket presence is
    // committed. Another gateway may pair as soon as the client sees this
    // message and starts waiting for an opponent.
    if (queuedFormat) ctx.send({ type: "queued", format: queuedFormat });
    ctx.send(created
      ? { type: "room-created", code, seat: joined.seat, token: joined.token, version }
      : { type: "joined", code, seat: joined.seat, token: joined.token, version });
    const room = await rooms.getRoom(code);
    if (room && !room.state) {
      ctx.send({ type: "prep-state", prep: prepViewFor(room, joined.seat), version: room.version });
    }
    await publishRoomEvent({ code, kind: "joined", version });
  }

  /** Return the seat this socket is currently authorized to view. Undefined
   * means a formerly privileged socket has been superseded and was detached. */
  function authorizedProjectionSeat(room: RoomRow, ctx: ClientCtx): number | null | undefined {
    if (ctx.seat === null) return null;
    if (!ctx.token) return undefined;
    const seat = room.seats[ctx.seat];
    const accountMatches = seat?.userId == null || seat.userId === ctx.user?.id;
    if (!seat || seat.tokenHash !== hashReconnectToken(ctx.token) || !accountMatches) {
      ctx.send({ type: "error", message: "room session replaced" });
      connections.detach(ctx);
      return undefined;
    }
    return ctx.seat;
  }

  function seatCredentials(ctx: ClientCtx): SeatCredentials | null {
    if (!ctx.token) return null;
    return { token: ctx.token, userId: ctx.user?.id };
  }

  /** Validate a format choice before it can enter a room or matchmaking. */
  async function resolveChoice(
    user: AuthUser,
    format: Format,
    hero: HeroId | undefined,
    deckId: string | undefined,
    allowFutureCards = false,
  ): Promise<{
    choice: { hero?: HeroId; deckId?: string; deckName?: string };
    requiresFutureCards: boolean;
  } | { error: string }> {
    if (format === "classic-battles") {
      if (hero !== "dorinthea" && hero !== "rhinar") return { error: "pick a hero" };
      return { choice: { hero }, requiresFutureCards: false };
    }
    if (!deckId) return { error: `choose a ${format} deck` };
    const refreshed = await resolveFreshDeck(deps.db, user.id, deckId, fabraryClient);
    if (!refreshed.ok) return { error: refreshed.error };
    const deck = refreshed.deck;
    if (deck.format !== format) return { error: `that is a ${deck.format} deck, not ${format}` };
    const legality = formatLegalityIssues(cardData, deck.decklist, format);
    const blockingIssues = allowFutureCards
      ? legality.filter((issue) => issue.kind !== "future-card")
      : legality;
    if (blockingIssues.length > 0) {
      return { error: blockingIssues.map((issue) => issue.message).join("; ") };
    }
    return {
      choice: { deckId: deck.id, deckName: deck.name },
      requiresFutureCards: legality.some((issue) => issue.kind === "future-card"),
    };
  }

  async function handleMessage(ws: WebSocket, ctx: ClientCtx, msg: ClientMessage): Promise<void> {
    if (ctx.closed) return;
    switch (msg.type) {
      case "auth": {
        // A failed re-authentication must not retain privileges from an older
        // session presented on the same socket.
        ctx.user = null;
        connections.unbindSession(ctx);
        const user = await sessionForToken(deps.db, msg.token);
        if (!user) {
          send(ws, { type: "auth-failed" });
          return;
        }
        ctx.user = user;
        connections.bindSession(ctx, msg.token);
        send(ws, { type: "authed", username: user.username });
        return;
      }
      case "create-room": {
        if (ctx.code !== null) {
          send(ws, { type: "error", message: ALREADY_IN_ROOM });
          return;
        }
        if (!ctx.user) {
          send(ws, { type: "error", message: PLAY_REQUIRES_LOGIN });
          return;
        }
        const choice = await resolveChoice(
          ctx.user,
          msg.format,
          msg.hero,
          msg.deckId,
          msg.allowFutureCards === true,
        );
        if ("error" in choice) {
          send(ws, { type: "error", message: choice.error });
          return;
        }
        const { code, seat, token } = await rooms.createRoom(msg.format, {
          ...choice.choice,
          username: ctx.user.username,
          userId: ctx.user.id,
        }, msg.private ? "private" : "public", msg.allowFutureCards === true);
        connections.attach(ctx, code, seat, token);
        const version = await markAttachedPresent(ctx);
        send(ws, { type: "room-created", code, seat, token, version });
        await publishRoomEvent({ code, kind: "created", version });
        return;
      }
      case "create-bot-room": {
        if (ctx.code !== null) {
          send(ws, { type: "error", message: ALREADY_IN_ROOM });
          return;
        }
        if (!ctx.user) {
          send(ws, { type: "error", message: PLAY_REQUIRES_LOGIN });
          return;
        }
        // Legacy clients omitted format when Briar was the only bot.
        const botFormat = msg.format ?? "silver-age";
        const botOpponent = msg.bot ?? (botFormat === "cc" ? "hala" : "briar");
        const definition = botDefinition(botOpponent);
        if (!definition || definition.format !== botFormat) {
          send(ws, { type: "error", message: `choose a ${botFormat} bot` });
          return;
        }
        const choice = await resolveChoice(
          ctx.user,
          botFormat,
          undefined,
          msg.deckId,
          msg.allowFutureCards === true,
        );
        if ("error" in choice || !choice.choice.deckId) {
          send(ws, { type: "error", message: "error" in choice ? choice.error : `choose a ${botFormat} deck` });
          return;
        }
        const { code, seat, token } = await rooms.createBotRoom(botFormat, {
          deckId: choice.choice.deckId,
          deckName: choice.choice.deckName,
          username: ctx.user.username,
          userId: ctx.user.id,
        }, msg.allowFutureCards === true, botOpponent);
        connections.attach(ctx, code, seat, token);
        const version = await markAttachedPresent(ctx);
        send(ws, { type: "room-created", code, seat, token, version });
        await publishRoomEvent({ code, kind: "created", version });
        await publishRoomEvent({ code, kind: "prep", version });
        return;
      }
      case "join-room": {
        if (ctx.code !== null) {
          send(ws, { type: "error", message: ALREADY_IN_ROOM });
          return;
        }
        // player seats (new or seat-token reconnect) require an account;
        // spectator joins stay anonymous
        let deckName: string | undefined;
        if (msg.deckId) {
          if (!ctx.user) {
            send(ws, { type: "error", message: PLAY_REQUIRES_LOGIN });
            return;
          }
          const refreshed = await resolveFreshDeck(deps.db, ctx.user.id, msg.deckId, fabraryClient);
          if (!refreshed.ok) {
            send(ws, { type: "error", message: refreshed.error });
            return;
          }
          deckName = refreshed.deck.name;
        }
        const r = await rooms.joinRoom(msg.code, msg.token, {
          allowPlayer: !!ctx.user,
          hero: msg.hero,
          deckId: msg.deckId,
          deckName,
          username: ctx.user?.username,
          userId: ctx.user?.id,
          spectate: msg.spectate,
        });
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        const code = msg.code.toUpperCase();
        connections.attach(ctx, code, r.seat, r.token);
        const version = await markAttachedPresent(ctx);
        if (r.kind === "spectator") {
          send(ws, { type: "joined", code, seat: null, token: r.token, spectator: true, version });
          const room = await rooms.getRoom(code);
          const state = room ? stateMessage(room, null) : null;
          if (state) send(ws, state);
          await publishRoomEvent({ code, kind: "spectators", version });
          return;
        }
        send(ws, {
          type: "joined",
          code,
          seat: r.seat,
          token: r.token,
          version,
          ...(r.reconnected ? { resumed: true as const } : {}),
        });
        if (r.reconnected) {
          const room = await rooms.getRoom(code);
          const state = room ? stateMessage(room, r.seat) : null;
          if (state) send(ws, state);
          // reconnecting into a prep room restores the prep screen
          if (room && !room.state && r.seat !== null) {
            send(ws, { type: "prep-state", prep: prepViewFor(room, r.seat), version: room.version });
          }
          await publishRoomEvent({ code, kind: "presence", seat: r.seat, connected: true, version });
          return;
        }
        if (r.started) {
          await publishRoomEvent({ code, kind: "game-started", version });
        } else {
          // a fresh seat fill (re)rolls the prep die
          const room = await rooms.getRoom(code);
          if (room && !room.state) {
            await publishRoomEvent({ code, kind: "prep", version });
          }
        }
        await publishRoomEvent({ code, kind: "joined", version });
        return;
      }
      case "inspect-room": {
        if (ctx.code !== null) {
          send(ws, { type: "error", message: ALREADY_IN_ROOM });
          return;
        }
        const room = await rooms.roomInvite(msg.code, ctx.user?.id);
        if (!room) {
          send(ws, { type: "error", message: "room not found" });
          return;
        }
        send(ws, { type: "room-info", room });
        return;
      }
      case "list-rooms": {
        lobbyClients.add(ctx);
        send(ws, { type: "rooms", rooms: await rooms.listRooms(ctx.user?.id) });
        return;
      }
      case "queue-join": {
        if (ctx.code !== null) {
          send(ws, { type: "error", message: ALREADY_IN_ROOM });
          return;
        }
        if (!ctx.user) {
          send(ws, { type: "error", message: PLAY_REQUIRES_LOGIN });
          return;
        }
        const choice = await resolveChoice(
          ctx.user,
          msg.format,
          msg.hero,
          msg.deckId,
          msg.allowFutureCards === true,
        );
        if ("error" in choice) {
          send(ws, { type: "error", message: choice.error });
          return;
        }
        const previous = queuedUsers.get(ctx.user.id);
        if (previous && previous !== ctx) previous.send({ type: "queue-left" });
        queuedUsers.set(ctx.user.id, ctx);
        const result = await rooms.queueForMatch(msg.format, {
          userId: ctx.user.id,
          username: ctx.user.username,
          ...choice.choice,
          allowFutureCards: choice.requiresFutureCards,
          avoidRoomCodes: msg.avoidRoomCodes,
        });
        if (!result.ok) {
          if (queuedUsers.get(ctx.user.id) === ctx) queuedUsers.delete(ctx.user.id);
          send(ws, { type: "error", message: result.error });
          return;
        }
        if (result.kind === "opened") {
          await deliverMatch(ctx.user.id, result.code, true, true, msg.format);
        }
        clusterConsumer?.nudge();
        return;
      }
      case "queue-leave": {
        if (ctx.user && queuedUsers.get(ctx.user.id) === ctx && await rooms.leaveMatchmaking(ctx.user.id)) {
          queuedUsers.delete(ctx.user.id);
          send(ws, { type: "queue-left" });
          clusterConsumer?.nudge();
        }
        return;
      }
      case "present-deck": {
        const player = requirePlayer(ws, ctx);
        if (!player) return;
        const room = await rooms.getRoom(player.code);
        const seat = ctx.seat === null ? null : room?.seats[ctx.seat];
        if (seat?.deckId && ctx.user) {
          const refreshed = await resolveFreshDeck(deps.db, ctx.user.id, seat.deckId, fabraryClient);
          if (!refreshed.ok) {
            send(ws, { type: "error", message: refreshed.error });
            return;
          }
        }
        const r = await rooms.presentDeck(player.code, player.credentials, msg.deck);
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        await publishRoomEvent({ code: player.code, kind: r.started ? "game-started" : "prep", version: r.version });
        if (r.started) botRunner.schedule(player.code);
        return;
      }
      case "accept-match": {
        const player = requirePlayer(ws, ctx);
        if (!player) return;
        const r = await rooms.acceptMatch(player.code, player.credentials);
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        await publishRoomEvent({ code: player.code, kind: "prep", version: r.version });
        return;
      }
      case "prep-unready": {
        const player = requirePlayer(ws, ctx);
        if (!player) return;
        const r = await rooms.unready(player.code, player.credentials);
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        await publishRoomEvent({ code: player.code, kind: "prep", version: r.version });
        return;
      }
      case "choose-first": {
        const player = requirePlayer(ws, ctx);
        if (!player) return;
        const r = await rooms.chooseFirst(player.code, player.credentials, msg.first);
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        await publishRoomEvent({ code: player.code, kind: r.started ? "game-started" : "prep", version: r.version });
        if (r.started) botRunner.schedule(player.code);
        return;
      }
      case "leave-room": {
        if (!ctx.code || !ctx.token) {
          send(ws, { type: "error", message: "not in a room" });
          return;
        }
        const code = ctx.code;
        const credentials = seatCredentials(ctx);
        if (!credentials) return;
        if (msg.endGame) {
          const ended = await rooms.deleteBotRoom(code, credentials);
          if (!ended.ok) {
            send(ws, { type: "error", message: ended.error });
            return;
          }
          if (ctx.user && queuedUsers.get(ctx.user.id) === ctx) {
            queuedUsers.delete(ctx.user.id);
            await rooms.leaveMatchmaking(ctx.user.id);
          }
          if (ended.replayFinalizationId) replayFinalizer.enqueue(ended.replayFinalizationId);
          connections.detach(ctx);
          send(ws, { type: "left" });
          await publishRoomEvent({ code, kind: "deleted", version: ended.version });
          return;
        }
        const r = await rooms.leaveRoom(code, credentials);
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        if (ctx.user && queuedUsers.get(ctx.user.id) === ctx) {
          queuedUsers.delete(ctx.user.id);
          await rooms.leaveMatchmaking(ctx.user.id);
        }
        connections.detach(ctx);
        send(ws, { type: "left" });
        await publishRoomEvent({ code, kind: "left", version: r.version });
        if (r.freedSeat !== null && r.remaining) {
          await publishRoomEvent({ code, kind: "prep", version: r.version });
          // A matchmade player whose opponent left goes straight back into the
          // queue, keeping their room (and prep page) for the next pairing.
          if (r.remaining.fromQueue && r.remaining.userId != null) {
            const remainingCtx = [...(clientsByRoom.get(code) ?? [])].find(
              (c) => !!c.token && hashReconnectToken(c.token) === r.remaining!.tokenHash,
            );
            if (remainingCtx) queuedUsers.set(r.remaining.userId, remainingCtx);
            await rooms.queueForMatch(r.format, {
              userId: r.remaining.userId,
              username: r.remaining.username ?? "unknown",
              hero: r.remaining.hero,
              deckId: r.remaining.deckId,
              deckName: r.remaining.deckName,
              retainedRoomCode: code,
              allowFutureCards: r.allowFutureCards,
            });
            clusterConsumer?.nudge();
          }
        }
        return;
      }
      case "intent": {
        const player = requirePlayer(ws, ctx);
        if (!player) return;
        const r = await rooms.applyIntent(player.code, player.credentials, msg.intent, {
          autoPass: msg.autoPass === true,
        }, msg.commandId !== undefined && msg.expectedVersion !== undefined
          ? { id: msg.commandId, expectedVersion: msg.expectedVersion }
          : undefined);
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        await afterStateCommit(player.code, r.version, r.replayFinalizationId);
        botRunner.schedule(player.code);
        return;
      }
      case "priority-mode": {
        const player = requirePlayer(ws, ctx);
        if (!player) return;
        const r = await rooms.setPriorityMode(
          player.code,
          player.credentials,
          msg.mode,
          msg.commandId !== undefined && msg.expectedVersion !== undefined
            ? { id: msg.commandId, expectedVersion: msg.expectedVersion }
            : undefined,
        );
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        // The durable preference commit is propagated by its transactional
        // cluster sync event; only an immediate auto-pass needs bot follow-up.
        if (r.autoPassed) {
          await afterStateCommit(player.code, r.version, r.replayFinalizationId);
          botRunner.schedule(player.code);
        }
        return;
      }
      case "runechant-skip": {
        const player = requirePlayer(ws, ctx);
        if (!player) return;
        const r = await rooms.setRunechantSkipping(
          player.code,
          player.credentials,
          msg.enabled,
          msg.commandId !== undefined && msg.expectedVersion !== undefined
            ? { id: msg.commandId, expectedVersion: msg.expectedVersion }
            : undefined,
        );
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        if (r.advanced) {
          await afterStateCommit(player.code, r.version, r.replayFinalizationId);
          botRunner.schedule(player.code);
        }
        return;
      }
      case "undo": {
        const player = requirePlayer(ws, ctx);
        if (!player) return;
        const r = await rooms.undo(
          player.code,
          player.credentials,
          msg.target,
          msg.commandId !== undefined && msg.expectedVersion !== undefined
            ? { id: msg.commandId, expectedVersion: msg.expectedVersion }
            : undefined,
        );
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        await afterStateCommit(player.code, r.version, r.replayFinalizationId);
        botRunner.schedule(player.code);
        return;
      }
      case "emote": {
        const player = requirePlayer(ws, ctx);
        if (!player) return;
        const room = await rooms.getRoom(player.code);
        if (!room || !room.state) {
          send(ws, { type: "error", message: room ? "game has not started" : "room not found" });
          return;
        }
        const senderSeat = authorizedProjectionSeat(room, ctx);
        if (senderSeat !== 0 && senderSeat !== 1) return;
        const now = Date.now();
        if (now - ctx.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
        ctx.lastEmoteAt = now;
        await publishClusterEvent({ type: "emote", code: player.code, seat: senderSeat, message: msg.message });
        return;
      }
      case "claim-victory": {
        const player = requirePlayer(ws, ctx);
        if (!player) return;
        const r = await rooms.claimVictory(
          player.code,
          player.credentials,
          undefined,
          msg.commandId !== undefined && msg.expectedVersion !== undefined
            ? { id: msg.commandId, expectedVersion: msg.expectedVersion }
            : undefined,
        );
        if (!r.ok) {
          send(ws, { type: "error", message: r.error });
          return;
        }
        await afterStateCommit(player.code, r.version, r.replayFinalizationId);
        return;
      }
    }
  }

  /** live socket count per client IP — caps idle-socket floods (each ws holds
   *  a Cloud Run concurrency slot for its whole lifetime) */
  const connsByIp = new Map<string, number>();
  const WS_MAX_PER_IP = Number(process.env.WS_MAX_PER_IP ?? 10);

  wss.on("connection", (ws, req) => {
    const ip = clientIp(req.headers, req.socket.remoteAddress, trustedProxyHops);
    const count = connsByIp.get(ip) ?? 0;
    if (count >= WS_MAX_PER_IP) {
      ws.close(1008, "too many connections");
      return;
    }
    connsByIp.set(ip, count + 1);

    const ctx: ClientCtx = {
      closed: false,
      code: null,
      seat: null,
      token: null,
      presenceLeaseId: null,
      user: null,
      sessionToken: null,
      lastEmoteAt: 0,
      close: (code, reason) => {
        ctx.closed = true;
        ws.close(code, reason);
      },
      send: (msg) => {
        if (!send(ws, msg)) ctx.closed = true;
      },
      sendRaw: (payload) => {
        if (!sendRaw(ws, payload)) ctx.closed = true;
      },
    };
    socketContexts.set(ws, ctx);
    socketAlive.set(ws, true);
    allClients.add(ctx);
    void rooms.matchmakingCounts()
      .then((counts) => ctx.send({ type: "queue-status", counts }))
      .catch((error) => consoleError("queue status load failed", error));

    // e.g. a client exceeding maxPayload — log instead of crashing the process
    ws.on("error", (error) => consoleError("ws connection error", error));
    ws.on("pong", () => {
      socketAlive.set(ws, true);
    });

    // Messages from one connection are handled strictly in order (each waits
    // for the previous to finish): a reconnecting client sends "auth" and
    // "join-room" back-to-back, and join-room must see ctx.user set by auth —
    // a concurrent race read it as anonymous and rejected the seat-token
    // reconnect with PLAY_REQUIRES_LOGIN. Ordering also stops same-client
    // intents from racing applyIntent into spurious version conflicts.
    let queue: Promise<void> = Promise.resolve();
    let pendingMessages = 0;
    let rateWindowStartedAt = Date.now();
    let messagesInWindow = 0;
    const closeForPolicy = (reason: string): void => {
      ctx.closed = true;
      ws.close(1008, reason);
    };
    ws.on("message", (raw, isBinary) => {
      if (ctx.closed) return;
      if (isBinary) {
        ctx.closed = true;
        ws.close(1003, "binary messages are not supported");
        return;
      }
      const now = Date.now();
      if (now - rateWindowStartedAt >= messageRateWindowMs) {
        rateWindowStartedAt = now;
        messagesInWindow = 0;
      }
      messagesInWindow += 1;
      if (messagesInWindow > messageRateMax) {
        closeForPolicy("message rate exceeded");
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        send(ws, { type: "error", message: "invalid message" });
        return;
      }
      const msg = decodeClientMessage(parsed);
      if (!msg) {
        send(ws, { type: "error", message: "invalid message" });
        return;
      }
      if (pendingMessages >= maxPendingMessages) {
        closeForPolicy("too many pending messages");
        return;
      }
      pendingMessages += 1;
      queue = queue
        .then(() => handleMessage(ws, ctx, msg))
        .catch((e: Error) => {
          consoleError("ws message handling failed", e);
          send(ws, { type: "error", message: "internal error" });
        })
        .finally(() => {
          pendingMessages -= 1;
        });
    });

    ws.on("close", () => {
      ctx.closed = true;
      const queuedUserId = ctx.user?.id;
      connections.unbindSession(ctx);
      const n = (connsByIp.get(ip) ?? 1) - 1;
      if (n <= 0) connsByIp.delete(ip);
      else connsByIp.set(ip, n);
      const { code, token, presenceLeaseId } = ctx;
      connections.detach(ctx);
      allClients.delete(ctx);
      lobbyClients.delete(ctx);
      if (queuedUserId != null && queuedUsers.get(queuedUserId) === ctx) {
        queuedUsers.delete(queuedUserId);
        void rooms.leaveMatchmaking(queuedUserId)
          .then(() => clusterConsumer?.nudge())
          .catch((error) => consoleError("matchmaking disconnect cleanup failed", error));
      }
      if (!code || !token || !presenceLeaseId) return;
      void (async () => {
        const found = await rooms.markAbsent(code, token, presenceLeaseId);
        if (!found) return;
        await publishRoomEvent(
          found.kind === "player"
            ? { code, kind: "presence", seat: found.seat, connected: false, version: found.version }
            : { code, kind: "spectators", version: found.version },
        );
      })().catch((error: Error) => consoleError("disconnect bookkeeping failed", error));
    });

  });

  // Establish the event-log tail before accepting clients. Events committed
  // after this snapshot are consumed; older state is loaded on reconnect.
  void clusterConsumer.startAtTail()
    .then(() => server.listen(port))
    .catch((error) => server.emit("error", error));

  if (!process.env.VITEST) {
    // Timers are process-local, but bot ownership is durable. Recover any bot
    // that held priority when a production instance recycled.
    void rooms.botRoomCodes()
      .then((codes) => codes.forEach((code) => botRunner.schedule(code)))
      .catch((error: Error) => consoleError("bot room recovery failed", error));

    // Expired sessions otherwise accumulate until their individual token is
    // presented again. One gateway owns each sweep window through a lease.
    const sweepSessions = (): void => {
      void tryAcquireLease(deps.db, "maintenance:sessions", instanceId, 60_000)
        .then((claimed) => claimed ? deleteExpiredSessions(deps.db) : 0)
        .catch((error: Error) => consoleError("session cleanup failed", error));
    };
    sweepSessions();
    const sessionSweepTimer = setInterval(sweepSessions, SESSION_SWEEP_INTERVAL_MS);
    server.on("close", () => clearInterval(sessionSweepTimer));

    // Presence heartbeat: re-stamp every locally attached socket's lastSeenAt.
    // GC presence reads these timestamps, so a room with live clients never
    // counts down; rooms abandoned by a killed gateway go
    // stale within PRESENCE_TIMEOUT_MS and the sweep arms their deadline.
    const heartbeat = setInterval(() => {
      const leases = [...allClients].flatMap((c) =>
        c.code && c.token && c.presenceLeaseId
          ? [{ code: c.code, token: c.token, leaseId: c.presenceLeaseId, seat: c.seat }]
          : [],
      );
      deps.rooms
        .markPresentBatch(leases)
        .catch((error: Error) => consoleError("presence heartbeat failed", error));
    }, PRESENCE_HEARTBEAT_MS);
    server.on("close", () => clearInterval(heartbeat));
  }
  return server;
}

function send(ws: WebSocket, msg: WireServerMessage): boolean {
  return sendRaw(ws, JSON.stringify(encodeWireMessage(msg)));
}

function sendRaw(ws: WebSocket, payload: string): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
    ws.terminate();
    return false;
  }
  ws.send(payload);
  return true;
}

/** Stop accepting connections, terminate ws clients, then close the server. */
export function closeGameServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    const wss = wssByServer.get(server);
    if (wss) {
      for (const client of wss.clients) client.terminate();
      wss.close();
    }
    server.close(() => resolve());
  });
}

export async function broadcastCommittedRoom(
  server: http.Server,
  event: Parameters<RoomBroadcaster<ClientCtx>["afterCommit"]>[0],
): Promise<void> {
  await clusterPublisherByServer.get(server)?.(event);
}

/** Resolve the stable room code and credentials needed for a player action. */
function requirePlayer(
  ws: WebSocket,
  ctx: ClientCtx,
): { code: string; credentials: SeatCredentials } | null {
  if (!ctx.code) {
    send(ws, { type: "error", message: "not in a room" });
    return null;
  }
  if (ctx.seat === null) {
    send(ws, { type: "error", message: "spectators cannot act" });
    return null;
  }
  if (!ctx.token) return null;
  return {
    code: ctx.code,
    credentials: { token: ctx.token, userId: ctx.user?.id },
  };
}

const port = Number(process.env.PORT ?? 8080);
/** How often expired rooms (game over / both players disconnected) are deleted. */
const SWEEP_INTERVAL_MS = 60_000;
const MATCH_PREP_SWEEP_INTERVAL_MS = 5_000;
if (!process.env.VITEST) {
  // Initialize shared persistence and this gateway before accepting traffic.
  const { db: pool, rooms } = await composeProductionGateway();
  const instanceId = `gateway-${randomUUID()}`;
  const server = createGameServer(port, { db: pool, rooms, instanceId });
  console.log(`fyendal server listening on ws://localhost:${port} (db ready)`);

  // Room GC: arm rooms with no live presence, delete rooms past their
  // deadline, and kick any local sockets still attached to those.
  let sweeping = false;
  const sweep = (): void => {
    if (sweeping) return;
    sweeping = true;
    tryAcquireLease(pool, "maintenance:gc", instanceId, 2 * SWEEP_INTERVAL_MS)
      .then(async (claimed) => {
        if (!claimed) return;
        const codes = await rooms.sweepRooms();
        if (codes.length > 0) {
          const shown = codes.slice(0, 20).map((room) => room.code).join(", ");
          const omitted = codes.length > 20 ? `, … ${codes.length - 20} more` : "";
          console.log(`swept ${codes.length} expired room(s): ${shown}${omitted}`);
        }
        await replayFinalizerByServer.get(server)?.recoverPending();
        await sweepReplays(pool);
        await sweepClusterEvents(pool);
        await sweepRoomCommands(pool);
        await sweepRateLimits(pool);
      })
      .catch((error: Error) => consoleError("room sweep failed", error))
      .finally(() => { sweeping = false; });
  };
  sweep();
  const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  const sweepMatchPrep = (): void => {
    void tryAcquireLease(pool, "maintenance:match-prep", instanceId, 2 * MATCH_PREP_SWEEP_INTERVAL_MS)
      .then((claimed) => claimed ? rooms.sweepMatchmadePrep() : [])
      .catch((error: Error) => consoleError("match prep sweep failed", error));
  };
  sweepMatchPrep();
  const matchPrepSweepTimer = setInterval(sweepMatchPrep, MATCH_PREP_SWEEP_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — shutting down`);
    clearInterval(sweepTimer);
    clearInterval(matchPrepSweepTimer);
    closeGameServer(server)
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch((error: Error) => {
        consoleError("shutdown error", error);
        process.exit(1);
      });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
