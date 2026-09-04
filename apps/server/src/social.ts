import type {
  ChatMessage,
  FriendRequestSummary,
  FriendSummary,
  SocialSnapshot,
} from "@fyendal/shared";
import { appendClusterEvent } from "./clusterEvents.js";
import { withTransaction, type Queryable } from "./db.js";

export const CHAT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const SOCIAL_PRESENCE_TIMEOUT_MS = 3 * 60 * 1000;
export const CHAT_PAGE_SIZE = 50;

export type SocialFailure =
  | "USER_NOT_FOUND"
  | "INVALID_FRIEND_REQUEST"
  | "FRIEND_REQUEST_CONFLICT"
  | "FRIEND_REQUIRED"
  | "MESSAGE_BOUNDS";

function pair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

async function targetByUsername(
  db: Queryable,
  username: string,
): Promise<{ id: number; username: string } | null> {
  const { rows } = await db.query(
    "SELECT id, username FROM users WHERE username_lc = $1",
    [username.toLowerCase()],
  );
  const row = rows[0] as { id?: unknown; username?: unknown } | undefined;
  const id = Number(row?.id);
  return Number.isSafeInteger(id) && id > 0 && typeof row?.username === "string"
    ? { id, username: row.username }
    : null;
}

export async function socialSnapshot(
  db: Queryable,
  userId: number,
  now = Date.now(),
): Promise<SocialSnapshot> {
  const [friendRows, requestRows] = await Promise.all([
    db.query(
      `SELECT u.username, f.created_at,
              CASE WHEN presence.user_id IS NULL THEN FALSE ELSE TRUE END AS online,
              COALESCE(unread.unread_count, 0) AS unread_count
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_low_id = $1 THEN f.user_high_id ELSE f.user_low_id END
       LEFT JOIN (
         SELECT user_id FROM social_presence WHERE last_seen_at > $2 GROUP BY user_id
       ) presence ON presence.user_id = u.id
       LEFT JOIN (
         SELECT sender_user_id, COUNT(*) AS unread_count FROM friend_messages
         WHERE recipient_user_id = $1 AND read_at IS NULL AND created_at > $3
         GROUP BY sender_user_id
       ) unread ON unread.sender_user_id = u.id
       WHERE f.user_low_id = $1 OR f.user_high_id = $1
       ORDER BY u.username_lc`,
      [userId, now - SOCIAL_PRESENCE_TIMEOUT_MS, now - CHAT_RETENTION_MS],
    ),
    db.query(
      `SELECT u.username, r.requester_user_id, r.created_at
       FROM friend_requests r
       JOIN users u ON u.id = CASE WHEN r.user_low_id = $1 THEN r.user_high_id ELSE r.user_low_id END
       WHERE r.user_low_id = $1 OR r.user_high_id = $1
       ORDER BY r.created_at, u.username_lc`,
      [userId],
    ),
  ]);
  const friends: FriendSummary[] = friendRows.rows.map((raw: Record<string, unknown>) => ({
    username: String(raw.username),
    presence: raw.online === true ? "online" : "offline",
    friendsSince: Number(raw.created_at),
    unreadCount: Number(raw.unread_count ?? 0),
  }));
  const requests: FriendRequestSummary[] = requestRows.rows.map((raw: Record<string, unknown>) => ({
    username: String(raw.username),
    direction: Number(raw.requester_user_id) === userId ? "outgoing" : "incoming",
    createdAt: Number(raw.created_at),
  }));
  return { friends, requests };
}

export async function sendFriendRequest(
  db: Queryable,
  requesterId: number,
  username: string,
): Promise<{ ok: true; affectedUserId: number } | { ok: false; error: SocialFailure }> {
  return withTransaction(db, async (tx) => {
    const target = await targetByUsername(tx, username);
    if (!target) return { ok: false, error: "USER_NOT_FOUND" };
    if (target.id === requesterId) return { ok: false, error: "INVALID_FRIEND_REQUEST" };
    const [low, high] = pair(requesterId, target.id);
    const existingFriend = await tx.query(
      "SELECT 1 FROM friendships WHERE user_low_id = $1 AND user_high_id = $2",
      [low, high],
    );
    if (existingFriend.rows.length > 0) return { ok: false, error: "FRIEND_REQUEST_CONFLICT" };
    const existing = await tx.query(
      "SELECT requester_user_id FROM friend_requests WHERE user_low_id = $1 AND user_high_id = $2",
      [low, high],
    );
    if (existing.rows.length > 0) {
      return Number(existing.rows[0]!.requester_user_id) === requesterId
        ? { ok: true, affectedUserId: target.id }
        : { ok: false, error: "FRIEND_REQUEST_CONFLICT" };
    }
    await tx.query(
      `INSERT INTO friend_requests(user_low_id, user_high_id, requester_user_id, created_at)
       VALUES ($1,$2,$3,$4)`,
      [low, high, requesterId, Date.now()],
    );
    await appendClusterEvent(tx, { type: "social-refresh", userId: requesterId });
    await appendClusterEvent(tx, { type: "social-refresh", userId: target.id });
    return { ok: true, affectedUserId: target.id };
  });
}

