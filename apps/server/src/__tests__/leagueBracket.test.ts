import { describe, expect, it } from "vitest";
import {
  openingRound,
  pendingPlayoffPairings,
  type PlayoffMatch,
  playoffChampion,
  playoffFieldSize,
  playoffStages,
  seedOrder,
} from "../league/bracket.js";

const ranked = [11, 12, 13, 14, 15, 16, 17, 18];
const seeds = new Map(ranked.map((id, index) => [id, index + 1]));

function complete(pairing: Omit<PlayoffMatch, "status" | "result" | "winner">, winner: number | null, result: PlayoffMatch["result"] = "played"): PlayoffMatch {
  return { ...pairing, status: "complete", result, winner };
}

describe("league playoffs", () => {
  it("sizes the field to the active members", () => {
    expect(playoffFieldSize(8, 12)).toBe(8);
    expect(playoffFieldSize(8, 7)).toBe(4);
    expect(playoffFieldSize(4, 20)).toBe(4);
    expect(playoffFieldSize(8, 3)).toBe(2);
    expect(playoffFieldSize(8, 1)).toBe(0);
    expect(playoffStages(8)).toEqual(["quarterfinal", "semifinal", "final"]);
    expect(playoffStages(2)).toEqual(["final"]);
  });

  it("seeds 1v8, 4v5, 2v7, 3v6", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(openingRound(ranked, 8).map(({ slot, a, b }) => [slot, a, b]))
      .toEqual([[0, 11, 18], [1, 14, 15], [2, 12, 17], [3, 13, 16]]);
    expect(openingRound(ranked.slice(0, 4), 4).map(({ stage, a, b }) => [stage, a, b]))
      .toEqual([["semifinal", 11, 14], ["semifinal", 12, 13]]);
    expect(() => openingRound(ranked.slice(0, 3), 4)).toThrow();
  });

  it("creates a semifinal as soon as both feeders finish, better seed first", () => {
    const [qf0, qf1, qf2] = openingRound(ranked, 8);
    const matches = [complete(qf0!, 18), complete(qf1!, 14), { ...qf2!, status: "scheduled" as const, result: null, winner: null }];
    expect(pendingPlayoffPairings(8, matches, seeds)).toEqual([{ stage: "semifinal", slot: 0, a: 14, b: 18 }]);
    const created = [...matches, { stage: "semifinal" as const, slot: 0, a: 14, b: 18, status: "unscheduled" as const, result: null, winner: null }];
    expect(pendingPlayoffPairings(8, created, seeds)).toEqual([]);
  });

  it("replays draws and voided matches, and advances the better seed on a double forfeit", () => {
    const [sf0, sf1] = openingRound(ranked.slice(0, 4), 4);
    const drawn = [complete(sf0!, null, "draw"), { ...sf1!, status: "cancelled" as const, result: null, winner: null }];
    expect(pendingPlayoffPairings(4, drawn, seeds)).toEqual([
      { stage: "semifinal", slot: 0, a: 11, b: 14 },
      { stage: "semifinal", slot: 1, a: 12, b: 13 },
    ]);
    const settled = [...drawn, complete(sf0!, 14, "forfeit"), complete(sf1!, null, "double-forfeit")];
    expect(pendingPlayoffPairings(4, settled, seeds)).toEqual([{ stage: "final", slot: 0, a: 12, b: 14 }]);
  });

  it("crowns the final's winner", () => {
    const final = { stage: "final" as const, slot: 0, a: 11, b: 12 };
    expect(playoffChampion([{ ...final, status: "in-room", result: null, winner: null }])).toBeNull();
    expect(playoffChampion([complete(final, null, "draw"), complete(final, 12)])).toBe(12);
  });
});
