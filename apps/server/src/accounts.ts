import { withTransaction, type Queryable } from "./db.js";
import { verifyPassword } from "./auth.js";
import { listDeckPlays, listDecks, type DeckPlay } from "./decks.js";
import { attachReplayNotes, getReplay, getReplayNotes, listReplays } from "./replays.js";
import { appendClusterEvent } from "./clusterEvents.js";
import type { CardPoolMode, Format, PlayerBadge, PlayerReportReason, PlayerReportSource, ReplayFile } from "@fyendal/shared";
import {
  MAX_MATCHMAKING_AVOID_HEROES,
  MAX_MATCHMAKING_AVOID_ROOM_CODES,
  MAX_MATCHMAKING_AVOID_USERS,
  isPlayerReportReason,
  type HeroRecord,
  type MatchSummary,
  type MatchupRecord,
  playmatRef,
} from "@fyendal/protocol";
import { exportSocialData } from "./social.js";
import { accountEmail } from "./recovery.js";
import { listUserAchievements } from "./achievements.js";
import { detachLeaguesForUser, exportLeagueData } from "./league/leagueStore.js";
import {
  detachMatchesForUser, listMatches, loadMatchRecords, MAX_EXPORTED_MATCHES, sweepOrphanedMatches,
} from "./matches.js";

export interface AccountCosmetics {
  availableBadges: PlayerBadge[];
  selectedBadge: PlayerBadge | null;
  playmat: string | null;
}

interface CosmeticRow {
  early_tester: boolean;
  selected_badge: unknown;
  playmat: unknown;
}

function badgePreferences(earlyTester: boolean, selectedBadge: unknown): Pick<AccountCosmetics, "availableBadges" | "selectedBadge"> {
  const availableBadges: PlayerBadge[] = earlyTester ? ["early-tester"] : [];
  return {
    availableBadges,
    selectedBadge: selectedBadge === "early-tester" && earlyTester ? selectedBadge : null,
  };
}

function cosmetics(row: CosmeticRow): AccountCosmetics {
  return {
    ...badgePreferences(row.early_tester, row.selected_badge),
    playmat: playmatRef(row.playmat) ? row.playmat : null,
  };
}

export async function getAccountCosmetics(
  db: Queryable,
  userId: number,
): Promise<AccountCosmetics | null> {
  const { rows } = await db.query(
    "SELECT early_tester, selected_badge, playmat FROM users WHERE id = $1",
    [userId],
  );
  const user = rows[0] as CosmeticRow | undefined;
  return user ? cosmetics(user) : null;
}

export type AccountCosmeticsError =
  | "nothing to change" | "invalid badge" | "badge not available" | "invalid playmat" | "account not found";

/** Applies the fields present in `changes`; an absent field keeps its value. */
export async function updateAccountCosmetics(
  db: Queryable,
  userId: number,
  changes: { badge?: unknown; playmat?: unknown },
): Promise<{ ok: true; cosmetics: AccountCosmetics } | { ok: false; error: AccountCosmeticsError }> {
  const { badge, playmat } = changes;
  if (badge === undefined && playmat === undefined) return { ok: false, error: "nothing to change" };
  if (badge !== undefined && badge !== null && badge !== "early-tester") return { ok: false, error: "invalid badge" };
  if (playmat !== undefined && playmat !== null && !playmatRef(playmat)) return { ok: false, error: "invalid playmat" };
  const current = await getAccountCosmetics(db, userId);
  if (!current) return { ok: false, error: "account not found" };
  if (badge !== undefined && badge !== null && !current.availableBadges.includes(badge)) {
    return { ok: false, error: "badge not available" };
  }
  // push returns the new length, which is the placeholder's 1-based position
  const assignments: string[] = [];
  const params: unknown[] = [userId];
  if (badge !== undefined) assignments.push(`selected_badge = $${params.push(badge)}`);
  if (playmat !== undefined) assignments.push(`playmat = $${params.push(playmat)}`);
  await db.query(`UPDATE users SET ${assignments.join(", ")} WHERE id = $1`, params);
  return {
    ok: true,
    cosmetics: {
      ...current,
      ...(badge !== undefined ? { selectedBadge: badge } : {}),
      ...(playmat !== undefined ? { playmat } : {}),
    },
  };
}

