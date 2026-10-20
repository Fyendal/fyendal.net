import { describe, expect, it } from "vitest";
import {
  AUTH_STORAGE_KEY,
  BOT_MATCHMAKING_PREFERENCE_STORAGE_KEY,
  CHOICE_HOTKEYS_STORAGE_KEY,
  loadChoiceHotkeys,
  saveChoiceHotkeys,
  decodeStandingOrders,
  DEFAULT_GAME_SETTINGS,
  DEFAULT_LOBBY_SETTINGS,
  MAX_STANDING_ORDER_CARDS,
  applyStandingOrder,
  GAME_SETTINGS_STORAGE_KEY,
  LOBBY_SETTINGS_STORAGE_KEY,
  loadRejectedMatchRooms,
  loadRejectedMatchRoomsForChoice,
  loadGameSettings,
  loadBotMatchmakingPreference,
  loadHomeGameMode,
  loadHomeFormat,
  loadLobbySettings,
  lobbySettingsStorageKey,
  replayStorageKey,
  rememberRejectedMatchRoom,
  pruneRejectedMatchRooms,
  ROOM_SESSION_STORAGE_KEY,
  saveGameSettings,
  saveBotMatchmakingPreference,
  saveHomeGameMode,
  saveHomeFormat,
  saveLobbySettings,
} from "../storage.js";
import {
  clearRoomSessions,
  loadRoomSession,
  removeRoomSession,
  saveRoomSession,
} from "../store/sessionStorage.js";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("client storage keys", () => {
  it("uses the initial release namespace without migration generations", () => {
    expect(AUTH_STORAGE_KEY).toBe("fyendal-auth");
    expect(ROOM_SESSION_STORAGE_KEY).toBe("fyendal-room-session");
    expect(replayStorageKey("ABC123")).toBe("fyendal-replay-ABC123");
  });

  it("isolates room credentials and migrates the legacy single-room key on first read", () => {
    const storage = memoryStorage();
    storage.setItem(ROOM_SESSION_STORAGE_KEY, JSON.stringify({ code: "ABC123", token: "legacy" }));
    expect(loadRoomSession(storage, "ABC123")).toEqual({ code: "ABC123", token: "legacy" });
    expect(storage.getItem(ROOM_SESSION_STORAGE_KEY)).toBeNull();

    saveRoomSession(storage, { code: "DEF456", token: "second" });
    expect(loadRoomSession(storage, "ABC123")?.token).toBe("legacy");
    expect(loadRoomSession(storage, "DEF456")?.token).toBe("second");
    removeRoomSession(storage, "ABC123");
    expect(loadRoomSession(storage, "ABC123")).toBeNull();
    expect(loadRoomSession(storage, "DEF456")?.token).toBe("second");

    clearRoomSessions(storage);
    expect(loadRoomSession(storage, "DEF456")).toBeNull();
  });

  it("remembers whether bot practice should keep searching for a player", () => {
    let stored: string | null = null;
    const storage = {
      getItem: (key: string) => key === BOT_MATCHMAKING_PREFERENCE_STORAGE_KEY ? stored : null,
      setItem: (key: string, value: string) => {
        if (key === BOT_MATCHMAKING_PREFERENCE_STORAGE_KEY) stored = value;
      },
    };

    expect(loadBotMatchmakingPreference(storage)).toBe(true);
    saveBotMatchmakingPreference(storage, false);
    expect(loadBotMatchmakingPreference(storage)).toBe(false);
    saveBotMatchmakingPreference(storage, true);
    expect(loadBotMatchmakingPreference(storage)).toBe(true);
    stored = JSON.stringify({ version: 1, searchForPlayer: "yes" });
    expect(loadBotMatchmakingPreference(storage)).toBe(true);
  });

  it("remembers the home game mode for each account across reloads", () => {
    const storage = memoryStorage();
    expect(loadHomeGameMode(storage, "Alice")).toBe("find-match");
    saveHomeGameMode(storage, "Alice", "bot");
    expect(loadHomeGameMode(storage, "ALICE")).toBe("bot");
    expect(loadHomeGameMode(storage, "Bob")).toBe("find-match");
    saveHomeGameMode(storage, "Bob", "invite-friend");
    expect(loadHomeGameMode(storage, "Bob")).toBe("invite-friend");
    storage.setItem("fyendal-home-game-mode-alice", "invalid");
    expect(loadHomeGameMode(storage, "Alice")).toBe("find-match");
  });

  it("remembers the home format for each account across reloads", () => {
    const storage = memoryStorage();
    expect(loadHomeFormat(storage, "Alice")).toBe("silver-age");
    saveHomeFormat(storage, "Alice", "cc");
    expect(loadHomeFormat(storage, "ALICE")).toBe("cc");
    expect(loadHomeFormat(storage, "Bob")).toBe("silver-age");
    storage.setItem("fyendal-home-format-alice", "invalid");
    expect(loadHomeFormat(storage, "Alice")).toBe("silver-age");
  });

  it("keeps recent option hotkeys and rejects malformed entries", () => {
    const storage = memoryStorage();
    expect(loadChoiceHotkeys(storage)).toEqual([]);
    const modes: Array<[string, number]> = [["power", 0], ["go again", 1], ["arsenal", 2], ["banish", 3]];
    saveChoiceHotkeys(storage, [[["yes", 0], ["no", 1]], modes]);
    expect(loadChoiceHotkeys(storage)).toEqual([[["yes", 0], ["no", 1]], modes]);
    for (const malformed of ["{", "{}", "[[[\"yes\", 8]]]", "[[[\"yes\", 0.5]]]", "[[[1, 0]]]"]) {
      storage.setItem(CHOICE_HOTKEYS_STORAGE_KEY, malformed);
      expect(loadChoiceHotkeys(storage)).toEqual([]);
    }
  });

  it("round-trips the versioned game settings", () => {
    let stored: string | null = null;
    const storage = {
      getItem: (key: string) => key === GAME_SETTINGS_STORAGE_KEY ? stored : null,
      setItem: (key: string, value: string) => {
        if (key === GAME_SETTINGS_STORAGE_KEY) stored = value;
      },
    };

    expect(loadGameSettings(storage)).toEqual({
      version: 8,
      cardDisplayPreference: "square",
      priorityWindowMode: "always-pause",
      lessGuidance: true,
      skipPlayConfirmation: true,
      motionPreference: "system",
      playabilityCuePreference: "glow",
      soundEffectsEnabled: true,
      soundEffectsVolume: 35,
      optionHotkeys: false,
      standingOrders: {},
    });
    saveGameSettings(storage, {
      version: 8,
      cardDisplayPreference: "full",
      priorityWindowMode: "auto-pass",
      lessGuidance: false,
      skipPlayConfirmation: false,
      motionPreference: "reduced",
      playabilityCuePreference: "high-contrast",
      soundEffectsEnabled: false,
      soundEffectsVolume: 60,
      optionHotkeys: true,
      standingOrders: {},
    });
    expect(loadGameSettings(storage)).toEqual({
      version: 8,
      cardDisplayPreference: "full",
      priorityWindowMode: "auto-pass",
      lessGuidance: false,
      skipPlayConfirmation: false,
      motionPreference: "reduced",
      playabilityCuePreference: "high-contrast",
      soundEffectsEnabled: false,
      soundEffectsVolume: 60,
      optionHotkeys: true,
      standingOrders: {},
    });
  });

  it("migrates version 2 settings with the default motion preference", () => {
    expect(loadGameSettings({
      getItem: () => JSON.stringify({
        version: 2,
        priorityWindowMode: "auto-pass",
        lessGuidance: true,
        skipPlayConfirmation: false,
      }),
    })).toEqual({
      version: 8,
      cardDisplayPreference: "square",
      priorityWindowMode: "auto-pass",
      lessGuidance: true,
      skipPlayConfirmation: false,
      motionPreference: "system",
      playabilityCuePreference: "glow",
      soundEffectsEnabled: true,
      soundEffectsVolume: 35,
      optionHotkeys: false,
      standingOrders: {},
    });
  });

  it("migrates version 3 settings with the default sound preferences", () => {
    expect(loadGameSettings({
      getItem: () => JSON.stringify({
        version: 3,
        priorityWindowMode: "auto-pass",
        lessGuidance: true,
        skipPlayConfirmation: false,
        motionPreference: "reduced",
      }),
    })).toEqual({
      version: 8,
      cardDisplayPreference: "square",
      priorityWindowMode: "auto-pass",
      lessGuidance: true,
      skipPlayConfirmation: false,
      motionPreference: "reduced",
      playabilityCuePreference: "glow",
      soundEffectsEnabled: true,
      soundEffectsVolume: 35,
      optionHotkeys: false,
      standingOrders: {},
    });
  });

  it("migrates version 4 settings with the default playable-card cue", () => {
    expect(loadGameSettings({
      getItem: () => JSON.stringify({
        version: 4,
        priorityWindowMode: "auto-pass",
        lessGuidance: true,
        skipPlayConfirmation: false,
        motionPreference: "full",
        soundEffectsEnabled: false,
        soundEffectsVolume: 60,
      }),
    })).toEqual({
      version: 8,
      cardDisplayPreference: "square",
      priorityWindowMode: "auto-pass",
      lessGuidance: true,
      skipPlayConfirmation: false,
      motionPreference: "full",
      playabilityCuePreference: "glow",
      soundEffectsEnabled: false,
      soundEffectsVolume: 60,
      optionHotkeys: false,
      standingOrders: {},
    });
  });

  it("migrates version 1 users to pause priority, auto-confirm, and hidden guidance", () => {
    expect(loadGameSettings({
      getItem: () => JSON.stringify({
        version: 1,
        priorityWindowMode: "auto-pass",
        lessGuidance: true,
        skipPlayConfirmation: false,
      }),
    })).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it("hides guidance once when migrating existing version 5 users", () => {
    expect(loadGameSettings({
      getItem: () => JSON.stringify({
        version: 5,
        priorityWindowMode: "always-pause",
        lessGuidance: false,
        skipPlayConfirmation: true,
        motionPreference: "system",
        playabilityCuePreference: "glow",
        soundEffectsEnabled: true,
        soundEffectsVolume: 35,
      }),
    })).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it("falls back safely for invalid or future settings", () => {
    expect(loadGameSettings({ getItem: () => "not json" })).toEqual(DEFAULT_GAME_SETTINGS);
    expect(loadGameSettings({
      getItem: () => JSON.stringify({ version: 8, priorityWindowMode: "auto-pass" }),
    })).toEqual(DEFAULT_GAME_SETTINGS);
    expect(loadGameSettings({
      getItem: () => JSON.stringify({
        ...DEFAULT_GAME_SETTINGS,
        soundEffectsVolume: 101,
      }),
    })).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it("leaves option hotkeys off for version 7 settings saved before the toggle", () => {
    const { optionHotkeys: _absent, ...previous } = {
      ...DEFAULT_GAME_SETTINGS,
      priorityWindowMode: "auto-pass" as const,
    };
    expect(loadGameSettings({ getItem: () => JSON.stringify(previous) })).toEqual({
      ...previous,
      optionHotkeys: false,
      standingOrders: {},
    });
    expect(loadGameSettings({
      getItem: () => JSON.stringify({ ...previous, optionHotkeys: "yes" }),
    }).optionHotkeys).toBe(false);
  });

  it("adds square cards to version 6 settings without resetting existing choices", () => {
    const previous = {
      version: 6,
      priorityWindowMode: "auto-pass",
      lessGuidance: false,
      skipPlayConfirmation: false,
      motionPreference: "reduced",
      playabilityCuePreference: "high-contrast",
      soundEffectsEnabled: false,
      soundEffectsVolume: 60,
    };
    expect(loadGameSettings({ getItem: () => JSON.stringify(previous) })).toEqual({
      ...previous,
      version: 8,
      cardDisplayPreference: "square",
      optionHotkeys: false,
      standingOrders: {},
    });
  });

  it("round-trips standing orders keyed by functional card identity", () => {
    let stored: string | null = null;
    const storage = {
      getItem: (key: string) => key === GAME_SETTINGS_STORAGE_KEY ? stored : null,
      setItem: (key: string, value: string) => {
        if (key === GAME_SETTINGS_STORAGE_KEY) stored = value;
      },
    };
    saveGameSettings(storage, {
      ...DEFAULT_GAME_SETTINGS,
      standingOrders: {
        "fealty|0": { priorityWindow: "pass" },
        "valiant dynamo|0": { priorityWindow: "ask", optionalTrigger: "yes" },
      },
    });
    expect(loadGameSettings(storage).standingOrders).toEqual({
      "fealty|0": { priorityWindow: "pass" },
      "valiant dynamo|0": { priorityWindow: "ask", optionalTrigger: "yes" },
    });
  });

  it("migrates version 7 settings without standing orders", () => {
    const previous = { ...DEFAULT_GAME_SETTINGS, version: 7 } as Record<string, unknown>;
    delete previous.standingOrders;
    expect(loadGameSettings({ getItem: () => JSON.stringify(previous) })).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it.each([
    ["an array", []],
    ["a printing id key", { SFA037: { priorityWindow: "pass" } }],
    ["an unknown field", { "fealty|0": { priorityWindow: "pass", extra: 1 } }],
    ["an unknown priority order", { "fealty|0": { priorityWindow: "always" } }],
    ["an unknown trigger order", { "valiant dynamo|0": { optionalTrigger: "maybe" } }],
    ["an empty entry", { "fealty|0": {} }],
    ["a non-object entry", { "fealty|0": "pass" }],
  ])("rejects standing orders with %s", (_, standingOrders) => {
    expect(decodeStandingOrders(standingOrders)).toBeNull();
    expect(loadGameSettings({
      getItem: () => JSON.stringify({ ...DEFAULT_GAME_SETTINGS, standingOrders }),
    })).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it("bounds the number of standing-order cards", () => {
    const orders = Object.fromEntries(Array.from(
      { length: MAX_STANDING_ORDER_CARDS + 1 },
      (_, index) => [`card ${index}|0`, { priorityWindow: "pass" }],
    ));
    expect(decodeStandingOrders(orders)).toBeNull();
    delete orders[`card ${MAX_STANDING_ORDER_CARDS}|0`];
    expect(decodeStandingOrders(orders)).not.toBeNull();
  });

  it("clears an order with \"ask\" and drops an entry with nothing left", () => {
    const orders = { "valiant dynamo|0": { priorityWindow: "pass", optionalTrigger: "yes" } } as const;
    const cleared = applyStandingOrder(orders, "valiant dynamo|0", { kind: "optional-trigger", value: "ask" });
    expect(cleared).toEqual({ "valiant dynamo|0": { priorityWindow: "pass" } });
    expect(applyStandingOrder(cleared, "valiant dynamo|0", { kind: "priority-window", value: "ask" }))
      .toEqual({});
    expect(applyStandingOrder({}, "fealty|0", { kind: "priority-window", value: "ask" })).toEqual({});
  });

  it("returns the same orders when nothing changes", () => {
    const orders = { "fealty|0": { priorityWindow: "pass" } } as const;
    expect(applyStandingOrder(orders, "fealty|0", { kind: "priority-window", value: "pass" })).toBe(orders);
    expect(applyStandingOrder(orders, "fealty|0", { kind: "optional-trigger", value: "ask" })).toBe(orders);
  });

  it("forgets the oldest card rather than exceeding the decoder's bound", () => {
    let orders: Record<string, { priorityWindow: "pass" }> = {};
    for (let index = 0; index <= MAX_STANDING_ORDER_CARDS; index += 1) {
      orders = applyStandingOrder(orders, `card ${index}|0`, { kind: "priority-window", value: "pass" }) as typeof orders;
    }
    expect(Object.keys(orders)).toHaveLength(MAX_STANDING_ORDER_CARDS);
    expect(orders["card 0|0"]).toBeUndefined();
    expect(orders[`card ${MAX_STANDING_ORDER_CARDS}|0`]).toEqual({ priorityWindow: "pass" });
    expect(decodeStandingOrders(orders)).not.toBeNull();
  });

  it("rejects invalid card display preferences", () => {
    expect(loadGameSettings({
      getItem: () => JSON.stringify({ ...DEFAULT_GAME_SETTINGS, cardDisplayPreference: "wide" }),
    })).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it("keeps card-pool preferences independent by account and format", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    expect(loadLobbySettings(storage, "Alice")).toEqual(DEFAULT_LOBBY_SETTINGS);
    saveLobbySettings(storage, "Alice", {
      version: 6,
      cardPoolModes: { cc: "open", "silver-age": "legal" },
    });
    expect(loadLobbySettings(storage, "ALICE")).toEqual({
      version: 6,
      cardPoolModes: { cc: "open", "silver-age": "legal" },
    });
    expect(loadLobbySettings(storage, "Bob")).toEqual(DEFAULT_LOBBY_SETTINGS);
  });

  it("migrates old lobby settings and removes browser deck-play history", () => {
    const values = new Map<string, string>([[
      LOBBY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        allowFutureCards: { cc: true, "silver-age": false },
        lastPlayedDeck: { format: "silver-age", deckId: "precon-sba" },
      }),
    ]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    expect(loadLobbySettings(storage, "Bob")).toEqual(DEFAULT_LOBBY_SETTINGS);
    expect(values.has(LOBBY_SETTINGS_STORAGE_KEY)).toBe(true);

    const oldSettings = {
      version: 6,
      cardPoolModes: { cc: "future", "silver-age": "legal" },
    };
    expect(loadLobbySettings(storage, "Alice", { migrateLegacy: true })).toEqual(oldSettings);
    expect(values.has(LOBBY_SETTINGS_STORAGE_KEY)).toBe(false);
    expect(JSON.parse(values.get(lobbySettingsStorageKey("Alice"))!)).toEqual(oldSettings);

    values.set(lobbySettingsStorageKey("Dana"), JSON.stringify({
      version: 5,
      cardPoolModes: { cc: "open", "silver-age": "legal" },
      lastPlayedDecks: { cc: "old-deck", "silver-age": null },
      deckPlayedAt: { "old-deck": 123 },
    }));
    expect(loadLobbySettings(storage, "Dana")).toEqual({
      version: 6,
      cardPoolModes: { cc: "open", "silver-age": "legal" },
    });
    expect(JSON.parse(values.get(lobbySettingsStorageKey("Dana"))!)).toEqual({
      version: 6,
      cardPoolModes: { cc: "open", "silver-age": "legal" },
    });

    values.set(lobbySettingsStorageKey("Bob"), JSON.stringify({
      version: 2,
      allowFutureCards: { cc: false, "silver-age": false },
      lastPlayedDeck: { format: "classic-battles", deckId: "rhinar" },
    }));
    expect(loadLobbySettings(storage, "Bob")).toEqual(DEFAULT_LOBBY_SETTINGS);
  });

  it("keeps rejected matchmaking rooms account-local, bounded, and short-lived", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const now = 2_000_000_000;

    rememberRejectedMatchRoom(storage, "Alice", "abc123", now);
    rememberRejectedMatchRoom(storage, "Alice", "DEF456", now + 1);
    expect(loadRejectedMatchRooms(storage, "Alice", now + 2)).toEqual(["ABC123", "DEF456"]);
    expect(loadRejectedMatchRooms(storage, "Bob", now + 2)).toEqual([]);

    pruneRejectedMatchRooms(storage, "Alice", now + 3);
    expect(loadRejectedMatchRooms(storage, "Alice", now + 3)).toEqual(["ABC123", "DEF456"]);
    pruneRejectedMatchRooms(storage, "Alice", now + 24 * 60 * 60 * 1000 + 2);
    expect(loadRejectedMatchRooms(storage, "Alice", now + 24 * 60 * 60 * 1000 + 2)).toEqual([]);
  });

  it("clears rejected rooms when the matchmaking choice changes", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const now = 2_000_000_000;

    rememberRejectedMatchRoom(storage, "Alice", "ABC123", now, "cc:deck:deck-a");
    expect(loadRejectedMatchRoomsForChoice(
      storage,
      "Alice",
      "cc:deck:deck-a",
      now + 1,
    )).toEqual(["ABC123"]);
    expect(loadRejectedMatchRoomsForChoice(
      storage,
      "Alice",
      "cc:deck:deck-b",
      now + 2,
    )).toEqual([]);
    expect(loadRejectedMatchRooms(storage, "Alice", now + 2)).toEqual([]);
  });
});
