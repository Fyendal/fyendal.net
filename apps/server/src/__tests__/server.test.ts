import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import type { ClientMessage, PresentedDeck, ServerMessage } from "@fyendal/shared";
import { cardData, decklists, formatLegalityIssues, precon, silverAgePrecon } from "@fyendal/cards";
import { broadcastCommittedRoom, createGameServer } from "../index.js";
import { login, register } from "../auth.js";
import type { Queryable } from "../db.js";
import { getDeck, importDeck } from "../decks.js";
import { PgRoomStore } from "../store.js";
import { freshDb } from "./testdb.js";

const PORT = 18901;
let wss: ReturnType<typeof createGameServer>;
let db: Queryable;
let userCounter = 0;

beforeAll(async () => {
  db = await freshDb();
  wss = createGameServer(PORT, { db, rooms: new PgRoomStore(db, "test-ruleset") });
});

afterAll(async () => {
  wss.close();
  await (db as unknown as { end(): Promise<void> }).end();
});

function client(): Promise<{
  ws: WebSocket;
  inbox: ServerMessage[];
  next: (pred?: (m: ServerMessage) => boolean) => Promise<ServerMessage>;
  sendMsg: (m: ClientMessage) => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const inbox: ServerMessage[] = [];
    const waiters: { pred: (m: ServerMessage) => boolean; res: (m: ServerMessage) => void }[] = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      inbox.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.pred(msg)) {
          waiters[i]!.res(msg);
          waiters.splice(i, 1);
          const messageIndex = inbox.indexOf(msg);
          if (messageIndex !== -1) inbox.splice(messageIndex, 1);
        }
      }
    });
    ws.on("open", () =>
      resolve({
        ws,
        inbox,
        sendMsg: (m) => ws.send(JSON.stringify(m)),
        next: (pred = () => true) =>
          new Promise((res, rej) => {
            const existingIndex = inbox.findIndex(pred);
            if (existingIndex !== -1) return res(inbox.splice(existingIndex, 1)[0]!);
            waiters.push({ pred, res });
            setTimeout(
              () => rej(new Error(`timeout waiting for message; inbox=${inbox.map((m) => `${m.type}:${"version" in m ? m.version : "-"}`).join(",")}`)),
              3000,
            );
          }),
      }),
    );
    ws.on("error", reject);
  });
}

type Client = Awaited<ReturnType<typeof client>>;
type AuthedClient = Client & { authToken: string };

/**
 * Classic-battles prep over ws: the die winner chooses first, then both seats
 * present their fixed box decks. Ends once both see game-started.
 */
async function startCbGameOverWs(
  a: Client,
  b: Client,
  knownPrepA?: Extract<ServerMessage, { type: "prep-state" }>,
): Promise<void> {
  let prepA = knownPrepA ?? (await a.next(
    (m) => m.type === "prep-state" && m.prep.seats[m.prep.yourSeat]?.hero != null,
  )) as Extract<ServerMessage, { type: "prep-state" }>;
  if (prepA.prep.die === null) {
    prepA = (await a.next(
      (m) => m.type === "prep-state" && m.prep.die !== null,
    )) as Extract<ServerMessage, { type: "prep-state" }>;
  }
  const prepB = (await b.next(
    (m) => m.type === "prep-state" && m.prep.die !== null,
  )) as Extract<ServerMessage, { type: "prep-state" }>;
  if (prepA.prep.deadlinePhase === "accept") {
    a.sendMsg({ type: "accept-match" });
    b.sendMsg({ type: "accept-match" });
    await a.next((m) => m.type === "prep-state" && m.prep.deadlinePhase === "choose-first");
  }
  (prepA.prep.die!.winner === prepA.prep.yourSeat ? a : b).sendMsg({ type: "choose-first", first: true });
  await a.next((m) => m.type === "prep-state" && m.prep.startPlayer !== null);
  const present = async (c: Client, known?: Extract<ServerMessage, { type: "prep-state" }>) => {
    const prep = known ?? (await c.next(
      (m) => m.type === "prep-state" && m.prep.seats[m.prep.yourSeat]?.hero != null,
    )) as Extract<ServerMessage, { type: "prep-state" }>;
    const dl = decklists[prep.prep.seats[prep.prep.yourSeat]!.hero!];
    c.sendMsg({
      type: "present-deck",
      deck: { weaponIds: dl.weaponIds, equipment: dl.equipment, deck: dl.deck },
    });
  };
  await present(a, prepA);
  await a.next((m) =>
    m.type === "prep-state" && m.prep.seats[m.prep.yourSeat]?.ready === true
  );
  await present(b, prepB);
  await a.next((m) => m.type === "game-started");
  await b.next((m) => m.type === "game-started");
}

/** Connect a client and authenticate it as a fresh registered user. */
async function authedClient(): Promise<AuthedClient> {
  const username = `testuser${++userCounter}`;
  const reg = await register(db, username, "password1");
  if (!reg.ok) throw new Error("register failed");
  const l = await login(db, username, "password1");
  if (!l.ok) throw new Error("login failed");

  const c = await client();
  c.sendMsg({ type: "auth", token: l.token });
  const authed = await c.next((m) => m.type === "authed");
  expect(authed).toMatchObject({ type: "authed", username });
  return { ...c, authToken: l.token };
}

