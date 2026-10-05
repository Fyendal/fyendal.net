import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { botDefinition, botDefinitions, botObservationKey } from "@fyendal/bot";
import { ClientBotPolicy } from "@fyendal/bot/client-task";
import { isAdvertisedBotIntent } from "@fyendal/bot/intents";
import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import {
  decodeBotTask, decodeBotWorkerResponse, decodeClientMessage, decodeServerMessage, MAX_BOT_TASK_BYTES,
  LiveServerMessageDecoder, liveWebSocketUrl,
} from "@fyendal/protocol";
import type { ClientBotTask, GameIntent, ServerMessage } from "@fyendal/shared";
import { clientBotTask } from "../clientBotTask.js";
import { decodePersistedState, encodePersistedState } from "../persistedState.js";
import { PgRoomStore, type RoomRow } from "../store.js";
import { RoomBroadcaster } from "../roomBroadcaster.js";
import { freshDb } from "./testdb.js";
import { hashPassword, login } from "../auth.js";
import { closeGameServer, createGameServer } from "../index.js";
import { BOT_RUNTIME_ID } from "@fyendal/bot/runtime-id";
import { ClusterEventConsumer } from "../clusterEvents.js";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { ClientMessage } from "@fyendal/shared";

const runtimeId = "a".repeat(64);

async function fixture() {
  const db = await freshDb();
  const store = new PgRoomStore(db, "test-rules");
  const user = await db.query("INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ('ClientBot','clientbot','hash',1) RETURNING id");
  const userId = Number(user.rows[0]!.id);
  const created = await store.createBotRoom("silver-age", { userId, username: "ClientBot", deckId: "precon-svi" }, "legal", "bravo");
  const room = (await store.getRoom(created.code))!;
  room.state = createGame({ decklists: [decklists.dorinthea, decklists.rhinar], cards: cardData, scripts, seed: 731, startPlayer: 1 });
  room.state.turn = 2;
  await db.query("UPDATE rooms SET state = $1, status = 'active' WHERE code = $2", [JSON.stringify(encodePersistedState(room.state, room.rulesetVersion)), room.code]);
  return { db, store, room, credentials: { token: created.token, userId } };
}

function task(room: RoomRow): ClientBotTask {
  const result = clientBotTask(room, runtimeId, 0);
  if (result?.type !== "bot-task") throw new Error("expected bot task");
  return result;
}

