import { botDefinitionForDeckId } from "@fyendal/bot";
import { ACHIEVEMENT_IDS, decodeAchievementUnlock, type AchievementId, type AchievementsResponse } from "@fyendal/protocol";
import type { Queryable } from "./db.js";
import type { RoomRow, SeatRow } from "./store.js";

type AchievementMatch = Pick<RoomRow, "code" | "cardPoolMode"> & {
  seats: [Pick<SeatRow, "userId" | "controller" | "deckId"> | null,
    Pick<SeatRow, "userId" | "controller" | "deckId"> | null];
  state: Pick<NonNullable<RoomRow["state"]>, "phase" | "winner" | "gameStats"> | null;
};

/** Eligible rewards are persisted alongside the final room state in its transaction. */
export function achievementsForSeat(room: AchievementMatch, seat: 0 | 1): AchievementId[] {
  const state = room.state;
  const player = room.seats[seat];
  if (room.cardPoolMode !== "legal" || state?.phase !== "game-over"
    || !player?.userId || player.controller === "bot") return [];

  const result: AchievementId[] = [];
  const opponent = room.seats[1 - seat];
  const won = state.winner === seat;
  if (won) {
    result.push("first-victory");
    if (opponent?.controller === "bot") {
      result.push("first-bot-win");
      const bot = botDefinitionForDeckId(opponent.deckId);
      if (bot) result.push(`beat-${bot.id}`);
    } else if (opponent?.userId) {
      result.push("first-pvp-win");
    }
  }

  const turns = state.gameStats.turns;
  if (turns.some((turn) => turn.activePlayer === seat && turn.damageDealt[seat] > 25)) {
    result.push("big-turn");
  }
  if (won) {
    // Match the post-opening damage-per-turn number displayed by GameOver.
    const countedTurns = new Set(turns
      .filter((turn) => turn.turn >= 2 && turn.activePlayer === seat)
      .map((turn) => Math.floor(turn.turn / 2))).size;
    const damage = turns.reduce((sum, turn) => sum + (turn.turn >= 2 ? turn.damageDealt[seat] : 0), 0);
    if (countedTurns > 0 && damage > 16 * countedTurns) result.push("relentless-victory");
  }
  return result;
}

export async function awardAchievements(db: Queryable, room: AchievementMatch, now = Date.now()): Promise<void> {
  for (const seat of [0, 1] as const) {
    const userId = room.seats[seat]?.userId;
    if (!userId) continue;
    for (const id of achievementsForSeat(room, seat)) {
      await db.query(
        `INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, room_code)
         VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, achievement_id) DO NOTHING`,
        [userId, id, now, room.code],
      );
    }
  }
}

export async function listUserAchievements(
  db: Queryable,
  userId: number,
): Promise<AchievementsResponse["unlocks"]> {
  const { rows } = await db.query(
    `SELECT achievement_id, unlocked_at, room_code FROM user_achievements
     WHERE user_id = $1 ORDER BY unlocked_at DESC, achievement_id`,
    [userId],
  );
  return rows.map((row) => {
    const unlock = decodeAchievementUnlock({
      id: row.achievement_id,
      unlockedAt: Number(row.unlocked_at),
      roomCode: row.room_code,
    });
    if (!unlock) throw new Error("invalid achievement row");
    return unlock;
  });
}

export async function getAchievements(db: Queryable, userId: number): Promise<AchievementsResponse> {
  const [unlocks, { rows: totals }, { rows: players }] = await Promise.all([
    listUserAchievements(db, userId),
    db.query("SELECT achievement_id, COUNT(*) AS total FROM user_achievements GROUP BY achievement_id"),
    db.query("SELECT COUNT(DISTINCT user_id) AS total FROM daily_game_players"),
  ]);
  const population = Number(players[0]?.total ?? 0);
  const counts = new Map(totals.map((row) => [String(row.achievement_id), Number(row.total)]));
  return {
    ok: true,
    unlocks,
    percentages: ACHIEVEMENT_IDS.map((id) => ({
      id,
      percent: population === 0 ? 0 : (counts.get(id) ?? 0) * 100 / population,
    })),
  };
}
