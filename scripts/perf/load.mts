#!/usr/bin/env tsx
/**
 * Protocol-level local capacity harness. It seeds synthetic sessions into the
 * guarded fyendal_perf database, creates real games over WebSockets, and then
 * drives legal intents at a controlled rate while collecting PostgreSQL and
 * end-to-end latency metrics.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import type {
  ClientMessage,
  GameIntent,
  PrepView,
  ServerMessage,
} from "../../packages/shared/src/index.js";
import {
  decodeReplayResponse,
  decodeServerMessage,
} from "../../packages/protocol/src/index.js";
import { decklists } from "../../packages/cards/src/index.js";
import { createPool } from "../../apps/server/src/db.js";
import {
  createReplayFinalizationMonitor,
  type ReplayFinalizationSample,
} from "./replay-finalization.mjs";

type ErrorMessage = Extract<ServerMessage, { type: "error" }>;
type StateMessage = Extract<ServerMessage, { type: "state" }>;

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} through ${max}`);
  }
  return value;
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} through ${max}`);
  }
  return value;
}

const games = integerEnv("PERF_GAMES", 200, 1, 500);
const finishRate = numberEnv("PERF_FINISH_RATE", 2, 0.01, 500);
const finishDurationSeconds = integerEnv("PERF_FINISH_DURATION_SECONDS", 60, 1, 3_600);
const scheduledFinishCapacity = Math.min(games, Math.floor(finishRate * finishDurationSeconds));
const configuredAppUrls = process.env.PERF_APP_URLS
  ?? process.env.PERF_APP_URL
  ?? "http://127.0.0.1:8080,http://127.0.0.1:8081";
const config = {
  games,
  setupConcurrency: integerEnv("PERF_SETUP_CONCURRENCY", 8, 1, 32),
  durationSeconds: integerEnv("PERF_DURATION_SECONDS", 60, 1, 3_600),
  actionThinkSeconds: numberEnv("PERF_ACTION_THINK_SECONDS", 10, 0.1, 600),
  passThinkSeconds: numberEnv("PERF_PASS_THINK_SECONDS", 1, 0.1, 600),
  reconnectPercent: numberEnv("PERF_RECONNECT_PERCENT", 5, 0, 100),
  spectators: integerEnv("PERF_SPECTATORS", 10, 0, 500),
  longReplayGames: integerEnv("PERF_LONG_REPLAY_GAMES", 1, 0, 10),
  // Leave one frame for the finishing intent; replay decoders accept 10,000.
  longReplayFrames: integerEnv("PERF_LONG_REPLAY_FRAMES", 550, 0, 9_999),
  longReplayCommitsPerSecond: numberEnv("PERF_LONG_REPLAY_COMMITS_PER_SECOND", 10, 0.1, 100),
  finishRate,
  finishDurationSeconds,
  finishGames: integerEnv("PERF_FINISH_GAMES", scheduledFinishCapacity, 0, scheduledFinishCapacity),
  requestTimeoutMs: integerEnv("PERF_REQUEST_TIMEOUT_MS", 15_000, 1_000, 120_000),
  matchmakingPairs: integerEnv("PERF_MATCHMAKING_PAIRS", Math.min(10, games), 0, games),
  correctnessGames: integerEnv("PERF_CORRECTNESS_GAMES", Math.min(10, games), 0, games),
  databaseUrl: process.env.PERF_DATABASE_URL
    ?? "postgres://fyendal:fyendal-perf@127.0.0.1:55432/fyendal_perf",
  appUrls: configuredAppUrls.split(",").map((value) => value.trim()).filter(Boolean),
};

function assertLocalPerfDatabase(raw: string): void {
  const url = new URL(raw);
  if (!(url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
    throw new Error("PERF_DATABASE_URL must point to localhost");
  }
  if (url.pathname !== "/fyendal_perf") {
    throw new Error("PERF_DATABASE_URL must use the isolated fyendal_perf database");
  }
  if (raw.includes("/cloudsql/")) throw new Error("the performance harness refuses Cloud SQL sockets");
}

assertLocalPerfDatabase(config.databaseUrl);
if (config.appUrls.length === 0) throw new Error("PERF_APP_URLS must contain at least one URL");
for (const raw of config.appUrls) {
  const url = new URL(raw);
  if (!(url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
    throw new Error("PERF_APP_URLS may contain only localhost endpoints");
  }
}
const appOrigin = process.env.PERF_APP_ORIGIN ?? new URL(config.appUrls[0]!).origin;

function webSocketUrl(appUrl: string): URL {
  const url = new URL(appUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/";
  url.search = "";
  return url;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

interface Waiter {
  predicate(message: ServerMessage): boolean;
  resolve(message: ServerMessage): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

class LoadClient {
  private socket: WebSocket | null = null;
  private readonly waiters = new Set<Waiter>();
  private expectedClose = false;
  readonly failures: string[] = [];
  latestPrep: PrepView | null = null;
  latestPrepVersion = -1;
  latestState: StateMessage | null = null;
  latestRoomVersion = -1;
  roomCode: string | null = null;
  roomToken: string | null = null;
  readonly messages: ServerMessage[] = [];

  constructor(
    readonly name: string,
    readonly sessionToken: string | null,
    readonly gatewayIndex: number,
  ) {}

  async connect(): Promise<void> {
    const socket = new WebSocket(webSocketUrl(config.appUrls[this.gatewayIndex]!), { origin: appOrigin });
    this.socket = socket;
    socket.on("message", (raw) => this.onMessage(raw));
    socket.on("error", (error) => this.fail(`socket error: ${error.message}`));
    socket.on("close", (code, reason) => {
      if (!this.expectedClose) this.fail(`unexpected close ${code}: ${String(reason)}`);
      this.rejectWaiters(new Error(`${this.name} socket closed ${code}: ${String(reason)}`));
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} connection timed out`)), config.requestTimeoutMs);
      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    if (this.sessionToken) {
      await this.request(
        { type: "auth", token: this.sessionToken },
        (message): message is Extract<ServerMessage, { type: "authed" }> => message.type === "authed",
        "authentication",
      );
    }
  }

  private fail(message: string): void {
    this.failures.push(`${this.name}: ${message}`);
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  private onMessage(raw: RawData): void {
    let value: unknown;
    try {
      value = JSON.parse(String(raw));
    } catch {
      this.fail("received invalid JSON");
      return;
    }
    const message = decodeServerMessage(value);
    if (!message) {
      this.fail("received a frame rejected by decodeServerMessage");
      return;
    }
    this.messages.push(message);
    if ("version" in message && typeof message.version === "number") {
      this.latestRoomVersion = Math.max(this.latestRoomVersion, message.version);
    }
    if (message.type === "prep-state" && message.version >= this.latestPrepVersion) {
      this.latestPrep = message.prep;
      this.latestPrepVersion = message.version;
    }
    if (message.type === "state" && message.version >= (this.latestState?.version ?? -1)) {
      this.latestState = message;
    }
    if (message.type === "room-created" || message.type === "joined") {
      this.roomCode = message.code;
      this.roomToken = message.token;
    }
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(message);
    }
  }

  waitFor<T extends ServerMessage>(
    predicate: (message: ServerMessage) => message is T,
    label: string,
  ): Promise<T> {
    return new Promise<ServerMessage>((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`${this.name} timed out waiting for ${label}`));
        }, config.requestTimeoutMs),
      };
      this.waiters.add(waiter);
    }).then((message) => {
      if (!predicate(message)) throw new Error(`${this.name} received an unexpected ${message.type}`);
      return message;
    });
  }

  async request<T extends ServerMessage>(
    payload: ClientMessage,
    predicate: (message: ServerMessage) => message is T,
    label: string,
  ): Promise<T> {
    const response = this.waitFor(
      (message): message is T | ErrorMessage => message.type === "error" || predicate(message),
      label,
    );
    this.send(payload);
    const message = await response;
    if (message.type === "error") throw new Error(`${this.name} ${label} failed: ${message.code}: ${message.message}`);
    return message;
  }

  send(payload: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`${this.name} socket is not open`);
    }
    this.socket.send(JSON.stringify(payload));
  }

  async close(): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    this.expectedClose = true;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate();
        resolve();
      }, 2_000);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.close(1000, "load test cleanup");
    });
  }
}

interface SeededSession {
  username: string;
  token: string;
  userId: number;
}

interface GameSession {
  index: number;
  host: LoadClient;
  guest: LoadClient;
  pending: boolean;
  lastActor: LoadClient | null;
}

async function synchronizePlayers(game: GameSession, version: number, label: string): Promise<void> {
  await Promise.all([game.host, game.guest].map((client) => {
    if ((client.latestState?.version ?? -1) >= version) return Promise.resolve();
    return client.waitFor(
      (message): message is StateMessage => message.type === "state" && message.version >= version,
      `${label} for ${client.name}`,
    ).then(() => undefined);
  }));
}

function rowObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} was not an object`);
  }
  return value as Record<string, unknown>;
}

async function seedSessions(pool: Awaited<ReturnType<typeof createPool>>, count: number): Promise<SeededSession[]> {
  const run = randomBytes(5).toString("hex");
  const users = Array.from({ length: count }, (_, index) => ({
    username: `p${run}${index.toString(36)}`,
    token: randomBytes(32).toString("base64url"),
  }));
  const params: unknown[] = [];
  const values = users.map(({ username }) => {
    const base = params.length;
    params.push(username, username.toLowerCase(), "perf-load-only", Date.now());
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });
  const inserted = await pool.query(
    `INSERT INTO users (username, username_lc, pass_hash, created_at)
     VALUES ${values.join(", ")}
     RETURNING id, username_lc`,
    params,
  );
  const idByName = new Map<string, number>();
  for (const [index, value] of (inserted.rows as unknown[]).entries()) {
    const row = rowObject(value, `users[${index}]`);
    const id = Number(row.id);
    if (typeof row.username_lc !== "string" || !Number.isSafeInteger(id)) {
      throw new Error(`users[${index}] had invalid fields`);
    }
    idByName.set(row.username_lc, id);
  }
  const sessionParams: unknown[] = [];
  const sessionValues = users.map(({ username, token }) => {
    const userId = idByName.get(username.toLowerCase());
    if (userId === undefined) throw new Error(`missing inserted user ${username}`);
    const base = sessionParams.length;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    sessionParams.push(tokenHash, userId, Date.now() + 3_600_000);
    return `($${base + 1}, $${base + 2}, $${base + 3})`;
  });
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ${sessionValues.join(", ")}`,
    sessionParams,
  );
  return users.map((user) => {
    const userId = idByName.get(user.username.toLowerCase());
    if (userId === undefined) throw new Error(`missing inserted user ${user.username}`);
    return { ...user, userId };
  });
}

function prepAfter(client: LoadClient, version: number, label: string) {
  if (client.latestPrep && client.latestPrepVersion > version) return Promise.resolve(client.latestPrep);
  return client.waitFor(
    (message): message is Extract<ServerMessage, { type: "prep-state" }> =>
      message.type === "prep-state" && message.version > version,
    label,
  );
}

async function setupGame(
  index: number,
  hostSeed: SeededSession,
  guestSeed: SeededSession,
  viaMatchmaking = false,
): Promise<GameSession> {
  const hostGateway = index % config.appUrls.length;
  const guestGateway = config.appUrls.length > 1
    ? (hostGateway + 1) % config.appUrls.length
    : hostGateway;
  const host = new LoadClient(`game-${index}-host`, hostSeed.token, hostGateway);
  const guest = new LoadClient(`game-${index}-guest`, guestSeed.token, guestGateway);
  await Promise.all([host.connect(), guest.connect()]);
  const hostPrep = prepAfter(host, -1, "initial host prep state");
  const guestPrep = prepAfter(guest, -1, "initial guest prep state");
  if (viaMatchmaking) {
    const matched = (client: LoadClient, hero: "rhinar" | "dorinthea") => client.request(
      { type: "queue-join", format: "classic-battles", hero },
      (message): message is Extract<ServerMessage, { type: "room-created" | "joined" }> =>
        message.type === "room-created" || message.type === "joined",
      "durable matchmaking",
    );
    const [hostMatch, guestMatch] = await Promise.all([
      matched(host, "rhinar"),
      matched(guest, "dorinthea"),
    ]);
    if (hostMatch.code !== guestMatch.code) throw new Error(`game ${index} matchmaking produced different rooms`);
    if (hostMatch.seat === null || guestMatch.seat === null || hostMatch.seat === guestMatch.seat) {
      throw new Error(`game ${index} matchmaking produced invalid seats`);
    }
  } else {
    const created = await host.request(
      { type: "create-room", format: "classic-battles", hero: "rhinar" },
      (message): message is Extract<ServerMessage, { type: "room-created" }> => message.type === "room-created",
      "room creation",
    );
    const joined = await guest.request(
      { type: "join-room", code: created.code, hero: "dorinthea" },
      (message): message is Extract<ServerMessage, { type: "joined" }> => message.type === "joined",
      "room join",
    );
    if (joined.seat === null) throw new Error(`game ${index} guest unexpectedly became a spectator`);
  }
  await Promise.all([hostPrep, guestPrep]);

  const present = async (actor: LoadClient, other: LoadClient, hero: "rhinar" | "dorinthea") => {
    const beforeVersion = Math.max(actor.latestRoomVersion, other.latestRoomVersion);
    const actorPrep = prepAfter(actor, beforeVersion, `${actor.name} ready state`);
    const otherPrep = prepAfter(other, beforeVersion, `${other.name} opponent ready state`);
    const deck = decklists[hero];
    actor.send({
      type: "present-deck",
      deck: { weaponIds: deck.weaponIds, equipment: deck.equipment, deck: deck.deck },
    });
    await Promise.all([actorPrep, otherPrep]);
  };
  await present(host, guest, "rhinar");
  await present(guest, host, "dorinthea");

  if (!host.latestPrep?.seats.every((seat) => seat?.ready)) {
    await host.waitFor(
      (message): message is Extract<ServerMessage, { type: "prep-state" }> =>
        message.type === "prep-state" && message.prep.seats.every((seat) => seat?.ready),
      `${host.name} both players ready`,
    );
  }

  const dieWinner = host.latestPrep?.die?.winner;
  const hostSeat = host.latestPrep?.yourSeat;
  if (dieWinner === undefined || hostSeat === undefined) throw new Error(`game ${index} has no die result`);
  const chooser = dieWinner === hostSeat ? host : guest;
  const started = [host, guest].map((client) => client.waitFor(
    (message): message is Extract<ServerMessage, { type: "game-started" }> => message.type === "game-started",
    `${client.name} game start`,
  ));
  const states = [host, guest].map((client) => client.waitFor(
    (message): message is StateMessage => message.type === "state",
    `${client.name} initial state`,
  ));
  chooser.send({ type: "choose-first", first: true });
  await Promise.all([...started, ...states]);
  return { index, host, guest, pending: false, lastActor: null };
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  work: (value: T, index: number) => Promise<R>,
  progressLabel?: string,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await work(values[index]!, index);
      if (progressLabel && ((index + 1) % 10 === 0 || index + 1 === values.length)) {
        console.log(`${progressLabel} ${index + 1}/${values.length}`);
      }
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
  return results;
}

async function reconnectGuest(game: GameSession): Promise<void> {
  const old = game.guest;
  const roomCode = old.roomCode;
  const roomToken = old.roomToken;
  if (!roomCode || !roomToken || !old.sessionToken) throw new Error(`game ${game.index} has no reconnect credentials`);
  await old.close();
  await delay(25);
  const replacementGateway = config.appUrls.length > 1
    ? (old.gatewayIndex + 1) % config.appUrls.length
    : old.gatewayIndex;
  const replacement = new LoadClient(`${old.name}-reconnected`, old.sessionToken, replacementGateway);
  await replacement.connect();
  const state = replacement.waitFor(
    (message): message is StateMessage => message.type === "state",
    `${replacement.name} restored state`,
  );
  const joined = await replacement.request(
    { type: "join-room", code: roomCode, token: roomToken, hero: "dorinthea" },
    (message): message is Extract<ServerMessage, { type: "joined" }> => message.type === "joined",
    "seat reconnect",
  );
  if (joined.seat === null) throw new Error(`game ${game.index} reconnect became a spectator`);
  await state;
  game.guest = replacement;
}

async function addSpectator(game: GameSession, index: number): Promise<LoadClient> {
  const code = game.host.roomCode;
  if (!code) throw new Error(`game ${game.index} has no room code`);
  const spectator = new LoadClient(`spectator-${index}`, null, index % config.appUrls.length);
  await spectator.connect();
  const state = spectator.waitFor(
    (message): message is StateMessage => message.type === "state" && message.yourSeat === null,
    "spectator state",
  );
  const joined = await spectator.request(
    { type: "join-room", code, spectate: true },
    (message): message is Extract<ServerMessage, { type: "joined" }> => message.type === "joined",
    "spectator join",
  );
  if (joined.seat !== null || joined.spectator !== true) throw new Error(`spectator ${index} took a player seat`);
  await state;
  return spectator;
}

function legalActor(game: GameSession): { client: LoadClient; intent: GameIntent } | null {
  for (const client of [game.host, game.guest]) {
    const state = client.latestState;
    if (!state || state.view.winner !== null) continue;
    const legal = state.legal.filter((intent) => intent.kind !== "concede");
    if (legal.length === 0) continue;
    const intent = legal.find((candidate) => candidate.kind !== "pass" && candidate.kind !== "close-chain")
      ?? legal.find((candidate) => candidate.kind === "pass")
      ?? legal[0]!;
    return { client, intent };
  }
  return null;
}

function commandFields(client: LoadClient): { commandId: string; expectedVersion: number } {
  if (client.latestRoomVersion < 0) throw new Error(`${client.name} has no accepted room version`);
  return { commandId: randomUUID(), expectedVersion: client.latestRoomVersion };
}

interface ActionResult {
  game: GameSession;
  latencyMs: number;
  intentKind?: GameIntent["kind"];
  error?: string;
}

async function applyOneAction(game: GameSession): Promise<ActionResult> {
  game.pending = true;
  const selected = legalActor(game);
  if (!selected) {
    game.pending = false;
    return { game, latencyMs: 0, error: "no non-concede legal intent" };
  }
  const beforeVersion = Math.max(
    game.host.latestState?.version ?? 0,
    game.guest.latestState?.version ?? 0,
  );
  const startedAt = performance.now();
  try {
    const state = await selected.client.request(
      { type: "intent", intent: selected.intent, ...commandFields(selected.client) },
      (message): message is StateMessage => message.type === "state" && message.version > beforeVersion,
      "authoritative state after intent",
    );
    await synchronizePlayers(game, state.version, "peer state after intent");
    game.lastActor = selected.client;
    return { game, latencyMs: performance.now() - startedAt, intentKind: selected.intent.kind };
  } catch (error) {
    return {
      game,
      latencyMs: performance.now() - startedAt,
      intentKind: selected.intent.kind,
      error: (error as Error).message,
    };
  } finally {
    game.pending = false;
  }
}

async function driveActions(games: GameSession[]): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const startedAt = performance.now();
  const endsAt = startedAt + config.durationSeconds * 1_000;
  await Promise.all(games.map(async (game, index) => {
    let firstAction = true;
    while (performance.now() < endsAt && game.host.latestState?.view.winner === null) {
      const selected = legalActor(game);
      if (!selected) {
        results.push({ game, latencyMs: 0, error: "no non-concede legal intent" });
        return;
      }
      const thinkMs = (selected.intent.kind === "pass"
        ? config.passThinkSeconds
        : config.actionThinkSeconds) * 1_000;
      // Spread initial decisions evenly across their think-time window. Later
      // decisions wait the full amount after the preceding authoritative view.
      const waitMs = firstAction
        ? thinkMs * ((index + 0.5) / games.length)
        : thinkMs;
      firstAction = false;
      if (performance.now() + waitMs >= endsAt) return;
      await delay(waitMs);
      const result = await applyOneAction(game);
      results.push(result);
      if (result.error) return;
    }
  }));
  return results;
}

async function validateUndo(games: GameSession[]): Promise<string[]> {
  const candidates = games.filter((game) => game.lastActor).slice(0, 10);
  const failures: string[] = [];
  await mapConcurrent(candidates, 2, async (game) => {
    const actor = game.lastActor!;
    const before = Math.max(game.host.latestState?.version ?? 0, game.guest.latestState?.version ?? 0);
    try {
      const state = await actor.request(
        { type: "undo", ...commandFields(actor) },
        (message): message is StateMessage => message.type === "state" && message.version > before,
        "undo state",
      );
      await synchronizePlayers(game, state.version, "peer state after undo");
    } catch (error) {
      failures.push((error as Error).message);
    }
    return undefined;
  });
  return failures;
}

async function waitUntil(
  predicate: () => Promise<boolean> | boolean,
  label: string,
  timeoutMs = config.requestTimeoutMs,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

interface CorrectnessResult {
  games: number;
  crossGatewayRaces: number;
  staleCommandsRejected: number;
  retriesCommitted: number;
  duplicateCommandsDeduplicated: number;
  errors: string[];
}

async function validateConcurrencyCorrectness(
  pool: Awaited<ReturnType<typeof createPool>>,
  games: readonly GameSession[],
): Promise<CorrectnessResult> {
  const result: CorrectnessResult = {
    games: games.length,
    crossGatewayRaces: 0,
    staleCommandsRejected: 0,
    retriesCommitted: 0,
    duplicateCommandsDeduplicated: 0,
    errors: [],
  };
  await mapConcurrent(games, Math.min(4, games.length), async (game) => {
    const code = game.host.roomCode;
    if (!code) {
      result.errors.push(`game ${game.index}: missing room code`);
      return;
    }
    try {
      const beforeRow = rowObject((await pool.query(
        "SELECT version FROM rooms WHERE code = $1",
        [code],
      )).rows[0], `game ${game.index} correctness room`);
      const before = Number(beforeRow.version);
      await Promise.all([game.host, game.guest].map((client) => {
        if (client.latestRoomVersion >= before) return Promise.resolve();
        return client.waitFor(
          (message): message is ServerMessage & { version: number } =>
            "version" in message && typeof message.version === "number" && message.version >= before,
          `${client.name} convergence to database v${before}`,
        ).then(() => undefined);
      }));
      if (game.host.latestRoomVersion !== before || game.guest.latestRoomVersion !== before) {
        throw new Error(
          `clients saw v${game.host.latestRoomVersion}/v${game.guest.latestRoomVersion}, database is v${before}`,
        );
      }

      const hostCommandId = randomUUID();
      const guestCommandId = randomUUID();
      const hostMessageStart = game.host.messages.length;
      const guestMessageStart = game.guest.messages.length;
      const racedState = Promise.all([game.host, game.guest].map((client) => client.waitFor(
        (message): message is StateMessage => message.type === "state" && message.version > before,
        `${client.name} state after concurrent preference race`,
      )));
      game.host.send({
        type: "priority-mode",
        mode: "always-pause",
        commandId: hostCommandId,
        expectedVersion: before,
      });
      game.guest.send({
        type: "priority-mode",
        mode: "always-pause",
        commandId: guestCommandId,
        expectedVersion: before,
      });
      const [hostState, guestState] = await racedState;
      if (!hostState || !guestState) throw new Error("concurrent command race returned no states");
      if (hostState.version !== before + 1 || guestState.version !== before + 1) {
        throw new Error(`concurrent commands produced client versions ${hostState.version}/${guestState.version}`);
      }
      await waitUntil(() => {
        const messages = [
          ...game.host.messages.slice(hostMessageStart),
          ...game.guest.messages.slice(guestMessageStart),
        ];
        return messages.some((message) => message.type === "error" && message.message === "stale room version");
      }, `game ${game.index} stale command rejection`);
      const raceReceipts = await pool.query(
        `SELECT command_id, expected_version, committed_version
         FROM room_commands WHERE room_code = $1 AND command_id = ANY($2::text[])
         ORDER BY command_id`,
        [code, [hostCommandId, guestCommandId]],
      );
      const racedVersion = Number(rowObject((await pool.query(
        "SELECT version FROM rooms WHERE code = $1",
        [code],
      )).rows[0], `game ${game.index} raced room`).version);
      if (racedVersion !== before + 1 || raceReceipts.rows.length !== 1) {
        throw new Error(`race committed v${racedVersion} with ${raceReceipts.rows.length} receipts`);
      }
      const winningId = String(rowObject(raceReceipts.rows[0], "race receipt").command_id);
      const loser = winningId === hostCommandId ? game.guest : game.host;
      const retryId = winningId === hostCommandId ? guestCommandId : hostCommandId;
      const retryState = loser.waitFor(
        (message): message is StateMessage => message.type === "state" && message.version > racedVersion,
        `${loser.name} state after fenced retry`,
      );
      loser.send({
        type: "priority-mode",
        mode: "always-pause",
        commandId: retryId,
        expectedVersion: racedVersion,
      });
      const retried = await retryState;
      await synchronizePlayers(game, retried.version, "peer state after fenced retry");
      const retryReceipts = await pool.query(
        "SELECT command_id FROM room_commands WHERE room_code = $1 AND command_id = ANY($2::text[])",
        [code, [hostCommandId, guestCommandId]],
      );
      if (retried.version !== racedVersion + 1 || retryReceipts.rows.length !== 2) {
        throw new Error(`retry committed v${retried.version} with ${retryReceipts.rows.length} receipts`);
      }

      const selected = legalActor(game);
      if (!selected) throw new Error("no legal action for duplicate-command check");
      const actionBefore = retried.version;
      const duplicateId = randomUUID();
      const duplicatePayload: ClientMessage = {
        type: "intent",
        intent: selected.intent,
        commandId: duplicateId,
        expectedVersion: actionBefore,
      };
      const duplicateState = Promise.all([game.host, game.guest].map((client) => client.waitFor(
        (message): message is StateMessage => message.type === "state" && message.version > actionBefore,
        `${client.name} state after duplicate command`,
      )));
      selected.client.send(duplicatePayload);
      selected.client.send(duplicatePayload);
      const duplicateStates = await duplicateState;
      await waitUntil(async () => (await pool.query(
        "SELECT command_id FROM room_commands WHERE room_code = $1 AND command_id = $2",
        [code, duplicateId],
      )).rows.length === 1, `game ${game.index} duplicate receipt`);
      await delay(50);
      const duplicateRoomVersion = Number(rowObject((await pool.query(
        "SELECT version FROM rooms WHERE code = $1",
        [code],
      )).rows[0], `game ${game.index} duplicate room`).version);
      const duplicateFrames = Number(rowObject((await pool.query(
        `SELECT COUNT(*) AS count FROM replay_frames f
         JOIN replay_games g ON g.id = f.replay_id
         WHERE g.room_code = $1 AND f.room_version = $2`,
        [code, actionBefore + 1],
      )).rows[0], `game ${game.index} duplicate replay frames`).count);
      if (duplicateRoomVersion !== actionBefore + 1
        || duplicateStates.some((state) => state.version !== actionBefore + 1)
        || duplicateFrames !== 1) {
        throw new Error(
          `duplicate command produced room v${duplicateRoomVersion}, client versions `
          + `${duplicateStates.map((state) => state.version).join("/")}, and ${duplicateFrames} replay frames`,
        );
      }
      game.lastActor = selected.client;
      result.crossGatewayRaces += game.host.gatewayIndex === game.guest.gatewayIndex ? 0 : 1;
      result.staleCommandsRejected += 1;
      result.retriesCommitted += 1;
      result.duplicateCommandsDeduplicated += 1;
    } catch (error) {
      result.errors.push(`game ${game.index}: ${(error as Error).message}`);
    }
  });
  return result;
}

interface LongReplayResult {
  game: GameSession;
  frames: number;
  commits: number;
  elapsedMs: number;
}

async function replayFrameCount(
  pool: Awaited<ReturnType<typeof createPool>>,
  game: GameSession,
): Promise<number> {
  if (!game.host.roomCode) throw new Error(`game ${game.index} has no room code`);
  const result = await pool.query(
    `SELECT COUNT(*) AS frames
     FROM replay_frames f
     JOIN replay_games g ON g.id = f.replay_id
     WHERE g.room_code = $1 AND g.status = 'recording'`,
    [game.host.roomCode],
  );
  const frames = Number(rowObject(result.rows[0], "replay frame count").frames);
  if (!Number.isSafeInteger(frames) || frames < 1) {
    throw new Error(`game ${game.index} had invalid replay frame count ${frames}`);
  }
  return frames;
}

/** Build a long replay through ordinary protocol operations. Alternating a
 * legal action with undo keeps the game alive while each committed state is
 * still recorded and later serialized by the production finalizer. */
