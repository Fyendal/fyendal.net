import { botDefinitionForDeckId } from "@fyendal/bot";
import { ACHIEVEMENT_IDS, ACTIVE_ACHIEVEMENT_IDS, decodeAchievementUnlock, decodeGameView, type AchievementId, type AchievementsResponse } from "@fyendal/protocol";
import type { Queryable } from "./db.js";
import type { RoomRow, SeatRow } from "./store.js";

type AchievementMatch = Pick<RoomRow, "code" | "cardPoolMode"> & {
  seats: [Pick<SeatRow, "userId" | "controller" | "deckId"> | null,
    Pick<SeatRow, "userId" | "controller" | "deckId"> | null];
  state: Pick<NonNullable<RoomRow["state"]>, "phase" | "winner" | "turn" | "gameStats"> & {
    players: [{ life: number; hand: { length: number }; deck: { length: number } },
      { life: number; hand: { length: number }; deck: { length: number } }];
  } | null;
};

type AchievementHistory = { maxHandCount: number; trailedAfterRound: boolean };

function trailedAfterFullRound(
  snapshot: { turn: number; gameStats?: { turns: readonly { turn: number; activePlayer: number }[] }; players: readonly { life: number }[] },
  seat: 0 | 1,
): boolean {
  // Engine turn 1 is the opening turn; a full numbered round starts with turns 2 and 3.
  const completed = snapshot.gameStats?.turns.filter((turn) => turn.turn >= 2 && turn.turn < snapshot.turn) ?? [];
  return completed.some((turn) => turn.activePlayer === 0)
    && completed.some((turn) => turn.activePlayer === 1)
    && snapshot.players[1 - seat]!.life - snapshot.players[seat]!.life >= 15;
}

/** Eligible rewards are persisted alongside the final room state in its transaction. */
export function achievementsForSeat(
  room: AchievementMatch,
  seat: 0 | 1,
  history: AchievementHistory = { maxHandCount: 0, trailedAfterRound: false },
): AchievementId[] {
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
      if (bot) {
        const botAchievement: AchievementId = `beat-${bot.id}`;
        if (ACTIVE_ACHIEVEMENT_IDS.includes(botAchievement)) result.push(botAchievement);
      }
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
  if (Math.max(history.maxHandCount, state.players[seat].hand.length) >= 6) result.push("full-hand");
  if (won && state.players[1 - seat]!.life <= -10) result.push("overkill");
  if (won && state.players[seat].life > 20) result.push("healthy-victory");
  if (won && state.players[seat].life === 1) result.push("last-life");
  if (turns.some((turn) => turn.activePlayer === seat && turn.attacks[seat] >= 5)) result.push("five-strike-turn");
  if (turns.some((turn) => turn.activePlayer !== seat && turn.blocked[seat] >= 20)) result.push("iron-wall");
  if (won && turns.reduce((sum, turn) => sum + (turn.lifeGained?.[seat] ?? 0), 0) >= 10) result.push("second-wind");
  if (won && state.turn >= 15) result.push("long-game");
  if (won && (history.trailedAfterRound || trailedAfterFullRound(state, seat))) result.push("against-the-odds");
  if (won && state.players[seat].deck.length === 0) result.push("empty-tank");
  return result;
}

export async function awardAchievements(db: Queryable, room: AchievementMatch, now = Date.now()): Promise<void> {
  if (room.cardPoolMode !== "legal" || room.state?.phase !== "game-over") return;
  // Replay frames follow undo pruning, so undone hands do not earn rewards.
  // The final state is checked separately because its frame has not been appended yet.
  const maxHands: [number, number] = [0, 0];
  const trailedAfterRound: [boolean, boolean] = [false, false];
  let afterVersion = -1;
  while (true) {
    const { rows } = await db.query(
      `SELECT room_version, view FROM replay_frames
       WHERE replay_id = (
         SELECT id FROM replay_games WHERE room_code = $1 AND status = 'recording'
         ORDER BY created_at DESC LIMIT 1
       ) AND room_version > $2
       ORDER BY room_version LIMIT 100`,
      [room.code, afterVersion],
    );
    for (const row of rows) {
      const version = Number(row.room_version);
      const view = decodeGameView(row.view);
      if (!Number.isSafeInteger(version) || version <= afterVersion || !view) {
        throw new Error("invalid achievement replay frame");
      }
      afterVersion = version;
      for (const seat of [0, 1] as const) {
        maxHands[seat] = Math.max(maxHands[seat], view.players[seat].handCount);
        trailedAfterRound[seat] ||= trailedAfterFullRound(view, seat);
      }
    }
    if (rows.length < 100 || (maxHands.every((count) => count >= 6) && trailedAfterRound.every(Boolean))) break;
  }
  for (const seat of [0, 1] as const) {
    const userId = room.seats[seat]?.userId;
    if (!userId) continue;
    for (const id of achievementsForSeat(room, seat, {
      maxHandCount: maxHands[seat], trailedAfterRound: trailedAfterRound[seat],
    })) {
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
