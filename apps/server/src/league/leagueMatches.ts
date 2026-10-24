import type {
  Format,
  LeagueMatchStatus,
  LeagueMatchView,
  LeagueProposeRequest,
  LeagueStatus,
} from "@fyendal/shared";
import { withTransaction, type Queryable } from "../db.js";
import { intersectIntervals, materializeWeek, MINUTE_MS, seasonWeekBounds, type Interval } from "./availability.js";
import { notifyLeague } from "./leagueEvents.js";
import { format, leagueStatus, matchResult, matchStage, matchStatus, nullableNumber, storedWindows } from "./leagueRows.js";

/** A player can mark ready from shortly before the agreed start until a
 * short grace after it; a lone ready player can then claim the forfeit. */
export const READY_OPENS_MS = 5 * MINUTE_MS;
export const READY_CLOSES_MS = 15 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;
const SCHEDULABLE: readonly LeagueMatchStatus[] = ["unscheduled", "proposed", "scheduled"];

export type LeagueMatchUpdateResult = "updated" | "not-found" | "closed";

interface MemberMatch {
  id: string;
  leagueId: string;
  leagueStatus: LeagueStatus;
  format: Format;
  matchMinutes: number;
  status: LeagueMatchStatus;
  a: number;
  b: number | null;
  scheduledAt: number | null;
  proposedBy: number | null;
  readyA: number | null;
  readyB: number | null;
  deadlineAt: number;
  roomCode: string | null;
  /** The caller's side of the match. */
  side: "a" | "b";
}

/** Locks a match the user plays in. Null when it does not exist or is not theirs. */
async function lockMemberMatch(tx: Queryable, matchId: string, userId: number): Promise<MemberMatch | null> {
  const { rows } = await tx.query(
    `SELECT id, league_id, member_a, member_b, status, scheduled_at, proposed_by, ready_a, ready_b, deadline_at, room_code
     FROM league_matches WHERE id = $1 FOR UPDATE`,
    [matchId],
  );
  const match = rows[0];
  if (!match) return null;
  const [{ rows: leagues }, { rows: members }] = await Promise.all([
    tx.query("SELECT status, format, match_minutes FROM leagues WHERE id = $1", [match.league_id]),
    tx.query(
      "SELECT member_id FROM league_members WHERE league_id = $1 AND user_id = $2 AND status = 'active'",
      [match.league_id, userId],
    ),
  ]);
  const memberId = nullableNumber(members[0]?.member_id);
  const a = Number(match.member_a);
  const b = nullableNumber(match.member_b);
  if (!leagues[0] || memberId === null || (memberId !== a && memberId !== b)) return null;
  return {
    id: String(match.id),
    leagueId: String(match.league_id),
    leagueStatus: leagueStatus(leagues[0].status),
    format: format(leagues[0].format),
    matchMinutes: Number(leagues[0].match_minutes),
    status: matchStatus(match.status),
    a,
    b,
    scheduledAt: nullableNumber(match.scheduled_at),
    proposedBy: nullableNumber(match.proposed_by),
    readyA: nullableNumber(match.ready_a),
    readyB: nullableNumber(match.ready_b),
    deadlineAt: Number(match.deadline_at),
    roomCode: match.room_code === null ? null : String(match.room_code),
    side: memberId === a ? "a" : "b",
  };
}

const running = (match: MemberMatch) => match.leagueStatus === "season" || match.leagueStatus === "playoffs";
const me = (match: MemberMatch) => (match.side === "a" ? match.a : match.b!);
const playable = (match: MemberMatch) => running(match) && match.b !== null && SCHEDULABLE.includes(match.status);

/** Back to scheduling after a room ends without a result; any earlier time
 * returns to proposed so both players confirm it again. The room, if it
 * still exists, no longer counts for the league. */