async function buildLongReplay(
  pool: Awaited<ReturnType<typeof createPool>>,
  game: GameSession,
  targetFrames: number,
): Promise<LongReplayResult> {
  let frames = await replayFrameCount(pool, game);
  let commits = 0;
  const startedAt = performance.now();
  const commitIntervalMs = 1_000 / config.longReplayCommitsPerSecond;
  let nextCommitAt = startedAt;
  const paceCommit = async (): Promise<void> => {
    const wait = nextCommitAt - performance.now();
    if (wait > 0) await delay(wait);
    nextCommitAt = performance.now() + commitIntervalMs;
  };
  let nextProgress = Math.ceil((frames + 1) / 100) * 100;
  while (frames < targetFrames) {
    await paceCommit();
    const applied = await applyOneAction(game);
    if (applied.error) throw new Error(`long replay game ${game.index}: ${applied.error}`);
    frames += 1;
    commits += 1;
    if (frames < targetFrames) {
      const lastActor = game.lastActor;
      if (!lastActor) throw new Error(`long replay game ${game.index} lost its last actor`);
      // Either player may undo. Use the peer so a synthetic tight loop does
      // not trip the production per-socket message-rate guard.
      const actor = lastActor === game.host ? game.guest : game.host;
      const beforeVersion = Math.max(
        game.host.latestState?.version ?? 0,
        game.guest.latestState?.version ?? 0,
      );
      await paceCommit();
      const state = await actor.request(
        { type: "undo", ...commandFields(actor) },
        (message): message is StateMessage => message.type === "state" && message.version > beforeVersion,
        "long replay undo state",
      );
      await synchronizePlayers(game, state.version, "long replay peer state after undo");
      frames += 1;
      commits += 1;
    }
    if (frames >= nextProgress) {
      console.log(`long replay game ${game.index}: ${Math.min(frames, targetFrames)}/${targetFrames} frames`);
      nextProgress += 100;
    }
  }
  const storedFrames = await replayFrameCount(pool, game);
  if (storedFrames < targetFrames) {
    throw new Error(`long replay game ${game.index} stored ${storedFrames}/${targetFrames} frames`);
  }
  return { game, frames: storedFrames, commits, elapsedMs: performance.now() - startedAt };
}

