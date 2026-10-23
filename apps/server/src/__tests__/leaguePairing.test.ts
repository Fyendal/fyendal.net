import { describe, expect, it } from "vitest";
import { type Interval, WEEK_MS } from "../league/availability.js";
import {
  minCostPerfectMatching,
  pairWeek,
  type PairingInput,
  type PairingMember,
  seededFraction,
  suggestSlots,
} from "../league/pairing.js";

const HOUR = 3_600_000;
const WEEK_START = Date.UTC(2026, 4, 4);
const allWeek: Interval[] = [{ start: WEEK_START, end: WEEK_START + WEEK_MS }];

function member(memberId: number, overrides: Partial<PairingMember> = {}): PairingMember {
  return { memberId, points: 0, matches: 0, byes: 0, availability: allWeek, ...overrides };
}

function input(members: PairingMember[], overrides: Partial<PairingInput> = {}): PairingInput {
  return {
    week: 1, seasonWeeks: 4, matchesPerWeek: 1, matchMinutes: 60,
    members, priorPairs: [], seed: "seed", ...overrides,
  };
}

const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function bruteForce(cost: number[][]): number {
  const solve = (remaining: number[]): number => {
    if (!remaining.length) return 0;
    const [first, ...rest] = remaining;
    return Math.min(...rest.map((other) =>
      cost[first!]![other]! + solve(rest.filter((candidate) => candidate !== other))));
  };
  return solve(cost.map((_, index) => index));
}

