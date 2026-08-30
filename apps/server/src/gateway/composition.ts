import { createPool } from "../db.js";
import { PgRoomStore } from "../store.js";
import {
  discardUnfinishedReplaysOtherRulesets,
} from "../replays.js";
import { ensureActiveRuleset } from "../rulesetFence.js";

/** Build production dependencies before the HTTP/WebSocket listener opens. */
export async function composeProductionGateway() {
  const rulesetVersion = process.env.RULESET_VERSION;
  if (!rulesetVersion) throw new Error("RULESET_VERSION is required");
  const db = await createPool();
  try {
    await ensureActiveRuleset(db, rulesetVersion);
    const rooms = new PgRoomStore(db, rulesetVersion);
    const discardedReplays = await discardUnfinishedReplaysOtherRulesets(db, rulesetVersion);
    if (discardedReplays > 0) {
      console.log(`discarded ${discardedReplays} incompatible unfinished replay(s)`);
    }
    const backfilledHistoryRooms = await rooms.backfillHistoryMetadata();
    if (backfilledHistoryRooms > 0) {
      console.log(`backfilled undo metadata for ${backfilledHistoryRooms} room(s)`);
    }
    return { db, rooms };
  } catch (error) {
    await db.end();
    throw error;
  }
}
