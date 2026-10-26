import { describe, expect, it } from "vitest";
import { computeStandings, type StandingMatch } from "../league/standings.js";

const members = (...ids: number[]) => ids.map((memberId) => ({ memberId, dropped: false }));
const win = (winner: number, loser: number, result: StandingMatch["result"] = "played"): StandingMatch =>
  ({ a: winner, b: loser, result, winner });

describe("league standings", () => {
  it("scores wins, draws, byes, and forfeits", () => {
    const rows = computeStandings(members(1, 2, 3), [
      win(1, 2),
      { a: 2, b: 3, result: "draw", winner: null },
      { a: 3, b: null, result: "bye", winner: 3 },
      win(3, 1, "forfeit"),
      { a: 1, b: 2, result: "double-forfeit", winner: null },
    ], "seed");
    const byId = new Map(rows.map((row) => [row.memberId, row]));
    expect(byId.get(1)).toMatchObject({ points: 3, wins: 1, losses: 2, forfeitLosses: 2, matches: 3 });
    expect(byId.get(2)).toMatchObject({ points: 1, wins: 0, losses: 2, draws: 1, forfeitLosses: 1 });
    expect(byId.get(3)).toMatchObject({ points: 7, wins: 1, draws: 1, byes: 1, matches: 3, rank: 1 });
    expect(byId.get(3)!.matchWinRate).toBeCloseTo(7 / 9);
  });

  it("breaks point ties by floored opponents' match-win rate", () => {
    const rows = computeStandings(members(1, 2, 3, 4), [win(1, 3), win(2, 4), win(3, 4)], "seed");
    // All of 1-3 have 3 points. 4 is winless and counts as 1/3 for its opponents.
    expect(rows.map((row) => [row.memberId, row.points])).toEqual([[3, 3], [1, 3], [2, 3], [4, 0]]);
    expect(rows.map((row) => row.opponentMatchWinRate)).toEqual([2 / 3, 1 / 2, 1 / 3, 3 / 4]);
  });

  it("settles a two-way tie by head-to-head whatever the seed", () => {
    // X=1 and Y=2 both finish 1-1 against Y/X and Z=3, so points and OMW match.
    const matches = [win(2, 1), win(1, 3), win(3, 2), win(3, 4)];
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const rows = computeStandings(members(1, 2, 3, 4), matches, seed);
      expect(rows.map((row) => row.memberId)).toEqual([3, 2, 1, 4]);
      expect(rows[1]!.opponentMatchWinRate).toBeCloseTo(7 / 12);
      expect(rows[2]!.opponentMatchWinRate).toBeCloseTo(7 / 12);
    }
  });

  it("leaves a three-way cycle to the later tiebreakers", () => {
    const orders = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) =>
      computeStandings(members(1, 2, 3), [win(1, 2), win(2, 3), win(3, 1)], seed)
        .map((row) => row.memberId).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("falls back to fewer forfeit losses, then a stable seeded draw", () => {
    const rows = computeStandings(members(1, 2, 3, 4), [win(1, 3, "forfeit"), win(2, 4)], "seed");
    expect(rows.slice(2).map((row) => row.memberId)).toEqual([4, 3]);
    const again = computeStandings(members(1, 2, 3, 4), [win(1, 3, "forfeit"), win(2, 4)], "seed");
    expect(again).toEqual(rows);
  });

  it("keeps dropped members in the table", () => {
    const rows = computeStandings([{ memberId: 1, dropped: true }, { memberId: 2, dropped: false }], [win(1, 2)], "seed");
    expect(rows[0]).toMatchObject({ memberId: 1, dropped: true, rank: 1 });
  });

  it("rejects inconsistent results", () => {
    expect(() => computeStandings(members(1, 2), [{ a: 1, b: 2, result: "played", winner: null }], "s")).toThrow();
    expect(() => computeStandings(members(1, 2), [{ a: 1, b: 2, result: "played", winner: 3 }], "s")).toThrow();
    expect(() => computeStandings(members(1), [win(1, 9)], "s")).toThrow();
  });
});
