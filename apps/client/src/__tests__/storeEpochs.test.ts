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

const fabraryUrl = "https://fabrary.net/decks/01M1WZTPC64GDCMN2GX752E3R7";
const fabraryDeck = {
  id: "linked-deck", name: "Fabrary deck", format: "cc" as const, fabraryUrl,
  heroName: "Rhinar, Reckless Rampage", deckSize: 80, updatedAt: 1,
};

function stubPlayLocation(): void {
  vi.stubGlobal("location", { hostname: "localhost", pathname: "/play",
    search: `?${new URLSearchParams({ fabrary: fabraryUrl, format: "cc" })}` });
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

function matchPrep(accepted: [boolean, boolean], phase: "accept" | "select-deck") {
  return {
    format: "cc",
    seats: [
      { username: "Alice", heroId: "HERO0", heroName: "Hero 0", ready: false, arenaLocked: phase === "select-deck", ...(phase === "select-deck" ? { arena: { weaponIds: [], equipment: {} } } : {}), connected: true, accepted: accepted[0] },
      { username: "Bob", heroId: "HERO1", heroName: "Hero 1", ready: false, arenaLocked: phase === "select-deck", ...(phase === "select-deck" ? { arena: { weaponIds: [], equipment: {} } } : {}), connected: true, accepted: accepted[1] },
    ],
    yourSeat: 1,
    ...(phase === "select-deck" ? { yourArena: { weaponIds: [], equipment: {} } } : {}),
    die: { rolls: [3, 5], winner: 1 },
    startPlayer: phase === "select-deck" ? 0 : null,
    deadlineAt: Date.now() + 30_000,
    deadlinePhase: phase,
    phase,
  };
}

beforeEach(() => {
  vi.resetModules();
  FakeWebSocket.instances = [];
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("sessionStorage", new MemoryStorage());
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

describe("Fabrary play handoff", () => {
  it("loads a public guest preview once without importing or saving a deck", async () => {
    stubPlayLocation();
    const fetcher = vi.fn(async () => jsonResponse({ ok: true, deck: {
      name: "Public deck", heroName: "Rhinar",
    } }));
    vi.stubGlobal("fetch", fetcher);
    const { useStore } = await import("../store.js");
    await useStore.getState().previewFabraryPlay();
    await useStore.getState().previewFabraryPlay();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([expect.stringContaining("/api/decks/preview"),
      expect.objectContaining({ body: JSON.stringify({ url: fabraryUrl }),
        headers: { "content-type": "application/json" } })]);
    expect(useStore.getState().pendingFabraryPlay?.preview).toEqual({ status: "ready", result: {
      ok: true, deck: { name: "Public deck", heroName: "Rhinar" },
    } });
    expect(useStore.getState().decks).toEqual([]);
    expect(useStore.getState().pendingFabraryPlay?.status).toBe("idle");
  });

  it("retries failed guest previews and drops a late result after leaving", async () => {
    stubPlayLocation();
    const late = deferred<Response>();
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: false, error: "Unavailable" }))
      .mockReturnValueOnce(late.promise);
    vi.stubGlobal("fetch", fetcher);
    const { useStore } = await import("../store.js");
    await useStore.getState().previewFabraryPlay();
    expect(useStore.getState().pendingFabraryPlay?.preview?.status).toBe("error");
    const retry = useStore.getState().previewFabraryPlay();
    await useStore.getState().previewFabraryPlay();
    expect(fetcher).toHaveBeenCalledTimes(2);
    useStore.getState().dismissFabraryPlay();
    late.resolve(jsonResponse({ ok: true, deck: { name: "Old deck", heroName: "Rhinar" } }));
    await retry;
    expect(useStore.getState().pendingFabraryPlay).toBeNull();
  });

  it("does not let a guest preview overwrite an authenticated import", async () => {
    stubPlayLocation();
    const late = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) =>
      String(input).endsWith("/api/decks/preview") ? late.promise
        : Promise.resolve(jsonResponse({ ok: true, deck: fabraryDeck }))));
    const { useStore } = await import("../store.js");
    const loading = useStore.getState().previewFabraryPlay();
    useStore.setState({ authToken: "token-a", authUser: "Alice" });
    await useStore.getState().resolveFabraryPlay();
    late.resolve(jsonResponse({ ok: true, deck: { name: "Old deck", heroName: "Rhinar" } }));
    await loading;
    expect(useStore.getState().pendingFabraryPlay).toMatchObject({ status: "ready", result: { deck: fabraryDeck } });
  });

  it("reloads a deck-list snapshot that predates the play import", async () => {
    stubPlayLocation();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const oldList = deferred<Response>();
    let lists = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/api/decks")) {
        lists += 1;
        return lists === 1 ? oldList.promise : jsonResponse({ ok: true, decks: [fabraryDeck], plays: [] });
      }
      return jsonResponse({ ok: true, deck: fabraryDeck });
    }));
    const { useStore } = await import("../store.js");
    const refresh = useStore.getState().refreshDecks();
    await useStore.getState().resolveFabraryPlay();
    oldList.resolve(jsonResponse({ ok: true, decks: [], plays: [] }));
    await refresh;
    expect(lists).toBe(2);
    expect(useStore.getState().decks).toEqual([fabraryDeck]);
  });
  it.each(["login", "register"] as const)("preserves the link through %s and resolves after authentication", async (method) => {
    stubPlayLocation();
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/api/register")) return jsonResponse({ ok: true });
      if (String(input).endsWith("/api/login")) return jsonResponse({ ok: true, username: "Alice", token: "token-a" });
      if (String(input).endsWith("/api/decks/play")) return jsonResponse({ ok: true, deck: fabraryDeck });
      return jsonResponse({ ok: true, decks: [], plays: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    const { useStore } = await import("../store.js");
    await useStore.getState().resolveFabraryPlay();
    expect(fetcher).not.toHaveBeenCalled();
    await useStore.getState()[method]("Alice", "password1");
    await useStore.getState().resolveFabraryPlay();
    expect(useStore.getState().pendingFabraryPlay).toMatchObject({ status: "ready", result: { deck: fabraryDeck } });
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("coalesces overlapping resolution and permits retry after failure", async () => {
    stubPlayLocation();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const response = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(response.promise)
      .mockResolvedValue(jsonResponse({ ok: true, deck: fabraryDeck }));
    vi.stubGlobal("fetch", fetcher);
    const { useStore } = await import("../store.js");
    const first = useStore.getState().resolveFabraryPlay();
    await useStore.getState().resolveFabraryPlay();
    expect(fetcher).toHaveBeenCalledTimes(1);
    response.resolve(jsonResponse({ ok: false, error: "Fabrary is busy" }));
    await first;
    expect(useStore.getState().pendingFabraryPlay?.status).toBe("error");
    await useStore.getState().resolveFabraryPlay();
    await useStore.getState().resolveFabraryPlay();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(useStore.getState().decks).toEqual([fabraryDeck]);
  });

  it("discards a late import after cancellation", async () => {
    stubPlayLocation();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => response.promise));
    const { useStore } = await import("../store.js");
    const loading = useStore.getState().resolveFabraryPlay();
    useStore.getState().dismissFabraryPlay();
    response.resolve(jsonResponse({ ok: true, deck: fabraryDeck }));
    await loading;
    expect(useStore.getState().pendingFabraryPlay).toBeNull();
    expect(useStore.getState().decks).toEqual([]);
    expect(history.replaceState).toHaveBeenLastCalledWith(null, "", "/");
  });

  it("discards old-account results and preserves the request when the socket session expires", async () => {
    stubPlayLocation();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => response.promise));
    const { useStore } = await import("../store.js");
    useStore.getState().listRooms();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    const loading = useStore.getState().resolveFabraryPlay();
    socket.message({ type: "auth-failed" });
    response.resolve(jsonResponse({ ok: true, deck: fabraryDeck }));
    await loading;
    expect(useStore.getState()).toMatchObject({ authToken: null, decks: [],
      pendingFabraryPlay: { status: "idle", result: null } });
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("returns an expired HTTP session to login without losing the link", async () => {
    stubPlayLocation();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false, error: "not logged in" })));
    const { useStore } = await import("../store.js");
    await useStore.getState().resolveFabraryPlay();
    expect(useStore.getState()).toMatchObject({ authUser: null,
      pendingFabraryPlay: { status: "idle", result: null } });
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("requires Future mode for future cards and consumes the link only after queue acknowledgement", async () => {
    stubPlayLocation();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, deck: { ...fabraryDeck, futureCards: ["Future card"] } })));
    const { useStore } = await import("../store.js");
    await useStore.getState().resolveFabraryPlay();
    useStore.getState().startFabraryPlay({ kind: "player" });
    expect(FakeWebSocket.instances).toHaveLength(0);
    useStore.getState().setCardPoolMode("cc", "future");
    useStore.getState().startFabraryPlay({ kind: "player" });
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    useStore.getState().startFabraryPlay({ kind: "player" });
    expect(socket.sent.map((value) => JSON.parse(value)).filter((message) => message.type === "queue-join"))
      .toEqual([{ type: "queue-join", format: "cc", deckId: fabraryDeck.id, cardPoolMode: "future" }]);
    expect(useStore.getState().pendingFabraryPlay?.status).toBe("starting");
    socket.message({ type: "queued", format: "cc" });
    expect(useStore.getState().pendingFabraryPlay).toBeNull();
    expect(useStore.getState().screen).toBe("prep");
    expect(history.replaceState).toHaveBeenLastCalledWith(null, "", "/");
  });

  it("requires Open mode for banned cards and starts a bot without player search", async () => {
    stubPlayLocation();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, deck: { ...fabraryDeck,
      bannedCards: ["Art of War"], futureCards: ["Future card"] } })));
    const { useStore } = await import("../store.js");
    await useStore.getState().resolveFabraryPlay();
    const choice = { kind: "bot" as const, bot: "ira" as const, searchForPlayer: false };
    useStore.getState().setCardPoolMode("cc", "future");
    useStore.getState().startFabraryPlay(choice);
    expect(FakeWebSocket.instances).toHaveLength(0);
    useStore.getState().setCardPoolMode("cc", "open");
    useStore.getState().startFabraryPlay(choice);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({ type: "create-bot-room",
      format: "cc", deckId: fabraryDeck.id, bot: "ira", cardPoolMode: "open" });
    socket.message({ type: "room-created", code: "AAAAAA", token: "room-token", seat: 0, version: 1 });
    expect(useStore.getState()).toMatchObject({ screen: "prep", pendingFabraryPlay: null });
    expect(history.replaceState).toHaveBeenLastCalledWith(null, "", "/AAAAAA");
  });

  it.each(["player", "bot"] as const)("starts a %s game while preserving other games", async (kind) => {
    stubPlayLocation();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const existingSession = JSON.stringify({ code: "OLD123", token: "old-seat-token" });
    localStorage.setItem("fyendal-room-session:OLD123", existingSession);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, deck: fabraryDeck })));
    const { useStore } = await import("../store.js");
    await useStore.getState().resolveFabraryPlay();
    useStore.setState({ rooms: [{ code: "OLD123", format: "cc", heroes: ["Rhinar", "Bravo"],
      createdAt: 0, started: true, yours: true }] });
    useStore.getState().startFabraryPlay(kind === "player"
      ? { kind: "player" } : { kind: "bot", bot: "ira", searchForPlayer: false });
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    const messages = socket.sent.map((value) => JSON.parse(value));
    expect(messages).toContainEqual(kind === "player"
      ? { type: "queue-join", format: "cc", deckId: fabraryDeck.id }
      : { type: "create-bot-room", format: "cc", deckId: fabraryDeck.id, bot: "ira" });
    expect(messages.some((message) => message.type === "leave-room")).toBe(false);
    socket.message({ type: "room-created", code: "NEW123", token: "new-seat-token", seat: 0, version: 1 });
    expect(localStorage.getItem("fyendal-room-session:OLD123")).toBe(existingSession);
    expect(useStore.getState()).toMatchObject({ screen: "prep", pendingFabraryPlay: null, roomCode: "NEW123" });
  });

  it("recovers from rejected game creation", async () => {
    stubPlayLocation();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, deck: fabraryDeck })));
    const { useStore } = await import("../store.js");
    await useStore.getState().resolveFabraryPlay();
    useStore.getState().startFabraryPlay({ kind: "player" });
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "error", code: "INVALID_MESSAGE", message: "deck changed; try again" });
    expect(useStore.getState()).toMatchObject({ pendingFabraryPlay: { status: "ready" },
      matchmakingActive: false, error: "deck changed; try again" });
    await useStore.getState().resolveFabraryPlay(true);
    expect(useStore.getState()).toMatchObject({ pendingFabraryPlay: { status: "ready" }, error: null });
  });
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
    decks.resolve(jsonResponse({ ok: true, decks: [], plays: [] }));
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
    await useStore.getState().logout();
    expect(useStore.getState().deckPlayedAt).toEqual({});
    expect(useStore.getState().cardPoolModes).toEqual({ cc: "legal", "silver-age": "legal" });

    await useStore.getState().login("Bob", "password");
    expect(useStore.getState().authUser).toBe("Bob");
    expect(useStore.getState().deckPlayedAt).toEqual({});
    expect(useStore.getState().cardPoolModes).toEqual({ cc: "legal", "silver-age": "legal" });
  });

  it("loads server deck play times without saving them in the browser", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    let playedAt = 100;
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      if (!String(input).endsWith("/api/decks")) throw new Error("unexpected request");
      return Promise.resolve(jsonResponse({
        ok: true,
        decks: [],
        plays: [{ deckId: "precon-sba", playedAt }],
      }));
    }));
    const { useStore } = await import("../store.js");

    await useStore.getState().refreshDecks();
    expect(useStore.getState().deckPlayedAt).toEqual({ "precon-sba": 100 });
    expect(localStorage.getItem("fyendal-lobby-settings-alice")).toBeNull();

    playedAt = 200;
    await useStore.getState().refreshDecks(true);
    expect(useStore.getState().deckPlayedAt).toEqual({ "precon-sba": 200 });
    expect(localStorage.getItem("fyendal-lobby-settings-alice")).toBeNull();
  });

  it.each(["import", "update", "delete"] as const)(
    "does not restore stale decks when a refresh overlaps a %s",
    async (mutation) => {
      localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
      const original = {
        id: "deck-1", name: "Original", format: "silver-age" as const, fabraryUrl: null,
        heroName: "Briar", deckSize: 40, updatedAt: 1,
      };
      const changed = { ...original, id: mutation === "import" ? "deck-2" : original.id,
        name: "Changed", updatedAt: 2 };
      const staleList = deferred<Response>();
      let listRequests = 0;
      vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/decks")) {
          listRequests += 1;
          return listRequests === 1 ? staleList.promise : Promise.resolve(jsonResponse({
            ok: true,
            decks: mutation === "delete" ? [] : mutation === "import" ? [original, changed] : [changed],
            plays: [],
          }));
        }
        if (url.endsWith(`/api/decks/${mutation}`)) {
          return Promise.resolve(jsonResponse(mutation === "delete"
            ? { ok: true } : { ok: true, deck: changed }));
        }
        throw new Error(`unexpected fetch ${url}`);
      }));

      const { useStore } = await import("../store.js");
      useStore.setState({ decks: [original], deckPlayedAt: { [original.id]: 10 } });
      const refresh = useStore.getState().refreshDecks();
      if (mutation === "import") {
        await useStore.getState().importDeck({ name: changed.name, format: changed.format, text: "deck" });
      } else if (mutation === "update") {
        await useStore.getState().updateDeck({ id: original.id, name: changed.name });
      } else {
        await useStore.getState().deleteDeck(original.id);
      }
      staleList.resolve(jsonResponse({ ok: true, decks: [original], plays: [{ deckId: original.id, playedAt: 10 }] }));
      await refresh;

      expect(listRequests).toBe(2);
      expect(useStore.getState().decks).toEqual(
        mutation === "delete" ? [] : mutation === "import" ? [original, changed] : [changed],
      );
      if (mutation === "delete") expect(useStore.getState().deckPlayedAt).toEqual({});
    },
  );

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

    socket.message({ type: "prep-state", prep: matchPrep([true, true], "select-deck"), version: 4 });
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

  it("marks the first room view as a replacement and consecutive versions as forward", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat", version: 1 });
    socket.message({ ...staleState, version: 2 });

    expect(useStore.getState().viewUpdate).toMatchObject({
      source: "live",
      transition: "replace",
      roomVersion: 2,
    });

    socket.message({
      ...staleState,
      version: 3,
      view: { ...staleState.view, log: ["action resolved"] },
    });
    expect(useStore.getState().viewUpdate).toMatchObject({
      source: "live",
      transition: "forward",
      roomVersion: 3,
    });
  });

  it("classifies adjacent replay steps separately from replay jumps", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat", version: 1 });
    socket.message({ ...staleState, version: 2 });
    const first = useStore.getState().view!;
    const second = { ...first, log: ["first action"] };
    const third = { ...second, log: ["first action", "second action"] };
    useStore.setState({
      screen: "replay",
      replayViews: [first, second, third],
      replayStep: 0,
      view: first,
    });

    useStore.getState().setReplayStep(1);
    expect(useStore.getState().viewUpdate).toMatchObject({
      source: "replay",
      transition: "forward",
      replayStep: 1,
    });
    useStore.getState().setReplayStep(0);
    expect(useStore.getState().viewUpdate).toMatchObject({
      source: "replay",
      transition: "backward",
      replayStep: 0,
    });
    useStore.getState().setReplayStep(2);
    expect(useStore.getState().viewUpdate).toMatchObject({
      source: "replay",
      transition: "jump",
      replayStep: 2,
    });
  });

  it("bookmarks live room states and removes notes for frames discarded by undo", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const savedNotes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/replay-notes/room/AAAAAA")) {
        return Promise.resolve(jsonResponse({ ok: true, notes: [] }));
      }
      if (url.endsWith("/api/replay-notes") && init?.method === "POST") {
        savedNotes.push(JSON.parse(String(init.body)));
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.endsWith("/api/replays")) {
        return Promise.resolve(jsonResponse({ ok: true, replays: [] }));
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat", version: 1 });
    socket.message({ ...staleState, version: 2 });

    useStore.getState().setLiveReplayNote(2, 0, "  Opening decision  ");
    expect(useStore.getState().replayNotes).toEqual([
      { roomVersion: 2, frame: 0, text: "Opening decision" },
    ]);
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .some((key) => key?.includes("replay-notes"))).toBe(false);

    socket.message({
      ...staleState,
      version: 3,
      view: { ...staleState.view, turn: 2 },
    });
    useStore.getState().setLiveReplayNote(3, 1, "Undo this line");
    expect(useStore.getState().replayNotes).toHaveLength(2);

    socket.message({
      ...staleState,
      version: 4,
      transition: { fromVersion: 3, kind: "replace", restoreVersion: 2, events: [] },
    });
    expect(useStore.getState()).toMatchObject({
      replayFrames: 1,
      replayNotes: [{ roomVersion: 2, frame: 0, text: "Opening decision" }],
    });
    expect(savedNotes).toEqual([
      { roomCode: "AAAAAA", roomVersion: 2, frame: 0, text: "Opening decision" },
      { roomCode: "AAAAAA", roomVersion: 3, frame: 1, text: "Undo this line" },
    ]);
  });

  it("hydrates private notes when entering a live room", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/replay-notes/room/AAAAAA")) {
        return Promise.resolve(jsonResponse({
          ok: true,
          notes: [{ frame: 0, roomVersion: 2, text: "Stored thought" }],
        }));
      }
      if (url.endsWith("/api/replays")) {
        return Promise.resolve(jsonResponse({ ok: true, replays: [] }));
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat", version: 1 });
    socket.message({ ...staleState, version: 2 });

    await vi.waitFor(() => {
      expect(useStore.getState().replayNotes).toEqual([
        { frame: 0, roomVersion: 2, text: "Stored thought" },
      ]);
    });
  });

  it("does not let pending live-note hydration replace a newer edit", async () => {
    const liveNotes = deferred<Response>();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/replay-notes/room/AAAAAA")) return liveNotes.promise;
      if (url.endsWith("/api/replay-notes") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.endsWith("/api/replays")) {
        return Promise.resolve(jsonResponse({ ok: true, replays: [] }));
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat", version: 1 });
    socket.message({ ...staleState, version: 2 });

    useStore.getState().setLiveReplayNote(2, 0, "New local thought");
    liveNotes.resolve(jsonResponse({
      ok: true,
      notes: [{ frame: 0, roomVersion: 2, text: "Older server thought" }],
    }));

    await vi.waitFor(() => {
      expect(useStore.getState().replayNotes).toEqual([
        { frame: 0, roomVersion: 2, text: "New local thought" },
      ]);
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
      connectionIssueVisible: false,
      error: null,
    });
    expect(localStorage.getItem("fyendal-room-session:AAAAAA")).toContain("seat-token");

    await vi.advanceTimersByTimeAsync(1_000);
    const recovered = FakeWebSocket.instances[1]!;
    recovered.open();
    expect(recovered.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "auth", token: "account-token" },
      { type: "join-room", code: "AAAAAA", token: "seat-token" },
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useStore.getState().connectionIssueVisible).toBe(false);
  });

  it("shows one reconnect notice only after the connection stays down for five seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    socket.message({ ...staleState, version: 2 });
    socket.close();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(useStore.getState()).toMatchObject({
      connected: false,
      connectionIssueVisible: false,
      roomCode: "AAAAAA",
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(useStore.getState().connectionIssueVisible).toBe(true);
  });

  it("keeps a healthy room socket across background and foreground transitions", async () => {
    vi.useFakeTimers();
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    socket.message({ ...staleState, version: 2 });

    useStore.getState().setConnectionActive(false);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(useStore.getState()).toMatchObject({
      connected: true,
      connectionIssueVisible: false,
      screen: "game",
      roomCode: "AAAAAA",
    });

    useStore.getState().setConnectionActive(true);
    useStore.getState().setConnectionActive(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("keeps an in-flight connection across a visibility transition", async () => {
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA", "deck-a");
    const socket = FakeWebSocket.instances[0]!;
    useStore.getState().setConnectionActive(false);
    useStore.getState().setConnectionActive(true);

    expect(FakeWebSocket.instances).toHaveLength(1);
    socket.open();
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "join-room", code: "AAAAAA", deckId: "deck-a" },
    ]);
  });

  it("defers an unexpected hidden-tab disconnect until the page is active", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    socket.message({ ...staleState, version: 2 });
    useStore.getState().setConnectionActive(false);
    socket.close();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(useStore.getState().connectionIssueVisible).toBe(false);

    useStore.getState().setConnectionActive(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("foregrounding bypasses a pending reconnect backoff", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { useStore } = await import("../store.js");

    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    socket.message({ ...staleState, version: 2 });
    socket.close();

    useStore.getState().setConnectionActive(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
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
    expect(localStorage.getItem("fyendal-room-session:BBBBBB")).toContain("BBBBBB");
  });

  it("switches directly between spectated rooms and clears the old tab credential", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA", undefined, true);
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.message({ type: "joined", code: "AAAAAA", seat: null, token: "watch-a", spectator: true, version: 1 });
    expect(sessionStorage.getItem("fyendal-room-session:AAAAAA")).toContain("watch-a");

    useStore.getState().joinRoom("BBBBBB", undefined, true);
    const second = FakeWebSocket.instances[1]!;
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(sessionStorage.getItem("fyendal-room-session:AAAAAA")).toBeNull();
    second.open();
    expect(second.sent.map((frame) => JSON.parse(frame))).toContainEqual({
      type: "join-room", code: "BBBBBB", spectate: true,
    });
    expect(useStore.getState().roomCode).toBeNull();
  });

  it("moves a rotated legacy spectator credential out of shared storage", async () => {
    localStorage.setItem("fyendal-room-session:AAAAAA", JSON.stringify({
      code: "AAAAAA", token: "old-watch-token",
    }));
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA", undefined, true);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: null,
      token: "new-watch-token", spectator: true, version: 1 });

    expect(localStorage.getItem("fyendal-room-session:AAAAAA")).toBeNull();
    expect(sessionStorage.getItem("fyendal-room-session:AAAAAA")).toContain("new-watch-token");
  });

  it("keeps a player credential when an attempted spectator entry fails", async () => {
    localStorage.setItem("fyendal-room-session:AAAAAA", JSON.stringify({
      code: "AAAAAA", token: "player-token",
    }));
    sessionStorage.setItem("fyendal-room-session:AAAAAA", JSON.stringify({
      code: "AAAAAA", token: "stale-watch-token",
    }));
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA", undefined, true);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "error", message: "already a player in this room" });

    expect(localStorage.getItem("fyendal-room-session:AAAAAA")).toContain("player-token");
    expect(sessionStorage.getItem("fyendal-room-session:AAAAAA")).toBeNull();
  });

  it("returns a replaced player tab to the lobby without reclaiming the seat", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "old-token", version: 1 });
    socket.message({ ...staleState, version: 2 });
    localStorage.setItem("fyendal-room-session:AAAAAA", JSON.stringify({
      code: "AAAAAA", token: "new-tab-token",
    }));

    socket.message({ type: "error", code: "SESSION_REPLACED", message: "room session replaced" });
    expect(useStore.getState()).toMatchObject({
      screen: "lobby", roomCode: null, view: null, connected: false,
    });
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(localStorage.getItem("fyendal-room-session:AAAAAA")).toContain("new-tab-token");
    expect(history.replaceState).toHaveBeenLastCalledWith(null, "", "/");

    const lobbySocket = FakeWebSocket.instances[1]!;
    lobbySocket.open();
    expect(lobbySocket.sent.map((frame) => JSON.parse(frame))).toContainEqual({ type: "list-rooms" });
    expect(lobbySocket.sent.some((frame) => JSON.parse(frame).type === "join-room")).toBe(false);
  });

  it("preserves the new tab's credential when replacement arrives before the first state", async () => {
    localStorage.setItem("fyendal-room-session:AAAAAA", JSON.stringify({
      code: "AAAAAA", token: "old-token",
    }));
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "old-token", version: 1 });
    localStorage.setItem("fyendal-room-session:AAAAAA", JSON.stringify({
      code: "AAAAAA", token: "new-tab-token",
    }));

    socket.message({ type: "error", code: "SESSION_REPLACED", message: "room session replaced" });
    expect(useStore.getState().roomCode).toBeNull();
    expect(localStorage.getItem("fyendal-room-session:AAAAAA")).toContain("new-tab-token");
  });

  it("disconnects a playing tab to inspect another room without surrendering its seat", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.message({ type: "joined", code: "AAAAAA", seat: 0, token: "player-token", version: 1 });

    useStore.getState().inspectRoom("BBBBBB");
    const second = FakeWebSocket.instances[1]!;
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(localStorage.getItem("fyendal-room-session:AAAAAA")).toContain("player-token");
    second.open();
    expect(second.sent.map((frame) => JSON.parse(frame))).toContainEqual({
      type: "inspect-room", code: "BBBBBB",
    });
  });

  it("joins another room without discarding the previous player credential", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.message({ type: "joined", code: "AAAAAA", seat: 0, token: "player-token", version: 1 });

    useStore.getState().joinRoom("BBBBBB", undefined, true);
    const second = FakeWebSocket.instances[1]!;
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(localStorage.getItem("fyendal-room-session:AAAAAA")).toContain("player-token");
    second.open();
    expect(second.sent.map((frame) => JSON.parse(frame))).toContainEqual({
      type: "join-room", code: "BBBBBB", spectate: true,
    });
  });

  it("opens a friend invitation in the current spectator tab", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "account-token", username: "Alice" }));
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA", undefined, true);
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.message({ type: "joined", code: "AAAAAA", seat: null, token: "watch-a", spectator: true, version: 1 });
    useStore.setState({
      socialOpen: true,
      friendGameInvites: [{
        inviteId: "invite-b", fromUsername: "Bob",
        room: { code: "BBBBBB", format: "classic-battles" }, sentAt: Date.now(),
      }],
    });

    useStore.getState().acceptFriendGameInvite("invite-b");
    const second = FakeWebSocket.instances[1]!;
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(sessionStorage.getItem("fyendal-room-session:AAAAAA")).toBeNull();
    expect(useStore.getState().socialOpen).toBe(false);
    second.open();
    expect(second.sent.map((frame) => JSON.parse(frame))).toContainEqual({
      type: "inspect-room", code: "BBBBBB",
    });
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

    decks.resolve(jsonResponse({ ok: true, decks: [oldDeck], plays: [] }));
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

  it("loads and dismisses fixed bug-report notifications", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/bug-report-notifications/dismiss")) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.endsWith("/api/bug-report-notifications")) {
        return Promise.resolve(jsonResponse({
          ok: true,
          notifications: [
            { reportId: "report-123", fixedAt: 123 },
            { reportId: "report-456", fixedAt: 456 },
          ],
        }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useStore } = await import("../store.js");

    await useStore.getState().refreshBugReportNotifications();
    expect(useStore.getState().bugReportNotifications).toEqual([
      { reportId: "report-123", fixedAt: 123 },
      { reportId: "report-456", fixedAt: 456 },
    ]);
    await useStore.getState().dismissBugReportNotifications();
    expect(useStore.getState().bugReportNotifications).toEqual([]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:8080/api/bug-report-notifications/dismiss",
      expect.objectContaining({
        method: "POST",
        body: "{}",
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

  it("tracks opted-in bot startup separately from background offers", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const { useStore } = await import("../store.js");

    useStore.getState().createBotRoom("cc", "precon-asb", "ira", true);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: "create-bot-room",
      format: "cc",
      deckId: "precon-asb",
      bot: "ira",
      searchForPlayer: true,
    });
    expect(useStore.getState()).toMatchObject({
      pendingBotStart: true,
      backgroundMatchmaking: { state: "inactive" },
    });

    socket.message({ type: "background-matchmaking", status: { state: "pending", format: "cc" } });
    expect(useStore.getState().pendingBotStart).toBe(true);
    socket.message({
      type: "background-matchmaking",
      status: {
        state: "offer",
        format: "cc",
        roomCode: "PVP123",
        deadlineAt: Date.now() + 30_000,
        opponent: { username: "Bob", heroId: "hero-bob", heroName: "Bob Hero" },
        acceptedByYou: false,
        opponentAccepted: false,
      },
    });
    expect(useStore.getState()).toMatchObject({
      pendingBotStart: false,
      backgroundMatchmaking: { state: "offer", roomCode: "PVP123" },
    });
    useStore.getState().acceptBackgroundMatch();
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: "background-match-accept",
      roomCode: "PVP123",
    });
    useStore.getState().declineBackgroundMatch();
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: "background-match-decline",
      roomCode: "PVP123",
    });
    expect(useStore.getState().backgroundMatchmaking).toEqual({ state: "searching", format: "cc" });
    useStore.getState().stopBackgroundMatchmaking();
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "background-matchmaking-leave" });
    expect(useStore.getState().backgroundMatchmaking).toEqual({ state: "inactive" });
  });

  it("preserves the retained matchmaking room when starting bot practice", async () => {
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
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: "create-bot-room",
      format: "cc",
      deckId: "precon-asb",
      bot: "ira",
      searchForPlayer: true,
    });
    expect(useStore.getState()).toMatchObject({
      roomCode: "QUEUE1",
      matchmakingActive: true,
      botGame: true,
      pendingBotStart: true,
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
      favorite: false,
    };
    useStore.setState({ savedReplays: [replay] });

    await expect(useStore.getState().deleteSavedReplay(replay.id)).resolves.toEqual({ ok: true });
    expect(useStore.getState().savedReplays).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("updates a saved replay after the server accepts its favorite state", async () => {
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:8080/api/replays/favorite");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ id: "replay-1", favorite: true });
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
      expiresAt: Date.now() + 1_000,
      frameCount: 3,
      favorite: false,
    };
    useStore.setState({ savedReplays: [replay] });

    await expect(useStore.getState().setSavedReplayFavorite(replay.id, true))
      .resolves.toEqual({ ok: true });
    expect(useStore.getState().savedReplays).toEqual([{ ...replay, favorite: true }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("routes saved replays but keeps imported replay files local-only", async () => {
    const replayId = "0123456789abcdef01234567";
    let serverNotes: Array<{ frame: number; text: string }> = [];
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/replay-notes/${replayId}`)) {
        return Promise.resolve(jsonResponse({ ok: true, notes: serverNotes }));
      }
      if (url.endsWith("/api/replay-notes") && init?.method === "POST") {
        const note = JSON.parse(String(init.body)) as { frame: number; text: string };
        serverNotes = note.text ? [{ frame: note.frame, text: note.text }] : [];
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      expect(url).toBe(`http://localhost:8080/api/replays/${replayId}`);
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
    useStore.getState().setReplayNote(0, "  Review this opening hand.  ");
    expect(useStore.getState().replayNotes).toEqual([
      { frame: 0, text: "Review this opening hand." },
    ]);

    useStore.getState().closeReplay();
    await expect(useStore.getState().watchSavedReplay(replayId)).resolves.toBeNull();
    expect(useStore.getState().replayNotes).toEqual([
      { frame: 0, text: "Review this opening hand." },
    ]);

    useStore.getState().closeReplay();
    const imported = JSON.stringify({
      version: 3,
      seat: 0,
      frames: [{ view: staleState.view, transition: null }],
      notes: [{ frame: 0, text: "Imported thought" }],
    });
    expect(useStore.getState().openReplayText(imported)).toBeNull();
    expect(useStore.getState()).toMatchObject({
      screen: "replay",
      activeSavedReplayId: null,
      replayNotes: [{ frame: 0, text: "Imported thought" }],
    });
    useStore.getState().setReplayNote(0, "Updated imported thought");
    expect(useStore.getState().replayNotes).toEqual([
      { frame: 0, text: "Updated imported thought" },
    ]);
    expect(serverNotes).toEqual([{ frame: 0, text: "Review this opening hand." }]);
    expect(history.pushState).toHaveBeenCalledTimes(2);
  });

  it("waits for authoritative game-over frames before opening an immediate replay", async () => {
    const roomReplay = deferred<Response>();
    localStorage.setItem("fyendal-auth", JSON.stringify({ token: "token-a", username: "Alice" }));
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/replays/room/BOT001")) return roomReplay.promise;
      if (url.endsWith("/api/replay-notes/room/BOT001")) {
        return Promise.resolve(jsonResponse({ ok: true, notes: [] }));
      }
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
    const finalView = { ...staleState.view, gameId: "BOT001", winner: 0, phase: "game-over" };
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

  it("continues live bot computation while the participant watches a replay", async () => {
    vi.useFakeTimers();
    class FakeBotWorker {
      static instances: FakeBotWorker[] = [];
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() { FakeBotWorker.instances.push(this); }
    }
    vi.stubGlobal("Worker", FakeBotWorker);
    const { useStore } = await import("../store.js");
    const { BOT_RUNTIME_ID } = await import("@fyendal/bot/runtime-id");
    useStore.getState().createBotRoom("silver-age", "precon-svi");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "room-created", code: "BOT001", seat: 0, token: "seat", version: 1 });
    const view = { ...staleState.view, gameId: "BOT001", turn: 2 };
    socket.message({ type: "game-started", version: 2 });
    socket.message({ ...staleState, version: 2, botGame: true, view });
    await useStore.getState().watchReplay();
    expect(useStore.getState()).toMatchObject({ screen: "replay", spectating: true });
    expect(useStore.getState().openReplayText(JSON.stringify({ version: 1, seat: 0, views: [view] }))).toBeNull();
    socket.message({ type: "bot-runtime", code: "BOT001", runtimeId: BOT_RUNTIME_ID });
    const task = { type: "bot-task", code: "BOT001", version: 2, runtimeId: BOT_RUNTIME_ID, botId: "bravo", seat: 1, view, legal: [{ kind: "pass" }], delayMs: 1_000 };
    socket.message(task);
    const worker = FakeBotWorker.instances[0]!;
    worker.onmessage?.({ data: { type: "ready" } });
    expect(worker.postMessage).toHaveBeenCalledWith(task);
    worker.onmessage?.({ data: { type: "decision", code: "BOT001", version: 2, intent: { kind: "pass" }, computeMs: 1 } });
    vi.advanceTimersByTime(1_000);
    expect(socket.sent.map((text) => JSON.parse(text))).toContainEqual(expect.objectContaining({ type: "bot-intent", expectedVersion: 2 }));
    expect(useStore.getState().screen).toBe("replay");
    expect(JSON.stringify(useStore.getState())).not.toContain("bot-task");
    socket.close();
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
      connectionIssueVisible: false,
      screen: "room-loading",
      view: null,
      legal: [],
      prep: null,
      error: null,
    });
    expect(localStorage.getItem("fyendal-room-session:AAAAAA")).toContain("seat-token");
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
    expect(useStore.getState().roomCommandPending).toBe(true);
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
    expect(useStore.getState().roomCommandPending).toBe(false);
    useStore.getState().sendIntent({ kind: "close-chain" });
    expect(useStore.getState().roomCommandPending).toBe(true);

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
    expect(useStore.getState().roomCommandPending).toBe(true);
    expect(useStore.getState().pendingInteraction).toEqual({
      commandId: expect.any(String),
      expectedVersion: 2,
      intent: { kind: "play-card", instanceId: 10, pitchInstanceIds: [] },
    });

    const acknowledgementProjections: { pending: boolean; handCount: number }[] = [];
    const unsubscribe = useStore.subscribe((state) => {
      acknowledgementProjections.push({
        pending: state.pendingInteraction !== null,
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
    expect(useStore.getState().roomCommandPending).toBe(false);
    expect(useStore.getState().pendingInteraction).toBeNull();
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

  it("tracks activation and arsenal interactions until authoritative acknowledgement", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    socket.message({ ...staleState, version: 2 });

    const activation = {
      kind: "activate-ability" as const,
      sourceInstanceId: 20,
      pitchInstanceIds: [11],
    };
    expect(useStore.getState().sendIntent(activation)).toBe(true);
    expect(useStore.getState().pendingInteraction?.intent).toEqual(activation);

    socket.message({ type: "error", code: "INVALID_MESSAGE", message: "cannot activate" });
    expect(useStore.getState().pendingInteraction).toBeNull();

    const arsenalState = {
      ...staleState,
      version: 3,
      view: {
        ...staleState.view,
        pendingDecision: {
          player: 0,
          kind: "arsenal" as const,
          prompt: "Choose arsenal",
          options: ["11"],
        },
      },
    };
    socket.message(arsenalState);
    const choice = { kind: "choose" as const, optionId: "11" };
    expect(useStore.getState().sendIntent(choice)).toBe(true);
    expect(useStore.getState().pendingInteraction?.intent).toEqual(choice);

    socket.message({
      ...arsenalState,
      version: 4,
      view: { ...arsenalState.view, pendingDecision: null },
    });
    expect(useStore.getState().pendingInteraction).toBeNull();
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
    expect(useStore.getState().pendingDefenderStageIds).toEqual([11]);
    useStore.getState().sendIntent({ kind: "stage-defenders", instanceIds: [11, 12] });
    expect(useStore.getState().pendingDefenderStageIds).toEqual([11, 12]);

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
    expect(useStore.getState().pendingDefenderStageIds).toEqual([11, 12]);

    socket.message({
      ...defendState,
      version: 4,
      view: {
        ...defendState.view,
        pendingDecision: {
          ...defendState.view.pendingDecision,
          stagedCards: [defenderA, defenderB],
          stagedDefense: 6,
        },
      },
    });

    expect(useStore.getState().pendingDefenderStageIds).toBeNull();
    useStore.getState().leave();
  });

  it("updates and rolls back the optimistic defender presentation immediately", async () => {
    const { useStore } = await import("../store.js");
    useStore.getState().joinRoom("AAAAAA");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "joined", code: "AAAAAA", seat: 0, token: "seat-token", version: 1 });
    const defender = { instanceId: 11, cardId: "TST011", owner: 0 };
    socket.message({
      ...staleState,
      version: 2,
      view: {
        ...staleState.view,
        players: [
          { ...staleState.view.players[0], hand: [defender], handCount: 1 },
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
      legal: [{ kind: "stage-defenders", instanceIds: [11] }],
    });

    useStore.getState().sendIntent({ kind: "stage-defenders", instanceIds: [11] });
    expect(useStore.getState().pendingDefenderStageIds).toEqual([11]);

    useStore.getState().sendIntent({ kind: "stage-defenders", instanceIds: [] });
    expect(useStore.getState().pendingDefenderStageIds).toEqual([]);

    socket.message({ type: "error", code: "INVALID_MESSAGE", message: "cannot stage defender" });
    expect(useStore.getState().roomCommandPending).toBe(false);
    expect(useStore.getState().pendingDefenderStageIds).toBeNull();
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
    expect(localStorage.getItem("fyendal-room-session:AAAAAA")).toContain("seat-token");
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
