import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { cardData, decklists, precon } from "@fyendal/cards";
import { createApiServer, createRateLimiter, type ApiDeps } from "../http.js";
import { login, register, sessionForToken } from "../auth.js";
import type { Queryable } from "../db.js";
import { finalizeReplay } from "../replays.js";
import { PgRoomStore } from "../store.js";
import { freshDb } from "./testdb.js";

let db: Queryable;
const servers: Server[] = [];

beforeAll(async () => {
  db = await freshDb();
});

afterEach(async () => {
  for (const s of servers.splice(0)) {
    await new Promise<void>((res) => s.close(() => res()));
  }
});

/** Start an API server on an ephemeral port; returns its base URL. */
async function startApi(deps: Partial<ApiDeps> = {}): Promise<string> {
  // Tests model a single directly connected reverse proxy unless overridden.
  const server = createApiServer({
    db,
    trustedProxyHops: 1,
    ...deps,
  });
  servers.push(server);
  await new Promise<void>((res) => server.listen(0, res));
  const { port } = server.address() as AddressInfo;
  return `http://localhost:${port}`;
}

function postLogin(url: string, xff?: string): Promise<Response> {
  return fetch(`${url}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(xff ? { "x-forwarded-for": xff } : {}),
    },
    body: JSON.stringify({ username: "nobody", password: "password1" }),
  });
}

describe("rate limiter client key", () => {
  it("peels only the configured trusted suffix instead of trusting the first XFF value", async () => {
    const url = await startApi({
      trustedProxyHops: 2,
      rateLimiter: createRateLimiter(2, 60_000),
    });
    // unknown user → 401 until the (IP, endpoint) bucket runs out
    expect((await postLogin(url, "spoof-a, 9.9.9.1, 10.0.0.1")).status).toBe(401);
    expect((await postLogin(url, "spoof-b, 9.9.9.1, 10.0.0.2")).status).toBe(401);
    expect((await postLogin(url, "spoof-c, 9.9.9.1, 10.0.0.1")).status).toBe(429);
    expect((await postLogin(url, "spoof-a, 9.9.9.2, 10.0.0.1")).status).toBe(401);
    expect((await postLogin(url)).status).toBe(401); // socket-address bucket unaffected
  });

  it("ignores XFF entirely when no proxy is trusted", async () => {
    const url = await startApi({
      trustedProxyHops: 0,
      rateLimiter: createRateLimiter(2, 60_000),
    });
    expect((await postLogin(url, "9.9.9.1")).status).toBe(401);
    expect((await postLogin(url, "9.9.9.2")).status).toBe(401);
    expect((await postLogin(url, "9.9.9.3")).status).toBe(429);
  });

  it("bounds the number of in-memory rate buckets", () => {
    const limiter = createRateLimiter(10, 60_000, 3);
    for (let i = 0; i < 20; i++) limiter.allow(`192.0.2.${i}`, "/api/login");
    expect(limiter.bucketCount()).toBe(3);
  });

  it("throttles one login name even when attempts rotate IP addresses", async () => {
    const url = await startApi({
      rateLimiter: createRateLimiter(100, 60_000),
      accountRateLimiter: createRateLimiter(2, 60_000),
    });
    expect((await postLogin(url, "9.9.9.1")).status).toBe(401);
    expect((await postLogin(url, "9.9.9.2")).status).toBe(401);
    expect((await postLogin(url, "9.9.9.3")).status).toBe(429);
  });
});

describe("session logout", () => {
  it("revokes the bearer token and notifies the websocket gateway", async () => {
    await register(db, "LogoutUser", "password1");
    const session = await login(db, "logoutuser", "password1");
    if (!session.ok) throw new Error("login failed");
    const revoked: string[] = [];
    const url = await startApi({ onSessionRevoked: (token) => revoked.push(token) });

    const response = await fetch(`${url}/api/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(await sessionForToken(db, session.token)).toBeNull();
    expect(revoked).toEqual([session.token]);
  });

  it("revokes all account sessions and notifies the websocket gateway", async () => {
    await register(db, "LogoutAll", "password1");
    const first = await login(db, "logoutall", "password1");
    const second = await login(db, "logoutall", "password1");
    if (!first.ok || !second.ok) throw new Error("login failed");
    const user = await sessionForToken(db, first.token);
    if (!user) throw new Error("session missing");
    const revokedUsers: number[] = [];
    const url = await startApi({ onUserSessionsRevoked: (userId) => revokedUsers.push(userId) });

    const response = await fetch(`${url}/api/logout-all`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${first.token}`,
      },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(await sessionForToken(db, first.token)).toBeNull();
    expect(await sessionForToken(db, second.token)).toBeNull();
    expect(revokedUsers).toEqual([user.id]);
  });
});

describe("stats rate limit", () => {
  it("throttles /api/stats per IP but never /api/health", async () => {
    const url = await startApi({
      statsRateLimiter: createRateLimiter(2, 60_000),
      stats: async () => ({ inGame: 0, openRooms: 0 }),
    });
    const get = (p: string, ip = "7.7.7.1") =>
      fetch(`${url}${p}`, { headers: { "x-forwarded-for": ip } });

    expect((await get("/api/stats")).status).toBe(200);
    expect((await get("/api/stats")).status).toBe(200);
    expect((await get("/api/stats")).status).toBe(429); // bucket exhausted
    expect((await get("/api/stats", "7.7.7.2")).status).toBe(200); // other IP fine
    // health probes are never throttled
    for (let i = 0; i < 5; i++) expect((await get("/api/health")).status).toBe(200);
  });
});

describe("error shapes", () => {
  it("answers internal failures with a generic 500, not the pg error text", async () => {
    const url = await startApi({
      stats: async () => {
        throw new Error('pq: relation "rooms" does not exist');
      },
    });
    const res = await fetch(`${url}/api/stats`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "internal error" });
  });

  it("still reports malformed JSON bodies as 400 client errors", async () => {
    const url = await startApi();
    const res = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{nope",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid JSON" });
  });
});

describe("Fabrary URL imports", () => {
  it("fetches the URL server-side, uses the Fabrary name, and stores the canonical source URL", async () => {
    await register(db, "FabraryImport", "password1");
    const session = await login(db, "fabraryimport", "password1");
    if (!session.ok) throw new Error("login failed");
    const armoryDeck = precon("precon-ako");
    if (!armoryDeck) throw new Error("test precon missing");
    const pool = armoryDeck.pool;
    const line = (id: string): string => {
      const card = cardData[id];
      if (!card) throw new Error(`test card missing: ${id}`);
      return `1x ${card.name}${card.pitch ? ` (${card.pitch})` : ""}`;
    };
    const text = [
      `Hero: ${cardData[pool.heroId]!.name}`,
      ...pool.weaponIds.map(line),
      ...pool.equipmentPool.map(line),
      ...pool.deck.map(line),
      "Sideboard cards",
      ...(pool.sideboard ?? []).map(line),
    ].join("\n");
    const matchups = [{
      id: "bravo-plan",
      name: "Into Bravo",
      heroIdentifiers: ["bravo_showstopper"],
      preferredTurnOrder: "second" as const,
      notes: "Keep defense reactions available.",
    }];
    const fetchDeck = vi.fn(async () => ({
      ok: true as const,
      deck: {
        name: "Kayo from Fabrary",
        canonicalUrl: "https://fabrary.net/decks/01G76G1DP5VVB050BT3YV9TQ7K",
        text,
        matchups,
      },
    }));
    const url = await startApi({ fabraryClient: { fetchDeck } });

    const response = await fetch(`${url}/api/decks/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        format: "cc",
        url: "https://www.fabrary.net/decks/01g76g1dp5vvb050bt3yv9tq7k?ignored=1",
      }),
    });

    expect(response.status).toBe(200);
    const imported = await response.json() as { deck: { id: string } };
    expect(imported).toMatchObject({
      ok: true,
      deck: {
        name: "Kayo from Fabrary",
        fabraryUrl: "https://fabrary.net/decks/01G76G1DP5VVB050BT3YV9TQ7K",
        heroName: cardData[pool.heroId]!.name,
      },
    });
    expect(fetchDeck).toHaveBeenCalledWith(
      "https://www.fabrary.net/decks/01g76g1dp5vvb050bt3yv9tq7k?ignored=1",
    );

    const deckId = imported.deck.id;
    const refreshed = await fetch(`${url}/api/decks/${deckId}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toMatchObject({
      ok: true,
      deck: {
        matchups,
        decklist: { sideboard: pool.sideboard ?? [] },
      },
    });
    const matchup = await fetch(`${url}/api/decks/${deckId}?matchupId=bravo-plan`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(await matchup.json()).toMatchObject({
      ok: true,
      deck: { selectedMatchupId: "bravo-plan", matchups },
    });
    expect(fetchDeck).toHaveBeenLastCalledWith(
      "https://fabrary.net/decks/01G76G1DP5VVB050BT3YV9TQ7K",
      "bravo-plan",
    );
  });

  it("returns a client-safe provider error", async () => {
    await register(db, "FabraryMissing", "password1");
    const session = await login(db, "fabrarymissing", "password1");
    if (!session.ok) throw new Error("login failed");
    const url = await startApi({
      fabraryClient: {
        fetchDeck: async () => ({ ok: false, status: 404, error: "Fabrary deck not found; make sure it is public" }),
      },
    });
    const response = await fetch(`${url}/api/decks/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ format: "cc", url: "https://fabrary.net/decks/01G76G1DP5VVB050BT3YV9TQ7K" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Fabrary deck not found; make sure it is public",
    });
  });

  it("reimports a changed Fabrary source and recomputes ban-list issues", async () => {
    await register(db, "FabraryUpdate", "password1");
    const session = await login(db, "fabraryupdate", "password1");
    if (!session.ok) throw new Error("login failed");
    const armoryDeck = precon("precon-ako");
    if (!armoryDeck) throw new Error("test precon missing");
    const pool = armoryDeck.pool;
    const line = (id: string): string => {
      const card = cardData[id];
      if (!card) throw new Error(`test card missing: ${id}`);
      return `1x ${card.name}${card.pitch ? ` (${card.pitch})` : ""}`;
    };
    const originalText = [
      `Hero: ${cardData[pool.heroId]!.name}`,
      ...pool.weaponIds.map(line),
      ...pool.equipmentPool.map(line),
      ...pool.deck.map(line),
      "Sideboard cards",
      ...(pool.sideboard ?? []).map(line),
    ].join("\n");
    const replacedLine = line(pool.deck[0]!);
    const changedText = originalText.replace(replacedLine, "1x Art of War (Red)");
    expect(changedText).not.toBe(originalText);

    const originalUrl = "https://fabrary.net/decks/01G76G1DP5VVB050BT3YV9TQ7K";
    const changedUrl = "https://fabrary.net/decks/01H76G1DP5VVB050BT3YV9TQ7K";
    const fetchDeck = vi.fn(async (requestedUrl: string) => ({
      ok: true as const,
      deck: {
        name: "Provider deck",
        canonicalUrl: requestedUrl.includes("01H76") ? changedUrl : originalUrl,
        text: requestedUrl.includes("01H76") ? changedText : originalText,
        matchups: [],
      },
    }));
    const url = await startApi({ fabraryClient: { fetchDeck } });

    const importedResponse = await fetch(`${url}/api/decks/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ format: "cc", url: originalUrl }),
    });
    const imported = await importedResponse.json() as { deck: { id: string } };
    expect(importedResponse.status).toBe(200);

    const updatedResponse = await fetch(`${url}/api/decks/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ id: imported.deck.id, name: "Updated source", url: changedUrl }),
    });
    expect(updatedResponse.status).toBe(200);
    const updated = await updatedResponse.json() as {
      ok: boolean;
      deck: { name: string; fabraryUrl: string; bannedCards?: string[] };
    };
    expect(updated).toMatchObject({
      ok: true,
      deck: {
        name: "Updated source",
        fabraryUrl: changedUrl,
      },
    });
    expect(updated.deck.bannedCards).toContain("Art of War");
    expect(fetchDeck).toHaveBeenNthCalledWith(1, originalUrl);
    expect(fetchDeck).toHaveBeenNthCalledWith(2, changedUrl);

    fetchDeck.mockClear();
    const renamedResponse = await fetch(`${url}/api/decks/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({
        id: imported.deck.id,
        name: "Rename only",
        url: "https://www.fabrary.net/decks/01h76g1dp5vvb050bt3yv9tq7k?ignored=1",
      }),
    });
    expect(renamedResponse.status).toBe(200);
    expect(fetchDeck).not.toHaveBeenCalled();
    const renamed = await renamedResponse.json() as {
      ok: boolean;
      deck: { name: string; fabraryUrl: string; bannedCards?: string[] };
    };
    expect(renamed).toMatchObject({
      ok: true,
      deck: { name: "Rename only", fabraryUrl: changedUrl },
    });
    expect(renamed.deck.bannedCards).toContain("Art of War");
  });

  it("does not overwrite a deck when the changed Fabrary source fails validation", async () => {
    await register(db, "FabraryInvalidUpdate", "password1");
    const session = await login(db, "fabraryinvalidupdate", "password1");
    if (!session.ok) throw new Error("login failed");
    const armoryDeck = precon("precon-ako");
    if (!armoryDeck) throw new Error("test precon missing");
    const pool = armoryDeck.pool;
    const line = (id: string): string => {
      const card = cardData[id];
      if (!card) throw new Error(`test card missing: ${id}`);
      return `1x ${card.name}${card.pitch ? ` (${card.pitch})` : ""}`;
    };
    const originalText = [
      `Hero: ${cardData[pool.heroId]!.name}`,
      ...pool.weaponIds.map(line),
      ...pool.equipmentPool.map(line),
      ...pool.deck.map(line),
      "Sideboard cards",
      ...(pool.sideboard ?? []).map(line),
    ].join("\n");
    const originalUrl = "https://fabrary.net/decks/01J76G1DP5VVB050BT3YV9TQ7K";
    const changedUrl = "https://fabrary.net/decks/01K76G1DP5VVB050BT3YV9TQ7K";
    const fetchDeck = vi.fn(async (requestedUrl: string) => ({
      ok: true as const,
      deck: {
        name: "Provider deck",
        canonicalUrl: requestedUrl.includes("01K76") ? changedUrl : originalUrl,
        text: requestedUrl.includes("01K76") ? "3x Does Not Exist" : originalText,
        matchups: [],
      },
    }));
    const url = await startApi({ fabraryClient: { fetchDeck } });
    const importedResponse = await fetch(`${url}/api/decks/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ format: "cc", url: originalUrl }),
    });
    const imported = await importedResponse.json() as { deck: { id: string } };
    expect(importedResponse.status).toBe(200);

    const updatedResponse = await fetch(`${url}/api/decks/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ id: imported.deck.id, name: "Must not save", url: changedUrl }),
    });
    expect(updatedResponse.status).toBe(422);
    expect(await updatedResponse.json()).toMatchObject({ ok: false, missing: ["Does Not Exist"] });

    const decksResponse = await fetch(`${url}/api/decks`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(await decksResponse.json()).toMatchObject({
      ok: true,
      decks: [{ id: imported.deck.id, fabraryUrl: originalUrl }],
    });
  });
});

describe("production browser boundary", () => {
  it("sets security headers and rejects browser origins other than APP_ORIGIN", async () => {
    const url = await startApi({ appOrigin: "https://play.example" });
    const allowed = await fetch(`${url}/api/health`, {
      headers: { Origin: "https://play.example" },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://play.example");
    expect(allowed.headers.get("strict-transport-security")).toContain("max-age=");
    expect(allowed.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(allowed.headers.get("referrer-policy")).toBe("no-referrer");
    expect(allowed.headers.get("permissions-policy")).toContain("camera=()");

    const rejected = await fetch(`${url}/api/health`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toEqual({ ok: false, error: "origin not allowed" });
  });
});

describe("replay transport compression", () => {
  it("serves the stored gzip member directly and honors an explicit gzip opt-out", async () => {
    await register(db, "ReplayTransport", "password1");
    const session = await login(db, "replaytransport", "password1");
    if (!session.ok) throw new Error("login failed");
    const user = await sessionForToken(db, session.token);
    if (!user) throw new Error("session missing");
    const id = "aabbccddeeff001122334455";
    const body = { ok: true, replay: { version: 1, seat: 0, views: [] } };
    const raw = Buffer.from(JSON.stringify(body));
    const compressedPayload = gzipSync(raw);
    await db.query(
      `INSERT INTO replay_games
        (id, room_code, ruleset_version, format, hero_0_id, hero_1_id,
         winner, status, created_at, finished_at, expires_at, frame_count)
       VALUES ($1,'ZIP001','rules-a','cc','HERO0','HERO1',0,'ready',$2,$2,$3,1)`,
      [id, Date.now(), Date.now() + 60_000],
    );
    await db.query(
      `INSERT INTO replay_participants (replay_id, user_id, seat, payload, payload_bytes)
       VALUES ($1,$2,0,$3,$4)`,
      [id, user.id, compressedPayload, compressedPayload.length],
    );
    const url = await startApi();
    const authorization = `Bearer ${session.token}`;

    const compressed = await fetch(`${url}/api/replays/${id}`, {
      headers: { Authorization: authorization, "Accept-Encoding": "gzip" },
    });
    expect(compressed.status).toBe(200);
    expect(compressed.headers.get("content-encoding")).toBe("gzip");
    expect(compressed.headers.get("content-length")).toBe(String(compressedPayload.length));
    expect(compressed.headers.get("vary")).toContain("Accept-Encoding");
    expect(await compressed.json()).toEqual(body);

    const identity = await fetch(`${url}/api/replays/${id}`, {
      headers: {
        Authorization: authorization,
        "Accept-Encoding": "gzip;q=0, identity;q=1, *;q=1",
      },
    });
    expect(identity.status).toBe(200);
    expect(identity.headers.get("content-encoding")).toBeNull();
    expect(identity.headers.get("content-length")).toBe(String(raw.length));
    expect(await identity.json()).toEqual(body);
  });

  it("exposes full-information room replays only after finalization", async () => {
    await register(db, "ReplayActiveA", "password1");
    await register(db, "ReplayActiveB", "password1");
    const [sessionA, sessionB] = await Promise.all([
      login(db, "replayactivea", "password1"),
      login(db, "replayactiveb", "password1"),
    ]);
    if (!sessionA.ok || !sessionB.ok) throw new Error("login failed");
    const [userA, userB] = await Promise.all([
      sessionForToken(db, sessionA.token),
      sessionForToken(db, sessionB.token),
    ]);
    if (!userA || !userB) throw new Error("session missing");
    const users = [userA, userB] as const;
    const store = new PgRoomStore(db, "rules-a");
    const host = await store.createRoom("classic-battles", {
      hero: "rhinar",
      userId: users[0].id,
      username: users[0].username,
    });
    const joined = await store.joinRoom(host.code, undefined, {
      allowPlayer: true,
      hero: "dorinthea",
      userId: users[1].id,
      username: users[1].username,
    });
    if (!joined.ok || joined.kind !== "player") throw new Error("join failed");
    const roomTokens = [host.token, joined.token] as const;
    const winner = (await store.getRoom(host.code))!.prep!.dieWinner;
    const chosen = await store.chooseFirst(
      host.code,
      { token: roomTokens[winner], userId: users[winner].id },
      true,
    );
    if (!chosen.ok || chosen.started) throw new Error("turn order was not recorded");
    for (const seat of [0, 1] as const) {
      const deck = decklists[seat === 0 ? "rhinar" : "dorinthea"];
      const presented = await store.presentDeck(
        host.code,
        { token: roomTokens[seat], userId: users[seat].id },
        { weaponIds: deck.weaponIds, equipment: deck.equipment, deck: deck.deck },
      );
      if (!presented.ok) throw new Error(presented.error);
    }
    if (!(await store.getRoom(host.code))?.state) throw new Error("game did not start");

    const url = await startApi();
    const response = await fetch(`${url}/api/replays/room/${host.code}`, {
      headers: {
        Authorization: `Bearer ${sessionA.token}`,
        "Accept-Encoding": "gzip",
      },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "replay not found" });

    const conceded = await store.applyIntent(
      host.code,
      { token: roomTokens[0], userId: users[0].id },
      { kind: "concede" },
    );
    if (!conceded.ok || !conceded.replayFinalizationId) throw new Error("concede failed");
    await finalizeReplay(db, conceded.replayFinalizationId);

    const completed = await fetch(`${url}/api/replays/room/${host.code}`, {
      headers: { Authorization: `Bearer ${sessionA.token}` },
    });
    expect(completed.status).toBe(200);
    const completedBody = await completed.json() as {
      replay: { views: Array<{ players: [{ hand: unknown[] }, { hand: unknown[] }] }> };
    };
    expect(completedBody.replay.views[0]!.players[0].hand.length).toBeGreaterThan(0);
    expect(completedBody.replay.views[0]!.players[1].hand.length).toBeGreaterThan(0);
  });
});

describe("account rights", () => {
  it("offers one selected badge and rejects badges the account has not earned", async () => {
    await register(db, "BadgeUser", "password1");
    const session = await login(db, "badgeuser", "password1");
    if (!session.ok) throw new Error("login failed");
    const user = await sessionForToken(db, session.token);
    if (!user) throw new Error("session missing");
    const url = await startApi();
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
    };

    const initial = await fetch(`${url}/api/account/badges`, { headers });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({
      ok: true,
      availableBadges: ["early-tester"],
      selectedBadge: "early-tester",
    });

    const hidden = await fetch(`${url}/api/account/badge`, {
      method: "POST",
      headers,
      body: JSON.stringify({ badge: null }),
    });
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toMatchObject({ ok: true, selectedBadge: null });
    expect((await db.query("SELECT selected_badge FROM users WHERE id = $1", [user.id])).rows)
      .toEqual([{ selected_badge: null }]);

    const invalid = await fetch(`${url}/api/account/badge`, {
      method: "POST",
      headers,
      body: JSON.stringify({ badge: "founder" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, error: "invalid badge" });

    await db.query("UPDATE users SET early_tester = FALSE WHERE id = $1", [user.id]);
    const unavailable = await fetch(`${url}/api/account/badge`, {
      method: "POST",
      headers,
      body: JSON.stringify({ badge: "early-tester" }),
    });
    expect(unavailable.status).toBe(400);
    expect(await unavailable.json()).toEqual({ ok: false, error: "badge not available" });
  });

  it("exports account data and password-confirmed deletion removes account-bound data", async () => {
    await register(db, "PrivacyUser", "password1");
    const session = await login(db, "privacyuser", "password1");
    if (!session.ok) throw new Error("login failed");
    const user = await sessionForToken(db, session.token);
    if (!user) throw new Error("session missing");
    await db.query(
      `INSERT INTO rooms
       (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at, status, winner)
       VALUES ($1, 'classic-battles', '[]', NULL, NULL, 'test-ruleset', 0, $2, NULL, 'open', NULL)`,
      ["PRIV01", Date.now()],
    );
    await db.query(
      `INSERT INTO room_seats (room_code, seat, user_id, token_hash, username)
       VALUES ('PRIV01', 0, $1, $2, $3)`,
      [user.id, "a".repeat(64), user.username],
    );
    const revoked: number[] = [];
    const deletedRooms: Array<{ code: string; version: number }> = [];
    const url = await startApi({
      onUserSessionsRevoked: (id) => revoked.push(id),
      onRoomsDeleted: (rooms) => { deletedRooms.push(...rooms); },
    });
    const headers = { Authorization: `Bearer ${session.token}` };

    const reported = await fetch(`${url}/api/bug-reports`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        roomCode: "PRIV01",
        description: "The room stopped accepting legal actions.",
      }),
    });
    expect(reported.status).toBe(200);
    const reportedBody = await reported.json() as { ok: true; reportId: string };
    expect(reportedBody).toMatchObject({ ok: true, reportId: expect.any(String) });

    const exported = await fetch(`${url}/api/account/export`, { headers });
    expect(exported.status).toBe(200);
    const exportBody = await exported.json() as any;
    expect(exportBody.export.account).toEqual(expect.objectContaining({
      username: "PrivacyUser",
      earlyTester: true,
      selectedBadge: "early-tester",
    }));
    expect(exportBody.export.rooms).toEqual([
      expect.objectContaining({ code: "PRIV01", seat: 0 }),
    ]);
    expect(exportBody.export.replays).toEqual([]);
    expect(exportBody.export.bugReports).toEqual([
      expect.objectContaining({
        id: reportedBody.reportId,
        roomCode: "PRIV01",
        description: "The room stopped accepting legal actions.",
      }),
    ]);

    const invalid = await fetch(`${url}/api/account/delete`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    expect(invalid.status).toBe(403);
    expect(await sessionForToken(db, session.token)).not.toBeNull();

    const deleted = await fetch(`${url}/api/account/delete`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "password1" }),
    });
    expect(deleted.status).toBe(200);
    expect(await sessionForToken(db, session.token)).toBeNull();
    expect((await db.query("SELECT 1 FROM users WHERE id = $1", [user.id])).rows).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM rooms WHERE code = 'PRIV01'")).rows).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM bug_reports WHERE id = $1", [reportedBody.reportId])).rows).toHaveLength(0);
    expect(revoked).toEqual([user.id]);
    expect(deletedRooms).toEqual([{ code: "PRIV01", version: 1 }]);
  });
});
