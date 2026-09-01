import http from "node:http";
import { promisify } from "node:util";
import { gunzip as gunzipCallback } from "node:zlib";
import type { DeckPool, Format } from "@fyendal/shared";
import { cardData, formatLegalityIssues } from "@fyendal/cards";
import type { Queryable } from "./db.js";
import {
  login,
  register,
  revokeAllSessions,
  revokeSession,
  sessionForToken,
  type AuthUser,
} from "./auth.js";
import { deleteDeck, getDeck, importDeck, listDecks, resolveFreshDeck, updateDeck } from "./decks.js";
import { clientIp, configuredTrustedProxyHops } from "./network.js";
import {
  deleteAccount,
  exportAccount,
  getAccountBadges,
  selectAccountBadge,
} from "./accounts.js";
import {
  createBugReport,
  dismissFixedBugReportNotifications,
  listFixedBugReportNotifications,
} from "./bugReports.js";
import { consoleError } from "./logging.js";
import { asRecord } from "./validation.js";
import {
  deleteReplay,
  getReplayPayload,
  listReplays,
  waitForReplayPayloadForRoom,
} from "./replays.js";
import { createFabraryClient, parseFabraryDeckUrl, type FabraryClient } from "./fabrary.js";

const BODY_LIMIT = 16 * 1024; // 16kb cap on JSON bodies (decklist exports)
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_MAX = 10; // requests per window per (IP, endpoint)
const gunzip = promisify(gunzipCallback);

export interface RateLimiter {
  /** true when the request may proceed; false when the limit is hit */
  allow(ip: string, endpoint: string): boolean | Promise<boolean>;
  reset(): void | Promise<void>;
  /** Exposed for bounded-memory regression tests and diagnostics. */
  bucketCount(): number | Promise<number>;
}

/** In-memory fixed-window rate limiter per (IP, endpoint). */
export function createRateLimiter(
  max = RATE_MAX,
  windowMs = RATE_WINDOW_MS,
  maxBuckets = 10_000,
): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const bucketCap = Number.isFinite(maxBuckets) && maxBuckets > 0
    ? Math.floor(maxBuckets)
    : 10_000;
  let operations = 0;

  const prune = (now: number): void => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  return {
    allow(ip, endpoint) {
      const key = `${ip}:${endpoint}`;
      const now = Date.now();
      operations += 1;
      if (operations % 256 === 0) prune(now);
      let b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        if (!b) {
          prune(now);
          while (buckets.size >= bucketCap) {
            const oldest = buckets.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            buckets.delete(oldest);
          }
        }
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(key, b);
      }
      b.count += 1;
      return b.count <= max;
    },
    reset() {
      buckets.clear();
    },
    bucketCount() {
      return buckets.size;
    },
  };
}

export interface ApiDeps {
  db: Queryable;
  /** Exact browser origin allowed to call the API. Null permits non-browser clients only. */
  appOrigin?: string | null;
  /** Number of rightmost proxy hops trusted to have appended XFF. Default 0. */
  trustedProxyHops?: number;
  rateLimiter?: RateLimiter;
  /** Separate limiter keyed by normalized login name, preventing IP rotation. */
  accountRateLimiter?: RateLimiter;
  /** separate throttle for GET /api/stats (defaults: 60 per 10 min per IP) */
  statsRateLimiter?: RateLimiter;
  /** live lobby stats for the logged-out landing view (queue depth is held by
   *  the ws gateway, so it's injected rather than queried) */
  stats?: () => Promise<Record<string, unknown>>;
  /** Injectable for tests; production reads FABRARY_API_SECRET server-side. */
  fabraryClient?: FabraryClient;
  /** Lets the WebSocket gateway immediately close sockets for a revoked token. */
  onSessionRevoked?: (token: string) => void;
  /** Lets the gateway close every live socket belonging to an account. */
  onUserSessionsRevoked?: (userId: number) => void;
  /** Tell the local gateway which account-deletion room removals committed. */
  onRoomsDeleted?: (rooms: Array<{ code: string; version: number }>) => Promise<void> | void;
}