export async function respondFriendRequest(
  db: Queryable,
  userId: number,
  username: string,
  accept: boolean,
): Promise<{ ok: true; affectedUserId: number } | { ok: false; error: SocialFailure }> {
  return withTransaction(db, async (tx) => {
    const target = await targetByUsername(tx, username);
    if (!target || target.id === userId) return { ok: false, error: "USER_NOT_FOUND" };
    const [low, high] = pair(userId, target.id);
    const request = await tx.query(
      `SELECT requester_user_id FROM friend_requests
       WHERE user_low_id = $1 AND user_high_id = $2 FOR UPDATE`,
      [low, high],
    );
    if (request.rows.length === 0 || Number(request.rows[0]!.requester_user_id) === userId) {
      return { ok: false, error: "FRIEND_REQUEST_CONFLICT" };
    }
    if (accept) {
      await tx.query(
        `INSERT INTO friendships(user_low_id, user_high_id, created_at)
         VALUES ($1,$2,$3) ON CONFLICT (user_low_id, user_high_id) DO NOTHING`,
        [low, high, Date.now()],
      );
    }
    await tx.query(
      "DELETE FROM friend_requests WHERE user_low_id = $1 AND user_high_id = $2",
      [low, high],
    );
    await appendClusterEvent(tx, { type: "social-refresh", userId });
    await appendClusterEvent(tx, { type: "social-refresh", userId: target.id });
    return { ok: true, affectedUserId: target.id };
  });
}

export async function cancelFriendRequest(
  db: Queryable,
  userId: number,
  username: string,
): Promise<{ ok: true; affectedUserId: number } | { ok: false; error: SocialFailure }> {
  return withTransaction(db, async (tx) => {
    const target = await targetByUsername(tx, username);
    if (!target) return { ok: false, error: "USER_NOT_FOUND" };
    const [low, high] = pair(userId, target.id);
    const deleted = await tx.query(
      `DELETE FROM friend_requests WHERE user_low_id = $1 AND user_high_id = $2
       AND requester_user_id = $3`,
      [low, high, userId],
    );
    if (!deleted.rowCount) return { ok: false, error: "FRIEND_REQUEST_CONFLICT" };
    await appendClusterEvent(tx, { type: "social-refresh", userId });
    await appendClusterEvent(tx, { type: "social-refresh", userId: target.id });
    return { ok: true, affectedUserId: target.id };
  });
}

export async function removeFriend(
  db: Queryable,
  userId: number,
  username: string,
): Promise<{ ok: true; affectedUserId: number } | { ok: false; error: SocialFailure }> {
  return withTransaction(db, async (tx) => {
    const target = await targetByUsername(tx, username);
    if (!target) return { ok: false, error: "USER_NOT_FOUND" };
    const [low, high] = pair(userId, target.id);
    const deleted = await tx.query(
      "DELETE FROM friendships WHERE user_low_id = $1 AND user_high_id = $2",
      [low, high],
    );
    if (!deleted.rowCount) return { ok: false, error: "FRIEND_REQUIRED" };
    await appendClusterEvent(tx, { type: "social-refresh", userId });
    await appendClusterEvent(tx, { type: "social-refresh", userId: target.id });
    return { ok: true, affectedUserId: target.id };
  });
}

export async function friendByUsername(
  db: Queryable,
  userId: number,
  username: string,
): Promise<{ id: number; username: string } | null> {
  const target = await targetByUsername(db, username);
  if (!target || target.id === userId) return null;
  const [low, high] = pair(userId, target.id);
  const { rows } = await db.query(
    "SELECT 1 FROM friendships WHERE user_low_id = $1 AND user_high_id = $2",
    [low, high],
  );
  return rows.length > 0 ? target : null;
}

