import { CLIENT_UPDATE_MESSAGE, LiveServerMessageDecoder, decodeStateFrame, liveWebSocketUrl } from "@fyendal/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import WebSocket from "ws";
import { BOT_RUNTIME_ID } from "@fyendal/bot/runtime-id";
import { cardData, decklists, scripts } from "@fyendal/cards";
import { createGame } from "@fyendal/engine";
import type { ClientMessage, ServerMessage } from "@fyendal/shared";
import { hashPassword, login } from "../auth.js";
import { clientBotTask } from "../clientBotTask.js";
import { closeGameServer, createGameServer } from "../index.js";
import { encodePersistedState } from "../persistedState.js";
import { PgRoomStore, stateMessage } from "../store.js";
import { configuredWebSocketCompression } from "../webSocketCompression.js";
import { freshDb } from "./testdb.js";

interface Frame { compressed: boolean; bytes: number }
interface Received { message: ServerMessage; frame: Frame; wire: unknown }

/** Inspect actual server frame headers without depending on ws private fields.
 * The gateway sends complete text frames; TCP chunks may split/coalesce them. */
function frameReader(frames: Frame[]): (chunk: Buffer) => void {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      let size = pending[1]! & 0x7f;
      let header = 2;
      if (size === 126) {
        if (pending.length < 4) return;
        size = pending.readUInt16BE(2);
        header = 4;
      } else if (size === 127) {
        if (pending.length < 10) return;
        const length = pending.readBigUInt64BE(2);
        if (length > 16n * 1024n * 1024n) throw new Error("unexpectedly large test frame");
        size = Number(length);
        header = 10;
      }
      if (pending.length < header + size) return;
      if ((pending[0]! & 0x0f) === 1) {
        frames.push({ compressed: (pending[0]! & 0x40) !== 0, bytes: header + size });
      }
      pending = pending.subarray(header + size);
    }
  };
}