describe("auth gating", () => {
  it("create-room without auth is rejected", async () => {
    const a = await client();
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const err = (await a.next((m) => m.type === "error")) as Extract<
      ServerMessage,
      { type: "error" }
    >;
    expect(err.message).toBe("log in to play");
    a.ws.close();
  });

  it("caps websocket connections per IP", async () => {
    // dedicated server with a tiny cap (the shared one must stay generous —
    // other tests hold several sockets at once)
    process.env.WS_MAX_PER_IP = "3";
    const srv = createGameServer(0, { db, rooms: new PgRoomStore(db, "test-ruleset") });
    await new Promise<void>((res) => srv.on("listening", res));
    const port = (srv.address() as AddressInfo).port;
    const open = () =>
      new Promise<WebSocket>((res, rej) => {
        const w = new WebSocket(`ws://localhost:${port}`);
        w.on("open", () => res(w));
        w.on("error", rej);
      });
    const socks: WebSocket[] = [];
    try {
      for (let i = 0; i < 3; i++) socks.push(await open());
      // the 4th connection from the same IP is closed with 1008
      const w4 = new WebSocket(`ws://localhost:${port}`);
      const code = await new Promise<number>((res) => w4.on("close", res));
      expect(code).toBe(1008);
      // freeing a slot lets the next one in
      socks[0]!.close();
      await new Promise((r) => setTimeout(r, 50));
      socks.push(await open());
    } finally {
      for (const s of socks) s.close();
      await new Promise<void>((res) => srv.close(() => res()));
      delete process.env.WS_MAX_PER_IP;
    }
  });

  it("terminates sockets whose frames exceed the payload cap", async () => {
    const a = await client();
    a.ws.send("x".repeat(80 * 1024)); // over the 64 KiB maxPayload
    const code = await new Promise<number>((res) => a.ws.on("close", res));
    expect(code).toBe(1009); // message too big
  });

  it("rejects malformed protocol shapes without dispatching them", async () => {
    const a = await client();
    a.ws.send(JSON.stringify({ type: "join-room", code: ["not", "a", "code"] }));
    const invalid = await a.next((m) => m.type === "error");
    expect(invalid).toMatchObject({ type: "error", code: "INVALID_MESSAGE", message: "invalid message" });

    // Invalid input is isolated to that frame; the connection remains usable.
    a.sendMsg({ type: "list-rooms" });
    expect(await a.next((m) => m.type === "rooms")).toMatchObject({ type: "rooms" });
    a.ws.close();
  });

  it("rejects binary client frames", async () => {
    const a = await client();
    a.ws.send(Buffer.from("binary"));
    const code = await new Promise<number>((res) => a.ws.on("close", res));
    expect(code).toBe(1003);
  });

  it("closes live sockets when their HTTP session is revoked", async () => {
    const a = await authedClient();
    const closed = new Promise<number>((resolve) => a.ws.on("close", resolve));
    const response = await fetch(`http://localhost:${PORT}/api/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${a.authToken}`,
      },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(await closed).toBe(1008);
  });

  it("closes sockets that exceed message-rate or pending-work limits", async () => {
    const rateServer = createGameServer(0, {
      db,
      rooms: new PgRoomStore(db, "test-ruleset"),
      wsMessageRateMax: 2,
    });
    await new Promise<void>((res) => rateServer.on("listening", res));
    const ratePort = (rateServer.address() as AddressInfo).port;
    const rateSocket = new WebSocket(`ws://localhost:${ratePort}`);
    await new Promise<void>((res, rej) => {
      rateSocket.on("open", () => res());
      rateSocket.on("error", rej);
    });
    for (let i = 0; i < 3; i++) rateSocket.send(JSON.stringify({ type: "list-rooms" }));
    expect(await new Promise<number>((res) => rateSocket.on("close", res))).toBe(1008);
    await new Promise<void>((res) => rateServer.close(() => res()));

    const pendingServer = createGameServer(0, {
      db,
      rooms: new PgRoomStore(db, "test-ruleset"),
      wsMaxPendingMessages: 1,
    });
    await new Promise<void>((res) => pendingServer.on("listening", res));
    const pendingPort = (pendingServer.address() as AddressInfo).port;
    const pendingSocket = new WebSocket(`ws://localhost:${pendingPort}`);
    await new Promise<void>((res, rej) => {
      pendingSocket.on("open", () => res());
      pendingSocket.on("error", rej);
    });
    pendingSocket.send(JSON.stringify({ type: "list-rooms" }));
    pendingSocket.send(JSON.stringify({ type: "list-rooms" }));
    expect(await new Promise<number>((res) => pendingSocket.on("close", res))).toBe(1008);
    await new Promise<void>((res) => pendingServer.close(() => res()));
  });

  it("enforces the configured browser Origin on websocket upgrades", async () => {
    const srv = createGameServer(0, {
      db,
      rooms: new PgRoomStore(db, "test-ruleset"),
      allowedOrigin: "https://play.example.com/path-is-ignored",
    });
    await new Promise<void>((res) => srv.on("listening", res));
    const originPort = (srv.address() as AddressInfo).port;

    const rejected = new WebSocket(`ws://localhost:${originPort}`, {
      origin: "https://evil.example.com",
    });
    rejected.on("error", () => {});
    const status = await new Promise<number | undefined>((res) => {
      rejected.on("unexpected-response", (_request, response) => res(response.statusCode));
    });
    expect(status).toBe(401);

    const accepted = new WebSocket(`ws://localhost:${originPort}`, {
      origin: "https://play.example.com",
    });
    await new Promise<void>((res, rej) => {
      accepted.on("open", () => res());
      accepted.on("error", rej);
    });
    accepted.close();
    await new Promise<void>((res) => accepted.on("close", () => res()));
    await new Promise<void>((res) => srv.close(() => res()));
  });

  it("honors APP_ORIGIN outside production for local browser requests", async () => {
    const previousOrigin = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "http://localhost:5173";
    const srv = createGameServer(0, {
      db,
      rooms: new PgRoomStore(db, "test-ruleset"),
    });
    try {
      await new Promise<void>((res) => srv.on("listening", res));
      const originPort = (srv.address() as AddressInfo).port;
      const response = await fetch(`http://localhost:${originPort}/api/health`, {
        headers: { Origin: "http://localhost:5173" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    } finally {
      if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = previousOrigin;
      await new Promise<void>((res) => srv.close(() => res()));
    }
  });

  it("anonymous spectator joins still work", async () => {
    const a = await authedClient();
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    const b = await authedClient();
    b.sendMsg({ type: "join-room", code: created.code });
    await startCbGameOverWs(a, b);

    // unauthenticated third client → spectator
    const s = await client();
    s.sendMsg({ type: "join-room", code: created.code });
    const joined = (await s.next((m) => m.type === "joined")) as Extract<
      ServerMessage,
      { type: "joined" }
    >;
    expect(joined.seat).toBeNull();
    expect(joined.spectator).toBe(true);
    a.ws.close();
    b.ws.close();
    s.ws.close();
  });

  it("back-to-back auth + join-room (page refresh) reclaims the player seat", async () => {
    // on refresh the client fires auth and join-room from onopen without
    // waiting for "authed" — join-room must still see the authenticated user
    const username = `refresher${++userCounter}`;
    const reg = await register(db, username, "password1");
    if (!reg.ok) throw new Error("register failed");
    const l = await login(db, username, "password1");
    if (!l.ok) throw new Error("login failed");

    const a = await client();
    a.sendMsg({ type: "auth", token: l.token });
    await a.next((m) => m.type === "authed");
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    const b = await authedClient();
    b.sendMsg({ type: "join-room", code: created.code });
    await startCbGameOverWs(a, b);

    const again = await client();
    again.sendMsg({ type: "auth", token: l.token });
    again.sendMsg({ type: "join-room", code: created.code, token: created.token });
    const res = await again.next((m) => m.type === "joined" || m.type === "error");
    expect(res).toMatchObject({ type: "joined", seat: 0 });
    await a.next((m) => m.type === "error" && m.message === "room session replaced");
    a.sendMsg({ type: "intent", intent: { kind: "pass" } });
    await a.next((m) => m.type === "error" && m.message === "not in a room");
    a.ws.close();
    b.ws.close();
    again.ws.close();
  });
});

describe("server rooms over websocket", () => {
  it("creates, sideboards, starts, and advances a Briar bot room", async () => {
    const a = await authedClient();
    a.sendMsg({ type: "create-bot-room", format: "silver-age", deckId: "precon-svi" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    const prep = (await a.next(
      (m) => m.type === "prep-state" && m.prep.seats[1]?.username === "Briar Bot",
    )) as Extract<ServerMessage, { type: "prep-state" }>;
    expect(prep.prep.seats[1]).toMatchObject({ heroName: "Briar", connected: true });

    const pool = silverAgePrecon("precon-svi")!.pool;
    a.sendMsg({ type: "choose-first", first: false });
    await a.next((m) => m.type === "prep-state" && m.prep.startPlayer === 1);
    a.sendMsg({
      type: "present-deck",
      deck: {
        weaponIds: pool.weaponIds.slice(0, 1),
        equipment: {},
        deck: pool.deck.slice(0, 40),
      },
    });
    await a.next((m) => m.type === "game-started");
    const initial = (await a.next((m) => m.type === "state")) as Extract<ServerMessage, { type: "state" }>;
    expect(initial.view.gameId).toBe(created.code);
    expect(initial.view.activePlayer).toBe(1);
    expect(initial.botGame).toBe(true);
    const advanced = (await a.next(
      (m) => m.type === "state" && m.version > initial.version,
    )) as Extract<ServerMessage, { type: "state" }>;
    expect(advanced.version).toBeGreaterThan(initial.version);
    a.sendMsg({ type: "leave-room", endGame: true });
    expect(await a.next((m) => m.type === "left")).toEqual({ type: "left" });
    expect((await db.query("SELECT 1 FROM rooms WHERE code = $1", [created.code])).rows).toHaveLength(0);
    a.ws.close();
  });

  it("creates, starts, and advances a Classic Constructed Hala bot room", async () => {
    const a = await authedClient();
    a.sendMsg({ type: "create-bot-room", format: "cc", deckId: "precon-asb" });
    const created = (await a.next((message) => message.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    const prep = (await a.next(
      (message) => message.type === "prep-state" && message.prep.seats[1]?.username === "Hala Bot",
    )) as Extract<ServerMessage, { type: "prep-state" }>;
    expect(prep.prep).toMatchObject({ format: "cc", botGame: true });
    expect(prep.prep.seats[1]).toMatchObject({
      heroName: "Hala, Bladesaint of the Vow",
      connected: true,
    });

    const pool = precon("precon-asb")!.pool;
    a.sendMsg({ type: "choose-first", first: false });
    await a.next((message) => message.type === "prep-state" && message.prep.startPlayer === 1);
    a.sendMsg({
      type: "present-deck",
      deck: { weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck },
    });
    await a.next((message) => message.type === "game-started");
    const initial = (await a.next((message) => message.type === "state")) as Extract<
      ServerMessage,
      { type: "state" }
    >;
    expect(initial.view.gameId).toBe(created.code);
    expect(initial.view.players[1].heroName).toBe("Hala, Bladesaint of the Vow");
    expect(initial.view.activePlayer).toBe(1);
    expect(initial.botGame).toBe(true);
    const advanced = (await a.next(
      (message) => message.type === "state" && message.version > initial.version,
    )) as Extract<ServerMessage, { type: "state" }>;
    expect(advanced.version).toBeGreaterThan(initial.version);
    a.sendMsg({ type: "leave-room", endGame: true });
    expect(await a.next((message) => message.type === "left")).toEqual({ type: "left" });
    a.ws.close();
  });

  it("creates the selected Classic Constructed Ira bot room", async () => {
    const a = await authedClient();
    a.sendMsg({
      type: "create-bot-room",
      format: "cc",
      deckId: "precon-asb",
      bot: "ira",
    });
    await a.next((message) => message.type === "room-created");
    const prep = await a.next(
      (message) => message.type === "prep-state" && message.prep.seats[1]?.username === "Ira Bot",
    );
    expect(prep).toMatchObject({
      type: "prep-state",
      prep: {
        format: "cc",
        botGame: true,
        seats: [
          expect.anything(),
          {
            username: "Ira Bot",
            heroName: "Ira, Scarlet Revenger",
            connected: true,
          },
        ],
      },
    });
    a.sendMsg({ type: "leave-room", endGame: true });
    expect(await a.next((message) => message.type === "left")).toEqual({ type: "left" });
    a.ws.close();
  });

  it("creates the selected Classic Constructed Cindra bot room", async () => {
    const a = await authedClient();
    a.sendMsg({
      type: "create-bot-room",
      format: "cc",
      deckId: "precon-asb",
      bot: "cindra",
    });
    await a.next((message) => message.type === "room-created");
    const prep = await a.next(
      (message) => message.type === "prep-state" && message.prep.seats[1]?.username === "Cindra Bot",
    );
    expect(prep).toMatchObject({
      type: "prep-state",
      prep: {
        format: "cc",
        botGame: true,
        seats: [
          expect.anything(),
          {
            username: "Cindra Bot",
            heroName: "Cindra, Dracai of Retribution",
            connected: true,
          },
        ],
      },
    });
    a.sendMsg({ type: "leave-room", endGame: true });
    expect(await a.next((message) => message.type === "left")).toEqual({ type: "left" });
    a.ws.close();
  });

  it("creates the selected Classic Constructed Jarl bot room", async () => {
    const a = await authedClient();
    a.sendMsg({
      type: "create-bot-room",
      format: "cc",
      deckId: "precon-asb",
      bot: "jarl",
    });
    await a.next((message) => message.type === "room-created");
    const prep = await a.next(
      (message) => message.type === "prep-state" && message.prep.seats[1]?.username === "Jarl Bot",
    );
    expect(prep).toMatchObject({
      type: "prep-state",
      prep: {
        format: "cc",
        botGame: true,
        seats: [
          expect.anything(),
          {
            username: "Jarl Bot",
            heroName: "Jarl Vetreiði",
            connected: true,
          },
        ],
      },
    });
    a.sendMsg({ type: "leave-room", endGame: true });
    expect(await a.next((message) => message.type === "left")).toEqual({ type: "left" });
    a.ws.close();
  });

  it("creates the selected Silver Age Bravo bot room", async () => {
    const a = await authedClient();
    a.sendMsg({
      type: "create-bot-room",
      format: "silver-age",
      deckId: "precon-sba",
      bot: "bravo",
    });
    await a.next((message) => message.type === "room-created");
    const prep = await a.next(
      (message) => message.type === "prep-state" && message.prep.seats[1]?.username === "Bravo Bot",
    );
    expect(prep).toMatchObject({
      type: "prep-state",
      prep: {
        format: "silver-age",
        botGame: true,
        seats: [
          expect.anything(),
          {
            username: "Bravo Bot",
            heroName: "Bravo, Flattering Showman",
            connected: true,
          },
        ],
      },
    });
    a.sendMsg({ type: "leave-room", endGame: true });
    expect(await a.next((message) => message.type === "left")).toEqual({ type: "left" });
    a.ws.close();
  });

  it("reloads and broadcasts the authoritative room after a committed mutation", async () => {
    const a = await authedClient();
    const b = await authedClient();
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    b.sendMsg({ type: "join-room", code: created.code });
    await b.next((m) => m.type === "joined");
    await startCbGameOverWs(a, b);
    a.inbox.length = 0;

    const nextVersion = Number((await db.query(
      "UPDATE rooms SET version = version + 1 WHERE code = $1 RETURNING version",
      [created.code],
    )).rows[0].version);
    await broadcastCommittedRoom(wss, { code: created.code, kind: "state", version: nextVersion });
    const refreshed = (await a.next(
      (message) => message.type === "state" && message.version === nextVersion,
    )) as Extract<ServerMessage, { type: "state" }>;
    expect(refreshed.version).toBe(nextVersion);

    const presenceVersion = Number((await db.query(
      "UPDATE rooms SET version = version + 1 WHERE code = $1 RETURNING version",
      [created.code],
    )).rows[0].version);
    await broadcastCommittedRoom(wss, {
      code: created.code,
      kind: "presence",
      seat: 1,
      connected: false,
      version: presenceVersion,
    });
    const disconnect = (await a.next(
      (message) => message.type === "opponent-disconnected" && message.version === presenceVersion,
    )) as Extract<ServerMessage, { type: "opponent-disconnected" }>;
    expect(disconnect.version).toBe(presenceVersion);

    a.ws.close();
    b.ws.close();
  });

  it("broadcasts predefined emotes without mutating room state", async () => {
    const a = await authedClient();
    const b = await authedClient();
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const created = (await a.next((message) => message.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    b.sendMsg({ type: "join-room", code: created.code });
    await b.next((message) => message.type === "joined");
    await startCbGameOverWs(a, b);

    const before = Number((await db.query(
      "SELECT version FROM rooms WHERE code = $1",
      [created.code],
    )).rows[0].version);
    a.sendMsg({ type: "emote", message: "Good luck, have fun!" });
    const [echo, received] = await Promise.all([
      a.next((message) => message.type === "emote"),
      b.next((message) => message.type === "emote"),
    ]);
    expect(echo).toEqual({ type: "emote", seat: 0, message: "Good luck, have fun!" });
    expect(received).toEqual(echo);
    const after = Number((await db.query(
      "SELECT version FROM rooms WHERE code = $1",
      [created.code],
    )).rows[0].version);
    expect(after).toBe(before);

    a.ws.close();
    b.ws.close();
  });

  it("create, join, game starts, states are per-seat filtered", async () => {
    const a = await authedClient();
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "dorinthea" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    expect(created.code).toHaveLength(6);
    expect(created.seat).toBe(0);

    const b = await authedClient();
    b.sendMsg({ type: "join-room", code: created.code });
    const joined = (await b.next((m) => m.type === "joined")) as Extract<
      ServerMessage,
      { type: "joined" }
    >;
    expect(joined.seat).toBe(1);

    await startCbGameOverWs(a, b);
    const stateA = (await a.next((m) => m.type === "state")) as Extract<
      ServerMessage,
      { type: "state" }
    >;
    const stateB = (await b.next((m) => m.type === "state")) as Extract<
      ServerMessage,
      { type: "state" }
    >;
    expect(stateA.yourSeat).toBe(0);
    expect(stateB.yourSeat).toBe(1);
    // hidden info: seat 1 sees seat 0's hand as count only
    expect(stateB.view.players[0]!.hand).toHaveLength(0);
    expect(stateB.view.players[0]!.handCount).toBe(4);
    expect(stateA.view.players[0]!.hand).toHaveLength(4);

    // the die winner picked who goes first — act from the active player's client
    const seat0First = stateA.view.activePlayer === 0;
    const [active, inactive] = seat0First ? [a, b] : [b, a];
    const [stateActive, stateInactive] = seat0First ? [stateA, stateB] : [stateB, stateA];
    expect(stateActive.legal.length).toBeGreaterThan(0);

    // the other player acting out of turn is rejected
    const intentsOff = stateInactive.legal.filter((i) => i.kind === "play-card");
    if (intentsOff.length > 0) {
      inactive.sendMsg({ type: "intent", intent: intentsOff[0]! });
      const err = (await inactive.next((m) => m.type === "error")) as Extract<
        ServerMessage,
        { type: "error" }
      >;
      expect(err.message).toBeTruthy();
    }

    // the active player passes the turn (action phase) or priority — a
    // start-of-turn priority window ("layer") may be open if someone drew an instant
    if (stateActive.legal.some((i) => i.kind === "pass")) {
      active.sendMsg({ type: "intent", intent: { kind: "pass" } });
      const after = (await active.next((m) => m.type === "state")) as Extract<
        ServerMessage,
        { type: "state" }
      >;
      expect(["end", "start", "action", "layer"]).toContain(after.view.phase);
    }
    a.ws.close();
    b.ws.close();
  });

  it("undo reverts the last action for either player", async () => {
    const a = await authedClient();
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    const b = await authedClient();
    b.sendMsg({ type: "join-room", code: created.code });
    await startCbGameOverWs(a, b);
    const before = (await a.next((m) => m.type === "state")) as Extract<
      ServerMessage,
      { type: "state" }
    >;

    // the player with priority passes — priority (if a start-of-turn window
    // is open) or the turn
    const passer = before.view.priorityPlayer === 0 ? a : b;
    const other = passer === a ? b : a;
    passer.sendMsg({ type: "intent", intent: { kind: "pass" } });
    const after = (await passer.next(
      (m) =>
        m.type === "state" &&
        (m.view.phase !== before.view.phase ||
          m.view.turn !== before.view.turn ||
          m.view.priorityPlayer !== before.view.priorityPlayer),
    )) as Extract<ServerMessage, { type: "state" }>;
    expect(after.view).toBeTruthy();

    // …the opponent undoes it: the game returns to the pre-pass snapshot and
    // records the public undo marker without losing the projected prior log.
    other.sendMsg({ type: "undo" });
    const undone = (await other.next(
      (m) => m.type === "state" && m.version > after.version,
    )) as Extract<ServerMessage, { type: "state" }>;
    expect(undone.view.phase).toBe(before.view.phase);
    expect(undone.view.turn).toBe(before.view.turn);
    expect(undone.view.priorityPlayer).toBe(before.view.priorityPlayer);
    expect(undone.view.log).toEqual([...before.view.log, "⤺ the last action was undone"]);

    a.ws.close();
    b.ws.close();
  });

  it("reconnect by token restores the seat", async () => {
    const a = await authedClient();
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    const b = await authedClient();
    b.sendMsg({ type: "join-room", code: created.code });
    const bJoined = (await b.next((m) => m.type === "joined")) as Extract<
      ServerMessage,
      { type: "joined" }
    >;
    await startCbGameOverWs(a, b);

    b.ws.close();
    const disc = (await a.next((m) => m.type === "opponent-disconnected")) as ServerMessage;
    expect(disc.type).toBe("opponent-disconnected");

    const b2 = await client();
    b2.sendMsg({ type: "auth", token: b.authToken });
    await b2.next((m) => m.type === "authed");
    b2.sendMsg({ type: "join-room", code: created.code, token: bJoined.token });
    const rejoined = (await b2.next((m) => m.type === "joined")) as Extract<
      ServerMessage,
      { type: "joined" }
    >;
    expect(rejoined.seat).toBe(bJoined.seat);
    const st = (await b2.next((m) => m.type === "state")) as Extract<
      ServerMessage,
      { type: "state" }
    >;
    expect(st.yourSeat).toBe(bJoined.seat);
    a.ws.close();
    b2.ws.close();
  });

  it("third client becomes a spectator with hidden hands", async () => {
    const a = await authedClient();
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "dorinthea" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    const b = await authedClient();
    b.sendMsg({ type: "join-room", code: created.code });
    await startCbGameOverWs(a, b);

    // third connection joins a full room → spectator
    const s = await client();
    s.sendMsg({ type: "join-room", code: created.code });
    const joined = (await s.next((m) => m.type === "joined")) as Extract<
      ServerMessage,
      { type: "joined" }
    >;
    expect(joined.seat).toBeNull();
    expect(joined.spectator).toBe(true);

    const st = (await s.next((m) => m.type === "state")) as Extract<
      ServerMessage,
      { type: "state" }
    >;
    expect(st.yourSeat).toBeNull();
    expect(st.legal).toHaveLength(0);
    // both hands hidden from spectators
    expect(st.view.players[0]!.hand).toHaveLength(0);
    expect(st.view.players[0]!.handCount).toBe(4);
    expect(st.view.players[1]!.hand).toHaveLength(0);
    expect(st.view.players[1]!.handCount).toBe(4);

    // A spectator must not be able to retain this room subscription and then
    // acquire a player seat elsewhere. Previously, Room A would subsequently
    // use the Room B seat number and disclose one Room A hand to this socket.
    const otherHost = await authedClient();
    otherHost.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const otherRoom = (await otherHost.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    s.sendMsg({ type: "auth", token: otherHost.authToken });
    await s.next((m) => m.type === "authed");
    s.sendMsg({ type: "join-room", code: otherRoom.code, token: otherRoom.token });
    const switchError = (await s.next(
      (m) => m.type === "error" && m.message === "leave your current room before joining another",
    )) as Extract<ServerMessage, { type: "error" }>;
    expect(switchError.message).toBe("leave your current room before joining another");

    // Force a fresh Room A broadcast and verify both hands remain hidden.
    s.inbox.length = 0;
    const roomVersion = Number((await db.query(
      "UPDATE rooms SET version = version + 1 WHERE code = $1 RETURNING version",
      [created.code],
    )).rows[0].version);
    await broadcastCommittedRoom(wss, { code: created.code, kind: "state", version: roomVersion });
    const afterRejectedSwitch = (await s.next((m) => m.type === "state")) as Extract<
      ServerMessage,
      { type: "state" }
    >;
    expect(afterRejectedSwitch.yourSeat).toBeNull();
    expect(afterRejectedSwitch.view.players[0]!.hand).toHaveLength(0);
    expect(afterRejectedSwitch.view.players[1]!.hand).toHaveLength(0);

    // players are told about the spectator
    const specMsg = (await a.next((m) => m.type === "spectators")) as Extract<
      ServerMessage,
      { type: "spectators" }
    >;
    expect(specMsg.count).toBe(1);

    // spectators cannot act
    s.sendMsg({ type: "intent", intent: { kind: "pass" } });
    const err = (await s.next((m) => m.type === "error")) as Extract<
      ServerMessage,
      { type: "error" }
    >;
    expect(err.message).toBeTruthy();

    // spectator leaving updates the count
    s.ws.close();
    const gone = (await a.next(
      (m) => m.type === "spectators" && (m as { count: number }).count === 0,
    )) as Extract<ServerMessage, { type: "spectators" }>;
    expect(gone.count).toBe(0);

    a.ws.close();
    b.ws.close();
    otherHost.ws.close();
  });

  it("a swept room kicks its local clients with 'room not found'", async () => {
    const a = await authedClient();
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;

    // simulate the GC sweep: row gone, then the sweep's published event
    await db.query("DELETE FROM rooms WHERE code = $1", [created.code]);
    await broadcastCommittedRoom(wss, { code: created.code, kind: "deleted", version: created.version + 1 });

    const err = (await a.next((m) => m.type === "error")) as Extract<
      ServerMessage,
      { type: "error" }
    >;
    expect(err.message).toBe("room not found");
    expect(err.code).toBe("ROOM_NOT_FOUND");
    a.ws.close();
  });
});

describe("lobby and matchmaking", () => {
  it("list-rooms returns open rooms and pushes updates to lobby clients", async () => {
    const lobby = await client();
    lobby.sendMsg({ type: "list-rooms" });
    const empty = (await lobby.next((m) => m.type === "rooms")) as Extract<
      ServerMessage,
      { type: "rooms" }
    >;
    const before = empty.rooms.length;

    const a = await authedClient();
    a.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;

    const update = (await lobby.next(
      (m) => m.type === "rooms" && m.rooms.length === before + 1,
    )) as Extract<ServerMessage, { type: "rooms" }>;
    const row = update.rooms.find((r) => r.code === created.code)!;
    expect(row).toMatchObject({ format: "classic-battles", heroes: ["Rhinar", null] });

    // Filling the room is itself an occupancy transition: the lobby must
    // immediately flip the row to spectate-only, before the game starts.
    const b = await authedClient();
    b.sendMsg({ type: "join-room", code: created.code });
    await b.next((m) => m.type === "joined");
    const filled = (await lobby.next(
      (m) => m.type === "rooms" && m.rooms.some((r) => r.code === created.code && r.spectateOnly),
    )) as Extract<ServerMessage, { type: "rooms" }>;
    expect(filled.rooms.find((r) => r.code === created.code)).toMatchObject({
      spectateOnly: true,
    });
    expect(filled.rooms.find((r) => r.code === created.code)).not.toHaveProperty("started");

    // The started room remains listed for spectators.
    await startCbGameOverWs(a, b);
    const started = (await lobby.next(
      (m) => m.type === "rooms" && m.rooms.some((r) => r.code === created.code && r.started),
    )) as Extract<ServerMessage, { type: "rooms" }>;
    expect(started.rooms.find((r) => r.code === created.code)).toMatchObject({
      spectateOnly: true,
      started: true,
    });

    lobby.ws.close();
    a.ws.close();
    b.ws.close();
  });

  it("keeps hosted private rooms unlisted and resolves them through invite codes", async () => {
    const lobby = await client();
    lobby.sendMsg({ type: "list-rooms" });
    const before = (await lobby.next((message) => message.type === "rooms")) as Extract<
      ServerMessage,
      { type: "rooms" }
    >;

    const host = await authedClient();
    host.sendMsg({
      type: "create-room",
      format: "classic-battles",
      hero: "rhinar",
      private: true,
    });
    const created = (await host.next((message) => message.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    expect((await db.query("SELECT is_private FROM rooms WHERE code = $1", [created.code])).rows[0])
      .toEqual({ is_private: true });

    const unchanged = (await lobby.next((message) => message.type === "rooms")) as Extract<
      ServerMessage,
      { type: "rooms" }
    >;
    expect(unchanged.rooms).toEqual(before.rooms);

    const guest = await authedClient();
    guest.sendMsg({ type: "inspect-room", code: created.code });
    const info = (await guest.next((message) => message.type === "room-info")) as Extract<
      ServerMessage,
      { type: "room-info" }
    >;
    expect(info.room).toEqual({ code: created.code, format: "classic-battles" });

    guest.sendMsg({ type: "join-room", code: created.code, hero: "dorinthea" });
    const joined = (await guest.next((message) => message.type === "joined")) as Extract<
      ServerMessage,
      { type: "joined" }
    >;
    expect(joined).toMatchObject({ code: created.code, seat: 1 });

    lobby.ws.close();
    host.ws.close();
    guest.ws.close();
  });

  it("queue-join pairs FIFO (mirror matches allowed) and starts via the prep room", async () => {
    const a = await authedClient();
    const b = await authedClient();

    a.sendMsg({ type: "queue-join", format: "classic-battles", hero: "rhinar" });
    const queued = (await a.next((m) => m.type === "queued")) as Extract<
      ServerMessage,
      { type: "queued" }
    >;
    expect(queued.format).toBe("classic-battles");

    // a second Rhinar pairs immediately — mirror matches are fine
    b.sendMsg({ type: "queue-join", format: "classic-battles", hero: "rhinar" });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    const joined = (await b.next((m) => m.type === "joined")) as Extract<
      ServerMessage,
      { type: "joined" }
    >;
    expect(joined.code).toBe(created.code);

    // no auto-start: both seats present their box decks, the die winner picks
    // first, then the game starts
    const prepA = (await a.next((m) =>
      m.type === "prep-state"
      && m.prep.die !== null
      && m.prep.seats.every((seat) => seat?.hero === "rhinar")
    )) as Extract<
      ServerMessage,
      { type: "prep-state" }
    >;
    expect(prepA.prep.seats[0]?.hero).toBe("rhinar");
    expect(prepA.prep.seats[1]?.hero).toBe("rhinar");
    expect(prepA.prep.startPlayer).toBeNull();
    await startCbGameOverWs(a, b, prepA);

    a.ws.close();
    b.ws.close();
  });

  it("leaving an unmatched opener removes its matchmaking entry", async () => {
    const a = await authedClient();
    a.sendMsg({ type: "queue-join", format: "classic-battles", hero: "rhinar" });
    await a.next((m) => m.type === "queued");
    await a.next((m) => m.type === "room-created");
    expect((await db.query("SELECT COUNT(*) AS count FROM matchmaking_entries")).rows[0]!.count)
      .toBe(1);

    a.sendMsg({ type: "leave-room" });
    await a.next((m) => m.type === "left");
    expect((await db.query("SELECT COUNT(*) AS count FROM matchmaking_entries")).rows[0]!.count)
      .toBe(0);
    a.ws.close();
  });

  it("queues a built-in precon instead of returning an internal error", async () => {
    const a = await authedClient();
    a.sendMsg({ type: "queue-join", format: "silver-age", deckId: "precon-sba" });

    const queued = (await a.next((message) => message.type === "queued")) as Extract<
      ServerMessage,
      { type: "queued" }
    >;
    expect(queued.format).toBe("silver-age");
    await a.next((message) => message.type === "room-created");

    a.sendMsg({ type: "leave-room" });
    await a.next((message) => message.type === "left");
    a.ws.close();
  });

  it("does not push queue depth changes to sockets already attached to rooms", async () => {
    const host = await authedClient();
    host.sendMsg({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    await host.next((m) => m.type === "room-created");
    host.inbox.length = 0;

    const queued = await authedClient();
    queued.sendMsg({ type: "queue-join", format: "classic-battles", hero: "rhinar" });
    await queued.next((m) => m.type === "queued");
    await queued.next((m) => m.type === "room-created");
    expect((await db.query("SELECT COUNT(*) AS count FROM matchmaking_entries")).rows[0]!.count)
      .toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(host.inbox.some((message) => message.type === "queue-status")).toBe(false);

    queued.sendMsg({ type: "leave-room" });
    await queued.next((m) => m.type === "left");
    host.ws.close();
    queued.ws.close();
  });
});

describe("cc prep room", () => {
  const printings = Object.values(cardData);
  const hero = printings.find((c) => c.cardType === "hero" && c.name.includes("Rhinar"))!;
  const ccIssuesFor = (id: string) => formatLegalityIssues(
    cardData,
    { heroId: hero.id, weaponIds: [], equipmentPool: [], deck: [id], sideboard: [] },
    "cc",
  );
  const weapon = printings.find((c) => c.cardType === "weapon" && ccIssuesFor(c.id).length === 0)!;
  const deckCards = printings.filter(
    (c) =>
      !["hero", "weapon", "equipment", "token"].includes(c.cardType) &&
      ccIssuesFor(c.id).length === 0,
  );

  /** authedClient + an imported cc deck owned by that user. */
  async function authedClientWithCcDeck(): Promise<{ c: Client; deckId: string; username: string }> {
    const c = await authedClient();
    const username = `testuser${userCounter}`; // authedClient just incremented it
    const { rows } = await db.query("SELECT id FROM users WHERE username_lc = $1", [username]);
    const text = [
      `Hero: ${hero.name}`,
      `1x ${weapon.name}`,
      ...deckCards.slice(0, 20).map((cd) => `3x ${cd.name}${cd.pitch ? ` (${cd.pitch})` : ""}`),
    ].join("\n");
    const imp = await importDeck(db, Number(rows[0]!.id), {
      name: `${username} deck`,
      format: "cc",
      text,
    });
    if (!imp.ok) throw new Error("import failed");
    return { c, deckId: imp.deck.id, username };
  }

  /** Present the whole registered pool (60 main + 1 weapon). */
  async function presentedFor(deckId: string): Promise<PresentedDeck> {
    const d = (await getDeck(db, deckId))!;
    return { weaponIds: d.decklist.weaponIds, equipment: {}, deck: d.decklist.deck };
  }

  /** Pair two cc players via the queue; returns their room code. */
  async function pairViaQueue(
    a: Client,
    aDeck: string,
    b: Client,
    bDeck: string,
  ): Promise<string> {
    a.sendMsg({ type: "queue-join", format: "cc", deckId: aDeck });
    await a.next((m) => m.type === "queued");
    b.sendMsg({ type: "queue-join", format: "cc", deckId: bDeck });
    const created = (await a.next((m) => m.type === "room-created")) as Extract<
      ServerMessage,
      { type: "room-created" }
    >;
    const joined = (await b.next((m) => m.type === "joined")) as Extract<
      ServerMessage,
      { type: "joined" }
    >;
    expect(joined.code).toBe(created.code);
    a.sendMsg({ type: "accept-match" });
    b.sendMsg({ type: "accept-match" });
    await a.next((m) => m.type === "prep-state" && m.prep.deadlinePhase === "choose-first");
    return created.code;
  }

  it("rejects a banned deck before creating a room", async () => {
    const c = await authedClient();
    c.sendMsg({ type: "create-room", format: "cc", deckId: "precon-aaz" });
    const error = (await c.next((message) => message.type === "error")) as Extract<
      ServerMessage,
      { type: "error" }
    >;
    expect(error.message).toContain(
      "Azalea, Ace in the Hole has Living Legend status and is not legal in Classic Constructed",
    );
    expect(error.message).toContain(
      "Death Dealer is a Living Legend signature weapon and is not legal in Classic Constructed",
    );
    c.ws.close();
  });

  it("pairs into a prep room; die roll, first-pick and ready-up start the game", async () => {
    const { c: a, deckId: aDeck } = await authedClientWithCcDeck();
    const { c: b, deckId: bDeck } = await authedClientWithCcDeck();
    await pairViaQueue(a, aDeck, b, bDeck);

    // both see the prep room: two seats, heroes revealed, die rolled, no game
    const prepA = (await a.next((m) => m.type === "prep-state" && m.prep.die !== null)) as Extract<
      ServerMessage,
      { type: "prep-state" }
    >;
    const prepB = (await b.next((m) => m.type === "prep-state" && m.prep.die !== null)) as Extract<
      ServerMessage,
      { type: "prep-state" }
    >;
    expect(prepA.prep.seats[0]?.heroName).toContain("Rhinar");
    expect(prepA.prep.seats[1]?.heroName).toContain("Rhinar");
    expect(prepA.prep.startPlayer).toBeNull();
    expect(prepA.prep.yourSeat).toBe(0);
    expect(prepB.prep.yourSeat).toBe(1);
    const winner = prepA.prep.die!.winner;
    const [winnerC, loserC] = winner === 0 ? [a, b] : [b, a];

    // only the die winner picks
    loserC.sendMsg({ type: "choose-first", first: true });
    await loserC.next((m) => m.type === "error");
    winnerC.sendMsg({ type: "choose-first", first: true });
    await a.next((m) => m.type === "prep-state" && m.prep.startPlayer === winner);

    a.sendMsg({ type: "present-deck", deck: await presentedFor(aDeck) });
    await a.next((m) =>
      m.type === "prep-state" && m.prep.seats[m.prep.yourSeat]?.ready === true
    );
    b.sendMsg({ type: "present-deck", deck: await presentedFor(bDeck) });
    await a.next((m) => m.type === "game-started");
    await b.next((m) => m.type === "game-started");
    const stateA = (await a.next((m) => m.type === "state")) as Extract<
      ServerMessage,
      { type: "state" }
    >;
    expect(stateA.view.activePlayer).toBe(winner);

    a.ws.close();
    b.ws.close();
  });

  it("a pre-game leave re-queues the other player, who keeps the same room", async () => {
    const { c: a, deckId: aDeck } = await authedClientWithCcDeck();
    const { c: b, deckId: bDeck } = await authedClientWithCcDeck();
    const code = await pairViaQueue(a, aDeck, b, bDeck);
    await a.next((m) => m.type === "prep-state" && m.prep.die !== null);

    b.sendMsg({ type: "leave-room" });
    await b.next((m) => m.type === "left");
    // a is back in the queue but stays in the room, seat 1 open again
    await a.next((m) => m.type === "queued");
    const waiting = (await a.next(
      (m) => m.type === "prep-state" && m.prep.seats[1] === null,
    )) as Extract<ServerMessage, { type: "prep-state" }>;
    expect(waiting.prep.die).toBeNull();

    // a third player pairs into the SAME room
    const { c: c3, deckId: c3Deck, username: c3Name } = await authedClientWithCcDeck();
    c3.sendMsg({ type: "queue-join", format: "cc", deckId: c3Deck });
    const joined = (await c3.next((m) => m.type === "joined")) as Extract<
      ServerMessage,
      { type: "joined" }
    >;
    expect(joined.code).toBe(code);
    const reprep = (await a.next(
      (m) => m.type === "prep-state" && m.prep.die !== null && m.prep.seats[1]?.username === c3Name,
    )) as Extract<ServerMessage, { type: "prep-state" }>;
    expect(reprep.prep.seats[1]?.ready).toBe(false);

    a.ws.close();
    b.ws.close();
    c3.ws.close();
  });
});
