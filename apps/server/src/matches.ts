import { randomBytes } from "node:crypto";
import { botDefinitionForDeckId } from "@fyendal/bot";
import type {
  HeroRecord,
  MatchEndReason,
  MatchListFilters,
  MatchParticipant,
  MatchRecords,
  MatchSummary,
  MatchupRecord,
} from "@fyendal/protocol";
import type { BotOpponent, Format } from "@fyendal/shared";
import type { Queryable } from "./db.js";

/** Newest-first page size for the history list. */
export const MATCH_PAGE_SIZE = 50;
export const MAX_EXPORTED_MATCHES = 10_000;

const BOT_IDS = new Set<string>(["bravo", "briar", "kayo", "cindra", "ira", "hala", "jarl", "levia", "starvo", "boltyn", "ira-sage"]);

export interface MatchSeatInput {
  heroId: string;
  controller: "human" | "bot";
  userId?: number;
  username?: string;
  deckId?: string;
  deckName?: string;
}

export interface MatchRecordInput {
  roomCode: string;
  format: Format;
  rulesetVersion: string;
  seats: [MatchSeatInput, MatchSeatInput];
  winner: 0 | 1 | null;
  endReason: MatchEndReason;
  startedAt: number;
  finishedAt: number;
  replayId: string | null;
}

type ResultColumn = "wins" | "losses" | "draws" | "ended";

function resultColumn(winner: 0 | 1 | null, endReason: MatchEndReason, seat: 0 | 1): ResultColumn {
  if (winner === seat) return "wins";
  if (winner !== null) return "losses";
  return endReason === "draw" ? "draws" : "ended";
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function safeInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`invalid ${label}`);
  return number;
}

export function isMatchFormat(value: unknown): value is Format {
  return value === "cc" || value === "silver-age";
}

function format(value: unknown): Format {
  if (isMatchFormat(value)) return value;
  throw new Error("invalid match format");
}

function opponentKind(value: unknown): "player" | "bot" {
  if (value === "player" || value === "bot") return value;
  throw new Error("invalid opponent kind");
}

function endReason(value: unknown): MatchEndReason | null {
  if (value === null) return null;
  if (value === "lethal" || value === "concede" || value === "idle" || value === "draw" || value === "ended") {
    return value;
  }
  throw new Error("invalid match end reason");
}

function botId(value: unknown): BotOpponent | null {
  if (value === null) return null;
  const id = String(value);
  return BOT_IDS.has(id) ? id as BotOpponent : null;
}

/** Derive how a finished game ended from its final state. `idle` is passed by
 * the idle-victory path because the state alone cannot distinguish it from a
 * concession. */
export function matchEndReason(
  state: { winner: number | null; players: readonly { life: number }[] },
  claimedIdle = false,
): MatchEndReason {
  if (state.winner !== 0 && state.winner !== 1) return "draw";
  if (state.players[1 - state.winner]!.life <= 0) return "lethal";
  return claimedIdle ? "idle" : "concede";
}

/** Insert the match and its participants and bump every human seat's hero and
 * matchup counters, all in the caller's transaction. Returns false when the
 * same game (room and start time) was already recorded, in which case nothing
 * is written: counters only move together with a new match row. */
