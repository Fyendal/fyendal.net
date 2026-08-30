import { describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@fyendal/shared";
import { RoomBroadcaster, type RoomBroadcastClient } from "../roomBroadcaster.js";
import type { Queryable } from "../db.js";
import { PgRoomStore } from "../store.js";
import { freshDb } from "./testdb.js";

interface TestClient extends RoomBroadcastClient {
  messages: ServerMessage[];
  closes: Array<{ code: number; reason: string }>;
}

function client(code: string): TestClient {
  const value: TestClient = {
    code,
    messages: [],
    closes: [],
    send(message) { value.messages.push(message); },
    sendRaw(payload) { value.messages.push(JSON.parse(payload) as ServerMessage); },
    close(closeCode, reason) { value.closes.push({ code: closeCode, reason }); },
  };
  return value;
}

describe("RoomBroadcaster", () => {
  it("refreshes the lobby after a committed occupancy change with no room sockets", async () => {
    const db = await freshDb();
    const queries: string[] = [];
    const tracedDb: Queryable = {
      query: async (text, params) => {
        queries.push(text.replace(/\s+/g, " ").trim());
        return db.query(text, params);
      },
    };
    const store = new PgRoomStore(tracedDb, "test-ruleset");
    const room = await store.createRoom("classic-battles", { hero: "rhinar" });
    const broadcastLobby = vi.fn(async () => undefined);
    const broadcaster = new RoomBroadcaster<TestClient>({
      rooms: store,
      clientsFor: () => [],
      authorize: () => null,
      detach: () => undefined,
      broadcastLobby,
    });

    queries.length = 0;
    await broadcaster.afterCommit({ code: room.code, kind: "created", version: room.version });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("WITH seat_data AS");
    expect(broadcastLobby).toHaveBeenCalledOnce();
  });

  it("treats reload failure as post-commit, emits RESYNC_REQUIRED, and terminates attached sockets", async () => {
    const store = new PgRoomStore(await freshDb(), "test-ruleset");
    store.getRoom = async () => { throw new Error("reload failed"); };
    const attached = client("ABC123");
    const detached: TestClient[] = [];
    const errors: string[] = [];
    const broadcaster = new RoomBroadcaster<TestClient>({
      rooms: store,
      clientsFor: () => [attached],
      authorize: () => 0,
      detach: (value) => { detached.push(value); value.code = null; },
      broadcastLobby: async () => undefined,
      logError: (message) => { errors.push(message); },
    });

    await expect(broadcaster.afterCommit({ code: "ABC123", kind: "state", version: 7 }))
      .resolves.toBeUndefined();
    expect(errors).toEqual([expect.stringContaining("ABC123 v7")]);
    expect(attached.messages).toContainEqual(expect.objectContaining({
      type: "error",
      code: "RESYNC_REQUIRED",
    }));
    expect(detached).toEqual([attached]);
    expect(attached.closes).toEqual([{ code: 1012, reason: "resync required" }]);
  });
});