type ApiResult = { status: number; body: Record<string, unknown> };

function sendJson(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function appendVary(res: http.ServerResponse, value: string): void {
  const current = res.getHeader("Vary");
  const values = (Array.isArray(current) ? current : current ? [String(current)] : [])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) values.push(value);
  res.setHeader("Vary", values.join(", "));
}

function acceptsGzip(value: string | undefined): boolean {
  let wildcard: number | null = null;
  for (const item of (value ?? "").split(",")) {
    const [rawCoding, ...parameters] = item.trim().split(";");
    const coding = rawCoding?.trim().toLowerCase();
    if (!coding) continue;
    let quality = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(parameter);
      if (match) {
        const parsed = Number(match[1]);
        quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
      }
    }
    if (coding === "gzip") return quality > 0;
    if (coding === "*") wildcard = quality;
  }
  return (wildcard ?? 0) > 0;
}

function sendJsonBytes(
  res: http.ServerResponse,
  status: number,
  body: Buffer,
  contentEncoding?: "gzip",
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Content-Length": body.length,
    ...(contentEncoding ? { "Content-Encoding": contentEncoding } : {}),
  });
  res.end(body);
}

async function sendStoredReplay(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  payload: Buffer,
): Promise<void> {
  appendVary(res, "Accept-Encoding");
  if (acceptsGzip(req.headers["accept-encoding"])) {
    sendJsonBytes(res, 200, payload, "gzip");
    return;
  }
  sendJsonBytes(res, 200, await gunzip(payload));
}

