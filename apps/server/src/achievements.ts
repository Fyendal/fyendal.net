import { botDefinitionForDeckId } from "@fyendal/bot";
import {
  ACHIEVEMENT_IDS, ACTIVE_ACHIEVEMENT_IDS, decodeAchievementUnlock,
  type AchievementId, type AchievementsResponse, type HistoryAchievementId, type ReplayPendingAchievements,
} from "@fyendal/protocol";
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

/** The replay frame facts history checks read; a decoded `GameView` satisfies it. */
type HistoryFrame = {
  turn: number;
  gameStats?: { turns: readonly { turn: number; activePlayer: number }[] };
  players: readonly { life: number; handCount: number }[];
};

function trailedAfterFullRound(
  snapshot: {
    turn: number;
    gameStats?: { turns: readonly { turn: number; activePlayer: number }[] };
    players: readonly { life: number }[];
  },
  seat: 0 | 1,
): boolean {
  // Engine turn 1 is the opening turn; a full numbered round starts with turns 2 and 3.
  if (snapshot.players[1 - seat]!.life - snapshot.players[seat]!.life < 15) return false;
  let completedSeats = 0;
  for (const turn of snapshot.gameStats?.turns ?? []) {
    if (turn.turn < 2 || turn.turn >= snapshot.turn) continue;
    completedSeats |= 1 << turn.activePlayer;
    if (completedSeats === 3) return true;
  }
  return false;
}

/** Rewards the final state decides; history-dependent ones need `history`. */
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

/** Persist final-state awards in the game-over commit; return the history
 * checks replay finalization resolves from the frames it already loads. */
export async function awardAchievements(
  db: Queryable,
  room: AchievementMatch,
  now = Date.now(),
): Promise<ReplayPendingAchievements | null> {
  if (room.cardPoolMode !== "legal" || room.state?.phase !== "game-over") return null;
  const eligible = ([0, 1] as const).filter((seat) =>
    room.seats[seat]?.userId && room.seats[seat]?.controller !== "bot");
  if (eligible.length === 0) return null;
  const userIds = eligible.map((seat) => room.seats[seat]!.userId!);
  const { rows: existing } = await db.query(
    "SELECT user_id, achievement_id FROM user_achievements WHERE user_id = $1 OR user_id = $2",
    [userIds[0], userIds[1] ?? null],
  );
  const unlocked: [Set<string>, Set<string>] = [new Set(), new Set()];
  for (const row of existing) {
    const userId = Number(row.user_id);
    if (!Number.isSafeInteger(userId) || typeof row.achievement_id !== "string") {
      throw new Error("invalid achievement row");
    }
    for (const seat of eligible) {
      if (room.seats[seat]!.userId === userId) unlocked[seat].add(row.achievement_id);
    }
  }

  const values: Array<string | number> = [];
  const placeholders: string[] = [];
  const pending: ReplayPendingAchievements = {};
  for (const seat of eligible) {
    for (const id of achievementsForSeat(room, seat)) {
      if (unlocked[seat].has(id)) continue;
      const start = values.length + 1;
      placeholders.push(`($${start}, $${start + 1}, $${start + 2}, $${start + 3})`);
      values.push(room.seats[seat]!.userId!, id, now, room.code);
    }
    const checks: HistoryAchievementId[] = [];
    if (!unlocked[seat].has("full-hand") && room.state.players[seat].hand.length < 6) checks.push("full-hand");
    if (room.state.winner === seat && !unlocked[seat].has("against-the-odds")
      && !trailedAfterFullRound(room.state, seat)) checks.push("against-the-odds");
    if (checks.length > 0) pending[seat] = checks;
  }
  if (values.length > 0) await db.query(
    `INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, room_code)
     VALUES ${placeholders.join(", ")} ON CONFLICT (user_id, achievement_id) DO NOTHING`,
    values,
  );
  return Object.keys(pending).length > 0 ? pending : null;
}

/** Resolve the history checks deferred at game end from the replay's decoded frames. */
export async function awardHistoryAchievements(
  db: Queryable,
  input: {
    roomCode: string;
    pending: ReplayPendingAchievements;
    participants: readonly { seat: 0 | 1; userId: number }[];
    frames: readonly HistoryFrame[];
  },
  now = Date.now(),
): Promise<void> {
  const values: Array<string | number> = [];
  const placeholders: string[] = [];
  for (const { seat, userId } of input.participants) {
    for (const check of input.pending[seat] ?? []) {
      const earned = check === "full-hand"
        ? input.frames.some((frame) => frame.players[seat]!.handCount >= 6)
        : input.frames.some((frame) => trailedAfterFullRound(frame, seat));
      if (!earned) continue;
      const start = values.length + 1;
      placeholders.push(`($${start}, $${start + 1}, $${start + 2}, $${start + 3})`);
      values.push(userId, check, now, input.roomCode);
    }
  }
  if (values.length > 0) await db.query(
    `INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, room_code)
     VALUES ${placeholders.join(", ")} ON CONFLICT (user_id, achievement_id) DO NOTHING`,
    values,
  );
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
