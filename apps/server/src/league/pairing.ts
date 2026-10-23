import type { LeaguePairingNote } from "@fyendal/shared";
import { intersectIntervals, MINUTE_MS, type Interval, usableMinutes } from "./availability.js";

/** Exact matching is exponential in vertices; leagues cap at 20 players, so
 * an odd field plus the bye vertex still fits. */
export const MAX_PAIRING_VERTICES = 20;

export const AVAILABILITY_WEIGHT = 4;
export const RECORD_WEIGHT = 4;
export const REMATCH_COST = 10;
export const NO_OVERLAP_COST = 6;
export const BYE_REPEAT_COST = 1_000;
export const BYE_AVAILABILITY_COST = 10;
export const BYE_SCORE_COST = 1;
/** Pairs already used this week; a matching only picks one when nothing else
 * remains, and that edge is then dropped rather than played twice. */
const WEEK_REPEAT_COST = 1_000_000;
const JITTER = 1e-6;

export interface PairingMember {
  memberId: number;
  points: number;
  /** Completed season matches, byes included. */
  matches: number;
  byes: number;
  /** Merged UTC intervals for the week being paired. */
  availability: readonly Interval[];
}

export interface PairingInput {
  week: number;
  seasonWeeks: number;
  matchesPerWeek: number;
  matchMinutes: number;
  /** Active members only. */
  members: readonly PairingMember[];
  /** Earlier season meetings, one entry per match. */
  priorPairs: ReadonlyArray<readonly [number, number]>;
  seed: string;
}

export interface PairedMatch {
  a: number;
  b: number;
  note: LeaguePairingNote;
}