export async function recordMatch(db: Queryable, input: MatchRecordInput): Promise<boolean> {
  const id = randomBytes(12).toString("hex");
  const roomCode = input.roomCode.toUpperCase();
  const mode = input.seats.some((seat) => seat.controller === "bot") ? "bot" : "pvp";
  // Room commits are fenced by optimistic versions, so an existence check is
  // race-free here; it also avoids relying on ON CONFLICT ... RETURNING
  // semantics that pg-mem does not reproduce.
  const existing = await db.query(
    "SELECT id FROM matches WHERE room_code = $1 AND started_at = $2",
    [roomCode, input.startedAt],
  );
  if (existing.rows.length) return false;
  await db.query(
    `INSERT INTO matches
       (id, room_code, format, ruleset_version, mode, winner, end_reason, started_at, finished_at, replay_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id, roomCode, input.format, input.rulesetVersion, mode,
      input.winner, input.endReason, input.startedAt, input.finishedAt, input.replayId,
    ],
  );
  for (const seat of [0, 1] as const) {
    const member = input.seats[seat];
    const bot = member.controller === "bot" ? botDefinitionForDeckId(member.deckId) : undefined;
    await db.query(
      `INSERT INTO match_participants
         (match_id, seat, controller, user_id, username, bot_id, hero_id, deck_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id, seat, member.controller,
        member.controller === "human" ? member.userId ?? null : null,
        member.username ?? null,
        bot?.id ?? null,
        member.heroId,
        member.deckName ?? null,
      ],
    );
  }
  for (const seat of [0, 1] as const) {
    const member = input.seats[seat];
    if (member.controller !== "human" || member.userId === undefined) continue;
    const opponent = input.seats[seat === 0 ? 1 : 0];
    const kind = opponent.controller === "bot" ? "bot" : "player";
    const column = resultColumn(input.winner, input.endReason, seat);
    // Column names come from the fixed ResultColumn union, never from input.
    await db.query(
      `INSERT INTO hero_records
         (user_id, hero_id, opponent_kind, format, games, ${column}, last_played_at)
       VALUES ($1, $2, $3, $4, 1, 1, $5)
       ON CONFLICT (user_id, hero_id, opponent_kind, format) DO UPDATE SET
         games = hero_records.games + 1,
         ${column} = hero_records.${column} + 1,
         last_played_at = GREATEST(hero_records.last_played_at, EXCLUDED.last_played_at)`,
      [member.userId, member.heroId, kind, input.format, input.finishedAt],
    );
    if (column === "ended") continue;
    await db.query(
      `INSERT INTO matchup_records
         (user_id, hero_id, opponent_hero_id, opponent_kind, format, games, ${column})
       VALUES ($1, $2, $3, $4, $5, 1, 1)
       ON CONFLICT (user_id, hero_id, opponent_hero_id, opponent_kind, format) DO UPDATE SET
         games = matchup_records.games + 1,
         ${column} = matchup_records.${column} + 1`,
      [member.userId, member.heroId, opponent.heroId, kind, input.format],
    );
  }
  return true;
}

/** Every counter row for one account: two primary-key reads, no aggregation. */
export async function loadMatchRecords(db: Queryable, userId: number): Promise<MatchRecords> {
  const [heroRows, matchupRows] = await Promise.all([
    db.query(
      `SELECT hero_id, opponent_kind, format, games, wins, losses, draws, ended, last_played_at
       FROM hero_records WHERE user_id = $1 ORDER BY last_played_at DESC, hero_id`,
      [userId],
    ),
    db.query(
      `SELECT hero_id, opponent_hero_id, opponent_kind, format, games, wins, losses, draws
       FROM matchup_records WHERE user_id = $1 ORDER BY games DESC, hero_id, opponent_hero_id`,
      [userId],
    ),
  ]);
  const heroes: HeroRecord[] = heroRows.rows.map((value) => {
    const row = record(value, "hero record");
    return {
      heroId: String(row.hero_id),
      opponentKind: opponentKind(row.opponent_kind),
      format: format(row.format),
      games: safeInteger(row.games, "hero games"),
      wins: safeInteger(row.wins, "hero wins"),
      losses: safeInteger(row.losses, "hero losses"),
      draws: safeInteger(row.draws, "hero draws"),
      ended: safeInteger(row.ended, "hero ended"),
      lastPlayedAt: safeInteger(row.last_played_at, "hero last played"),
    };
  });
  const matchups: MatchupRecord[] = matchupRows.rows.map((value) => {
    const row = record(value, "matchup record");
    return {
      heroId: String(row.hero_id),
      opponentHeroId: String(row.opponent_hero_id),
      opponentKind: opponentKind(row.opponent_kind),
      format: format(row.format),
      games: safeInteger(row.games, "matchup games"),
      wins: safeInteger(row.wins, "matchup wins"),
      losses: safeInteger(row.losses, "matchup losses"),
      draws: safeInteger(row.draws, "matchup draws"),
    };
  });
  return { heroes, matchups };
}

const CURSOR_RE = /^([0-9]{1,16})\.([0-9a-f]{24})$/;

/** Null for no cursor, undefined for a malformed one. */
export function parseMatchCursor(
  value: string | null | undefined,
): { finishedAt: number; id: string } | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const match = CURSOR_RE.exec(value);
  if (!match) return undefined;
  const finishedAt = Number(match[1]);
  return Number.isSafeInteger(finishedAt) ? { finishedAt, id: match[2]! } : undefined;
}

export interface MatchListPage {
  matches: MatchSummary[];
  nextCursor: string | null;
}

/** One page of the account's matches, newest first, with replay availability
 * resolved for that account (favorites outlive the retention window). */