describe("client bot tasks", () => {
  it.each(["unrestricted", "bot-choice", "war", "peace"] as const)(
    "preserves Warmonger's Diplomacy through Hala's Edict and sword worker turn (%s)",
    async (mode) => {
      const { room } = await fixture();
      room.seats[1]!.deckId = "precon-hala-masterclass";
      let state = createGame({
        decklists: [decklists.rhinar, {
          heroId: "MPW003", weaponIds: ["MPW005"], equipment: { arms: "AHA005" },
          deck: ["MPW103", "MPW121", "HNT117", "HNT117"],
        }],
        cards: cardData, scripts, seed: 731, startPlayer: 0,
      });
      for (const player of state.players) {
        player.deck = [];
        player.hand = (player.seat === 0 ? ["DTD230"] : ["MPW103", "MPW121", "HNT117", "HNT117"])
          .map((cardId) => ({ cardId, owner: player.seat, instanceId: state.nextInstanceId++ }));
      }
      const browser = new ClientBotPolicy();
      const edict = state.players[1].hand[0]!;
      const sword = state.players[1].weapons[0]!;
      const botIntents: GameIntent[] = [];
      let chosenMode: string = mode;
      for (let step = 0; step < 120 && state.turn < 3; step++) {
        const json: unknown = JSON.parse(JSON.stringify(encodePersistedState(state, room.rulesetVersion)));
        state = decodePersistedState(json, room.code, cardData, scripts, room.rulesetVersion);
        room.state = state;
        const actor = state.pendingDecision?.player ?? state.priorityPlayer;
        const legal = legalIntents(state, actor);
        let intent: GameIntent | undefined;
        if (step === 0 && mode !== "unrestricted") {
          intent = legal.find((candidate) => candidate.kind === "play-card" &&
            candidate.instanceId === state.players[0].hand[0]!.instanceId);
        } else if (actor === 1) {
          intent = state.pendingDecision?.chooseHook === "diplomacy-opponent" && mode !== "bot-choice"
            ? legal.find((candidate) => candidate.kind === "choose" && candidate.optionId === mode)
            : browser.decide(task(room));
          if (state.pendingDecision?.chooseHook === "diplomacy-opponent" && intent?.kind === "choose") {
            chosenMode = intent.optionId;
          }
        } else if (state.pendingDecision?.chooseHook === "diplomacy-self") {
          intent = legal.find((candidate) => candidate.kind === "choose" && candidate.optionId === "peace");
        } else if (state.pendingDecision?.kind === "defend") {
          intent = legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0);
        } else {
          intent = legal.find((candidate) => candidate.kind === "pass" ||
            (candidate.kind === "choose" && candidate.optionId === "pass"));
        }
        expect(intent).toBeDefined();
        if (!intent) throw new Error("expected turn continuation");
        if (actor === 1) botIntents.push(intent);
        const result = applyIntent(state, actor, intent);
        if (!result.ok) throw new Error(result.error);
        state = result.state;
      }
      expect(state.turn).toBe(3);
      const playedEdict = botIntents.some((intent) =>
        intent.kind === "play-card" && intent.instanceId === edict.instanceId);
      const attackedWithSword = botIntents.some((intent) =>
        intent.kind === "activate-ability" && intent.sourceInstanceId === sword.instanceId);
      if (mode !== "unrestricted") expect(["war", "peace"]).toContain(chosenMode);
      if (chosenMode === "unrestricted") {
        expect(playedEdict).toBe(true);
        expect(attackedWithSword).toBe(true);
      } else if (chosenMode === "war") {
        expect(playedEdict).toBe(false);
        expect(attackedWithSword).toBe(true);
      } else {
        expect(attackedWithSword).toBe(false);
      }
    },
  );

  it("keeps mutual draw actions out of bot rooms and delegated tasks", async () => {
    const { store, room, credentials } = await fixture();
    expect(task(room).legal.every((intent) => !intent.kind.endsWith("-draw"))).toBe(true);
    expect(await store.applyIntent(room.code, credentials, { kind: "offer-draw" })).toMatchObject({ ok: false });
    expect(await store.applyBotIntent(room.code, room.version, { kind: "offer-draw" }, {
      credentials,
      command: { id: "no-bot-draw", expectedVersion: room.version },
    })).toMatchObject({ ok: false });
  });

  it("removes private randomness, deck order and history without changing the room", async () => {
    const { room } = await fixture();
    room.state!.log = [{ publicText: "public history", seatText: ["private human history", "private bot history"] }];
    const before = JSON.stringify(encodePersistedState(room.state!, room.rulesetVersion));
    const original = task(room);
    expect(original.simulation).toBeDefined();
    expect(JSON.stringify(encodePersistedState(room.state!, room.rulesetVersion))).toBe(before);
    expect(original.view.log).toEqual([]);
    expect(original.simulation!.state.log).toEqual([]);
    expect(original.simulation!.state.seed).not.toBe(room.state!.seed);
    expect(original.simulation!.state.rngState).not.toBe(room.state!.rngState);
    room.state!.seed = 991;
    room.state!.rngState = 771;
    for (const player of room.state!.players) player.deck.reverse();
    expect(task(room)).toEqual(original);
    expect(decodeServerMessage(original)).toEqual(original);
    expect(JSON.stringify(original)).not.toContain("cardsRef");
    expect(JSON.stringify(original)).not.toContain("scriptsRef");
    expect(JSON.stringify(original)).not.toContain("private human history");
  });

  it.each(botDefinitions)("runs $id with the existing policy and validates its real move", async (definition) => {
    const { room } = await fixture();
    const pool = precon(definition.deckId)!.pool;
    room.seats[1]!.deckId = definition.deckId;
    room.state = createGame({ decklists: [decklists.dorinthea, { heroId: pool.heroId, ...definition.presentationFor(decklists.dorinthea, "first") }], cards: cardData, scripts, seed: 700, startPlayer: 1 });
    room.state.turn = 2;
    const input = task(room);
    const browser = new ClientBotPolicy();
    const reference = new ClientBotPolicy();
    const intent = browser.decide(input);
    expect(intent).toEqual(reference.decide(input));
    expect(isAdvertisedBotIntent(intent, input.legal)).toBe(true);
    expect(applyIntent(room.state, 1, intent).ok).toBe(true);
    expect(JSON.stringify(input).length).toBeLessThan(32_000);
    const reacted = applyIntent(room.state, 1, intent);
    if (!reacted.ok) throw new Error(reacted.error);
    room.state = reacted.state;
    if ((room.state.pendingDecision?.player ?? room.state.priorityPlayer) === 1) {
      const reactive = task(room);
      if (room.state.phase !== "action") expect(reactive.simulation).toBeUndefined();
      expect(applyIntent(room.state, 1, browser.decide(reactive)).ok).toBe(true);
    }
  });

  it("keeps observation hashes compatible with Node SHA-256", async () => {
    const { room } = await fixture();
    const view = projectStateFor(room.state!, 1, room.code);
    const legal = legalIntents(room.state!, 1);
    const { log: _log, logEntries: _entries, gameStats, ...visible } = view;
    const text = JSON.stringify({ view: { ...visible, ...(gameStats ? { gameStats: { turns: gameStats.turns.slice(-1) } } : {}) }, legal });
    expect(botObservationKey({ view, legal })).toBe(createHash("sha256").update(text).digest("hex"));
  });

  it("uses only guarded continuations matching the room, bot, turn and observation", async () => {
    const { room } = await fixture();
    const input = { ...task(room), botId: "cindra" as const };
    const definition = botDefinition("cindra")!;
    const intent = { kind: "pass" } as const;
    const choose = vi.spyOn(definition, "chooseDecision").mockImplementation((observation) => ({
      intent,
      continuation: [
        { intent, observationKey: botObservationKey(observation) },
        { intent, observationKey: botObservationKey(observation) },
      ],
    }));
    const guard = vi.spyOn(definition, "chooseContinuationIntent").mockReturnValue(intent);
    try {
      const policy = new ClientBotPolicy();
      expect(policy.decide(input)).toEqual(intent);
      expect(policy.decide(input)).toEqual(intent);
      expect(choose).toHaveBeenCalledOnce();
      expect(guard).toHaveBeenCalledOnce();
      for (const altered of [
        { ...input, code: "ZZZ999" },
        { ...input, botId: "starvo" as const },
        { ...input, view: { ...input.view, turn: input.view.turn + 1 } },
        { ...input, view: { ...input.view, log: [], phase: "end" as const } },
      ]) {
        policy.clear(); policy.decide(input);
        guard.mockClear();
        policy.decide(altered);
        expect(guard).not.toHaveBeenCalled();
      }
      policy.clear(); policy.decide(input);
      choose.mockClear(); guard.mockReturnValue(input.legal.find((candidate) => candidate.kind !== "pass")!);
      policy.decide(input);
      expect(choose).toHaveBeenCalledOnce();
    } finally {
      choose.mockRestore(); guard.mockRestore();
    }
  });

  it("bounds unknown tasks and submissions, and requests fallback for oversized snapshots", async () => {
    const { room } = await fixture();
    const input = task(room);
    expect(decodeBotTask({ ...input, extra: 1 })).toBeNull();
    expect(decodeBotTask({ ...input, simulation: { ...input.simulation, extra: 1 } })).toBeNull();
    expect(decodeBotTask({ ...input, version: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
    expect(decodeBotTask({ ...input, delayMs: 10_001 })).toBeNull();
    expect(decodeBotTask({ ...input, fallback: "oversized" })).toBeNull();
    expect(decodeBotTask({ ...input, botId: { toString: "bravo" } })).toBeNull();
    expect(decodeBotTask({ ...input, view: { ...input.view, gameId: "ZZZ999" } })).toBeNull();
    const submission = { type: "bot-intent", runtimeId, commandId: "command-123", expectedVersion: 1, elapsedMs: 5, failure: "timeout" };
    expect(decodeClientMessage(submission)).toEqual(submission);
    expect(decodeClientMessage({ ...submission, intent: { kind: "pass" } })).toBeNull();
    expect(decodeClientMessage({ ...submission, failure: "unknown" })).toBeNull();
    expect(decodeClientMessage({ ...submission, computeMs: Infinity })).toBeNull();
    expect(decodeClientMessage({ ...submission, failure: { toString: "timeout" } })).toBeNull();
    expect(decodeBotWorkerResponse({
      type: "decision", code: room.code, version: 1, intent: { kind: "pass" }, computeMs: 60_001,
    })).toBeNull();
    expect(decodeServerMessage({
      type: "bot-result", code: room.code, version: 1, commandId: "command-123", status: { toString: "applied" },
    })).toBeNull();
    const multibyte = structuredClone(input);
    multibyte.simulation!.state.players[1].flags["界".repeat(Math.ceil(MAX_BOT_TASK_BYTES / 3))] = true;
    expect(JSON.stringify(multibyte).length).toBeLessThan(MAX_BOT_TASK_BYTES);
    expect(decodeBotTask(multibyte)).toBeNull();
    room.state!.players[1].flags["x".repeat(MAX_BOT_TASK_BYTES)] = true;
    expect(clientBotTask(room, runtimeId, 0)).toMatchObject({ type: "bot-fallback-needed" });
  });

  it("never gives spectators or incompatible clients a simulation task", async () => {
    const { store, room } = await fixture();
    const messages: ServerMessage[][] = [[], [], []];
    const clients = messages.map((inbox, index) => ({ code: room.code, index, send: (m: ServerMessage) => inbox.push(m), sendRaw: (s: string) => inbox.push(JSON.parse(s)), close: vi.fn() }));
    const broadcaster = new RoomBroadcaster({ rooms: store, clientsFor: () => clients, authorize: (_room, client) => client.index === 2 ? null : 0, detach: vi.fn(), broadcastLobby: async () => undefined, botRuntimeId: runtimeId, botReady: (client) => client.index === 0 });
    await broadcaster.afterCommit({ code: room.code, kind: "sync", version: room.version });
    expect(messages[0]!.some((m) => m.type === "bot-task")).toBe(true);
    expect(messages[1]!.some((m) => m.type === "bot-runtime")).toBe(true);
    for (const index of [1, 2]) expect(messages[index]!.some((m) => m.type === "bot-task")).toBe(false);
  });

  it("does not negotiate or deliver bot work after game completion", async () => {
    const { db, store, room } = await fixture();
    room.state!.winner = 1;
    room.state!.phase = "game-over";
    await db.query("UPDATE rooms SET state = $1 WHERE code = $2", [
      JSON.stringify(encodePersistedState(room.state!, room.rulesetVersion)), room.code,
    ]);
    const messages: ServerMessage[] = [];
    const client = {
      code: room.code, send: (message: ServerMessage) => messages.push(message),
      sendRaw: (payload: string) => messages.push(JSON.parse(payload)), close: vi.fn(),
    };
    const broadcaster = new RoomBroadcaster({
      rooms: store, clientsFor: () => [client], authorize: () => 0,
      detach: vi.fn(), broadcastLobby: async () => undefined,
      botRuntimeId: runtimeId, botReady: () => false,
    });
    await broadcaster.afterCommit({ code: room.code, kind: "sync", version: room.version });
    expect(messages.some((message) => message.type === "state")).toBe(true);
    expect(messages.some((message) => message.type.startsWith("bot-"))).toBe(false);
  });
});

describe("delegated bot commits", () => {
  it("shares valid bot-room credentials across tabs but fences account recovery", async () => {
    const { store, room, credentials } = await fixture();
    const options = { allowPlayer: true, userId: credentials.userId };
    const tab = await store.joinRoom(room.code, credentials.token, options);
    expect(tab).toMatchObject({ ok: true, token: credentials.token });
    expect(await store.joinRoom(room.code, credentials.token, { ...options, userId: credentials.userId + 1 })).toMatchObject({ ok: false });
    const recovered = await store.joinRoom(room.code, undefined, options);
    if (!recovered.ok) throw new Error(recovered.error);
    expect(recovered.token).not.toBe(credentials.token);
    const command = { id: "recovery-fallback", expectedVersion: recovered.version };
    expect(await store.applyBotIntent(room.code, recovered.version, null, { credentials, command })).toMatchObject({ ok: false });
    expect(await store.applyBotIntent(room.code, recovered.version, null, {
      credentials: { ...credentials, token: recovered.token }, command,
    })).toMatchObject({ ok: true });
  });

  it("fences duplicates and concurrent gateways, and authenticates retries", async () => {
    const { db, store, room, credentials } = await fixture();
    const intent = legalIntents(room.state!, 1)[0]!;
    const delegation = { credentials, command: { id: "client-command-1", expectedVersion: room.version } };
    const other = new PgRoomStore(db, room.rulesetVersion);
    const results = await Promise.all([store.applyBotIntent(room.code, room.version, intent, delegation), other.applyBotIntent(room.code, room.version, intent, delegation)]);
    expect(results.some((r) => r.ok)).toBe(true);
    expect(results.every((r) => r.ok || r.error === "stale room version")).toBe(true);
    expect(await other.applyBotIntent(room.code, room.version, intent, delegation)).toMatchObject({ ok: true });
    expect((await store.getRoom(room.code))!.version).toBe(room.version + 1);
    expect(await store.applyBotIntent(room.code, room.version, intent, { ...delegation, credentials: { ...credentials, userId: credentials.userId + 1 } })).toMatchObject({ ok: false });
    expect(await store.applyBotIntent(room.code, room.version, intent, { ...delegation, credentials: { ...credentials, token: "revoked" } })).toMatchObject({ ok: false });
    expect(await other.applyBotIntent(room.code, room.version, intent, { credentials, command: { id: "client-command-2", expectedVersion: room.version } })).toMatchObject({ ok: false, error: "stale room version" });
  });

  it("commits conservative fallback without invoking bot search", async () => {
    const { store, room, credentials } = await fixture();
    const chooser = vi.spyOn(botDefinitions[0]!, "chooseDecision").mockImplementation(() => { throw new Error("search must not run"); });
    try {
      expect(await store.applyBotIntent(room.code, room.version, null, { credentials, command: { id: "fallback-command", expectedVersion: room.version } })).toMatchObject({ ok: true });
      expect(chooser).not.toHaveBeenCalled();
    } finally { chooser.mockRestore(); }
  });

  it("rejects wrong priority, human rooms, and unadvertised moves", async () => {
    const { db, store, room, credentials } = await fixture();
    const delegation = { credentials, command: { id: "reject-command", expectedVersion: room.version } };
    expect(await store.applyBotIntent(room.code, room.version, { kind: "play-card", instanceId: 99999, pitchInstanceIds: [] }, delegation)).toMatchObject({ ok: false, error: "unadvertised bot intent" });
    room.state!.priorityPlayer = 0;
    await db.query("UPDATE rooms SET state = $1 WHERE code = $2", [JSON.stringify(encodePersistedState(room.state!, room.rulesetVersion)), room.code]);
    expect(await store.applyBotIntent(room.code, room.version, null, delegation)).toMatchObject({ ok: false, error: "bot does not have priority" });
    await db.query("UPDATE room_seats SET controller = 'human' WHERE room_code = $1 AND seat = 1", [room.code]);
    expect(await store.applyBotIntent(room.code, room.version, null, delegation)).toMatchObject({ ok: false, error: "room has no bot" });
  });
});

async function socketClient(port: number) {
  const ws = new WebSocket(liveWebSocketUrl(`ws://127.0.0.1:${port}`));
  const inbox: ServerMessage[] = [];
  const waiters: Array<{ predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  const decoder = new LiveServerMessageDecoder();
  ws.on("message", (raw) => {
    const message = decoder.decode(JSON.parse(String(raw)));
    if (!message) throw new Error("invalid server frame");
    const index = waiters.findIndex((w) => w.predicate(message));
    if (index === -1) inbox.push(message);
    else waiters.splice(index, 1)[0]!.resolve(message);
  });
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return {
    ws,
    send: (message: ClientMessage) => ws.send(JSON.stringify(message)),
    next: (predicate: (m: ServerMessage) => boolean) => new Promise<ServerMessage>((resolve, reject) => {
      const index = inbox.findIndex(predicate);
      if (index !== -1) { resolve(inbox.splice(index, 1)[0]!); return; }
      const timeout = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        reject(new Error(`missing bot frame: ${inbox.map((m) => m.type).join(",")}`));
      }, 5_000);
      const waiter = { predicate, resolve: (message: ServerMessage) => { clearTimeout(timeout); resolve(message); } };
      waiters.push(waiter);
    }),
  };
}

describe("browser bot gateways", () => {
  it("negotiates and recovers bot work on rejoin without cluster polling", async () => {
    const { db, store, room, credentials } = await fixture();
    await db.query("UPDATE users SET pass_hash = $1 WHERE id = $2", [await hashPassword("password1"), credentials.userId]);
    const session = await login(db, "ClientBot", "password1");
    if (!session.ok) throw new Error("login failed");
    const start = vi.spyOn(ClusterEventConsumer.prototype, "start").mockImplementation(() => undefined);
    const nudge = vi.spyOn(ClusterEventConsumer.prototype, "nudge").mockImplementation(() => undefined);
    const server = createGameServer(0, { db, rooms: store, botDelayMs: 0 });
    let client: Awaited<ReturnType<typeof socketClient>> | undefined;
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      client = await socketClient((server.address() as AddressInfo).port);
      client.send({ type: "auth", token: session.token });
      await client.next((m) => m.type === "authed");
      client.send({ type: "join-room", code: room.code, token: credentials.token });
      expect(await client.next((m) => m.type === "joined")).toMatchObject({ resumed: true });
      await client.next((m) => m.type === "state");
      expect(await client.next((m) => m.type === "bot-runtime")).toMatchObject({ runtimeId: BOT_RUNTIME_ID });
      client.send({ type: "bot-ready", runtimeId: BOT_RUNTIME_ID });
      const input = await client.next((m) => m.type === "bot-task");
      if (input.type !== "bot-task") throw new Error("missing task");
      client.send({
        type: "bot-intent", runtimeId: BOT_RUNTIME_ID, commandId: "rejoined-fallback",
        expectedVersion: input.version, elapsedMs: 0, failure: "timeout",
      });
      expect(await client.next((m) => m.type === "bot-result")).toMatchObject({ status: "applied" });
      expect((await store.getRoom(room.code))!.version).toBe(input.version + 1);
    } finally {
      client?.ws.close();
      await closeGameServer(server);
      start.mockRestore();
      nudge.mockRestore();
      await (db as typeof db & { end(): Promise<void> }).end();
    }
  }, 15_000);

  it("recovers across gateways and fences replaced sockets without server search", async () => {
    const { db, store, room, credentials } = await fixture();
    await db.query("UPDATE users SET pass_hash = $1 WHERE id = $2", [await hashPassword("password1"), credentials.userId]);
    const session = await login(db, "ClientBot", "password1");
    if (!session.ok) throw new Error("login failed");
    const searches = botDefinitions.map((definition) => vi.spyOn(definition, "chooseDecision").mockImplementation(() => { throw new Error("server search must not run"); }));
    const servers = [0, 1].map(() => createGameServer(0, { db, rooms: new PgRoomStore(db, room.rulesetVersion), botDelayMs: 0 }));
    const sockets: Awaited<ReturnType<typeof socketClient>>[] = [];
    try {
      await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.once("listening", resolve))));
      for (const server of servers) {
        const client = await socketClient((server.address() as AddressInfo).port);
        sockets.push(client);
        client.send({ type: "auth", token: session.token });
        await client.next((m) => m.type === "authed");
        client.send({ type: "join-room", code: room.code, token: credentials.token });
        await client.next((m) => m.type === "joined");
        await client.next((m) => m.type === "bot-runtime");
        client.send({ type: "bot-ready", runtimeId: BOT_RUNTIME_ID });
      }
      const original = await sockets[0]!.next((m) => m.type === "bot-task");
      const input = await sockets[1]!.next((m) => m.type === "bot-task");
      if (input.type !== "bot-task" || original.type !== "bot-task") throw new Error("missing task");
      expect(input.version).toBeGreaterThan(original.version);
      sockets[1]!.send({ type: "bot-intent", runtimeId: BOT_RUNTIME_ID, commandId: "old-observation", expectedVersion: original.version, elapsedMs: 1, failure: "timeout" });
      expect(await sockets[1]!.next((m) => m.type === "bot-result" && m.commandId === "old-observation")).toMatchObject({ status: "stale" });
      for (const index of [0, 1]) sockets[index]!.send({ type: "bot-intent", runtimeId: BOT_RUNTIME_ID, commandId: `socket-command-${index}`, expectedVersion: input.version, elapsedMs: 1, failure: "timeout" });
      const results = await Promise.all([0, 1].map((index) => sockets[index]!.next((m) => m.type === "bot-result" && m.commandId === `socket-command-${index}`)));
      expect(results.filter((m) => m.type === "bot-result" && m.status === "applied")).toHaveLength(1);
      expect(results.filter((m) => m.type === "bot-result" && m.status === "stale")).toHaveLength(1);
      expect((await store.getRoom(room.code))!.version).toBe(input.version + 1);
      for (const search of searches) expect(search).not.toHaveBeenCalled();
      sockets[0]!.ws.close();
      const resumed = await socketClient((servers[0]!.address() as AddressInfo).port);
      sockets.push(resumed);
      resumed.send({ type: "auth", token: session.token });
      await resumed.next((m) => m.type === "authed");
      resumed.send({ type: "join-room", code: room.code, token: credentials.token });
      await resumed.next((m) => m.type === "bot-runtime");
      resumed.send({ type: "bot-ready", runtimeId: "b".repeat(64) });
      expect(await resumed.next((m) => m.type === "error" && m.message.includes("update browser"))).toMatchObject({ code: "INVALID_MESSAGE" });
      resumed.send({ type: "bot-ready", runtimeId: BOT_RUNTIME_ID });
      await resumed.next((m) => m.type === "state");
      for (const search of searches) expect(search).not.toHaveBeenCalled();
    } finally {
      for (const client of sockets) client.ws.close();
      await Promise.all(servers.map(closeGameServer));
      for (const search of searches) search.mockRestore();
      await (db as typeof db & { end(): Promise<void> }).end();
    }
  }, 15_000);
});
