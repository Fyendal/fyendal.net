import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { gunzip as gunzipCallback } from "node:zlib";
import type {
  ReplayServerNote,
  ReplayShare,
  ReplayShareVisibility,
  SharedReplayDenial,
} from "@fyendal/protocol";
import { type Queryable, withTransaction } from "./db.js";
import { getReplayNotes } from "./replays.js";
import { areFriends } from "./social.js";

const gunzip = promisify(gunzipCallback);
/** `finalizeReplay` stores `JSON.stringify({ ok: true, replay })`. */
const STORED_REPLAY_PREFIX = Buffer.from('{"ok":true,"replay":');

function shareToken(): string {
  return randomBytes(16).toString("base64url");
}

function visibility(value: unknown): ReplayShareVisibility {
  if (value === "public" || value === "friends") return value;
  throw new Error("invalid replay share visibility");
}

function shareFromRow(row: Record<string, unknown>): ReplayShare {
  return {
    token: String(row.token),
    visibility: visibility(row.visibility),
    includeNotes: row.include_notes === true,
  };
}

/** Lock the owner's retained copy. Only ready, unexpired copies can be shared. */
async function lockOwnedReplay(
  db: Queryable,
  userId: number,
  replayId: string,
  now: number,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT p.replay_id FROM replay_participants p
     JOIN replay_games g ON g.id = p.replay_id
     WHERE p.replay_id=$1 AND p.user_id=$2 AND g.status='ready'
       AND (p.favorite = TRUE OR g.expires_at > $3)
     FOR UPDATE`,
    [replayId, userId, now],
  );
  return rows.length > 0;
}

/** Create the owner's link, or change who it opens for. An existing link keeps
 * its token so copies already sent continue to resolve. */
export async function setReplayShare(
  db: Queryable,
  userId: number,
  input: { replayId: string; visibility: ReplayShareVisibility; includeNotes: boolean },
  now = Date.now(),
): Promise<ReplayShare | null> {
  return withTransaction(db, async (tx) => {
    if (!await lockOwnedReplay(tx, userId, input.replayId, now)) return null;
    const { rows } = await tx.query(
      `INSERT INTO replay_shares
        (replay_id, owner_user_id, token, visibility, include_notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (replay_id, owner_user_id) DO UPDATE
         SET visibility = EXCLUDED.visibility, include_notes = EXCLUDED.include_notes
       RETURNING token, visibility, include_notes`,
      [input.replayId, userId, shareToken(), input.visibility, input.includeNotes, now],
    );
    return rows[0] ? shareFromRow(rows[0]) : null;
  });
}

/** Replace the token so every previously sent link stops resolving. */
export async function resetReplayShare(
  db: Queryable,
  userId: number,
  replayId: string,
  now = Date.now(),
): Promise<ReplayShare | null> {
  return withTransaction(db, async (tx) => {
    if (!await lockOwnedReplay(tx, userId, replayId, now)) return null;
    const { rows } = await tx.query(
      `UPDATE replay_shares SET token=$3
       WHERE replay_id=$1 AND owner_user_id=$2
       RETURNING token, visibility, include_notes`,
      [replayId, userId, shareToken()],
    );
    return rows[0] ? shareFromRow(rows[0]) : null;
  });
}

export async function removeReplayShare(
  db: Queryable,
  userId: number,
  replayId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    "DELETE FROM replay_shares WHERE replay_id=$1 AND owner_user_id=$2",
    [replayId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export type SharedReplayResult =
  | { kind: "ready"; body: Buffer }
  | { kind: "not-found" }
  | { kind: "denied"; code: SharedReplayDenial };

/** Resolve a link for a possibly anonymous viewer. Access is evaluated on
 * every read, so unfriending, resetting, unsharing, deleting, and expiry take
 * effect immediately. The returned body is uncompressed response JSON. */
export async function readSharedReplay(
  db: Queryable,
  token: string,
  viewerUserId: number | null,
  now = Date.now(),
): Promise<SharedReplayResult> {
  const { rows } = await db.query(
    `SELECT s.replay_id, s.owner_user_id, s.visibility, s.include_notes, u.username, p.payload
     FROM replay_shares s
     JOIN replay_participants p ON p.replay_id = s.replay_id AND p.user_id = s.owner_user_id
     JOIN replay_games g ON g.id = s.replay_id
     JOIN users u ON u.id = s.owner_user_id
     WHERE s.token=$1 AND g.status='ready'
       AND (p.favorite = TRUE OR g.expires_at > $2)`,
    [token, now],
  );
  const row = rows[0];
  if (!row || !Buffer.isBuffer(row.payload)) return { kind: "not-found" };
  const ownerUserId = Number(row.owner_user_id);
  const shareVisibility = visibility(row.visibility);
  if (shareVisibility === "friends" && viewerUserId !== ownerUserId) {
    if (viewerUserId === null) return { kind: "denied", code: "AUTH_REQUIRED" };
    if (!await areFriends(db, viewerUserId, ownerUserId)) {
      return { kind: "denied", code: "FRIEND_REQUIRED" };
    }
  }
  const notes: ReplayServerNote[] = row.include_notes === true
    ? await getReplayNotes(db, ownerUserId, { replayId: String(row.replay_id) }, now) ?? []
    : [];
  const stored = await gunzip(row.payload);
  // Splice metadata onto the stored response instead of parsing a replay that
  // may hold thousands of frames on the request thread.
  if (!stored.subarray(0, STORED_REPLAY_PREFIX.length).equals(STORED_REPLAY_PREFIX)
    || stored[stored.length - 1] !== 0x7d) {
    throw new Error(`replay ${String(row.replay_id)} payload has an unexpected envelope`);
  }
  const shared = JSON.stringify({
    ownerUsername: String(row.username),
    visibility: shareVisibility,
    notes: notes.map(({ frame, text }) => ({ frame, text })),
  });
  return {
    kind: "ready",
    body: Buffer.concat([
      stored.subarray(0, stored.length - 1),
      Buffer.from(`,"shared":${shared}}`),
    ]),
  };
}
