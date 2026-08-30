import {
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { withTransaction, type Queryable, type UserRow } from "./db.js";
import { appendClusterEvent } from "./clusterEvents.js";
import { hashToken } from "./tokenHash.js";

// scrypt parameters: N=131072, r=8, p=1 with a random 16-byte salt,
// stored as scrypt:N:r:p:salt:hash (base64).
const SCRYPT = { N: 131072, r: 8, p: 1 };
const KEY_LEN = 64;
const SALT_LEN = 16;
const KDF_MAXMEM = 192 * 1024 * 1024;
const parsedConcurrency = Number(process.env.AUTH_KDF_CONCURRENCY ?? 1);
const KDF_CONCURRENCY = Number.isSafeInteger(parsedConcurrency) && parsedConcurrency > 0 && parsedConcurrency <= 2
  ? parsedConcurrency
  : 1;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** Fixed current-parameter hash so unknown users incur the same KDF work. */
const DUMMY_HASH = "scrypt:131072:8:1:RnllbmRhbER1bW15U2FsdA==:TmgefxdBmmbuirho4noH794T9JzF8cKAKCzHtSRw2R8ovRpGdfn1FsGSqQjiwW5lrGA+VDeqlbtj2WikjrCiZw==";

let activeKdfs = 0;
const kdfWaiters: Array<() => void> = [];

async function acquireKdfSlot(): Promise<void> {
  if (activeKdfs < KDF_CONCURRENCY) {
    activeKdfs += 1;
    return;
  }
  // The releasing job transfers its already-counted slot to this waiter.
  await new Promise<void>((resolve) => kdfWaiters.push(resolve));
}

async function withKdfSlot<T>(work: () => Promise<T>): Promise<T> {
  await acquireKdfSlot();
  try {
    return await work();
  } finally {
    const next = kdfWaiters.shift();
    if (next) next();
    else activeKdfs -= 1;
  }
}

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  const requiredMemory = 128 * params.N * params.r + 32 * 1024 * 1024;
  return withKdfSlot(() => new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, {
      ...params,
      maxmem: Math.max(KDF_MAXMEM, requiredMemory),
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  }));
}

interface ParsedPasswordHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  expected: Buffer;
}

function parsePasswordHash(stored: string): ParsedPasswordHash | null {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isSafeInteger(N) || N < 16384 || N > SCRYPT.N || (N & (N - 1)) !== 0) return null;
  if (!Number.isSafeInteger(r) || r < 1 || r > 16) return null;
  if (!Number.isSafeInteger(p) || p < 1 || p > 4) return null;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return null;
  return { N, r, p, salt, expected };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const hash = await deriveKey(password, salt, KEY_LEN, SCRYPT);
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  try {
    const actual = await deriveKey(password, parsed.salt, parsed.expected.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
    });
    return timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}

function passwordNeedsRehash(stored: string): boolean {
  const parsed = parsePasswordHash(stored);
  return !parsed || parsed.N !== SCRYPT.N || parsed.r !== SCRYPT.r || parsed.p !== SCRYPT.p;
}

export const hashSessionToken = hashToken;

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

async function userByName(
  db: Queryable,
  username: string,
): Promise<UserRow | undefined> {
  const { rows } = await db.query("SELECT * FROM users WHERE username_lc = $1", [
    username.toLowerCase(),
  ]);
  return rows[0] as UserRow | undefined;
}

async function userById(
  db: Queryable,
  id: number,
): Promise<UserRow | undefined> {
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] as UserRow | undefined;
}

export type RegisterResult = { ok: true } | { ok: false; error: string };

/** Create an account identified only by its unique username. */
export async function register(
  db: Queryable,
  username: string,
  password: string,
): Promise<RegisterResult> {
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      error: "username must be 3-20 characters (letters, digits, _)",
    };
  }
  if (password.length < 8) {
    return { ok: false, error: "password must be at least 8 characters" };
  }
  if (await userByName(db, username)) return { ok: false, error: "username taken" };
  try {
    const passHash = await hashPassword(password);
    await db.query(
      "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ($1, $2, $3, $4)",
      [username, username.toLowerCase(), passHash, Date.now()],
    );
  } catch (e) {
    // Lost a registration race (check-then-insert): a concurrent request
    // claimed the name between the check above and the INSERT.
    // Mirror those responses exactly instead of leaking the pg error.
    if ((e as { code?: string }).code !== "23505") throw e;
    if (await userByName(db, username)) return { ok: false, error: "username taken" };
    throw e;
  }
  return { ok: true };
}

