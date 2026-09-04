import { AUTH_STORAGE_KEY, ROOM_SESSION_STORAGE_KEY } from "../storage.js";

export interface StoredAuth {
  token: string;
  username: string;
}

export interface StoredRoomSession {
  code: string;
  token: string;
}

const ROOM_SESSION_PREFIX = `${ROOM_SESSION_STORAGE_KEY}:`;

function exactRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === keys.length && keys.every((key) => key in record)
    ? record
    : null;
}

export function saveRoomSession(storage: Storage, session: StoredRoomSession): void {
  storage.setItem(`${ROOM_SESSION_PREFIX}${session.code}`, JSON.stringify(session));
  storage.removeItem(ROOM_SESSION_STORAGE_KEY);
}

function decodeRoomSession(raw: string | null): StoredRoomSession | null {
  try {
    if (!raw) return null;
    const record = exactRecord(JSON.parse(raw) as unknown, ["code", "token"]);
    if (!record || typeof record.code !== "string" || !/^[A-Z0-9]{6}$/.test(record.code) ||
      typeof record.token !== "string" || record.token.length > 256) return null;
    return { code: record.code, token: record.token };
  } catch {
    return null;
  }
}

export function loadRoomSession(storage: Storage, code: string): StoredRoomSession | null {
  const upperCode = code.toUpperCase();
  const current = decodeRoomSession(storage.getItem(`${ROOM_SESSION_PREFIX}${upperCode}`));
  if (current?.code === upperCode) return current;
  const legacy = decodeRoomSession(storage.getItem(ROOM_SESSION_STORAGE_KEY));
  if (legacy) {
    saveRoomSession(storage, legacy);
    return legacy.code === upperCode ? legacy : null;
  }
  return null;
}

export function removeRoomSession(storage: Storage, code: string | null): void {
  if (code) storage.removeItem(`${ROOM_SESSION_PREFIX}${code.toUpperCase()}`);
  storage.removeItem(ROOM_SESSION_STORAGE_KEY);
}

export function clearRoomSessions(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key === ROOM_SESSION_STORAGE_KEY || key?.startsWith(ROOM_SESSION_PREFIX)) {
      storage.removeItem(key);
    }
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
