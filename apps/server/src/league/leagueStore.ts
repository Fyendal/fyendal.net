import type {
  Format,
  LeagueAvailabilityRequest,
  LeagueAvailabilityWindow,
  LeagueJoinPreview,
  LeagueJoinRequest,
  LeagueMatchResult,
  LeagueMatchStatus,
  LeagueMembership,
  LeagueStage,
} from "@fyendal/shared";
import { decodeLeagueAvailability, type LeagueExport } from "@fyendal/protocol";
import { withTransaction, type Queryable } from "../db.js";
import { hashToken } from "../tokenHash.js";

export type JoinLeagueResult = "joined" | "already-joined" | "not-found" | "full";
export type LeagueMemberUpdateResult = "updated" | "not-found" | "closed";

function windows(value: unknown, label: string): LeagueAvailabilityWindow[] {
  const decoded = decodeLeagueAvailability(typeof value === "string" ? JSON.parse(value) as unknown : value);
  if (!decoded) throw new Error(`${label} is corrupt`);
  return decoded;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function oneOf<T extends string>(values: readonly T[], label: string): (value: unknown) => T {
  return (value) => {
    if (values.includes(value as T)) return value as T;
    throw new Error(`${label} is corrupt`);
  };
}

const format = oneOf<Format>(["cc", "silver-age"], "league format");
const leagueStatus = oneOf<LeagueMembership["status"]>(["signup", "season", "playoffs", "complete", "cancelled"], "league status");
const matchStage = oneOf<LeagueStage>(["season", "quarterfinal", "semifinal", "final"], "league match stage");
const matchStatus = oneOf<LeagueMatchStatus>(
  ["unscheduled", "proposed", "scheduled", "in-room", "complete", "cancelled"],
  "league match status",
);
const matchResult = oneOf<LeagueMatchResult>(
  ["played", "draw", "forfeit", "double-forfeit", "bye", "operator"],
  "league match result",
);

/** A sign-up link resolves only while sign-up is open. */
export async function leaguePreview(db: Queryable, token: string, userId: number | null): Promise<LeagueJoinPreview | null> {
  const { rows } = await db.query(
    `SELECT id, name, format, status, starts_at, max_players, matches_per_week, season_weeks
     FROM leagues WHERE signup_token_hash = $1 AND status = 'signup'`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  const { rows: members } = await db.query(
    "SELECT user_id FROM league_members WHERE league_id = $1 AND status = 'active'",
    [String(row.id)],
  );
  return {
    name: String(row.name),
    format: format(row.format),
    status: leagueStatus(row.status),
    startsAt: nullableNumber(row.starts_at),
    members: members.length,
    maxPlayers: Number(row.max_players),
    matchesPerWeek: Number(row.matches_per_week),
    seasonWeeks: Number(row.season_weeks),
    joined: userId !== null && members.some((member) => Number(member.user_id) === userId),
  };
}

/** Filling the last seat closes sign-up and, for auto-start leagues, queues
 * the start for the league worker. */
export async function joinLeague(db: Queryable, userId: number, request: LeagueJoinRequest, now = Date.now()): Promise<JoinLeagueResult> {
  return withTransaction(db, async (tx) => {
    const { rows: leagues } = await tx.query(
      `SELECT id, max_players, auto_start FROM leagues
       WHERE signup_token_hash = $1 AND status = 'signup' FOR UPDATE`,
      [hashToken(request.token)],
    );
    const league = leagues[0];
    if (!league) return "not-found";
    const leagueId = String(league.id);
    const { rows: users } = await tx.query("SELECT username FROM users WHERE id = $1", [userId]);
    if (!users[0]) return "not-found";
    const { rows: members } = await tx.query(
      "SELECT member_id, user_id FROM league_members WHERE league_id = $1",
      [leagueId],
    );
    if (members.some((member) => Number(member.user_id) === userId)) return "already-joined";
    const maxPlayers = Number(league.max_players);
    if (members.length >= maxPlayers) return "full";
    const memberId = members.reduce((max, member) => Math.max(max, Number(member.member_id)), 0) + 1;
    await tx.query(
      `INSERT INTO league_members (league_id, member_id, user_id, username, time_zone, availability, status, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
      [leagueId, memberId, userId, String(users[0].username), request.timeZone, JSON.stringify(request.availability), now],
    );
    if (members.length + 1 === maxPlayers) {
      await tx.query("UPDATE leagues SET signup_token_hash = NULL WHERE id = $1", [leagueId]);
      if (league.auto_start === true) {
        await tx.query(
          "INSERT INTO league_actions (league_id, action, created_at) VALUES ($1, $2, $3)",
          [leagueId, JSON.stringify({ kind: "start" }), now],
        );
      }
    }
    return "joined";
  });
}

/** Leaving is only possible before the season; there is no history yet. */
export async function leaveLeague(db: Queryable, userId: number, leagueId: string): Promise<LeagueMemberUpdateResult> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query("SELECT status FROM leagues WHERE id = $1 FOR UPDATE", [leagueId]);
    const { rows: members } = await tx.query(
      "SELECT 1 FROM league_members WHERE league_id = $1 AND user_id = $2",
      [leagueId, userId],
    );
    if (!rows[0] || !members.length) return "not-found";
    if (rows[0].status !== "signup") return "closed";
    await tx.query("DELETE FROM league_members WHERE league_id = $1 AND user_id = $2", [leagueId, userId]);
    return "updated";
  });
}

/** Replaces the member's template, or one week's override, and time zone.
 * A week override must be the current or a later season week. */
export async function setLeagueAvailability(
  db: Queryable,
  userId: number,
  request: LeagueAvailabilityRequest,
): Promise<LeagueMemberUpdateResult> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT l.status, l.season_weeks, l.current_week, m.member_id
       FROM leagues l JOIN league_members m ON m.league_id = l.id
       WHERE l.id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [request.leagueId, userId],
    );
    const row = rows[0];
    if (!row) return "not-found";
    if (row.status !== "signup" && row.status !== "season") return "closed";
    const memberId = Number(row.member_id);
    const availability = JSON.stringify(request.availability);
    if (request.week !== undefined) {
      if (request.week < Math.max(1, Number(row.current_week)) || request.week > Number(row.season_weeks)) return "closed";
      await tx.query(
        `INSERT INTO league_availability_weeks (league_id, member_id, week, availability) VALUES ($1, $2, $3, $4)
         ON CONFLICT (league_id, member_id, week) DO UPDATE SET availability = EXCLUDED.availability`,
        [request.leagueId, memberId, request.week, availability],
      );
      await tx.query(
        "UPDATE league_members SET time_zone = $3 WHERE league_id = $1 AND member_id = $2",
        [request.leagueId, memberId, request.timeZone],
      );
    } else {
      await tx.query(
        "UPDATE league_members SET time_zone = $3, availability = $4 WHERE league_id = $1 AND member_id = $2",
        [request.leagueId, memberId, request.timeZone, availability],
      );
    }
    return "updated";
  });
}

/** Active memberships, newest league first. */
export async function listMemberLeagues(db: Queryable, userId: number): Promise<LeagueMembership[]> {
  const { rows } = await db.query(
    `SELECT l.id, l.name, l.format, l.status, l.starts_at, l.season_weeks, l.matches_per_week, l.match_minutes,
            l.max_players, l.signup_token_hash IS NOT NULL AS signup_open, m.time_zone, m.availability
     FROM leagues l JOIN league_members m ON m.league_id = l.id
     WHERE m.user_id = $1 AND m.status = 'active' AND l.status <> 'cancelled'
     ORDER BY l.created_at DESC, l.id`,
    [userId],
  );
  if (!rows.length) return [];
  const { rows: rosterRows } = await db.query(
    `SELECT r.league_id, r.user_id, r.username FROM league_members r
     JOIN league_members m ON m.league_id = r.league_id AND m.user_id = $1 AND m.status = 'active'
     WHERE r.status = 'active' ORDER BY r.league_id, r.member_id`,
    [userId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    format: format(row.format),
    status: leagueStatus(row.status),
    startsAt: nullableNumber(row.starts_at),
    seasonWeeks: Number(row.season_weeks),
    matchesPerWeek: Number(row.matches_per_week),
    matchMinutes: Number(row.match_minutes),
    maxPlayers: Number(row.max_players),
    signupOpen: row.status === "signup" && row.signup_open === true,
    roster: rosterRows.filter((member) => member.league_id === row.id).map((member) => ({
      username: member.username === null ? null : String(member.username),
      you: Number(member.user_id) === userId,
    })),
    timeZone: String(row.time_zone),
    availability: windows(row.availability, "league availability"),
  }));
}

/** Drops a member and cancels their unfinished matches; completed ones still count. */
export async function dropLeagueMember(db: Queryable, leagueId: string, memberId: number): Promise<void> {
  await db.query(
    "UPDATE league_members SET status = 'dropped' WHERE league_id = $1 AND member_id = $2",
    [leagueId, memberId],
  );
  await db.query(
    `UPDATE league_matches SET status = 'cancelled'
     WHERE league_id = $1 AND (member_a = $2 OR member_b = $2) AND status NOT IN ('complete', 'cancelled')`,
    [leagueId, memberId],
  );
}

/** Runs inside account deletion before the user row goes. Sign-up
 * memberships disappear; later ones keep an anonymous member so opponents'
 * standings hold. */
export async function detachLeaguesForUser(db: Queryable, userId: number): Promise<void> {
  await db.query(
    `DELETE FROM league_members WHERE user_id = $1
     AND league_id IN (SELECT id FROM leagues WHERE status = 'signup')`,
    [userId],
  );
  const { rows } = await db.query(
    `SELECT m.league_id, m.member_id, l.status FROM league_members m JOIN leagues l ON l.id = m.league_id
     WHERE m.user_id = $1`,
    [userId],
  );
  for (const row of rows) {
    if (row.status === "season" || row.status === "playoffs") {
      await dropLeagueMember(db, String(row.league_id), Number(row.member_id));
    }
    await db.query(
      "DELETE FROM league_availability_weeks WHERE league_id = $1 AND member_id = $2",
      [String(row.league_id), Number(row.member_id)],
    );
  }
  await db.query(
    "UPDATE league_members SET username = NULL, availability = '[]' WHERE user_id = $1",
    [userId],
  );
}

export async function exportLeagueData(db: Queryable, userId: number): Promise<LeagueExport[]> {
  const { rows: memberships } = await db.query(
    `SELECT l.id, l.name, l.format, l.status AS league_status, m.member_id, m.status, m.joined_at,
            m.time_zone, m.availability
     FROM league_members m JOIN leagues l ON l.id = m.league_id
     WHERE m.user_id = $1 ORDER BY m.joined_at, l.id`,
    [userId],
  );
  const result: LeagueExport[] = [];
  for (const membership of memberships) {
    const leagueId = String(membership.id);
    const memberId = Number(membership.member_id);
    const [{ rows: weeks }, { rows: matches }] = await Promise.all([
      db.query(
        "SELECT week, availability FROM league_availability_weeks WHERE league_id = $1 AND member_id = $2 ORDER BY week",
        [leagueId, memberId],
      ),
      db.query(
        `SELECT x.stage, x.week, x.bracket_slot, x.status, x.scheduled_at, x.result, x.winner,
                o.username AS opponent
         FROM league_matches x
         LEFT JOIN league_members o ON o.league_id = x.league_id
           AND o.member_id = CASE WHEN x.member_a = $2 THEN x.member_b ELSE x.member_a END
         WHERE x.league_id = $1 AND (x.member_a = $2 OR x.member_b = $2)
         ORDER BY x.created_at, x.id`,
        [leagueId, memberId],
      ),
    ]);
    result.push({
      name: String(membership.name),
      format: format(membership.format),
      leagueStatus: leagueStatus(membership.league_status),
      memberStatus: membership.status === "dropped" ? "dropped" : "active",
      joinedAt: Number(membership.joined_at),
      timeZone: String(membership.time_zone),
      availability: windows(membership.availability, "league availability"),
      availabilityWeeks: weeks.map((week) => ({
        week: Number(week.week),
        availability: windows(week.availability, "league week availability"),
      })),
      matches: matches.map((match) => ({
        stage: matchStage(match.stage),
        week: nullableNumber(match.week),
        bracketSlot: nullableNumber(match.bracket_slot),
        opponent: match.opponent === null || match.opponent === undefined ? null : String(match.opponent),
        status: matchStatus(match.status),
        scheduledAt: nullableNumber(match.scheduled_at),
        result: match.result === null ? null : matchResult(match.result),
        // A double forfeit has no winner and counts as a loss.
        won: match.status !== "complete" || match.result === "draw" ? null : nullableNumber(match.winner) === memberId,
      })),
    });
  }
  return result;
}
