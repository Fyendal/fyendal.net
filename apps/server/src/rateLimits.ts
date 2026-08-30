import { createHash } from "node:crypto";
import type { Queryable } from "./db.js";
import type { RateLimiter } from "./http.js";

/** Postgres fixed-window limiter shared by every gateway. Raw IP addresses and
 * login names are hashed before persistence. */
export class PgRateLimiter implements RateLimiter {
  constructor(
    private readonly db: Queryable,
    private readonly namespace: string,
    private readonly max: number,
    private readonly windowMs: number,
  ) {
    if (!/^[a-z0-9-]{1,40}$/.test(namespace)) throw new Error("invalid rate-limit namespace");
    if (!Number.isSafeInteger(max) || max < 1) throw new Error("invalid rate limit");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1_000) throw new Error("invalid rate window");
  }

  async allow(key: string, endpoint: string): Promise<boolean> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const bucketHash = createHash("sha256")
      .update(this.namespace).update("\0").update(key).update("\0").update(endpoint)
      .digest("hex");
    const { rows } = await this.db.query(
      `INSERT INTO rate_limit_buckets(bucket_hash, window_start, request_count, expires_at)
       VALUES ($1,$2,1,$3)
       ON CONFLICT (bucket_hash, window_start) DO UPDATE
         SET request_count = rate_limit_buckets.request_count + 1
       RETURNING request_count`,
      [bucketHash, windowStart, windowStart + this.windowMs],
    );
    const count = Number(rows[0]?.request_count);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("invalid rate-limit counter");
    return count <= this.max;
  }

  async reset(): Promise<void> {
    await this.db.query("DELETE FROM rate_limit_buckets");
  }

  async bucketCount(): Promise<number> {
    const { rows } = await this.db.query("SELECT COUNT(*) AS count FROM rate_limit_buckets");
    return Number(rows[0]?.count ?? 0);
  }
}

export async function sweepRateLimits(db: Queryable, now = Date.now()): Promise<number> {
  const result = await db.query("DELETE FROM rate_limit_buckets WHERE expires_at <= $1", [now]);
  return result.rowCount ?? 0;
}