interface FinishResult extends ReplayFinalizationSample {
  game: GameSession;
  stateLatencyMs: number;
}

async function finishGame(game: GameSession): Promise<FinishResult> {
  const selected = [game.host, game.guest]
    .map((client) => ({
      client,
      intent: client.latestState?.legal.find((intent) => intent.kind === "concede"),
    }))
    .find((candidate) => candidate.intent);
  const dispatchedAt = performance.now();
  if (!selected?.intent) {
    return {
      game,
      roomCode: game.host.roomCode,
      replayFinalizationLatencyMs: 0,
      stateLatencyMs: 0,
      dispatchedAt,
      error: "no legal concede intent",
    };
  }
  const beforeVersion = Math.max(
    game.host.latestState?.version ?? 0,
    game.guest.latestState?.version ?? 0,
  );
  try {
    const state = await selected.client.request(
      { type: "intent", intent: selected.intent, ...commandFields(selected.client) },
      (message): message is StateMessage => message.type === "state" && message.version > beforeVersion,
      "completed state after concede",
    );
    if (state.view.winner === null) throw new Error("concede did not finish the game");
    const stateLatencyMs = performance.now() - dispatchedAt;
    return {
      game,
      roomCode: game.host.roomCode,
      replayFinalizationLatencyMs: stateLatencyMs,
      stateLatencyMs,
      dispatchedAt,
    };
  } catch (error) {
    const stateLatencyMs = performance.now() - dispatchedAt;
    return {
      game,
      roomCode: game.host.roomCode,
      replayFinalizationLatencyMs: stateLatencyMs,
      stateLatencyMs,
      dispatchedAt,
      error: (error as Error).message,
    };
  }
}