function secureResponse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  appOrigin: string | null,
): boolean {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("X-Frame-Options", "DENY");
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!appOrigin || origin !== appOrigin) {
    sendJson(res, 403, { ok: false, error: "origin not allowed" });
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", appOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return true;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new ClientError("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ClientError("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Errors whose message is safe/intended for the client (bad input). Anything
 *  else from a handler is an internal failure: log it, answer generically. */
class ClientError extends Error {}

/** Log the real error, send a generic one — internal messages (pg error text,
 *  schema details) must never reach clients. */
function internalError(res: http.ServerResponse, e: unknown): void {
  consoleError("api error", e);
  sendJson(res, 500, { ok: false, error: "internal error" });
}

function field(body: unknown, name: string): string {
  const v = asRecord(body)?.[name];
  return typeof v === "string" ? v : "";
}

function valueField(body: unknown, name: string): unknown {
  return asRecord(body)?.[name];
}

const DECK_FORMATS: Format[] = ["cc", "silver-age"];

function deckOut(d: {
  id: string; name: string; format: Format; fabraryUrl: string | null;
  heroName: string; decklist: DeckPool; updatedAt: number;
}): Record<string, unknown> {
  const legality = formatLegalityIssues(cardData, d.decklist, d.format);
  const bannedCards = [...new Set(
    legality.filter((issue) => issue.kind !== "future-card").map((issue) => issue.cardName),
  )];
  const futureCards = [...new Set(
    legality.filter((issue) => issue.kind === "future-card").map((issue) => issue.cardName),
  )];
  return {
    id: d.id,
    name: d.name,
    format: d.format,
    fabraryUrl: d.fabraryUrl,
    heroName: d.heroName,
    // registered pool size: weapons + equipment + fixed inventory + main + sideboard
    deckSize:
      d.decklist.weaponIds.length +
      d.decklist.equipmentPool.length +
      (d.decklist.inventoryPool?.length ?? 0) +
      d.decklist.deck.length +
      (d.decklist.sideboard?.length ?? 0),
    updatedAt: d.updatedAt,
    ...(bannedCards.length > 0 ? { bannedCards } : {}),
    ...(futureCards.length > 0 ? { futureCards } : {}),
  };
}

/** POST-only JSON auth+decks API; also the HTTP server the WebSocketServer attaches to. */
export function createApiServer(deps: ApiDeps): http.Server {
  const appOrigin = deps.appOrigin !== undefined
    ? deps.appOrigin
    : (process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : null);
  const trustedProxyHops = deps.trustedProxyHops ?? configuredTrustedProxyHops();
  const limiter = deps.rateLimiter ?? createRateLimiter();
  const accountLimiter = deps.accountRateLimiter ?? createRateLimiter();
  const fabraryClient = deps.fabraryClient ?? createFabraryClient();
  // /api/stats is public and hits the DB — throttle it separately from the
  // auth limiter (the logged-out landing polls it every 30s, so the budget
  // is generous). /api/health stays unlimited: Cloud Run probes depend on it.
  const statsLimiter =
    deps.statsRateLimiter ??
    createRateLimiter(
      Number(process.env.STATS_RATE_MAX ?? 60),
      Number(process.env.STATS_RATE_WINDOW_MS ?? RATE_WINDOW_MS),
    );

  const bearerToken = (req: http.IncomingMessage): string | null => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    return m?.[1] ?? null;
  };

  const authUser = async (req: http.IncomingMessage): Promise<AuthUser | null> => {
    const token = bearerToken(req);
    return token ? sessionForToken(deps.db, token) : null;
  };

  const routes: Record<
    string,
    (body: unknown, user: AuthUser | null, token: string | null) => Promise<ApiResult>
  > = {
    "/api/register": async (body) => {
      const username = field(body, "username");
      const password = field(body, "password");
      const r = await register(deps.db, username, password);
      if (!r.ok) return { status: 400, body: { ok: false, error: r.error } };
      return { status: 200, body: { ok: true } };
    },
    "/api/login": async (body) => {
      const username = field(body, "username");
      const accountKey = username.trim().toLowerCase() || "<empty>";
      if (!(await accountLimiter.allow(accountKey, "/api/login"))) {
        return { status: 429, body: { ok: false, error: "too many attempts, try again later" } };
      }
      const r = await login(deps.db, username, field(body, "password"));
      if (!r.ok) return { status: 401, body: { ok: false, error: r.error } };
      return {
        status: 200,
        body: { ok: true, token: r.token, username: r.username },
      };
    },
    "/api/logout": async (_body, user, token) => {
      if (!user || !token) return { status: 401, body: { ok: false, error: "not logged in" } };
      await revokeSession(deps.db, token);
      await deps.onSessionRevoked?.(token);
      return { status: 200, body: { ok: true } };
    },
    "/api/logout-all": async (_body, user) => {
      if (!user) return { status: 401, body: { ok: false, error: "not logged in" } };
      await revokeAllSessions(deps.db, user.id);
      await deps.onUserSessionsRevoked?.(user.id);
      return { status: 200, body: { ok: true } };
    },
    "/api/account/delete": async (body, user) => {
      if (!user) return { status: 401, body: { ok: false, error: "not logged in" } };
      const result = await deleteAccount(deps.db, user.id, field(body, "password"));
      if (result.status === "invalid-password") {
        return { status: 403, body: { ok: false, error: "invalid password" } };
      }
      if (result.status === "not-found") {
        return { status: 404, body: { ok: false, error: "account not found" } };
      }
      await deps.onUserSessionsRevoked?.(user.id);
      await deps.onRoomsDeleted?.(result.deletedRooms);
      return { status: 200, body: { ok: true } };
    },
    "/api/account/badge": async (body, user) => {
      if (!user) return { status: 401, body: { ok: false, error: "not logged in" } };
      const result = await selectAccountBadge(deps.db, user.id, valueField(body, "badge"));
      if (!result.ok) {
        return {
          status: result.error === "account not found" ? 404 : 400,
          body: { ok: false, error: result.error },
        };
      }
      return { status: 200, body: { ok: true, ...result.preferences } };
    },
    "/api/bug-reports": async (body, user) => {
      if (!user) return { status: 401, body: { ok: false, error: "not logged in" } };
      const result = await createBugReport(
        deps.db,
        user.id,
        field(body, "roomCode"),
        field(body, "description"),
      );
      if (!result.ok) {
        return result.error === "invalid description"
          ? { status: 400, body: { ok: false, error: "describe the bug in 10 to 2000 characters" } }
          : { status: 404, body: { ok: false, error: "room not found" } };
      }
      return { status: 200, body: { ok: true, reportId: result.reportId } };
    },
    "/api/bug-report-notifications/dismiss": async (_body, user) => {
      if (!user) return { status: 401, body: { ok: false, error: "not logged in" } };
      await dismissFixedBugReportNotifications(deps.db, user.id);
      return { status: 200, body: { ok: true } };
    },
    "/api/decks/import": async (body, user) => {
      if (!user) return { status: 401, body: { ok: false, error: "not logged in" } };
      const requestedName = field(body, "name").trim();
      const format = field(body, "format") as Format;
      if (!DECK_FORMATS.includes(format)) {
        return { status: 400, body: { ok: false, error: "format must be cc or silver-age" } };
      }
      let text = field(body, "text");
      let fabraryUrl = field(body, "url").trim() || undefined;
      let name = requestedName || "Imported deck";
      if (!text.trim()) {
        if (!fabraryUrl) {
          return { status: 400, body: { ok: false, error: "enter a Fabrary URL or paste your decklist export" } };
        }
        const fetched = await fabraryClient.fetchDeck(fabraryUrl);
        if (!fetched.ok) return { status: fetched.status, body: { ok: false, error: fetched.error } };
        text = fetched.deck.text;
        fabraryUrl = fetched.deck.canonicalUrl;
        name = requestedName || fetched.deck.name;
      } else if (fabraryUrl) {
        const source = parseFabraryDeckUrl(fabraryUrl);
        if (!source) {
          return { status: 400, body: { ok: false, error: "enter a valid https://fabrary.net/decks/... URL" } };
        }
        fabraryUrl = source.canonicalUrl;
      }
      const r = await importDeck(deps.db, user.id, {
        name,
        format,
        fabraryUrl,
        text,
      });
      if (!r.ok) {
        return { status: 422, body: { ok: false, errors: r.errors, missing: r.missing, unimplemented: r.unimplemented } };
      }
      return { status: 200, body: { ok: true, deck: deckOut(r.deck) } };
    },
    "/api/decks/update": async (body, user) => {
      if (!user) return { status: 401, body: { ok: false, error: "not logged in" } };
      const id = field(body, "id");
      const existing = await getDeck(deps.db, id);
      if (!existing || existing.userId !== user.id) {
        return { status: 404, body: { ok: false, errors: ["deck not found"], missing: [], unimplemented: [] } };
      }

      let text = field(body, "text") || undefined;
      let fabraryUrl = field(body, "url").trim() || undefined;
      if (fabraryUrl) {
        const requestedSource = parseFabraryDeckUrl(fabraryUrl);
        if (!requestedSource) {
          return { status: 400, body: { ok: false, error: "enter a valid https://fabrary.net/decks/... URL" } };
        }
        const existingSource = existing.fabraryUrl
          ? parseFabraryDeckUrl(existing.fabraryUrl)
          : null;
        if (requestedSource.deckId !== existingSource?.deckId) {
          const fetched = await fabraryClient.fetchDeck(fabraryUrl);
          if (!fetched.ok) {
            return { status: fetched.status, body: { ok: false, error: fetched.error } };
          }
          // A changed provider source owns the replacement list. updateDeck
          // resolves and validates it; deckOut then recomputes current ban-list
          // and release-legality flags from the newly saved pool.
          text = fetched.deck.text;
          fabraryUrl = fetched.deck.canonicalUrl;
        } else {
          fabraryUrl = requestedSource.canonicalUrl;
        }
      }

      const r = await updateDeck(deps.db, user.id, id, {
        name: field(body, "name").trim() || undefined,
        fabraryUrl,
        text,
      });
      if (!r.ok) {
        const status = r.code === "DECK_NOT_FOUND" ? 404 : 422;
        return { status, body: { ok: false, errors: r.errors, missing: r.missing, unimplemented: r.unimplemented } };
      }
      return { status: 200, body: { ok: true, deck: deckOut(r.deck) } };
    },
    "/api/decks/delete": async (body, user) => {
      if (!user) return { status: 401, body: { ok: false, error: "not logged in" } };
      const ok = await deleteDeck(deps.db, user.id, field(body, "id"));
      return ok
        ? { status: 200, body: { ok: true } }
        : { status: 404, body: { ok: false, error: "deck not found" } };
    },
    "/api/replays/delete": async (body, user) => {
      if (!user) return { status: 401, body: { ok: false, error: "not logged in" } };
      const ok = await deleteReplay(deps.db, user.id, field(body, "id"));
      return ok
        ? { status: 200, body: { ok: true } }
        : { status: 404, body: { ok: false, error: "replay not found" } };
    },
  };

  return http.createServer((req, res) => {
    if (!secureResponse(req, res, appOrigin)) return;
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    // Liveness/readiness probe (Docker HEALTHCHECK, load balancers): not
    // rate-limited, verifies pool connectivity with a trivial query.
    if (req.method === "GET" && url.pathname === "/api/health") {
      deps.db
        .query("SELECT 1")
        .then(() => sendJson(res, 200, { ok: true }))
        .catch(() => sendJson(res, 503, { ok: false, error: "database unreachable" }));
      return;
    }
    // Public live lobby stats for the logged-out landing view. Rate-limited
    // (separate bucket from auth): it is public and queries the DB.
    if (req.method === "GET" && url.pathname === "/api/stats" && deps.stats) {
      Promise.resolve(statsLimiter.allow(clientIp(req.headers, req.socket.remoteAddress, trustedProxyHops), "/api/stats"))
        .then((allowed) => allowed
          ? deps.stats!().then((s) => sendJson(res, 200, { ok: true, ...s }))
          : sendJson(res, 429, { ok: false, error: "too many attempts, try again later" }))
        .catch((e) => internalError(res, e));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/account/export") {
      const ip = clientIp(req.headers, req.socket.remoteAddress, trustedProxyHops);
      Promise.resolve(limiter.allow(ip, "/api/account/export"))
        .then(async (allowed) => {
          if (!allowed) return sendJson(res, 429, { ok: false, error: "too many attempts, try again later" });
          const user = await authUser(req);
          if (!user) return sendJson(res, 401, { ok: false, error: "not logged in" });
          const data = await exportAccount(deps.db, user.id);
          if (!data) return sendJson(res, 404, { ok: false, error: "account not found" });
          sendJson(res, 200, { ok: true, export: data });
        })
        .catch((e) => internalError(res, e));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/account/badges") {
      authUser(req)
        .then(async (user) => {
          if (!user) return sendJson(res, 401, { ok: false, error: "not logged in" });
          const preferences = await getAccountBadges(deps.db, user.id);
          if (!preferences) return sendJson(res, 404, { ok: false, error: "account not found" });
          sendJson(res, 200, { ok: true, ...preferences });
        })
        .catch((e) => internalError(res, e));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/bug-report-notifications") {
      authUser(req)
        .then(async (user) => {
          if (!user) return sendJson(res, 401, { ok: false, error: "not logged in" });
          const notifications = await listFixedBugReportNotifications(deps.db, user.id);
          sendJson(res, 200, { ok: true, notifications });
        })
        .catch((e) => internalError(res, e));
      return;
    }
    // Deck list: session-authenticated, not rate-limited (read-only).
    if (req.method === "GET" && url.pathname === "/api/decks") {
      authUser(req)
        .then(async (user) => {
          if (!user) return sendJson(res, 401, { ok: false, error: "not logged in" });
          const decks = await listDecks(deps.db, user.id);
          sendJson(res, 200, { ok: true, decks: decks.map(deckOut) });
        })
        .catch((e) => internalError(res, e));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/replays") {
      authUser(req)
        .then(async (user) => {
          if (!user) return sendJson(res, 401, { ok: false, error: "not logged in" });
          sendJson(res, 200, { ok: true, replays: await listReplays(deps.db, user.id) });
        })
        .catch((e) => internalError(res, e));
      return;
    }
    const roomReplayMatch = req.method === "GET"
      ? /^\/api\/replays\/room\/([A-Za-z0-9]+)$/.exec(url.pathname)
      : null;
    if (roomReplayMatch) {
      authUser(req)
        .then(async (user) => {
          if (!user) return sendJson(res, 401, { ok: false, error: "not logged in" });
          const replay = await waitForReplayPayloadForRoom(deps.db, user.id, roomReplayMatch[1]!);
          return replay
            ? sendStoredReplay(req, res, replay)
            : sendJson(res, 404, { ok: false, error: "replay not found" });
        })
        .catch((e) => internalError(res, e));
      return;
    }
    const replayMatch = req.method === "GET"
      ? /^\/api\/replays\/([a-f0-9]+)$/.exec(url.pathname)
      : null;
    if (replayMatch) {
      authUser(req)
        .then(async (user) => {
          if (!user) return sendJson(res, 401, { ok: false, error: "not logged in" });
          const replay = await getReplayPayload(deps.db, user.id, replayMatch[1]!);
          return replay
            ? sendStoredReplay(req, res, replay)
            : sendJson(res, 404, { ok: false, error: "replay not found" });
        })
        .catch((e) => internalError(res, e));
      return;
    }
    // Deck detail (full pool for the prep room): owner-only. Fabrary-linked
    // decks refresh their default list here; matchup selections stay transient.
    const deckMatch = req.method === "GET" ? /^\/api\/decks\/([A-Za-z0-9]+)$/.exec(url.pathname) : null;
    if (deckMatch) {
      authUser(req)
        .then(async (user) => {
          if (!user) return sendJson(res, 401, { ok: false, error: "not logged in" });
          const matchupId = url.searchParams.get("matchupId") ?? undefined;
          const refreshed = await resolveFreshDeck(
            deps.db,
            user.id,
            deckMatch[1]!,
            fabraryClient,
            matchupId,
          );
          if (!refreshed.ok) {
            const detail = [
              ...(refreshed.errors ?? []),
              ...(refreshed.missing?.map((card) => `unknown: ${card}`) ?? []),
              ...(refreshed.unimplemented?.map((card) => `not implemented: ${card}`) ?? []),
            ];
            return sendJson(res, refreshed.status, {
              ok: false,
              error: detail.length > 0 ? `${refreshed.error}: ${detail.join("; ")}` : refreshed.error,
            });
          }
          const { deck, matchups, selectedMatchupId } = refreshed;
          sendJson(res, 200, {
            ok: true,
            deck: {
              ...deckOut(deck),
              decklist: deck.decklist,
              ...(matchups.length > 0 ? { matchups } : {}),
              ...(selectedMatchupId ? { selectedMatchupId } : {}),
            },
          });
        })
        .catch((e) => internalError(res, e));
      return;
    }
    const route = routes[url.pathname];
    if (req.method !== "POST" || !route) {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    const ip = clientIp(req.headers, req.socket.remoteAddress, trustedProxyHops);
    Promise.resolve(limiter.allow(ip, url.pathname))
      .then(async (allowed) => {
        if (!allowed) return { status: 429, body: { ok: false, error: "too many attempts, try again later" } };
        const [body, user] = await Promise.all([readBody(req), authUser(req)]);
        return route(body, user, bearerToken(req));
      })
      .then(({ status, body }) => sendJson(res, status, body))
      .catch((e: unknown) => {
        if (e instanceof ClientError) {
          sendJson(res, 400, { ok: false, error: e.message });
        } else {
          internalError(res, e);
        }
      });
  });
}