export interface AccountExport {
  exportedAt: string;
  account: {
    username: string;
    createdAt: number;
    earlyTester: boolean;
    selectedBadge: PlayerBadge | null;
    playmat: string | null;
    betaTester: boolean;
    email: string | null;
    pendingEmail: string | null;
  };
  decks: Array<Record<string, unknown>>;
  deckPlays: DeckPlay[];
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
    deckId: string | null;
    retainedRoomCode: string | null;
    joinedAt: number;
    mode: "foreground" | "background";
    sourceRoomCode: string | null;
    pendingOfferRoomCode: string | null;
    avoidedRoomCodes: string[];
    avoidedUserIds: number[];
    avoidedHeroes: string[];
    pendingBotStart: null | {
      format: Format;
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
    resolutionMessage: string | null;
  }>;
  playerReports: Array<{
    id: string;
    source: PlayerReportSource;
    roomCode: string | null;
    roomVersion: number | null;
    reportedUsername: string;
    reason: PlayerReportReason;
    details: string;
    includesChat: boolean;
    createdAt: number;
  }>;
  gameDays: number[];
  achievements: Awaited<ReturnType<typeof listUserAchievements>>;
  replays: Array<{
    id: string;
    finishedAt: number;
    expiresAt: number;
    favorite: boolean;
    share: { visibility: "public" | "friends"; includeNotes: boolean } | null;
    replay: ReplayFile;
  }>;
  matches: MatchSummary[];
  heroRecords: HeroRecord[];
  matchupRecords: MatchupRecord[];
  friends: Array<{ username: string; friendsSince: number }>;
  friendRequests: Array<{ username: string; direction: "incoming" | "outgoing"; createdAt: number }>;
  friendMessages: import("@fyendal/shared").ChatMessage[];
  leagues: import("@fyendal/protocol").LeagueExport[];
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

function exportedAvoidedUserIds(value: unknown): number[] {
  const decoded = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(decoded) || decoded.length > MAX_MATCHMAKING_AVOID_USERS
    || decoded.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("matchmaking avoided_user_ids is corrupt");
  }
  return decoded;
}

function exportedAvoidedHeroes(value: unknown): string[] {
  const decoded = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(decoded) || decoded.length > MAX_MATCHMAKING_AVOID_HEROES
    || decoded.some((hero) => typeof hero !== "string" || hero.length === 0 || hero.length > 128)) {
    throw new Error("matchmaking avoided_heroes is corrupt");
  }
  return decoded;
}

