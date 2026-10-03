import { describe, expect, it } from "vitest";
import { botDefinitions } from "@fyendal/bot";
import { achievementsForSeat, awardAchievements, getAchievements, listUserAchievements } from "../achievements.js";
import { freshDb } from "./testdb.js";

type Match = Parameters<typeof achievementsForSeat>[0];

function match({
  winner = 0,
  opponent = { userId: 2 },
  damage = [0],
  mode = "legal",
}: {
  winner?: 0 | 1 | null;
  opponent?: Match["seats"][1];
  damage?: number[];
  mode?: Match["cardPoolMode"];
} = {}): Match {
  return {
    code: "ABCDEF",
    cardPoolMode: mode,
    seats: [{ userId: 1 }, opponent],
    state: {
      phase: "game-over",
      winner,
      gameStats: { turns: damage.map((amount, index) => ({
        turn: index * 2 + 2,
        activePlayer: 0,
        attacks: [0, 0],
        threatened: [0, 0],
        blocked: [0, 0],
        damageDealt: [amount, 0],
      })) },
    },
  };
}

describe("achievements", () => {
  it("awards each registered bot by its existing deck identity", () => {
    for (const bot of botDefinitions) {
      const awards = achievementsForSeat(match({
        opponent: { controller: "bot", deckId: bot.deckId },
      }), 0);
      expect(awards).toEqual(["first-victory", "first-bot-win", `beat-${bot.id}`]);
    }
  });

  it("uses actual own-turn damage and a strict post-opening average", () => {
    expect(achievementsForSeat(match({ damage: [25, 7] }), 0)).toEqual([
      "first-victory", "first-pvp-win",
    ]);
    expect(achievementsForSeat(match({ damage: [26, 17, 16] }), 0)).toEqual([
      "first-victory", "first-pvp-win", "big-turn", "relentless-victory",
    ]);
    expect(achievementsForSeat(match({ winner: 1, damage: [26] }), 0)).toEqual(["big-turn"]);
    expect(achievementsForSeat(match({ damage: [26], mode: "open" }), 0)).toEqual([]);
  });

  it("rejects unlock timestamps that cannot be displayed as dates", async () => {
    const db = await freshDb();
    const { rows } = await db.query(
      "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ('Alice','alice','hash',1) RETURNING id",
    );
    const userId = Number(rows[0]!.id);
    await db.query(
      "INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, room_code) VALUES ($1, $2, $3, $4)",
      [userId, "first-victory", 8_640_000_000_000_001, "ABCDEF"],
    );
    await expect(listUserAchievements(db, userId)).rejects.toThrow("invalid achievement row");
  });

  it("persists unlocks once and reports percentages over players who played", async () => {
    const db = await freshDb();
    const { rows } = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('Alice','alice','hash',1), ('Bob','bob','hash',1) RETURNING id`,
    );
    const alice = Number(rows[0]!.id);
    const bob = Number(rows[1]!.id);
    await db.query(
      "INSERT INTO daily_game_players (day_utc, user_id) VALUES (0, $1), (0, $2)",
      [alice, bob],
    );
    const completed = match({ damage: [26] });
    completed.seats[0] = { userId: alice };
    completed.seats[1] = { userId: bob };
    await awardAchievements(db, completed, 123);
    await awardAchievements(db, completed, 124);
    const result = await getAchievements(db, alice);
    expect(result.unlocks.map((item) => item.id)).toEqual([
      "big-turn", "first-pvp-win", "first-victory", "relentless-victory",
    ]);
    expect(result.unlocks.every((item) => item.unlockedAt === 123)).toBe(true);
    expect(result.percentages.find((item) => item.id === "big-turn")?.percent).toBe(50);
  });
});
