import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cardData, FUTURE_SET_CODES, isImplemented, precon } from "@fyendal/cards";
import { decodeDeckResponse, decodeDeckInvalidResponse, decodeFabraryDeckPreviewResponse } from "@fyendal/protocol";
import { createApiServer } from "../http.js";
import { login, register } from "../auth.js";
import { getDeck, listDecks, updateDeck } from "../decks.js";
import type { Queryable } from "../db.js";
import type { FabraryClient } from "../fabrary.js";
import { freshDb } from "./testdb.js";

const source = "https://fabrary.net/decks/01M1WZTPC64GDCMN2GX752E3R7";
const line = (id: string) => {
  const card = cardData[id]!;
  return `1x ${card.name}${card.pitch ? ` (${card.pitch})` : ""}`;
};
const pool = precon("precon-ako")!.pool;
const text = [line(pool.heroId), ...pool.weaponIds.map(line), ...pool.equipmentPool.map(line),
  ...pool.deck.map(line), "Sideboard cards", ...(pool.sideboard ?? []).map(line)].join("\n");

let db: Queryable;
let server: Server;
let base: string;
let token: string;
let userId: number;
let latestText: string;
let client: FabraryClient;

beforeEach(async () => {
  db = await freshDb();
  await register(db, "FabraryPlayer", "password1");
  const session = await login(db, "fabraryplayer", "password1");
  if (!session.ok) throw new Error("login failed");
  token = session.token;
  userId = (await db.query("SELECT id FROM users WHERE username_lc=$1", ["fabraryplayer"])).rows[0].id;
  latestText = text;
  client = { fetchDeck: vi.fn(async () => ({ ok: true as const, deck: {
    canonicalUrl: source, name: "Fabrary deck", text: latestText, matchups: [],
  } })) };
  server = createApiServer({ db, fabraryClient: client });
  await new Promise<void>((done) => server.listen(0, done));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await (db as Queryable & { end(): Promise<void> }).end();
});

function play(body: unknown = { url: source, format: "cc" }, credential = token): Promise<Response> {
  return fetch(`${base}/api/decks/play`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
    body: JSON.stringify(body) });
}

async function importedId(): Promise<string> {
  const response = await play();
  expect(response.status).toBe(200);
  const result = decodeDeckResponse(await response.json());
  if (!result) throw new Error("invalid deck response");
  return result.deck.id;
}

describe("Fabrary play deck resolution", () => {
  it("previews a public deck without login, playability validation, or saved rows", async () => {
    latestText = text.replace(line(pool.deck[0]!), "1x Unknown Future Card (1)");
    const response = await fetch(`${base}/api/decks/preview`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ url: source }) });
    expect(response.status).toBe(200);
    expect(decodeFabraryDeckPreviewResponse(await response.json())).toEqual({ ok: true,
      deck: { name: "Fabrary deck", heroName: cardData[pool.heroId]!.name } });
    expect(await listDecks(db, userId)).toEqual([]);
    expect(client.fetchDeck).toHaveBeenCalledWith(source);
  });

  it("validates guest preview URLs before fetching and reports provider failures", async () => {
    const preview = (url: string) => fetch(`${base}/api/decks/preview`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    expect((await preview("https://evil.test/deck")).status).toBe(400);
    expect(client.fetchDeck).not.toHaveBeenCalled();
    vi.mocked(client.fetchDeck).mockResolvedValueOnce({ ok: false, status: 404, error: "Deck not found" });
    const response = await preview(source);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Deck not found" });
    expect(await listDecks(db, userId)).toEqual([]);
  });

  it("reuses and refreshes the linked deck while preserving its user-selected name", async () => {
    const id = await importedId();
    await updateDeck(db, userId, id, { name: "My practice deck" });
    latestText = text.replace(line(pool.deck[0]!), "1x Art of War (2)");
    const result = decodeDeckResponse(await (await play({
      url: source.replace("fabrary.net", "www.fabrary.net").toLowerCase() + "?ignored=1", format: "cc",
    })).json());
    expect(result).toMatchObject({ ok: true, deck: { id, name: "My practice deck", fabraryUrl: source,
      bannedCards: expect.arrayContaining(["Art of War"]) } });
    expect(await listDecks(db, userId)).toHaveLength(1);
    expect(client.fetchDeck).toHaveBeenLastCalledWith(source);
  });

  it("imports banned and implemented future cards without stripping them", async () => {
    const future = Object.values(cardData).find((card) => card.set && FUTURE_SET_CODES.has(card.set)
      && isImplemented(card) && !["hero", "weapon", "equipment", "token"].includes(card.cardType))!;
    expect(future).toBeDefined();
    latestText = text.replace(line(pool.deck[0]!), "1x Art of War (2)")
      .replace(line(pool.deck[1]!), line(future.id));
    const result = decodeDeckResponse(await (await play()).json());
    expect(result).toMatchObject({ ok: true, deck: {
      bannedCards: expect.arrayContaining(["Art of War"]), futureCards: expect.arrayContaining([future.name]),
    } });
    if (!result) throw new Error("invalid deck response");
    const saved = await getDeck(db, result.deck.id);
    expect(saved!.decklist.deck.map((id) => cardData[id]!.name)).toContain("Art of War");
    expect(saved!.decklist.deck.map((id) => cardData[id]!.name)).toContain(future.name);
  });

  it("isolates saved links by account and format", async () => {
    const first = await importedId();
    const silverPool = precon("precon-sba")!.pool;
    latestText = [line(silverPool.heroId), ...silverPool.weaponIds.map(line), ...silverPool.equipmentPool.map(line),
      ...silverPool.deck.map(line), "Sideboard cards", ...(silverPool.sideboard ?? []).map(line)].join("\n");
    const silver = decodeDeckResponse(await (await play({ url: source, format: "silver-age" })).json());
    expect(silver?.deck.id).not.toBe(first);
    expect(silver?.deck.format).toBe("silver-age");
    await register(db, "OtherPlayer", "password1");
    const other = await login(db, "otherplayer", "password1");
    if (!other.ok) throw new Error("login failed");
    latestText = text;
    const second = decodeDeckResponse(await (await play(undefined, other.token)).json());
    expect(second?.deck.id).not.toBe(first);
    expect(await listDecks(db, userId)).toHaveLength(2);
  });

  it("requires login and validates sources and formats before fetching", async () => {
    expect((await play(undefined, "expired")).status).toBe(401);
    expect((await play({ url: source, format: "blitz" })).status).toBe(400);
    expect((await play({ url: "https://evil.test/deck", format: "cc" })).status).toBe(400);
    expect(client.fetchDeck).not.toHaveBeenCalled();
  });

  it("leaves the existing deck intact when the provider or latest deck fails", async () => {
    const id = await importedId();
    const saved = await getDeck(db, id);
    vi.mocked(client.fetchDeck).mockResolvedValueOnce({
      ok: false, status: 429, error: "Fabrary is busy; try again shortly",
    });
    expect((await play()).status).toBe(429);
    latestText = text.replace(line(pool.deck[0]!), "1x Unknown Future Card (1)");
    const response = await play();
    expect(response.status).toBe(422);
    expect(decodeDeckInvalidResponse(await response.json())?.missing).toContain("Unknown Future Card");
    expect(await getDeck(db, id)).toEqual(saved);
  });
});