function chatMessageFromRow(raw: Record<string, unknown>, viewerId: number): ChatMessage {
  const senderId = Number(raw.sender_user_id);
  return {
    id: String(raw.id),
    friendUsername: senderId === viewerId ? String(raw.recipient_username) : String(raw.sender_username),
    senderUsername: String(raw.sender_username),
    text: String(raw.body),
    sentAt: Number(raw.created_at),
    readAt: raw.read_at == null ? null : Number(raw.read_at),
  };
}

const MESSAGE_SELECT = `SELECT m.id, m.sender_user_id, m.body, m.created_at, m.read_at,
  sender.username AS sender_username, recipient.username AS recipient_username
  FROM friend_messages m
  JOIN users sender ON sender.id = m.sender_user_id
  JOIN users recipient ON recipient.id = m.recipient_user_id`;

export async function sendChatMessage(
  db: Queryable,
  senderId: number,
  username: string,
  text: string,
  clientMessageId: string,
): Promise<{ ok: true; message: ChatMessage; recipientId: number } | { ok: false; error: SocialFailure }> {
  const body = text.trim();
  if (body.length < 1 || body.length > 1_000 || !/^[A-Za-z0-9_-]{8,64}$/.test(clientMessageId)) {
    return { ok: false, error: "MESSAGE_BOUNDS" };
  }
  return withTransaction(db, async (tx) => {
    const target = await friendByUsername(tx, senderId, username);
    if (!target) return { ok: false, error: "FRIEND_REQUIRED" };
    const [low, high] = pair(senderId, target.id);
    const inserted = await tx.query(
      `INSERT INTO friend_messages
        (user_low_id, user_high_id, sender_user_id, recipient_user_id, client_message_id, body, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (sender_user_id, client_message_id) DO UPDATE
         SET client_message_id = EXCLUDED.client_message_id
       RETURNING id`,
      [low, high, senderId, target.id, clientMessageId, body, Date.now()],
    );
    const id = String(inserted.rows[0]!.id);
    const { rows } = await tx.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
    const message = chatMessageFromRow(rows[0] as Record<string, unknown>, senderId);
    await appendClusterEvent(tx, { type: "chat-message", userId: senderId, messageId: id });
    await appendClusterEvent(tx, { type: "chat-message", userId: target.id, messageId: id });
    return { ok: true, message, recipientId: target.id };
  });
}

export async function chatMessageForUser(
  db: Queryable,
  userId: number,
  messageId: string,
): Promise<ChatMessage | null> {
  const { rows } = await db.query(
    `${MESSAGE_SELECT} WHERE m.id = $1 AND (m.sender_user_id = $2 OR m.recipient_user_id = $2)`,
    [messageId, userId],
  );
  return rows[0] ? chatMessageFromRow(rows[0] as Record<string, unknown>, userId) : null;
}

export async function chatHistory(
  db: Queryable,
  userId: number,
  username: string,
  beforeId?: string,
  now = Date.now(),
): Promise<{ ok: true; messages: ChatMessage[]; hasMore: boolean } | { ok: false; error: SocialFailure }> {
  const target = await friendByUsername(db, userId, username);
  if (!target) return { ok: false, error: "FRIEND_REQUIRED" };
  const [low, high] = pair(userId, target.id);
  const params: unknown[] = [low, high, now - CHAT_RETENTION_MS, CHAT_PAGE_SIZE + 1];
  const before = beforeId ? " AND m.id < $5" : "";
  if (beforeId) params.push(beforeId);
  const { rows } = await db.query(
    `${MESSAGE_SELECT}
     WHERE m.user_low_id = $1 AND m.user_high_id = $2 AND m.created_at > $3${before}
     ORDER BY m.id DESC LIMIT $4`,
    params,
  );
  const hasMore = rows.length > CHAT_PAGE_SIZE;
  return {
    ok: true,
    messages: rows.slice(0, CHAT_PAGE_SIZE)
      .map((row) => chatMessageFromRow(row as Record<string, unknown>, userId))
      .reverse(),
    hasMore,
  };
}

export async function markChatRead(
  db: Queryable,
  userId: number,
  username: string,
  throughId: string,
): Promise<{ ok: true; affectedUserId: number } | { ok: false; error: SocialFailure }> {
  return withTransaction(db, async (tx) => {
    const target = await friendByUsername(tx, userId, username);
    if (!target) return { ok: false, error: "FRIEND_REQUIRED" };
    const [low, high] = pair(userId, target.id);
    await tx.query(
      `UPDATE friend_messages SET read_at = $1
       WHERE user_low_id = $2 AND user_high_id = $3 AND recipient_user_id = $4
         AND id <= $5 AND read_at IS NULL`,
      [Date.now(), low, high, userId, throughId],
    );
    await appendClusterEvent(tx, { type: "social-refresh", userId });
    return { ok: true, affectedUserId: target.id };
  });
}

