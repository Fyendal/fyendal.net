import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { ServerMessage } from "@fyendal/shared";
import { login, register } from "../auth.js";
import type { Queryable } from "../db.js";
import { closeGameServer, createGameServer } from "../index.js";
import { PgRoomStore } from "../store.js";
import { freshDb } from "./testdb.js";

describe("game server shutdown", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("asks connected clients to reconnect before closing", async () => {
    const db = await freshDb();
    const server = createGameServer(0, { db, rooms: new PgRoomStore(db, "rules-a") });
    cleanups.push(async () => {
      if (server.listening) await closeGameServer(server, 50);
      await (db as Queryable & { end(): Promise<void> }).end();
    });
    await new Promise<void>((resolve) => server.once("listening", resolve));

    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once("close", (code, reason) => resolve({ code, reason: String(reason) }));
    });

    await closeGameServer(server, 500);

    await expect(closed).resolves.toEqual({ code: 1012, reason: "service restart" });
  });

  it("waits for disconnect bookkeeping before completing shutdown", async () => {
    const db = await freshDb();
    expect(await register(db, "ShutdownUser", "password1")).toEqual({ ok: true });
    const session = await login(db, "ShutdownUser", "password1");
    if (!session.ok) throw new Error("login failed");

    let clusterEventInserts = 0;
    let releasePublish = (): void => {};
    const publishGate = new Promise<void>((resolve) => { releasePublish = resolve; });
    let markPublishStarted = (): void => {};
    const publishStarted = new Promise<void>((resolve) => { markPublishStarted = resolve; });
    const delayedDb: Queryable = {
      query: async (text, params) => {
        if (text.includes("INSERT INTO cluster_events")) {
          clusterEventInserts += 1;
          if (clusterEventInserts === 2) {
            markPublishStarted();
            await publishGate;
          }
        }
        return db.query(text, params);
      },
    };
    const server = createGameServer(0, { db: delayedDb, rooms: new PgRoomStore(delayedDb, "rules-a") });
    cleanups.push(async () => {
      releasePublish();
      if (server.listening) await closeGameServer(server, 50);
      await (db as Queryable & { end(): Promise<void> }).end();
    });
    await new Promise<void>((resolve) => server.once("listening", resolve));

    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const authed = new Promise<void>((resolve) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as ServerMessage;
        if (message.type === "authed") resolve();
      });
    });
    socket.send(JSON.stringify({ type: "auth", token: session.token }));
    await authed;

    let shutdownCompleted = false;
    const shutdown = closeGameServer(server, 500).then(() => { shutdownCompleted = true; });
    await publishStarted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(shutdownCompleted).toBe(false);

    releasePublish();
    await shutdown;
    expect(shutdownCompleted).toBe(true);
    expect((await db.query("SELECT lease_id FROM social_presence")).rows).toEqual([]);
  });
});
