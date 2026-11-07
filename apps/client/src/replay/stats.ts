import type { GameTurnStatsView, GameView } from "@fyendal/shared";

/**
 * Per-round match stats. New games use authoritative counters recorded by the
 * engine; legacy replays fall back to resolved combat links.
 *
 * A round is one hand cycle for a seat: the opponent's turn it defended on,
 * then its own turn, so blocks pair with the attack the same hand made.
 * Engine turn 1 is FaB's opening turn, round 0 for the seat that took it; the
 * other seat's round 1 starts by defending it. Rounds are indexed per seat,
 * so one row holds both seats' round n. For each seat a round tallies:
 *  - threatened:  attack and effect damage aimed at the opposing hero before prevention
 *  - blocked:     damage actually blocked against the opponent's links,
 *                 capped at the attack value (over-block is not extra value)
 *  - prevented:   damage stopped after defense (shields, Ward, Arcane Barrier, …)
 *  - damageDealt: damage actually dealt to the opposing hero
 *  - allyAbsorbed: damage dealt by the opponent to your allies
 *  - cardsDisrupted: opponent cards this seat destroyed, discarded, or banished
 *  - value:       threatened + blocked + prevented + life gained - life lost,
 *                 plus `DISRUPTION_VALUE_PER_CARD` per card when opted in
 */
export interface CycleRow {
  cycle: number;
  attacks: [number, number];
  threatened: [number, number];
  blocked: [number, number];
  damageDealt: [number, number];
  allyAbsorbed: [number, number];
  prevented: [number, number];
  lifeGained: [number, number];
  lifeLost: [number, number];
  cardsDisrupted: [number, number];
}

export type CycleTotals = Omit<CycleRow, "cycle">;
type CycleMetric = keyof CycleTotals;

export interface CycleStats {
  rows: CycleRow[];
  /** Rounds each seat took part in, ascending; round 0 is the opening seat's only. */
  rounds: [number[], number[]];
  /** Rounds in which each seat took its turn. A final blocks-only round is
   * shown and totalled but left out of per-turn averages. */
  played: [number[], number[]];
  /** Post-opening rounds each seat took a turn in. */
  cyclesPlayed: [number, number];
  total: CycleTotals;
}

/** Talishar's flat value for each opponent card taken away. */
export const DISRUPTION_VALUE_PER_CARD = 3;

const METRICS: readonly CycleMetric[] = [
  "attacks", "threatened", "blocked", "damageDealt", "allyAbsorbed", "prevented",
  "lifeGained", "lifeLost", "cardsDisrupted",
];

function emptyTotals(): CycleTotals {
  return {
    attacks: [0, 0],
    threatened: [0, 0],
    blocked: [0, 0],
    damageDealt: [0, 0],
    allyAbsorbed: [0, 0],
    prevented: [0, 0],
    lifeGained: [0, 0],
    lifeLost: [0, 0],
    cardsDisrupted: [0, 0],
  };
}

function emptyRow(cycle: number): CycleRow {
  return { cycle, ...emptyTotals() };
}

function totalRows(rows: CycleRow[]): CycleTotals {
  const total = emptyTotals();
  for (const row of rows) {
    for (const metric of METRICS) {
      total[metric][0] += row[metric][0];
      total[metric][1] += row[metric][1];
    }
  }
  return total;
}

/** Assign each engine turn to both seats' hand cycles: the active seat's own
 * round, and the round the defender is starting by blocking. */
function fromTurnRecords(turns: readonly GameTurnStatsView[]): CycleStats {
  const byCycle = new Map<number, CycleRow>();
  const rounds: [Set<number>, Set<number>] = [new Set(), new Set()];
  const played: [Set<number>, Set<number>] = [new Set(), new Set()];
  const ownTurns: [number, number] = [0, 0];
  const openingSeat = (turns.find((turn) => turn.turn >= 1) ?? turns[0])?.activePlayer === 1 ? 1 : 0;
  const rowFor = (cycle: number): CycleRow => {
    let row = byCycle.get(cycle);
    if (!row) {
      row = emptyRow(cycle);
      byCycle.set(cycle, row);
    }
    return row;
  };
  for (const turn of turns) {
    const active: 0 | 1 = turn.activePlayer === 1 ? 1 : 0;
    // legacy turn 0 (pre-game effects) joins the opening turn
    if (turn.turn !== 0) ownTurns[active] += 1;
    const roundOf = (seat: 0 | 1): number => {
      const upcoming = seat === active ? ownTurns[seat] : ownTurns[seat] + 1;
      return Math.max(0, upcoming - (seat === openingSeat ? 1 : 0));
    };
    for (const seat of [0, 1] as const) {
      const opponent = seat === 0 ? 1 : 0;
      const round = roundOf(seat);
      rounds[seat].add(round);
      if (seat === active) played[seat].add(round);
      const row = rowFor(round);
      row.attacks[seat] += turn.attacks[seat];
      row.threatened[seat] += turn.threatened[seat];
      row.blocked[seat] += turn.blocked[seat];
      row.damageDealt[seat] += turn.damageDealt[seat];
      row.allyAbsorbed[seat] += turn.allyAbsorbed?.[seat] ?? 0;
      row.prevented[seat] += Math.max(
        0,
        turn.threatened[opponent] - turn.blocked[seat] - turn.damageDealt[opponent],
      );
      row.lifeGained[seat] += turn.lifeGained?.[seat] ?? 0;
      row.lifeLost[seat] += turn.lifeLost?.[seat] ?? 0;
      row.cardsDisrupted[seat] += turn.cardsDisrupted?.[seat] ?? 0;
    }
  }
  const rows = [...byCycle.values()].sort((a, b) => a.cycle - b.cycle);
  const ascending = (sets: [Set<number>, Set<number>]): [number[], number[]] =>
    [[...sets[0]].sort((a, b) => a - b), [...sets[1]].sort((a, b) => a - b)];
  const playedRounds = ascending(played);
  return {
    rows,
    rounds: ascending(rounds),
    played: playedRounds,
    cyclesPlayed: [
      playedRounds[0].filter((round) => round > 0).length,
      playedRounds[1].filter((round) => round > 0).length,
    ],
    total: totalRows(rows),
  };
}