export async function markSocialPresent(
  db: Queryable,
  userId: number,
  leaseId: string,
  now = Date.now(),
): Promise<void> {
  await db.query(
    `INSERT INTO social_presence(lease_id, user_id, last_seen_at) VALUES ($1,$2,$3)
     ON CONFLICT (lease_id) DO UPDATE SET user_id = EXCLUDED.user_id, last_seen_at = EXCLUDED.last_seen_at`,
    [leaseId, userId, now],
  );
}

export async function markSocialPresentBatch(
  db: Queryable,
  leases: Array<{ userId: number; leaseId: string }>,
  now = Date.now(),
): Promise<void> {
  if (leases.length === 0) return;
  const params: unknown[] = [];
  const values = leases.map((lease, index) => {
    const offset = index * 3;
    params.push(lease.leaseId, lease.userId, now);
    return `($${offset + 1},$${offset + 2},$${offset + 3})`;
  });
  await db.query(
    `INSERT INTO social_presence(lease_id, user_id, last_seen_at) VALUES ${values.join(",")}
     ON CONFLICT (lease_id) DO UPDATE SET user_id = EXCLUDED.user_id, last_seen_at = EXCLUDED.last_seen_at`,
    params,
  );
}

export async function removeSocialPresence(db: Queryable, leaseId: string): Promise<number | null> {
  const { rows } = await db.query(
    "DELETE FROM social_presence WHERE lease_id = $1 RETURNING user_id",
    [leaseId],
  );
  const userId = Number(rows[0]?.user_id);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

export async function isUserOnline(db: Queryable, userId: number, now = Date.now()): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT 1 FROM social_presence WHERE user_id = $1 AND last_seen_at > $2 LIMIT 1",
    [userId, now - SOCIAL_PRESENCE_TIMEOUT_MS],
  );
  return rows.length > 0;
}

export async function friendsOf(db: Queryable, userId: number): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT CASE WHEN user_low_id = $1 THEN user_high_id ELSE user_low_id END AS friend_id
     FROM friendships WHERE user_low_id = $1 OR user_high_id = $1`,
    [userId],
  );
  return rows.map((row) => Number(row.friend_id)).filter((id) => Number.isSafeInteger(id) && id > 0);
}

export async function sweepFriendMessages(db: Queryable, now = Date.now()): Promise<number> {
  const result = await db.query("DELETE FROM friend_messages WHERE created_at <= $1", [now - CHAT_RETENTION_MS]);
  return result.rowCount ?? 0;
}

export async function sweepSocialPresence(db: Queryable, now = Date.now()): Promise<number[]> {
  const { rows } = await db.query(
    "DELETE FROM social_presence WHERE last_seen_at <= $1 RETURNING user_id",
    [now - SOCIAL_PRESENCE_TIMEOUT_MS],
  );
  return [...new Set(rows.map((row) => Number(row.user_id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

export async function exportSocialData(db: Queryable, userId: number, now = Date.now()) {
  const [friends, requests, messages] = await Promise.all([
    db.query(
      `SELECT u.username, f.created_at
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_low_id = $1 THEN f.user_high_id ELSE f.user_low_id END
       WHERE f.user_low_id = $1 OR f.user_high_id = $1 ORDER BY f.created_at, u.username_lc`,
      [userId],
    ),
    db.query(
      `SELECT u.username, r.requester_user_id, r.created_at
       FROM friend_requests r
       JOIN users u ON u.id = CASE WHEN r.user_low_id = $1 THEN r.user_high_id ELSE r.user_low_id END
       WHERE r.user_low_id = $1 OR r.user_high_id = $1 ORDER BY r.created_at, u.username_lc`,
      [userId],
    ),
    db.query(
      `${MESSAGE_SELECT}
       WHERE (m.sender_user_id = $1 OR m.recipient_user_id = $1) AND m.created_at > $2
       ORDER BY m.id`,
      [userId, now - CHAT_RETENTION_MS],
    ),
  ]);
  return {
    friends: friends.rows.map((row) => ({ username: String(row.username), friendsSince: Number(row.created_at) })),
    friendRequests: requests.rows.map((row) => ({
      username: String(row.username),
      direction: Number(row.requester_user_id) === userId ? "outgoing" as const : "incoming" as const,
      createdAt: Number(row.created_at),
    })),
    friendMessages: messages.rows.map((row) => chatMessageFromRow(row as Record<string, unknown>, userId)),
  };
}