async function finishGamesAtRate(
  games: readonly GameSession[],
  onFinished: (result: FinishResult) => void,
): Promise<FinishResult[]> {
  const results: FinishResult[] = [];
  const inFlight = new Set<Promise<void>>();
  const intervalMs = 1_000 / config.finishRate;
  const startedAt = performance.now();
  const endsAt = startedAt + config.finishDurationSeconds * 1_000;
  let nextAt = startedAt;
  for (const game of games) {
    if (nextAt >= endsAt) break;
    const wait = nextAt - performance.now();
    if (wait > 0) await delay(wait);
    const running = finishGame(game)
      .then((result) => {
        results.push(result);
        onFinished(result);
      })
      .finally(() => { inFlight.delete(running); });
    inFlight.add(running);
    nextAt += intervalMs;
  }
  await Promise.all(inFlight);
  return results.sort((left, right) => left.dispatchedAt - right.dispatchedAt);
}

function replayFinalizationMonitor(pool: Awaited<ReturnType<typeof createPool>>) {
  return createReplayFinalizationMonitor({
    requestTimeoutMs: config.requestTimeoutMs,
    readReadyRoomCodes: async (roomCodes) => {
    const { rows } = await pool.query(
      `SELECT room_code, status FROM replay_games
       WHERE room_code = ANY($1::text[])`,
        [roomCodes],
    );
      const ready = new Set<string>();
    for (const value of rows as unknown[]) {
      const row = rowObject(value, "replay finalization status");
      if (typeof row.room_code !== "string" || typeof row.status !== "string") {
        throw new Error("invalid replay finalization status row");
      }
        if (row.status === "ready") ready.add(row.room_code);
    }
      return ready;
    },
  });
}

