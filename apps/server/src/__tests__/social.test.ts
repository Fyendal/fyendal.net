import { beforeEach, describe, expect, it } from "vitest";
import { register } from "../auth.js";
import { exportAccount } from "../accounts.js";
import type { Queryable } from "../db.js";
import {
  CHAT_RETENTION_MS,
  cancelFriendRequest,
  chatHistory,
  isUserOnline,
  markChatRead,
  markSocialPresent,
  removeFriend,
  removeSocialPresence,
  respondFriendRequest,
  sendChatMessage,
  sendFriendRequest,
  socialSnapshot,
  sweepFriendMessages,
  sweepSocialPresence,
} from "../social.js";
import { freshDb } from "./testdb.js";

let db: Queryable;
let aliceId: number;
let bobId: number;

async function userId(username: string): Promise<number> {
  const { rows } = await db.query("SELECT id FROM users WHERE username_lc = $1", [username.toLowerCase()]);
  return Number(rows[0]!.id);
}

async function becomeFriends(): Promise<void> {
  expect(await sendFriendRequest(db, aliceId, "bOb")).toMatchObject({ ok: true });
  expect(await respondFriendRequest(db, bobId, "ALICE", true)).toMatchObject({ ok: true });
}

beforeEach(async () => {
  db = await freshDb();
  await register(db, "Alice", "password1");
  await register(db, "Bob", "password1");
  aliceId = await userId("Alice");
  bobId = await userId("Bob");
});

describe("social relationships", () => {
  it("handles exact-user requests case-insensitively and requires explicit reciprocal acceptance", async () => {
    expect(await sendFriendRequest(db, aliceId, "missing")).toEqual({ ok: false, error: "USER_NOT_FOUND" });
    expect(await sendFriendRequest(db, aliceId, "Alice")).toEqual({ ok: false, error: "INVALID_FRIEND_REQUEST" });
    expect(await sendFriendRequest(db, aliceId, "bOB")).toMatchObject({ ok: true, affectedUserId: bobId });
    expect(await sendFriendRequest(db, aliceId, "Bob")).toMatchObject({ ok: true, affectedUserId: bobId });
    expect(await sendFriendRequest(db, bobId, "Alice")).toEqual({ ok: false, error: "FRIEND_REQUEST_CONFLICT" });

    expect(await socialSnapshot(db, aliceId)).toMatchObject({
      requests: [{ username: "Bob", direction: "outgoing" }],
    });
    expect(await socialSnapshot(db, bobId)).toMatchObject({
      requests: [{ username: "Alice", direction: "incoming" }],
    });
    expect(await respondFriendRequest(db, bobId, "alice", true)).toMatchObject({ ok: true });
    expect((await socialSnapshot(db, aliceId)).friends[0]).toMatchObject({ username: "Bob", unreadCount: 0 });
    expect((await socialSnapshot(db, bobId)).friends[0]).toMatchObject({ username: "Alice", unreadCount: 0 });
  });

  it("cancels and declines pending requests", async () => {
    await sendFriendRequest(db, aliceId, "Bob");
    expect(await cancelFriendRequest(db, aliceId, "bob")).toMatchObject({ ok: true });
    expect((await socialSnapshot(db, bobId)).requests).toEqual([]);
    await sendFriendRequest(db, aliceId, "Bob");
    expect(await respondFriendRequest(db, bobId, "Alice", false)).toMatchObject({ ok: true });
    expect((await socialSnapshot(db, aliceId)).requests).toEqual([]);
  });

  it("deletes retained conversation data when a friendship is removed", async () => {
    await becomeFriends();
    await sendChatMessage(db, aliceId, "Bob", "hello", "remove-1");
    expect(await removeFriend(db, bobId, "Alice")).toMatchObject({ ok: true });
    expect((await db.query("SELECT 1 FROM friend_messages")).rows).toEqual([]);
    expect(await chatHistory(db, aliceId, "Bob")).toEqual({ ok: false, error: "FRIEND_REQUIRED" });
  });

  it("includes relationships, pending requests, and retained messages in account export", async () => {
    await becomeFriends();
    await sendChatMessage(db, aliceId, "Bob", "export me", "export-1");
    await register(db, "Carol", "password1");
    await sendFriendRequest(db, await userId("Carol"), "Alice");
    const exported = await exportAccount(db, aliceId);
    expect(exported).toMatchObject({
      friends: [{ username: "Bob" }],
      friendRequests: [{ username: "Carol", direction: "incoming" }],
      friendMessages: [{ friendUsername: "Bob", senderUsername: "Alice", text: "export me" }],
    });
  });
});

