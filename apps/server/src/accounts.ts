import { withTransaction, type Queryable } from "./db.js";
import { verifyPassword } from "./auth.js";
import { listDecks } from "./decks.js";
import { getReplay, listReplays } from "./replays.js";
import { appendClusterEvent } from "./clusterEvents.js";
import type { CardPoolMode, PlayerBadge, ReplayFile } from "@fyendal/shared";
import { MAX_MATCHMAKING_AVOID_ROOM_CODES } from "@fyendal/protocol";

export interface AccountBadgePreferences {
  availableBadges: PlayerBadge[];
  selectedBadge: PlayerBadge | null;
}

function badgePreferences(earlyTester: boolean, selectedBadge: unknown): AccountBadgePreferences {
  const availableBadges: PlayerBadge[] = earlyTester ? ["early-tester"] : [];
  return {
    availableBadges,
    selectedBadge: selectedBadge === "early-tester" && earlyTester ? selectedBadge : null,
  };
}

export async function getAccountBadges(
  db: Queryable,
  userId: number,
): Promise<AccountBadgePreferences | null> {
  const { rows } = await db.query(
    "SELECT early_tester, selected_badge FROM users WHERE id = $1",
    [userId],
  );
  const user = rows[0] as { early_tester: boolean; selected_badge: unknown } | undefined;
  return user ? badgePreferences(user.early_tester, user.selected_badge) : null;
}

export async function selectAccountBadge(
  db: Queryable,
  userId: number,
  badge: unknown,
): Promise<{ ok: true; preferences: AccountBadgePreferences } | { ok: false; error: "invalid badge" | "badge not available" | "account not found" }> {
  if (badge !== null && badge !== "early-tester") return { ok: false, error: "invalid badge" };
  const current = await getAccountBadges(db, userId);
  if (!current) return { ok: false, error: "account not found" };
  if (badge !== null && !current.availableBadges.includes(badge)) {
    return { ok: false, error: "badge not available" };
  }
  await db.query("UPDATE users SET selected_badge = $2 WHERE id = $1", [userId, badge]);
  return { ok: true, preferences: { ...current, selectedBadge: badge } };
}

export interface AccountExport {
  exportedAt: string;
  account: {
    username: string;
    createdAt: number;
    earlyTester: boolean;
    selectedBadge: PlayerBadge | null;
  };
  decks: Array<Record<string, unknown>>;
  rooms: Array<{
    code: string;
    format: string;
    status: string;
    winner: number | null;
    createdAt: number;
    seat: number;
    cardPoolMode?: Exclude<CardPoolMode, "legal">;
  }>;
  matchmaking: null | {
    format: string;
    hero: string | null;
    deckId: string | null;
    retainedRoomCode: string | null;
    joinedAt: number;
    mode: "foreground" | "background";
    sourceRoomCode: string | null;
    pendingOfferRoomCode: string | null;
    avoidedRoomCodes: string[];
    pendingBotStart: null | {
      format: "cc" | "silver-age";
      deckId: string;
      bot: string;
      cardPoolMode: CardPoolMode;
      requestedAt: number;
      candidates: Array<{
        candidateUserId: number;
        ordinal: number;
        attempted: boolean;
        skipped: boolean;
      }>;
    };
    offer: null | {
      roomCode: string;
      opponentUserId: number;
      createdAt: number;
    };
  };
  bugReports: Array<{
    id: string;
    roomCode: string;
    roomVersion: number;
    rulesetVersion: string;
    description: string;
    createdAt: number;
    fixedAt: number | null;
    closedAt: number | null;
    dismissedAt: number | null;
  }>;
  replays: Array<{
    id: string;
    finishedAt: number;
    expiresAt: number;
    replay: ReplayFile;
  }>;
}

export type DeleteAccountResult =
  | { status: "deleted"; deletedRooms: Array<{ code: string; version: number }> }
  | { status: "invalid-password" }
  | { status: "not-found" };

