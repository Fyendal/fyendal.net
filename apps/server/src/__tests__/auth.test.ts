import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteExpiredSessions,
  hashPassword,
  login,
  register,
  revokeAllSessions,
  revokeSession,
  sessionForToken,
  verifyPassword,
} from "../auth.js";
import type { Queryable, UserRow } from "../db.js";
import { createRateLimiter } from "../http.js";
import { freshDb } from "./testdb.js";

let db: Queryable;

beforeEach(async () => {
  db = await freshDb();
});

describe("register", () => {
  it("rejects invalid usernames", async () => {
    expect(await register(db, "ab", "password1")).toMatchObject({ ok: false });
    expect(await register(db, "a".repeat(21), "password1")).toMatchObject({ ok: false });
    expect(await register(db, "has space", "password1")).toMatchObject({ ok: false });
    expect(await register(db, "dash-name", "password1")).toMatchObject({ ok: false });
  });

  it("rejects short passwords", async () => {
    expect(await register(db, "player1", "short")).toEqual({
      ok: false,
      error: "password must be at least 8 characters",
    });
  });

  it("creates an active user identified by username", async () => {
    const r = await register(db, "Player1", "password1");
    expect(r).toEqual({ ok: true });
    const { rows } = await db.query("SELECT * FROM users WHERE username_lc = 'player1'");
    const user = rows[0] as UserRow;
    expect(user.username).toBe("Player1");
    expect((await db.query(
      "SELECT event_type, format, game_mode FROM analytics_events",
    )).rows).toEqual([{ event_type: "user_registered", format: null, game_mode: null }]);
  });

  it("retains an anonymous registration fact after account deletion", async () => {
    await register(db, "Player1", "password1");
    await db.query("DELETE FROM users WHERE username_lc = 'player1'");
    expect((await db.query(
      "SELECT event_type FROM analytics_events",
    )).rows).toEqual([{ event_type: "user_registered" }]);
  });

  it("rejects duplicate usernames case-insensitively with an explicit error", async () => {
    await register(db, "Player1", "password1");
    const r = await register(db, "PLAYER1", "password1");
    expect(r).toEqual({ ok: false, error: "username taken" });
  });

  it("turns a unique-violation race into the normal duplicate responses", async () => {
    // Simulate a concurrent registration landing between the existence checks
    // and the INSERT: plant a conflicting row just before the real INSERT.
    const plantThen = (row: [string, string]): Queryable => ({
      query: async (text, params) => {
        if (text.startsWith("INSERT INTO users")) {
          await db.query(
            "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ($1, $2, $3, $4)",
            [...row, "hash", 1],
          );
        }
        return db.query(text, params);
      },
    });

    // username conflict lost to a racer → explicit "username taken"
    const nameRace = await register(
      plantThen(["Racer", "racer"]),
      "Racer",
      "password1",
    );
    expect(nameRace).toEqual({ ok: false, error: "username taken" });
  });
});

