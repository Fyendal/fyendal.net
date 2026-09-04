import { describe, expect, it } from "vitest";
import {
  AUTH_STORAGE_KEY,
  BOT_MATCHMAKING_PREFERENCE_STORAGE_KEY,
  DEFAULT_GAME_SETTINGS,
  DEFAULT_LOBBY_SETTINGS,
  GAME_SETTINGS_STORAGE_KEY,
  LOBBY_SETTINGS_STORAGE_KEY,
  loadRejectedMatchRooms,
  loadRejectedMatchRoomsForChoice,
  loadGameSettings,
  loadBotMatchmakingPreference,
  loadLobbySettings,
  lobbySettingsStorageKey,
  replayStorageKey,
  rememberRejectedMatchRoom,
  pruneRejectedMatchRooms,
  ROOM_SESSION_STORAGE_KEY,
  saveGameSettings,
  saveBotMatchmakingPreference,
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

  it("round-trips the versioned game settings", () => {
    let stored: string | null = null;
    const storage = {
      getItem: (key: string) => key === GAME_SETTINGS_STORAGE_KEY ? stored : null,
      setItem: (key: string, value: string) => {
        if (key === GAME_SETTINGS_STORAGE_KEY) stored = value;
      },
    };

    expect(loadGameSettings(storage)).toEqual({
      version: 6,
      priorityWindowMode: "always-pause",
      lessGuidance: true,
      skipPlayConfirmation: true,
      motionPreference: "system",
      playabilityCuePreference: "glow",
      soundEffectsEnabled: true,
      soundEffectsVolume: 35,
    });
    saveGameSettings(storage, {
      version: 6,
      priorityWindowMode: "auto-pass",
      lessGuidance: false,
      skipPlayConfirmation: false,
      motionPreference: "reduced",
      playabilityCuePreference: "high-contrast",
      soundEffectsEnabled: false,
      soundEffectsVolume: 60,
    });
    expect(loadGameSettings(storage)).toEqual({
      version: 6,
      priorityWindowMode: "auto-pass",
      lessGuidance: false,
      skipPlayConfirmation: false,
      motionPreference: "reduced",
      playabilityCuePreference: "high-contrast",
      soundEffectsEnabled: false,
      soundEffectsVolume: 60,
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
      version: 6,
      priorityWindowMode: "auto-pass",
      lessGuidance: true,
      skipPlayConfirmation: false,
      motionPreference: "system",
      playabilityCuePreference: "glow",
      soundEffectsEnabled: true,
      soundEffectsVolume: 35,
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
      version: 6,
      priorityWindowMode: "auto-pass",
      lessGuidance: true,
      skipPlayConfirmation: false,
      motionPreference: "reduced",
      playabilityCuePreference: "glow",
      soundEffectsEnabled: true,
      soundEffectsVolume: 35,
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
      version: 6,
      priorityWindowMode: "auto-pass",
      lessGuidance: true,
      skipPlayConfirmation: false,
      motionPreference: "full",
      playabilityCuePreference: "glow",
      soundEffectsEnabled: false,
      soundEffectsVolume: 60,
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
      getItem: () => JSON.stringify({ version: 7, priorityWindowMode: "auto-pass" }),
    })).toEqual(DEFAULT_GAME_SETTINGS);
    expect(loadGameSettings({
      getItem: () => JSON.stringify({
        ...DEFAULT_GAME_SETTINGS,
        soundEffectsVolume: 101,
      }),
    })).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it("keeps lobby preferences independent by account and constructed format", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    expect(loadLobbySettings(storage, "Alice")).toEqual(DEFAULT_LOBBY_SETTINGS);
    saveLobbySettings(storage, "Alice", {
      version: 4,
      cardPoolModes: { cc: "open", "silver-age": "legal" },
      lastPlayedDecks: { cc: "deck-cc", "silver-age": "deck-123" },
    });
    expect(loadLobbySettings(storage, "ALICE")).toEqual({
      version: 4,
      cardPoolModes: { cc: "open", "silver-age": "legal" },
      lastPlayedDecks: { cc: "deck-cc", "silver-age": "deck-123" },
    });
    expect(loadLobbySettings(storage, "Bob")).toEqual(DEFAULT_LOBBY_SETTINGS);
  });

  it("migrates old lobby settings and rejects malformed remembered decks", () => {
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

    expect(loadLobbySettings(storage, "Alice", { migrateLegacy: true })).toEqual({
      version: 4,
      cardPoolModes: { cc: "future", "silver-age": "legal" },
      lastPlayedDecks: { cc: null, "silver-age": "precon-sba" },
    });
    expect(values.has(LOBBY_SETTINGS_STORAGE_KEY)).toBe(false);
    expect(values.has(lobbySettingsStorageKey("Alice"))).toBe(true);

    values.set(lobbySettingsStorageKey("Charlie"), JSON.stringify({
      version: 1,
      allowFutureCards: { cc: false, "silver-age": true },
    }));
    expect(loadLobbySettings(storage, "Charlie")).toEqual({
      version: 4,
      cardPoolModes: { cc: "legal", "silver-age": "future" },
      lastPlayedDecks: { cc: null, "silver-age": null },
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

    pruneRejectedMatchRooms(storage, "Alice", new Set(["DEF456"]), now + 3);
    expect(loadRejectedMatchRooms(storage, "Alice", now + 3)).toEqual(["DEF456"]);
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