interface StoredReplayResult {
  payloadBytes: number;
  errors: string[];
}

async function validateStoredReplays(
  pool: Awaited<ReturnType<typeof createPool>>,
  games: readonly GameSession[],
): Promise<StoredReplayResult> {
  const roomCodes = games.map((game) => game.host.roomCode).filter((code): code is string => code !== null);
  const { rows } = await pool.query(
    `SELECT g.room_code, g.status, g.frame_count,
            COUNT(p.user_id) AS participants,
            COUNT(p.payload) AS payloads,
            COALESCE(SUM(p.payload_bytes), 0) AS payload_bytes
     FROM replay_games g
     LEFT JOIN replay_participants p ON p.replay_id = g.id
     WHERE g.room_code = ANY($1::text[])
     GROUP BY g.id, g.room_code, g.status, g.frame_count`,
    [roomCodes],
  );
  const errors: string[] = [];
  let payloadBytes = 0;
  const found = new Set<string>();
  for (const [index, value] of (rows as unknown[]).entries()) {
    const row = rowObject(value, `stored replay ${index}`);
    const roomCode = String(row.room_code);
    const frames = Number(row.frame_count);
    const participants = Number(row.participants);
    const payloads = Number(row.payloads);
    const bytes = Number(row.payload_bytes);
    found.add(roomCode);
    payloadBytes += bytes;
    if (row.status !== "ready") errors.push(`${roomCode}: status is ${String(row.status)}`);
    if (!Number.isSafeInteger(frames) || frames < 1) errors.push(`${roomCode}: invalid frame count ${frames}`);
    if (participants !== 2 || payloads !== 2) {
      errors.push(`${roomCode}: stored ${payloads}/${participants} replay payloads`);
    }
    if (!Number.isSafeInteger(bytes) || bytes < 1) errors.push(`${roomCode}: invalid payload bytes ${bytes}`);
  }
  for (const roomCode of roomCodes) {
    if (!found.has(roomCode)) errors.push(`${roomCode}: replay row is missing`);
  }
  return { payloadBytes, errors };
}

