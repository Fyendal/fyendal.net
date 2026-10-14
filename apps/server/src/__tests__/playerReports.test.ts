import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "../db.js";
import { exportAccount } from "../accounts.js";
import { createPlayerReport } from "../playerReports.js";
import { freshDb } from "./testdb.js";

let db: Queryable;
let reporterId: number;
let opponentId: number;

async function insertUser(username: string): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO users (username, username_lc, pass_hash, created_at)
     VALUES ($1, $2, 'hash', 1) RETURNING id`,
    [username, username.toLowerCase()],
  );
  return Number(rows[0]!.id);
}

async function insertRoom(code: string, opponent: { userId: number | null; controller: "human" | "bot" }) {
  await db.query(
    `INSERT INTO rooms
      (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at, status, winner)
     VALUES ($1, 'cc', '[]', NULL, NULL, 'rules-a', 7, 1, NULL, 'playing', NULL)`,
    [code],
  );
  await db.query(
    `INSERT INTO room_seats (room_code, seat, user_id, token_hash, username, controller)
     VALUES ($1, 0, $2, $3, 'Reporter', 'human'), ($1, 1, $4, $5, 'Opponent', $6)`,
    [code, reporterId, "a".repeat(64), opponent.userId, "b".repeat(64), opponent.controller],
  );
}

async function befriend(messages: Array<{ fromReporter: boolean; text: string }>) {
  const [low, high] = [Math.min(reporterId, opponentId), Math.max(reporterId, opponentId)];
  await db.query(
    "INSERT INTO friendships (user_low_id, user_high_id, created_at) VALUES ($1, $2, 1)",
    [low, high],
  );
  for (const [index, message] of messages.entries()) {
    const [sender, recipient] = message.fromReporter ? [reporterId, opponentId] : [opponentId, reporterId];
    await db.query(
      `INSERT INTO friend_messages
        (user_low_id, user_high_id, sender_user_id, recipient_user_id, client_message_id, body, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [low, high, sender, recipient, `message-${index}`, message.text, Date.now() - 1_000 + index],
    );
  }
}

const game = (reason: unknown, details = "", includeChat = false) =>
  ({ source: "game" as const, roomCode: "abc123", reason, details, includeChat });
const chat = (reason: unknown, details = "", includeChat = true) =>
  ({ source: "chat" as const, username: "opponent", reason, details, includeChat });

beforeEach(async () => {
  db = await freshDb();
  reporterId = await insertUser("Reporter");
  opponentId = await insertUser("Opponent");
  await insertRoom("ABC123", { userId: opponentId, controller: "human" });
});

describe("game reports", () => {
  it("records the seated human opponent, not a client-named account", async () => {
    const result = await createPlayerReport(db, reporterId, game("stalling", "  Idle for minutes.  "));
    expect(result).toMatchObject({ ok: true });

    const { rows } = await db.query(
      `SELECT reporter_user_id, reported_user_id, source, room_code, room_version, reason, details, chat_history
       FROM player_reports`,
    );
    expect(rows).toEqual([{
      reporter_user_id: reporterId,
      reported_user_id: opponentId,
      source: "game",
      room_code: "ABC123",
      room_version: 7,
      reason: "stalling",
      details: "Idle for minutes.",
      chat_history: null,
    }]);
  });

  it("returns the original report when the same opponent is reported again", async () => {
    const first = await createPlayerReport(db, reporterId, game("cheating"));
    const second = await createPlayerReport(db, reporterId, game("other", "Second thoughts"));
    expect(second).toEqual(first);
    const { rows } = await db.query("SELECT reason FROM player_reports");
    expect(rows).toEqual([{ reason: "cheating" }]);
  });

  it("rejects reasons from another context and overlong details", async () => {
    expect(await createPlayerReport(db, reporterId, game("harassment")))
      .toEqual({ ok: false, error: "invalid report" });
    expect(await createPlayerReport(db, reporterId, game("other", "x".repeat(501))))
      .toEqual({ ok: false, error: "invalid report" });
  });

  it("requires the reporter to hold a seat", async () => {
    const outsider = await insertUser("Outsider");
    expect(await createPlayerReport(db, outsider, game("stalling")))
      .toEqual({ ok: false, error: "room not found" });
    expect(await createPlayerReport(db, opponentId, { ...game("stalling"), roomCode: "ZZZ999" }))
      .toEqual({ ok: false, error: "room not found" });
  });

  it("does not report practice bots", async () => {
    await insertRoom("BOT123", { userId: null, controller: "bot" });
    expect(await createPlayerReport(db, reporterId, { ...game("stalling"), roomCode: "BOT123" }))
      .toEqual({ ok: false, error: "player not reportable" });
  });

  it("attaches a copy of the chat only when asked and the players are friends", async () => {
    await createPlayerReport(db, reporterId, game("stalling", "", true));
    expect((await db.query("SELECT chat_history FROM player_reports")).rows)
      .toEqual([{ chat_history: null }]);

    await db.query("DELETE FROM player_reports");
    await befriend([{ fromReporter: true, text: "gg?" }, { fromReporter: false, text: "no" }]);
    await createPlayerReport(db, reporterId, game("stalling"));
    expect((await db.query("SELECT chat_history FROM player_reports")).rows)
      .toEqual([{ chat_history: null }]);

    await db.query("DELETE FROM player_reports");
    await createPlayerReport(db, reporterId, game("stalling", "", true));
    const { rows } = await db.query("SELECT chat_history FROM player_reports");
    expect(rows[0]!.chat_history).toEqual([
      { from: "reporter", text: "gg?", sentAt: expect.any(Number) },
      { from: "reported", text: "no", sentAt: expect.any(Number) },
    ]);
  });
});