export type LoginResult =
  | { ok: true; token: string; username: string }
  | { ok: false; error: string };

/** Issue a 30-day session. Generic error for unknown user / wrong password. */
export async function login(
  db: Queryable,
  username: string,
  password: string,
): Promise<LoginResult> {
  const user = await userByName(db, username);
  const ok = user
    ? await verifyPassword(password, user.pass_hash)
    : await verifyPassword(password, DUMMY_HASH) && false; // normalize timing
  if (!user || !ok) {
    return { ok: false, error: "invalid username or password" };
  }
  if (passwordNeedsRehash(user.pass_hash)) {
    const upgraded = await hashPassword(password);
    await db.query("UPDATE users SET pass_hash = $1 WHERE id = $2", [upgraded, user.id]);
  }
  const token = newToken();
  await db.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hashSessionToken(token), user.id, Date.now() + SESSION_TTL_MS],
  );
  return { ok: true, token, username: user.username };
}

export interface AuthUser {
  id: number;
  username: string;
}

/** Resolve a session token to its user; null when unknown/expired.
 *  Slides expiration forward once more than half the TTL has elapsed. */
export async function sessionForToken(
  db: Queryable,
  token: string,
): Promise<AuthUser | null> {
  const { rows } = await db.query(
    "SELECT * FROM sessions WHERE token_hash = $1",
    [hashSessionToken(token)],
  );
  const row = rows[0] as
    | { token_hash: string; user_id: number; expires_at: number }
    | undefined;
  if (!row) return null;
  const now = Date.now();
  const expiresAt = Number(row.expires_at);
  if (expiresAt <= now) {
    await withTransaction(db, async (tx) => {
      const deleted = await tx.query(
        "DELETE FROM sessions WHERE token_hash = $1 RETURNING token_hash",
        [row.token_hash],
      );
      if (deleted.rowCount) {
        await appendClusterEvent(tx, { type: "session-revoked", tokenHash: row.token_hash });
      }
    });
    return null;
  }
  if (expiresAt - now < SESSION_TTL_MS / 2) {
    await db.query("UPDATE sessions SET expires_at = $1 WHERE token_hash = $2", [
      now + SESSION_TTL_MS,
      row.token_hash,
    ]);
  }
  const user = await userById(db, row.user_id);
  if (!user) return null;
  return { id: user.id, username: user.username };
}

/** Revoke one opaque session token. Idempotent so logout is safe to retry. */
export async function revokeSession(db: Queryable, token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await withTransaction(db, async (tx) => {
    const deleted = await tx.query(
      "DELETE FROM sessions WHERE token_hash = $1 RETURNING token_hash",
      [tokenHash],
    );
    if (deleted.rowCount) {
      await appendClusterEvent(tx, { type: "session-revoked", tokenHash });
    }
  });
}

/** Revoke every session belonging to an account. */
export async function revokeAllSessions(db: Queryable, userId: number): Promise<void> {
  await withTransaction(db, async (tx) => {
    const deleted = await tx.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    if (deleted.rowCount) {
      await appendClusterEvent(tx, { type: "user-sessions-revoked", userId });
    }
  });
}

/** Delete expired sessions in one bounded, indexable statement. */
export async function deleteExpiredSessions(
  db: Queryable,
  now = Date.now(),
): Promise<number> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      "DELETE FROM sessions WHERE expires_at <= $1 RETURNING token_hash",
      [now],
    );
    for (const row of rows as Array<Record<string, unknown>>) {
      const tokenHash = row.token_hash;
      if (typeof tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(tokenHash)) {
        throw new Error("invalid deleted session token hash");
      }
      await appendClusterEvent(tx, { type: "session-revoked", tokenHash });
    }
    return rows.length;
  });
}
