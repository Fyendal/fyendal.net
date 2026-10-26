import { appendClusterEvent } from "../clusterEvents.js";
import type { Queryable } from "../db.js";

/** Tells members' open tabs to reload their leagues; pass member ids to
 * reach only those players, as for one match. Runs in the caller's transaction. */
export async function notifyLeague(db: Queryable, leagueId: string, memberIds?: readonly number[]): Promise<void> {
  const { rows } = await db.query(
    "SELECT member_id, user_id FROM league_members WHERE league_id = $1 AND user_id IS NOT NULL",
    [leagueId],
  );
  for (const row of rows) {
    if (memberIds && !memberIds.includes(Number(row.member_id))) continue;
    await appendClusterEvent(db, { type: "league-updated", userId: Number(row.user_id) });
  }
}
