import type { Queryable } from "./db.js";

/** The allowlist is written only by the operator dashboard. */
export async function isBetaTester(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM beta_testers WHERE user_id = $1", [userId]);
  return rows.length > 0;
}