export async function exportAccount(db: Queryable, userId: number): Promise<AccountExport | null> {
  const [
    { rows: users },
    recoveryEmail,
    decks,
    deckPlays,
    { rows: roomRows },
    { rows: queueRows },
    { rows: pendingBotRows },
    { rows: candidateRows },
    { rows: offerRows },
    { rows: reportRows },
    { rows: playerReportRows },
    { rows: gameDayRows },
    social,
  ] = await Promise.all([
    db.query(
      `SELECT u.username, u.created_at, u.early_tester, u.selected_badge, u.playmat,
              b.user_id IS NOT NULL AS beta_tester
       FROM users u LEFT JOIN beta_testers b ON b.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    ),
    accountEmail(db, userId),
    listDecks(db, userId),
    listDeckPlays(db, userId),
    db.query(
      `SELECT r.code, r.format, r.status, r.winner, r.created_at, r.card_pool_mode, s.seat
       FROM rooms r JOIN room_seats s ON s.room_code = r.code
       WHERE s.user_id = $1 ORDER BY r.created_at, r.code`,
      [userId],
    ),
    db.query(
      `SELECT format, deck_id, retained_room_code, joined_at, mode,
              source_room_code, pending_offer_room_code, avoided_room_codes,
              avoided_user_ids, avoided_heroes
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
              fixed_at, closed_at, dismissed_at, resolution_message
       FROM bug_reports WHERE reporter_user_id = $1 ORDER BY created_at, id`,
      [userId],
    ),
    // Only reports this account filed. Reports filed against it would
    // identify their reporters.
    db.query(
      `SELECT p.id, p.source, p.room_code, p.room_version, u.username, p.reason, p.details,
              p.chat_history IS NOT NULL AS includes_chat, p.created_at
       FROM player_reports p JOIN users u ON u.id = p.reported_user_id
       WHERE p.reporter_user_id = $1 ORDER BY p.created_at, p.id`,
      [userId],
    ),
    db.query("SELECT day_utc FROM daily_game_players WHERE user_id = $1 ORDER BY day_utc", [userId]),
    exportSocialData(db, userId),
  ]);
  const user = users[0] as {
    username: string;
    created_at: number;
    early_tester: boolean;
    selected_badge: unknown;
    playmat: unknown;
    beta_tester: boolean;
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
      resolutionMessage: row.resolution_message == null ? null : String(row.resolution_message),
    });
  }
  const playerReports: AccountExport["playerReports"] = [];
  for (const row of playerReportRows as Array<Record<string, unknown>>) {
    const source = row.source;
    if ((source !== "game" && source !== "chat") || !isPlayerReportReason(row.reason, source)) {
      throw new Error("invalid player-report row");
    }
    playerReports.push({
      id: String(row.id),
      source,
      roomCode: row.room_code == null ? null : String(row.room_code),
      roomVersion: row.room_version == null ? null : Number(row.room_version),
      reportedUsername: String(row.username),
      reason: row.reason,
      details: String(row.details),
      includesChat: row.includes_chat === true,
      createdAt: Number(row.created_at),
    });
  }
  const [replaySummaries, achievements, matchPage, matchRecords] = await Promise.all([
    listReplays(db, userId),
    listUserAchievements(db, userId),
    listMatches(db, userId, {}, { limit: MAX_EXPORTED_MATCHES }),
    loadMatchRecords(db, userId),
  ]);
  const replays: AccountExport["replays"] = [];
  for (const summary of replaySummaries) {
    const [replay, notes] = await Promise.all([
      getReplay(db, userId, summary.id),
      getReplayNotes(db, userId, { replayId: summary.id }),
    ]);
    if (replay) {
      replays.push({
        id: summary.id,
        finishedAt: summary.finishedAt,
        expiresAt: summary.expiresAt,
        favorite: summary.favorite,
        // The link token is a bearer capability; the export records the
        // setting without carrying a working link.
        share: summary.share
          ? { visibility: summary.share.visibility, includeNotes: summary.share.includeNotes }
          : null,
        replay: attachReplayNotes(replay, notes ?? []),
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
      playmat: playmatRef(user.playmat) ? user.playmat : null,
      betaTester: user.beta_tester,
      email: recoveryEmail?.email ?? null,
      pendingEmail: recoveryEmail?.pendingEmail ?? null,
    },
    decks: decks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      format: deck.format,
      fabraryUrl: deck.fabraryUrl,
      decklist: deck.decklist,
      art: deck.art,
      heroName: deck.heroName,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
    })),
    deckPlays,
    achievements,
    rooms,
    matchmaking: queueRows[0]
      ? {
          format: String(queueRows[0].format),
          deckId: typeof queueRows[0].deck_id === "string" ? queueRows[0].deck_id : null,
          retainedRoomCode: typeof queueRows[0].retained_room_code === "string" ? queueRows[0].retained_room_code : null,
          joinedAt: Number(queueRows[0].joined_at),
          mode: queueRows[0].mode === "background" ? "background" : "foreground",
          sourceRoomCode: typeof queueRows[0].source_room_code === "string" ? queueRows[0].source_room_code : null,
          pendingOfferRoomCode: typeof queueRows[0].pending_offer_room_code === "string"
            ? queueRows[0].pending_offer_room_code
            : null,
          avoidedRoomCodes: exportedAvoidedRoomCodes(queueRows[0].avoided_room_codes),
          avoidedUserIds: exportedAvoidedUserIds(queueRows[0].avoided_user_ids),
          avoidedHeroes: exportedAvoidedHeroes(queueRows[0].avoided_heroes),
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
    playerReports,
    gameDays: gameDayRows.map((row) => Number(row.day_utc)),
    replays,
    matches: matchPage.matches,
    heroRecords: matchRecords.heroes,
    matchupRecords: matchRecords.matchups,
    ...social,
    leagues: await exportLeagueData(db, userId),
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
    await detachMatchesForUser(tx, userId);
    await detachLeaguesForUser(tx, userId);
    const result = await tx.query("DELETE FROM users WHERE id = $1", [userId]);
    if (result.rowCount) {
      await tx.query(
        `DELETE FROM replay_games
         WHERE id NOT IN (SELECT replay_id FROM replay_participants)`,
      );
      await sweepOrphanedMatches(tx);
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