async function returnToScheduling(
  tx: Queryable,
  match: { id: string; leagueId: string; a: number; b: number; scheduledAt: unknown },
  roomCode: string | null,
): Promise<void> {
  if (roomCode !== null) await tx.query("UPDATE rooms SET league_match_id = NULL WHERE code = $1", [roomCode]);
  await tx.query(
    "UPDATE league_matches SET status = $2, room_code = NULL WHERE id = $1",
    [match.id, match.scheduledAt === null ? "unscheduled" : "proposed"],
  );
  await notifyLeague(tx, match.leagueId, [match.a, match.b]);
}

/** Locks the user's match and applies a change; `change` returns false when
 * the match cannot change now. Both players' tabs hear about a change. */
async function changeMatch(
  db: Queryable,
  userId: number,
  matchId: string,
  change: (tx: Queryable, match: MemberMatch) => Promise<boolean>,
): Promise<LeagueMatchUpdateResult> {
  return withTransaction(db, async (tx) => {
    const match = await lockMemberMatch(tx, matchId, userId);
    if (!match) return "not-found";
    if (!(await change(tx, match))) return "closed";
    await notifyLeague(tx, match.leagueId, [match.a, match.b!]);
    return "updated";
  });
}

/** Proposes a start for a match; a new proposal replaces any agreed time. */
export function proposeLeagueTime(
  db: Queryable,
  userId: number,
  request: LeagueProposeRequest,
  now = Date.now(),
): Promise<LeagueMatchUpdateResult> {
  return changeMatch(db, userId, request.matchId, async (tx, match) => {
    if (!playable(match) || request.at <= now || request.at + match.matchMinutes * MINUTE_MS > match.deadlineAt) return false;
    await tx.query(
      `UPDATE league_matches SET status = 'proposed', proposed_by = $2, proposed_at = $3, scheduled_at = $4,
                                 ready_a = NULL, ready_b = NULL
       WHERE id = $1`,
      [match.id, me(match), now, request.at],
    );
    return true;
  });
}

/** Accepts the opponent's or the league's proposed time while it is still ahead. */
export function acceptLeagueTime(db: Queryable, userId: number, matchId: string, now = Date.now()): Promise<LeagueMatchUpdateResult> {
  return changeMatch(db, userId, matchId, async (tx, match) => {
    if (!running(match) || match.status !== "proposed" || match.proposedBy === me(match)
      || match.scheduledAt === null || match.scheduledAt + READY_CLOSES_MS <= now) return false;
    await tx.query("UPDATE league_matches SET status = 'scheduled' WHERE id = $1", [match.id]);
    return true;
  });
}

export function markLeagueReady(db: Queryable, userId: number, matchId: string, now = Date.now()): Promise<LeagueMatchUpdateResult> {
  return changeMatch(db, userId, matchId, async (tx, match) => {
    if (!running(match) || match.status !== "scheduled" || match.scheduledAt === null
      || now < match.scheduledAt - READY_OPENS_MS || now > match.scheduledAt + READY_CLOSES_MS) return false;
    await tx.query(`UPDATE league_matches SET ready_${match.side} = $2 WHERE id = $1`, [match.id, now]);
    return true;
  });
}

/** After the ready window, a player who showed up wins if the opponent did not. */
export function claimLeagueForfeit(db: Queryable, userId: number, matchId: string, now = Date.now()): Promise<LeagueMatchUpdateResult> {
  return changeMatch(db, userId, matchId, async (tx, match) => {
    const [mine, theirs] = match.side === "a" ? [match.readyA, match.readyB] : [match.readyB, match.readyA];
    if (!running(match) || match.status !== "scheduled" || match.scheduledAt === null
      || now <= match.scheduledAt + READY_CLOSES_MS || mine === null || theirs !== null) return false;
    await tx.query(
      "UPDATE league_matches SET status = 'complete', result = 'forfeit', winner = $2 WHERE id = $1",
      [match.id, me(match)],
    );
    return true;
  });
}

