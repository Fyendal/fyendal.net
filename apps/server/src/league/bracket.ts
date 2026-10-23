import type { LeagueMatchResult, LeagueMatchStatus, LeaguePlayoffStage } from "@fyendal/shared";

export type PlayoffSize = 2 | 4 | 8;

/** Largest bracket no bigger than the configured size that the active field fills. */
export function playoffFieldSize(configured: PlayoffSize, activeMembers: number): 0 | PlayoffSize {
  for (const size of [8, 4, 2] as const) {
    if (size <= configured && size <= activeMembers) return size;
  }
  return 0;
}

export function playoffStages(size: PlayoffSize): LeaguePlayoffStage[] {
  return (["quarterfinal", "semifinal", "final"] as const).slice(3 - Math.log2(size));
}

/** Seeds in bracket order, so slot `s` plays `order[2s]` against `order[2s + 1]`
 * and the top two seeds can only meet in the final. */
export function seedOrder(size: PlayoffSize): number[] {
  let order = [1];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, total - seed]);
  }
  return order;
}

export interface PlayoffPairing {
  stage: LeaguePlayoffStage;
  slot: number;
  /** The better seed. */
  a: number;
  b: number;
}

/** `ranked` lists active member ids best first. */
export function openingRound(ranked: readonly number[], size: PlayoffSize): PlayoffPairing[] {
  if (ranked.length < size) throw new Error("not enough members for the playoff field");
  const order = seedOrder(size);
  const stage = playoffStages(size)[0]!;
  return Array.from({ length: size / 2 }, (_, slot) => ({
    stage,
    slot,
    a: ranked[order[2 * slot]! - 1]!,
    b: ranked[order[2 * slot + 1]! - 1]!,
  }));
}

export interface PlayoffMatch extends PlayoffPairing {
  status: LeagueMatchStatus;
  result: LeagueMatchResult | null;
  winner: number | null;
}

/** Who advances from a completed match; a double forfeit advances the better
 * seed. Draws and voided matches advance nobody and are replayed. */
export function playoffAdvancer(match: PlayoffMatch): number | null {
  if (match.status !== "complete") return null;
  if (match.result === "double-forfeit") return match.a;
  return match.result === "draw" ? null : match.winner;
}

function slotAdvancer(matches: readonly PlayoffMatch[], stage: LeaguePlayoffStage, slot: number): number | null {
  for (const match of matches) {
    if (match.stage !== stage || match.slot !== slot) continue;
    const advancer = playoffAdvancer(match);
    if (advancer !== null) return advancer;
  }
  return null;
}

/** Matches that should exist and don't: a replay for every slot whose
 * matches all ended without an advancer, and each later-round slot whose two
 * feeders have advancers. Idempotent against the matches already created. */
export function pendingPlayoffPairings(
  size: PlayoffSize,
  matches: readonly PlayoffMatch[],
  seeds: ReadonlyMap<number, number>,
): PlayoffPairing[] {
  const stages = playoffStages(size);
  const pending: PlayoffPairing[] = [];
  const seedOf = (memberId: number) => {
    const seed = seeds.get(memberId);
    if (seed === undefined) throw new Error(`playoff member ${memberId} has no seed`);
    return seed;
  };
  stages.forEach((stage, round) => {
    const slots = size / 2 ** (round + 1);
    for (let slot = 0; slot < slots; slot++) {
      const existing = matches.filter((match) => match.stage === stage && match.slot === slot);
      if (existing.length) {
        if (existing.every((match) => match.status === "complete" || match.status === "cancelled")
          && slotAdvancer(existing, stage, slot) === null) {
          const { a, b } = existing.at(-1)!;
          pending.push({ stage, slot, a, b });
        }
        continue;
      }
      if (round === 0) continue;
      const previous = stages[round - 1]!;
      const left = slotAdvancer(matches, previous, 2 * slot);
      const right = slotAdvancer(matches, previous, 2 * slot + 1);
      if (left === null || right === null) continue;
      const [a, b] = seedOf(left) < seedOf(right) ? [left, right] : [right, left];
      pending.push({ stage, slot, a, b });
    }
  });
  return pending;
}

export function playoffChampion(matches: readonly PlayoffMatch[]): number | null {
  return slotAdvancer(matches, "final", 0);
}
