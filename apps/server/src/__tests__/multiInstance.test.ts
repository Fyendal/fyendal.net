import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@fyendal/shared";
import { login, register } from "../auth.js";
import type { Queryable } from "../db.js";
import { closeGameServer, createGameServer } from "../index.js";
import { PgRoomStore } from "../store.js";
import { freshDb } from "./testdb.js";

interface TestClient {
  ws: WebSocket;
  send(message: ClientMessage): void;
  next(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage>;
}

async function connect(port: number): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }> = [];
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as ServerMessage;
    const waiter = waiters.find((candidate) => candidate.predicate(message));
    if (waiter) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    } else {
      inbox.push(message);
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return {
    ws,
    send: (message) => ws.send(JSON.stringify(message)),
    next: (predicate) => new Promise((resolve, reject) => {
      const index = inbox.findIndex(predicate);
      if (index >= 0) {
        resolve(inbox.splice(index, 1)[0]!);
        return;
      }
      const waiter = { predicate, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        const pending = waiters.indexOf(waiter);
        if (pending >= 0) waiters.splice(pending, 1);
        reject(new Error(`timeout waiting for cross-instance message; inbox=${inbox.map((message) => message.type).join(",")}`));
      }, 4_000);
    }),
  };
}

describe("multi-instance gateways", () => {
  let db: Queryable;
  let first: ReturnType<typeof createGameServer>;
  let second: ReturnType<typeof createGameServer>;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    db = await freshDb();
    first = createGameServer(0, { db, rooms: new PgRoomStore(db, "rules-a") });
    second = createGameServer(0, { db, rooms: new PgRoomStore(db, "rules-a") });
    await Promise.all([
      new Promise<void>((resolve) => first.once("listening", resolve)),
      new Promise<void>((resolve) => second.once("listening", resolve)),
    ]);
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.ws.close();
    await Promise.all([closeGameServer(first), closeGameServer(second)]);
    await (db as Queryable & { end(): Promise<void> }).end();
  });

  async function authed(port: number, username: string): Promise<TestClient> {
    expect(await register(db, username, "password1")).toEqual({ ok: true });
    const session = await login(db, username, "password1");
    if (!session.ok) throw new Error("login failed");
    const client = await connect(port);
    clients.push(client);
    client.send({ type: "auth", token: session.token });
    await client.next((message) => message.type === "authed");
    return client;
  }

  it("fans a room mutation out to the opponent's gateway", async () => {
    const a = await authed((first.address() as AddressInfo).port, "CrossRoomA");
    const b = await authed((second.address() as AddressInfo).port, "CrossRoomB");
    a.send({ type: "create-room", format: "classic-battles", hero: "rhinar" });
    const created = await a.next((message) => message.type === "room-created") as Extract<ServerMessage, { type: "room-created" }>;

    b.send({ type: "join-room", code: created.code, hero: "dorinthea" });
    await b.next((message) => message.type === "joined");
    const prep = await a.next((message) =>
      message.type === "prep-state" && message.prep.seats[1]?.hero === "dorinthea",
    ) as Extract<ServerMessage, { type: "prep-state" }>;

    expect(prep.prep.seats.map((seat) => seat?.hero)).toEqual(["rhinar", "dorinthea"]);
    expect(prep.prep.die).not.toBeNull();
  });

  it("pairs queue entries owned by different gateways exactly once", async () => {
    const a = await authed((first.address() as AddressInfo).port, "CrossQueueA");
    const b = await authed((second.address() as AddressInfo).port, "CrossQueueB");
    a.send({ type: "queue-join", format: "classic-battles", hero: "rhinar" });
    await a.next((message) => message.type === "queued");

    b.send({ type: "queue-join", format: "classic-battles", hero: "dorinthea" });
    const [created, joined] = await Promise.all([
      a.next((message) => message.type === "room-created") as Promise<Extract<ServerMessage, { type: "room-created" }>>,
      b.next((message) => message.type === "joined") as Promise<Extract<ServerMessage, { type: "joined" }>>,
    ]);

    expect(joined.code).toBe(created.code);
    expect((await db.query("SELECT COUNT(*) AS count FROM rooms")).rows[0]!.count).toBe(1);
    expect((await db.query("SELECT COUNT(*) AS count FROM matchmaking_entries")).rows[0]!.count).toBe(0);
  });

  it("does not rematch a decliner with the retained room on another gateway", async () => {
    const a = await authed((first.address() as AddressInfo).port, "CrossAvoidA");
    const b = await authed((second.address() as AddressInfo).port, "CrossAvoidB");
    a.send({ type: "queue-join", format: "classic-battles", hero: "rhinar" });
    await a.next((message) => message.type === "queued");
    b.send({ type: "queue-join", format: "classic-battles", hero: "dorinthea" });
    const created = await a.next((message) => message.type === "room-created") as Extract<ServerMessage, { type: "room-created" }>;
    await b.next((message) => message.type === "joined" && message.code === created.code);

    b.send({ type: "leave-room" });
    await b.next((message) => message.type === "left");
    b.send({
      type: "queue-join",
      format: "classic-battles",
      hero: "dorinthea",
      avoidRoomCodes: [created.code],
    });
    await b.next((message) => message.type === "queued");
    const separate = await b.next((message) =>
      message.type === "room-created" && message.code !== created.code
    ) as Extract<ServerMessage, { type: "room-created" }>;

    expect(separate.code).not.toBe(created.code);
    expect((await db.query(
      "SELECT retained_room_code FROM matchmaking_entries ORDER BY retained_room_code",
    )).rows).toEqual([
      { retained_room_code: created.code },
      { retained_room_code: separate.code },
    ].sort((left, right) => left.retained_room_code.localeCompare(right.retained_room_code)));
  });
});