async function fetchRoomReplay(game: GameSession): Promise<{ frames: number; latencyMs: number }> {
  const code = game.host.roomCode;
  const token = game.host.sessionToken;
  if (!code || !token) throw new Error(`game ${game.index} cannot retrieve its replay`);
  const startedAt = performance.now();
  const retrievalGateway = (game.host.gatewayIndex + 1) % config.appUrls.length;
  const response = await fetch(`${config.appUrls[retrievalGateway]}/api/replays/room/${code}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const value: unknown = await response.json();
  const decoded = decodeReplayResponse(value);
  if (!response.ok || !decoded) {
    throw new Error(`game ${game.index} replay endpoint returned ${response.status}`);
  }
  return { frames: decoded.replay.views.length, latencyMs: performance.now() - startedAt };
}

async function databaseSnapshot(pool: Awaited<ReturnType<typeof createPool>>) {
  const stats = await pool.query(
    `SELECT xact_commit, xact_rollback, blks_read, blks_hit, temp_files, temp_bytes, deadlocks
     FROM pg_stat_database WHERE datname = current_database()`,
  );
  return rowObject(stats.rows[0], "pg_stat_database");
}

async function statementSnapshot(pool: Awaited<ReturnType<typeof createPool>>): Promise<{
  calls: number;
  totalExecTime: number;
}> {
  const result = await pool.query(
    `SELECT COALESCE(SUM(calls), 0) AS calls,
            COALESCE(SUM(total_exec_time), 0) AS total_exec_time
     FROM pg_stat_statements
     WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`,
  );
  const row = rowObject(result.rows[0], "pg_stat_statements");
  return { calls: Number(row.calls), totalExecTime: Number(row.total_exec_time) };
}

function delta(after: Record<string, unknown>, before: Record<string, unknown>, field: string): number {
  return Number(after[field] ?? 0) - Number(before[field] ?? 0);
}

const pool = await createPool(config.databaseUrl);
const allClients: LoadClient[] = [];
try {
  await Promise.all(config.appUrls.map(async (appUrl, index) => {
    const health = await fetch(`${appUrl}/api/health`);
    if (!health.ok) throw new Error(`gateway ${index} health check returned ${health.status}`);
  }));
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  console.log(`using ${config.appUrls.length} gateway endpoints: ${config.appUrls.join(", ")}`);
  console.log(`seeding ${config.games * 2} synthetic sessions in fyendal_perf`);
  const sessions = await seedSessions(pool, config.games * 2);
  const indices = Array.from({ length: config.games }, (_, index) => index);
  const matchmakingIndices = indices.slice(0, config.matchmakingPairs);
  const directIndices = indices.slice(config.matchmakingPairs);
  // Keep pairs isolated while deliberately racing their two queue submissions;
  // otherwise FIFO may correctly cross-pair workers and obscure pair-level
  // assertions in this harness.
  const matchmadeGames = await mapConcurrent(matchmakingIndices, 1, async (_, index) => {
    const gameIndex = matchmakingIndices[index]!;
    const game = await setupGame(
      gameIndex,
      sessions[gameIndex * 2]!,
      sessions[gameIndex * 2 + 1]!,
      true,
    );
    allClients.push(game.host, game.guest);
    return game;
  }, "matchmade games");
  const directGames = await mapConcurrent(directIndices, config.setupConcurrency, async (_, index) => {
    const gameIndex = directIndices[index]!;
    const game = await setupGame(gameIndex, sessions[gameIndex * 2]!, sessions[gameIndex * 2 + 1]!);
    allClients.push(game.host, game.guest);
    return game;
  }, "direct games");
  const games = [...matchmadeGames, ...directGames].sort((left, right) => left.index - right.index);
  const distinctRooms = new Set(games.map((game) => game.host.roomCode));
  if (distinctRooms.size !== games.length || distinctRooms.has(null)) {
    throw new Error(`setup produced ${distinctRooms.size} distinct rooms for ${games.length} games`);
  }
  const queuedRows = Number(rowObject((await pool.query(
    "SELECT COUNT(*) AS count FROM matchmaking_entries WHERE user_id = ANY($1::integer[])",
    [sessions.map((session) => session.userId)],
  )).rows[0], "remaining matchmaking entries").count);
  if (queuedRows !== 0) throw new Error(`setup left ${queuedRows} durable matchmaking entries`);

  const correctness = await validateConcurrencyCorrectness(
    pool,
    games.slice(0, config.correctnessGames),
  );
  console.log("\nmulti-instance concurrency correctness");
  console.table({
    games_checked: correctness.games,
    cross_gateway_races: correctness.crossGatewayRaces,
    stale_commands_rejected: correctness.staleCommandsRejected,
    fenced_retries_committed: correctness.retriesCommitted,
    duplicate_commands_deduplicated: correctness.duplicateCommandsDeduplicated,
    correctness_errors: correctness.errors.length,
  });

  const reconnectCount = Math.min(games.length, Math.ceil(games.length * config.reconnectPercent / 100));
  for (const game of games.slice(0, reconnectCount)) {
    const old = game.guest;
    await reconnectGuest(game);
    allClients.push(game.guest);
    const oldIndex = allClients.indexOf(old);
    if (oldIndex !== -1) allClients.splice(oldIndex, 1);
  }
  console.log(`validated ${reconnectCount} seat reconnects`);

  const spectators = await mapConcurrent(
    Array.from({ length: config.spectators }, (_, index) => index),
    Math.min(8, config.setupConcurrency),
    async (index) => addSpectator(games[index % games.length]!, index),
  );
  allClients.push(...spectators);
  console.log(`attached ${spectators.length} spectators; ${allClients.length} sockets are live`);

  await pool.query("SELECT pg_stat_statements_reset()");
  const beforeDb = await databaseSnapshot(pool);
  const measurementStartedAt = performance.now();
  console.log(
    `driving ${config.games} games for ${config.durationSeconds}s with `
      + `${config.actionThinkSeconds}s action / ${config.passThinkSeconds}s pass think times`,
  );
  const actionResults = await driveActions(games);
  const measuredSeconds = (performance.now() - measurementStartedAt) / 1_000;
  const afterDb = await databaseSnapshot(pool);
  const actionStatements = await statementSnapshot(pool);
  const calls = actionStatements.calls;
  const databaseQps = calls / measuredSeconds;
  const successes = actionResults.filter((result) => !result.error);
  const actionErrors = actionResults.flatMap((result) => result.error ? [result.error] : []);
  const passActions = successes.filter((result) => result.intentKind === "pass").length;
  const ordinaryActions = successes.length - passActions;
  const latencies = successes.map((result) => result.latencyMs).sort((a, b) => a - b);
  const undoErrors = await validateUndo(games);
  const cacheReads = delta(afterDb, beforeDb, "blks_read");
  const cacheHits = delta(afterDb, beforeDb, "blks_hit");
  const cacheHitRate = cacheReads + cacheHits === 0 ? 1 : cacheHits / (cacheReads + cacheHits);
  console.log("\nlocal performance result");
  console.table({
    gateways: config.appUrls.length,
    games: config.games,
    cross_gateway_games: games.filter((game) => game.host.gatewayIndex !== game.guest.gatewayIndex).length,
    matchmade_games: matchmadeGames.length,
    sockets: allClients.length,
    actions_attempted: actionResults.length,
    actions_succeeded: successes.length,
    ordinary_actions: ordinaryActions,
    pass_actions: passActions,
    action_errors: actionErrors.length,
    action_think_seconds: config.actionThinkSeconds,
    pass_think_seconds: config.passThinkSeconds,
    measured_seconds: Number(measuredSeconds.toFixed(2)),
    database_statements: calls,
    database_execution_ms: Number(actionStatements.totalExecTime.toFixed(1)),
    database_qps: Number(databaseQps.toFixed(2)),
    statements_per_successful_action: Number((calls / Math.max(1, successes.length)).toFixed(2)),
    latency_p50_ms: Number(percentile(latencies, 0.50).toFixed(1)),
    latency_p95_ms: Number(percentile(latencies, 0.95).toFixed(1)),
    latency_p99_ms: Number(percentile(latencies, 0.99).toFixed(1)),
    transactions_committed: delta(afterDb, beforeDb, "xact_commit"),
    transactions_rolled_back: delta(afterDb, beforeDb, "xact_rollback"),
    cache_hit_percent: Number((cacheHitRate * 100).toFixed(2)),
    temp_files: delta(afterDb, beforeDb, "temp_files"),
    deadlocks: delta(afterDb, beforeDb, "deadlocks"),
    reconnects_validated: reconnectCount,
    undos_validated: Math.min(10, games.filter((game) => game.lastActor).length) - undoErrors.length,
  });

  const activeGames = games.filter((game) => game.host.latestState?.view.winner === null);
  const finishGames = activeGames.slice(0, config.finishGames);
  const longReplayGames = config.longReplayFrames > 0
    ? finishGames.slice(0, config.longReplayGames)
    : [];
  const longReplayResults = await mapConcurrent(
    longReplayGames,
    Math.max(1, longReplayGames.length),
    (game) => buildLongReplay(pool, game, config.longReplayFrames),
  );
  if (longReplayResults.length) {
    console.log("\nlong replay construction");
    console.table({
      games: longReplayResults.length,
      target_frames: config.longReplayFrames,
      stored_frames_min: Math.min(...longReplayResults.map((result) => result.frames)),
      state_commits: longReplayResults.reduce((sum, result) => sum + result.commits, 0),
      elapsed_seconds_max: Number((Math.max(...longReplayResults.map((result) => result.elapsedMs)) / 1_000).toFixed(2)),
    });
  }

  await pool.query("SELECT pg_stat_statements_reset()");
  const beforeFinishDb = await databaseSnapshot(pool);
  const finishStartedAt = performance.now();
  console.log(
    `finishing ${finishGames.length} games at ${config.finishRate}/s `
      + `for up to ${config.finishDurationSeconds}s`,
  );
  const replayMonitor = replayFinalizationMonitor(pool);
  const finishResults = await finishGamesAtRate(finishGames, (result) => replayMonitor.track(result));
  await replayMonitor.finish();
  const finishSeconds = (performance.now() - finishStartedAt) / 1_000;
  const afterFinishDb = await databaseSnapshot(pool);
  const finishStatements = await statementSnapshot(pool);
  const finishSuccesses = finishResults.filter((result) => !result.error);
  const finishErrors = finishResults.flatMap((result) => result.error ? [result.error] : []);
  const replayFinalizationLatencies = finishSuccesses
    .map((result) => result.replayFinalizationLatencyMs)
    .sort((a, b) => a - b);
  const finishStateLatencies = finishSuccesses.map((result) => result.stateLatencyMs).sort((a, b) => a - b);
  const dispatchTimes = finishResults.map((result) => result.dispatchedAt);
  const dispatchSpanMs = dispatchTimes.length
    ? Math.max(...dispatchTimes) - Math.min(...dispatchTimes)
    : 0;
  const dispatchRate = dispatchTimes.length > 1 && dispatchSpanMs > 0
    ? (dispatchTimes.length - 1) / (dispatchSpanMs / 1_000)
    : dispatchTimes.length;
  const storedReplays = await validateStoredReplays(pool, finishGames);
  const replayErrors = [...storedReplays.errors];
  const retrievals: Array<{ frames: number; latencyMs: number }> = [];
  for (const result of longReplayResults) {
    try {
      const retrieved = await fetchRoomReplay(result.game);
      retrievals.push(retrieved);
      if (retrieved.frames < config.longReplayFrames) {
        replayErrors.push(
          `game ${result.game.index}: retrieved ${retrieved.frames}/${config.longReplayFrames} frames`,
        );
      }
    } catch (error) {
      replayErrors.push((error as Error).message);
    }
  }
  const finishCacheReads = delta(afterFinishDb, beforeFinishDb, "blks_read");
  const finishCacheHits = delta(afterFinishDb, beforeFinishDb, "blks_hit");
  const finishCacheHitRate = finishCacheReads + finishCacheHits === 0
    ? 1
    : finishCacheHits / (finishCacheReads + finishCacheHits);

  console.log("\npaced game completion and replay result");
  console.table({
    games_requested: config.finishGames,
    games_dispatched: finishResults.length,
    games_finished: finishSuccesses.length,
    finish_errors: finishErrors.length,
    target_finishes_per_second: config.finishRate,
    finish_duration_seconds: config.finishDurationSeconds,
    dispatch_span_ms: Number(dispatchSpanMs.toFixed(1)),
    dispatches_per_second: Number(dispatchRate.toFixed(2)),
    completion_wall_seconds: Number(finishSeconds.toFixed(2)),
    completions_per_second: Number((finishSuccesses.length / Math.max(finishSeconds, 0.001)).toFixed(2)),
    replay_finalization_latency_p50_ms: Number(percentile(replayFinalizationLatencies, 0.50).toFixed(1)),
    replay_finalization_latency_p95_ms: Number(percentile(replayFinalizationLatencies, 0.95).toFixed(1)),
    replay_finalization_latency_p99_ms: Number(percentile(replayFinalizationLatencies, 0.99).toFixed(1)),
    winning_state_latency_p95_ms: Number(percentile(finishStateLatencies, 0.95).toFixed(1)),
    database_statements: finishStatements.calls,
    database_execution_ms: Number(finishStatements.totalExecTime.toFixed(1)),
    database_qps: Number((finishStatements.calls / Math.max(finishSeconds, 0.001)).toFixed(2)),
    transactions_committed: delta(afterFinishDb, beforeFinishDb, "xact_commit"),
    transactions_rolled_back: delta(afterFinishDb, beforeFinishDb, "xact_rollback"),
    cache_hit_percent: Number((finishCacheHitRate * 100).toFixed(2)),
    temp_files: delta(afterFinishDb, beforeFinishDb, "temp_files"),
    deadlocks: delta(afterFinishDb, beforeFinishDb, "deadlocks"),
    replay_payload_megabytes: Number((storedReplays.payloadBytes / 1_048_576).toFixed(2)),
    long_replays_retrieved: retrievals.length,
    retrieved_frames_min: retrievals.length ? Math.min(...retrievals.map((result) => result.frames)) : 0,
    replay_retrieval_p95_ms: Number(percentile(
      retrievals.map((result) => result.latencyMs).sort((a, b) => a - b),
      0.95,
    ).toFixed(1)),
    replay_validation_errors: replayErrors.length,
  });

  const clientFailures = allClients.flatMap((client) => client.failures);
  if (actionErrors.length) console.error("action errors:", actionErrors.slice(0, 10));
  if (undoErrors.length) console.error("undo errors:", undoErrors.slice(0, 10));
  if (finishErrors.length) console.error("finish errors:", finishErrors.slice(0, 10));
  if (replayErrors.length) console.error("replay errors:", replayErrors.slice(0, 10));
  if (correctness.errors.length) console.error("correctness errors:", correctness.errors.slice(0, 10));
  if (clientFailures.length) console.error("client errors:", clientFailures.slice(0, 10));
  if (activeGames.length < config.finishGames) {
    console.error(`only ${activeGames.length}/${config.finishGames} requested games remained active for paced finishes`);
    process.exitCode = 1;
  }
  if (correctness.errors.length
    || actionErrors.length
    || undoErrors.length
    || finishErrors.length
    || replayErrors.length
    || clientFailures.length) {
    process.exitCode = 1;
  }
} finally {
  await Promise.allSettled(allClients.map((client) => client.close()));
  await pool.end();
}
