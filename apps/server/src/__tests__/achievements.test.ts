import { describe, expect, it } from "vitest";
import { createGame } from "@fyendal/engine";
import { cardData, decklists, scripts } from "@fyendal/cards";
import { appendReplayView, startReplay, pruneReplayFramesFrom } from "../replays.js";
import { botDefinitions } from "@fyendal/bot";
import { achievementsForSeat, awardAchievements, getAchievements, listUserAchievements } from "../achievements.js";
import type { Queryable } from "../db.js";
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
      turn: 1,
      players: [{ life: 10, hand: [], deck: { length: 1 } }, { life: 0, hand: [], deck: { length: 1 } }],
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
  it("awards active bot achievements by deck identity", () => {
    for (const bot of botDefinitions) {
      const awards = achievementsForSeat(match({
        opponent: { controller: "bot", deckId: bot.deckId },
      }), 0);
      expect(awards).toEqual([
        "first-victory", "first-bot-win",
        ...(bot.id === "starvo" || bot.id === "levia" ? [] : [`beat-${bot.id}`]),
      ]);
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

  it.each([[-9, false], [-10, true], [-11, true]])("checks overkill at %i life", (life, earned) => {
    const room = match();
    room.state!.players[1].life = life;
    expect(achievementsForSeat(room, 0).includes("overkill")).toBe(earned);
    room.state!.winner = null;
    expect(achievementsForSeat(room, 0)).not.toContain("overkill");
  });

  it.each([[20, false, false], [21, true, false], [1, false, true], [2, false, false], [0, false, false]])(
    "checks victory challenges at %i life", (life, healthy, lastLife) => {
      const room = match();
      room.state!.players[0].life = life;
      expect(achievementsForSeat(room, 0).includes("healthy-victory")).toBe(healthy);
      expect(achievementsForSeat(room, 0).includes("last-life")).toBe(lastLife);
      room.state!.winner = 1;
      expect(achievementsForSeat(room, 0)).not.toContain("healthy-victory");
      expect(achievementsForSeat(room, 0)).not.toContain("last-life");
    },
  );

  it("counts six or more cards for either seat, including a losing player", () => {
    const room = match();
    for (const seat of [0, 1] as const) {
      expect(achievementsForSeat(room, seat, { maxHandCount: 5, trailedAfterRound: false })).not.toContain("full-hand");
      expect(achievementsForSeat(room, seat, { maxHandCount: 6, trailedAfterRound: false })).toContain("full-hand");
      expect(achievementsForSeat(room, seat, { maxHandCount: 7, trailedAfterRound: false })).toContain("full-hand");
    }
    room.cardPoolMode = "open";
    expect(achievementsForSeat(room, 0, { maxHandCount: 6, trailedAfterRound: false })).toEqual([]);
    room.cardPoolMode = "legal";
    room.state!.phase = "action";
    expect(achievementsForSeat(room, 0, { maxHandCount: 6, trailedAfterRound: false })).toEqual([]);
    room.state!.phase = "game-over";
    room.seats[0] = { userId: 1, controller: "bot" };
    expect(achievementsForSeat(room, 0, { maxHandCount: 6, trailedAfterRound: false })).toEqual([]);
    room.seats[0] = {};
    expect(achievementsForSeat(room, 0, { maxHandCount: 6, trailedAfterRound: false })).toEqual([]);
  });

  it("checks five attacks during one own turn and 20 blocked during one opposing turn", () => {
    const room = match({ winner: 1 });
    const ownTurn = room.state!.gameStats.turns[0]!;
    ownTurn.activePlayer = 0;
    ownTurn.attacks[0] = 4;
    ownTurn.blocked[0] = 20;
    const opposingTurn = { ...ownTurn, turn: 3, activePlayer: 1,
      attacks: [0, 0] as [number, number], blocked: [19, 0] as [number, number] };
    room.state!.gameStats.turns.push(opposingTurn);
    expect(achievementsForSeat(room, 0)).not.toContain("five-strike-turn");
    expect(achievementsForSeat(room, 0)).not.toContain("iron-wall");
    ownTurn.attacks[0] = 5;
    opposingTurn.blocked[0] = 20;
    expect(achievementsForSeat(room, 0)).toEqual(["five-strike-turn", "iron-wall"]);
  });

  it("requires a win for life gain, a late turn, and an empty deck", () => {
    const room = match();
    const first = room.state!.gameStats.turns[0]!;
    first.lifeGained = [9, 0];
    room.state!.turn = 14;
    expect(achievementsForSeat(room, 0)).not.toContain("second-wind");
    expect(achievementsForSeat(room, 0)).not.toContain("long-game");
    expect(achievementsForSeat(room, 0)).not.toContain("empty-tank");
    first.lifeGained[0] = 4;
    room.state!.gameStats.turns.push({ ...first, turn: 4, lifeGained: [6, 0] });
    room.state!.turn = 15;
    room.state!.players[0].deck = { length: 0 };
    expect(achievementsForSeat(room, 0)).toEqual([
      "first-victory", "first-pvp-win", "second-wind", "long-game", "empty-tank",
    ]);
    room.state!.winner = 1;
    expect(achievementsForSeat(room, 0)).toEqual([]);
  });

  it("requires both post-opening turns before a 15-life deficit counts", () => {
    const room = match();
    const first = room.state!.gameStats.turns[0]!;
    first.turn = 1;
    first.activePlayer = 0;
    const second = { ...first, turn: 2, activePlayer: 1 };
    room.state!.gameStats.turns.push(second);
    room.state!.players[0].life = 5;
    room.state!.players[1].life = 20;
    room.state!.turn = 2;
    expect(achievementsForSeat(room, 0)).not.toContain("against-the-odds");
    room.state!.turn = 3;
    room.state!.gameStats.turns.push({ ...first, turn: 3, activePlayer: 0 });
    expect(achievementsForSeat(room, 0)).not.toContain("against-the-odds");
    room.state!.turn = 4;
    room.state!.players[1].life = 19;
    expect(achievementsForSeat(room, 0)).not.toContain("against-the-odds");
    room.state!.players[1].life = 20;
    second.activePlayer = 0;
    expect(achievementsForSeat(room, 0)).not.toContain("against-the-odds");
    second.activePlayer = 1;
    expect(achievementsForSeat(room, 0)).toContain("against-the-odds");
    room.state!.winner = 1;
    expect(achievementsForSeat(room, 0)).not.toContain("against-the-odds");
  });

  it("uses replay hands, excludes undone frames, and checks the final hand", async () => {
    const db = await freshDb();
    const { rows } = await db.query(
      "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ('Alice','alice','hash',1) RETURNING id",
    );
    const userId = Number(rows[0]!.id);
    const room = match({ winner: 1, opponent: null });
    room.seats[0] = { userId };
    const state = createGame({
      decklists: [decklists.rhinar, decklists.dorinthea], cards: cardData, scripts, seed: 1, startPlayer: 0,
    });
    while (state.players[0].hand.length < 6) state.players[0].hand.push(state.players[0].deck.pop()!);
    await startReplay(db, {
      roomCode: room.code, rulesetVersion: "test", format: "classic-battles", state, roomVersion: 1,
      participants: [
        { seat: 0, userId, heroId: decklists.rhinar.heroId },
        { seat: 1, heroId: decklists.dorinthea.heroId },
      ],
    });
    await awardAchievements(db, room, 100);
    expect((await listUserAchievements(db, userId)).map((unlock) => unlock.id)).toEqual(["full-hand"]);
    await db.query("DELETE FROM user_achievements WHERE user_id = $1", [userId]);
    await pruneReplayFramesFrom(db, room.code, 1);
    await awardAchievements(db, room, 101);
    expect(await listUserAchievements(db, userId)).toEqual([]);
    room.state!.players[0].hand = state.players[0].hand;
    await awardAchievements(db, room, 102);
    expect((await listUserAchievements(db, userId)).map((unlock) => unlock.id)).toEqual(["full-hand"]);
  });

  it("awards a past 15-life deficit only after a full round and excludes undone frames", async () => {
    const db = await freshDb();
    const { rows } = await db.query(
      "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ('Alice','alice','hash',1) RETURNING id",
    );
    const userId = Number(rows[0]!.id);
    const room = match({ opponent: null });
    room.seats[0] = { userId };
    const state = createGame({
      decklists: [decklists.rhinar, decklists.dorinthea], cards: cardData, scripts, seed: 2, startPlayer: 0,
    });
    const statsTurn = (turn: number, activePlayer: number) => ({
      turn, activePlayer, attacks: [0, 0] as [number, number],
      threatened: [0, 0] as [number, number], blocked: [0, 0] as [number, number],
      damageDealt: [0, 0] as [number, number],
    });
    state.gameStats.turns = [statsTurn(1, 0)];
    await startReplay(db, {
      roomCode: room.code, rulesetVersion: "test", format: "classic-battles", state, roomVersion: 1,
      participants: [
        { seat: 0, userId, heroId: decklists.rhinar.heroId },
        { seat: 1, heroId: decklists.dorinthea.heroId },
      ],
    });
    state.turn = 2;
    state.gameStats.turns.push(statsTurn(2, 1));
    state.players[0].life = 5;
    state.players[1].life = 20;
    await appendReplayView(db, room.code, 2, state, null, null);
    await awardAchievements(db, room, 100);
    expect((await listUserAchievements(db, userId)).map((unlock) => unlock.id)).not.toContain("against-the-odds");

    state.turn = 3;
    state.gameStats.turns.push(statsTurn(3, 0));
    await appendReplayView(db, room.code, 3, state, null, null);
    await awardAchievements(db, room, 101);
    expect((await listUserAchievements(db, userId)).map((unlock) => unlock.id)).not.toContain("against-the-odds");

    state.turn = 4;
    state.gameStats.turns.push(statsTurn(4, 1));
    await appendReplayView(db, room.code, 4, state, null, null);
    await awardAchievements(db, room, 102);
    expect((await listUserAchievements(db, userId)).map((unlock) => unlock.id)).toContain("against-the-odds");

    await db.query("DELETE FROM user_achievements WHERE user_id = $1", [userId]);
    await pruneReplayFramesFrom(db, room.code, 4);
    await awardAchievements(db, room, 103);
    expect((await listUserAchievements(db, userId)).map((unlock) => unlock.id)).not.toContain("against-the-odds");
  });

  it("skips replay reads for previously earned history awards and inserts new awards together", async () => {
    const db = await freshDb();
    const { rows } = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('Alice','alice','hash',1), ('Bob','bob','hash',1) RETURNING id`,
    );
    const alice = Number(rows[0]!.id);
    const bob = Number(rows[1]!.id);
    for (const [userId, id] of [
      [alice, "full-hand"], [alice, "against-the-odds"], [bob, "full-hand"],
    ] as const) {
      await db.query(
        "INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, room_code) VALUES ($1, $2, 1, 'ABCDEF')",
        [userId, id],
      );
    }
    let replayReads = 0;
    let inserts = 0;
    const counted: Queryable = { query: async (sql, params) => {
      if (sql.includes("FROM replay_frames")) replayReads++;
      if (sql.startsWith("INSERT INTO user_achievements")) inserts++;
      return db.query(sql, params);
    } };
    const room = match({ damage: [26] });
    room.seats = [{ userId: alice }, { userId: bob }];
    room.state!.gameStats.turns[0]!.blocked[1] = 20;
    await awardAchievements(counted, room, 123);
    expect(replayReads).toBe(0);
    expect(inserts).toBe(1);
    expect((await listUserAchievements(db, alice)).map((unlock) => unlock.id)).toEqual([
      "big-turn", "first-pvp-win", "first-victory", "relentless-victory", "against-the-odds", "full-hand",
    ]);
    expect((await listUserAchievements(db, bob)).map((unlock) => unlock.id)).toEqual(["iron-wall", "full-hand"]);
    await awardAchievements(counted, room, 124);
    expect(replayReads).toBe(0);
    expect(inserts).toBe(1);
  });

  it.each(["full-hand", "against-the-odds"] as const)(
    "continues past an early %s unlock and stops when both history checks finish", async (firstAward) => {
      const db = await freshDb();
      const { rows: users } = await db.query(
        `INSERT INTO users (username, username_lc, pass_hash, created_at)
         VALUES ('Alice','alice','hash',1) RETURNING id`,
      );
      const userId = Number(users[0]!.id);
      const room = match({ winner: 1 });
      room.seats = [{ controller: "bot" }, { userId }];
      room.state!.players[0].life = 0;
      room.state!.players[1].life = 10;
      const state = createGame({
        decklists: [decklists.rhinar, decklists.dorinthea], cards: cardData, scripts, seed: 3, startPlayer: 0,
      });
      const firstTurn = state.gameStats.turns[0]!;
      state.gameStats.turns = [firstTurn, { ...firstTurn, turn: 2, activePlayer: 1 },
        { ...firstTurn, turn: 3, activePlayer: 0 }, { ...firstTurn, turn: 4, activePlayer: 1 }];
      state.turn = 4;
      state.activePlayer = 1;
      state.players[0].life = 20;
      state.players[1].life = firstAward === "against-the-odds" ? 5 : 6;
      const fillHand = () => {
        while (state.players[1].hand.length < 6) state.players[1].hand.push(state.players[1].deck.pop()!);
      };
      if (firstAward === "full-hand") fillHand();
      await startReplay(db, {
        roomCode: room.code, rulesetVersion: "test", format: "classic-battles", state, roomVersion: 1,
        participants: [
          { seat: 0, heroId: decklists.rhinar.heroId },
          { seat: 1, userId, heroId: decklists.dorinthea.heroId },
        ],
      });
      const fillPage = async (sourceVersion: number) => {
        const { rows } = await db.query(
          "SELECT replay_id, view FROM replay_frames WHERE room_version = $1", [sourceVersion],
        );
        const source = rows[0]!;
        const values: unknown[] = [];
        const placeholders = Array.from({ length: 99 }, (_, i) => {
          values.push(source.replay_id, sourceVersion + i + 1, JSON.stringify(source.view));
          return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
        });
        await db.query(
          `INSERT INTO replay_frames (replay_id, room_version, view) VALUES ${placeholders.join(", ")}`, values,
        );
      };
      await fillPage(1);
      fillHand();
      state.players[1].life = 5;
      await appendReplayView(db, room.code, 101, state, null, null);
      await fillPage(101);
      const replayQueries: string[] = [];
      const counted: Queryable = { query: (sql, params) => {
        if (sql.includes("FROM replay_frames")) replayQueries.push(sql);
        return db.query(sql, params);
      } };
      await awardAchievements(counted, room, 123);
      expect(replayQueries).toHaveLength(2);
      expect(replayQueries[1]!.includes("view->'gameStats'")).toBe(firstAward !== "against-the-odds");
      expect((await listUserAchievements(db, userId)).map((unlock) => unlock.id)).toEqual([
        "against-the-odds", "first-bot-win", "first-victory", "full-hand",
      ]);
    },
  );

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

  it("keeps previously earned Starvo unlocks readable", async () => {
    const db = await freshDb();
    const { rows } = await db.query(
      "INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES ('Alice','alice','hash',1) RETURNING id",
    );
    const userId = Number(rows[0]!.id);
    await db.query(
      "INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, room_code) VALUES ($1, $2, $3, $4)",
      [userId, "beat-starvo", 123, "ABCDEF"],
    );
    expect(await listUserAchievements(db, userId)).toEqual([
      { id: "beat-starvo", unlockedAt: 123, roomCode: "ABCDEF" },
    ]);
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
