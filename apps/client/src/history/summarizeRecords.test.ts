import { describe, expect, it } from "vitest";
import type { MatchRecords, MatchSummary } from "@fyendal/protocol";
import { matchOutcome, playedHeroes, recentForm, summarizeRecords, winRate } from "./summarizeRecords.js";

const records: MatchRecords = {
  heroes: [
    { heroId: "LEVIA", opponentKind: "player", format: "cc", games: 6, wins: 4, losses: 1, draws: 0, ended: 1, lastPlayedAt: 300 },
    { heroId: "LEVIA", opponentKind: "bot", format: "cc", games: 3, wins: 2, losses: 1, draws: 0, ended: 0, lastPlayedAt: 200 },
    { heroId: "LEVIA", opponentKind: "bot", format: "silver-age", games: 2, wins: 0, losses: 1, draws: 1, ended: 0, lastPlayedAt: 400 },
    { heroId: "JARL", opponentKind: "player", format: "cc", games: 4, wins: 1, losses: 3, draws: 0, ended: 0, lastPlayedAt: 100 },
  ],
  matchups: [
    { heroId: "LEVIA", opponentHeroId: "JARL", opponentKind: "player", format: "cc", games: 3, wins: 3, losses: 0, draws: 0 },
    { heroId: "LEVIA", opponentHeroId: "JARL", opponentKind: "bot", format: "cc", games: 2, wins: 1, losses: 1, draws: 0 },
    { heroId: "LEVIA", opponentHeroId: "CINDRA", opponentKind: "player", format: "cc", games: 2, wins: 1, losses: 1, draws: 0 },
    { heroId: "LEVIA", opponentHeroId: "BRAVO", opponentKind: "bot", format: "silver-age", games: 2, wins: 0, losses: 1, draws: 1 },
    { heroId: "JARL", opponentHeroId: "LEVIA", opponentKind: "player", format: "cc", games: 4, wins: 1, losses: 3, draws: 0 },
  ],
};

function match(
  overrides: Partial<Pick<MatchSummary, "winner" | "yourSeat" | "endReason">>,
): Pick<MatchSummary, "winner" | "yourSeat" | "endReason"> {
  return { winner: 0, yourSeat: 0, endReason: "lethal", ...overrides };
}

describe("summarizeRecords", () => {
  it("sums every row for the unfiltered view and keeps the player and bot split", () => {
    const summary = summarizeRecords(records);
    expect(summary).toMatchObject({ games: 14, wins: 7, losses: 6, draws: 1, ended: 1 });
    expect(summary.players).toMatchObject({ games: 9, wins: 5, losses: 4 });
    expect(summary.bots).toMatchObject({ games: 5, wins: 2, losses: 2, draws: 1 });
    expect(summary.heroes.map((hero) => hero.heroId)).toEqual(["LEVIA", "JARL"]);
    expect(summary.heroes[0]).toMatchObject({ games: 10, wins: 6, losses: 3, lastPlayedAt: 400 });
    expect(summary.heroes[0]!.matchups).toEqual([
      { opponentHeroId: "JARL", games: 5, wins: 4, losses: 1, draws: 0 },
      { opponentHeroId: "BRAVO", games: 2, wins: 0, losses: 1, draws: 1 },
      { opponentHeroId: "CINDRA", games: 2, wins: 1, losses: 1, draws: 0 },
    ]);
  });

  it("applies format and hero filters everywhere", () => {
    const summary = summarizeRecords(records, { format: "cc", heroId: "LEVIA" });
    expect(summary).toMatchObject({ games: 8, wins: 6, losses: 2, ended: 1 });
    expect(summary.players.games).toBe(5);
    expect(summary.bots.games).toBe(3);
    expect(summary.heroes[0]!.matchups).toEqual([
      { opponentHeroId: "JARL", games: 5, wins: 4, losses: 1, draws: 0 },
      { opponentHeroId: "CINDRA", games: 2, wins: 1, losses: 1, draws: 0 },
    ]);
    expect(summarizeRecords(records, { heroId: "NOBODY" }).heroes).toEqual([]);
  });

  it("excludes draws and ended games from the win rate, and ended games from everything", () => {
    expect(winRate({ wins: 3, losses: 1 })).toBe(0.75);
    expect(winRate({ wins: 0, losses: 0 })).toBeNull();
    expect(playedHeroes(records)).toEqual(["LEVIA", "JARL"]);
    const onlyEnded: MatchRecords = {
      heroes: [
        { heroId: "GHOST", opponentKind: "bot", format: "cc", games: 2, wins: 0, losses: 0, draws: 0, ended: 2, lastPlayedAt: 9 },
        ...records.heroes,
      ],
      matchups: records.matchups,
    };
    expect(playedHeroes(onlyEnded)).toEqual(["LEVIA", "JARL"]);
    expect(summarizeRecords(onlyEnded).heroes.map((hero) => hero.heroId)).toEqual(["LEVIA", "JARL"]);
    expect(summarizeRecords(onlyEnded)).toMatchObject({ games: 14, ended: 3 });
  });

  it("classifies outcomes from the viewer's seat", () => {
    expect(matchOutcome(match({ winner: 1, yourSeat: 1 }))).toBe("win");
    expect(matchOutcome(match({ winner: 1, yourSeat: 0 }))).toBe("loss");
    expect(matchOutcome(match({ winner: null, endReason: "draw" }))).toBe("draw");
    expect(matchOutcome(match({ winner: null, endReason: "ended" }))).toBe("ended");
    expect(matchOutcome(match({ winner: null, endReason: null }))).toBe("ended");
  });

  it("derives form and streak from the loaded page, skipping draws and ended games", () => {
    const page = [
      match({ winner: 0 }), match({ winner: null, endReason: "ended" }), match({ winner: 0 }),
      match({ winner: 1 }), match({ winner: 0 }),
    ] as MatchSummary[];
    expect(recentForm(page, false)).toEqual({
      form: ["win", "ended", "win", "loss", "win"],
      streak: { kind: "win", length: 2, capped: false },
    });
    const losses = Array.from({ length: 12 }, () => match({ winner: 1 })) as MatchSummary[];
    expect(recentForm(losses, true)).toEqual({
      form: Array.from({ length: 10 }, () => "loss"),
      streak: { kind: "loss", length: 12, capped: true },
    });
    expect(recentForm(losses, false).streak).toEqual({ kind: "loss", length: 12, capped: false });
    expect(recentForm([], true)).toEqual({ form: [], streak: null });
  });
});