export class LeagueRoomUnavailable extends Error {
  constructor(readonly reason: "not-found" | "closed") {
    super(reason === "not-found" ? "league match not found" : "this league match cannot start a game now");
  }
}

/** The format a room for this match must use; throws `LeagueRoomUnavailable`
 * when the user cannot enter one now. `claimLeagueRoom` rechecks it. */
export async function leagueRoomFormat(db: Queryable, userId: number, matchId: string): Promise<Format> {
  return withTransaction(db, async (tx) => (await enterableMatch(tx, userId, matchId)).format);
}

/** A member can enter before the game, in any scheduling state, or re-enter a game in progress. */
async function enterableMatch(tx: Queryable, userId: number, matchId: string): Promise<MemberMatch> {
  const match = await lockMemberMatch(tx, matchId, userId);
  if (!match) throw new LeagueRoomUnavailable("not-found");
  if (!playable(match) && !(running(match) && match.status === "in-room")) throw new LeagueRoomUnavailable("closed");
  return match;
}

/** Locks the match and returns its room when one still exists. A null code
 * means the caller creates a room and binds it with `bindLeagueRoom` in the same
 * transaction, so two players entering at once share one room. */
export async function claimLeagueRoom(
  tx: Queryable,
  userId: number,
  matchId: string,
): Promise<{ code: string | null; format: Format }> {
  const match = await enterableMatch(tx, userId, matchId);
  if (match.roomCode !== null) {
    const { rows } = await tx.query("SELECT 1 FROM rooms WHERE code = $1", [match.roomCode]);
    if (rows.length) return { code: match.roomCode, format: match.format };
  }
  // The game's room was lost; the replacement starts a new game.
  if (match.status === "in-room") await returnToScheduling(tx, { ...match, b: match.b! }, null);
  return { code: null, format: match.format };
}

/** Binds a just-created, empty room to the match `claimLeagueRoom` locked. */
export async function bindLeagueRoom(tx: Queryable, userId: number, matchId: string, roomCode: string): Promise<void> {
  const match = await enterableMatch(tx, userId, matchId);
  await tx.query("UPDATE league_matches SET room_code = $2 WHERE id = $1", [match.id, roomCode]);
  await tx.query("UPDATE rooms SET league_match_id = $2 WHERE code = $1", [roomCode, match.id]);
  await notifyLeague(tx, match.leagueId, [match.a, match.b!]);
}

/** A league room's seats by member: seat 0 for member A, seat 1 for member B.
 * Null for any other room. */
export async function leagueRoomSeats(db: Queryable, roomCode: string): Promise<[number | null, number | null] | null> {
  const { rows } = await db.query(
    `SELECT x.member_a, x.member_b, m.member_id, m.user_id FROM rooms r
     JOIN league_matches x ON x.id = r.league_match_id
     JOIN league_members m ON m.league_id = x.league_id AND (m.member_id = x.member_a OR m.member_id = x.member_b)
     WHERE r.code = $1`,
    [roomCode],
  );
  if (!rows.length) return null;
  const seatUser = (memberId: unknown) => {
    const user = rows.find((row) => Number(row.member_id) === Number(memberId))?.user_id;
    return user === null || user === undefined ? null : Number(user);
  };
  return [seatUser(rows[0].member_a), seatUser(rows[0].member_b)];
}

/** Runs in the transaction that starts a league room's game: from here the
 * match waits for that game instead of its deadline. */
export async function startLeagueRoomGame(db: Queryable, roomCode: string): Promise<void> {
  const { rows: rooms } = await db.query("SELECT league_match_id FROM rooms WHERE code = $1", [roomCode]);
  const matchId = rooms[0]?.league_match_id;
  if (matchId === null || matchId === undefined) return;
  const { rows } = await db.query(
    "SELECT id, league_id, member_a, member_b, status FROM league_matches WHERE id = $1 FOR UPDATE",
    [matchId],
  );
  const match = rows[0];
  if (!match || !SCHEDULABLE.includes(matchStatus(match.status))) return;
  await db.query("UPDATE league_matches SET status = 'in-room' WHERE id = $1", [match.id]);
  await notifyLeague(db, String(match.league_id), [Number(match.member_a), Number(match.member_b)]);
}

