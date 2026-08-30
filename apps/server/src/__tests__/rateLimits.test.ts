import { describe, expect, it } from "vitest";
import { PgRateLimiter, sweepRateLimits } from "../rateLimits.js";
import { freshDb } from "./testdb.js";

describe("shared rate limits", () => {
  it("counts attempts across gateway limiter instances without storing raw keys", async () => {
    const db = await freshDb();
    const a = new PgRateLimiter(db, "login-account", 2, 10_000);
    const b = new PgRateLimiter(db, "login-account", 2, 10_000);
    expect(await a.allow("Alice", "/api/login")).toBe(true);
    expect(await b.allow("Alice", "/api/login")).toBe(true);
    expect(await a.allow("Alice", "/api/login")).toBe(false);
    const { rows } = await db.query("SELECT bucket_hash, expires_at FROM rate_limit_buckets");
    expect(String(rows[0]!.bucket_hash)).not.toContain("Alice");
    expect(await sweepRateLimits(db, Number(rows[0]!.expires_at))).toBe(1);
  });
});