describe("password hashing", () => {
  it("stores scrypt:N:r:p:salt:hash and verifies round-trip", async () => {
    const stored = await hashPassword("hunter2");
    const parts = stored.split(":");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toBe("131072");
    expect(parts[2]).toBe("8");
    expect(parts[3]).toBe("1");
    expect(await verifyPassword("hunter2", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
    // random salt: two hashes of the same password differ
    expect(await hashPassword("hunter2")).not.toBe(stored);
  });

  it("rejects malformed or excessive stored KDF parameters", async () => {
    expect(await verifyPassword("password", "not-a-hash")).toBe(false);
    expect(
      await verifyPassword(
        "password",
        `scrypt:1048576:8:1:${Buffer.alloc(16).toString("base64")}:${Buffer.alloc(64).toString("base64")}`,
      ),
    ).toBe(false);
  });

  it("derives passwords without blocking the event loop", async () => {
    let eventLoopAdvanced = false;
    let hashSettled = false;
    const hashing = hashPassword("hunter2");
    void hashing.then(() => {
      hashSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(() => {
      eventLoopAdvanced = true;
      resolve();
    }));
    expect(eventLoopAdvanced).toBe(true);
    expect(hashSettled).toBe(false);
    await hashing;
  });
});

describe("login and sessions", () => {
  it("logs in and resolves the session token", async () => {
    await register(db, "Player1", "password1");
    const r = await login(db, "player1", "password1"); // case-insensitive username
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.username).toBe("Player1");
    const user = await sessionForToken(db, r.token);
    expect(user).toMatchObject({ username: "Player1" });
  });

  it("gives the identical generic error for unknown user and wrong password", async () => {
    await register(db, "Player1", "password1");
    const wrongPw = await login(db, "player1", "wrong-password");
    const unknown = await login(db, "nosuchuser", "wrong-password");
    expect(wrongPw).toEqual({ ok: false, error: "invalid username or password" });
    expect(unknown).toEqual(wrongPw);
  });

  it("rejects expired sessions", async () => {
    await register(db, "Player1", "password1");
    const r = await login(db, "player1", "password1");
    if (!r.ok) throw new Error("login failed");
    await db.query("UPDATE sessions SET expires_at = $1", [Date.now() - 1000]);
    expect(await sessionForToken(db, r.token)).toBeNull();
  });

  it("rejects unknown tokens", async () => {
    expect(await sessionForToken(db, "nope")).toBeNull();
  });

  it("revokes a session token idempotently", async () => {
    await register(db, "Player1", "password1");
    const r = await login(db, "player1", "password1");
    if (!r.ok) throw new Error("login failed");
    await revokeSession(db, r.token);
    await revokeSession(db, r.token);
    expect(await sessionForToken(db, r.token)).toBeNull();
  });

  it("upgrades a legacy scrypt hash after a successful login", async () => {
    const legacy = "scrypt:16384:8:1:RnllbmRhbExlZ2FjeVNhbA==:j/RyzVc+4FbaUC3EKzwtzO4z1+DUj0jm5QX9XceEaK0zpdX15i8zlXB5McZXRjNdvKTKLz4rQ3SQk54gyCLhVw==";
    await db.query(
      "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ($1, $2, $3, $4)",
      ["Legacy", "legacy", legacy, Date.now()],
    );
    expect((await login(db, "legacy", "password1")).ok).toBe(true);
    const { rows } = await db.query("SELECT pass_hash FROM users WHERE username_lc = $1", ["legacy"]);
    expect((rows[0] as { pass_hash: string }).pass_hash).toMatch(/^scrypt:131072:8:1:/);
  });

  it("revokes every session for one account without touching another", async () => {
    await register(db, "Player1", "password1");
    await register(db, "Player2", "password1");
    const first = await login(db, "player1", "password1");
    const second = await login(db, "player1", "password1");
    const other = await login(db, "player2", "password1");
    if (!first.ok || !second.ok || !other.ok) throw new Error("login failed");
    const user = await sessionForToken(db, first.token);
    if (!user) throw new Error("session missing");

    await revokeAllSessions(db, user.id);
    expect(await sessionForToken(db, first.token)).toBeNull();
    expect(await sessionForToken(db, second.token)).toBeNull();
    expect(await sessionForToken(db, other.token)).not.toBeNull();
  });

  it("periodically removes only expired sessions", async () => {
    await register(db, "Player1", "password1");
    const expired = await login(db, "player1", "password1");
    const { rows: firstSessionRows } = await db.query("SELECT token_hash FROM sessions");
    const expiredHash = (firstSessionRows[0] as { token_hash: string }).token_hash;
    const live = await login(db, "player1", "password1");
    if (!expired.ok || !live.ok) throw new Error("login failed");
    await db.query("UPDATE sessions SET expires_at = $1 WHERE token_hash = $2", [Date.now() - 1, expiredHash]);

    expect(await deleteExpiredSessions(db)).toBe(1);
    expect(await sessionForToken(db, expired.token)).toBeNull();
    expect(await sessionForToken(db, live.token)).not.toBeNull();
  });
});

describe("rate limiter", () => {
  it("allows 10 requests per window, rejects the 11th", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 10; i++) {
      expect(limiter.allow("1.2.3.4", "/api/login")).toBe(true);
    }
    expect(limiter.allow("1.2.3.4", "/api/login")).toBe(false);
    // a different endpoint or IP is unaffected
    expect(limiter.allow("1.2.3.4", "/api/register")).toBe(true);
    expect(limiter.allow("5.6.7.8", "/api/login")).toBe(true);
    // reset clears buckets
    limiter.reset();
    expect(limiter.allow("1.2.3.4", "/api/login")).toBe(true);
  });
});