export interface WeekPairing {
  matches: PairedMatch[];
  byes: number[];
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic tie-break in [0, 1) for a seed and key. */
export function seededFraction(seed: string, key: string): number {
  return fnv1a(`${seed}\u0000${key}`) / 2 ** 32;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function pointsPerMatch(member: Pick<PairingMember, "points" | "matches">): number {
  return member.matches ? member.points / member.matches : 0;
}

/** Record weight rises linearly from 0 in week 1 to `RECORD_WEIGHT` in the last week. */
export function recordWeight(week: number, seasonWeeks: number): number {
  return seasonWeeks <= 1 ? 0 : RECORD_WEIGHT * (week - 1) / (seasonWeeks - 1);
}

export function pairCost(
  a: PairingMember,
  b: PairingMember,
  input: Pick<PairingInput, "week" | "seasonWeeks" | "matchesPerWeek" | "matchMinutes">,
  rematches: number,
): LeaguePairingNote {
  const overlapMinutes = usableMinutes(intersectIntervals(a.availability, b.availability), input.matchMinutes);
  const wanted = 2 * input.matchesPerWeek * input.matchMinutes;
  const scoreGap = Math.abs(pointsPerMatch(a) - pointsPerMatch(b));
  const cost = AVAILABILITY_WEIGHT * (1 - Math.min(1, overlapMinutes / wanted))
    + recordWeight(input.week, input.seasonWeeks) * scoreGap / 3
    + REMATCH_COST * rematches
    + (overlapMinutes < input.matchMinutes ? NO_OVERLAP_COST : 0);
  return { overlapMinutes, scoreGap, rematches, cost: Math.round(cost * 1000) / 1000 };
}

/** Fewest earlier byes dominates, then least availability, then lowest score. */
export function byeCost(member: PairingMember, matchesPerWeek: number, matchMinutes: number): number {
  const available = usableMinutes(member.availability, matchMinutes);
  return BYE_REPEAT_COST * member.byes
    + BYE_AVAILABILITY_COST * Math.min(1, available / (4 * matchesPerWeek * matchMinutes))
    + BYE_SCORE_COST * pointsPerMatch(member) / 3;
}

/** Exact minimum-cost perfect matching on an even vertex count by subset DP.
 * Returns each vertex's partner. */
export function minCostPerfectMatching(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  if (n % 2 !== 0) throw new Error("perfect matching needs an even vertex count");
  if (n > MAX_PAIRING_VERTICES) throw new Error(`pairing supports at most ${MAX_PAIRING_VERTICES} vertices`);
  const size = 1 << n;
  const best = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const partner = new Int8Array(size);
  best[0] = 0;
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    const rest = mask ^ low;
    // Odd subsets have no perfect matching.
    if (rest === 0) continue;
    const i = 31 - Math.clz32(low);
    const row = cost[i]!;
    let value = Number.POSITIVE_INFINITY;
    let choice = -1;
    for (let others = rest; others; others &= others - 1) {
      const bit = others & -others;
      const candidate = best[rest ^ bit]! + row[31 - Math.clz32(bit)]!;
      if (candidate < value) {
        value = candidate;
        choice = 31 - Math.clz32(bit);
      }
    }
    best[mask] = value;
    partner[mask] = choice;
  }
  const matched = new Array<number>(n).fill(-1);
  for (let mask = size - 1; mask; ) {
    const i = 31 - Math.clz32(mask & -mask);
    const j = partner[mask]!;
    matched[i] = j;
    matched[j] = i;
    mask &= ~((1 << i) | (1 << j));
  }
  return matched;
}

/** One week's season pairings: `matchesPerWeek` successive matchings, each
 * excluding pairs already used that week. An odd field adds a bye vertex. */
export function pairWeek(input: PairingInput): WeekPairing {
  const members = [...input.members].sort((a, b) => a.memberId - b.memberId);
  if (members.length < 2) return { matches: [], byes: members.map((member) => member.memberId) };
  const hasBye = members.length % 2 === 1;
  const vertices = members.length + (hasBye ? 1 : 0);
  const priorCounts = new Map<string, number>();
  for (const [a, b] of input.priorPairs) {
    const key = pairKey(a, b);
    priorCounts.set(key, (priorCounts.get(key) ?? 0) + 1);
  }
  const notes = members.map((a) => members.map((b) =>
    a === b ? null : pairCost(a, b, input, priorCounts.get(pairKey(a.memberId, b.memberId)) ?? 0)));
  const byeCosts = members.map((member) => byeCost(member, input.matchesPerWeek, input.matchMinutes));
  const usedThisWeek = new Set<string>();
  const byesThisWeek = new Set<number>();
  const result: WeekPairing = { matches: [], byes: [] };
  const passes = Math.min(input.matchesPerWeek, members.length - 1);
  for (let pass = 0; pass < passes; pass++) {
    const jitter = (i: number, j: number) =>
      JITTER * seededFraction(input.seed, `${input.week}:${pass}:${i}:${j}`);
    const cost = Array.from({ length: vertices }, (_, i) => Array.from({ length: vertices }, (_, j) => {
      if (i === j) return 0;
      if (i === members.length || j === members.length) {
        const member = members[i === members.length ? j : i]!;
        const base = byesThisWeek.has(member.memberId) ? WEEK_REPEAT_COST : byeCosts[members.indexOf(member)]!;
        return base + jitter(member.memberId, 0);
      }
      const [lo, hi] = i < j ? [i, j] : [j, i];
      const a = members[lo]!.memberId;
      const b = members[hi]!.memberId;
      const base = usedThisWeek.has(pairKey(a, b)) ? WEEK_REPEAT_COST : notes[lo]![hi]!.cost;
      return base + jitter(a, b);
    }));
    const matched = minCostPerfectMatching(cost);
    for (let i = 0; i < members.length; i++) {
      const j = matched[i]!;
      const a = members[i]!.memberId;
      if (j === members.length) {
        if (!byesThisWeek.has(a)) {
          byesThisWeek.add(a);
          result.byes.push(a);
        }
        continue;
      }
      if (j < i) continue;
      const b = members[j]!.memberId;
      if (usedThisWeek.has(pairKey(a, b))) continue;
      usedThisWeek.add(pairKey(a, b));
      result.matches.push({ a, b, note: notes[i]![j]! });
    }
  }
  return result;
}

/** Earliest non-conflicting start for each match inside its pair's overlap,
 * aligned to quarter hours so half-hour-offset zones still land on the grid.
 * Matches with the least overlap pick first; null means no slot fits. */
export function suggestSlots(
  matches: ReadonlyArray<{ a: number; b: number }>,
  availability: ReadonlyMap<number, readonly Interval[]>,
  matchMinutes: number,
  notBefore: number,
  bufferMinutes = 30,
): Array<number | null> {
  const step = 15 * MINUTE_MS;
  const length = matchMinutes * MINUTE_MS;
  const buffer = bufferMinutes * MINUTE_MS;
  const overlaps = matches.map(({ a, b }) =>
    intersectIntervals(availability.get(a) ?? [], availability.get(b) ?? []));
  const order = matches.map((_, index) => index).sort((x, y) =>
    usableMinutes(overlaps[x]!, matchMinutes) - usableMinutes(overlaps[y]!, matchMinutes) || x - y);
  const booked = new Map<number, number[]>();
  const clashes = (memberId: number, start: number) => (booked.get(memberId) ?? [])
    .some((other) => start < other + length + buffer && other < start + length + buffer);
  const slots: Array<number | null> = matches.map(() => null);
  for (const index of order) {
    const { a, b } = matches[index]!;
    search: for (const interval of overlaps[index]!) {
      const first = Math.ceil(Math.max(interval.start, notBefore) / step) * step;
      for (let start = first; start + length <= interval.end; start += step) {
        if (clashes(a, start) || clashes(b, start)) continue;
        slots[index] = start;
        for (const memberId of [a, b]) booked.set(memberId, [...(booked.get(memberId) ?? []), start]);
        break search;
      }
    }
  }
  return slots;
}