describe("chat reports", () => {
  it("reports a friend by username with the conversation attached", async () => {
    await befriend([{ fromReporter: false, text: "abusive message" }]);
    expect(await createPlayerReport(db, reporterId, chat("harassment", "Repeatedly"))).toMatchObject({ ok: true });
    const { rows } = await db.query(
      "SELECT reported_user_id, source, room_code, room_version, reason, chat_history FROM player_reports",
    );
    expect(rows).toEqual([{
      reported_user_id: opponentId,
      source: "chat",
      room_code: null,
      room_version: null,
      reason: "harassment",
      chat_history: [{ from: "reported", text: "abusive message", sentAt: expect.any(Number) }],
    }]);
  });

  it("keeps the attached copy after the friendship and its messages are deleted", async () => {
    await befriend([{ fromReporter: false, text: "abusive message" }]);
    await createPlayerReport(db, reporterId, chat("spam"));
    await db.query("DELETE FROM friendships");
    expect((await db.query("SELECT id FROM friend_messages")).rows).toEqual([]);
    expect((await db.query("SELECT chat_history FROM player_reports")).rows[0]!.chat_history)
      .toHaveLength(1);
  });

  it("requires a current friend and a chat reason", async () => {
    expect(await createPlayerReport(db, reporterId, chat("harassment")))
      .toEqual({ ok: false, error: "player not reportable" });
    await befriend([]);
    expect(await createPlayerReport(db, reporterId, chat("stalling")))
      .toEqual({ ok: false, error: "invalid report" });
  });
});

describe("account data", () => {
  it("exports filed reports only and cascades on account deletion", async () => {
    await befriend([{ fromReporter: false, text: "hi" }]);
    await createPlayerReport(db, reporterId, game("emote-spam", "Every action"));
    await createPlayerReport(db, reporterId, chat("spam"));
    const reporterExport = await exportAccount(db, reporterId);
    expect(reporterExport?.playerReports).toEqual([
      expect.objectContaining({
        source: "game",
        roomCode: "ABC123",
        roomVersion: 7,
        reportedUsername: "Opponent",
        reason: "emote-spam",
        details: "Every action",
        includesChat: false,
      }),
      expect.objectContaining({
        source: "chat",
        roomCode: null,
        roomVersion: null,
        reason: "spam",
        includesChat: true,
      }),
    ]);
    expect((await exportAccount(db, opponentId))?.playerReports).toEqual([]);

    await db.query("DELETE FROM room_seats");
    await db.query("DELETE FROM users WHERE id = $1", [opponentId]);
    expect((await db.query("SELECT id FROM player_reports")).rows).toEqual([]);
  });
});