export async function listMatches(
  db: Queryable,
  userId: number,
  filters: MatchListFilters = {},
  options: { cursor?: { finishedAt: number; id: string } | null; limit?: number; now?: number } = {},
): Promise<MatchListPage> {
  const limit = Math.max(1, Math.min(options.limit ?? MATCH_PAGE_SIZE, MAX_EXPORTED_MATCHES));
  const now = options.now ?? Date.now();
  // Replay availability is resolved in JS below; `now` is deliberately not a
  // SQL parameter because an unreferenced parameter has no inferable type.
  const params: unknown[] = [userId];
  const where = ["me.user_id = $1"];
  if (filters.opponent === "players") where.push("m.mode = 'pvp'");
  if (filters.opponent === "bots") where.push("m.mode = 'bot'");
  if (filters.format) {
    params.push(filters.format);
    where.push(`m.format = $${params.length}`);
  }
  if (filters.heroId) {
    params.push(filters.heroId);
    where.push(`me.hero_id = $${params.length}`);
  }
  if (options.cursor) {
    params.push(options.cursor.finishedAt, options.cursor.id);
    where.push(
      `(m.finished_at < $${params.length - 1} OR (m.finished_at = $${params.length - 1} AND m.id < $${params.length}))`,
    );
  }
  params.push(limit + 1);
  const { rows } = await db.query(
    `SELECT m.id, m.format, m.winner, m.end_reason, m.finished_at, m.replay_id, me.seat AS your_seat,
            p0.controller AS controller_0, p0.user_id AS user_0, p0.username AS username_0,
            p0.bot_id AS bot_0, p0.hero_id AS hero_0, p0.deck_name AS deck_0,
            p1.controller AS controller_1, p1.user_id AS user_1, p1.username AS username_1,
            p1.bot_id AS bot_1, p1.hero_id AS hero_1, p1.deck_name AS deck_1,
            r.status AS replay_status, r.expires_at AS replay_expires_at, rp.favorite AS replay_favorite
     FROM match_participants me
     JOIN matches m ON m.id = me.match_id
     JOIN match_participants p0 ON p0.match_id = m.id AND p0.seat = 0
     JOIN match_participants p1 ON p1.match_id = m.id AND p1.seat = 1
     LEFT JOIN replay_games r ON r.id = m.replay_id
     LEFT JOIN replay_participants rp ON rp.replay_id = m.replay_id AND rp.user_id = me.user_id
     WHERE ${where.join(" AND ")}
     ORDER BY m.finished_at DESC, m.id DESC
     LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, limit).map((value) => {
    const row = record(value, "match summary");
    const yourSeat = safeInteger(row.your_seat, "match seat");
    const winner = row.winner === null ? null : safeInteger(row.winner, "match winner");
    if (!(yourSeat === 0 || yourSeat === 1) || !(winner === null || winner === 0 || winner === 1)) {
      throw new Error("invalid match summary seat");
    }
    const participant = (seat: 0 | 1): MatchParticipant => {
      const controller = row[`controller_${seat}`];
      if (controller !== "human" && controller !== "bot") throw new Error("invalid match controller");
      const username = row[`username_${seat}`];
      return {
        heroId: String(row[`hero_${seat}`]),
        controller,
        username: username === null || username === undefined ? null : String(username),
        bot: controller === "bot" ? botId(row[`bot_${seat}`] ?? null) : null,
        deckName: row[`deck_${seat}`] == null ? null : String(row[`deck_${seat}`]),
      };
    };
    const favorite = row.replay_favorite === true;
    const expiresAt = row.replay_expires_at == null ? null : safeInteger(row.replay_expires_at, "replay expiry");
    const replayAvailable = row.replay_id != null && row.replay_status === "ready"
      && expiresAt !== null && (favorite || expiresAt > now);
    return {
      id: String(row.id),
      format: format(row.format),
      yourSeat,
      winner,
      endReason: endReason(row.end_reason ?? null),
      finishedAt: safeInteger(row.finished_at, "match finished time"),
      players: [participant(0), participant(1)],
      replay: replayAvailable
        ? { id: String(row.replay_id), expiresAt: expiresAt!, favorite }
        : null,
    } satisfies MatchSummary;
  });
  const last = page[page.length - 1];
  return {
    matches: page,
    nextCursor: rows.length > limit && last ? `${last.finishedAt}.${last.id}` : null,
  };
}

/** Account deletion: drop the account's name and deck name from every match
 * it played before the FK nulls its id. Opponents keep the game and its
 * result; matches nobody can see any more are removed by the sweep. */
export async function detachMatchesForUser(db: Queryable, userId: number): Promise<void> {
  await db.query("UPDATE match_participants SET username = NULL, deck_name = NULL WHERE user_id = $1", [userId]);
}

export async function sweepOrphanedMatches(db: Queryable): Promise<void> {
  await db.query(
    `DELETE FROM matches
     WHERE id NOT IN (SELECT match_id FROM match_participants WHERE user_id IS NOT NULL)`,
  );
}
