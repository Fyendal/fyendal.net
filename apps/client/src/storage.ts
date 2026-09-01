import type { PriorityWindowMode } from "@fyendal/shared";
import { MAX_MATCHMAKING_AVOID_ROOM_CODES } from "@fyendal/protocol";
import type { ConstructedFormat } from "./domain.js";

export const AUTH_STORAGE_KEY = "fyendal-auth";
export const ROOM_SESSION_STORAGE_KEY = "fyendal-room-session";
export const REPLAY_STORAGE_PREFIX = "fyendal-replay-";
export const GAME_SETTINGS_STORAGE_KEY = "fyendal-game-settings";
/** Legacy browser-wide key. Read once to migrate it to the signed-in account. */
export const LOBBY_SETTINGS_STORAGE_KEY = "fyendal-lobby-settings";
const LOBBY_SETTINGS_STORAGE_PREFIX = `${LOBBY_SETTINGS_STORAGE_KEY}-`;
const MATCHMAKING_AVOIDANCE_STORAGE_PREFIX = "fyendal-matchmaking-avoid-";
const MATCHMAKING_AVOIDANCE_TTL_MS = 24 * 60 * 60 * 1000;

interface RejectedMatchRoom {
  code: string;
  rejectedAt: number;
}

interface RejectedMatchState {
  /** Null only for legacy records written before avoidance was choice-scoped. */
  choiceKey: string | null;
  rooms: RejectedMatchRoom[];
}

function matchmakingAvoidanceStorageKey(username: string): string {
  return `${MATCHMAKING_AVOIDANCE_STORAGE_PREFIX}${username.toLowerCase()}`;
}

function loadRejectedMatchEntries(
  storage: Pick<Storage, "getItem">,
  username: string,
): RejectedMatchState {
  try {
    const raw = storage.getItem(matchmakingAvoidanceStorageKey(username));
    if (!raw) return { choiceKey: null, rooms: [] };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return { choiceKey: null, rooms: [] };
    const record = value as Record<string, unknown>;
    const legacy = record.version === 1;
    if (
      (legacy
        ? Object.keys(record).length !== 2
        : Object.keys(record).length !== 3) ||
      (record.version !== 1 && record.version !== 2) ||
      !Array.isArray(record.rooms) ||
      record.rooms.length > MAX_MATCHMAKING_AVOID_ROOM_CODES ||
      (!legacy && (
        typeof record.choiceKey !== "string" ||
        record.choiceKey.length === 0 ||
        record.choiceKey.length > 300
      ))
    ) {
      return { choiceKey: null, rooms: [] };
    }
    const rooms: RejectedMatchRoom[] = [];
    for (const entry of record.rooms) {
      if (!entry || typeof entry !== "object") return { choiceKey: null, rooms: [] };
      const room = entry as Record<string, unknown>;
      if (
        Object.keys(room).length !== 2 ||
        !("code" in room) ||
        !("rejectedAt" in room) ||
        typeof room.code !== "string" ||
        !/^[A-Z0-9]{6}$/.test(room.code) ||
        typeof room.rejectedAt !== "number" ||
        !Number.isSafeInteger(room.rejectedAt) ||
        room.rejectedAt < 0
      ) return { choiceKey: null, rooms: [] };
      rooms.push({ code: room.code, rejectedAt: room.rejectedAt });
    }
    return { choiceKey: legacy ? null : record.choiceKey as string, rooms };
  } catch {
    return { choiceKey: null, rooms: [] };
  }
}

function rejectionIsCurrent(room: RejectedMatchRoom, now: number): boolean {
  return room.rejectedAt <= now && now - room.rejectedAt <= MATCHMAKING_AVOIDANCE_TTL_MS;
}

function saveRejectedMatchEntries(
  storage: Pick<Storage, "setItem">,
  username: string,
  choiceKey: string,
  rooms: RejectedMatchRoom[],
): void {
  try {
    storage.setItem(matchmakingAvoidanceStorageKey(username), JSON.stringify({
      version: 2,
      choiceKey,
      rooms,
    }));
  } catch {
    // Matchmaking still works when localStorage is blocked or full.
  }
}

export function loadRejectedMatchRooms(
  storage: Pick<Storage, "getItem">,
  username: string,
  now = Date.now(),
): string[] {
  return loadRejectedMatchEntries(storage, username).rooms
    .filter((room) => rejectionIsCurrent(room, now))
    .map((room) => room.code);
}

/** Select the exclusions for one queue choice. Changing format/hero/deck
 * clears exclusions from the previous choice before the request is sent. */
export function loadRejectedMatchRoomsForChoice(
  storage: Pick<Storage, "getItem" | "setItem">,
  username: string,
  choiceKey: string,
  now = Date.now(),
): string[] {
  const state = loadRejectedMatchEntries(storage, username);
  const rooms = state.rooms.filter((room) => rejectionIsCurrent(room, now));
  if (state.choiceKey !== choiceKey) {
    saveRejectedMatchEntries(storage, username, choiceKey, []);
    return [];
  }
  if (rooms.length !== state.rooms.length) {
    saveRejectedMatchEntries(storage, username, choiceKey, rooms);
  }
  return rooms.map((room) => room.code);
}

