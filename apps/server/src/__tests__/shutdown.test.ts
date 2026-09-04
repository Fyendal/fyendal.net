import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
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
});