/**
 * Rebuild per-turn counters from recorded frames by tallying resolved chain
 * links. A link is counted the first time it appears resolved. Reconnect
 * resends (identical frames) don't double-count: we track how many resolved
 * links per attacking card instance have been tallied. The tally resets for
 * an instance once it leaves the chain (chain close / next turn), so a weapon
 * attacking again later in the game is counted every time.
 */
function legacyTurnRecords(views: GameView[]): GameTurnStatsView[] {
  const seen = new Map<number, number>(); // attacking instanceId -> resolved links tallied
  const byTurn = new Map<number, GameTurnStatsView>();
  const recordFor = (view: GameView): GameTurnStatsView => {
    let record = byTurn.get(view.turn);
    if (!record) {
      record = {
        turn: view.turn,
        activePlayer: view.activePlayer,
        attacks: [0, 0],
        threatened: [0, 0],
        blocked: [0, 0],
        damageDealt: [0, 0],
        allyAbsorbed: [0, 0],
      };
      byTurn.set(view.turn, record);
    }
    return record;
  };

  for (const view of views) {
    const record = recordFor(view);

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
        if (link.targetAllyName) {
          record.allyAbsorbed![def] += link.damage;
          continue;
        }
        record.attacks[atk] += 1;
        record.threatened[atk] += link.attackValue;
        record.blocked[def] += Math.min(link.attackValue, link.defenseValue);
        record.damageDealt[atk] += link.damage;
      }
    }
  }
  return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
}

export function computeCycleStats(views: GameView[]): CycleStats {
  for (let index = views.length - 1; index >= 0; index--) {
    const gameStats = views[index]?.gameStats;
    if (gameStats) return fromTurnRecords(gameStats.turns);
  }
  return fromTurnRecords(legacyTurnRecords(views));
}

/** The rows a seat took part in, for its own breakdown table. */
export function rowsFor(stats: CycleStats, seat: 0 | 1): CycleRow[] {
  const rounds = new Set(stats.rounds[seat]);
  return stats.rows.filter((row) => rounds.has(row.cycle));
}

/** Talishar-style value: threat + blocks + prevention + life gain - life loss,
 * plus an opt-in flat value per opponent card disrupted. */
export function cycleValue(row: CycleRow, seat: 0 | 1, disruptionValue = 0): number {
  return row.threatened[seat] + row.blocked[seat] + row.prevented[seat]
    + row.lifeGained[seat] - row.lifeLost[seat]
    + disruptionValue * row.cardsDisrupted[seat];
}

export function totalValue(stats: CycleStats, seat: 0 | 1, disruptionValue = 0): number {
  return rowsFor(stats, seat).reduce((sum, row) => sum + cycleValue(row, seat, disruptionValue), 0);
}

/** Post-opening rows in which the seat took its turn. */
function averagedRows(stats: CycleStats, seat: 0 | 1): CycleRow[] {
  const played = new Set(stats.played[seat]);
  return stats.rows.filter((row) => row.cycle > 0 && played.has(row.cycle));
}

/** Average value over post-opening rounds the seat took a turn in. */
export function averageValue(stats: CycleStats, seat: 0 | 1, disruptionValue = 0): number {
  const cycles = stats.cyclesPlayed[seat];
  if (cycles === 0) return 0;
  return averagedRows(stats, seat)
    .reduce((sum, row) => sum + cycleValue(row, seat, disruptionValue), 0) / cycles;
}

export function averagePerRound(
  stats: CycleStats,
  seat: 0 | 1,
  metric: "threatened" | "blocked" | "damageDealt",
): number {
  const cycles = stats.cyclesPlayed[seat];
  return cycles === 0 ? 0 : averagedRows(stats, seat).reduce(
    (sum, row) => sum + row[metric][seat],
    0,
  ) / cycles;
}

export function averageThreatPerAttack(stats: CycleStats, seat: 0 | 1): number {
  const attacks = stats.total.attacks[seat];
  return attacks === 0 ? 0 : stats.total.threatened[seat] / attacks;
}