function exportedAvoidedRoomCodes(value: unknown): string[] {
  const decoded = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(decoded) || decoded.length > MAX_MATCHMAKING_AVOID_ROOM_CODES
    || decoded.some((code) => typeof code !== "string" || !/^[A-Z0-9]{6}$/.test(code))) {
    throw new Error("matchmaking avoided_room_codes is corrupt");
  }
  return decoded;
}

export async function exportAccount(db: Queryable, userId: number): Promise<AccountExport | null> {
  const [
    { rows: users },
    decks,
    { rows: roomRows },
    { rows: queueRows },
    { rows: pendingBotRows },
    { rows: candidateRows },
    { rows: offerRows },
    { rows: reportRows },
  ] = await Promise.all([
    db.query("SELECT username, created_at, early_tester, selected_badge FROM users WHERE id = $1", [userId]),
    listDecks(db, userId),
    db.query(
      `SELECT r.code, r.format, r.status, r.winner, r.created_at, r.card_pool_mode, s.seat
       FROM rooms r JOIN room_seats s ON s.room_code = r.code
       WHERE s.user_id = $1 ORDER BY r.created_at, r.code`,
      [userId],
    ),
    db.query(
      `SELECT format, hero, deck_id, retained_room_code, joined_at, mode,
              source_room_code, pending_offer_room_code, avoided_room_codes
       FROM matchmaking_entries WHERE user_id = $1`,
      [userId],
    ),
    db.query(
      `SELECT format, deck_id, bot, card_pool_mode, requested_at
       FROM pending_bot_starts WHERE user_id = $1`,
      [userId],
    ),
    db.query(
      `SELECT candidate_user_id, ordinal, attempted, skipped
       FROM pending_bot_start_candidates
       WHERE starter_user_id = $1 ORDER BY ordinal`,
      [userId],
    ),
    db.query(
      `SELECT room_code,
              CASE WHEN first_user_id = $1 THEN second_user_id ELSE first_user_id END AS opponent_user_id,
              created_at
       FROM matchmaking_offers
       WHERE first_user_id = $1 OR second_user_id = $1`,
      [userId],
    ),
    db.query(
      `SELECT id, room_code, room_version, ruleset_version, description, created_at,
              fixed_at, closed_at, dismissed_at
       FROM bug_reports WHERE reporter_user_id = $1 ORDER BY created_at, id`,
      [userId],
    ),
  ]);
  const user = users[0] as {
    username: string;
    created_at: number;
    early_tester: boolean;
    selected_badge: unknown;
  } | undefined;
  if (!user) return null;
  const rooms: AccountExport["rooms"] = [];
  for (const row of roomRows as Array<Record<string, unknown>>) {
    rooms.push({
      code: String(row.code),
      format: String(row.format),
      status: String(row.status),
      winner: row.winner == null ? null : Number(row.winner),
      createdAt: Number(row.created_at),
      seat: Number(row.seat),
      ...(row.card_pool_mode === "future" || row.card_pool_mode === "open"
        ? { cardPoolMode: row.card_pool_mode }
        : {}),
    });
  }
  const bugReports: AccountExport["bugReports"] = [];
  for (const row of reportRows as Array<Record<string, unknown>>) {
    bugReports.push({
      id: String(row.id),
      roomCode: String(row.room_code),
      roomVersion: Number(row.room_version),
      rulesetVersion: String(row.ruleset_version),
      description: String(row.description),
      createdAt: Number(row.created_at),
      fixedAt: row.fixed_at == null ? null : Number(row.fixed_at),
      closedAt: row.closed_at == null ? null : Number(row.closed_at),
      dismissedAt: row.dismissed_at == null ? null : Number(row.dismissed_at),
    });
  }
  const replaySummaries = await listReplays(db, userId);
  const replays: AccountExport["replays"] = [];
  for (const summary of replaySummaries) {
    const replay = await getReplay(db, userId, summary.id);
    if (replay) {
      replays.push({
        id: summary.id,
        finishedAt: summary.finishedAt,
        expiresAt: summary.expiresAt,
        replay,
      });
    }
  }
  return {
    exportedAt: new Date().toISOString(),
    account: {
      username: user.username,
      createdAt: Number(user.created_at),
      earlyTester: user.early_tester,
      selectedBadge: badgePreferences(user.early_tester, user.selected_badge).selectedBadge,
    },
    decks: decks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      format: deck.format,
      fabraryUrl: deck.fabraryUrl,
      decklist: deck.decklist,
      heroName: deck.heroName,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
    })),
    rooms,
    matchmaking: queueRows[0]
      ? {
          format: String(queueRows[0].format),
          hero: typeof queueRows[0].hero === "string" ? queueRows[0].hero : null,
          deckId: typeof queueRows[0].deck_id === "string" ? queueRows[0].deck_id : null,
          retainedRoomCode: typeof queueRows[0].retained_room_code === "string" ? queueRows[0].retained_room_code : null,
          joinedAt: Number(queueRows[0].joined_at),
          mode: queueRows[0].mode === "background" ? "background" : "foreground",
          sourceRoomCode: typeof queueRows[0].source_room_code === "string" ? queueRows[0].source_room_code : null,
          pendingOfferRoomCode: typeof queueRows[0].pending_offer_room_code === "string"
            ? queueRows[0].pending_offer_room_code
            : null,
          avoidedRoomCodes: exportedAvoidedRoomCodes(queueRows[0].avoided_room_codes),
          pendingBotStart: pendingBotRows[0]
            ? {
                format: pendingBotRows[0].format === "cc" ? "cc" : "silver-age",
                deckId: String(pendingBotRows[0].deck_id),
                bot: String(pendingBotRows[0].bot),
                cardPoolMode: pendingBotRows[0].card_pool_mode === "future"
                  || pendingBotRows[0].card_pool_mode === "open"
                  ? pendingBotRows[0].card_pool_mode
                  : "legal",
                requestedAt: Number(pendingBotRows[0].requested_at),
                candidates: candidateRows.map((candidate) => ({
                  candidateUserId: Number(candidate.candidate_user_id),
                  ordinal: Number(candidate.ordinal),
                  attempted: candidate.attempted === true,
                  skipped: candidate.skipped === true,
                })),
              }
            : null,
          offer: offerRows[0]
            ? {
                roomCode: String(offerRows[0].room_code),
                opponentUserId: Number(offerRows[0].opponent_user_id),
                createdAt: Number(offerRows[0].created_at),
              }
            : null,
        }
      : null,
    bugReports,
    replays,
  };
}

