import { AUTH_STORAGE_KEY, ROOM_SESSION_STORAGE_KEY } from "../storage.js";

export interface StoredAuth {
  token: string;
  username: string;
}

export interface StoredRoomSession {
  code: string;
  token: string;
}

function exactRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === keys.length && keys.every((key) => key in record)
    ? record
    : null;
}

export function saveRoomSession(storage: Storage, session: StoredRoomSession): void {
  storage.setItem(ROOM_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function loadRoomSession(storage: Storage): StoredRoomSession | null {
  try {
    const raw = storage.getItem(ROOM_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const record = exactRecord(JSON.parse(raw) as unknown, ["code", "token"]);
    if (!record || typeof record.code !== "string" || !/^[A-Z0-9]{6}$/.test(record.code) ||
      typeof record.token !== "string" || record.token.length > 256) return null;
    return { code: record.code, token: record.token };
  } catch {
    return null;
  }
}

export function saveStoredAuth(storage: Storage, auth: StoredAuth): void {
  storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function loadStoredAuth(storage: Storage): StoredAuth | null {
  try {
    const raw = storage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const record = exactRecord(JSON.parse(raw) as unknown, ["token", "username"]);
    if (!record || typeof record.token !== "string" || record.token.length > 256 ||
      typeof record.username !== "string" || record.username.length > 100) return null;
    return { token: record.token, username: record.username };
  } catch {
    return null;
  }
}
