import { appendClusterEvent } from "./clusterEvents.js";
import { withTransaction, type Queryable } from "./db.js";

export class RulesetFenceError extends Error {
  readonly code = "RULESET_FENCE";

  constructor(active: string, requested: string) {
    super(`ruleset ${requested} is fenced; active ruleset is ${active}`);
    this.name = "RulesetFenceError";
  }
}

function decodeActive(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 160) {
    throw new Error("invalid active ruleset configuration");
  }
  return value;
}

/** Initialize an empty database fence, or verify that this binary belongs to
 * the operator-selected ruleset. This never performs a cutover implicitly. */
export async function ensureActiveRuleset(db: Queryable, rulesetVersion: string): Promise<void> {
  if (!rulesetVersion) throw new Error("rulesetVersion is required");
  await withTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      "SELECT active_ruleset_version FROM runtime_config WHERE singleton = TRUE FOR UPDATE",
    );
    if (rows.length !== 1) throw new Error("runtime ruleset configuration is missing");
    let active = decodeActive(rows[0]!.active_ruleset_version);
    if (active === null) {
      const existing = await tx.query(
        "SELECT DISTINCT ruleset_version FROM rooms ORDER BY ruleset_version",
      );
      if (existing.rows.length > 1) {
        throw new Error("multiple persisted rulesets require an explicit cutover");
      }
      if (existing.rows.length === 1) {
        active = decodeActive(existing.rows[0]!.ruleset_version);
      }
      await tx.query(
        `UPDATE runtime_config SET active_ruleset_version = $1,
           generation = generation + 1, updated_at = $2 WHERE singleton = TRUE`,
        [active ?? rulesetVersion, Date.now()],
      );
      if (active === null || active === rulesetVersion) return;
    }
    if (active !== rulesetVersion) throw new RulesetFenceError(active, rulesetVersion);
  });
}

/** Fence room creation by a process from a superseded ruleset. FOR SHARE
 * serializes this check against the explicit cutover's FOR UPDATE lock. */
export async function assertActiveRuleset(db: Queryable, rulesetVersion: string): Promise<void> {
  const { rows } = await db.query(
    "SELECT active_ruleset_version FROM runtime_config WHERE singleton = TRUE FOR SHARE",
  );
  if (rows.length !== 1) throw new Error("runtime ruleset configuration is missing");
  const active = decodeActive(rows[0]!.active_ruleset_version);
  if (active !== null && active !== rulesetVersion) throw new RulesetFenceError(active, rulesetVersion);
}

/** Explicit operator cutover. Incompatible active rooms and unfinished replay
 * recordings are invalidated atomically with the fence generation change. */
export async function activateRuleset(
  db: Queryable,
  rulesetVersion: string,
): Promise<Array<{ code: string; version: number }>> {
  if (!rulesetVersion) throw new Error("rulesetVersion is required");
  return withTransaction(db, async (tx) => {
    const { rows: configRows } = await tx.query(
      "SELECT active_ruleset_version FROM runtime_config WHERE singleton = TRUE FOR UPDATE",
    );
    if (configRows.length !== 1) throw new Error("runtime ruleset configuration is missing");
    const { rows } = await tx.query(
      "DELETE FROM rooms WHERE ruleset_version <> $1 RETURNING code, version",
      [rulesetVersion],
    );
    await tx.query(
      "DELETE FROM replay_games WHERE status <> 'ready' AND ruleset_version <> $1",
      [rulesetVersion],
    );
    await tx.query(
      `UPDATE runtime_config SET active_ruleset_version = $1,
         generation = generation + 1, updated_at = $2 WHERE singleton = TRUE`,
      [rulesetVersion, Date.now()],
    );
    const deleted = rows.map((row) => ({ code: String(row.code), version: Number(row.version) + 1 }));
    for (const room of deleted) {
      await appendClusterEvent(tx, {
        type: "room",
        event: { code: room.code, kind: "deleted", version: room.version },
      });
    }
    return deleted;
  });
}