/** Password-confirmed account deletion. Active rooms are deleted because their state
 * contains an account-bound seat snapshot; room history/presence cascade, and
 * the user's bug reports cascade directly from the account. */
export async function deleteAccount(
  db: Queryable,
  userId: number,
  password: string,
): Promise<DeleteAccountResult> {
  return withTransaction(db, async (tx) => {
    const { rows: users } = await tx.query(
      "SELECT pass_hash FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const user = users[0] as { pass_hash: string } | undefined;
    if (!user) return { status: "not-found" as const };
    if (!(await verifyPassword(password, user.pass_hash))) return { status: "invalid-password" as const };
    const { rows: roomRows } = await tx.query(
      `SELECT r.code, r.version FROM rooms r
       JOIN room_seats s ON s.room_code = r.code
       WHERE s.user_id = $1 FOR UPDATE`,
      [userId],
    );
    const deletedRooms: Array<{ code: string; version: number }> = [];
    for (const value of roomRows as Array<Record<string, unknown>>) {
      const code = String(value.code);
      const version = Number(value.version);
      await tx.query("DELETE FROM rooms WHERE code = $1", [code]);
      deletedRooms.push({ code, version: version + 1 });
    }
    const result = await tx.query("DELETE FROM users WHERE id = $1", [userId]);
    if (result.rowCount) {
      await tx.query(
        `DELETE FROM replay_games
         WHERE id NOT IN (SELECT replay_id FROM replay_participants)`,
      );
      await appendClusterEvent(tx, { type: "user-sessions-revoked", userId });
      for (const room of deletedRooms) {
        await appendClusterEvent(tx, {
          type: "room",
          event: { code: room.code, kind: "deleted", version: room.version },
        });
      }
    }
    return result.rowCount
      ? { status: "deleted" as const, deletedRooms }
      : { status: "not-found" as const };
  });
}