export function rememberRejectedMatchRoom(
  storage: Pick<Storage, "getItem" | "setItem">,
  username: string,
  code: string,
  now = Date.now(),
  choiceKey = "legacy",
): void {
  const normalized = code.toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized)) return;
  const state = loadRejectedMatchEntries(storage, username);
  const rooms = (state.choiceKey === choiceKey ? state.rooms : [])
    .filter((room) => rejectionIsCurrent(room, now) && room.code !== normalized);
  rooms.push({ code: normalized, rejectedAt: now });
  saveRejectedMatchEntries(
    storage,
    username,
    choiceKey,
    rooms.slice(-MAX_MATCHMAKING_AVOID_ROOM_CODES),
  );
}

export function pruneRejectedMatchRooms(
  storage: Pick<Storage, "getItem" | "setItem">,
  username: string,
  listedRoomCodes: ReadonlySet<string>,
  now = Date.now(),
): void {
  const state = loadRejectedMatchEntries(storage, username);
  const rooms = state.rooms.filter((room) =>
    rejectionIsCurrent(room, now) && listedRoomCodes.has(room.code)
  );
  if (rooms.length !== state.rooms.length && state.choiceKey !== null) {
    saveRejectedMatchEntries(storage, username, state.choiceKey, rooms);
  }
}

export interface LobbySettings {
  version: 3;
  allowFutureCards: Record<ConstructedFormat, boolean>;
  lastPlayedDecks: Record<ConstructedFormat, string | null>;
}

export const DEFAULT_LOBBY_SETTINGS: LobbySettings = {
  version: 3,
  allowFutureCards: { cc: false, "silver-age": false },
  lastPlayedDecks: { cc: null, "silver-age": null },
};

export function lobbySettingsStorageKey(username: string): string {
  return `${LOBBY_SETTINGS_STORAGE_PREFIX}${username.toLowerCase()}`;
}

function decodeLobbySettings(raw: string): LobbySettings {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_LOBBY_SETTINGS;
    const record = value as Record<string, unknown>;
    const future = record.allowFutureCards;
    if (!future || typeof future !== "object") return DEFAULT_LOBBY_SETTINGS;
    const flags = future as Record<string, unknown>;
    if (typeof flags.cc !== "boolean" || typeof flags["silver-age"] !== "boolean") {
      return DEFAULT_LOBBY_SETTINGS;
    }
    const allowFutureCards = { cc: flags.cc, "silver-age": flags["silver-age"] };
    if (record.version === 1) {
      return {
        version: 3,
        allowFutureCards,
        lastPlayedDecks: { cc: null, "silver-age": null },
      };
    }
    if (record.version === 2) {
      const lastPlayed = record.lastPlayedDeck;
      if (lastPlayed === null) {
        return {
          version: 3,
          allowFutureCards,
          lastPlayedDecks: { cc: null, "silver-age": null },
        };
      }
      if (!lastPlayed || typeof lastPlayed !== "object") return DEFAULT_LOBBY_SETTINGS;
      const choice = lastPlayed as Record<string, unknown>;
      if (
        (choice.format !== "cc" && choice.format !== "silver-age") ||
        typeof choice.deckId !== "string" ||
        choice.deckId.length === 0 ||
        choice.deckId.length > 256
      ) return DEFAULT_LOBBY_SETTINGS;
      return {
        version: 3,
        allowFutureCards,
        lastPlayedDecks: {
          cc: choice.format === "cc" ? choice.deckId : null,
          "silver-age": choice.format === "silver-age" ? choice.deckId : null,
        },
      };
    }
    if (record.version !== 3) return DEFAULT_LOBBY_SETTINGS;

    const lastPlayed = record.lastPlayedDecks;
    if (!lastPlayed || typeof lastPlayed !== "object") return DEFAULT_LOBBY_SETTINGS;
    const choices = lastPlayed as Record<string, unknown>;
    if (
      (choices.cc !== null && (
        typeof choices.cc !== "string" || choices.cc.length === 0 || choices.cc.length > 256
      )) ||
      (choices["silver-age"] !== null && (
        typeof choices["silver-age"] !== "string" ||
        choices["silver-age"].length === 0 ||
        choices["silver-age"].length > 256
      ))
    ) return DEFAULT_LOBBY_SETTINGS;
    return {
      version: 3,
      allowFutureCards,
      lastPlayedDecks: {
        cc: choices.cc as string | null,
        "silver-age": choices["silver-age"] as string | null,
      },
    };
  } catch {
    return DEFAULT_LOBBY_SETTINGS;
  }
}

