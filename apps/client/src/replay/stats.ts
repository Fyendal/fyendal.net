import type { GameStatsView, GameView } from "@fyendal/shared";

/**
 * Per-round match stats. New games use authoritative counters recorded by the
 * engine; legacy replays fall back to resolved combat links.
 *
 * A "turn cycle" is one full round: your turn plus the adjacent opponent turn.
 * Since players alternate, cycle n pairs engine turns 2n-1 and 2n. For each
 * player a cycle tallies:
 *  - threatened:  attack and effect damage before prevention
 *  - blocked:     damage actually blocked against the opponent's links,
 *                 capped at the attack value (over-block is not extra value)
 *  - value:       threatened + blocked
 *  - damageDealt: damage actually dealt to the opposing hero
 */
export interface CycleRow {
  cycle: number;
  attacks: [number, number];
  threatened: [number, number];
  blocked: [number, number];
  damageDealt: [number, number];
}

export interface CycleStats {
  rows: CycleRow[];
  /** Distinct cycles each seat took a turn in. */
  cyclesPlayed: [number, number];
  total: {
    attacks: [number, number];
    threatened: [number, number];
    blocked: [number, number];
    damageDealt: [number, number];
  };
}

/** Engine turns pair up as (1,2), (3,4), … — one pair per cycle. */
const cycleOf = (turn: number): number => Math.ceil(turn / 2);

function totalRows(rows: CycleRow[]) {
  const total = {
    attacks: [0, 0] as [number, number],
    threatened: [0, 0] as [number, number],
    blocked: [0, 0] as [number, number],
    damageDealt: [0, 0] as [number, number],
  };
  for (const row of rows) {
    for (const seat of [0, 1] as const) {
      total.attacks[seat] += row.attacks[seat];
      total.threatened[seat] += row.threatened[seat];
      total.blocked[seat] += row.blocked[seat];
      total.damageDealt[seat] += row.damageDealt[seat];
    }
  }
  return total;
}

function authoritativeStats(gameStats: GameStatsView): CycleStats {
  const byCycle = new Map<number, CycleRow>();
  const active: [Set<number>, Set<number>] = [new Set(), new Set()];
  for (const turn of gameStats.turns) {
    const cycle = cycleOf(turn.turn);
    const activeSeat = turn.activePlayer === 0 ? 0 : 1;
    active[activeSeat].add(cycle);
    const row = byCycle.get(cycle) ?? {
      cycle,
      attacks: [0, 0],
      threatened: [0, 0],
      blocked: [0, 0],
      damageDealt: [0, 0],
    } satisfies CycleRow;
    for (const seat of [0, 1] as const) {
      row.attacks[seat] += turn.attacks[seat];
      row.threatened[seat] += turn.threatened[seat];
      row.blocked[seat] += turn.blocked[seat];
      row.damageDealt[seat] += turn.damageDealt[seat];
    }
    byCycle.set(cycle, row);
  }
  const rows = [...byCycle.values()].sort((a, b) => a.cycle - b.cycle);
  return {
    rows,
    cyclesPlayed: [active[0].size, active[1].size],
    total: totalRows(rows),
  };
}

/**
 * Walk the recorded frames in order and tally resolved chain links. A link is
 * counted the first time it appears resolved. Reconnect resends (identical
 * frames) don't double-count: we track how many resolved links per attacking
 * card instance have been tallied. The tally resets for an instance once it
 * leaves the chain (chain close / next turn), so a weapon attacking again
 * later in the game is counted every time.
 */
export function computeCycleStats(views: GameView[]): CycleStats {
  for (let index = views.length - 1; index >= 0; index--) {
    const gameStats = views[index]?.gameStats;
    if (gameStats) return authoritativeStats(gameStats);
  }

  const seen = new Map<number, number>(); // attacking instanceId -> resolved links tallied
  const byCycle = new Map<number, CycleRow>();
  const active: [Set<number>, Set<number>] = [new Set(), new Set()];

  const rowFor = (cycle: number): CycleRow => {
    let row = byCycle.get(cycle);
    if (!row) {
      row = {
        cycle,
        attacks: [0, 0],
        threatened: [0, 0],
        blocked: [0, 0],
        damageDealt: [0, 0],
      };
      byCycle.set(cycle, row);
    }
    return row;
  };

  for (const view of views) {
    const seat: 0 | 1 = view.activePlayer === 0 ? 0 : 1;
    const cycle = cycleOf(view.turn);
    active[seat].add(cycle);
    rowFor(cycle);

    // instances no longer on the chain start a fresh tally next time
    const onChain = new Set(view.chain.map((l) => l.attackingCard.instanceId));
    for (const id of [...seen.keys()]) {
      if (!onChain.has(id)) seen.delete(id);
    }

    const resolvedCounts = new Map<number, number>();
    for (const link of view.chain) {
      if (!link.resolved) continue;
      const id = link.attackingCard.instanceId;
      resolvedCounts.set(id, (resolvedCounts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of resolvedCounts) {
      const prev = seen.get(id) ?? 0;
      if (count <= prev) continue;
      seen.set(id, count);
      const links = view.chain.filter(
        (l) => l.resolved && l.attackingCard.instanceId === id,
      );
      for (const link of links.slice(prev)) {
        const atk = link.attackingCard.owner === 0 ? 0 : 1;
        const def = atk === 0 ? 1 : 0;
        const row = rowFor(cycleOf(view.turn));
        row.attacks[atk] += 1;
        row.threatened[atk] += link.attackValue;
        row.blocked[def] += Math.min(link.attackValue, link.defenseValue);
        if (!link.targetAllyName) row.damageDealt[atk] += link.damage;
      }
    }
  }

  const rows = [...byCycle.values()].sort((a, b) => a.cycle - b.cycle);
  return {
    rows,
    cyclesPlayed: [active[0].size, active[1].size],
    total: totalRows(rows),
  };
}

/** A player's value for a cycle: what they threatened plus what they blocked. */
export function cycleValue(row: CycleRow, seat: 0 | 1): number {
  return row.threatened[seat] + row.blocked[seat];
}

/** Damage stopped after defense was applied (shields, Ward, Arcane Barrier,
 * Spellvoid, and other prevention). */
export function preventedDamage(row: CycleRow, seat: 0 | 1): number {
  const opponent = seat === 0 ? 1 : 0;
  return Math.max(
    0,
    row.threatened[opponent] - row.blocked[seat] - row.damageDealt[opponent],
  );
}

export function totalPrevented(stats: CycleStats, seat: 0 | 1): number {
  return stats.rows.reduce((sum, row) => sum + preventedDamage(row, seat), 0);
}

/** Average value per turn cycle for a seat, over the cycles they played in. */
export function averageValue(stats: CycleStats, seat: 0 | 1): number {
  const cycles = stats.cyclesPlayed[seat];
  if (cycles === 0) return 0;
  return (stats.total.threatened[seat] + stats.total.blocked[seat]) / cycles;
}

export function averagePerRound(
  stats: CycleStats,
  seat: 0 | 1,
  metric: "threatened" | "blocked" | "damageDealt",
): number {
  const cycles = stats.cyclesPlayed[seat];
  return cycles === 0 ? 0 : stats.total[metric][seat] / cycles;
}

export function averageThreatPerAttack(stats: CycleStats, seat: 0 | 1): number {
  const attacks = stats.total.attacks[seat];
  return attacks === 0 ? 0 : stats.total.threatened[seat] / attacks;
}
