import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }

  send(value: string): void {
    this.sent.push(value);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000 } as CloseEvent);
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const player = (seat: 0 | 1) => ({
  seat,
  heroCardId: `HERO${seat}`,
  heroInstanceId: seat,
  heroName: `Hero ${seat}`,
  life: 20,
  actionPoints: 1,
  resources: 0,
  handCount: 0,
  deckCount: 40,
  arsenalCount: 0,
  pitchCount: 0,
  hand: [], arsenal: [], pitch: [], graveyard: [], banish: [], soul: [],
  weapons: [], board: [], equipment: {},
});

const staleState = {
  type: "state",
  version: 99,
  view: {
    gameId: "stale",
    turn: 1,
    phase: "action",
    activePlayer: 0,
    priorityPlayer: 0,
    players: [player(0), player(1)],
    chain: [], stack: [], ongoing: [], pendingDecision: null, winner: null, log: [],
  },
  playerProfiles: [
    { username: "Alice", badge: "early-tester" },
    { username: "Bob", badge: "early-tester" },
  ],
  yourSeat: 0,
  legal: [],
  lastActionAt: [0, 0],
};

function matchPrep(accepted: [boolean, boolean], phase: "accept" | "prepare") {
  return {
    format: "cc",
    seats: [
      { username: "Alice", heroId: "HERO0", heroName: "Hero 0", ready: false, connected: true, accepted: accepted[0] },
      { username: "Bob", heroId: "HERO1", heroName: "Hero 1", ready: false, connected: true, accepted: accepted[1] },
    ],
    yourSeat: 1,
    die: { rolls: [3, 5], winner: 1 },
    startPlayer: null,
    deadlineAt: Date.now() + 30_000,
    deadlinePhase: phase,
  };
}