/** Load one account's settings and claim the old browser-wide record once. */
export function loadLobbySettings(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  username: string,
  options?: { migrateLegacy?: boolean },
): LobbySettings {
  const accountKey = lobbySettingsStorageKey(username);
  try {
    const accountRaw = storage.getItem(accountKey);
    if (accountRaw !== null) return decodeLobbySettings(accountRaw);

    if (options?.migrateLegacy !== true) return DEFAULT_LOBBY_SETTINGS;
    const legacyRaw = storage.getItem(LOBBY_SETTINGS_STORAGE_KEY);
    if (legacyRaw === null) return DEFAULT_LOBBY_SETTINGS;
    const settings = decodeLobbySettings(legacyRaw);
    try {
      storage.setItem(accountKey, JSON.stringify(settings));
      storage.removeItem(LOBBY_SETTINGS_STORAGE_KEY);
    } catch {
      // Keep the legacy copy when migration cannot be persisted.
    }
    return settings;
  } catch {
    return DEFAULT_LOBBY_SETTINGS;
  }
}

export function saveLobbySettings(
  storage: Pick<Storage, "setItem">,
  username: string,
  settings: LobbySettings,
): void {
  try {
    storage.setItem(lobbySettingsStorageKey(username), JSON.stringify(settings));
  } catch {
    // Keep the in-memory preference when localStorage is unavailable.
  }
}

export type { PriorityWindowMode };
export type MotionPreference = "system" | "full" | "reduced";
export type PlayabilityCuePreference = "glow" | "high-contrast";

export interface GameSettings {
  version: 5;
  priorityWindowMode: PriorityWindowMode;
  lessGuidance: boolean;
  skipPlayConfirmation: boolean;
  motionPreference: MotionPreference;
  playabilityCuePreference: PlayabilityCuePreference;
  soundEffectsEnabled: boolean;
  soundEffectsVolume: number;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  version: 5,
  priorityWindowMode: "always-pause",
  lessGuidance: false,
  skipPlayConfirmation: true,
  motionPreference: "system",
  playabilityCuePreference: "glow",
  soundEffectsEnabled: true,
  soundEffectsVolume: 35,
};

export function replayStorageKey(code: string): string {
  return `${REPLAY_STORAGE_PREFIX}${code}`;
}

export function loadGameSettings(storage: Pick<Storage, "getItem">): GameSettings {
  try {
    const raw = storage.getItem(GAME_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_GAME_SETTINGS;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_GAME_SETTINGS;
    const record = value as Record<string, unknown>;

    // Version 2 rolls the current behavior defaults out once. Preserve the
    // unrelated guidance preference while replacing the old defaults;
    // subsequent version 2 choices remain user-controlled.
    if (record.version === 1) {
      return {
        ...DEFAULT_GAME_SETTINGS,
        lessGuidance: typeof record.lessGuidance === "boolean" ? record.lessGuidance : false,
      };
    }
    if (
      (
        record.version !== 2
        && record.version !== 3
        && record.version !== 4
        && record.version !== 5
      )
      || (
        record.priorityWindowMode !== "auto-pass"
        && record.priorityWindowMode !== "always-pause"
      )
    ) return DEFAULT_GAME_SETTINGS;
    const motionPreference = (
      record.version === 3
      || record.version === 4
      || record.version === 5
    )
      && (
        record.motionPreference === "system"
        || record.motionPreference === "full"
        || record.motionPreference === "reduced"
      )
      ? record.motionPreference
      : "system";
    if (
      (record.version === 4 || record.version === 5)
      && (
        typeof record.soundEffectsEnabled !== "boolean"
        || typeof record.soundEffectsVolume !== "number"
        || !Number.isSafeInteger(record.soundEffectsVolume)
        || record.soundEffectsVolume < 0
        || record.soundEffectsVolume > 100
      )
    ) return DEFAULT_GAME_SETTINGS;
    const playabilityCuePreference = record.version === 5
      ? record.playabilityCuePreference
      : "glow";
    if (
      playabilityCuePreference !== "glow"
      && playabilityCuePreference !== "high-contrast"
    ) return DEFAULT_GAME_SETTINGS;
    return {
      version: 5,
      priorityWindowMode: record.priorityWindowMode,
      lessGuidance: typeof record.lessGuidance === "boolean" ? record.lessGuidance : false,
      skipPlayConfirmation: typeof record.skipPlayConfirmation === "boolean"
        ? record.skipPlayConfirmation
        : true,
      motionPreference,
      playabilityCuePreference,
      soundEffectsEnabled: record.version === 4 || record.version === 5
        ? record.soundEffectsEnabled as boolean
        : true,
      soundEffectsVolume: record.version === 4 || record.version === 5
        ? record.soundEffectsVolume as number
        : 35,
    };
  } catch {
    return DEFAULT_GAME_SETTINGS;
  }
}

export function saveGameSettings(
  storage: Pick<Storage, "setItem">,
  settings: GameSettings,
): void {
  try {
    storage.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A blocked/full localStorage should not make the game settings unusable
    // for the current page lifetime.
  }
}