describe("league pairing", () => {
  it("finds the exact minimum-cost perfect matching", () => {
    for (let trial = 0; trial < 40; trial++) {
      const n = 2 + 2 * (trial % 4);
      const cost = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          cost[i]![j] = cost[j]![i] = Math.floor(seededFraction(`t${trial}`, `${i}:${j}`) * 100);
        }
      }
      const matched = minCostPerfectMatching(cost);
      let total = 0;
      matched.forEach((partner, index) => {
        expect(matched[partner]).toBe(index);
        if (index < partner) total += cost[index]![partner]!;
      });
      expect(total).toBe(bruteForce(cost));
    }
    expect(() => minCostPerfectMatching([[0]])).toThrow();
  });

  it("gives every member K distinct opponents in an even field", () => {
    const result = pairWeek(input([1, 2, 3, 4, 5, 6, 7, 8].map((id) => member(id)), { matchesPerWeek: 3 }));
    expect(result.byes).toEqual([]);
    expect(result.matches).toHaveLength(12);
    expect(new Set(result.matches.map(({ a, b }) => key(a, b))).size).toBe(12);
    for (let id = 1; id <= 8; id++) {
      expect(result.matches.filter(({ a, b }) => a === id || b === id)).toHaveLength(3);
    }
  });

  it("gives one distinct bye per pass in an odd field", () => {
    const result = pairWeek(input([1, 2, 3, 4, 5, 6, 7].map((id) => member(id)), { matchesPerWeek: 2 }));
    expect(result.byes).toHaveLength(2);
    expect(new Set(result.byes).size).toBe(2);
    expect(result.matches).toHaveLength(6);
    for (const id of result.byes) {
      expect(result.matches.filter(({ a, b }) => a === id || b === id)).toHaveLength(1);
    }
  });

  it("gives the bye to the member with fewest byes, then least availability", () => {
    const fewest = pairWeek(input([member(1, { byes: 1 }), member(2), member(3, { byes: 1 })]));
    expect(fewest.byes).toEqual([2]);
    const evenings: Interval[] = [{ start: WEEK_START + 18 * HOUR, end: WEEK_START + 21 * HOUR }];
    const leastAvailable = pairWeek(input([member(1), member(2, { availability: evenings }), member(3)]));
    expect(leastAvailable.byes).toEqual([2]);
  });

  it("pairs members who share availability", () => {
    const europe: Interval[] = [{ start: WEEK_START + 18 * HOUR, end: WEEK_START + 22 * HOUR }];
    const america: Interval[] = [{ start: WEEK_START + 26 * HOUR, end: WEEK_START + 30 * HOUR }];
    const result = pairWeek(input([
      member(1, { availability: europe }), member(2, { availability: america }),
      member(3, { availability: europe }), member(4, { availability: america }),
    ]));
    expect(result.matches.map(({ a, b }) => key(a, b)).sort()).toEqual(["1:3", "2:4"]);
    expect(result.matches[0]!.note.overlapMinutes).toBe(240);
  });

  it("pairs by record once the season is under way", () => {
    const members = [
      member(1, { points: 9, matches: 3 }), member(2, { points: 0, matches: 3 }),
      member(3, { points: 9, matches: 3 }), member(4, { points: 0, matches: 3 }),
    ];
    for (const seed of ["a", "b", "c", "d"]) {
      const result = pairWeek(input(members, { week: 4, seed }));
      expect(result.matches.map(({ a, b }) => key(a, b)).sort()).toEqual(["1:3", "2:4"]);
    }
  });

  it("avoids rematches for a whole season when the field allows it", () => {
    const members = new Map([1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, member(id)]));
    const prior: Array<[number, number]> = [];
    for (let week = 1; week <= 4; week++) {
      const result = pairWeek(input([...members.values()], { week, priorPairs: prior, seed: "season" }));
      expect(result.matches).toHaveLength(4);
      for (const match of result.matches) {
        expect(match.note.rematches).toBe(0);
        prior.push([match.a, match.b]);
        const winner = seededFraction("results", `${week}:${match.a}`) < 0.5 ? match.a : match.b;
        for (const id of [match.a, match.b]) {
          const row = members.get(id)!;
          members.set(id, { ...row, matches: row.matches + 1, points: row.points + (id === winner ? 3 : 0) });
        }
      }
    }
    expect(new Set(prior.map(([a, b]) => key(a, b))).size).toBe(16);
  });

  it("is deterministic for a seed", () => {
    const members = [1, 2, 3, 4, 5, 6].map((id) => member(id));
    expect(pairWeek(input(members, { seed: "x" }))).toEqual(pairWeek(input(members, { seed: "x" })));
  });

  it("handles tiny fields", () => {
    expect(pairWeek(input([member(1)]))).toEqual({ matches: [], byes: [1] });
    const two = pairWeek(input([member(1), member(2)], { matchesPerWeek: 3 }));
    expect(two.matches.map(({ a, b }) => [a, b])).toEqual([[1, 2]]);
  });

  it("supports the largest field", () => {
    const result = pairWeek(input(Array.from({ length: 19 }, (_, index) => member(index + 1)), { matchesPerWeek: 2 }));
    expect(result.matches).toHaveLength(18);
    expect(result.byes).toHaveLength(2);
  });
});

describe("league slot suggestions", () => {
  const saturday: Interval[] = [{ start: WEEK_START + 18 * HOUR, end: WEEK_START + 22 * HOUR }];
  const availability = new Map<number, Interval[]>([[1, saturday], [2, saturday], [3, saturday], [4, []]]);

  it("spaces a member's matches by the buffer", () => {
    expect(suggestSlots([{ a: 1, b: 2 }, { a: 1, b: 3 }], availability, 60, 0))
      .toEqual([WEEK_START + 18 * HOUR, WEEK_START + 19.5 * HOUR]);
  });

  it("starts no earlier than allowed, on a quarter hour", () => {
    expect(suggestSlots([{ a: 1, b: 2 }], availability, 60, WEEK_START + 18 * HOUR + 1))
      .toEqual([WEEK_START + 18.25 * HOUR]);
  });

  it("returns null when no slot fits", () => {
    expect(suggestSlots([{ a: 1, b: 4 }], availability, 60, 0)).toEqual([null]);
    expect(suggestSlots([{ a: 1, b: 2 }, { a: 1, b: 3 }, { a: 2, b: 3 }], availability, 90, 0))
      .toEqual([WEEK_START + 18 * HOUR, WEEK_START + 20 * HOUR, null]);
  });
});