describe("one-to-one chat", () => {
  beforeEach(becomeFriends);

  it("is idempotent, tracks unread messages, and marks only the recipient side read", async () => {
    expect(await sendChatMessage(db, aliceId, "Bob", "", "empty-msg"))
      .toEqual({ ok: false, error: "MESSAGE_BOUNDS" });
    expect(await sendChatMessage(db, aliceId, "Bob", "x".repeat(1_001), "long-message"))
      .toEqual({ ok: false, error: "MESSAGE_BOUNDS" });
    const first = await sendChatMessage(db, aliceId, "bob", " hello ", "client-1");
    const duplicate = await sendChatMessage(db, aliceId, "Bob", "different", "client-1");
    expect(first).toMatchObject({ ok: true, message: { text: "hello", senderUsername: "Alice" } });
    expect(duplicate).toMatchObject({ ok: true, message: { id: first.ok ? first.message.id : "", text: "hello" } });
    expect((await db.query("SELECT 1 FROM friend_messages")).rows).toHaveLength(1);
    expect((await socialSnapshot(db, bobId)).friends[0]?.unreadCount).toBe(1);

    if (!first.ok) throw new Error("message insert failed");
    expect(await markChatRead(db, bobId, "Alice", first.message.id)).toMatchObject({ ok: true });
    expect((await socialSnapshot(db, bobId)).friends[0]?.unreadCount).toBe(0);
    const senderHistory = await chatHistory(db, aliceId, "Bob");
    expect(senderHistory.ok && senderHistory.messages[0]?.readAt).not.toBeNull();
  });

  it("pages backward in groups of fifty and excludes messages at the 30-day boundary", async () => {
    for (let index = 0; index < 52; index += 1) {
      await sendChatMessage(db, aliceId, "Bob", `message ${index}`, `page-msg-${index}`);
    }
    const newest = await chatHistory(db, bobId, "Alice");
    expect(newest.ok && newest.messages).toHaveLength(50);
    expect(newest.ok && newest.hasMore).toBe(true);
    if (!newest.ok) throw new Error("history failed");
    const earlier = await chatHistory(db, bobId, "Alice", newest.messages[0]!.id);
    expect(earlier.ok && earlier.messages).toHaveLength(2);
    expect(earlier.ok && earlier.hasMore).toBe(false);

    await db.query("UPDATE friend_messages SET created_at = $1 WHERE id = $2", [
      Date.now() - CHAT_RETENTION_MS,
      newest.messages.at(-1)!.id,
    ]);
    const retained = await chatHistory(db, bobId, "Alice", undefined, Date.now());
    expect(retained.ok && retained.messages)
      .not.toContainEqual(expect.objectContaining({ id: newest.messages.at(-1)!.id }));
    expect(await sweepFriendMessages(db, Date.now())).toBeGreaterThanOrEqual(1);
  });
});

describe("social presence", () => {
  it("aggregates tabs and expires stale leases", async () => {
    const now = Date.now();
    await markSocialPresent(db, bobId, "tab-one", now);
    await markSocialPresent(db, bobId, "tab-two", now);
    expect(await isUserOnline(db, bobId, now)).toBe(true);
    expect(await removeSocialPresence(db, "tab-one")).toBe(bobId);
    expect(await isUserOnline(db, bobId, now)).toBe(true);
    expect(await sweepSocialPresence(db, now + 3 * 60 * 1000)).toEqual([bobId]);
    expect(await isUserOnline(db, bobId, now + 3 * 60 * 1000)).toBe(false);
  });
});