/** Runs in the room's game-over transaction, after match history recorded
 * the game. A win or draw completes the league match and links that record;
 * a game ending without either returns the match to scheduling. */
export async function resolveLeagueRoomGame(
  db: Queryable,
  roomCode: string,
  game: { winnerUserId: number | null; draw: boolean; startedAt: number },
): Promise<void> {
  const { rows: rooms } = await db.query("SELECT league_match_id FROM rooms WHERE code = $1", [roomCode]);
  const leagueMatchId = rooms[0]?.league_match_id;
  if (leagueMatchId === null || leagueMatchId === undefined) return;
  const { rows } = await db.query(
    "SELECT id, league_id, member_a, member_b, status, scheduled_at FROM league_matches WHERE id = $1 FOR UPDATE",
    [leagueMatchId],
  );
  const match = rows[0];
  // An operator result or a cancellation may already have settled it.
  if (!match || match.status !== "in-room") return;
  let winner: number | null = null;
  if (game.winnerUserId !== null) {
    const { rows: members } = await db.query(
      "SELECT member_id FROM league_members WHERE league_id = $1 AND user_id = $2",
      [match.league_id, game.winnerUserId],
    );
    winner = nullableNumber(members[0]?.member_id);
  }
  const decided = winner !== null && (winner === Number(match.member_a) || winner === Number(match.member_b));
  const players = {
    id: String(match.id), leagueId: String(match.league_id),
    a: Number(match.member_a), b: Number(match.member_b), scheduledAt: match.scheduled_at,
  };
  if (!decided && !game.draw) {
    await returnToScheduling(db, players, roomCode);
    return;
  }
  const { rows: recorded } = await db.query(
    "SELECT id FROM matches WHERE room_code = $1 AND started_at = $2",
    [roomCode, game.startedAt],
  );
  await db.query(
    "UPDATE league_matches SET status = 'complete', result = $2, winner = $3, match_id = $4 WHERE id = $1",
    [match.id, decided ? "played" : "draw", decided ? winner : null, recorded[0]?.id ?? null],
  );
  await notifyLeague(db, players.leagueId, [players.a, players.b]);
}

/** A ruleset cutover or garbage collection can delete a room. A game lost
 * that way returns its match to scheduling; before a game, the match only
 * forgets the room, and the next entry creates another. */
export async function resetLostLeagueRooms(tx: Queryable, leagueId: string): Promise<void> {
  const { rows } = await tx.query(
    `SELECT id, member_a, member_b, status, scheduled_at, room_code FROM league_matches
     WHERE league_id = $1 AND status = ANY($2) AND room_code IS NOT NULL`,
    [leagueId, [...SCHEDULABLE, "in-room"]],
  );
  for (const row of rows) {
    const code = String(row.room_code);
    const { rows: room } = await tx.query("SELECT 1 FROM rooms WHERE code = $1", [code]);
    if (room.length) continue;
    if (row.status === "in-room") {
      await returnToScheduling(tx, {
        id: String(row.id), leagueId, a: Number(row.member_a), b: Number(row.member_b), scheduledAt: row.scheduled_at,
      }, null);
    } else {
      await tx.query("UPDATE league_matches SET room_code = NULL WHERE id = $1", [row.id]);
    }
  }
}

export interface LeagueViewContext {
  leagueId: string;
  status: LeagueStatus;
  startsAt: number | null;
  currentWeek: number;
  matchMinutes: number;
  playoffRoundHours: number;
  memberId: number;
}

