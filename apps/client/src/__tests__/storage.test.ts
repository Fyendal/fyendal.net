import { describe, expect, it } from "vitest";
import {
  AUTH_STORAGE_KEY,
  DEFAULT_GAME_SETTINGS,
  DEFAULT_LOBBY_SETTINGS,
  GAME_SETTINGS_STORAGE_KEY,
  LOBBY_SETTINGS_STORAGE_KEY,
  loadRejectedMatchRooms,
  loadRejectedMatchRoomsForChoice,
  loadGameSettings,
  loadLobbySettings,
  lobbySettingsStorageKey,
  replayStorageKey,
  rememberRejectedMatchRoom,
  pruneRejectedMatchRooms,
  ROOM_SESSION_STORAGE_KEY,
  saveGameSettings,
  saveLobbySettings,
} from "../storage.js";

describe("client storage keys", () => {
  it("uses the initial release namespace without migration generations", () => {
    expect(AUTH_STORAGE_KEY).toBe("fyendal-auth");
    expect(ROOM_SESSION_STORAGE_KEY).toBe("fyendal-room-session");
    expect(replayStorageKey("ABC123")).toBe("fyendal-replay-ABC123");
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
      version: 4,
      priorityWindowMode: "always-pause",
      lessGuidance: false,
      skipPlayConfirmation: true,
      motionPreference: "system",
      soundEffectsEnabled: true,
      soundEffectsVolume: 35,
    });
    saveGameSettings(storage, {
      version: 4,
      priorityWindowMode: "auto-pass",
      lessGuidance: true,
      skipPlayConfirmation: false,
      motionPreference: "reduced",
      soundEffectsEnabled: false,
      soundEffectsVolume: 60,
    });
    expect(loadGameSettings(storage)).toEqual({
      version: 4,
      priorityWindowMode: "auto-pass",
      lessGuidance: true,
      skipPlayConfirmation: false,
      motionPreference: "reduced",
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
      version: 4,
      priorityWindowMode: "auto-pass",
      lessGuidance: true,
      skipPlayConfirmation: false,
      motionPreference: "system",
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
      version: 4,
      priorityWindowMode: "auto-pass",
      lessGuidance: true,
      skipPlayConfirmation: false,
      motionPreference: "reduced",
      soundEffectsEnabled: true,
      soundEffectsVolume: 35,
    });
  });

  it("migrates version 1 users to pause priority and auto-confirm", () => {
    expect(loadGameSettings({
      getItem: () => JSON.stringify({
        version: 1,
        priorityWindowMode: "auto-pass",
        lessGuidance: true,
        skipPlayConfirmation: false,
      }),
    })).toEqual({
      ...DEFAULT_GAME_SETTINGS,
      lessGuidance: true,
    });
  });

  it("falls back safely for invalid or future settings", () => {
    expect(loadGameSettings({ getItem: () => "not json" })).toEqual(DEFAULT_GAME_SETTINGS);
    expect(loadGameSettings({
      getItem: () => JSON.stringify({ version: 5, priorityWindowMode: "auto-pass" }),
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
      version: 3,
      allowFutureCards: { cc: true, "silver-age": false },
      lastPlayedDecks: { cc: "deck-cc", "silver-age": "deck-123" },
    });
    expect(loadLobbySettings(storage, "ALICE")).toEqual({
      version: 3,
      allowFutureCards: { cc: true, "silver-age": false },
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
      version: 3,
      allowFutureCards: { cc: true, "silver-age": false },
      lastPlayedDecks: { cc: null, "silver-age": "precon-sba" },
    });
    expect(values.has(LOBBY_SETTINGS_STORAGE_KEY)).toBe(false);
    expect(values.has(lobbySettingsStorageKey("Alice"))).toBe(true);

    values.set(lobbySettingsStorageKey("Charlie"), JSON.stringify({
      version: 1,
      allowFutureCards: { cc: false, "silver-age": true },
    }));
    expect(loadLobbySettings(storage, "Charlie")).toEqual({
      version: 3,
      allowFutureCards: { cc: false, "silver-age": true },
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