beforeEach(() => {
  vi.resetModules();
  FakeWebSocket.instances = [];
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("location", { hostname: "localhost", pathname: "/" });
  vi.stubGlobal("history", { pushState: vi.fn(), replaceState: vi.fn() });
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(async () => {
  await vi.dynamicImportSettled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("client connection and account race fences", () => {
  it("keeps restored accounts in deck-loading state until their decks resolve", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const decks = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      if (String(input).endsWith("/api/decks")) return decks.promise;
      throw new Error(`unexpected fetch ${String(input)}`);
    }));

    const { useStore } = await import("../store.js");
    expect(useStore.getState().decksLoading).toBe(true);

    const refreshPromise = useStore.getState().refreshDecks();
    decks.resolve(jsonResponse({ ok: true, decks: [] }));
    await refreshPromise;

    expect(useStore.getState().decksLoading).toBe(false);
  });

  it("loads Quick Play preferences for the active account only", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    localStorage.setItem("fyendal-lobby-settings-alice", JSON.stringify({
      version: 2,
      allowFutureCards: { cc: false, "silver-age": true },
      lastPlayedDeck: { format: "silver-age", deckId: "precon-sba" },
    }));
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (url.endsWith("/api/login")) {
        return Promise.resolve(jsonResponse({ ok: true, token: "token-b", username: "Bob" }));
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const { useStore } = await import("../store.js");
    expect(useStore.getState().lastPlayedDecks).toEqual({
      cc: null,
      "silver-age": "precon-sba",
    });

    await useStore.getState().logout();
    expect(useStore.getState().lastPlayedDecks).toEqual({ cc: null, "silver-age": null });
    expect(useStore.getState().allowFutureCards).toEqual({ cc: false, "silver-age": false });

    await useStore.getState().login("Bob", "password");
    expect(useStore.getState().authUser).toBe("Bob");
    expect(useStore.getState().lastPlayedDecks).toEqual({ cc: null, "silver-age": null });
    expect(useStore.getState().allowFutureCards).toEqual({ cc: false, "silver-age": false });
  });

  it("remembers the last played deck independently for each constructed format", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const { useStore } = await import("../store.js");

    useStore.getState().queueJoin("cc", { deckId: "cc-deck" });
    useStore.getState().queueJoin("silver-age", { deckId: "silver-deck" });

    expect(useStore.getState().lastPlayedDecks).toEqual({
      cc: "cc-deck",
      "silver-age": "silver-deck",
    });
    expect(JSON.parse(localStorage.getItem("fyendal-lobby-settings-alice")!)).toEqual({
      version: 3,
      allowFutureCards: { cc: false, "silver-age": false },
      lastPlayedDecks: { cc: "cc-deck", "silver-age": "silver-deck" },
    });
  });

  it("keeps a declined room only for an unchanged matchmaking choice", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "account-token", username: "Alice" }));
    const { useStore } = await import("../store.js");
    useStore.getState().listRooms();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    useStore.getState().queueJoin("cc", { deckId: "deck-a" });
    useStore.setState({
      screen: "waiting",
      roomCode: "ABC123",
      yourSeat: 1,
      matchAcceptanceRole: "joining",
    });

    useStore.getState().declineMatch();
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({ type: "leave-room" });

    useStore.getState().queueJoin("cc", { deckId: "deck-a" });
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({
      type: "queue-join",
      format: "cc",
      deckId: "deck-a",
      avoidRoomCodes: ["ABC123"],
    });

    useStore.getState().queueJoin("cc", { deckId: "deck-b" });
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: "queue-join",
      format: "cc",
      deckId: "deck-b",
    });

    useStore.setState({ roomCode: "DEF456", screen: "waiting" });
    useStore.getState().declineMatch();
    useStore.getState().queueJoin("silver-age", { deckId: "deck-b" });
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: "queue-join",
      format: "silver-age",
      deckId: "deck-b",
    });
  });

  it("keeps a matchmaking joiner outside prep until they accept", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().listRooms();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    useStore.setState({ queuedFormat: "cc" });

    socket.message({ type: "joined", code: "AAAAAA", seat: 1, token: "seat", version: 1 });
    socket.message({ type: "prep-state", prep: matchPrep([false, false], "accept"), version: 2 });

    expect(useStore.getState()).toMatchObject({
      screen: "waiting",
      matchAcceptanceRole: "joining",
      queuedFormat: null,
    });

    socket.message({ type: "prep-state", prep: matchPrep([false, true], "accept"), version: 3 });
    expect(useStore.getState()).toMatchObject({
      screen: "prep",
      matchAcceptanceRole: "joining",
    });

    socket.message({ type: "prep-state", prep: matchPrep([true, true], "prepare"), version: 4 });
    expect(useStore.getState()).toMatchObject({
      screen: "prep",
      matchAcceptanceRole: null,
    });
  });

  it("keeps the queued room owner in prep for the centered accept prompt", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().listRooms();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    useStore.setState({ queuedFormat: "cc" });

    socket.message({ type: "room-created", code: "AAAAAA", seat: 0, token: "seat", version: 1 });
    socket.message({
      type: "prep-state",
      prep: { ...matchPrep([false, false], "accept"), yourSeat: 0 },
      version: 2,
    });

    expect(useStore.getState()).toMatchObject({
      screen: "prep",
      matchAcceptanceRole: "existing",
      queuedFormat: null,
    });
  });

  it("signs a newly registered invitee in immediately", async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/register")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          username: "NewPlayer",
          password: "password1",
        });
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.endsWith("/api/login")) {
        return Promise.resolve(jsonResponse({
          ok: true,
          token: "new-player-token",
          username: "NewPlayer",
        }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useStore } = await import("../store.js");

    await expect(useStore.getState().register("NewPlayer", "password1"))
      .resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "http://localhost:8080/api/register",
      "http://localhost:8080/api/login",
    ]);
    expect(useStore.getState()).toMatchObject({
      authUser: "NewPlayer",
      authToken: "new-player-token",
    });
    expect(localStorage.getItem("fyendal-auth")).toBe(JSON.stringify({
      token: "new-player-token",
      username: "NewPlayer",
    }));
  });

  it("coalesces duplicate room recovery attempts before the socket opens", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "account-token", username: "Alice" }));
    localStorage.setItem("fyendal-room-session", JSON.stringify({
      code: "AAAAAA",
      token: "seat-token",
    }));
    const { useStore } = await import("../store.js");

    // React Strict Mode runs the App startup effect twice in development.
    useStore.getState().joinRoom("AAAAAA");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "auth", token: "account-token" },
      { type: "join-room", code: "AAAAAA", token: "seat-token" },
    ]);
  });

  it("shows a neutral loading screen until saved game state arrives", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "account-token", username: "Alice" }));
    localStorage.setItem("fyendal-room-session", JSON.stringify({
      code: "AAAAAA",
      token: "seat-token",
    }));
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    expect(useStore.getState()).toMatchObject({
      screen: "room-loading",
      roomCode: "AAAAAA",
      view: null,
    });

    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "rotated", version: 1 });
    expect(useStore.getState().screen).toBe("room-loading");

    socket.message({ ...staleState, version: 2 });
    expect(useStore.getState()).toMatchObject({
      screen: "game",
      roomCode: "AAAAAA",
      view: staleState.view,
    });
  });

  it("moves a restored prep spectator from loading to the waiting screen", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "account-token", username: "Alice" }));
    localStorage.setItem("fyendal-room-session", JSON.stringify({
      code: "AAAAAA",
      token: "spectator-token",
    }));
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({
      type: "joined",
      code: "AAAAAA",
      seat: null,
      token: "rotated",
      spectator: true,
      version: 1,
    });

    expect(useStore.getState()).toMatchObject({
      screen: "waiting",
      spectating: true,
      roomCode: "AAAAAA",
    });
  });

  it("retries a saved room recovery across a temporary server outage", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "account-token", username: "Alice" }));
    localStorage.setItem("fyendal-room-session", JSON.stringify({
      code: "AAAAAA",
      token: "seat-token",
    }));
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    const unavailable = FakeWebSocket.instances[0]!;
    unavailable.open();
    unavailable.close();

    expect(useStore.getState()).toMatchObject({
      screen: "room-loading",
      roomCode: "AAAAAA",
      connected: false,
      error: null,
    });
    expect(localStorage.getItem("fyendal-room-session")).toContain("seat-token");

    await vi.advanceTimersByTimeAsync(1_000);
    const recovered = FakeWebSocket.instances[1]!;
    recovered.open();
    expect(recovered.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "auth", token: "account-token" },
      { type: "join-room", code: "AAAAAA", token: "seat-token" },
    ]);
  });

  it("ignores every frame from a socket superseded by a newer room connection", async () => {
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.message({ type: "joined", code: "AAAAAA", seat: 0, token: "old", version: 1 });
    first.message({ type: "game-started", version: 2 });
    useStore.getState().leave();

    useStore.getState().joinRoom("BBBBBB");
    const second = FakeWebSocket.instances[1]!;
    second.open();
    second.message({ type: "joined", code: "BBBBBB", seat: 1, token: "new", version: 1 });

    first.message({ type: "joined", code: "CCCCCC", seat: 0, token: "stale", version: 100 });
    first.message(staleState);
    first.message({ type: "error", code: "ROOM_NOT_FOUND", message: "old room vanished" });

    expect(useStore.getState()).toMatchObject({
      roomCode: "BBBBBB",
      yourSeat: 1,
      view: null,
      error: null,
    });
    expect(localStorage.getItem("fyendal-room-session")).toContain("BBBBBB");
  });

  it("aborts and discards deck work from a previous account", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const decks = deferred<Response>();
    const imported = deferred<Response>();
    const deleted = deferred<Response>();
    const signals: AbortSignal[] = [];

    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.signal) signals.push(init.signal);
      if (url.endsWith("/api/decks")) return decks.promise;
      if (url.endsWith("/api/decks/import")) return imported.promise;
      if (url.endsWith("/api/decks/delete")) return deleted.promise;
      if (url.endsWith("/api/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (url.endsWith("/api/login")) {
        return Promise.resolve(jsonResponse({ ok: true, token: "token-b", username: "Bob" }));
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const { useStore } = await import("../store.js");
    const oldDeck = {
      id: "old", name: "Old", format: "silver-age" as const, fabraryUrl: null,
      heroName: "Old Hero", deckSize: 40, updatedAt: 1,
    };
    useStore.setState({ decks: [oldDeck] });

    const refreshPromise = useStore.getState().refreshDecks();
    const importPromise = useStore.getState().importDeck({
      name: "Imported", format: "silver-age", text: "deck",
    });
    const deletePromise = useStore.getState().deleteDeck("old");

    await useStore.getState().logout();
    await useStore.getState().login("Bob", "password");
    const bobDeck = { ...oldDeck, id: "bob", name: "Bob's deck" };
    useStore.setState({ decks: [bobDeck] });

    decks.resolve(jsonResponse({ ok: true, decks: [oldDeck] }));
    imported.resolve(jsonResponse({ ok: true, deck: oldDeck }));
    deleted.resolve(jsonResponse({ ok: true }));
    await Promise.all([refreshPromise, importPromise, deletePromise]);

    expect(signals.slice(0, 3).every((signal) => signal.aborted)).toBe(true);
    expect(useStore.getState().authUser).toBe("Bob");
    expect(useStore.getState().decks).toEqual([bobDeck]);
  });

  it("replaces a saved deck summary after a successful edit", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const original = {
      id: "deck-1", name: "Original", format: "silver-age" as const, fabraryUrl: null,
      heroName: "Briar", deckSize: 40, updatedAt: 1,
    };
    const updated = {
      ...original,
      name: "Updated",
      fabraryUrl: "https://fabrary.net/decks/updated",
      updatedAt: 2,
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      if (String(input).endsWith("/api/decks/update")) {
        return Promise.resolve(jsonResponse({ ok: true, deck: updated }));
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useStore } = await import("../store.js");
    useStore.setState({ decks: [original] });
    const result = await useStore.getState().updateDeck({
      id: original.id,
      name: updated.name,
      url: updated.fabraryUrl,
    });

    expect(result).toEqual({ ok: true, deck: updated });
    expect(useStore.getState().decks).toEqual([updated]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("submits bug reports for the current authenticated room", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      ok: true,
      reportId: "report-123",
    })));
    vi.stubGlobal("fetch", fetchMock);
    const { useStore } = await import("../store.js");
    useStore.setState({ roomCode: "ABC123" });

    await expect(useStore.getState().reportBug("Combat damage was calculated incorrectly."))
      .resolves.toEqual({ ok: true, reportId: "report-123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/bug-reports",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer token-a" }),
        body: JSON.stringify({
          roomCode: "ABC123",
          description: "Combat damage was calculated incorrectly.",
        }),
      }),
    );
  });

  it("inspects invite URLs before joining and creates hosted rooms as private", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const { useStore } = await import("../store.js");

    useStore.getState().inspectRoom("ABC123");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: "inspect-room",
      code: "ABC123",
    });

    socket.message({
      type: "room-info",
      room: { code: "ABC123", format: "silver-age" },
    });
    expect(useStore.getState().inviteRoom).toEqual({ code: "ABC123", format: "silver-age" });

    useStore.getState().createRoom("silver-age", { deckId: "precon-sba" });
    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: "create-room",
      format: "silver-age",
      deckId: "precon-sba",
      private: true,
    });

    useStore.getState().createRoom("cc", { deckId: "precon-asb" }, "public");
    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: "create-room",
      format: "cc",
      deckId: "precon-asb",
      private: false,
    });
  });

  it("ends a projected bot game instead of leaving it reconnectable", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const { useStore } = await import("../store.js");

    useStore.getState().setLobbyRail("replays");
    useStore.getState().createBotRoom("silver-age", "precon-svi");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: "create-bot-room",
      format: "silver-age",
      deckId: "precon-svi",
    });
    socket.message({ type: "room-created", code: "BOT001", seat: 0, token: "seat", version: 1 });
    socket.message({
      ...staleState,
      version: 2,
      botGame: true,
      view: { ...staleState.view, gameId: "BOT001" },
    });

    expect(useStore.getState()).toMatchObject({ screen: "game", botGame: true });
    useStore.getState().leave();
    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: "leave-room",
      endGame: true,
    });
    expect(useStore.getState()).toMatchObject({
      screen: "lobby",
      lobbyRail: "replays",
      botGame: false,
    });
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
  });

  it("waits for the matchmaking room to release before starting bot practice", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const { useStore } = await import("../store.js");

    useStore.getState().queueJoin("cc", { deckId: "precon-asb" });
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "queued", format: "cc" });
    socket.message({ type: "room-created", code: "QUEUE1", seat: 0, token: "seat", version: 1 });

    expect(useStore.getState()).toMatchObject({
      screen: "prep",
      roomCode: "QUEUE1",
      matchmakingActive: true,
    });

    useStore.getState().playBotFromPrep("cc", "precon-asb", "ira");
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "leave-room" });
    expect(socket.sent.map((message) => JSON.parse(message)))
      .not.toContainEqual(expect.objectContaining({ type: "create-bot-room" }));

    socket.message({ type: "left" });
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: "create-bot-room",
      format: "cc",
      deckId: "precon-asb",
      bot: "ira",
    });
    expect(useStore.getState()).toMatchObject({
      roomCode: null,
      matchmakingActive: false,
      botGame: true,
    });
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
  });

  it("does not carry disconnected-opponent state into the next game", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat", version: 1 });
    socket.message({ type: "opponent-disconnected", version: 2 });
    expect(useStore.getState().opponentConnected).toBe(false);

    useStore.getState().leave();
    expect(useStore.getState().opponentConnected).toBe(true);
    useStore.getState().createBotRoom("silver-age", "precon-svi");
    socket.message({ type: "room-created", code: "BOT001", seat: 0, token: "bot", version: 1 });
    socket.message({ type: "game-started", version: 2 });
    expect(useStore.getState().opponentConnected).toBe(true);
  });

  it("returns deck deletion failures without removing the deck", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(
      jsonResponse({ ok: false, error: "delete failed" }),
    )));
    const { useStore } = await import("../store.js");
    const deck = {
      id: "deck-1", name: "Deck", format: "cc" as const, fabraryUrl: null,
      heroName: "Hero", deckSize: 60, updatedAt: 1,
    };
    useStore.setState({ decks: [deck] });

    await expect(useStore.getState().deleteDeck(deck.id)).resolves.toEqual({
      ok: false,
      error: "delete failed",
    });
    expect(useStore.getState().decks).toEqual([deck]);
  });

  it("removes a saved replay after the server accepts its deletion", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:8080/api/replays/delete");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ id: "replay-1" });
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useStore } = await import("../store.js");
    const replay = {
      id: "replay-1",
      format: "cc" as const,
      heroIds: ["HERO0", "HERO1"] as [string, string],
      yourSeat: 0 as const,
      winner: 0 as const,
      finishedAt: 1,
      expiresAt: 2,
      frameCount: 3,
    };
    useStore.setState({ savedReplays: [replay] });

    await expect(useStore.getState().deleteSavedReplay(replay.id)).resolves.toEqual({ ok: true });
    expect(useStore.getState().savedReplays).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("routes saved replays but keeps imported replay files local-only", async () => {
    const replayId = "0123456789abcdef01234567";
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      expect(String(input)).toBe(`http://localhost:8080/api/replays/${replayId}`);
      return Promise.resolve(jsonResponse({
        ok: true,
        replay: { version: 1, seat: 0, views: [staleState.view] },
      }));
    }));
    const { useStore } = await import("../store.js");

    await expect(useStore.getState().watchSavedReplay(replayId)).resolves.toBeNull();
    expect(history.pushState).toHaveBeenCalledWith(null, "", `/replays/${replayId}`);
    expect(useStore.getState()).toMatchObject({
      screen: "replay",
      activeSavedReplayId: replayId,
    });

    useStore.getState().closeReplay();
    const imported = JSON.stringify({ version: 1, seat: 0, views: [staleState.view] });
    expect(useStore.getState().openReplayText(imported)).toBeNull();
    expect(useStore.getState()).toMatchObject({
      screen: "replay",
      activeSavedReplayId: null,
    });
    expect(history.pushState).toHaveBeenCalledOnce();
  });

  it("waits for authoritative game-over frames before opening an immediate replay", async () => {
    const roomReplay = deferred<Response>();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/replays/room/BOT001")) return roomReplay.promise;
      if (url.endsWith("/api/replays")) {
        return Promise.resolve(jsonResponse({ ok: true, replays: [] }));
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const { useStore } = await import("../store.js");

    useStore.getState().createBotRoom("silver-age", "precon-svi");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "room-created", code: "BOT001", seat: 0, token: "seat", version: 1 });
    socket.message({ type: "game-started", version: 2 });
    const finalView = { ...staleState.view, gameId: "BOT001", winner: 0 };
    socket.message({
      ...staleState,
      version: 3,
      botGame: true,
      view: finalView,
    });

    const watch = useStore.getState().watchReplay();
    expect(useStore.getState()).toMatchObject({
      screen: "game",
      replayFrames: 1,
      replayViews: null,
    });

    const authoritativeViews = [
      { ...staleState.view, gameId: "BOT001", turn: 1 },
      { ...staleState.view, gameId: "BOT001", turn: 2 },
      finalView,
    ];
    roomReplay.resolve(jsonResponse({
      ok: true,
      replay: { version: 1, seat: 0, views: authoritativeViews },
    }));
    await watch;

    expect(useStore.getState()).toMatchObject({
      screen: "replay",
      replayFrames: 3,
      replayViews: authoritativeViews,
      replayStep: 0,
      view: authoritativeViews[0],
    });
  });

  it("does not reset the local replay on repeated sync game-started announcements", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().createBotRoom("silver-age", "precon-svi");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "room-created", code: "BOT001", seat: 0, token: "seat", version: 1 });
    const firstView = { ...staleState.view, gameId: "BOT001", turn: 1 };
    const secondView = { ...staleState.view, gameId: "BOT001", turn: 2 };

    socket.message({ type: "game-started", version: 2 });
    socket.message({ ...staleState, version: 2, botGame: true, view: firstView });
    socket.message({ type: "game-started", version: 3 });
    socket.message({ ...staleState, version: 3, botGame: true, view: secondView });

    expect(useStore.getState()).toMatchObject({
      screen: "game",
      replayFrames: 2,
      view: secondView,
    });
    await useStore.getState().watchReplay();
    expect(useStore.getState()).toMatchObject({
      screen: "replay",
      replayViews: [firstView, secondView],
    });
  });

  it("clears all private and account-owned state after auth failure", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const { useStore } = await import("../store.js");
    useStore.setState({
      roomCode: "AAAAAA",
      yourSeat: 0,
      decks: [{
        id: "private", name: "Private", format: "cc", fabraryUrl: null,
        heroName: "Hero", deckSize: 60, updatedAt: 1,
      }],
      queuedFormat: "cc",
      screen: "waiting",
    });

    useStore.getState().listRooms();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "auth-failed" });

    expect(useStore.getState()).toMatchObject({
      screen: "lobby",
      authToken: null,
      authUser: null,
      roomCode: null,
      yourSeat: null,
      decks: [],
      queuedFormat: null,
      prep: null,
      prepDeck: null,
      view: null,
      legal: [],
    });
    expect(localStorage.getItem("fyendal-auth")).toBeNull();
    expect(localStorage.getItem("fyendal-room-session")).toBeNull();
  });

  it("drops stale room projections and reconnects normally on RESYNC_REQUIRED", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    socket.message({ ...staleState, version: 2 });
    expect(useStore.getState().view).not.toBeNull();

    socket.message({
      type: "error",
      code: "RESYNC_REQUIRED",
      message: "room state must be reloaded",
    });

    expect(useStore.getState()).toMatchObject({
      roomCode: "AAAAAA",
      connected: false,
      screen: "room-loading",
      view: null,
      legal: [],
      prep: null,
    });
    expect(localStorage.getItem("fyendal-room-session")).toContain("seat-token");
    useStore.getState().leave();
  });

  it("allows only one versioned room command until a newer state arrives", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    socket.message({ ...staleState, version: 2, legal: [{ kind: "pass" }, { kind: "close-chain" }] });
    socket.sent = [];

    expect(useStore.getState().sendIntent({ kind: "pass" })).toBe(true);
    expect(useStore.getState().sendIntent({ kind: "close-chain" })).toBe(false);

    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      expect.objectContaining({
        type: "intent",
        intent: { kind: "pass" },
        expectedVersion: 2,
        commandId: expect.any(String),
      }),
    ]);

    socket.message({ ...staleState, version: 3, legal: [{ kind: "close-chain" }] });
    useStore.getState().sendIntent({ kind: "close-chain" });

    expect(socket.sent.map((value) => JSON.parse(value))).toHaveLength(2);
    expect(JSON.parse(socket.sent[1]!)).toEqual(expect.objectContaining({
      type: "intent",
      intent: { kind: "close-chain" },
      expectedVersion: 3,
    }));
    useStore.getState().leave();
  });

  it("exposes a submitted card play only until its authoritative acknowledgement", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    const playedCard = { instanceId: 10, cardId: "TST010", owner: 0 };
    const playState = {
      ...staleState,
      version: 2,
      view: {
        ...staleState.view,
        players: [
          { ...staleState.view.players[0], hand: [playedCard], handCount: 1 },
          staleState.view.players[1],
        ],
      },
      legal: [{ kind: "play-card", instanceId: 10, pitchInstanceIds: [] }],
    };
    socket.message(playState);

    expect(useStore.getState().sendIntent({
      kind: "play-card",
      instanceId: 10,
      pitchInstanceIds: [],
    })).toBe(true);
    expect(useStore.getState().pendingCardPlay).toEqual({
      commandId: expect.any(String),
      expectedVersion: 2,
      intent: { kind: "play-card", instanceId: 10, pitchInstanceIds: [] },
    });

    const acknowledgementProjections: { pending: boolean; handCount: number }[] = [];
    const unsubscribe = useStore.subscribe((state) => {
      acknowledgementProjections.push({
        pending: state.pendingCardPlay !== null,
        handCount: state.view?.players[0]?.handCount ?? -1,
      });
    });

    socket.message({
      ...playState,
      version: 3,
      view: {
        ...playState.view,
        players: [
          { ...playState.view.players[0], hand: [], handCount: 0 },
          playState.view.players[1],
        ],
      },
      legal: [],
    });

    unsubscribe();
    expect(useStore.getState().pendingCardPlay).toBeNull();
    expect(acknowledgementProjections).toEqual([{ pending: false, handCount: 0 }]);
    useStore.getState().leave();
  });

  it("does not let version-neutral preferences occupy the state-command gate", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    socket.message({ ...staleState, version: 2, legal: [{ kind: "pass" }] });
    socket.sent = [];

    useStore.getState().sendPriorityMode("always-pause");
    useStore.getState().sendRunechantSkip(false);
    useStore.getState().sendIntent({ kind: "pass" });

    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      expect.objectContaining({ type: "priority-mode", mode: "always-pause", expectedVersion: 2 }),
      expect.objectContaining({ type: "runechant-skip", enabled: false, expectedVersion: 2 }),
      expect.objectContaining({ type: "intent", intent: { kind: "pass" }, expectedVersion: 2 }),
    ]);
    useStore.getState().leave();
  });

  it("coalesces rapid defender staging and flushes it with the acknowledged version", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    const defenderA = { instanceId: 11, cardId: "TST011", owner: 0 };
    const defenderB = { instanceId: 12, cardId: "TST012", owner: 0 };
    const defendState = {
      ...staleState,
      version: 2,
      view: {
        ...staleState.view,
        players: [
          { ...staleState.view.players[0], hand: [defenderA, defenderB], handCount: 2 },
          staleState.view.players[1],
        ],
        pendingDecision: {
          player: 0,
          kind: "defend",
          prompt: "Choose defenders",
          stagedCards: [],
          stagedDefense: 0,
        },
      },
      legal: [
        { kind: "stage-defenders", instanceIds: [11] },
        { kind: "stage-defenders", instanceIds: [12] },
      ],
    };
    socket.message(defendState);
    socket.sent = [];

    useStore.getState().sendIntent({ kind: "stage-defenders", instanceIds: [11] });
    // The board still renders the last authoritative [] set at this point, so
    // its second click asks for [12]. The store must preserve the pending 11.
    useStore.getState().sendIntent({ kind: "stage-defenders", instanceIds: [12] });

    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      expect.objectContaining({
        type: "intent",
        intent: { kind: "stage-defenders", instanceIds: [11] },
        expectedVersion: 2,
      }),
    ]);

    socket.message({
      ...defendState,
      version: 3,
      view: {
        ...defendState.view,
        pendingDecision: {
          ...defendState.view.pendingDecision,
          stagedCards: [defenderA],
          stagedDefense: 3,
        },
      },
    });

    expect(socket.sent.map((value) => JSON.parse(value))).toHaveLength(2);
    expect(JSON.parse(socket.sent[1]!)).toEqual(expect.objectContaining({
      type: "intent",
      intent: { kind: "stage-defenders", instanceIds: [11, 12] },
      expectedVersion: 3,
    }));
    useStore.getState().leave();
  });

  it("silently reloads the room when a stale version conflict still occurs", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    socket.message({ ...staleState, version: 2, legal: [{ kind: "pass" }] });
    useStore.getState().sendIntent({ kind: "pass" });

    socket.message({ type: "error", code: "RESYNC_REQUIRED", message: "stale room version" });

    expect(useStore.getState()).toMatchObject({
      roomCode: "AAAAAA",
      connected: false,
      screen: "room-loading",
      view: null,
      legal: [],
      error: null,
    });
    expect(localStorage.getItem("fyendal-room-session")).toContain("seat-token");
    useStore.getState().leave();
  });

  it("abandons a room entry when its authoritative state cannot be decoded", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    localStorage.setItem("fyendal-room-session", JSON.stringify({
      code: "AAAAAA",
      token: "seat-token",
    }));
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "rotated", version: 1 });
    socket.message({ type: "state", version: 2, invalid: true });

    expect(useStore.getState()).toMatchObject({
      screen: "lobby",
      roomCode: null,
      yourSeat: null,
      prep: null,
      view: null,
      connected: false,
      error: "room state could not be loaded",
    });
    expect(localStorage.getItem("fyendal-room-session")).toBeNull();
    expect(history.replaceState).toHaveBeenLastCalledWith(null, "", "/");
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("abandons a room entry rejected before the joined acknowledgement", async () => {
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({
      type: "error",
      code: "INTERNAL_ERROR",
      message: "internal error",
    });

    expect(useStore.getState()).toMatchObject({
      screen: "lobby",
      roomCode: null,
      connected: false,
      error: "internal error",
    });
    expect(history.replaceState).toHaveBeenLastCalledWith(null, "", "/");
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("abandons a room entry when the socket closes before joining", async () => {
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.close();

    expect(useStore.getState()).toMatchObject({
      screen: "lobby",
      roomCode: null,
      connected: false,
      error: "connection to room failed",
    });
    expect(history.replaceState).toHaveBeenLastCalledWith(null, "", "/");
  });
});