/** The member's matches for the current week or playoff round, plus any
 * still open, each with the pair's usable shared time before its deadline. */
export async function memberMatchViews(db: Queryable, context: LeagueViewContext, now = Date.now()): Promise<LeagueMatchView[]> {
  const [{ rows }, { rows: members }, { rows: overrides }] = await Promise.all([
    db.query(
      `SELECT id, stage, week, member_a, member_b, status, scheduled_at, proposed_by, deadline_at, ready_a, ready_b,
              room_code, result, winner
       FROM league_matches WHERE league_id = $1 AND (member_a = $2 OR member_b = $2) AND status <> 'cancelled'
       ORDER BY created_at, id`,
      [context.leagueId, context.memberId],
    ),
    db.query("SELECT member_id, username, time_zone, availability FROM league_members WHERE league_id = $1", [context.leagueId]),
    db.query(
      "SELECT member_id, week, availability FROM league_availability_weeks WHERE league_id = $1",
      [context.leagueId],
    ),
  ]);
  const byId = new Map(members.map((member) => [Number(member.member_id), member]));
  const freeTime = (memberId: number, week: number | null, window: Interval): Interval[] => {
    const member = byId.get(memberId);
    if (!member) return [];
    const override = week === null ? undefined : overrides.find((row) =>
      Number(row.member_id) === memberId && Number(row.week) === week);
    const windows = storedWindows(override?.availability ?? member.availability, "league availability");
    return materializeWeek(windows, String(member.time_zone), window.start, window.end);
  };
  const playoffs = context.status === "playoffs" || context.status === "complete";
  return rows.flatMap((row): LeagueMatchView[] => {
    const status = matchStatus(row.status);
    const stage = matchStage(row.stage);
    const week = nullableNumber(row.week);
    const open = status !== "complete";
    const current = stage === "season" ? !playoffs && week === context.currentWeek : playoffs;
    if (!open && !current) return [];
    const side = Number(row.member_a) === context.memberId ? "a" : "b";
    const opponentId = side === "a" ? nullableNumber(row.member_b) : Number(row.member_a);
    const opponent = opponentId === null ? undefined : byId.get(opponentId);
    const deadlineAt = Number(row.deadline_at);
    const proposedBy = nullableNumber(row.proposed_by);
    let overlap: Interval[] = [];
    if (open && opponentId !== null && status !== "in-room") {
      const start = stage === "season" && context.startsAt !== null && week !== null
        ? seasonWeekBounds(context.startsAt, week).start
        : deadlineAt - context.playoffRoundHours * HOUR_MS;
      const window = { start: Math.max(start, now), end: deadlineAt };
      if (window.end > window.start) {
        overlap = intersectIntervals(freeTime(context.memberId, week, window), freeTime(opponentId, week, window))
          .filter((range) => range.end - range.start >= context.matchMinutes * MINUTE_MS);
      }
    }
    const result = row.result === null ? null : matchResult(row.result);
    const winner = nullableNumber(row.winner);
    return [{
      id: String(row.id),
      stage,
      week,
      opponent: opponentId === null ? null : {
        username: opponent?.username === null || opponent?.username === undefined ? null : String(opponent.username),
        timeZone: opponent ? String(opponent.time_zone) : "UTC",
      },
      status,
      scheduledAt: nullableNumber(row.scheduled_at),
      proposedBy: status !== "proposed" && status !== "scheduled" && status !== "in-room"
        ? null
        : proposedBy === null ? "league" : proposedBy === context.memberId ? "you" : "opponent",
      deadlineAt,
      youReady: (side === "a" ? row.ready_a : row.ready_b) !== null,
      opponentReady: (side === "a" ? row.ready_b : row.ready_a) !== null,
      roomCode: open && row.room_code !== null ? String(row.room_code) : null,
      result,
      won: status !== "complete" || result === "draw" ? null : winner === context.memberId,
      overlap,
    }];
  });
}