describe("gateway WebSocket compression", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    try {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  async function gateway() {
    const db = await freshDb();
    cleanups.push(async () => { await (db as typeof db & { end(): Promise<void> }).end(); });
    const rooms = new PgRoomStore(db, "test-rules");
    const server = createGameServer(0, { db, rooms, botDelayMs: 0 });
    cleanups.push(async () => { await closeGameServer(server, 50); });
    await once(server, "listening");
    return { db, rooms, port: (server.address() as AddressInfo).port };
  }

  async function connect(port: number, compression = true) {
    const ws = new WebSocket(liveWebSocketUrl(`ws://127.0.0.1:${port}`), { perMessageDeflate: compression });
    cleanups.push(async () => { ws.terminate(); });
    const frames: Frame[] = [];
    const received: Received[] = [];
    let closed: string | undefined;
    ws.on("close", (code, reason) => { closed = `${code}:${String(reason)}`; });
    let extensionHeader: string | undefined;
    ws.on("upgrade", (response) => {
      extensionHeader = response.headers["sec-websocket-extensions"];
      // Wait for ws to install its receiver before observing the stream. A
      // listener during upgrade can consume a frame coalesced with the HTTP
      // response before ws has attached its own data listener.
      ws.once("open", () => response.socket.prependListener("data", frameReader(frames)));
    });
    const decoder = new LiveServerMessageDecoder();
    ws.on("message", (raw) => {
      const value: unknown = JSON.parse(String(raw));
      const message = decoder.decode(value);
      const frame = frames.shift();
      if (!message || !frame) throw new Error("invalid or unframed server message");
      received.push({ message, frame, wire: value });
    });
    await once(ws, "open");
    return {
      ws, extensionHeader,
      send: (message: ClientMessage) => ws.send(JSON.stringify(message)),
      next: async (
        type: ServerMessage["type"],
        predicate: (message: ServerMessage) => boolean = () => true,
      ): Promise<Received> => {
        const matches = (item: Received) => item.message.type === type && predicate(item.message);
        await vi.waitFor(() => expect(
          received.some(matches),
          `missing ${type}; socket=${ws.readyState}; close=${closed}; frames=${frames.length}; `
            + `received ${received.map(({ message }) =>
            message.type === "error" ? `error:${message.message}` : message.type).join(",")}`,
        ).toBe(true), { timeout: 5_000 });
        return received.splice(received.findIndex(matches), 1)[0]!;
      },
    };
  }

  it.each([
    { name: "default compression", setting: undefined, clientCompression: true, compressed: true },
    { name: "operator rollback", setting: "false", clientCompression: true, compressed: false },
    { name: "client without compression", setting: "true", clientCompression: false, compressed: false },
  ])("preserves state and bot tasks with $name", async ({ setting, clientCompression, compressed }) => {
    vi.stubEnv("WS_COMPRESSION", setting);
    const { db, rooms, port } = await gateway();
    const inserted = await db.query(
      "INSERT INTO users (username, username_lc, pass_hash, created_at)"
        + " VALUES ('CompressionUser', 'compressionuser', $1, 1) RETURNING id",
      [await hashPassword("password1")],
    );
    const userId = Number(inserted.rows[0]!.id);
    const session = await login(db, "CompressionUser", "password1");
    if (!session.ok) throw new Error("login failed");
    const created = await rooms.createBotRoom("silver-age", {
      userId, username: "CompressionUser", deckId: "precon-svi",
    }, "legal", "bravo");
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar], cards: cardData, scripts, seed: 731, startPlayer: 1,
    });
    await db.query("UPDATE rooms SET state = $1, status = 'active' WHERE code = $2", [
      JSON.stringify(encodePersistedState(state, "test-rules")), created.code,
    ]);
    const client = await connect(port, clientCompression);
    expect(client.ws.extensions).toBe(compressed ? "permessage-deflate" : "");
    if (compressed) {
      expect(client.extensionHeader).toContain("server_no_context_takeover");
      expect(client.extensionHeader).toContain("client_no_context_takeover");
    }
    expect((await client.next("queue-status")).frame.compressed).toBe(false);
    client.send({ type: "auth", token: session.token });
    expect((await client.next("authed")).frame.compressed).toBe(false);
    client.send({ type: "join-room", code: created.code, token: created.token });
    await client.next("joined");
    const room = await rooms.getRoom(created.code);
    if (!room) throw new Error("missing room");
    const deliveredState = await client.next("state", (message) =>
      "version" in message && message.version === room.version);
    expect(deliveredState.message).toEqual(stateMessage(room, 0));
    client.send({ type: "bot-ready", runtimeId: BOT_RUNTIME_ID });
    const deliveredTask = await client.next("bot-task");
    const repeatedState = await client.next("state", (message) =>
      "version" in message && message.version === room.version);
    expect(repeatedState.message).toEqual(stateMessage(room, 0));
    expect(decodeStateFrame(repeatedState.wire)).toMatchObject({
      drop: 0, state: { view: { log: [], logEntries: [] } },
    });
    expect(deliveredTask.message).toEqual(clientBotTask(room, BOT_RUNTIME_ID, 0));
    for (const delivered of [deliveredState, deliveredTask]) {
      const jsonBytes = Buffer.byteLength(JSON.stringify(delivered.wire));
      expect(jsonBytes).toBeGreaterThan(1024);
      expect(delivered.frame.compressed).toBe(compressed);
      if (compressed) expect(delivered.frame.bytes).toBeLessThan(jsonBytes / 2);
      else expect(delivered.frame.bytes).toBeGreaterThanOrEqual(jsonBytes);
    }
  }, 10_000);

  it.each(["", "?transport=1", "?transport=3", "//[?transport=2"])("rejects incompatible upgrade targets (%s)", async (query) => {
    const { port } = await gateway();
    const ws = new WebSocket(`ws://127.0.0.1:${port}${query}`);
    const messages: unknown[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(String(raw))));
    const [code] = await once(ws, "close");
    expect(code).toBe(4406);
    expect(messages).toEqual([{ type: "error", code: "INVALID_MESSAGE", message: CLIENT_UPDATE_MESSAGE }]);
  });

  it("enforces the incoming size limit after decompression", async () => {
    vi.stubEnv("WS_COMPRESSION", "true");
    const { port } = await gateway();
    const client = await connect(port);
    expect(client.ws.extensions).toBe("permessage-deflate");
    const closed = once(client.ws, "close");
    client.ws.send(JSON.stringify({ type: "auth", token: "x".repeat(80 * 1024) }), { compress: true });
    expect((await closed)[0]).toBe(1009);
  });

  it("rejects invalid operator settings instead of silently enabling compression", () => {
    expect(() => configuredWebSocketCompression("off")).toThrow("WS_COMPRESSION must be true or false");
  });
});
