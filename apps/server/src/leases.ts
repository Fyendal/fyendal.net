import type { Queryable } from "./db.js";

/** Try to acquire or renew one expiring work lease. The conditional update is
 * the cross-instance ownership decision; insertion handles the first owner. */
export async function tryAcquireLease(
  db: Queryable,
  name: string,
  ownerId: string,
  ttlMs: number,
  now = Date.now(),
): Promise<boolean> {
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(name)) throw new Error("invalid lease name");
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(ownerId)) throw new Error("invalid lease owner");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 10 * 60_000) {
    throw new Error("invalid lease duration");
  }
  const leaseUntil = now + ttlMs;
  const updated = await db.query(
    `UPDATE worker_leases SET owner_id = $2, lease_until = $3
     WHERE name = $1 AND (owner_id = $2 OR lease_until <= $4)`,
    [name, ownerId, leaseUntil, now],
  );
  if (updated.rowCount === 1) return true;
  // Avoid depending on driver-specific rowCount behavior for an
  // ON CONFLICT no-op (pg-mem differs from PostgreSQL here). The unique key
  // still resolves a first-insert race safely.
  const existing = await db.query("SELECT name FROM worker_leases WHERE name = $1", [name]);
  if (existing.rows.length > 0) return false;
  try {
    const inserted = await db.query(
      "INSERT INTO worker_leases(name, owner_id, lease_until) VALUES ($1,$2,$3)",
      [name, ownerId, leaseUntil],
    );
    return inserted.rowCount === 1;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return false;
    throw error;
  }
}

export async function releaseLease(db: Queryable, name: string, ownerId: string): Promise<void> {
  await db.query("DELETE FROM worker_leases WHERE name = $1 AND owner_id = $2", [name, ownerId]);
}
